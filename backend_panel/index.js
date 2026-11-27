const express = require("express");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const config = require("./config");
const { isXtreamResponse, parseXtreamMessage, extractM3uUrl,
        parseAtivarTesteCommand, parseClientIdFromMessage } = require('./parser');
const { syncFootball, getCache, getCacheDate, _restoreCache } = require('./services/football');
const { getEnrichedMatches } = require('./services/matcher');
const { checkXtreamAccount } = require('./services/xtream-account');
const { syncXtream, isReady: xtreamReady, getSyncedAt } = require('./services/xtream');
const { syncAgenda, syncUpcomingDrafts, getAgendaForDate, getAgendaDraft, todayStr, tomorrowStr } = require('./services/agenda');
const { readPublishedAgenda, registerSportsAdmin } = require('./sports-admin');
const { completeSerieA, completePublishedSerieA } = require('./services/brasileirao-agenda');
const { validDate } = require('./services/sete-agenda');
const { getStandings } = require('./services/cbf-standings');

// Cache enriquecido (com EPG resolvido) — servido direto ao app
let _enrichedCache = [];

// Inicializa DB → Futebol → JOGOS DO DIA
const dbReady = db.initDb();
dbReady
  .then(async () => {
    const today = todayStr();

    syncUpcomingDrafts();
    setInterval(syncUpcomingDrafts, 60 * 60 * 1000);

    // Xtream sync (para admin status)
    syncXtream().catch(() => {});
    setInterval(syncXtream, 60 * 60 * 1000);

    // Futebol: restaura do banco ou busca na API
    const row = await db.get('SELECT data FROM football_matches WHERE date = ?', [today]);
    if (row) {
      const saved = JSON.parse(row.data);
      _restoreCache(saved, today);
      console.log(`⚽ Cache restaurado do banco: ${saved.length} jogos`);
    } else {
      await syncAndSave();
    }

    // Enriquece cruzando JOGOS DO DIA × API-Football
    await enrichCache();

    setInterval(syncAndSave, 4 * 60 * 60 * 1000);
    setInterval(enrichCache, 20 * 60 * 1000);
  })
  .catch(err => console.error('Erro ao inicializar DB:', err));

// Histórico administrativo é complementar: falha ao registrar nunca deve
// interromper cadastro, ativação ou captura de credenciais.
async function logClientHistory(clientCode, category, event, summary, createdAt = Date.now()) {
  if (!clientCode) return;
  try {
    await db.run(
      'INSERT INTO client_history (client_code, category, event, summary, created_at) VALUES (?, ?, ?, ?, ?)',
      [String(clientCode).trim().toUpperCase(), category, event, summary, createdAt]
    );
  } catch (error) {
    console.warn('Não foi possível registrar histórico do cliente:', error.code || error.name);
  }
}

async function syncAndSave() {
  try {
    const matches = await syncFootball();
    if (matches.length === 0) return;
    const today = todayStr();
    await db.run(
      'INSERT OR REPLACE INTO football_matches (id, date, data, updated_at) VALUES (1, ?, ?, ?)',
      [today, JSON.stringify(matches), Date.now()]
    );
  } catch (e) {
    console.error('⚽ syncAndSave erro:', e.message);
  }
}

async function enrichCache() {
  try {
    console.log('⚽ Atualizando JOGOS DO DIA...');
    const enriched = await getEnrichedMatches();
    _enrichedCache = enriched;
    console.log(`⚽ JOGOS DO DIA pronto: ${enriched.length} jogo(s) com canal resolvido`);
  } catch (e) {
    console.error('⚽ enrichCache erro:', e.message);
  }
}

const app = express();
const PORT = config.PORT;

// Inatividade em milissegundos
const INACTIVITY_TIMEOUT = config.INACTIVITY_TIMEOUT;

// =====================
// MIDDLEWARES
// =====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS - permite requisições do app
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Api-Key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware para validar API Key do app
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey || apiKey !== config.APP_API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }
  next();
}

// Simple cookie parser (sem dependências externas)
function parseCookies(req) {
  const rc = req.headers.cookie;
  const list = {};
  if (!rc) return list;
  rc.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts.shift().trim();
    const value = decodeURIComponent(parts.join("="));
    list[key] = value;
  });
  return list;
}

// Middleware para validar sessão a partir do cookie 'sid'
// Atualiza last_activity em DB a cada requisição protegida
async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const sid = cookies.sid;
    if (!sid) return res.status(401).json({ success: false, error: 'Not authenticated' });
    
    const sessionRow = await db.get('SELECT * FROM sessions WHERE token = ?', [sid]);
    if (!sessionRow) return res.status(401).json({ success: false, error: 'Invalid session' });
    
    const now = Date.now();
    if (now - sessionRow.last_activity > INACTIVITY_TIMEOUT) {
      await db.run('DELETE FROM sessions WHERE token = ?', [sid]);
      return res.status(401).json({ success: false, error: 'Session expired' });
    }
    
    await db.run('UPDATE sessions SET last_activity = ? WHERE token = ?', [now, sid]);
    req.session = { user_id: sessionRow.user_id, token: sid };
    next();
  } catch (err) {
    console.error('Erro no auth:', err);
    return res.status(500).json({ success: false, error: 'Auth error' });
  }
}

// =====================
// SERVIR PAINEL (frontend)
// =====================
// Não forçamos redirecionamentos aqui para evitar loops de login.
// O frontend será responsável por checar sessão / localStorage e redirecionar.
app.use("/admin", express.static(path.join(__dirname, "admin")));
require('./evolution-admin')(app, requireAuth);
require('./mario-updates')(app, db, requireAuth, requireApiKey);
require('./bluetv-updates')(app, db, requireAuth, requireApiKey);

// =====================
// STATUS
// =====================
app.get("/", (req, res) => {
  res.send("Backend IPTV online ✅");
});

// =====================
// LOGIN
// =====================
// OBS: Não alteramos o corpo da resposta do /api/login (mantemos { success: true/false }).
// Ao autenticar com sucesso, criamos uma sessão persistida no SQLite e SET-Cookie (HttpOnly).
app.post("/api/login", async (req, res) => {
  try {
    const username = req.body?.username;
    const password = req.body?.password;

    if (!username || !password) {
      return res.json({ success: false });
    }

    const row = await db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);
    
    if (!row) {
      return res.json({ success: false });
    }

    const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    
    await db.run(
      "INSERT INTO sessions (token, user_id, last_activity) VALUES (?, ?, ?)",
      [token, row.id, now]
    );

    const cookieParts = [`sid=${token}`, "HttpOnly", "Path=/", "SameSite=Lax"];
    res.setHeader("Set-Cookie", cookieParts.join("; "));
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro no login:", err);
    return res.status(500).json({ success: false });
  }
});

// =====================
// API para inicialização do app Android
// POST /api/init
// Gera client_id único, salva em tabela clients e retorna client_id e whatsapp_link
// Aceita opcionalmente whatsapp_number no body para associar ao client (prioridade)
// Compatível com Express + SQLite
app.post("/api/init", async (req, res) => {
  try {
    const providedNumber = req.body?.whatsapp_number || null;
    const clientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    const status = req.body?.status || "pending";

    await db.run(
      "INSERT INTO clients (client_id, criado_em, whatsapp_number, status) VALUES (?, ?, ?, ?)",
      [clientId, now, providedNumber, status]
    );

    let number = providedNumber || process.env.WHATSAPP_NUMBER || "5511999999999";
    number = String(number).replace(/\D+/g, "");

    if (!number) {
      number = "5511999999999";
    }

    const message = `Oi, quero teste 4h. ID:${clientId}`;
    const encoded = encodeURIComponent(message);
    const whatsapp_link = `https://wa.me/${number}?text=${encoded}`;

    return res.json({ client_id: clientId, whatsapp_link });
  } catch (err) {
    console.error("Erro ao criar client:", err);
    return res.status(500).json({ success: false, error: "Erro ao criar client" });
  }
});

// =====================
// GET /api/whatsapp-link
// Retorna link wa.me com número configurável e mensagem automática contendo o client_id
// Query params:
//   client_id (obrigatório) - identifica o client
//   number (opcional) - sobrescreve o número do cliente / default
// Exemplo de mensagem: "Oi, quero teste 4h. ID:{client_id}"
// =====================
app.get("/api/whatsapp-link", async (req, res) => {
  try {
    const clientId = req.query.client_id;
    const overrideNumber = req.query.number || null;

    if (!clientId) {
      return res.status(400).json({ error: "client_id is required" });
    }

    const clientRow = await db.get("SELECT * FROM clients WHERE client_id = ?", [clientId]);
    
    if (!clientRow) {
      return res.status(404).json({ error: "client_id não encontrado" });
    }

    let number = overrideNumber || clientRow.whatsapp_number || process.env.WHATSAPP_NUMBER || "5511999999999";
    number = String(number).replace(/\D+/g, "");
    
    if (!number) {
      return res.status(400).json({ error: "Número inválido" });
    }

    const message = `Oi, quero teste 4h. ID:${clientId}`;
    const encoded = encodeURIComponent(message);
    const link = `https://wa.me/${number}?text=${encoded}`;

    return res.json({ link });
  } catch (err) {
    console.error("Erro ao buscar client:", err);
    return res.status(500).json({ error: "DB error" });
  }
});

// =====================
// NEW: Webhook para receber mensagens do WhatsApp
// POST /webhook/whatsapp
// Recebe payload com texto da mensagem e número do remetente
// Extrai client_id (formato ID:<client_id>) e vincula ao client
// Atualiza clients.whatsapp_number e status='vinculado'
// Impede que o mesmo número crie mais de um teste
// =====================

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    console.log("botbot webhook called", { body: req.body });

    let phone = req.body?.from || req.body?.phone || req.body?.sender || null;
    let message = req.body?.message || req.body?.text || req.body?.body || null;

    if ((!phone || !message) && Array.isArray(req.body?.messages) && req.body.messages.length > 0) {
      const m = req.body.messages[0];
      phone = phone || m.from || m.phone || m.sender || null;
      message = message || m.body || m.text || m.message || null;
    }

    phone = phone ? String(phone).replace(/\D+/g, "") : null;
    message = message ? String(message) : null;
    const receivedAt = Date.now();

    if (phone && message) {
      await db.run(
        "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
        [phone, message, receivedAt]
      );
      console.log("botbot_message salvo", { phone, receivedAt });
    }

    if (phone) {
      const clientRow = await db.get("SELECT * FROM clients WHERE whatsapp_number = ?", [phone]);
      if (clientRow) {
        await db.run("UPDATE clients SET status = ? WHERE id = ?", ["recebido_botbot", clientRow.id]);
        console.log("Client status atualizado para recebido_botbot", { client_id: clientRow.client_id, phone });
      } else {
        const newClientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
        const now = Date.now();
        await db.run(
          "INSERT INTO clients (client_id, criado_em, whatsapp_number, status) VALUES (?, ?, ?, ?)",
          [newClientId, now, phone, "recebido_botbot"]
        );
        console.log("Novo client criado a partir do botbot", { client_id: newClientId, phone });
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro processando webhook botbot:", err);
    return res.json({ success: true });
  }
});

// =====================
// ROTA PARA MARCAR CLIENT COMO ATIVO (após verificação por WhatsApp)
// POST /api/clients/:client_id/activate
// Protegida por requireAuth (apenas admin pode ativar). Aceita whatsapp_number opcional no body.
// Define status='active' e atualiza whatsapp_number se fornecido.
// =====================
app.post("/api/clients/:client_id/activate", requireAuth, async (req, res) => {
  try {
    const clientId = req.params.client_id;
    const providedNumber = req.body?.whatsapp_number || null;

    const clientRow = await db.get("SELECT * FROM clients WHERE client_id = ?", [clientId]);
    if (!clientRow) {
      return res.status(404).json({ success: false, error: "client_id não encontrado" });
    }

    const updates = ["status = ?"];
    const params = ["active"];

    if (providedNumber !== null) {
      updates.push("whatsapp_number = ?");
      params.push(providedNumber);
    }
    params.push(clientId);

    const sql = `UPDATE clients SET ${updates.join(", ")} WHERE client_id = ?`;
    await db.run(sql, params);
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao ativar client:", err);
    return res.status(500).json({ success: false });
  }
});

// =====================
// LOGOUT (opcional)
// =====================
app.post("/api/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const sid = cookies.sid;
    if (sid) {
      await db.run("DELETE FROM sessions WHERE token = ?", [sid]);
    }
    res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao fazer logout:", err);
    return res.json({ success: false });
  }
});

// =====================
// LISTAR NÚMEROS (PROTEGIDO)
// =====================
app.get("/api/numeros", requireAuth, async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM numeros", []);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar números:", err);
    return res.json([]);
  }
});

app.post("/api/adicionar", requireAuth, async (req, res) => {
  try {
    const numero = req.body?.numero;
    if (!numero) return res.status(400).json({ error: "Número inválido" });

    await db.run("INSERT INTO numeros (numero, status) VALUES (?, 'livre')", [numero]);
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro ao adicionar número:", err);
    return res.status(500).json({ error: "Erro ao adicionar número" });
  }
});

// =====================
// LIBERAR (PROTEGIDO)
// =====================
app.post("/api/liberar/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await db.run("UPDATE numeros SET status = 'livre' WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao liberar número:", err);
    return res.status(500).json({ success: false, error: "Erro no banco" });
  }
});

// =====================
// DELETAR (PROTEGIDO)
// =====================
app.delete("/api/deletar/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    await db.run("DELETE FROM numeros WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao deletar número:", err);
    return res.status(500).json({ success: false, error: "Erro no banco" });
  }
});
// =====================
// DEBUG - VER MENSAGENS DO BOTBOT
// =====================
app.get("/api/debug/botbot", requireAuth, async (req, res) => {
  try {
    const rows = await db.all("SELECT id, phone, message, received_at FROM botbot_messages ORDER BY id DESC", []);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar botbot_messages:", err);
    return res.status(500).json({ error: "Erro ao buscar dados" });
  }
});
app.get('/admin/whatsapp/conversations', requireAuth, async (req, res) => {
  try {
    const conversations = await db.all(`
      WITH threads AS (
        SELECT phone, MAX(id) AS latest_id, COUNT(*) AS message_count
        FROM botbot_messages
        GROUP BY phone
      )
      SELECT threads.*, latest.received_at, SUBSTR(latest.message, 1, 160) AS preview,
        (SELECT customer_name FROM app_requests
          WHERE whatsapp_number = threads.phone AND customer_name IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1) AS customer_name
      FROM threads JOIN botbot_messages latest ON latest.id = threads.latest_id
      ORDER BY threads.latest_id DESC
    `);
    res.json({ conversations });
  } catch (error) {
    console.error('Erro ao listar conversas:', error.code || error.name);
    res.status(500).json({ error: 'Não foi possível carregar as conversas.' });
  }
});

app.get('/admin/whatsapp/conversations/:id', requireAuth, async (req, res) => {
  try {
    const thread = await db.get('SELECT phone FROM botbot_messages WHERE id = ?', [req.params.id]);
    if (!thread) return res.status(404).json({ error: 'Conversa não encontrada. Atualize a lista.' });
    const before = Number(req.query.before || Number(req.params.id) + 1);
    if (!Number.isSafeInteger(before) || before < 1) return res.status(400).json({ error: 'Página inválida.' });
    const rows = await db.all(`
      SELECT id, message, received_at FROM botbot_messages
      WHERE phone IS ? AND id < ? ORDER BY id DESC LIMIT 51
    `, [thread.phone, before]);
    res.json({ messages: rows.slice(0, 50), has_more: rows.length > 50 });
  } catch (error) {
    console.error('Erro ao carregar conversa:', error.code || error.name);
    res.status(500).json({ error: 'Não foi possível abrir a conversa.' });
  }
});

app.delete('/admin/whatsapp/conversations/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Conversa inválida.' });
  try {
    const result = await db.run(`
      WITH target AS MATERIALIZED (SELECT phone FROM botbot_messages WHERE id = ?)
      DELETE FROM botbot_messages
      WHERE id <= ? AND EXISTS (SELECT 1 FROM target WHERE phone IS botbot_messages.phone)
    `, [id, id]);
    if (!result.rowsAffected) return res.status(404).json({ error: 'Conversa não encontrada. Atualize a lista.' });
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao excluir conversa:', error.code || error.name);
    res.status(500).json({ error: 'Não foi possível excluir o histórico.' });
  }
});

// =====================
// API: LISTAR CLIENTES (DO BANCO)
// =====================
app.get("/api/clients", requireAuth, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        ar.id, ar.client_code, ar.whatsapp_number, ar.customer_name, ar.customer_validade, ar.status,
        ar.created_at, ar.updated_at, ar.xtream_id,
        ar.device_model, ar.apk_version, ar.last_seen,
        ar.current_channel, ar.is_online,
        xc.host, xc.username, xc.password, COALESCE(ar.customer_validade, xc.validade) AS validade, xc.m3u_url, xc.plano
      FROM app_requests ar
      LEFT JOIN xtream_credentials xc ON ar.xtream_id = xc.id
      ORDER BY ar.last_seen DESC NULLS LAST, ar.updated_at DESC
    `);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error("Erro ao buscar clients:", err);
    return res.status(500).json({ error: "Erro ao buscar clients" });
  }
});

// ADMIN: cadastrar e ativar um cliente manualmente, sem depender do WhatsApp/Evolution.
// O código precisa ser o mesmo que aparece na tela de ativação do app.
app.post('/admin/clients/manual', requireAuth, async (req, res) => {
  let createdRequest = false;
  let createdCredentialId = null;
  try {
    const clientCode = String(req.body?.client_code || '').trim().toUpperCase();
    const whatsappNumber = String(req.body?.whatsapp_number || '').replace(/\D/g, '');
    const host = String(req.body?.host || '').trim().replace(/\/+$/, '');
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const validade = String(req.body?.validade || '').trim();

    if (!/^BLUETV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(clientCode)) {
      return res.status(400).json({ success: false, error: 'Informe o código BLUETV-XXXXX exibido no app.' });
    }
    if (!host || !username || !password) {
      return res.status(400).json({ success: false, error: 'Host, usuário e senha são obrigatórios.' });
    }
    if (whatsappNumber && (whatsappNumber.length < 10 || whatsappNumber.length > 15)) {
      return res.status(400).json({ success: false, error: 'WhatsApp inválido. Informe DDD e número, somente dígitos.' });
    }
    if (await db.get('SELECT id FROM app_requests WHERE client_code = ?', [clientCode])) {
      return res.status(409).json({ success: false, error: 'Este código já está cadastrado. Use a opção de editar/ativar na lista.' });
    }

    const now = Date.now();
    const requestId = crypto.randomUUID();
    await db.run(
      `INSERT INTO app_requests (request_id, client_code, device_id, whatsapp_number, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [requestId, clientCode, `manual-${requestId}`, whatsappNumber || null, now, now]
    );
    createdRequest = true;

    const m3uUrl = `${host}/get.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&type=m3u_plus&output=mpegts`;
    const insertResult = await db.run(
      `INSERT INTO xtream_credentials
       (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at, status, plano)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual-admin', ?, 'extracted', 'manual')`,
      [requestId, clientCode, whatsappNumber || '', host, username, password, validade || null, m3uUrl, now]
    );
    createdCredentialId = Number(insertResult.lastInsertRowid || insertResult.lastID);

    await db.run(
      "UPDATE app_requests SET status = 'ok', xtream_id = ?, updated_at = ? WHERE client_code = ?",
      [createdCredentialId, Date.now(), clientCode]
    );
    await logClientHistory(clientCode, 'status', 'client_activated', 'Cliente ativado.', now);

    return res.status(201).json({ success: true, client_code: clientCode, status: 'ok' });
  } catch (err) {
    // Evita deixar cadastro ou credencial incompletos se alguma etapa falhar.
    if (createdCredentialId) await db.run('DELETE FROM xtream_credentials WHERE id = ?', [createdCredentialId]).catch(() => {});
    if (createdRequest) await db.run("DELETE FROM app_requests WHERE client_code = ? AND status = 'pending'", [String(req.body?.client_code || '').trim().toUpperCase()]).catch(() => {});
    if (String(err.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ success: false, error: 'Este código já foi cadastrado.' });
    }
    console.error('Erro no cadastro manual de cliente:', err);
    return res.status(500).json({ success: false, error: 'Não foi possível cadastrar o cliente.' });
  }
});

// =====================
// ADMIN: DETALHE COMPLETO DO CLIENTE
// =====================
app.put('/admin/clients/:code/profile', requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const name = String(req.body?.name ?? '').trim();
  const inputPhone = String(req.body?.phone ?? '').trim();
  const phone = inputPhone.replace(/\D/g, '');
  const date = String(req.body?.validade ?? '').trim();
  let validDate = !date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(date);
    validDate = Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }
  if (!/^BLUETV-[A-Z0-9]{5}$/.test(code) || name.length > 120 ||
      (inputPhone && (!/^[+\d() .-]+$/.test(inputPhone) || !/^\d{10,15}$/.test(phone))) || !validDate) {
    return res.status(400).json({ error: 'Confira o nome, o telefone com DDD e a data de validade.' });
  }
  try {
    const result = await db.run(
      'UPDATE app_requests SET customer_name = ?, whatsapp_number = ?, customer_validade = ?, updated_at = ? WHERE client_code = ?',
      [name || null, phone || null, date || null, Date.now(), code]
    );
    if (!result.rowsAffected) return res.status(404).json({ error: 'Cliente não encontrado.' });
    await logClientHistory(code, 'profile', 'profile_updated', 'Ficha do cliente atualizada.');
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar ficha de cliente:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível salvar a ficha.' });
  }
});

app.get('/admin/client-detail/:code', requireAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const appReq = await db.get('SELECT * FROM app_requests WHERE client_code = ?', [code]);
    if (!appReq) return res.status(404).json({ error: 'Cliente não encontrado' });

    const xtream = appReq.xtream_id
      ? await db.get('SELECT * FROM xtream_credentials WHERE id = ?', [appReq.xtream_id])
      : null;

    const events = await db.all(
      "SELECT * FROM client_events WHERE client_code = ? AND event = 'PLAY_START' ORDER BY ts DESC, id DESC LIMIT 80",
      [code]
    ).catch(() => []);

    const channelAndErrorEvents = await db.all(
      `SELECT id, event, channel, quality, error_code, apk_version, ts
       FROM client_events WHERE client_code = ? ORDER BY ts DESC, id DESC LIMIT 100`,
      [code]
    ).catch(() => []);
    const savedHistory = await db.all(
      `SELECT category, event, summary, created_at AS ts
       FROM client_history WHERE client_code = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
      [code]
    ).catch(() => []);
    const credentialHistory = await db.all(
      `SELECT host, validade, plano, extracted_at AS ts
       FROM xtream_credentials
       WHERE request_id = ? OR client_id = ?
       ORDER BY extracted_at DESC, id DESC LIMIT 50`,
      [appReq.request_id, code]
    ).catch(() => []);
    const whatsappHistory = appReq.whatsapp_number
      ? await db.all(
          `SELECT received_at AS ts FROM botbot_messages
           WHERE phone = ? ORDER BY id DESC LIMIT 50`,
          [appReq.whatsapp_number]
        ).catch(() => [])
      : [];

    const history = [
      { category: 'status', event: 'client_created', summary: 'Cadastro do cliente criado.', ts: appReq.created_at },
      ...savedHistory,
      ...channelAndErrorEvents.map(item => ({
        category: item.event === 'PLAY_ERROR' ? 'errors' : 'channels',
        event: item.event,
        summary: item.event === 'PLAY_START'
          ? `Assistiu: ${item.channel || 'canal não informado'}`
          : item.event === 'PLAY_ERROR'
            ? `Erro de reprodução${item.error_code != null ? ` (código ${item.error_code})` : ''}.`
            : item.event === 'PLAY_STOP' ? `Parou: ${item.channel || 'canal não informado'}` : `Evento do app: ${item.event}.`,
        detail: item.event === 'PLAY_START' ? [item.quality, item.apk_version && `APK ${item.apk_version}`].filter(Boolean).join(' · ') : '',
        ts: item.ts
      })),
      ...credentialHistory.map(item => ({
        category: 'credentials', event: 'credentials_received',
        summary: 'Credenciais recebidas e processadas.',
        detail: [item.host, item.plano, item.validade && `Validade ${item.validade}`].filter(Boolean).join(' · '),
        ts: item.ts
      })),
      ...whatsappHistory.map(item => ({
        category: 'whatsapp', event: 'whatsapp_received',
        summary: 'Mensagem recebida no WhatsApp (conteúdo oculto).', ts: item.ts
      }))
    ].filter(item => Number.isFinite(Number(item.ts)) && Number(item.ts) > 0)
      .sort((a, b) => Number(b.ts) - Number(a.ts))
      .slice(0, 200);

    const errorCount24h = await db.get(
      `SELECT COUNT(*) as n FROM client_events WHERE client_code = ? AND event = 'PLAY_ERROR' AND ts > ?`,
      [code, Date.now() - 86400000]
    ).catch(() => ({ n: 0 }));

    return res.json({ appReq, xtream, events, history, errorCount24h: errorCount24h?.n || 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =====================
// ADMIN: TESTAR CONEXÃO COM SERVIDOR DO CLIENTE
// =====================
app.post('/admin/test-connection', requireAuth, async (req, res) => {
  try {
    const { client_code } = req.body || {};
    if (typeof client_code !== 'string' || !client_code.trim()) {
      return res.status(400).json({ ok: false, error: 'Informe o código do cliente' });
    }

    const code = client_code.trim().toUpperCase();
    const appReq = await db.get('SELECT * FROM app_requests WHERE client_code = ?', [code]);
    if (!appReq || !appReq.xtream_id)
      return res.json({ ok: false, error: 'Sem servidor configurado para este cliente' });

    const xtream = await db.get('SELECT host, username, password FROM xtream_credentials WHERE id = ?', [appReq.xtream_id]);
    if (!xtream?.host || !xtream.username || !xtream.password) {
      return res.json({ ok: false, error: 'Dados do servidor incompletos' });
    }
    return res.json(await checkXtreamAccount(xtream));
  } catch {
    return res.status(500).json({ ok: false, error: 'Não foi possível carregar o servidor do cliente' });
  }
});

// =====================
// ADMIN: DNS SALVOS
// =====================
function normalizeDnsHost(value) {
  if (typeof value !== 'string') return null;
  let host = value.trim();
  if (!host || host.length > 255) return null;
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  try {
    const parsed = new URL(host);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname ||
        parsed.username || parsed.password || parsed.search || parsed.hash ||
        (parsed.pathname && parsed.pathname !== '/')) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

app.get('/admin/dns-presets', requireAuth, async (req, res) => {
  try {
    await dbReady;
    const rows = await db.all('SELECT id, name, host, created_at, updated_at FROM admin_dns_presets ORDER BY name COLLATE NOCASE, id');
    return res.json(rows);
  } catch (error) {
    console.error('Erro ao listar DNS salvos:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível carregar os DNS salvos.' });
  }
});

app.post('/admin/dns-presets', requireAuth, async (req, res) => {
  try {
    await dbReady;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const host = normalizeDnsHost(req.body?.host);
    if (!name || name.length > 60 || !host) {
      return res.status(400).json({ error: 'Informe um nome de até 60 caracteres e um endereço HTTP ou HTTPS válido.' });
    }
    const duplicate = await db.get('SELECT id FROM admin_dns_presets WHERE lower(host) = lower(?)', [host]);
    if (duplicate) return res.status(409).json({ error: 'Esse endereço já está salvo.' });
    const now = Date.now();
    const result = await db.run(
      'INSERT INTO admin_dns_presets (name, host, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [name, host, now, now]
    );
    return res.status(201).json({ success: true, id: Number(result.lastInsertRowid), name, host });
  } catch (error) {
    console.error('Erro ao salvar DNS:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível salvar esse DNS.' });
  }
});

app.put('/admin/dns-presets/:id', requireAuth, async (req, res) => {
  try {
    await dbReady;
    const id = Number(req.params.id);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const host = normalizeDnsHost(req.body?.host);
    if (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 60 || !host) {
      return res.status(400).json({ error: 'Confira o nome e o endereço DNS.' });
    }
    const existing = await db.get('SELECT id FROM admin_dns_presets WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'DNS salvo não encontrado.' });
    const duplicate = await db.get('SELECT id FROM admin_dns_presets WHERE lower(host) = lower(?) AND id <> ?', [host, id]);
    if (duplicate) return res.status(409).json({ error: 'Esse endereço já está salvo em outro item.' });
    await db.run('UPDATE admin_dns_presets SET name = ?, host = ?, updated_at = ? WHERE id = ?', [name, host, Date.now(), id]);
    return res.json({ success: true, id, name, host });
  } catch (error) {
    console.error('Erro ao editar DNS:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível editar esse DNS.' });
  }
});

app.delete('/admin/dns-presets/:id', requireAuth, async (req, res) => {
  try {
    await dbReady;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'DNS inválido.' });
    const result = await db.run('DELETE FROM admin_dns_presets WHERE id = ?', [id]);
    if (!result.rowsAffected) return res.status(404).json({ error: 'DNS salvo não encontrado.' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover DNS:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível remover esse DNS.' });
  }
});

app.post('/admin/clients/dns-bulk', requireAuth, async (req, res) => {
  try {
    await dbReady;
    const requested = req.body?.client_codes;
    const presetId = Number(req.body?.dns_preset_id);
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 200 ||
        requested.some(code => typeof code !== 'string')) {
      return res.status(400).json({ error: 'Selecione de 1 a 200 clientes.' });
    }
    if (!Number.isSafeInteger(presetId) || presetId < 1) {
      return res.status(400).json({ error: 'Escolha um DNS salvo.' });
    }
    const codes = [...new Set(requested.map(code => code.trim().toUpperCase()))];
    if (codes.some(code => !/^[A-Z0-9+().\-\s]{1,40}$/.test(code))) {
      return res.status(400).json({ error: 'A seleção contém um código de cliente inválido.' });
    }
    const preset = await db.get('SELECT id, name, host FROM admin_dns_presets WHERE id = ?', [presetId]);
    if (!preset) return res.status(404).json({ error: 'O DNS escolhido não está mais salvo.' });
    const marks = codes.map(() => '?').join(', ');
    const clients = await db.all(
      `SELECT ar.client_code, ar.xtream_id, xc.username, xc.password, xc.m3u_url
       FROM app_requests ar JOIN xtream_credentials xc ON xc.id = ar.xtream_id
       WHERE ar.client_code IN (${marks})`, codes
    );
    if (!clients.length) {
      return res.json({ success: true, updated: 0, skipped: codes.length, host: preset.host });
    }
    const now = Date.now();
    const statements = clients.flatMap(client => {
      let m3uUrl;
      try {
        const playlist = new URL(client.m3u_url);
        const target = new URL(preset.host);
        playlist.protocol = target.protocol;
        playlist.host = target.host;
        m3uUrl = playlist.toString();
      } catch {
        m3uUrl = `${preset.host}/get.php?username=${client.username}&password=${client.password}&type=m3u`;
      }
      return [
        { sql: 'UPDATE xtream_credentials SET host = ?, m3u_url = ?, extracted_at = ? WHERE id = ?', args: [preset.host, m3uUrl, now, client.xtream_id] },
        { sql: 'UPDATE app_requests SET updated_at = ? WHERE client_code = ?', args: [now, client.client_code] }
      ];
    });
    await db.batch(statements);
    return res.json({ success: true, updated: clients.length, skipped: codes.length - clients.length, host: preset.host });
  } catch (error) {
    console.error('Erro ao trocar DNS em lote:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível concluir a troca em lote.' });
  }
});

// =====================
// ADMIN: INATIVAR CLIENTE (move para inativos, preserva dados)
// =====================
app.post('/admin/client-inativar', requireAuth, async (req, res) => {
  try {
    const { client_code, motivo } = req.body;
    if (!client_code) return res.status(400).json({ error: 'client_code obrigatório' });
    const code = client_code.toUpperCase();
    const now  = Date.now();

    const row = await db.get('SELECT * FROM app_requests WHERE client_code = ?', [code]);
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado' });

    // Salva status anterior no campo device_model como histórico simples
    // e marca como inativo com timestamp
    await db.run(
      `UPDATE app_requests
       SET status = 'inativo', is_online = 0, updated_at = ?, current_channel = ?
       WHERE client_code = ?`,
      [now, motivo ? `[INATIVO] ${motivo}` : '[INATIVO]', code]
    );
    await logClientHistory(code, 'status', 'client_deactivated', `Cliente inativado${motivo ? `: ${String(motivo).slice(0, 160)}` : '.'}`, now);
    console.log(`🚫 Cliente inativado: ${code} — motivo: ${motivo || 'não informado'}`);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =====================
// ADMIN: REATIVAR CLIENTE
// =====================
app.post('/admin/client-reativar', requireAuth, async (req, res) => {
  try {
    const { client_code } = req.body;
    if (!client_code) return res.status(400).json({ error: 'client_code obrigatório' });
    const code = client_code.toUpperCase();
    const now  = Date.now();

    const row = await db.get('SELECT * FROM app_requests WHERE client_code = ?', [code]);
    if (!row) return res.status(404).json({ error: 'Cliente não encontrado' });

    // Restaura para 'ok' se tinha credenciais, ou 'pending'
    const novoStatus = row.xtream_id ? 'ok' : 'pending';
    await db.run(
      `UPDATE app_requests SET status = ?, updated_at = ?,
         current_channel = CASE WHEN status = 'inativo' THEN NULL ELSE current_channel END
       WHERE client_code = ?`,
      [novoStatus, now, code]
    );
    await logClientHistory(code, 'status', 'client_reactivated', `Cliente reativado (${novoStatus}).`, now);
    console.log(`♻️  Cliente reativado: ${code} → ${novoStatus}`);
    return res.json({ success: true, status: novoStatus });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Remove only the device registration. Provider credentials may be shared.
app.delete('/admin/clients/:code', requireAuth, async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  if (!/^BLUETV-[A-Z0-9]{5}$/.test(code)) {
    return res.status(400).json({ error: 'Código de cliente inválido.' });
  }

  try {
    const result = await db.run('DELETE FROM app_requests WHERE client_code = ?', [code]);
    if (result.rowsAffected === 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erro ao excluir cadastro de TV Box:', error.code || error.name);
    return res.status(500).json({ error: 'Não foi possível excluir o cadastro.' });
  }
});

// =====================
// ADMIN: ESTATÍSTICAS DO DASHBOARD
// =====================
app.get('/admin/stats', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    const onlineThreshold = now - 3 * 60 * 1000;         // online = visto há < 3min
    const todayStart      = new Date(); todayStart.setHours(0, 0, 0, 0);
    const in7days         = now + 7 * 24 * 60 * 60 * 1000;

    const [total, online, activeToday, servers] = await Promise.all([
      db.get('SELECT COUNT(*) as n FROM app_requests', []),
      db.get('SELECT COUNT(*) as n FROM app_requests WHERE last_seen > ?', [onlineThreshold]),
      db.get('SELECT COUNT(*) as n FROM app_requests WHERE last_seen > ?', [todayStart.getTime()]),
      db.all(`
        SELECT xc.host, COUNT(ar.id) as total
        FROM app_requests ar
        JOIN xtream_credentials xc ON ar.xtream_id = xc.id
        GROUP BY xc.host ORDER BY total DESC LIMIT 8
      `, []).catch(() => [])
    ]);

    return res.json({
      total: total?.n || 0,
      online: online?.n || 0,
      activeToday: activeToday?.n || 0,
      servers: servers || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =====================
// WEBHOOK EVOLUTION API / BOTBOT
// =====================
// IMPORTANTE: Recebe APENAS mensagens INBOUND (recebidas pelo número Evolution)
// NÃO é possível capturar mensagens OUTBOUND (enviadas pela Evolution)
// 
// Fluxo suportado:
// 1. BotBot/Painel IPTV envia login+senha ao cliente
// 2. BotBot envia botão "ATIVAR TESTE" com link wa.me pré-preenchido
// 3. Cliente clica no botão -> abre WhatsApp com mensagem: "ATIVAR_TESTE <login> <senha>"
// 4. Cliente confirma envio -> mensagem INBOUND chega aqui via Evolution API
// 5. Backend extrai login/senha, usa DNS fixo, salva credenciais
// =====================
app.post('/webhook/evolution', async (req, res) => {
  try {
    const body = req.body;
    console.log('📨 Evolution webhook recebido');

    // Extrair dados da mensagem conforme formato Evolution API
    const data = body.data || body;
    const messageData = data.message || data.messages?.[0] || {};
    const key = data.key || messageData.key || {};
    
    // LIDs identificam a conta, mas não são números de telefone.
    // O Evolution pode fornecer o número correspondente em remoteJidAlt/
    // participantAlt; só esses JIDs telefônicos são aceitos como telefone.
    const senderPhone = extractEvolutionSenderPhone(key, data, body);
    const senderJid = extractEvolutionSenderJid(key, data, body);
    
    // Conteúdo da mensagem
    const message = messageData.conversation 
      || messageData.extendedTextMessage?.text 
      || data.text
      || body.text
      || body.message
      || '';

    if (!message) {
      return res.json({ success: true, message: 'Sem conteúdo' });
    }

    console.log(senderPhone ? `📞 De: ${senderPhone}` : '📞 Mensagem sem telefone verificável (JID LID)');
    console.log(`💬 Mensagem: ${message.substring(0, 100)}`);

    const now = Date.now();

    // CASO 1: Mensagem contém BLUETV-XXXXX (primeira mensagem do cliente)
    const clientIdMatch = message.match(/BLUETV-([A-Z0-9]{5})/i);
    if (clientIdMatch) {
      const clientId = clientIdMatch[0].toUpperCase();
      console.log(`🆔 Client ID detectado: ${clientId} de ${senderPhone}`);

      // Criar ou actualizar o app_request vinculando número ao Client ID
      const existing = await db.get(
        "SELECT * FROM app_requests WHERE client_code = ?",
        [clientId]
      );

      if (existing) {
        if (senderPhone) {
          await db.run(
            "UPDATE app_requests SET whatsapp_number = ?, updated_at = ? WHERE client_code = ?",
            [senderPhone, now, clientId]
          );
        } else if (legacyLidDigits(senderJid) && existing.whatsapp_number === legacyLidDigits(senderJid)) {
          await db.run(
            "UPDATE app_requests SET whatsapp_number = NULL, updated_at = ? WHERE client_code = ?",
            [now, clientId]
          );
        }
      } else {
        await db.run(
          `INSERT INTO app_requests 
           (request_id, client_code, device_id, whatsapp_number, status, created_at, updated_at)
           VALUES (?, ?, 'evolution', ?, 'pending', ?, ?)`,
          [require('crypto').randomUUID(), clientId, senderPhone, now, now]
        );
      }

      if (senderJid) {
        await db.run(
          `INSERT INTO evolution_sender_links (sender_jid, client_code, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(sender_jid) DO UPDATE SET client_code = excluded.client_code, updated_at = excluded.updated_at`,
          [senderJid, clientId, now]
        );
      }

      // Guardar mensagem no log
      await db.run(
        "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
        [senderPhone, message, now]
      ).catch(() => {});
      await logClientHistory(clientId, 'whatsapp', 'whatsapp_received', 'Mensagem de identificação recebida no WhatsApp.', now);

      console.log(`✅ Número ${senderPhone} vinculado ao ${clientId}`);
      return res.json({ success: true, clientId, senderPhone });
    }

    // CASO 2: Mensagem contém credenciais Xtream (resposta do BotBot)
    if (isXtreamResponse(message)) {
      console.log(`🔑 Credenciais Xtream detectadas de ${senderPhone}`);
      
      const parsed = parseXtreamMessage(message);
      if (!parsed.success) {
        return res.json({ success: false, error: 'Falha ao extrair credenciais' });
      }

      // Buscar o Client ID pelo número de telefone
      const appRequestByPhone = senderPhone ? await db.get(
        "SELECT * FROM app_requests WHERE whatsapp_number = ? ORDER BY created_at DESC LIMIT 1",
        [senderPhone]
      ) : null;
      const messageClientCode = parseClientIdFromMessage(message);
      const appRequestByMessageCode = !appRequestByPhone && messageClientCode ? await db.get(
        'SELECT * FROM app_requests WHERE client_code = ?',
        [messageClientCode]
      ) : null;
      const senderLink = !appRequestByPhone && !appRequestByMessageCode && senderJid ? await db.get(
        'SELECT client_code FROM evolution_sender_links WHERE sender_jid = ?',
        [senderJid]
      ) : null;
      let legacyLidRequest = null;
      const oldLidNumber = !appRequestByPhone && !appRequestByMessageCode && !senderLink
        ? legacyLidDigits(senderJid)
        : null;
      if (oldLidNumber) {
        legacyLidRequest = await db.get(
          "SELECT * FROM app_requests WHERE whatsapp_number = ? ORDER BY created_at DESC LIMIT 1",
          [oldLidNumber]
        );
      }
      const appRequestBySenderLink = senderLink ? await db.get(
        'SELECT * FROM app_requests WHERE client_code = ?',
        [senderLink.client_code]
      ) : null;
      const appRequest = appRequestByPhone || appRequestByMessageCode || appRequestBySenderLink || legacyLidRequest;

      if (legacyLidRequest && senderJid) {
        await db.run(
          'UPDATE app_requests SET whatsapp_number = NULL, updated_at = ? WHERE client_code = ?',
          [now, legacyLidRequest.client_code]
        );
        await db.run(
          `INSERT INTO evolution_sender_links (sender_jid, client_code, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(sender_jid) DO UPDATE SET client_code = excluded.client_code, updated_at = excluded.updated_at`,
          [senderJid, legacyLidRequest.client_code, now]
        );
      }

      const clientId = appRequest?.client_code || null;
      console.log(`🔗 Vinculando credenciais ao Client ID: ${clientId}`);

      // Guardar credenciais
      const insertResult = await db.run(
        `INSERT INTO xtream_credentials 
         (request_id, client_id, whatsapp_number, host, username, password, 
          validade, m3u_url, raw_message, extracted_at, status, plano)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?)`,
        [
          require('crypto').randomUUID(),
          clientId,
          senderPhone,
          parsed.host,
          parsed.username,
          parsed.password,
          parsed.validade,
          parsed.m3u_url,
          message,
          now,
          parsed.plano || null
        ]
      );

      const xtreamId = Number(insertResult.lastInsertRowid || insertResult.lastID);

      // Activar o cliente
      if (appRequest) {
        await db.run(
          "UPDATE app_requests SET status = CASE WHEN status = 'inativo' THEN status ELSE 'ok' END, xtream_id = ?, whatsapp_number = COALESCE(?, whatsapp_number), updated_at = ? WHERE client_code = ?",
          [xtreamId, senderPhone, now, appRequest.client_code]
        );
        console.log(`🎉 Cliente ${clientId} ACTIVADO com sucesso!`);
      }

      // Guardar no log
      await db.run(
        "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
        [senderPhone, message, now]
      ).catch(() => {});

      return res.json({ success: true, clientId, senderPhone, host: parsed.host });
    }

    // CASO 3: Outra mensagem — só registar no log
    await db.run(
      "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
      [senderPhone, message, now]
    ).catch(() => {});

    return res.json({ success: true, message: 'Mensagem registada' });

  } catch (err) {
    console.error('❌ Erro webhook evolution:', err);
    return res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

// =====================
// APP: INICIAR REQUEST DE TESTE
// POST /app/request
// - Recebe device_id do app
// - Gera client_code legível (6 caracteres)
// - Retorna client_code e link do WhatsApp
// =====================

// Função para gerar código legível (BLUETV-XXXXX)
function generateClientCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'BLUETV-' + code;
}

app.post("/app/request", requireApiKey, async (req, res) => {
  try {
    const deviceId = req.body?.device_id || null;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "device_id is required" });
    }

    const existingRequest = await db.get(
      "SELECT * FROM app_requests WHERE device_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [deviceId]
    );

    if (existingRequest) {
      const targetNumber = config.IPTV_PANEL_NUMBER || config.WHATSAPP_NUMBER;
      const message = `teste iptv cliente ${existingRequest.client_code}`;
      const encoded = encodeURIComponent(message);
      const whatsappLink = `https://wa.me/${targetNumber}?text=${encoded}`;

      return res.json({
        success: true,
        client_code: existingRequest.client_code,
        request_id: existingRequest.request_id,
        status: existingRequest.status,
        whatsapp_link: whatsappLink
      });
    }

    const requestId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const clientCode = generateClientCode();
    const now = Date.now();

    await db.run(
      "INSERT INTO app_requests (request_id, client_code, device_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
      [requestId, clientCode, deviceId, now, now]
    );

    const targetNumber = config.IPTV_PANEL_NUMBER || config.WHATSAPP_NUMBER;
    const message = `teste iptv cliente ${clientCode}`;
    const encoded = encodeURIComponent(message);
    const whatsappLink = `https://wa.me/${targetNumber}?text=${encoded}`;

    return res.json({
      success: true,
      client_code: clientCode,
      request_id: requestId,
      status: "pending",
      whatsapp_link: whatsappLink
    });
  } catch (err) {
    console.error("Erro ao criar app_request:", err);
    return res.status(500).json({ success: false, error: "Erro ao criar request" });
  }
});

// =====================
// APP: VERIFICAR STATUS DO REQUEST (POLLING)
// GET /app/status?client_code=xxx ou ?request_id=xxx
// - Retorna status: pending | ok | error
// - Se ok, retorna credenciais Xtream limpas
// =====================
app.get("/app/status", requireApiKey, async (req, res) => {
  try {
    const clientCode = req.query.client_code;
    const requestId = req.query.request_id;

    if (!clientCode && !requestId) {
      return res.status(400).json({ success: false, error: "client_code or request_id is required" });
    }

    const query = clientCode
      ? "SELECT * FROM app_requests WHERE client_code = ?"
      : "SELECT * FROM app_requests WHERE request_id = ?";
    const param = clientCode || requestId;

    const appRequest = await db.get(query, [param]);

    if (!appRequest) {
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    if (appRequest.status === "pending") {
      return res.json({
        success: true,
        request_id: appRequest.request_id,
        status: "pending"
      });
    }

    if (appRequest.status === "ok" && appRequest.xtream_id) {
      const xtream = await db.get(
        "SELECT host, username, password, validade FROM xtream_credentials WHERE id = ?",
        [appRequest.xtream_id]
      );
      if (!xtream) {
        return res.json({
          success: true,
          request_id: appRequest.request_id,
          status: "error",
          error: "Credenciais não encontradas"
        });
      }

      return res.json({
        success: true,
        request_id: appRequest.request_id,
        status: "ok",
        xtream: {
          host: xtream.host,
          username: xtream.username,
          password: xtream.password,
          validade: xtream.validade
        }
      });
    }

    return res.json({
      success: true,
      request_id: appRequest.request_id,
      status: appRequest.status || "unknown"
    });
  } catch (err) {
    console.error("Erro ao buscar app_request:", err);
    return res.status(500).json({ success: false, error: "DB error" });
  }
});

// =====================
// DEBUG: VER CREDENCIAIS EXTRAÍDAS
// =====================
app.get("/api/debug/xtream", requireAuth, async (req, res) => {
  try {
    const rows = await db.all(
      "SELECT id, request_id, whatsapp_number, host, username, password, validade, extracted_at FROM xtream_credentials ORDER BY id DESC LIMIT 50",
      []
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar xtream_credentials:", err);
    return res.status(500).json({ error: "Erro ao buscar dados" });
  }
});

app.get("/api/debug/requests", requireAuth, async (req, res) => {
  try {
    const rows = await db.all(
      "SELECT id, request_id, device_id, whatsapp_number, status, xtream_id, created_at, updated_at FROM app_requests ORDER BY id DESC LIMIT 50",
      []
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar app_requests:", err);
    return res.status(500).json({ error: "Erro ao buscar dados" });
  }
});

// =====================
// DNS TESTER — testa múltiplos servidores e cacheia o mais rápido
// =====================
const DNS_CANDIDATES = [
  'http://dnmxelk01apps.top',
  'http://akdemia.click',
  'http://167.114.4.164',
  'http://5.161.77.87'
];
const DNS_TEST_USER = '95375978';
const DNS_TEST_PASS = '97583485';
const DNS_TEST_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

let bestDns = null;
let bestDnsTestedAt = 0;

async function testDns(host) {
  return new Promise((resolve) => {
    const http = host.startsWith('https') ? require('https') : require('http');
    // Testa apenas conectividade — qualquer resposta HTTP indica que o servidor está online
    const url = `${host}/player_api.php?action=get_server_info`;
    const start = Date.now();
    const req = http.get(url, { timeout: 8000 }, (res) => {
      res.destroy();
      const ms = Date.now() - start;
      // Qualquer resposta (mesmo 401/403) indica servidor online
      const ok = res.statusCode > 0;
      resolve({ host, ms: ok ? ms : 99999, ok });
    });
    req.on('error', () => resolve({ host, ms: 99999, ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ host, ms: 99999, ok: false }); });
  });
}

async function refreshBestDns() {
  console.log('🔍 Testando DNS servers...');
  const results = await Promise.all(DNS_CANDIDATES.map(testDns));
  results.sort((a, b) => a.ms - b.ms);
  const winner = results.find(r => r.ok);
  if (winner) {
    bestDns = winner.host;
    bestDnsTestedAt = Date.now();
    console.log(`✅ Melhor DNS: ${bestDns} (${winner.ms}ms)`);
    results.forEach(r => console.log(`   ${r.ok ? '✓' : '✗'} ${r.host} — ${r.ms}ms`));
  } else {
    console.log('⚠️  Nenhum DNS respondeu. Mantendo anterior:', bestDns);
  }
}

// Testa ao iniciar (com delay para não bloquear boot)
setTimeout(refreshBestDns, 5000);
// Re-testa periodicamente
setInterval(refreshBestDns, DNS_TEST_INTERVAL_MS);

// =====================
// APP: STATUS BLUETV-XXXXX
// =====================
app.get('/app/status/bluetv/:clientId', async (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  if (apiKey !== config.APP_API_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid API key' });
  }

  try {
    const clientId = req.params.clientId.toUpperCase();
    console.log('Status check para:', clientId);

    const appRequest = await db.get(
      "SELECT * FROM app_requests WHERE client_code = ?",
      [clientId]
    );

    console.log('App request encontrado:', JSON.stringify(appRequest));

    if (!appRequest) {
      return res.json({ success: true, status: 'pending', message: 'Cliente não encontrado' });
    }

    if (appRequest.status === 'ok' && appRequest.xtream_id) {
      const xtream = await db.get(
        "SELECT host, username, password, validade, m3u_url, plano FROM xtream_credentials WHERE id = ?",
        [appRequest.xtream_id]
      );

      console.log('Xtream encontrado:', JSON.stringify(xtream));

      if (xtream) {
        // Usa sempre o host cadastrado no painel — DNS automático só para referência
        const resolvedHost = xtream.host;
        const resolvedUser = xtream.username;
        const resolvedPass = xtream.password;
        return res.json({
          success: true,
          status: 'ok',
          best_dns: bestDns || null,
          xtream: {
            host: resolvedHost,
            username: resolvedUser,
            password: resolvedPass,
            validade: appRequest.customer_validade || xtream.validade || null,
            m3u_url: xtream.m3u_url || `${resolvedHost}/get.php?username=${resolvedUser}&password=${resolvedPass}&type=m3u_plus&output=mpegts`,
            plano: xtream.plano
          }
        });
      }
    }

    return res.json({ 
      success: true, 
      status: appRequest.status || 'pending',
      xtream_id: appRequest.xtream_id,
      message: 'A processar...' 
    });

  } catch (err) {
    console.error('Erro status:', err);
    return res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

// =====================
// APP: REGISTER
// =====================
app.post('/app/register', requireApiKey, async (req, res) => {
  try {
    const { client_code, device_id } = req.body;
    
    if (!client_code || !client_code.startsWith('BLUETV-')) {
      return res.status(400).json({ success: false, error: 'Client ID inválido' });
    }
    
    const whatsappNumber = '5547997193147';
    const message = encodeURIComponent(
      'Olá bom dia! Sou cliente ID ' + client_code + ' e gostaria de um teste IPTV BlueTV 😊'
    );
    const whatsappLink = 'https://wa.me/' + whatsappNumber + '?text=' + message;
    
    // Verificar se já existe
    const existing = await db.get(
      "SELECT * FROM app_requests WHERE client_code = ?",
      [client_code]
    );
    
    if (existing) {
      return res.json({ 
        success: true, 
        client_code,
        whatsapp_link: whatsappLink,
        status: existing.status
      });
    }
    
    // Criar novo registo
    const requestId = crypto.randomUUID();
    const now = Date.now();
    
    await db.run(
      "INSERT INTO app_requests (request_id, client_code, device_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
      [requestId, client_code, device_id || 'unknown', now, now]
    );
    
    return res.json({ 
      success: true, 
      client_code,
      whatsapp_link: whatsappLink,
      status: 'pending'
    });
  } catch (err) {
    console.error('Erro register:', err);
    return res.status(500).json({ success: false, error: 'Erro interno' });
  }
});


// =====================
// START
// =====================
// FUTEBOL
// =====================

async function automaticSportsAgenda(date, draft) {
  const source = draft ?? await getAgendaForDate(date);
  const agenda = draft || source.length || date !== todayStr() ? source : _enrichedCache;
  return completeSerieA(date, agenda, getCache());
}

async function publishedSportsAgenda(date) {
  const manual = await readPublishedAgenda(db, date).catch(error => {
    console.error('Erro ao ler agenda esportiva publicada:', error.code || error.name);
    return null;
  });
  return manual === null ? automaticSportsAgenda(date) : completePublishedSerieA(date, manual);
}

registerSportsAdmin(app, db, requireAuth, requireApiKey, automaticSportsAgenda, todayStr, getAgendaDraft);

// Endpoint app: agenda esportiva de hoje (@EsportesNaTV)
app.get('/matches/today', requireApiKey, async (req, res) => {
  res.json(await publishedSportsAgenda(todayStr()));
});

// Endpoint app: agenda esportiva de amanhã
app.get('/matches/tomorrow', requireApiKey, async (req, res) => {
  res.json(await publishedSportsAgenda(tomorrowStr()));
});

app.get('/app/sports/calendar/:date', requireApiKey, async (req, res) => {
  if (!validDate(req.params.date)) return res.status(400).json({ error: 'Data inválida.' });
  res.set('Cache-Control', 'no-store').json(await publishedSportsAgenda(req.params.date));
});

app.get('/app/sports/standings', requireApiKey, async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await getStandings(todayStr().slice(0, 4)));
  } catch (error) {
    console.warn('Classificação da CBF indisponível:', error.message);
    res.status(503).json({ error: 'Classificação da Série A indisponível.' });
  }
});

// Admin: força sync manual da agenda
app.post('/admin/agenda-sync', requireAuth, async (req, res) => {
  const { date } = req.body;
  const target = date || todayStr();
  try {
    const result = await syncAgenda(target);
    if (!result) return res.status(502).json({ error: 'Não foi possível importar a programação para esta data. A agenda salva foi preservada.' });
    res.json({ ok: true, date: target, count: result.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin: visualiza agenda salva no banco
app.get('/admin/agenda', requireAuth, async (req, res) => {
  const date   = req.query.date || todayStr();
  const agenda = await getAgendaForDate(date);
  res.json({ date, count: agenda.length, matches: agenda });
});

// Admin: retorna mapeamento liga → canais atual
app.get('/admin/matches-config', requireAuth, async (req, res) => {
  try {
    const row = await db.get('SELECT channels, updated_at FROM football_config WHERE id = 1');
    const channels = row ? JSON.parse(row.channels) : [];
    res.json({ channels, updatedAt: row ? row.updated_at : null });
  } catch (e) {
    res.status(500).json({ error: 'erro ao ler config' });
  }
});

// Admin: salva mapeamento liga → canais
app.post('/admin/matches-config', requireAuth, async (req, res) => {
  try {
    const { channels } = req.body;
    if (!Array.isArray(channels)) return res.status(400).json({ error: 'channels deve ser array' });
    await db.run(
      'INSERT OR REPLACE INTO football_config (id, channels, updated_at) VALUES (1, ?, ?)',
      [JSON.stringify(channels), Date.now()]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'erro ao salvar config' });
  }
});

// Admin: força sync manual com a API-Football + re-enriquece EPG
app.post('/admin/matches-sync', requireAuth, async (req, res) => {
  try {
    await syncAndSave();
    await enrichCache();
    res.json({ ok: true, count: _enrichedCache.length, date: getCacheDate() });
  } catch (e) {
    res.status(500).json({ error: 'erro no sync' });
  }
});

// Admin: força sync manual dos canais Xtream
app.post('/admin/xtream-sync', requireAuth, async (req, res) => {
  try {
    await syncXtream();
    res.json({ ok: true, ready: xtreamReady(), syncedAt: getSyncedAt() });
  } catch (e) {
    res.status(500).json({ error: 'erro no sync Xtream' });
  }
});

// Admin: retorna status do Xtream
app.get('/admin/xtream-status', requireAuth, async (req, res) => {
  const { getAllNames } = require('./services/xtream');
  res.json({
    ready: xtreamReady(),
    channelCount: getAllNames().length,
    syncedAt: getSyncedAt()
  });
});

// Admin: retorna jogos enriquecidos para visualização
app.get('/admin/matches-today', requireAuth, (req, res) => {
  res.json({ date: getCacheDate(), count: _enrichedCache.length, matches: _enrichedCache });
});

// =====================
// HEALTH CHECK
// =====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function phoneFromWhatsappJid(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{7,15})(?::\d+)?@(s\.whatsapp\.net|c\.us)$/i);
  return match ? match[1] : null;
}

function phoneFromExplicitField(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\+/, '');
  return /^\d{7,15}$/.test(normalized) ? normalized : null;
}

function normalizeEvolutionSenderJid(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+)(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/i);
  return match ? `${match[1]}@${match[2].toLowerCase()}` : null;
}

function legacyLidDigits(jid) {
  return typeof jid === 'string' ? /^(\d+)@lid$/i.exec(jid)?.[1] || null : null;
}

function extractEvolutionSenderJid(key, data, body) {
  const remoteJid = key.remoteJid || data.remoteJid || body.remoteJid;
  const isGroup = typeof remoteJid === 'string' && remoteJid.endsWith('@g.us');
  const candidates = isGroup
    ? [key.participant, key.participantAlt, data.participant, data.participantAlt]
    : [remoteJid, key.remoteJidAlt, key.participant, key.participantAlt,
      data.remoteJid, data.remoteJidAlt, data.participant, data.participantAlt,
      body.remoteJid, body.remoteJidAlt];
  for (const candidate of candidates) {
    const jid = normalizeEvolutionSenderJid(candidate);
    if (jid) return jid;
  }
  return null;
}

function extractEvolutionSenderPhone(key, data, body) {
  const jidCandidates = [
    key.remoteJid,
    key.remoteJidAlt,
    key.senderPn,
    key.sender_pn,
    key.participantAlt,
    key.participantPn,
    key.participant_pn,
    key.participant,
    data.remoteJid,
    data.remoteJidAlt,
    data.senderPn,
    data.sender_pn,
    data.participantAlt,
    data.participantPn,
    data.participant_pn,
    data.participant,
    body.remoteJid,
    body.remoteJidAlt,
    body.senderPn,
    body.sender_pn,
    body.participantAlt,
    body.participantPn,
    body.participant_pn
  ];
  for (const candidate of jidCandidates) {
    const phone = phoneFromWhatsappJid(candidate);
    if (phone) return phone;
  }

  const explicitCandidates = [
    key.senderPhone,
    data.senderPhone,
    data.phoneNumber,
    data.phone,
    body.senderPhone,
    body.phoneNumber,
    body.phone
  ];
  for (const candidate of explicitCandidates) {
    const phone = phoneFromExplicitField(candidate);
    if (phone) return phone;
  }
  return null;
}

app.post('/webhook/botbot', async (req, res) => {
  try {
    const body = req.body;
    console.log('📨 BotBot webhook recebido:', JSON.stringify(body));

    // Dados que chegam do BotBot
    const senderPhone = body.senderPhone || body.devicePhone || null;
    const senderMessage = body.senderMessage || '';
    
    // Extrair Client ID da mensagem do cliente (BLUETV-XXXXX)
    const clientIdMatch = senderMessage.match(/BLUETV-([A-Z0-9]{5})/i);
    const clientId = clientIdMatch ? clientIdMatch[0].toUpperCase() : null;

    // Dados Xtream que chegam directamente do BotBot via tags Megga
    const host = body.dns || null;
    const username = body.username || null;
    const password = body.password || null;
    const validade = body.expiresAtFormatted || body.expiresAt || null;
    const plano = body.package || null;
    const m3uUrl = host && username && password
      ? `${host}/get.php?username=${username}&password=${password}&type=m3u_plus&output=mpegts`
      : null;

    // Se tiver credenciais Xtream — guardar directamente
    if (host && username && password) {
      const now = Date.now();
      
      // Guardar credenciais
      const insertResult = await db.run(
        `INSERT INTO xtream_credentials 
         (request_id, client_id, whatsapp_number, host, username, password, 
          validade, m3u_url, raw_message, extracted_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted')`,
        [
          require('crypto').randomUUID(),
          clientId,
          senderPhone,
          host,
          username,
          password,
          validade,
          m3uUrl,
          JSON.stringify(body),
          now
        ]
      );

      // Vincular ao app_request pelo client_code
      if (clientId) {
        const appRequest = await db.get(
          "SELECT * FROM app_requests WHERE client_code = ?",
          [clientId]
        );
        
        if (appRequest) {
          await db.run(
            "UPDATE app_requests SET status = CASE WHEN status = 'inativo' THEN status ELSE 'ok' END, xtream_id = ?, whatsapp_number = ?, updated_at = ? WHERE client_code = ?",
            [insertResult.lastInsertRowid || insertResult.lastID, senderPhone, now, clientId]
          );
          console.log(`✅ Cliente ${clientId} activado com sucesso!`);
        } else {
          // Criar request se não existir (cliente usou WhatsApp manual)
          await db.run(
            `INSERT OR IGNORE INTO app_requests 
             (request_id, client_code, device_id, whatsapp_number, status, xtream_id, created_at, updated_at)
             VALUES (?, ?, 'whatsapp', ?, 'ok', ?, ?, ?)`,
            [
              require('crypto').randomUUID(),
              clientId || senderPhone,
              senderPhone,
              insertResult.lastInsertRowid || insertResult.lastID,
              now,
              now
            ]
          );
        }
      } else {
        // Sem Client ID — guardar pelo número de telefone
        await db.run(
          `INSERT OR IGNORE INTO app_requests 
           (request_id, client_code, device_id, whatsapp_number, status, xtream_id, created_at, updated_at)
           VALUES (?, ?, 'whatsapp', ?, 'ok', ?, ?, ?)`,
          [
            require('crypto').randomUUID(),
            senderPhone,
            senderPhone,
            insertResult.lastInsertRowid || insertResult.lastID,
            now,
            now
          ]
        );
      }

      return res.json({ success: true, message: 'Credenciais guardadas', clientId, senderPhone });
    }

    // Se não tiver credenciais — apenas registar a mensagem
    if (senderPhone) {
      await db.run(
        "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
        [senderPhone, senderMessage, Date.now()]
      );
    }

    return res.json({ success: true, message: 'Mensagem registada' });

  } catch (err) {
    console.error('❌ Erro webhook botbot:', err);
    return res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

// Heartbeat — APK envia a cada 30s para dizer que está online
app.post('/app/heartbeat', requireApiKey, async (req, res) => {
  try {
    const { client_code, device_model, apk_version, current_channel, watching } = req.body;
    const channel = typeof current_channel === 'string' ? current_channel.trim().slice(0, 200) : null;
    if (!client_code) return res.status(400).json({ success: false });

    const now = Date.now();
    await db.run(
      `UPDATE app_requests SET 
        is_online = 1,
        last_seen = ?,
        device_model = COALESCE(?, device_model),
        apk_version = COALESCE(?, apk_version),
        current_channel = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, current_channel) END,
        updated_at = ?
       WHERE client_code = ? AND status <> 'inativo'`,
      [now, device_model || null, apk_version || null, watching === false ? 1 : 0, channel || null, now, client_code.toUpperCase()]
    );

    return res.json({ success: true, timestamp: now });
  } catch (err) {
    console.error('Erro heartbeat:', err);
    return res.status(500).json({ success: false });
  }
});

// Offline — APK envia quando fecha
app.post('/app/offline', requireApiKey, async (req, res) => {
  try {
    const { client_code } = req.body;
    if (!client_code) return res.status(400).json({ success: false });
    const now = Date.now();
    await db.run(
      "UPDATE app_requests SET is_online = 0, last_seen = ?, updated_at = ? WHERE client_code = ?",
      [now, now, client_code.toUpperCase()]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

// Endpoint público de teste SEM autenticação para debug
app.get('/app/status/debug/:clientId', async (req, res) => {
  try {
    const clientId = req.params.clientId.toUpperCase();
    const appRequest = await db.get(
      "SELECT * FROM app_requests WHERE client_code = ?",
      [clientId]
    );
    if (!appRequest) return res.json({ found: false, clientId });
    
    const xtream = appRequest.xtream_id ? await db.get(
      "SELECT * FROM xtream_credentials WHERE id = ?",
      [appRequest.xtream_id]
    ) : null;

    return res.json({ 
      found: true, 
      clientId,
      status: appRequest.status,
      xtream_id: appRequest.xtream_id,
      whatsapp: appRequest.whatsapp_number,
      xtream: xtream ? { host: xtream.host, username: xtream.username } : null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint admin — lista clientes com dados completos
app.get('/api/debug/clients', requireAuth, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT 
        ar.id,
        ar.client_code,
        ar.whatsapp_number,
        ar.status,
        ar.device_model,
        ar.apk_version,
        ar.last_seen,
        ar.current_channel,
        ar.is_online,
        ar.created_at,
        ar.updated_at,
        ar.xtream_id,
        xc.host,
        xc.username,
        xc.password,
        xc.validade,
        xc.m3u_url,
        xc.plano
      FROM app_requests ar
      LEFT JOIN xtream_credentials xc ON ar.xtream_id = xc.id
      ORDER BY ar.updated_at DESC
    `);
    console.log('Debug clients:', rows.length, 'registos');
    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error('Erro /api/debug/clients:', err);
    return res.status(500).json([]);
  }
});

// =====================
// ATIVAÇÃO MANUAL — cria credenciais e ativa um client_code
// POST /app/activate-manual
// Body: { client_code, host, username, password, validade?, api_key }
// Uso: ativar clientes manualmente pelo painel (sem passar pelo WhatsApp)
// =====================
app.post('/app/activate-manual', requireAuth, async (req, res) => {
  try {
    const { client_code, host, username, password, validade, xtream_id } = req.body;
    if (!client_code) {
      return res.status(400).json({ success: false, error: 'client_code obrigatório' });
    }

    const appRequest = await db.get(
      "SELECT * FROM app_requests WHERE client_code = ?",
      [client_code.toUpperCase()]
    );
    if (!appRequest) {
      return res.status(404).json({ success: false, error: 'Client não encontrado: ' + client_code });
    }

    const now = Date.now();
    let finalXtreamId = xtream_id || null;

    // Se passaram host/username/password, criar nova credencial
    if (host && username && password) {
      const m3uUrl = `${host}/get.php?username=${username}&password=${password}&type=m3u`;
      const insertResult = await db.run(
        `INSERT INTO xtream_credentials
         (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at, status, plano)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'extracted', 'manual')`,
        [
          require('crypto').randomUUID(),
          client_code.toUpperCase(),
          appRequest.whatsapp_number || '',
          host.trim(),
          username.trim(),
          password.trim(),
          validade || null,
          m3uUrl,
          now
        ]
      );
      finalXtreamId = Number(insertResult.lastInsertRowid || insertResult.lastID);
    }

    if (!finalXtreamId) {
      return res.status(400).json({ success: false, error: 'Informe host, username e password ou um xtream_id válido' });
    }

    await db.run(
      "UPDATE app_requests SET status = CASE WHEN status = 'inativo' THEN status ELSE 'ok' END, xtream_id = ?, updated_at = ? WHERE client_code = ?",
      [finalXtreamId, now, client_code.toUpperCase()]
    );

    console.log(`✅ Ativação manual: ${client_code.toUpperCase()} → xtream_id=${finalXtreamId}`);
    return res.json({ success: true, client_code: client_code.toUpperCase(), xtream_id: finalXtreamId });
  } catch (err) {
    console.error('Erro /app/activate-manual:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =====================
// EDITAR CREDENCIAIS — atualiza host/user/pass de cliente já ativo
// POST /app/edit-credentials
// Body: { client_code, host, username, password, validade?, api_key }
// Uso: trocar DNS ou credenciais de cliente ativo pelo painel
// =====================
app.post('/app/edit-credentials', requireAuth, async (req, res) => {
  try {
    const { client_code, host, username, password, validade } = req.body;
    if (!client_code || !host || !username || !password) {
      return res.status(400).json({ success: false, error: 'client_code, host, username e password obrigatórios' });
    }

    const appRequest = await db.get(
      "SELECT * FROM app_requests WHERE client_code = ?",
      [client_code.toUpperCase()]
    );
    if (!appRequest) {
      return res.status(404).json({ success: false, error: 'Client não encontrado' });
    }

    const now = Date.now();
    const m3uUrl = `${host}/get.php?username=${username}&password=${password}&type=m3u`;

    if (appRequest.xtream_id) {
      // Atualizar credencial existente
      await db.run(
        `UPDATE xtream_credentials SET host = ?, username = ?, password = ?, validade = ?, m3u_url = ?, extracted_at = ?
         WHERE id = ?`,
        [host.trim(), username.trim(), password.trim(), validade || null, m3uUrl, now, appRequest.xtream_id]
      );
      await db.run(
        "UPDATE app_requests SET updated_at = ? WHERE client_code = ?",
        [now, client_code.toUpperCase()]
      );
      console.log(`✏️ Credenciais editadas: ${client_code.toUpperCase()} → ${host}`);
      return res.json({ success: true, client_code: client_code.toUpperCase(), xtream_id: appRequest.xtream_id });
    } else {
      // Cliente sem credencial ainda — criar e ativar
      const insertResult = await db.run(
        `INSERT INTO xtream_credentials
         (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at, status, plano)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual-edit', ?, 'extracted', 'manual')`,
        [
          require('crypto').randomUUID(),
          client_code.toUpperCase(),
          appRequest.whatsapp_number || '',
          host.trim(), username.trim(), password.trim(),
          validade || null, m3uUrl, now
        ]
      );
      const newId = Number(insertResult.lastInsertRowid || insertResult.lastID);
      await db.run(
        "UPDATE app_requests SET status = CASE WHEN status = 'inativo' THEN status ELSE 'ok' END, xtream_id = ?, updated_at = ? WHERE client_code = ?",
        [newId, now, client_code.toUpperCase()]
      );
      return res.json({ success: true, client_code: client_code.toUpperCase(), xtream_id: newId });
    }
  } catch (err) {
    console.error('Erro /app/edit-credentials:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =====================
// DNS STATUS (debug)
// =====================
app.get('/app/dns-status', requireApiKey, async (req, res) => {
  const results = await Promise.all(DNS_CANDIDATES.map(testDns));
  results.sort((a, b) => a.ms - b.ms);
  res.json({
    best: bestDns,
    tested_at: bestDnsTestedAt,
    results: results.map(r => ({ host: r.host, ms: r.ms, ok: r.ok }))
  });
});

// =====================
// DNS FORCE REFRESH (admin)
// =====================
app.post('/app/dns-refresh', requireApiKey, async (req, res) => {
  await refreshBestDns();
  res.json({ success: true, best: bestDns, tested_at: bestDnsTestedAt });
});

// Start server
const server = app.listen(PORT, () => {
  console.log("🚀 Backend rodando na porta " + PORT);
  console.log("🔐 APP_API_KEY configurada:", Boolean(config.APP_API_KEY));
  console.log("📞 Número do Painel IPTV:", config.IPTV_PANEL_NUMBER || "(não configurado)");

  // Auto-ping a cada 4 minutos para evitar que o Render durma
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  setInterval(() => {
    const http = SELF_URL.startsWith('https') ? require('https') : require('http');
    http.get(`${SELF_URL}/health`, (res) => {
      console.log(`♻️  Keep-alive ping: ${res.statusCode}`);
    }).on('error', () => {});
  }, 4 * 60 * 1000); // 4 minutos
});

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
db.initDb().catch(err => console.error('Erro ao inicializar DB:', err));
const config = require("./config");
const { isXtreamResponse, parseXtreamMessage, extractM3uUrl, parseAtivarTesteCommand } = require("./parser");

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
app.get("/api/debug/botbot", async (req, res) => {
  try {
    const rows = await db.all("SELECT id, phone, message, received_at FROM botbot_messages ORDER BY id DESC", []);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar botbot_messages:", err);
    return res.status(500).json({ error: "Erro ao buscar dados" });
  }
});
// =====================
// API: LISTAR CLIENTES (DO BANCO)
// =====================
app.get("/api/clients", async (req, res) => {
  try {
    const rows = await db.all("SELECT id, whatsapp_number, status, criado_em FROM clients ORDER BY id DESC", []);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar clients:", err);
    return res.status(500).json({ error: "Erro ao buscar clients" });
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
app.post("/webhook/evolution", async (req, res) => {
  try {
    let phone = null;
    let message = null;
    let formato = "desconhecido";

    if (req.body?.senderPhone && req.body?.senderMessage) {
      phone = (req.body.senderPhone || "").replace(/\D+/g, "");
      message = req.body.senderMessage;
      formato = "BotBot Resposta";
    } else if (req.body?.phone && req.body?.text) {
      phone = (req.body.phone || "").replace(/\D+/g, "");
      message = typeof req.body.text === 'object' 
        ? (req.body.text.message || req.body.text.text || JSON.stringify(req.body.text))
        : req.body.text;
      formato = "BotBot Padrão";
    } else if (req.body?.data?.key?.remoteJid) {
      phone = req.body.data.key.remoteJid.replace("@s.whatsapp.net", "").replace(/\D+/g, "");
      message = req.body.data.message?.conversation
        || req.body.data.message?.extendedTextMessage?.text
        || null;
      formato = "Evolution API";
    } else if (req.body?.from || (req.body?.phone && !req.body?.text)) {
      phone = (req.body.from || req.body.phone || "").replace(/\D+/g, "");
      let rawMsg = req.body.message || req.body.text || req.body.body || null;
      message = (rawMsg && typeof rawMsg === 'object')
        ? (rawMsg.conversation || rawMsg.extendedTextMessage?.text || rawMsg.message || rawMsg.text || JSON.stringify(rawMsg))
        : rawMsg;
      formato = "Evolution Alternativo";
    } else if (Array.isArray(req.body?.messages) && req.body.messages.length > 0) {
      const m = req.body.messages[0];
      phone = (m.from || m.phone || m.key?.remoteJid || "").replace(/\D+/g, "").replace("@s.whatsapp.net", "");
      let rawMsg = m.message || m.text || m.body || null;
      message = (rawMsg && typeof rawMsg === 'object')
        ? (rawMsg.conversation || rawMsg.extendedTextMessage?.text || rawMsg.message || rawMsg.text || JSON.stringify(rawMsg))
        : rawMsg;
      formato = "Evolution Array";
    }

    if (message && typeof message === 'object') {
      message = message.conversation || message.extendedTextMessage?.text || message.message || message.text || JSON.stringify(message);
    }

    if (!phone || !message) {
      return res.json({ success: true, ignored: true, reason: "missing_data" });
    }

    const receivedAt = Date.now();
    const xtreamResult = isXtreamResponse(message) ? parseXtreamMessage(message) : null;
    
    if (xtreamResult && xtreamResult.success) {
      const result = await db.run(
        `INSERT INTO xtream_credentials 
         (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [null, null, phone, xtreamResult.host, xtreamResult.username, 
         xtreamResult.password, xtreamResult.validade, xtreamResult.m3u_url, 
         message, Date.now()]
      );
      
      const xtreamId = result.lastInsertRowid;
      await db.run(
        "UPDATE app_requests SET status='ok', xtream_id=?, updated_at=? WHERE whatsapp_number=? AND status='pending'",
        [xtreamId, Date.now(), phone]
      );
      
      return res.json({ success: true, command: 'xtream_auto', extracted: true });
    }

    const ativarResult = parseAtivarTesteCommand(message);
    if (ativarResult.success) {
      const { login, senha } = ativarResult;
      const dnsFixo = config.XTREAM_DNS_FIXO;

      const appRequest = await db.get(
        "SELECT * FROM app_requests WHERE whatsapp_number = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [phone]
      );

      const requestId = appRequest?.request_id || null;
      const clientCode = appRequest?.client_code || null;

      const insertResult = await db.run(
        `INSERT INTO xtream_credentials 
         (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [requestId, clientCode, phone, dnsFixo, login, senha, null, null, message, receivedAt]
      );

      const xtreamId = insertResult.lastInsertRowid;

      if (appRequest) {
        await db.run(
          "UPDATE app_requests SET status = 'ok', xtream_id = ?, updated_at = ? WHERE request_id = ?",
          [xtreamId, Date.now(), requestId]
        );
      } else {
        const newRequestId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
        const newClientCode = generateClientCode();
        await db.run(
          "INSERT INTO app_requests (request_id, client_code, device_id, whatsapp_number, status, xtream_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'ok', ?, ?, ?)",
          [newRequestId, newClientCode, 'ativar_teste_' + phone, phone, xtreamId, receivedAt, receivedAt]
        );
      }

      return res.json({ success: true, command: "ATIVAR_TESTE" });
    }

    const clientCodeMatch = message.match(/cliente\s+([A-Z0-9]{6})/i);
    if (clientCodeMatch) {
      const clientCode = clientCodeMatch[1].toUpperCase();
      await db.run(
        "UPDATE app_requests SET whatsapp_number = ?, updated_at = ? WHERE client_code = ? AND status = 'pending'",
        [phone, Date.now(), clientCode]
      );
      return res.json({ success: true, command: "client_code" });
    }

    return res.json({ success: true, ignored: true });
  } catch (err) {
    console.error("[WEBHOOK] ❌ Erro crítico:", err);
    return res.json({ success: true, error: "internal_error" });
  }
});

// =====================
// APP: INICIAR REQUEST DE TESTE
// POST /app/request
// - Recebe device_id do app
// - Gera client_code legível (6 caracteres)
// - Retorna client_code e link do WhatsApp
// =====================

// Função para gerar código legível (6 caracteres alfanuméricos maiúsculos)
function generateClientCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem 0, O, I, 1 para evitar confusão
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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
// START
// =====================
// HEALTH CHECK
// =====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const server = app.listen(PORT, () => {
  console.log("🚀 Backend rodando na porta " + PORT);
  console.log("📱 API Key do App:", config.APP_API_KEY);
  console.log("📞 Número do Painel IPTV:", config.IPTV_PANEL_NUMBER || "(não configurado)");
});

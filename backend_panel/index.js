const express = require("express");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
db.initDb().catch(err => console.error('Erro ao inicializar DB:', err));
const config = require("./config");
const { isXtreamResponse, parseXtreamMessage, extractM3uUrl, 
        parseAtivarTesteCommand, parseClientIdFromMessage } = require('./parser');

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
app.post('/webhook/evolution', async (req, res) => {
  try {
    const body = req.body;
    console.log('📨 Evolution webhook recebido');

    // Extrair dados da mensagem conforme formato Evolution API
    const data = body.data || body;
    const messageData = data.message || data.messages?.[0] || {};
    const key = data.key || messageData.key || {};
    
    // Número de quem enviou
    const remoteJid = key.remoteJid || data.remoteJid || '';
    const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    
    // Conteúdo da mensagem
    const message = messageData.conversation 
      || messageData.extendedTextMessage?.text 
      || data.text
      || body.text
      || body.message
      || '';

    if (!message || !senderPhone) {
      return res.json({ success: true, message: 'Sem conteúdo' });
    }

    console.log(`📞 De: ${senderPhone}`);
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
        await db.run(
          "UPDATE app_requests SET whatsapp_number = ?, updated_at = ? WHERE client_code = ?",
          [senderPhone, now, clientId]
        );
      } else {
        await db.run(
          `INSERT INTO app_requests 
           (request_id, client_code, device_id, whatsapp_number, status, created_at, updated_at)
           VALUES (?, ?, 'evolution', ?, 'pending', ?, ?)`,
          [require('crypto').randomUUID(), clientId, senderPhone, now, now]
        );
      }

      // Guardar mensagem no log
      await db.run(
        "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
        [senderPhone, message, now]
      ).catch(() => {});

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
      const appRequest = await db.get(
        "SELECT * FROM app_requests WHERE whatsapp_number = ? ORDER BY created_at DESC LIMIT 1",
        [senderPhone]
      );

      const clientId = appRequest?.client_code || null;
      console.log(`🔗 Vinculando credenciais ao Client ID: ${clientId}`);

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
          parsed.host,
          parsed.username,
          parsed.password,
          parsed.validade,
          parsed.m3u_url,
          message,
          now
        ]
      );

      const xtreamId = insertResult.lastInsertRowid || insertResult.lastID;

      // Activar o cliente
      if (appRequest) {
        await db.run(
          "UPDATE app_requests SET status = 'ok', xtream_id = ?, updated_at = ? WHERE client_code = ?",
          [xtreamId, now, appRequest.client_code]
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
// APP: STATUS BLUETV-XXXXX
// =====================
app.get('/app/status/bluetv/:clientId', requireApiKey, async (req, res) => {
  try {
    const clientId = req.params.clientId.toUpperCase();
    
    // Buscar request pelo client_code
    const appRequest = await db.get(
      "SELECT * FROM app_requests WHERE client_code = ?",
      [clientId]
    );
    
    if (!appRequest) {
      return res.json({ success: true, status: 'pending', message: 'Aguardando activação' });
    }
    
    if (appRequest.status === 'ok' && appRequest.xtream_id) {
      const xtream = await db.get(
        "SELECT host, username, password, validade, m3u_url, plano FROM xtream_credentials WHERE id = ?",
        [appRequest.xtream_id]
      );
      
      if (xtream) {
        return res.json({
          success: true,
          status: 'ok',
          xtream: {
            host: xtream.host,
            username: xtream.username,
            password: xtream.password,
            validade: xtream.validade,
            m3u_url: xtream.m3u_url,
            plano: xtream.plano
          }
        });
      }
    }
    
    return res.json({ success: true, status: 'pending', message: 'A processar...' });
  } catch (err) {
    console.error('Erro status bluetv:', err);
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
// HEALTH CHECK
// =====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
            "UPDATE app_requests SET status = 'ok', xtream_id = ?, whatsapp_number = ?, updated_at = ? WHERE client_code = ?",
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
    const { client_code, device_model, apk_version, current_channel } = req.body;
    if (!client_code) return res.status(400).json({ success: false });

    const now = Date.now();
    await db.run(
      `UPDATE app_requests SET 
        is_online = 1,
        last_seen = ?,
        device_model = COALESCE(?, device_model),
        apk_version = COALESCE(?, apk_version),
        current_channel = COALESCE(?, current_channel),
        updated_at = ?
       WHERE client_code = ?`,
      [now, device_model || null, apk_version || null, current_channel || null, now, client_code.toUpperCase()]
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

// Endpoint admin — lista clientes com dados completos
app.get('/api/debug/clients', requireAuth, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT 
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
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log("🚀 Backend rodando na porta " + PORT);
  console.log("📱 API Key do App:", config.APP_API_KEY);
  console.log("📞 Número do Painel IPTV:", config.IPTV_PANEL_NUMBER || "(não configurado)");
});

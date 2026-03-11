const express = require("express");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
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
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (!sid) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }

  db.get(
    "SELECT * FROM sessions WHERE token = ?",
    [sid],
    (err, sessionRow) => {
      if (err) {
        console.error("Erro ao verificar sessão:", err.message);
        return res.status(500).json({ success: false, error: "DB error" });
      }
      if (!sessionRow) {
        return res.status(401).json({ success: false, error: "Invalid session" });
      }

      const now = Date.now();
      if (now - sessionRow.last_activity > INACTIVITY_TIMEOUT) {
        // Sessão expirada: remover do DB
        db.run("DELETE FROM sessions WHERE token = ?", [sid], () => {
          // ignore errors on delete
          return res.status(401).json({ success: false, error: "Session expired" });
        });
        return;
      }

      // Atualiza last_activity para agora
      db.run(
        "UPDATE sessions SET last_activity = ? WHERE token = ?",
        [now, sid],
        (updateErr) => {
          if (updateErr) {
            console.error("Erro ao atualizar last_activity:", updateErr.message);
            // Não bloqueia o usuário por erro de logging; tenta seguir
          }
          // Anexa info da sessão ao req e segue
          req.session = { user_id: sessionRow.user_id, token: sid };
          next();
        }
      );
    }
  );
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
app.post("/api/login", (req, res) => {
  const username = req.body?.username;
  const password = req.body?.password;

  if (!username || !password) {
    return res.json({ success: false });
  }

  db.get(
    "SELECT * FROM users WHERE username = ? AND password = ?",
    [username, password],
    (err, row) => {
      if (err) {
        console.error("Erro no login:", err.message);
        return res.status(500).json({ success: false });
      }
      if (!row) {
        return res.json({ success: false });
      }

      // Usuário autenticado: criar sessão persistente no DB
      function createSessionAndRespond() {
        const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(32).toString("hex");
        const now = Date.now();
        db.run(
          "INSERT INTO sessions (token, user_id, last_activity) VALUES (?, ?, ?)",
          [token, row.id, now],
          function (insertErr) {
            if (insertErr) {
              console.error("Erro ao criar sessão:", insertErr.message);
              // Mesmo se houver erro em criar sessão, retornamos success:true para manter API compatível.
              return res.json({ success: true });
            }

            const cookieParts = [`sid=${token}`, "HttpOnly", "Path=/", "SameSite=Lax"];
            // Em ambiente de produção/HTTPS, recomenda-se adicionar 'Secure'
            // cookieParts.push('Secure');
            res.setHeader("Set-Cookie", cookieParts.join("; "));
            return res.json({ success: true });
          }
        );
      }

      // Tenta criar sessão e responder
      createSessionAndRespond();
    }
  );
});

// =====================
// API para inicialização do app Android
// POST /api/init
// Gera client_id único, salva em tabela clients e retorna client_id e whatsapp_link
// Aceita opcionalmente whatsapp_number no body para associar ao client (prioridade)
// Compatível com Express + SQLite
app.post("/api/init", (req, res) => {
  const providedNumber = req.body?.whatsapp_number || null;
  // gerar client_id (UUID)
  const clientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const status = req.body?.status || "pending";

  db.run(
    "INSERT INTO clients (client_id, criado_em, whatsapp_number, status) VALUES (?, ?, ?, ?)",
    [clientId, now, providedNumber, status],
    function (err) {
      if (err) {
        // Se houver conflito por client_id (extremamente improvável), retornar erro 500
        console.error("Erro ao criar client:", err.message);
        return res.status(500).json({ success: false, error: "Erro ao criar client" });
      }

      // Construir o link wa.me dinamicamente e retornar junto com client_id
      // Número usado (prioridade): providedNumber -> env WHATSAPP_NUMBER -> fallback
      let number = providedNumber || process.env.WHATSAPP_NUMBER || "5511999999999";
      number = String(number).replace(/\D+/g, "");

      // Se após normalização o número ficou vazio, usamos o fallback
      if (!number) {
        number = "5511999999999";
      }

      const message = `Oi, quero teste 4h. ID:${clientId}`;
      const encoded = encodeURIComponent(message);
      const whatsapp_link = `https://wa.me/${number}?text=${encoded}`;

      return res.json({ client_id: clientId, whatsapp_link });
    }
  );
});

// =====================
// GET /api/whatsapp-link
// Retorna link wa.me com número configurável e mensagem automática contendo o client_id
// Query params:
//   client_id (obrigatório) - identifica o client
//   number (opcional) - sobrescreve o número do cliente / default
// Exemplo de mensagem: "Oi, quero teste 4h. ID:{client_id}"
// =====================
app.get("/api/whatsapp-link", (req, res) => {
  const clientId = req.query.client_id;
  const overrideNumber = req.query.number || null;

  if (!clientId) {
    return res.status(400).json({ error: "client_id is required" });
  }

  db.get("SELECT * FROM clients WHERE client_id = ?", [clientId], (err, clientRow) => {
    if (err) {
      console.error("Erro ao buscar client:", err.message);
      return res.status(500).json({ error: "DB error" });
    }
    if (!clientRow) {
      return res.status(404).json({ error: "client_id não encontrado" });
    }

    // Decide número: prioridade override -> client.whatsapp_number -> env WHATSAPP_NUMBER -> fallback
    let number = overrideNumber || clientRow.whatsapp_number || process.env.WHATSAPP_NUMBER || "5511999999999";

    // Normaliza: remove tudo que não seja dígito
    number = String(number).replace(/\D+/g, "");
    if (!number) {
      return res.status(400).json({ error: "Número inválido" });
    }

    const message = `Oi, quero teste 4h. ID:${clientId}`;
    const encoded = encodeURIComponent(message);
    const link = `https://wa.me/${number}?text=${encoded}`;

    return res.json({ link });
  });
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
  console.log("botbot webhook called", { body: req.body });

  // Normalizar phone (pode vir como from, phone, sender)
  let phone = req.body?.from || req.body?.phone || req.body?.sender || null;
  // Normalizar message (pode vir como message, text, body)
  let message = req.body?.message || req.body?.text || req.body?.body || null;

  // Fallback: se houver array messages, tente extrair do primeiro item
  if ((!phone || !message) && Array.isArray(req.body?.messages) && req.body.messages.length > 0) {
    const m = req.body.messages[0];
    phone = phone || m.from || m.phone || m.sender || null;
    message = message || m.body || m.text || m.message || null;
  }

  // Normalização final: remover caracteres não numéricos do phone
  phone = phone ? String(phone).replace(/\D+/g, "") : null;
  message = message ? String(message) : null;

  const receivedAt = Date.now();

  try {
    // Salvar a mensagem do botbot na tabela botbot_messages
    db.run(
      "INSERT INTO botbot_messages (phone, message, received_at) VALUES (?, ?, ?)",
      [phone, message, receivedAt],
      (err) => {
        if (err) {
          console.error("Erro ao salvar botbot_messages:", err.message);
          // não interrompe o fluxo por causa deste erro, apenas logamos
        } else {
          console.log("botbot_message salvo", { phone, receivedAt });
        }
      }
    );

    // Se houver phone, garantir que exista um client vinculado ou criar um novo
    if (phone) {
      db.get("SELECT * FROM clients WHERE whatsapp_number = ?", [phone], (err, clientRow) => {
        if (err) {
          console.error("Erro ao consultar client por phone:", err.message);
          return;
        }

        if (clientRow) {
          // Atualiza status do client para recebido_botbot
          db.run("UPDATE clients SET status = ? WHERE id = ?", ["recebido_botbot", clientRow.id], (uErr) => {
            if (uErr) console.error("Erro ao atualizar client status:", uErr.message);
            else console.log("Client status atualizado para recebido_botbot", { client_id: clientRow.client_id, phone });
          });
        } else {
          // Cria novo client e marca status recebido_botbot
          const newClientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
          const now = Date.now();
          db.run(
            "INSERT INTO clients (client_id, criado_em, whatsapp_number, status) VALUES (?, ?, ?, ?)",
            [newClientId, now, phone, "recebido_botbot"],
            function (iErr) {
              if (iErr) {
                console.error("Erro ao criar client a partir do botbot:", iErr.message);
              } else {
                console.log("Novo client criado a partir do botbot", { client_id: newClientId, phone });
              }
            }
          );
        }
      });
    }
  } catch (err) {
    console.error("Erro processando webhook botbot:", err);
    // continuamos para retornar sucesso para o bot (evita retries excessivos)
  }

  // Resposta simples para o botbot
  return res.json({ success: true });
});

// =====================
// ROTA PARA MARCAR CLIENT COMO ATIVO (após verificação por WhatsApp)
// POST /api/clients/:client_id/activate
// Protegida por requireAuth (apenas admin pode ativar). Aceita whatsapp_number opcional no body.
// Define status='active' e atualiza whatsapp_number se fornecido.
// =====================
app.post("/api/clients/:client_id/activate", requireAuth, (req, res) => {
  const clientId = req.params.client_id;
  const providedNumber = req.body?.whatsapp_number || null;

  db.get("SELECT * FROM clients WHERE client_id = ?", [clientId], (err, clientRow) => {
    if (err) {
      console.error("Erro ao buscar client:", err.message);
      return res.status(500).json({ success: false });
    }
    if (!clientRow) {
      return res.status(404).json({ success: false, error: "client_id não encontrado" });
    }

    const updates = [];
    const params = [];

    updates.push("status = ?");
    params.push("active");

    if (providedNumber !== null) {
      updates.push("whatsapp_number = ?");
      params.push(providedNumber);
    }

    params.push(clientId);

    const sql = `UPDATE clients SET ${updates.join(", ")} WHERE client_id = ?`;
    db.run(sql, params, function (updateErr) {
      if (updateErr) {
        console.error("Erro ao ativar client:", updateErr.message);
        return res.status(500).json({ success: false });
      }
      return res.json({ success: true });
    });
  });
});

// =====================
// LOGOUT (opcional)
// =====================
app.post("/api/logout", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (!sid) {
    // Sem sid, apenas responder success:false para consistência
    return res.json({ success: false });
  }
  db.run("DELETE FROM sessions WHERE token = ?", [sid], (err) => {
    if (err) {
      console.error("Erro ao deletar sessão:", err.message);
      // continua para limpar cookie do lado cliente
    }
    // Limpa cookie (instrui browser a apagar)
    res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
    return res.json({ success: true });
  });
});

// =====================
// LISTAR NÚMEROS (PROTEGIDO)
// =====================
app.get("/api/numeros", requireAuth, (req, res) => {
  db.all("SELECT * FROM numeros", [], (err, rows) => {
    if (err) {
      console.error("Erro ao listar números:", err.message);
      return res.json([]);
    }
    res.json(rows);
  });
});

// =====================
// ADICIONAR NÚMERO (PROTEGIDO)
// =====================
app.post("/api/adicionar", requireAuth, (req, res) => {
  const numero = req.body?.numero;
  if (!numero) return res.status(400).json({ error: "Número inválido" });

  db.run(
    "INSERT INTO numeros (numero, status) VALUES (?, 'livre')",
    [numero],
    function (err) {
      if (err) {
        // Tratamento de conflito UNIQUE
        if (err.code === "SQLITE_CONSTRAINT") {
          return res.status(400).json({ error: "Número já existe" });
        }
        console.error("Erro ao adicionar número:", err.message);
        return res.status(500).json({ error: "Erro ao adicionar número" });
      }

      res.json({
        success: true,
        novo: { id: this.lastID, numero, status: "livre" }
      });
    }
  );
});

// =====================
// LIBERAR (PROTEGIDO)
// =====================
app.post("/api/liberar/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  db.run(
    "UPDATE numeros SET status = 'livre' WHERE id = ?",
    [id],
    function (err) {
      if (err) {
        console.error("Erro ao liberar número:", err.message);
        return res.status(500).json({ success: false, error: "Erro no banco" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: "Número não encontrado" });
      }
      res.json({ success: true });
    }
  );
});

// =====================
// DELETAR (PROTEGIDO)
// =====================
app.delete("/api/deletar/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  db.run(
    "DELETE FROM numeros WHERE id = ?",
    [req.params.id],
    function (err) {
      if (err) {
        console.error("Erro ao deletar número:", err.message);
        return res.status(500).json({ success: false, error: "Erro no banco" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, error: "Número não encontrado" });
      }
      res.json({ success: true });
    }
  );
});
// =====================
// DEBUG - VER MENSAGENS DO BOTBOT
// =====================
app.get("/api/debug/botbot", (req, res) => {
  db.all(
    "SELECT id, phone, message, received_at FROM botbot_messages ORDER BY id DESC",
    [],
    (err, rows) => {
      if (err) {
        console.error("Erro ao buscar botbot_messages:", err.message);
        return res.status(500).json({ error: "Erro ao buscar dados" });
      }
      res.json(rows);
    }
  );
});
// =====================
// API: LISTAR CLIENTES (DO BANCO)
// =====================
app.get("/api/clients", (req, res) => {
  db.all(
    "SELECT id, whatsapp_number, status, criado_em FROM clients ORDER BY id DESC",
    [],
    (err, rows) => {
      if (err) {
        console.error("Erro ao buscar clients:", err.message);
        return res.status(500).json({ error: "Erro ao buscar clients" });
      }
      res.json(rows);
    }
  );
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
app.post("/webhook/evolution", (req, res) => {
  console.log("\n========================================");
  console.log("[WEBHOOK EVOLUTION] Mensagem INBOUND recebida");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Body:", JSON.stringify(req.body, null, 2).substring(0, 500));
  console.log("========================================\n");

  try {
    // Normalizar payload - suporta múltiplos formatos de webhook
    let phone = null;
    let message = null;
    let formato = "desconhecido";

    // FORMATO BOTBOT RESPOSTA: { senderPhone: "xxx", senderMessage: "texto" }
    if (req.body?.senderPhone && req.body?.senderMessage) {
      phone = (req.body.senderPhone || "").replace(/\D+/g, "");
      message = req.body.senderMessage;
      formato = "BotBot Resposta";
    }
    // FORMATO BOTBOT PADRÃO: { phone: "xxx", text: { message: "texto" } }
    else if (req.body?.phone && req.body?.text) {
      phone = (req.body.phone || "").replace(/\D+/g, "");
      if (typeof req.body.text === 'object') {
        message = req.body.text.message || req.body.text.text || JSON.stringify(req.body.text);
      } else {
        message = req.body.text;
      }
      formato = "BotBot Padrão";
    }
    // FORMATO EVOLUTION API: { data: { key: { remoteJid }, message: { conversation } } }
    else if (req.body?.data?.key?.remoteJid) {
      phone = req.body.data.key.remoteJid.replace("@s.whatsapp.net", "").replace(/\D+/g, "");
      message = req.body.data.message?.conversation
        || req.body.data.message?.extendedTextMessage?.text
        || null;
      formato = "Evolution API";
    }
    // FORMATO EVOLUTION ALTERNATIVO: { from/phone, message/text/body }
    else if (req.body?.from || (req.body?.phone && !req.body?.text)) {
      phone = (req.body.from || req.body.phone || "").replace(/\D+/g, "");
      let rawMsg = req.body.message || req.body.text || req.body.body || null;
      if (rawMsg && typeof rawMsg === 'object') {
        message = rawMsg.conversation || rawMsg.extendedTextMessage?.text || rawMsg.message || rawMsg.text || JSON.stringify(rawMsg);
      } else {
        message = rawMsg;
      }
      formato = "Evolution Alternativo";
    }
    // FORMATO EVOLUTION ARRAY: { messages: [...] }
    else if (Array.isArray(req.body?.messages) && req.body.messages.length > 0) {
      const m = req.body.messages[0];
      phone = (m.from || m.phone || m.key?.remoteJid || "").replace(/\D+/g, "").replace("@s.whatsapp.net", "");
      let rawMsg = m.message || m.text || m.body || null;
      if (rawMsg && typeof rawMsg === 'object') {
        message = rawMsg.conversation || rawMsg.extendedTextMessage?.text || rawMsg.message || rawMsg.text || JSON.stringify(rawMsg);
      } else {
        message = rawMsg;
      }
      formato = "Evolution Array";
    }

    // Garantir que message seja sempre string
    if (message && typeof message === 'object') {
      message = message.conversation || message.extendedTextMessage?.text || message.message || message.text || JSON.stringify(message);
    }

    console.log(`[WEBHOOK] Formato detectado: ${formato}`);
    console.log(`[WEBHOOK] Telefone: ${phone}`);
    console.log(`[WEBHOOK] Mensagem (${message?.length || 0} chars): ${message?.substring(0, 200)}`);

    // Validar dados obrigatórios
    if (!phone || !message) {
      console.log("[WEBHOOK] ⚠️ Ignorando: phone ou message ausente");
      return res.json({ success: true, ignored: true, reason: "missing_data" });
    }

    const receivedAt = Date.now();

    // =====================
    // NOVO: Extração Automática de Credenciais do Painel
    // =====================
    const xtreamResult = isXtreamResponse(message) ? parseXtreamMessage(message) : null;
    
    if (xtreamResult && xtreamResult.success) {
      // Salvar credenciais extraídas automaticamente da mensagem do painel
      db.run(
        `INSERT INTO xtream_credentials 
         (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [null, null, phone, xtreamResult.host, xtreamResult.username, 
         xtreamResult.password, xtreamResult.validade, xtreamResult.m3u_url, 
         message, Date.now()],
        function(err) {
          if (!err) {
            console.log('[WEBHOOK] ✅ Credenciais Xtream extraídas automaticamente:', {
              host: xtreamResult.host,
              username: xtreamResult.username,
              plano: xtreamResult.plano,
              validade: xtreamResult.validade
            });
            // Actualizar app_request pendente para este número
            db.run(
              "UPDATE app_requests SET status='ok', xtream_id=?, updated_at=? WHERE whatsapp_number=? AND status='pending'",
              [this.lastID, Date.now(), phone]
            );
          }
        }
      );
      return res.json({ success: true, command: 'xtream_auto', extracted: true });
    }

    // =====================
    // FLUXO PRINCIPAL: ATIVAR_TESTE <login> <senha>
    // =====================
    // Usa o parser centralizado para extrair login e senha
    const ativarResult = parseAtivarTesteCommand(message);

    if (ativarResult.success) {
      const { login, senha } = ativarResult;
      const dnsFixo = config.XTREAM_DNS_FIXO;

      console.log("\n🎯 === COMANDO ATIVAR_TESTE DETECTADO ===");
      console.log(`📱 Telefone: ${phone}`);
      console.log(`👤 Login: ${login}`);
      console.log(`🔐 Senha: ${senha}`);
      console.log(`🌐 DNS Fixo: ${dnsFixo}`);
      console.log("==========================================\n");

      // Buscar request pendente para este número (se existir)
      db.get(
        "SELECT * FROM app_requests WHERE whatsapp_number = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [phone],
        (err, appRequest) => {
          if (err) {
            console.error("[ATIVAR_TESTE] Erro ao buscar app_request:", err.message);
          }

          const requestId = appRequest?.request_id || null;
          const clientCode = appRequest?.client_code || null;

          console.log(`[ATIVAR_TESTE] Request vinculado: ${requestId ? requestId : "(nenhum - será criado)"}`);

          // Salvar credenciais com DNS fixo (NÃO extrai DNS da mensagem, USA O FIXO)
          db.run(
            `INSERT INTO xtream_credentials 
             (request_id, client_id, whatsapp_number, host, username, password, validade, m3u_url, raw_message, extracted_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [requestId, clientCode, phone, dnsFixo, login, senha, null, null, message, receivedAt],
            function (insertErr) {
              if (insertErr) {
                console.error("[ATIVAR_TESTE] ❌ Erro ao salvar credenciais:", insertErr.message);
                return;
              }

              const xtreamId = this.lastID;
              console.log(`[ATIVAR_TESTE] ✅ Credenciais salvas com ID: ${xtreamId}`);

              // Atualizar app_request existente OU criar novo
              if (appRequest) {
                db.run(
                  "UPDATE app_requests SET status = 'ok', xtream_id = ?, updated_at = ? WHERE request_id = ?",
                  [xtreamId, Date.now(), requestId],
                  (updateErr) => {
                    if (updateErr) {
                      console.error("[ATIVAR_TESTE] ❌ Erro ao atualizar app_request:", updateErr.message);
                    } else {
                      console.log(`[ATIVAR_TESTE] ✅ app_request '${requestId}' atualizado para 'ok'`);
                    }
                  }
                );
              } else {
                // Criar novo app_request vinculado a este número
                const newRequestId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
                const newClientCode = generateClientCode();
                db.run(
                  "INSERT INTO app_requests (request_id, client_code, device_id, whatsapp_number, status, xtream_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'ok', ?, ?, ?)",
                  [newRequestId, newClientCode, 'ativar_teste_' + phone, phone, xtreamId, receivedAt, receivedAt],
                  (createErr) => {
                    if (createErr) {
                      console.error("[ATIVAR_TESTE] ❌ Erro ao criar app_request:", createErr.message);
                    } else {
                      console.log(`[ATIVAR_TESTE] ✅ Novo app_request criado: ${newClientCode}`);
                    }
                  }
                );
              }
            }
          );
        }
      );

      return res.json({
        success: true,
        command: "ATIVAR_TESTE",
        message: "Credenciais processadas com sucesso"
      });
    }

    // =====================
    // FLUXO ALTERNATIVO: Cliente enviou "teste iptv cliente XXXXXX"
    // =====================
    const clientCodeMatch = message.match(/cliente\s+([A-Z0-9]{6})/i);
    if (clientCodeMatch) {
      const clientCode = clientCodeMatch[1].toUpperCase();
      console.log(`[WEBHOOK] 📋 Código cliente detectado: ${clientCode} (telefone: ${phone})`);

      db.run(
        "UPDATE app_requests SET whatsapp_number = ?, updated_at = ? WHERE client_code = ? AND status = 'pending'",
        [phone, Date.now(), clientCode],
        function (err) {
          if (err) {
            console.error("[WEBHOOK] ❌ Erro ao vincular número:", err.message);
          } else if (this.changes > 0) {
            console.log(`[WEBHOOK] ✅ Número ${phone} vinculado ao client_code ${clientCode}`);
          } else {
            console.log(`[WEBHOOK] ⚠️ Client_code não encontrado ou já processado: ${clientCode}`);
          }
        }
      );

      return res.json({ success: true, command: "client_code", message: "Número vinculado" });
    }

    // =====================
    // MENSAGEM NÃO RECONHECIDA
    // =====================
    // Apenas loga e ignora - NÃO tenta processar mensagens outbound ou do painel
    console.log(`[WEBHOOK] ⚠️ Mensagem ignorada (não é comando reconhecido): "${message.substring(0, 80)}..."`);
    return res.json({ success: true, ignored: true, reason: "unknown_command" });

  } catch (err) {
    console.error("[WEBHOOK] ❌ Erro crítico:", err);
    // Retorna success:true para evitar retries infinitos do webhook
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

app.post("/app/request", requireApiKey, (req, res) => {
  const deviceId = req.body?.device_id || null;

  if (!deviceId) {
    return res.status(400).json({ success: false, error: "device_id is required" });
  }

  // Verificar se já existe um request pendente para este device
  db.get(
    "SELECT * FROM app_requests WHERE device_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [deviceId],
    (err, existingRequest) => {
      if (err) {
        console.error("Erro ao buscar request existente:", err.message);
      }

      // Se já existe, retorna o mesmo
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

      // Criar novo request
      const requestId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
      const clientCode = generateClientCode();
      const now = Date.now();

      db.run(
        "INSERT INTO app_requests (request_id, client_code, device_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
        [requestId, clientCode, deviceId, now, now],
        function (err) {
          if (err) {
            console.error("Erro ao criar app_request:", err.message);
            return res.status(500).json({ success: false, error: "Erro ao criar request" });
          }

          // Gerar link WhatsApp com client_code na mensagem
          const targetNumber = config.IPTV_PANEL_NUMBER || config.WHATSAPP_NUMBER;
          const message = `teste iptv cliente ${clientCode}`;
          const encoded = encodeURIComponent(message);
          const whatsappLink = `https://wa.me/${targetNumber}?text=${encoded}`;

          console.log("Novo request criado:", { clientCode, deviceId, requestId });

          return res.json({
            success: true,
            client_code: clientCode,
            request_id: requestId,
            status: "pending",
            whatsapp_link: whatsappLink
          });
        }
      );
    }
  );
});

// =====================
// APP: VERIFICAR STATUS DO REQUEST (POLLING)
// GET /app/status?client_code=xxx ou ?request_id=xxx
// - Retorna status: pending | ok | error
// - Se ok, retorna credenciais Xtream limpas
// =====================
app.get("/app/status", requireApiKey, (req, res) => {
  const clientCode = req.query.client_code;
  const requestId = req.query.request_id;

  if (!clientCode && !requestId) {
    return res.status(400).json({ success: false, error: "client_code or request_id is required" });
  }

  // Buscar por client_code ou request_id
  const query = clientCode
    ? "SELECT * FROM app_requests WHERE client_code = ?"
    : "SELECT * FROM app_requests WHERE request_id = ?";
  const param = clientCode || requestId;

  db.get(query, [param], (err, appRequest) => {
    if (err) {
      console.error("Erro ao buscar app_request:", err.message);
      return res.status(500).json({ success: false, error: "DB error" });
    }

    if (!appRequest) {
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    // Se ainda está pendente
    if (appRequest.status === "pending") {
      return res.json({
        success: true,
        request_id: requestId,
        status: "pending"
      });
    }

    // Se tem credenciais prontas
    if (appRequest.status === "ok" && appRequest.xtream_id) {
      db.get(
        "SELECT host, username, password, validade FROM xtream_credentials WHERE id = ?",
        [appRequest.xtream_id],
        (xtreamErr, xtream) => {
          if (xtreamErr || !xtream) {
            return res.json({
              success: true,
              request_id: requestId,
              status: "error",
              error: "Credenciais não encontradas"
            });
          }

          // Retorna apenas os dados limpos do Xtream
          return res.json({
            success: true,
            request_id: requestId,
            status: "ok",
            xtream: {
              host: xtream.host,
              username: xtream.username,
              password: xtream.password,
              validade: xtream.validade
            }
          });
        }
      );
      return;
    }

    // Status desconhecido ou erro
    return res.json({
      success: true,
      request_id: requestId,
      status: appRequest.status || "unknown"
    });
  }
  );
});

// =====================
// DEBUG: VER CREDENCIAIS EXTRAÍDAS
// =====================
app.get("/api/debug/xtream", requireAuth, (req, res) => {
  db.all(
    "SELECT id, request_id, whatsapp_number, host, username, password, validade, extracted_at FROM xtream_credentials ORDER BY id DESC LIMIT 50",
    [],
    (err, rows) => {
      if (err) {
        console.error("Erro ao buscar xtream_credentials:", err.message);
        return res.status(500).json({ error: "Erro ao buscar dados" });
      }
      res.json(rows);
    }
  );
});

// =====================
// DEBUG: VER APP REQUESTS
// =====================
app.get("/api/debug/requests", requireAuth, (req, res) => {
  db.all(
    "SELECT id, request_id, device_id, whatsapp_number, status, xtream_id, created_at, updated_at FROM app_requests ORDER BY id DESC LIMIT 50",
    [],
    (err, rows) => {
      if (err) {
        console.error("Erro ao buscar app_requests:", err.message);
        return res.status(500).json({ error: "Erro ao buscar dados" });
      }
      res.json(rows);
    }
  );
});

// =====================
// WEBHOOK: EVOLUTION API - RECEBE MENSAGENS E EXTRAI CREDENCIAIS
// =====================
app.post("/webhook/evolution", async (req, res) => {
  const messages = req.body?.messages;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(200).json({ success: true, message: "No messages to process" });
  }

  for (const msg of messages) {
    // Ignorar mensagens que não são de texto ou que não são de entrada
    if (msg.type !== "text" || msg.fromMe) {
      continue;
    }

    const whatsappNumber = msg.from.replace("@s.whatsapp.net", "");
    const messageText = msg.body;

    console.log(`Mensagem recebida de ${whatsappNumber}: ${messageText}`);

    // 1. Tentar extrair credenciais Xtream
    const xtreamMatch = messageText.match(
      /(http[s]?:\/\/[^\s]+)\s+user:\s*([^\s]+)\s+pass:\s*([^\s]+)/i
    );

    if (xtreamMatch) {
      const host = xtreamMatch[1];
      const username = xtreamMatch[2];
      const password = xtreamMatch[3];
      const extractedAt = Date.now();

      console.log("Credenciais Xtream extraídas:", { host, username, password });

      // Buscar um request pendente para este número
      db.get(
        "SELECT * FROM app_requests WHERE whatsapp_number IS NULL AND status = 'pending' ORDER BY created_at ASC LIMIT 1",
        [],
        (err, appRequest) => {
          if (err) {
            console.error("Erro ao buscar app_request para credenciais:", err.message);
            return;
          }

          db.run(
            "INSERT INTO xtream_credentials (request_id, whatsapp_number, host, username, password, extracted_at) VALUES (?, ?, ?, ?, ?, ?)",
            [appRequest?.request_id || null, whatsappNumber, host, username, password, extractedAt],
            function (err) {
              if (err) {
                console.error("Erro ao salvar credenciais Xtream:", err.message);
                return;
              }
              const xtreamId = this.lastID;
              console.log("Credenciais Xtream salvas com ID:", xtreamId);

              if (appRequest) {
                // Atualizar o request com as credenciais e status 'ok'
                db.run(
                  "UPDATE app_requests SET whatsapp_number = ?, xtream_id = ?, status = 'ok', updated_at = ? WHERE id = ?",
                  [whatsappNumber, xtreamId, Date.now(), appRequest.id],
                  (updateErr) => {
                    if (updateErr) {
                      console.error("Erro ao atualizar app_request com credenciais:", updateErr.message);
                    } else {
                      console.log(`App request ${appRequest.request_id} atualizado para 'ok' com credenciais.`);
                    }
                  }
                );
              }
            }
          );
        }
      );
    } else {
      console.log("Nenhuma credencial Xtream encontrada na mensagem.");
    }
  }

  res.json({ success: true, message: "Webhook processed" });
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



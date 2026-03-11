const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = process.env.NODE_ENV === 'production' 
  ? path.join('/data', 'database.db')
  : path.join(__dirname, 'database.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Erro ao abrir banco:", err.message);
  } else {
    console.log("✅ Banco SQLite conectado");
  }
});

db.serialize(() => {
  // USERS
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  // NUMEROS
  db.run(`
    CREATE TABLE IF NOT EXISTS numeros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE,
      status TEXT
    )
  `);

  // SESSIONS
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE,
      user_id INTEGER,
      last_activity INTEGER
    )
  `);

  // CLIENTS
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE,
      criado_em INTEGER,
      whatsapp_number TEXT,
      status TEXT
    )
  `);

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_whatsapp_unique ON clients(whatsapp_number)
  `);

  // TESTES (IPTV)
  db.run(`
    CREATE TABLE IF NOT EXISTS testes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_number TEXT,
      client_id TEXT,
      criado_em INTEGER,
      validade INTEGER,
      status TEXT,
      m3u TEXT
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_testes_whatsapp ON testes(whatsapp_number)
  `);

  // BOTBOT MESSAGES (registro das mensagens recebidas do botbot)
  db.run(`
    CREATE TABLE IF NOT EXISTS botbot_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      message TEXT,
      received_at INTEGER
    )
  `);

  // XTREAM CREDENTIALS (credenciais extraídas das mensagens IPTV)
  db.run(`
    CREATE TABLE IF NOT EXISTS xtream_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      client_id TEXT,
      whatsapp_number TEXT,
      host TEXT,
      username TEXT,
      password TEXT,
      validade TEXT,
      m3u_url TEXT,
      raw_message TEXT,
      extracted_at INTEGER,
      status TEXT DEFAULT 'extracted'
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_xtream_request ON xtream_credentials(request_id)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_xtream_whatsapp ON xtream_credentials(whatsapp_number)
  `);

  // APP REQUESTS (controle de polling do app)
  db.run(`
    CREATE TABLE IF NOT EXISTS app_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE,
      client_code TEXT UNIQUE,
      client_id TEXT,
      device_id TEXT,
      whatsapp_number TEXT,
      status TEXT DEFAULT 'pending',
      xtream_id INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);

  // MIGRAÇÃO: Adicionar coluna client_code se não existir (para bancos antigos)
  // Nota: SQLite não suporta UNIQUE em ALTER TABLE, então adicionamos sem constraint
  db.run(`ALTER TABLE app_requests ADD COLUMN client_code TEXT`, (err) => {
    // Ignora erro se coluna já existir (SQLITE_ERROR: duplicate column name)
    if (err && !err.message.includes('duplicate column')) {
      console.log("Migração client_code:", err.message);
    }
  });

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_app_requests_status ON app_requests(status)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_app_requests_whatsapp ON app_requests(whatsapp_number)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_app_requests_client_code ON app_requests(client_code)
  `);

  // ADMIN PADRÃO
  db.get("SELECT * FROM users WHERE username = ?", ["admin"], (err, row) => {
    if (err) {
      console.error("Erro verificando admin:", err.message);
      return;
    }
    if (!row) {
      db.run("INSERT INTO users (username, password) VALUES (?, ?)", ["admin", "1234"], (insertErr) => {
        if (insertErr) {
          console.error("Erro criando admin:", insertErr.message);
        } else {
          console.log("👤 Admin criado (admin / 1234)");
        }
      });
    }
  });
});

module.exports = db;

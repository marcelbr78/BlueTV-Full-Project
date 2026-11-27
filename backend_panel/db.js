const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL || 'libsql://bluetv-db-marcelbr78.aws-us-west-2.turso.io',
  authToken: process.env.TURSO_TOKEN
});

async function run(sql, params = []) {
  return await db.execute({ sql, args: params });
}

async function get(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows[0] || null;
}

async function all(sql, params = []) {
  const result = await db.execute({ sql, args: params });
  return result.rows;
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS mario_update (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version_code INTEGER NOT NULL,
    version_name TEXT NOT NULL,
    apk_url TEXT NOT NULL,
    sha256 TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS bluetv_releases (
    version_code INTEGER PRIMARY KEY,
    version_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    notes TEXT NOT NULL,
    apk_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS bluetv_update_chunks (
    version_code INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (version_code, chunk_index)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS bluetv_update_uploads (
    upload_id TEXT PRIMARY KEY,
    version_code INTEGER NOT NULL,
    version_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    notes TEXT NOT NULL,
    apk_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS numeros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE,
    status TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    user_id INTEGER,
    last_activity INTEGER
  )`);
  await run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT UNIQUE,
    criado_em INTEGER,
    whatsapp_number TEXT,
    status TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS botbot_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    message TEXT,
    received_at INTEGER
  )`);
  await run(`CREATE TABLE IF NOT EXISTS evolution_sender_links (
    sender_jid TEXT PRIMARY KEY,
    client_code TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  await run("CREATE INDEX IF NOT EXISTS idx_botbot_phone_id ON botbot_messages(phone, id)");
  await run(`CREATE TABLE IF NOT EXISTS xtream_credentials (
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
    status TEXT DEFAULT 'extracted',
    plano TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS admin_dns_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // Adicionar coluna plano se não existir
  await run("ALTER TABLE xtream_credentials ADD COLUMN plano TEXT").catch(() => {});
  await run(`CREATE TABLE IF NOT EXISTS app_requests (
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
  )`);

  // Adicionar colunas de monitorização se não existirem
  const colsToAdd = [
    "ALTER TABLE app_requests ADD COLUMN device_model TEXT",
    "ALTER TABLE app_requests ADD COLUMN apk_version TEXT",
    "ALTER TABLE app_requests ADD COLUMN last_seen INTEGER",
    "ALTER TABLE app_requests ADD COLUMN current_channel TEXT",
    "ALTER TABLE app_requests ADD COLUMN is_online INTEGER DEFAULT 0",
    "ALTER TABLE app_requests ADD COLUMN customer_name TEXT",
    "ALTER TABLE app_requests ADD COLUMN customer_validade TEXT"
  ];
  for (const sql of colsToAdd) {
    await run(sql).catch(() => {}); // ignora se já existe
  }
  await run(`CREATE TABLE IF NOT EXISTS testes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp_number TEXT,
    client_id TEXT,
    criado_em INTEGER,
    validade INTEGER,
    status TEXT,
    m3u TEXT
  )`);

  // Tabela de eventos do cliente (populada futuramente pelo APK)
  await run(`CREATE TABLE IF NOT EXISTS client_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_code TEXT NOT NULL,
    event TEXT NOT NULL,
    channel TEXT,
    quality TEXT,
    error_code INTEGER,
    error_msg TEXT,
    server_ms INTEGER,
    apk_version TEXT,
    ts INTEGER NOT NULL
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_client_events_code ON client_events(client_code)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_client_events_ts ON client_events(ts)`);
  await run(`CREATE TABLE IF NOT EXISTS client_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_code TEXT NOT NULL,
    category TEXT NOT NULL,
    event TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_client_history_code_time ON client_history(client_code, created_at)`);
  await run(`CREATE TRIGGER IF NOT EXISTS record_watched_channel
    AFTER UPDATE OF current_channel ON app_requests
    WHEN NEW.status = 'ok' AND NEW.current_channel IS NOT NULL
         AND NEW.current_channel <> '' AND NEW.current_channel IS NOT OLD.current_channel
    BEGIN
      INSERT INTO client_events (client_code, event, channel, apk_version, ts)
      VALUES (NEW.client_code, 'PLAY_START', NEW.current_channel, NEW.apk_version, COALESCE(NEW.last_seen, NEW.updated_at, 0));
    END
  `);


  // ── FUTEBOL ──────────────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS football_matches (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS football_config (
    id INTEGER PRIMARY KEY,
    channels TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // ── AGENDA ESPORTIVA (@EsportesNaTV) ─────────────────────────────────────
  await run(`CREATE TABLE IF NOT EXISTS sports_agenda (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT UNIQUE NOT NULL,
    matches    TEXT NOT NULL,
    post_id    TEXT,
    created_at INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS sports_agenda_draft (
    date TEXT PRIMARY KEY,
    matches TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_url TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS sports_channels (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channels TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS sports_agenda_manual (
    date TEXT PRIMARY KEY,
    matches TEXT NOT NULL
  )`);

  // Insere config padrão ou migra config antiga (sem leagueId) para a versão nova
  const defaultChannels = require('./config/channels.json');
  const fConfig = await get('SELECT channels FROM football_config WHERE id = 1');
  if (!fConfig) {
    await run(
      'INSERT INTO football_config (id, channels, updated_at) VALUES (1, ?, ?)',
      [JSON.stringify(defaultChannels), Date.now()]
    );
  } else {
    try {
      const stored = JSON.parse(fConfig.channels);
      // Migra se não tem leagueId (config antiga)
      if (!stored[0]?.leagueId) {
        await run(
          'UPDATE football_config SET channels = ?, updated_at = ? WHERE id = 1',
          [JSON.stringify(defaultChannels), Date.now()]
        );
        console.log('⚽ Config de canais migrada para versão com leagueId');
      }
    } catch (e) {}
  }

  const admin = await get("SELECT * FROM users WHERE username = 'admin'");
  if (!admin) {
    await run("INSERT INTO users (username, password) VALUES ('admin', '1234')");
    console.log('👤 Admin criado (admin / 1234)');
  }
  console.log('✅ Turso DB inicializado');
}

async function batch(statements) {
  return await db.batch(statements, 'write');
}

module.exports = { run, get, all, batch, initDb };

const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL || 'libsql://bluetv-db-marcelbr78.aws-us-west-2.turso.io',
  authToken: process.env.TURSO_TOKEN
});

async function run(sql, params = []) {
  await db.execute({ sql, args: params });
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
    status TEXT DEFAULT 'extracted'
  )`);
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
  await run(`CREATE TABLE IF NOT EXISTS testes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp_number TEXT,
    client_id TEXT,
    criado_em INTEGER,
    validade INTEGER,
    status TEXT,
    m3u TEXT
  )`);

  const admin = await get("SELECT * FROM users WHERE username = 'admin'");
  if (!admin) {
    await run("INSERT INTO users (username, password) VALUES ('admin', '1234')");
    console.log('👤 Admin criado (admin / 1234)');
  }
  console.log('✅ Turso DB inicializado');
}

module.exports = { run, get, all, initDb };

const db = require('./db');

async function resetAdmin() {
  try {
    await db.initDb();
    
    // Apaga admin existente
    await db.run("DELETE FROM users WHERE username = 'admin'");
    
    // Cria admin novo com senha conhecida
    await db.run("INSERT INTO users (username, password) VALUES ('admin', 'bluetv2026')");
    
    console.log('✅ Admin recriado com sucesso!');
    console.log('Username: admin');
    console.log('Password: bluetv2026');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro:', err);
    process.exit(1);
  }
}

resetAdmin();

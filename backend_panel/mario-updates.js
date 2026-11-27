const { URL } = require('node:url');

module.exports = function registerMarioUpdates(app, db, requireAuth, requireApiKey) {
  const read = () => db.get('SELECT version_code, version_name, apk_url, sha256 FROM mario_update WHERE id = 1');

  const respond = async (req, res, action) => {
    res.set('Cache-Control', 'no-store');
    try {
      await action();
    } catch (error) {
      console.error('Erro ao gerenciar atualização do Mario TV:', error.code || error.name);
      res.status(500).json({ error: 'Não foi possível acessar a atualização.' });
    }
  };

  app.get('/app/mario/update', requireApiKey, (req, res) => respond(req, res, async () => {
    res.json({ release: await read() });
  }));

  app.get('/admin/mario/update', requireAuth, (req, res) => respond(req, res, async () => {
    res.json({ release: await read() });
  }));

  app.post('/admin/mario/update', requireAuth, (req, res) => respond(req, res, async () => {
    const { version_code: code, version_name: name, apk_url: address, sha256 } = req.body || {};
    let url;
    if (typeof address === 'string' && address.length <= 2048) {
      try { url = new URL(address); } catch {}
    }
    if (!Number.isSafeInteger(code) || code < 10 || code > 2100000000 ||
        typeof name !== 'string' || !/^1\.0\.\d{3,}$/.test(name) ||
        !url || url.protocol !== 'https:' || url.username || url.password || url.hash ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
      return res.status(400).json({ error: 'Informe o código da versão, o nome 1.0.XXX, o link HTTPS direto e o SHA-256 do APK.' });
    }
    const result = await db.run(
      `INSERT INTO mario_update (id, version_code, version_name, apk_url, sha256)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET version_code = excluded.version_code,
         version_name = excluded.version_name, apk_url = excluded.apk_url, sha256 = excluded.sha256
       WHERE excluded.version_code >= mario_update.version_code`,
      [code, name, url.href, sha256.toLowerCase()]
    );
    if (result.rowsAffected === 0) {
      return res.status(409).json({ error: 'Já existe uma versão publicada com código superior.' });
    }
    res.json({ release: await read() });
  }));

  app.delete('/admin/mario/update', requireAuth, (req, res) => respond(req, res, async () => {
    await db.run('DELETE FROM mario_update WHERE id = 1');
    res.json({ release: null });
  }));
};

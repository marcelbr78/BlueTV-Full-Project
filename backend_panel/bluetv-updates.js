const crypto = require('node:crypto');
const express = require('express');

const MAX_APK_BYTES = 128 * 1024 * 1024;
const MAX_NOTES_CHARS = 64 * 1024;
const APK_CHUNK_BYTES = 512 * 1024;

module.exports = function registerBlueTvUpdates(app, db, requireAuth, requireApiKey) {
  const latest = () => db.get(
    'SELECT version_code, version_name, sha256, notes, apk_size, created_at FROM bluetv_releases ORDER BY version_code DESC LIMIT 1'
  );

  const respond = async (req, res, action) => {
    res.set('Cache-Control', 'no-store');
    try {
      await action();
    } catch (error) {
      console.error('Erro ao gerenciar atualização do BlueTV:', error.code || error.name);
      if (!res.headersSent) res.status(500).json({ error: 'Não foi possível acessar a atualização.' });
      else res.end();
    }
  };

  const sendApk = async (res, versionCode) => {
    const rows = await db.all(
      `SELECT release.version_name, release.apk_size, chunk.data
       FROM bluetv_releases AS release
       LEFT JOIN bluetv_update_chunks AS chunk ON chunk.version_code = release.version_code
       WHERE release.version_code = ?
       ORDER BY chunk.chunk_index`,
      [versionCode]
    );
    const release = rows[0];
    if (!release) return res.status(404).json({ error: 'APK não encontrado.' });
    if (release.data === null) return res.status(404).json({ error: 'APK não disponível.' });
    res.attachment(`BlueTV-${release.version_name}.apk`);
    res.set('Content-Type', 'application/vnd.android.package-archive');
    res.set('Content-Length', String(release.apk_size));
    for (const row of rows) res.write(Buffer.from(row.data));
    res.end();
  };

  const sendCurrentApk = async (req, res) => {
    const release = await latest();
    if (!release) return res.status(404).json({ error: 'Nenhuma versão publicada.' });

    const size = release.apk_size;
    const etag = `"${release.sha256}"`;
    const ifRange = req.get('If-Range');
    const requested = !ifRange || ifRange === etag ? req.range(size) : undefined;
    res.set('Accept-Ranges', 'bytes');
    res.set('ETag', etag);
    if (requested === -1) {
      return res.set('Content-Range', `bytes */${size}`).status(416).end();
    }

    const range = requested?.type === 'bytes' && requested.length === 1 ? requested[0] : null;
    const { start, end } = range || { start: 0, end: size - 1 };
    const length = end - start + 1;
    const parts = [];
    if (req.method !== 'HEAD') {
      const chunks = await db.all(
        `SELECT chunk_index, data FROM bluetv_update_chunks
         WHERE version_code = ? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index`,
        [release.version_code, Math.floor(start / APK_CHUNK_BYTES), Math.floor(end / APK_CHUNK_BYTES)]
      );
      for (const chunk of chunks) {
        const offset = chunk.chunk_index * APK_CHUNK_BYTES;
        parts.push(Buffer.from(chunk.data).subarray(Math.max(0, start - offset), end - offset + 1));
      }
      if (parts.reduce((total, part) => total + part.length, 0) !== length) {
        return res.status(503).json({ error: 'APK temporariamente indisponível. Tente baixar novamente.' });
      }
    }

    res.attachment(`BlueTV-${release.version_name}.apk`);
    res.set('Content-Type', 'application/vnd.android.package-archive');
    res.set('Content-Length', String(length));
    if (range) res.set('Content-Range', `bytes ${start}-${end}/${size}`).status(206);
    for (const part of parts) res.write(part);
    res.end();
  };

  const readReleaseNotes = notes => {
    if (typeof notes !== 'string' || !notes.trim() || notes.length > MAX_NOTES_CHARS) return null;
    const version = notes.match(/^Vers[aã]o:\s*(1\.0\.\d{3,})\s*$/im)?.[1];
    const code = Number(notes.match(/^(?:C[oó]digo|VersionCode):\s*(\d+)\s*$/im)?.[1]);
    if (!version || !Number.isSafeInteger(code) || code < 1 || code > 2100000000) return null;
    return { version, code };
  };

  app.get('/app/bluetv/update', requireApiKey, (req, res) => respond(req, res, async () => {
    const release = await latest();
    res.json({ release: release && {
      ...release,
      apk_url: `/app/bluetv/apk/${release.version_code}`
    } });
  }));

  app.get('/app/bluetv/apk/:versionCode', requireApiKey, (req, res) => respond(req, res, async () => {
    const code = Number(req.params.versionCode);
    if (!Number.isSafeInteger(code)) return res.status(404).json({ error: 'APK não encontrado.' });
    await sendApk(res, code);
  }));

  app.get('/admin/bluetv/apk/latest', requireAuth, (req, res) => respond(req, res, () => sendCurrentApk(req, res)));

  app.get('/admin/bluetv/update', requireAuth, (req, res) => respond(req, res, async () => {
    const release = await latest();
    const history = await db.all(
      'SELECT version_code, version_name, sha256, notes, apk_size, created_at FROM bluetv_releases ORDER BY version_code DESC LIMIT 100'
    );
    res.json({ release, history });
  }));

  app.post('/admin/bluetv/update/upload/start', requireAuth, (req, res) => respond(req, res, async () => {
    const { upload_id: uploadId, version_code: code, version_name: name, sha256, apk_size: size, notes } = req.body || {};
    const parsed = readReleaseNotes(notes);
    if (typeof uploadId !== 'string' || !/^[a-f0-9-]{36}$/i.test(uploadId) ||
        !Number.isSafeInteger(code) || code < 1 || code > 2100000000 ||
        typeof name !== 'string' || !/^1\.0\.\d{3,}$/.test(name) ||
        !parsed || parsed.version !== name || parsed.code !== code ||
        typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256) ||
        !Number.isSafeInteger(size) || size < 8 || size > MAX_APK_BYTES) {
      return res.status(400).json({ error: 'Selecione o APK e o TXT gerado pelo BlueTV. O TXT precisa conter Versão e Código correspondentes.' });
    }
    const current = await latest();
    if (current && code <= current.version_code) {
      return res.status(409).json({ error: 'O código da versão precisa ser maior que o da última publicação.' });
    }
    await db.run(
      `INSERT OR REPLACE INTO bluetv_update_uploads
       (upload_id, version_code, version_name, sha256, notes, apk_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uploadId, code, name, sha256.toLowerCase(), notes, size, Date.now()]
    );
    res.json({ upload_id: uploadId, chunk_size: APK_CHUNK_BYTES });
  }));

  app.put('/admin/bluetv/update/upload/:uploadId', requireAuth,
    express.raw({ type: 'application/octet-stream', limit: MAX_APK_BYTES }),
    (req, res) => respond(req, res, async () => {
      const uploadId = req.params.uploadId;
      const upload = await db.get('SELECT * FROM bluetv_update_uploads WHERE upload_id = ?', [uploadId]);
      if (!upload) return res.status(404).json({ error: 'Envio expirado. Selecione novamente os arquivos.' });
      if (!Buffer.isBuffer(req.body) || req.body.length !== upload.apk_size || req.body.length < 8 ||
          req.body[0] !== 0x50 || req.body[1] !== 0x4b) {
        await db.run('DELETE FROM bluetv_update_uploads WHERE upload_id = ?', [uploadId]);
        return res.status(400).json({ error: 'O arquivo enviado não parece ser um APK válido ou seu tamanho mudou.' });
      }
      const actualHash = crypto.createHash('sha256').update(req.body).digest('hex');
      if (actualHash !== upload.sha256) {
        await db.run('DELETE FROM bluetv_update_uploads WHERE upload_id = ?', [uploadId]);
        return res.status(400).json({ error: 'O SHA-256 do APK não corresponde ao arquivo enviado.' });
      }

      try {
        let chunkIndex = 0;
        for (let offset = 0; offset < req.body.length; offset += APK_CHUNK_BYTES) {
          const chunk = req.body.subarray(offset, Math.min(offset + APK_CHUNK_BYTES, req.body.length));
          await db.run(
            'INSERT INTO bluetv_update_chunks (version_code, chunk_index, data) VALUES (?, ?, ?)',
            [upload.version_code, chunkIndex++, chunk]
          );
        }
        await db.run(
          `INSERT INTO bluetv_releases (version_code, version_name, sha256, notes, apk_size, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [upload.version_code, upload.version_name, upload.sha256, upload.notes, upload.apk_size, Date.now()]
        );
        await db.run('DELETE FROM bluetv_update_chunks WHERE version_code <> ?', [upload.version_code]);
        await db.run('DELETE FROM bluetv_update_uploads WHERE upload_id = ?', [uploadId]);
      } catch (error) {
        await db.run('DELETE FROM bluetv_update_chunks WHERE version_code = ?', [upload.version_code]).catch(() => {});
        throw error;
      }
      res.json({ success: true, release: await latest() });
    })
  );
};

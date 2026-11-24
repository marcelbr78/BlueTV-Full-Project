/**
 * jogos.js — busca categorias "JOGOS DO DIA" do Xtream
 * e parseia nome do canal para extrair dados do jogo
 *
 * Formato do nome: "West Ham x Wolverhampton 16:00 (1)"
 *   home  = "West Ham"
 *   away  = "Wolverhampton"
 *   time  = "16:00"
 *   slot  = 1  (mirror/bitrate)
 */

const http   = require('http');
const https  = require('https');
const config = require('../config');

// IDs antigos continuam como fallback. Como provedores podem recriar as
// categorias, também descobrimos os IDs atuais pelo nome antes de buscar.
const CATEGORY_IDS = ['253', '433'];

// Canais sem jogo real
const SKIP_RE = /sem\s+evento|fim\s+do\s+evento/i;

// "West Ham x Wolverhampton 16:00 (1)"
const NAME_RE = /^(.+?)\s+x\s+(.+?)\s+(\d{2}:\d{2})\s*\((\d+)\)\s*$/i;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Resposta JSON inválida')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Retorna lista de jogos agrupados por partida:
 * [{ home, away, time, channels: [{ name, streamId }] }]
 */
async function fetchJogosDodia() {
  const host = (config.XTREAM_REF_HOST || '').replace(/\/$/, '');
  const user = config.XTREAM_REF_USER;
  const pass = config.XTREAM_REF_PASS;
  if (!host || !user || !pass) return [];

  const makeUrl = (action, categoryId) => {
    const url = new URL(`${host.replace(/\/$/, '')}/player_api.php`);
    url.searchParams.set('username', user);
    url.searchParams.set('password', pass);
    url.searchParams.set('action', action);
    if (categoryId) url.searchParams.set('category_id', categoryId);
    return url.toString();
  };

  const categoryIds = new Set(CATEGORY_IDS);
  try {
    const categories = await fetchJson(makeUrl('get_live_categories'));
    if (Array.isArray(categories)) {
      for (const category of categories) {
        const name = String(category.category_name || category.name || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const id = String(category.category_id || category.id || '').trim();
        if (id && /jogos?\s+do\s+dia/.test(name)) categoryIds.add(id);
      }
    }
  } catch (e) {
    console.warn('⚽ Não foi possível descobrir as categorias de jogos; usando IDs antigos:', e.message);
  }

  const raw = [];

  for (const catId of categoryIds) {
    const url = makeUrl('get_live_streams', catId);
    try {
      const data = await fetchJson(url);
      if (Array.isArray(data)) raw.push(...data);
    } catch (e) {
      console.error(`⚽ Erro categoria ${catId}:`, e.message);
    }
  }

  // Agrupa por "home x away time" → channels[]
  const groups = {}; // key → { home, away, time, channels[] }

  const seenStreams = new Set();
  for (const ch of raw) {
    const name = (ch.name || '').trim();
    if (!name || SKIP_RE.test(name)) continue;

    const m = NAME_RE.exec(name);
    if (!m) continue;

    const home     = m[1].trim();
    const away     = m[2].trim();
    const time     = m[3];
    const slot     = parseInt(m[4], 10);
    const streamId = String(ch.stream_id || '');
    if (!streamId || seenStreams.has(streamId)) continue;
    seenStreams.add(streamId);

    const key = `${home.toLowerCase()}__${away.toLowerCase()}__${time}`;
    if (!groups[key]) {
      groups[key] = { home, away, time, channels: [] };
    }
    groups[key].channels.push({ name: `(${slot})`, streamId, slot });
  }

  // Ordena mirrors por slot e remove campo auxiliar
  return Object.values(groups).map(g => {
    g.channels.sort((a, b) => a.slot - b.slot);
    g.channels = g.channels.map(({ name, streamId }) => ({ name, streamId }));
    return g;
  });
}

module.exports = { fetchJogosDodia };

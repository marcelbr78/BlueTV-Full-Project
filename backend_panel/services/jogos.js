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

// Categorias JOGOS DO DIA e JOGOS DO DIA²
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
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve([]); }
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

  const raw = [];

  for (const catId of CATEGORY_IDS) {
    const url = `${host}/player_api.php?username=${user}&password=${pass}&action=get_live_streams&category_id=${catId}`;
    try {
      const data = await fetchJson(url);
      if (Array.isArray(data)) raw.push(...data);
    } catch (e) {
      console.error(`⚽ Erro categoria ${catId}:`, e.message);
    }
  }

  // Agrupa por "home x away time" → channels[]
  const groups = {}; // key → { home, away, time, channels[] }

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
    if (!streamId) continue;

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

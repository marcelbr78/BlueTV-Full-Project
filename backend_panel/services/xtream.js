/**
 * xtream.js — sincroniza canais live do servidor Xtream de referência
 * e constrói índice para cruzamento com jogos de futebol
 */

const http  = require('http');
const https = require('https');
const config = require('../config');

// índice: palavra-chave normalizada → array de { name, streamId }
let _index    = {};   // Map<string, {name,streamId}[]>
let _allNames = [];   // lista de nomes originais (para debug)
let _syncedAt = 0;

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function syncXtream() {
  const host = config.XTREAM_REF_HOST;
  const user = config.XTREAM_REF_USER;
  const pass = config.XTREAM_REF_PASS;

  if (!host || !user || !pass) {
    console.log('📺 XTREAM_REF_* não configurado — sem filtro por canal real');
    return;
  }

  const base = host.endsWith('/') ? host.slice(0, -1) : host;
  const url  = `${base}/player_api.php?username=${user}&password=${pass}&action=get_live_streams`;

  try {
    console.log('📺 Sincronizando canais Xtream...');
    const data = await fetchJson(url);

    if (!Array.isArray(data)) {
      console.warn('📺 Resposta inesperada do Xtream:', String(data).slice(0, 100));
      return;
    }

    const newIndex = {};
    const names    = [];

    for (const ch of data) {
      const name     = ch.name || '';
      const streamId = String(ch.stream_id || '');
      if (!name || !streamId) continue;

      names.push(name);
      const norm = normalize(name);

      // Indexa por cada "token" relevante do nome (ESPN, SporTV, Premier, etc.)
      const tokens = norm.split(' ').filter(t => t.length >= 3);
      for (const token of tokens) {
        if (!newIndex[token]) newIndex[token] = [];
        newIndex[token].push({ name, streamId });
      }
    }

    _index       = newIndex;
    _allNames    = names;
    _allChannels = data.map(ch => ({ name: ch.name || '', streamId: String(ch.stream_id || '') })).filter(c => c.name && c.streamId);
    _syncedAt    = Date.now();
    console.log(`📺 Xtream sync OK: ${names.length} canais live indexados`);
  } catch (e) {
    console.error('📺 Erro sync Xtream:', e.message);
  }
}

/**
 * Dado um nome de canal do channelMap (ex: "ESPN", "SporTV"),
 * retorna os canais Xtream reais que fazem match
 * ex: "ESPN" → [{ name: "ESPN HD", streamId: "4521" }, { name: "ESPN 2 HD", streamId: "4522" }]
 */
function findXtreamChannels(channelName) {
  if (!Object.keys(_index).length) return null; // Xtream não configurado

  const normQuery = normalize(channelName);
  const queryTokens = normQuery.split(' ').filter(t => t.length >= 3);

  const seen = new Set();
  const results = [];

  for (const token of queryTokens) {
    const candidates = _index[token] || [];
    for (const ch of candidates) {
      if (!seen.has(ch.streamId)) {
        seen.add(ch.streamId);
        results.push(ch);
      }
    }
  }

  return results; // vazio = canal mapeado mas não existe no Xtream
}

// Lista completa de canais (para EPG index)
let _allChannels = [];

function isReady()      { return Object.keys(_index).length > 0; }
function getSyncedAt()  { return _syncedAt; }
function getAllNames()   { return _allNames; }
function getAllChannels(){ return _allChannels; }

module.exports = { syncXtream, findXtreamChannels, isReady, getSyncedAt, getAllNames, getAllChannels };

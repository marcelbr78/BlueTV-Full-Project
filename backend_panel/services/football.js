/**
 * football.js — busca jogos do dia na API-Football v3
 * Sem dependências externas (usa https nativo)
 */

const https = require('https');
const config = require('../config');

let _cache = [];
let _cacheDate = '';

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function syncFootball() {
  if (!config.FOOTBALL_API_KEY) {
    console.log('⚽ FOOTBALL_API_KEY não configurada — usando cache vazio');
    return [];
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const data = await fetchJson(
      `https://v3.football.api-sports.io/fixtures?date=${today}&timezone=America%2FSao_Paulo`,
      { 'x-apisports-key': config.FOOTBALL_API_KEY }
    );

    if (!data || !Array.isArray(data.response)) {
      console.warn('⚽ Resposta inesperada da API-Football:', JSON.stringify(data).slice(0, 200));
      return _cache;
    }

    const matches = data.response.map(m => ({
      id: m.fixture.id,
      leagueId: m.league.id,
      league: m.league.name,
      leagueCountry: m.league.country,
      leagueLogo: m.league.logo,
      home: m.teams.home.name,
      homeLogo: m.teams.home.logo,
      away: m.teams.away.name,
      awayLogo: m.teams.away.logo,
      time: m.fixture.date,          // ISO 8601
      status: m.fixture.status.short, // NS, 1H, HT, 2H, FT …
      score: m.goals
    }));

    _cache = matches;
    _cacheDate = today;
    console.log(`⚽ Sync futebol OK: ${matches.length} jogos para ${today}`);
    return matches;
  } catch (e) {
    console.error('⚽ Erro sync football:', e.message);
    return _cache;
  }
}

function getCache()     { return _cache; }
function getCacheDate() { return _cacheDate; }

function _restoreCache(matches, date) {
  _cache = matches;
  _cacheDate = date;
}

module.exports = { syncFootball, getCache, getCacheDate, _restoreCache };

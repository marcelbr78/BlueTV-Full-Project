const snapshot = require('../config/serie-a-standings-snapshot.json');
const host = 'https://www.cbf.com.br';
const refreshAfter = 5 * 60 * 1000;
const maxStaleness = 24 * 60 * 60 * 1000;
let cached;
let pending;

function text(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&nbsp;|\s+/g, ' ').trim();
}

function logoUrl(cell) {
  const value = /<img\b[^>]*\bsrc="([^"]+)"/i.exec(cell)?.[1];
  if (!value) return '';
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), host);
    const image = new URL(url.searchParams.get('url') || url.href);
    return image.protocol === 'https:' && image.hostname === 'conteudo.cbf.com.br' &&
      /^\/clubes\/\d+\/escudo\.(?:jpg|png|webp)$/i.test(image.pathname) ? image.href : '';
  } catch {
    return '';
  }
}

function parseStandings(html) {
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map(match => match[1]).find(value => value.includes('Classificação') && value.includes('teamName__'));
  const body = table && /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1];
  if (!body) throw new Error('Tabela de classificação ausente na CBF');

  const teams = [];
  for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
    if (cells.length < 9) throw new Error('Formato inesperado na classificação da CBF');
    const position = Number(/<strong\b[^>]*>\s*(\d+)\s*<\/strong>/i.exec(cells[0])?.[1]);
    const club = text(/<strong\b[^>]*\bclass="[^"]*teamName__[^"]*"[^>]*>([\s\S]*?)<\/strong>/i.exec(cells[0])?.[1] || '');
    const numbers = cells.slice(1, 9).map(text).map(value => /^-?\d+$/.test(value) ? Number(value) : NaN);
    if (position !== teams.length + 1 || !club || numbers.some(value => !Number.isSafeInteger(value))) {
      throw new Error('Classificação incompleta na CBF');
    }
    const [points, played, won, drawn, lost, , , difference] = numbers;
    teams.push({ position, club, logo: logoUrl(cells[0]), points, played, won, drawn, lost, difference });
  }

  if (teams.length !== 20) throw new Error('Número inesperado de clubes na classificação da CBF');
  return teams;
}

async function fetchStandings(season) {
  const url = new URL('/futebol-brasileiro/tabelas/campeonato-brasileiro/serie-a/' + season, host);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000), redirect: 'error',
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' }
  });
  if (!response.ok) throw new Error('CBF respondeu HTTP ' + response.status);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw new Error('Página da CBF acima do limite');
    chunks.push(chunk);
  }
  return parseStandings(Buffer.concat(chunks).toString('utf8'));
}

async function getStandings(season) {
  const now = Date.now();
  if (cached?.season === season && now < cached.refreshAt) return cached.data;
  if (pending?.season === season) return pending.request;

  const request = (async () => {
    try {
      const teams = await fetchStandings(season);
      const data = { season, updatedAt: new Date().toISOString(), stale: false, teams };
      cached = { season, at: Date.now(), refreshAt: Date.now() + refreshAfter, data };
      return data;
    } catch (error) {
      const previous = cached?.season === season ? cached.data : snapshot.season === season ? snapshot : null;
      const at = Date.parse(previous?.updatedAt);
      if (!Number.isFinite(at) || now - at > maxStaleness) throw error;
      const data = { ...previous, stale: true };
      cached = { season, at, refreshAt: Date.now() + 60_000, data };
      return data;
    }
  })();
  pending = { season, request };
  try {
    return await request;
  } finally {
    if (pending?.request === request) pending = undefined;
  }
}

module.exports = { parseStandings, getStandings };

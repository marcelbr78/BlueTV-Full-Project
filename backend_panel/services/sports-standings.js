const https = require('https');
const sportsCatalog = require('./sports-catalog');
const { getStandings: getSerieAStandings } = require('./cbf-standings');

const SPORT_SCORE = 'https://sportscore.com';
const cache = new Map();
const CACHE_MS = 60 * 1000;

// Slugs are restricted to competitions from the panel's own catalog. Cups with
// knockout formats deliberately have no points table in this list.
const standingsSlugs = new Map([
  ['brasileirão série b', 'brazilian-serie-b'],
  ['campeonato gaúcho', 'brazilian-campeonato-gaucho'],
  ['campeonato carioca', 'brazilian-campeonato-carioca-a'],
  ['campeonato paulista', 'brazilian-campeonato-paulista-a1'],
  ['campeonato mineiro', 'brazilian-campeonato-mineiro-division-1'],
  ['premier league', 'english-premier-league'],
  ['efl championship', 'english-football-league-championship'],
  ['la liga', 'spanish-la-liga'],
  ['la liga 2', 'spanish-segunda-division'],
  ['serie a (itália)', 'italian-serie-a'],
  ['serie b (itália)', 'italian-serie-b'],
  ['bundesliga', 'bundesliga'],
  ['2. bundesliga', 'german-bundesliga-2'],
  ['ligue 1', 'french-ligue-1'],
  ['ligue 2', 'french-ligue-2'],
  ['eredivisie', 'netherlands-eredivisie'],
  ['champions league', 'uefa-champions-league'],
  ['europa league', 'uefa-europa-league'],
  ['conference league', 'uefa-europa-conference-league'],
  ['copa libertadores', 'conmebol-copa-libertadores'],
  ['copa sul-americana', 'conmebol-copa-sudamericana']
]);

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const slugByName = new Map([...standingsSlugs].map(([name, slug]) => [normalize(name), slug]));

function getCompetitions() {
  return sportsCatalog.competitions.map(competition => {
    const slug = slugByName.get(normalize(competition.name));
    return {
      name: competition.name,
      group: competition.group,
      hasStandings: competition.name === 'Brasileirão Série A' || Boolean(slug),
      tableFormat: slug || competition.name === 'Brasileirão Série A' ? 'points' : competition.name === 'Copa do Brasil' || competition.name === 'FA Cup' ? 'knockout' : 'unavailable'
    };
  });
}

function requestStandings(slug) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/widget/standings/', SPORT_SCORE);
    url.searchParams.set('sport', 'football');
    url.searchParams.set('slug', slug);
    url.searchParams.set('src', 'bluetv');
    const request = https.get(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BlueTV-Android/1.0' }
    }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) request.destroy(new Error('Tabela acima do limite'));
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`SportScore HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Resposta de classificação inválida')); }
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error('SportScore timeout')));
    request.on('error', reject);
  });
}

function safeLogo(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'img.thesports.com' ? url.href : '';
  } catch { return ''; }
}

async function getCompetitionStandings(name, currentSeason) {
  const competition = sportsCatalog.competitions.find(item => normalize(item.name) === normalize(name));
  if (!competition) return null;
  if (competition.name === 'Brasileirão Série A') {
    const data = await getSerieAStandings(currentSeason);
    return { ...data, competition: competition.name, available: true, source: 'CBF', sourceLink: 'https://www.cbf.com.br/' };
  }

  const slug = slugByName.get(normalize(competition.name));
  if (!slug) {
    const isKnockout = ['Copa do Brasil', 'FA Cup'].includes(competition.name);
    return { competition: competition.name, available: false, reason: isKnockout ? 'knockout' : 'unavailable' };
  }

  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const payload = await requestStandings(slug);
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const teams = [];
  for (const table of tables) {
    const group = typeof table.group === 'string' ? table.group.trim() : '';
    for (const row of Array.isArray(table.rows) ? table.rows : []) {
      const position = Number(row.pos);
      const club = typeof row.team === 'string' ? row.team.trim() : '';
      const points = Number(row.pts);
      const played = Number(row.p);
      const won = Number(row.w);
      const drawn = Number(row.d);
      const lost = Number(row.l);
      const difference = Number(row.gd);
      if (!club || !Number.isInteger(position) || position < 1 || !Number.isFinite(points) || !Number.isFinite(played)) continue;
      teams.push({ position, club, logo: safeLogo(row.team_logo), points, played,
        won: Number.isFinite(won) ? won : 0, drawn: Number.isFinite(drawn) ? drawn : 0,
        lost: Number.isFinite(lost) ? lost : 0, difference: Number.isFinite(difference) ? difference : 0, group });
    }
  }
  // A large flat response from a knockout cup is not a league table.
  if (!teams.length || teams.length > 80) {
    return { competition: competition.name, available: false, reason: 'knockout' };
  }
  const data = {
    competition: competition.name,
    season: typeof payload.season === 'string' ? payload.season : '',
    updatedAt: new Date().toISOString(),
    stale: false,
    available: true,
    source: 'SportScore',
    sourceLink: 'https://sportscore.com/',
    teams
  };
  cache.set(slug, { data, expiresAt: Date.now() + CACHE_MS });
  return data;
}

module.exports = { getCompetitions, getCompetitionStandings };

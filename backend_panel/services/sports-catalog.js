const https = require('https');
const config = require('../config');
const competitions = require('../config/sports-competitions.json');

const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findCompetition(name) {
  const key = normalize(name);
  return competitions.find(item => normalize(item.name) === key);
}

function requestApi(path) {
  return new Promise((resolve, reject) => {
    const request = https.get('https://v3.football.api-sports.io' + path, {
      headers: { 'x-apisports-key': config.FOOTBALL_API_KEY }
    }, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (response.statusCode !== 200 || result.errors && Object.keys(result.errors).length) {
            return reject(new Error('API-Football indisponível'));
          }
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(15000, () => request.destroy(new Error('API-Football timeout')));
    request.on('error', reject);
  });
}

function seasonFor(competition) {
  const year = new Date().getUTCFullYear();
  if (competition.group === 'Brasil' || competition.group === 'Copas sul-americanas') return year;
  return new Date().getUTCMonth() >= 6 ? year : year - 1;
}

async function resolveLeagueId(competition, season) {
  if (Number.isInteger(competition.id)) return competition.id;
  if (!competition.search || !competition.country) return null;
  const query = new URLSearchParams({ search: competition.search, country: competition.country, season: String(season) });
  const result = await requestApi('/leagues?' + query.toString());
  const entries = Array.isArray(result.response) ? result.response : [];
  const exact = entries.find(entry => normalize(entry.league?.name) === normalize(competition.search));
  return exact?.league?.id || entries[0]?.league?.id || null;
}

async function getTeams(competitionName) {
  const competition = findCompetition(competitionName);
  if (!competition) return { teams: [], source: 'empty' };
  const cached = cache.get(competition.name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fallback = {
    teams: [...new Set(competition.fallback || [])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map(name => ({ id: null, name, logo: '' })),
    source: 'lista-base'
  };
  if (!config.FOOTBALL_API_KEY) return fallback;

  try {
    const season = seasonFor(competition);
    const leagueId = await resolveLeagueId(competition, season);
    if (!leagueId) return fallback;
    const query = new URLSearchParams({ league: String(leagueId), season: String(season) });
    const result = await requestApi('/teams?' + query.toString());
    const teams = (Array.isArray(result.response) ? result.response : [])
      .map(entry => entry.team)
      .filter(team => team && typeof team.name === 'string' && team.name.trim())
      .map(team => ({ id: Number.isInteger(team.id) ? team.id : null, name: team.name.trim(),
        logo: typeof team.logo === 'string' && team.logo.startsWith('https://media.api-sports.io/football/teams/') ? team.logo : '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const value = teams.length ? { teams, source: 'api-football' } : fallback;
    cache.set(competition.name, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  } catch (error) {
    console.warn('Catálogo de times indisponível:', error.code || error.name);
    cache.set(competition.name, { value: fallback, expiresAt: Date.now() + 5 * 60 * 1000 });
    return fallback;
  }
}

module.exports = { competitions, getTeams, dynamicAvailable: Boolean(config.FOOTBALL_API_KEY) };

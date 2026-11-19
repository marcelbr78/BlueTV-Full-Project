/**
 * matcher.js — cruza JOGOS DO DIA (Xtream) com API-Football para enriquecer
 *
 * Fonte primária: canais das categorias "JOGOS DO DIA" do Xtream
 *   → nomes já contêm "Home x Away HH:MM (slot)"
 * Enriquecimento: API-Football (logos, liga, score ao vivo)
 *   → matched por similaridade de tokens + proximidade de horário
 */

const { fetchJogosDodia } = require('./jogos');
const { getCache } = require('./football');

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tokens(s) {
  return normalize(s).split(' ').filter(t => t.length >= 3);
}

// Retorna fração de tokens de `a` que aparecem em `b`
function overlap(a, b) {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length) return 0;
  const hit = ta.filter(t => tb.has(t)).length;
  return hit / ta.length;
}

// Converte "HH:MM" → minutos desde meia-noite
function toMin(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Score de correspondência jogo-do-dia × API-Football (0–1)
function matchScore(jogo, api) {
  // Horário (BRT) do jogo API-Football
  const apiTimeStr = api.time
    ? new Date(api.time).toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
      })
    : null;

  if (apiTimeStr) {
    const diffMin = Math.abs(toMin(jogo.time) - toMin(apiTimeStr));
    if (diffMin > 90) return 0; // horários muito diferentes → não é o mesmo jogo
  }

  const homeOv = overlap(jogo.home, api.home);
  const awayOv = overlap(jogo.away, api.away);

  return (homeOv + awayOv) / 2;
}

/**
 * Retorna lista de jogos enriquecidos prontos para o app e admin.
 * Fonte de canais: JOGOS DO DIA (Xtream)
 * Enriquecimento: API-Football (logos, liga, score)
 */
async function getEnrichedMatches() {
  const jogos = await fetchJogosDodia();
  if (jogos.length === 0) {
    console.log('⚽ JOGOS DO DIA: nenhum jogo ativo no momento');
    return [];
  }

  console.log(`⚽ JOGOS DO DIA: ${jogos.length} jogo(s) encontrado(s)`);

  const apiMatches = getCache(); // cache do API-Football

  const result = [];

  for (const jogo of jogos) {
    // Tenta enriquecer com API-Football
    let best = null;
    let bestScore = 0;

    for (const api of apiMatches) {
      const s = matchScore(jogo, api);
      if (s > bestScore) {
        bestScore = s;
        best = api;
      }
    }

    const timeLocal = jogo.time;

    if (best && bestScore >= 0.5) {
      // Enriquecido com dados da API-Football
      result.push({
        id:            best.id,
        leagueId:      best.leagueId || 0,
        league:        best.league   || '',
        leagueCountry: best.leagueCountry || '',
        leagueLogo:    best.leagueLogo    || '',
        match:         `${jogo.home} x ${jogo.away}`,
        home:          jogo.home,
        homeLogo:      best.homeLogo || '',
        away:          jogo.away,
        awayLogo:      best.awayLogo || '',
        time:          timeLocal,
        timeISO:       best.time || null,
        status:        best.status || 'NS',
        score:         best.score  || { home: null, away: null },
        channels:      jogo.channels,
        epgResolved:   true,
      });
      console.log(`⚽ Match [${bestScore.toFixed(2)}]: "${jogo.home} x ${jogo.away}" → "${best.home} x ${best.away}" (${best.league})`);
    } else {
      // Sem correspondência na API — serve dados básicos do canal
      result.push({
        id:            0,
        leagueId:      0,
        league:        '',
        leagueCountry: '',
        leagueLogo:    '',
        match:         `${jogo.home} x ${jogo.away}`,
        home:          jogo.home,
        homeLogo:      '',
        away:          jogo.away,
        awayLogo:      '',
        time:          timeLocal,
        timeISO:       null,
        status:        'NS',
        score:         { home: null, away: null },
        channels:      jogo.channels,
        epgResolved:   true,
      });
      console.log(`⚽ Sem match API: "${jogo.home} x ${jogo.away}" (score=${bestScore.toFixed(2)})`);
    }
  }

  return result;
}

module.exports = { getEnrichedMatches };

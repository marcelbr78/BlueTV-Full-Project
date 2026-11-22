const league = 'Brasileirão Série A';
const saoPaulo = 'America/Sao_Paulo';
const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: saoPaulo, year: 'numeric', month: '2-digit', day: '2-digit'
});
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: saoPaulo, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

// Rodada 36, tabela detalhada da CBF (04/11/2026) e transmissões da rodada no ge.
// https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Detalhada_BSA_2026_04_11_7e8eea9eb8.pdf
// https://ge.globo.com/ba/futebol/brasileirao-serie-a/noticia/2026/11/21/brasileirao-2026-veja-onde-assistir-ao-vivo-aos-jogos-da-36a-rodada.ghtml
const confirmed = {
  '2026-11-22': [
    [358, '16:00', 'Athletico-PR', 'Remo', ['Premiere']],
    [351, '18:30', 'Fluminense', 'Mirassol', ['Premiere', 'Record', 'CazéTV']],
    [355, '19:30', 'Red Bull Bragantino', 'Vasco da Gama', ['Premiere', 'SporTV']]
  ],
  '2026-11-23': [
    [357, '19:30', 'Internacional', 'Vitória', ['Premiere', 'SporTV']],
    [352, '20:00', 'Botafogo', 'São Paulo', ['Prime Video']],
    [353, '21:00', 'Santos', 'Grêmio', ['Premiere', 'SporTV']]
  ],
  '2026-11-25': [
    [356, '20:00', 'Atlético-MG', 'Corinthians', ['Premiere']]
  ]
};

// IDs dos escudos na tabela oficial da CBF da temporada de 2026.
const badgeIds = {
  'athletico pr': 20052, remo: 20022, fluminense: 20014, mirassol: 20385,
  'red bull bragantino': 20007, 'vasco da gama': 60646, internacional: 20011,
  vitoria: 20018, botafogo: 60175, 'sao paulo': 20005, santos: 20008,
  gremio: 20013, 'atletico mg': 62194, corinthians: 20001
};

const clubAliases = new Map([
  ['athletico', 'athletico pr'], ['athletico paranaense', 'athletico pr'],
  ['atletico paranaense', 'athletico pr'], ['atletico pr', 'athletico pr'],
  ['atletico mineiro', 'atletico mg'], ['bragantino', 'red bull bragantino'],
  ['rb bragantino', 'red bull bragantino'], ['vasco', 'vasco da gama'],
  ['vasco da gama saf', 'vasco da gama'], ['internacional rs', 'internacional']
]);

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function club(value) {
  const key = normalize(value);
  return clubAliases.get(key) ?? key;
}

function badge(value) {
  const id = badgeIds[club(value)];
  return Number.isInteger(id) ? `https://conteudo.cbf.com.br/clubes/${id}/escudo.jpg` : '';
}

function matchKey(row) {
  const [home, away] = String(row.match ?? '').split(/\s+(?:x|vs\.?|×)\s+/i, 2);
  const sides = [club(row.home || home), club(row.away || away)];
  return sides.every(Boolean) ? sides.join('|') : '';
}

function isDifferentCompetition(row) {
  return /\b(?:serie [bcd]|feminino|sub ?\d+)\b/.test(normalize(row.league));
}

function serieAFixtures(date, feed) {
  return feed.filter(row => {
    const local = new Date(row.time);
    return Number(row.leagueId) === 71 && row.home && row.away &&
      Number.isFinite(+local) && dateFormatter.format(local) === date;
  }).map(row => ({
    ...row,
    league,
    timeISO: row.time,
    time: timeFormatter.format(new Date(row.time)),
    match: row.home + ' x ' + row.away
  }));
}

function completeSerieA(date, original, feed = [], preserveExisting = false) {
  const fixtures = new Map(serieAFixtures(date, feed).map(row => [matchKey(row), row]));
  if (Object.hasOwn(confirmed, date)) {
    for (const [reference, time, home, away, channels] of confirmed[date]) {
      const key = matchKey({ home, away });
      const live = fixtures.get(key);
      fixtures.set(key, {
        ...live,
        id: live?.id ?? `cbf-bra-serie-a-2026-${reference}`,
        match: home + ' x ' + away,
        league, home, away, time, channels,
        homeLogo: live?.homeLogo || badge(home), awayLogo: live?.awayLogo || badge(away)
      });
    }
  }
  if (!fixtures.size) return original;

  const merged = [...original];
  for (const [key, fixture] of fixtures) {
    const existing = merged.findIndex(row => !isDifferentCompetition(row) && matchKey(row) === key);
    if (existing < 0) merged.push({ channels: [], ...fixture });
    else if (!preserveExisting) merged[existing] = { ...merged[existing], ...fixture };
  }

  return merged.sort((left, right) => String(left.time ?? '').localeCompare(String(right.time ?? '')));
}

function completePublishedSerieA(date, matches) {
  return matches.length ? completeSerieA(date, matches, [], true) : matches;
}

module.exports = { completeSerieA, completePublishedSerieA };

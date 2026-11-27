const numbered = (name, last, first = 1) =>
  Array.from({ length: last - first + 1 }, (_, index) => [name + ' ' + (index + first), name + (index + first)]);

const premiereClubes = 'Premiere Clubes';
const mainPremiereLabels = [premiereClubes, 'Premiere 1', 'Premiere1', 'Premiere'];

const broadcasts = [
  mainPremiereLabels, ...numbered('Premiere', 7, 2),
  ['ESPN', 'ESPN Brasil'], ...numbered('ESPN', 6),
  ['SporTV'], ...numbered('SporTV', 3),
  ['Combate'], ['BandSports', 'Band Sports'], ['XSports', 'X Sports'],
  ['Nosso Futebol'], ['TNT', 'TNT Sports'], ['Space'], ['Canal GOAT', 'GOAT'],
  ['Globo'], ['Band'], ['SBT'], ['Record'], ['RedeTV!'], ['TV Brasil'],
  ['Prime Video', 'Amazon Prime Video', 'Amazon Prime', 'Amazon'],
  ['Disney+', 'Disney Plus'], ['HBO Max', 'Max'], ['Paramount+', 'Paramount Plus'],
  ['Globoplay'], ['DAZN'], ['YouTube'], ['CazéTV', 'CazeTV', 'Cazé TV']
];

const names = new Map(broadcasts.flatMap(([name, ...aliases]) =>
  [name, ...aliases].map(alias => [alias.toLowerCase(), name])));
const mainPremiereKeys = new Set(mainPremiereLabels.map(label => label.toLowerCase()));

const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
// Match complete names while accepting whitespace variants commonly produced by OCR.
const pattern = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' + [...names.keys()].sort((a, b) => b.length - a.length).map(escape).join('|') +
  ')(?![\\p{L}\\p{N}])', 'giu'
);

function findBroadcasts(text) {
  const matches = [...text.matchAll(pattern)];
  return {
    start: matches[0]?.index ?? -1,
    channels: [...new Set(matches.map(match => names.get(match[0].toLowerCase().replace(/\s+/g, ' '))))]
  };
}

function normalizePremiereChannels(channels) {
  const result = [];
  let mainIndex = -1;
  for (const channel of channels) {
    const label = typeof channel === 'string' ? channel : channel?.name;
    if (typeof label !== 'string' || !mainPremiereKeys.has(label.trim().toLowerCase().replace(/\s+/g, ' '))) {
      result.push(channel);
      continue;
    }
    const normalized = typeof channel === 'string' ? premiereClubes : { ...channel, name: premiereClubes };
    if (mainIndex < 0) {
      mainIndex = result.length;
      result.push(normalized);
    } else if (typeof normalized === 'object' && typeof result[mainIndex] === 'string') {
      result[mainIndex] = normalized;
    }
  }
  return result;
}

function normalizePremiereAgenda(matches) {
  return matches.map(match => Array.isArray(match.channels)
    ? { ...match, channels: normalizePremiereChannels(match.channels) } : match);
}

module.exports = {
  baseChannels: broadcasts.map(([name]) => name), findBroadcasts, normalizePremiereChannels, normalizePremiereAgenda
};

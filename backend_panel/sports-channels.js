const numbered = (name, limit) =>
  Array.from({ length: limit }, (_, index) => [name + ' ' + (index + 1), name + (index + 1)]);

const broadcasts = [
  ['Premiere', 'Premiere Clubes'], ...numbered('Premiere', 7),
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

module.exports = { baseChannels: broadcasts.map(([name]) => name), findBroadcasts };

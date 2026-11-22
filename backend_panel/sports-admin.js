const baseChannels = [
  'ESPN', 'ESPN 2', 'ESPN 3', 'ESPN 4', 'ESPN 5',
  'SporTV', 'SporTV 2', 'SporTV 3', 'Premiere', 'Combate',
  'BandSports', 'XSports', 'TNT', 'Space', 'Globo', 'Band', 'SBT', 'Record'
];

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function channelName(channel) {
  return typeof channel === 'string' ? channel : channel?.name;
}

function normalizeChannels(values) {
  if (!Array.isArray(values) || values.length > 150) throw new TypeError('Informe até 150 canais.');
  const unique = new Map();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
      throw new TypeError('Cada canal deve ter um nome de até 100 caracteres.');
    }
    const name = value.trim();
    if (!unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()];
}

async function readPublishedAgenda(db, date) {
  const row = await db.get('SELECT matches FROM sports_agenda_manual WHERE date = ?', [date]);
  return row ? JSON.parse(row.matches) : null;
}

function registerSportsAdmin(app, db, requireAuth, getAutomaticAgenda, todayStr) {
  const route = (action) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await action(req, res);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error('Erro na configuração de jogos:', error.code || error.name);
      res.status(500).json({ error: 'Não foi possível acessar a configuração de jogos.' });
    }
  };

  app.get('/admin/sports/channels', requireAuth, route(async (req, res) => {
    const row = await db.get('SELECT channels FROM sports_channels WHERE id = 1');
    res.json({ channels: row ? JSON.parse(row.channels) : baseChannels });
  }));

  app.put('/admin/sports/channels', requireAuth, route(async (req, res) => {
    const channels = normalizeChannels(req.body?.channels);
    await db.run('INSERT OR REPLACE INTO sports_channels (id, channels) VALUES (1, ?)', [JSON.stringify(channels)]);
    res.json({ channels });
  }));

  app.get('/admin/sports/calendar', requireAuth, route(async (req, res) => {
    const date = req.query.date || todayStr();
    if (!isCalendarDate(date)) return res.status(400).json({ error: 'Selecione uma data válida.' });
    const published = await readPublishedAgenda(db, date);
    res.json({ date, manual: published !== null, matches: published ?? await getAutomaticAgenda(date) });
  }));

  app.put('/admin/sports/calendar/:date', requireAuth, route(async (req, res) => {
    const { date } = req.params;
    const values = req.body?.matches;
    if (!isCalendarDate(date) || !Array.isArray(values) || values.length > 120) {
      return res.status(400).json({ error: 'Informe uma data válida e até 120 jogos.' });
    }
    const previous = await readPublishedAgenda(db, date) ?? await getAutomaticAgenda(date);
    const byMatch = new Map(previous.map(match => [match.time + '|' + match.match, match]));
    const keys = new Set();
    const ids = new Set();
    let nextId = Math.max(0, ...previous.map(match => Number.isSafeInteger(match.id) ? match.id : 0)) + 1;
    const matches = values.map(entry => {
      const match = typeof entry?.match === 'string' ? entry.match.trim() : '';
      const league = typeof entry?.league === 'string' ? entry.league.trim() : '';
      const time = typeof entry?.time === 'string' ? entry.time : '';
      if (!match || match.length > 180 || league.length > 120 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        throw new TypeError('Preencha o jogo e o horário de cada partida.');
      }
      const key = time + '|' + match;
      if (keys.has(key)) throw new TypeError('Já existe uma partida igual nesse horário.');
      keys.add(key);
      const original = byMatch.get(key);
      const originalChannels = new Map((Array.isArray(original?.channels) ? original.channels : [])
        .map(channel => [(channelName(channel) || '').toLowerCase(), channel]));
      const channels = normalizeChannels(entry.channels).map(name => originalChannels.get(name.toLowerCase()) ?? name);
      const id = original?.id > 0 && !ids.has(original.id) ? original.id : nextId++;
      ids.add(id);
      return { leagueLogo: '', ...original, id, match, league, time, channels };
    }).sort((a, b) => a.time.localeCompare(b.time));
    await db.run(
      'INSERT OR REPLACE INTO sports_agenda_manual (date, matches) VALUES (?, ?)',
      [date, JSON.stringify(matches)]
    );
    res.json({ date, manual: true, matches });
  }));

  app.delete('/admin/sports/calendar/:date', requireAuth, route(async (req, res) => {
    const { date } = req.params;
    if (!isCalendarDate(date)) return res.status(400).json({ error: 'Selecione uma data válida.' });
    await db.run('DELETE FROM sports_agenda_manual WHERE date = ?', [date]);
    res.json({ date, manual: false, matches: await getAutomaticAgenda(date) });
  }));
}

module.exports = { readPublishedAgenda, registerSportsAdmin };

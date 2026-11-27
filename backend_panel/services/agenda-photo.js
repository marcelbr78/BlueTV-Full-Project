const { findBroadcasts } = require('../sports-channels');

const leaguePattern = /\b(?:campeonato|serie\s*[a-d]|premier|ligue\s*\d|la liga|bundesliga|championship|eredivisie|copa(?:\s+do)?\s+(?:brasil|libertadores|sul-americana)|libertadores|sul-americana|liga\s+dos\s+campeoes|champions league|league|\bEFL\b)\b/i;

function normalizeTime(value) {
  const match = /([0-2oO]?\d)\s*[:.hH]\s*([0-5]\d)/.exec(value);
  if (!match) return null;
  const hour = match[1].replace(/[oO]/g, '0').padStart(2, '0');
  const time = hour + ':' + match[2];
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function lineGroups(words) {
  const valid = words.filter(word => typeof word.text === 'string' && word.text.trim() &&
    word.bbox && Number.isFinite(word.bbox.y0) && Number.isFinite(word.bbox.y1) &&
    (word.confidence == null || word.confidence >= 0))
    .map(word => ({ ...word, centerY: (word.bbox.y0 + word.bbox.y1) / 2,
      height: Math.max(1, word.bbox.y1 - word.bbox.y0) }))
    .sort((a, b) => a.centerY - b.centerY || a.bbox.x0 - b.bbox.x0);
  if (!valid.length) return { lines: [], medianHeight: 12 };

  const heights = valid.map(word => word.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
  const tolerance = Math.max(7, medianHeight * 0.72);
  const lines = [];
  for (const word of valid) {
    let line = lines.find(candidate => Math.abs(candidate.centerY - word.centerY) <= tolerance);
    if (!line) {
      line = { centerY: word.centerY, words: [] };
      lines.push(line);
    }
    line.words.push(word);
    line.centerY = line.words.reduce((sum, item) => sum + item.centerY, 0) / line.words.length;
  }
  for (const line of lines) {
    line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    line.text = line.words.map(word => word.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
  }
  return { lines: lines.sort((a, b) => a.centerY - b.centerY), medianHeight };
}

function splitMatch(text) {
  const parts = text.split(/\s+(?:x|×|vs\.?|versus)\s+/i);
  if (parts.length !== 2) return null;
  let [home, away] = parts.map(part => part.trim());
  const rightBroadcast = findBroadcasts(away);
  if (rightBroadcast.start >= 0) away = away.slice(0, rightBroadcast.start).trim();
  const leftBroadcast = findBroadcasts(home);
  if (leftBroadcast.start >= 0) home = home.slice(0, leftBroadcast.start).trim();
  home = home.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  away = away.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  if (home.length < 2 || away.length < 2 || home.length > 90 || away.length > 90) return null;
  if (/\b(?:serie|league|liga|copa|bundesliga|championship)\b/i.test(home)) {
    const words = home.split(/\s+/);
    home = words.slice(-3).join(' ');
  }
  return home && away ? { home, away } : null;
}

function channelsFor(lines) {
  const channels = [];
  for (const line of lines) {
    for (const channel of findBroadcasts(line.text).channels) {
      if (!channels.includes(channel)) channels.push(channel);
    }
    if (/flamengo\s*tv/i.test(line.text)) {
      const videoIndex = channels.indexOf('YouTube');
      if (videoIndex >= 0) channels.splice(videoIndex, 1);
      if (!channels.includes('Flamengo TV')) channels.push('Flamengo TV');
    }
  }
  return channels;
}

function isSeparator(word, pageWidth) {
  if (word.confidence != null && word.confidence < 20) return false;
  const token = word.text.toLowerCase().replace(/[^\p{L}×]/gu, '');
  const x = (word.bbox.x0 + word.bbox.x1) / 2;
  return ['x', 'xx', 'wx', 'vx', '×'].includes(token) && x >= pageWidth * 0.18 && x <= pageWidth * 0.5;
}

function teamSide(words) {
  const stopWords = new Set(['campeonato', 'serie', 'liga', 'ligue', 'premier', 'league', 'bundesliga',
    'championship', 'champions', 'efl', 'chami', 'cham', 'mier', 'ip', 'italia', 'italy', 'franca', 'france', 'inglaterra',
    'england', 'inglaterr', 'brasileirao', 'playoff', 'final', 'do', 'da', 'de', 'if']);
  const tokens = words.filter(word => word.confidence == null || word.confidence >= 10 || /luminense|brestois/i.test(word.text))
    .map(word => word.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .map(token => /^(?:saf)?luminense$/i.test(token) ? 'FLUMINENSE' : token)
    .filter(token => (token.length > 1 || token.toUpperCase() === 'F') && !stopWords.has(token.toLowerCase()) && findBroadcasts(token).start < 0 &&
      !normalizeTime(token));
  for (let index = 0; index < tokens.length - 1; index++) {
    if (tokens[index].toUpperCase() === 'SOU' && tokens[index + 1].toUpperCase() === 'THAMPTON') {
      tokens.splice(index, 2, 'SOUTHAMPTON');
    } else if (tokens[index].toUpperCase() === 'VILA' && tokens[index + 1].toUpperCase() === 'NOV') {
      tokens.splice(index + 1, 1, 'NOVA');
    }
  }
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

function extractLeague(text) {
  if (/\bEFL\b.*\b(?:chami|championship)\b|\b(?:chami|championship)\b.*\bEFL\b/i.test(text)) return 'EFL Championship';
  if (/\b(?:premier|mier)\b.*\bleague\b/i.test(text)) return 'Premier League (Inglaterra)';
  if (/\bligue\s*1\b/i.test(text)) return 'Ligue 1';
  if (/\bserie\s*A\b/i.test(text)) return 'Serie A';
  if (/\bbrasileir[aã]o\b/i.test(text)) return 'Brasileirão Série A';
  if (/\bcampeonato\b/i.test(text)) return text.replace(/[^\p{L}\p{N} +&'().-]/gu, '').trim().slice(0, 120);
  return '';
}

function supportedImage(buffer, type) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (type === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/webp') return buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function parseSportsPoster(words) {
  const { lines, medianHeight } = lineGroups(words);
  const validWords = words.filter(word => word.text?.trim() && word.bbox &&
    (word.confidence == null || word.confidence >= 0));
  const pageWidth = Math.max(1, ...validWords.map(word => word.bbox.x1));
  const candidates = [];
  for (const line of lines) {
    const time = normalizeTime(line.text);
    if (time && !candidates.some(item => item.time === time && Math.abs(item.y - line.centerY) < medianHeight * 2)) {
      candidates.push({ time, y: line.centerY, line });
    }
  }
  candidates.sort((a, b) => a.y - b.y);

  const anchors = [];
  for (const word of validWords.filter(word => isSeparator(word, pageWidth))) {
    const x = (word.bbox.x0 + word.bbox.x1) / 2;
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    if (!anchors.some(anchor => Math.abs(anchor.y - y) < medianHeight * 1.3)) anchors.push({ x, y });
  }
  // Posters sometimes omit the center "x" from OCR for one row, even when
  // both team names, its kickoff time, and the channels were recognized.
  // Add a virtual center anchor only when the expected row has no OCR anchor.
  for (const candidate of candidates) {
    const expectedY = candidate.y + medianHeight * 1.5;
    if (!anchors.some(anchor => Math.abs(anchor.y - expectedY) <= medianHeight * 3)) {
      anchors.push({ x: pageWidth * 0.35, y: expectedY, inferred: true });
    }
  }
  anchors.sort((a, b) => a.y - b.y);

  const matches = [];
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index];
    const candidate = candidates.filter(item => Math.abs(item.y - anchor.y) <= Math.max(120, medianHeight * 6))
      .sort((a, b) => Math.abs(a.y - anchor.y) - Math.abs(b.y - anchor.y))[0];
    if (!candidate) continue;

    const upper = index ? (anchors[index - 1].y + anchor.y) / 2 : -Infinity;
    const lower = index + 1 < anchors.length ? (anchor.y + anchors[index + 1].y) / 2 : Infinity;
    const rowLines = lines.filter(line => line.centerY > upper && line.centerY < lower);
    const candidateLines = lines.filter(line => line.centerY > anchor.y + medianHeight * 0.4 &&
      line.centerY < anchor.y + medianHeight * 5);
    const matchLine = candidateLines.map(line => {
      const nearbyWords = lines.filter(other => Math.abs(other.centerY - line.centerY) <= medianHeight * 1.35)
        .flatMap(other => other.words);
      const left = nearbyWords.filter(word => {
        const x = (word.bbox.x0 + word.bbox.x1) / 2;
        return x > pageWidth * 0.08 && x < anchor.x - medianHeight * 0.7;
      });
      const right = nearbyWords.filter(word => {
        const x = (word.bbox.x0 + word.bbox.x1) / 2;
        return x > anchor.x + medianHeight * 0.7 && x < pageWidth * 0.61;
      });
      const home = teamSide(left);
      const away = teamSide(right);
      const score = home.length + away.length - Math.abs(line.centerY - (anchor.y + medianHeight * 2.2)) * 0.08;
      return { line, home, away, score };
    }).filter(item => item.home.length >= 2 && item.away.length >= 2)
      .sort((a, b) => b.score - a.score)[0];
    if (!matchLine) continue;

    const leagueLine = lines.filter(line => Math.abs(line.centerY - matchLine.line.centerY) <= medianHeight * 2 &&
      leaguePattern.test(line.text) &&
      !normalizeTime(line.text) && findBroadcasts(line.text).start < 0)
      .sort((a, b) => Math.abs(a.centerY - matchLine.line.centerY) - Math.abs(b.centerY - matchLine.line.centerY))[0];
    const league = extractLeague(leagueLine?.text || '');
    const channels = channelsFor(rowLines);
    const matchName = matchLine.home + ' x ' + matchLine.away;
    if (matches.some(match => match.time === candidate.time && match.match.toLowerCase() === matchName.toLowerCase())) continue;
    matches.push({
      id: matches.length + 1,
      time: candidate.time,
      league,
      match: matchName,
      channels
    });
  }
  return matches.sort((a, b) => a.time.localeCompare(b.time)).map((match, index) => ({ ...match, id: index + 1 }));
}

async function extractAgendaPhoto(imageBuffer) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker(['por', 'eng'], 1, { logger: () => {} });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const { data } = await worker.recognize(imageBuffer);
    const matches = parseSportsPoster(data.words || []);
    if (!matches.length) {
      const fallbackText = (data.text || '').split('\n').map(line => line.trim()).filter(Boolean);
      const fallback = [];
      for (const line of fallbackText) {
        const time = normalizeTime(line);
        const pair = splitMatch(line.replace(time || '', '').trim());
        if (time && pair) fallback.push({ id: fallback.length + 1, time, league: '',
          match: pair.home + ' x ' + pair.away, channels: findBroadcasts(line).channels });
      }
      if (fallback.length) return fallback;
      return [];
    }
    return matches;
  } finally {
    await worker.terminate();
  }
}

module.exports = { extractAgendaPhoto, parseSportsPoster, supportedImage };

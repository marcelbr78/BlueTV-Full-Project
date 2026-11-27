'use strict';
/**
 * agenda.js — coleta e processa a grade esportiva do @EsportesNaTV
 * Fonte: Nitter RSS → imagens PNG → Tesseract.js OCR → banco sports_agenda
 */

const https = require('https');
const http  = require('http');
const db    = require('../db');
const { findBroadcasts } = require('../sports-channels');
const { findSeteAgenda, downloadSeteImage, validDate } = require('./sete-agenda');

// ─── Nitter (instâncias fallback) ─────────────────────────────────────────────
const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
];

// ─── Fetch HTTP/HTTPS ─────────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BlueTV/1.0)',
        'Accept': '*/*',
      },
    };
    const req = mod.get(url, opts, res => {
      // Segue redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Nitter RSS ───────────────────────────────────────────────────────────────
async function fetchNitterRss(username) {
  for (const instance of NITTER_INSTANCES) {
    try {
      const buf = await fetchUrl(`${instance}/${username}/rss`);
      const xml = buf.toString('utf8');
      if (xml.includes('<item>')) {
        console.log(`📡 Nitter OK: ${instance}`);
        return xml;
      }
    } catch (e) {
      console.warn(`📡 Nitter falhou (${instance}): ${e.message}`);
    }
  }
  throw new Error('Todos os Nitter falharam');
}

function parseDateFromTitle(title) {
  // "A agenda esportiva deste SÁBADO (18/04/2026)"
  const m = /\((\d{2})\/(\d{2})\/(\d{4})\)/.exec(title);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`; // YYYY-MM-DD
}

function extractImageUrls(description) {
  const urls = [];
  const re = /src="([^"]+(?:\.png|\.jpg)[^"]*)"/gi;
  let m;
  while ((m = re.exec(description)) !== null) {
    urls.push(m[1]);
  }
  return urls;
}

function findAgendaPost(xml, targetDate) {
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    const titleM = /<title>([^<]+)<\/title>/.exec(item);
    if (!titleM) continue;

    const title = titleM[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    // Ignora RTs e posts sem "agenda esportiva"
    if (!title.toLowerCase().includes('agenda esportiva')) continue;

    const postDate = parseDateFromTitle(title);
    if (postDate !== targetDate) continue;

    const descM = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(item);
    const desc = descM ? descM[1] : '';
    const imageUrls = extractImageUrls(desc);

    return { title, date: postDate, imageUrls };
  }
  return null;
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
async function ocrImage(imageBuffer) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker(['por', 'eng'], 1, {
    logger: () => {}, // silencia logs de progresso
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const { data: { text } } = await worker.recognize(imageBuffer);
    return text;
  } finally {
    await worker.terminate();
  }
}

// ─── Parser OCR ───────────────────────────────────────────────────────────────
function parseOcrText(text) {
  const results = [];
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 8);

  const TIME_RE = /^([0-2Oo][0-9Oo])[hHnN:](\d{2})\s*/;

  for (const line of lines) {
    const tm = TIME_RE.exec(line);
    if (!tm) continue;

    const time = `${tm[1].replace(/o/gi, '0')}:${tm[2]}`;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const rest = line.slice(tm[0].length).trim();

    // Encontra " x " (separador do confronto)
    const xMatch = /\s+[xX]\s+/.exec(rest);
    if (!xMatch) continue;

    const beforeX = rest.slice(0, xMatch.index).trim();
    const afterX  = rest.slice(xMatch.index + xMatch[0].length).trim();

    // ── Detecta canal no final de afterX ─────────────────────────────────────
    const broadcast = findBroadcasts(afterX);
    let teamB = broadcast.start < 0 ? afterX : afterX.slice(0, broadcast.start);
    teamB = teamB.trim().replace(/[,;.\s]+$/, '');

    // ── Separa liga e time A em beforeX ──────────────────────────────────────
    const words = beforeX.split(/\s+/).filter(Boolean);
    let teamA = beforeX;
    let league = '';

    if (words.length >= 3) {
      // Heurística: últimas 2 palavras = time A, resto = liga
      teamA  = words.slice(-2).join(' ');
      league = words.slice(0, -2).join(' ');
    } else if (words.length === 2) {
      teamA  = words[1];
      league = words[0];
    }

    teamA = teamA.trim().replace(/^[-–\s]+/, '');
    teamB = teamB.trim().replace(/^[-–\s]+/, '');

    if (!teamA || !teamB) continue;

    const channels = broadcast.channels;

    results.push({
      id:         results.length + 1,
      time,
      league:     league || '',
      leagueLogo: '',
      match:      `${teamA} x ${teamB}`,
      channels,
    });
  }

  return results;
}

async function getAgendaDraft(date) {
  const row = await db.get('SELECT matches, source_key, source_url FROM sports_agenda_draft WHERE date = ?', [date]);
  return row ? { matches: JSON.parse(row.matches), key: row.source_key, source: row.source_url } : null;
}

const draftImports = new Map();
async function importSeteDraft(date) {
  const existing = draftImports.get(date);
  if (existing) return existing;
  const importing = (async () => {
    const cached = await getAgendaDraft(date);
    const post = await findSeteAgenda(date).catch(error => {
      console.warn('Fonte Sete nos Esportes indisponível:', error.message);
      return null;
    });
    if (!post || cached?.key === post.key) return cached;
    const matches = [];
    for (const image of post.imageUrls) {
      const text = await ocrImage(await downloadSeteImage(image));
      matches.push(...parseOcrText(text));
    }
    const seen = new Set();
    const unique = matches.filter(match => {
      const key = match.time + '|' + match.match.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((match, index) => ({ ...match, id: index + 1 }));
    if (!unique.length) return cached;
    await db.run(
      'INSERT OR REPLACE INTO sports_agenda_draft (date, matches, source_key, source_url) VALUES (?, ?, ?, ?)',
      [date, JSON.stringify(unique), post.key, post.url]
    );
    return { matches: unique, key: post.key, source: post.url };
  })();
  draftImports.set(date, importing);
  try {
    return await importing;
  } finally {
    draftImports.delete(date);
  }
}

// ─── Sync principal ───────────────────────────────────────────────────────────
async function syncAgenda(targetDate) {
  console.log(`📅 Sincronizando agenda: ${targetDate}`);
  if (!validDate(targetDate)) return null;
  try {
    const draft = await importSeteDraft(targetDate).catch(error => {
      console.error('Falha ao preparar rascunho da agenda:', error.message);
      return getAgendaDraft(targetDate).catch(() => null);
    });
    if (draft) return draft.matches;

    // Busca RSS
    const xml = await fetchNitterRss('EsportesNaTV');

    // Encontra post do dia
    const post = findAgendaPost(xml, targetDate);
    if (!post) {
      console.log(`📅 Nenhum post de agenda para ${targetDate}`);
      return null;
    }

    // Verifica se já processamos esse post
    const existing = await db.get(
      'SELECT post_id FROM sports_agenda WHERE date = ?', [targetDate]
    );
    if (existing && existing.post_id === post.title) {
      console.log(`📅 Agenda ${targetDate} já está atualizada`);
      return await getAgendaForDate(targetDate);
    }

    if (post.imageUrls.length === 0) {
      console.log(`📅 Post de ${targetDate} sem imagens`);
      return null;
    }

    console.log(`📅 ${post.imageUrls.length} imagem(ns), iniciando OCR...`);

    // OCR de cada imagem
    const allMatches = [];
    for (let i = 0; i < post.imageUrls.length; i++) {
      try {
        console.log(`📅 OCR imagem ${i + 1}/${post.imageUrls.length}...`);
        const buf    = await fetchUrl(post.imageUrls[i]);
        const text   = await ocrImage(buf);
        const parsed = parseOcrText(text);
        console.log(`📅 Imagem ${i + 1}: ${parsed.length} jogo(s)`);
        allMatches.push(...parsed);
      } catch (e) {
        console.error(`📅 Erro OCR imagem ${i + 1}:`, e.message);
      }
    }

    if (allMatches.length === 0) return null;

    // Re-numera IDs
    allMatches.forEach((m, i) => { m.id = i + 1; });

    // Salva no banco
    await db.run(
      'INSERT OR REPLACE INTO sports_agenda (date, matches, post_id, created_at) VALUES (?, ?, ?, ?)',
      [targetDate, JSON.stringify(allMatches), post.title, Date.now()]
    );

    console.log(`📅 Agenda ${targetDate} salva: ${allMatches.length} jogo(s)`);
    return allMatches;

  } catch (e) {
    console.error(`📅 Erro syncAgenda(${targetDate}):`, e.message);
    return null;
  }
}

async function getAgendaForDate(date) {
  try {
    const row = await db.get('SELECT matches FROM sports_agenda WHERE date = ?', [date]);
    if (!row) return [];
    return JSON.parse(row.matches);
  } catch (e) {
    return [];
  }
}

// ─── Helpers de data ──────────────────────────────────────────────────────────
const calendarDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

function todayStr() {
  return calendarDate.format(new Date());
}

function tomorrowStr() {
  return calendarDate.format(new Date(Date.now() + 86_400_000));
}

let upcomingSync = false;
async function syncUpcomingDrafts() {
  if (upcomingSync) return;
  upcomingSync = true;
  try {
    const start = new Date(todayStr());
    for (let offset = 0; offset <= 2; offset++) {
      const date = new Date(+start + offset * 86_400_000).toISOString().slice(0, 10);
      await importSeteDraft(date).catch(error => {
        console.error('Falha ao atualizar rascunho de ' + date + ':', error.message);
      });
    }
  } finally {
    upcomingSync = false;
  }
}

module.exports = { syncAgenda, syncUpcomingDrafts, getAgendaForDate, getAgendaDraft, todayStr, tomorrowStr };

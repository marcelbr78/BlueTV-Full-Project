'use strict';
/**
 * agenda.js — coleta e processa a grade esportiva do @EsportesNaTV
 * Fonte: Nitter RSS → imagens PNG → Tesseract.js OCR → banco sports_agenda
 */

const https = require('https');
const http  = require('http');
const db    = require('../db');

// ─── Nitter (instâncias fallback) ─────────────────────────────────────────────
const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
];

// ─── Canais IPTV conhecidos (ordem importa: mais específico primeiro) ─────────
const IPTV_CHANNELS = [
  'ESPN 5', 'ESPN5',
  'ESPN 4', 'ESPN4',
  'ESPN 3', 'ESPN3',
  'ESPN 2', 'ESPN2',
  'ESPN',
  'SPORTV 3', 'SPORTV3',
  'SPORTV 2', 'SPORTV2',
  'SPORTV',
  'BANDSPORTS', 'BAND SPORTS',
  'BAND',
  'XSPORTS',
  'PREMIERE',
  'COMBATE',
  'TNT', 'MAX',
  'RECORD',
  'SBT',
  'GLOBO',
  'SPACE',
];

// ─── Streaming (filtrar — não estão no IPTV) ──────────────────────────────────
const STREAMING_KEYWORDS = [
  'youtube', 'prime video', 'disney+', 'globoplay', 'dazn',
  'cazé', 'uol esporte', 'metrópoles', 'paulistão',
  'sportynet', 'goat', 'espn brasil', 'nbc', 'canal goat',
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

// ─── Normalização de canais ───────────────────────────────────────────────────
function normalizeChannel(raw) {
  let name = raw.trim();
  // Remove indicadores de qualidade
  name = name.replace(/\s*(FHD²?|HD²?|SD²?|4K)\s*/gi, '').trim();
  // ESPN2 → ESPN 2, SPORTV2 → SPORTV 2
  name = name.replace(/^(ESPN|SPORTV)(\d+)$/i, (_, a, b) => `${a.toUpperCase()} ${b}`);
  return name.trim();
}

function isStreaming(channel) {
  const lower = channel.toLowerCase();
  return STREAMING_KEYWORDS.some(kw => lower.includes(kw));
}

function extractChannels(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split(',')
    .map(p => normalizeChannel(p.trim()))
    .filter(p => p.length > 0 && !isStreaming(p));
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
  const { data: { text } } = await worker.recognize(imageBuffer);
  await worker.terminate();
  return text;
}

// ─── Parser OCR ───────────────────────────────────────────────────────────────
function parseOcrText(text) {
  const results = [];
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 8);

  const TIME_RE = /^(\d{2})[hH:](\d{2})\s*/;

  for (const line of lines) {
    const tm = TIME_RE.exec(line);
    if (!tm) continue;

    const time = `${tm[1]}:${tm[2]}`;
    const rest = line.slice(tm[0].length).trim();

    // Encontra " x " (separador do confronto)
    const xMatch = /\s+[xX]\s+/.exec(rest);
    if (!xMatch) continue;

    const beforeX = rest.slice(0, xMatch.index).trim();
    const afterX  = rest.slice(xMatch.index + xMatch[0].length).trim();

    // ── Detecta canal no final de afterX ─────────────────────────────────────
    let teamB     = afterX;
    let channelRaw = '';

    // Procura pelo primeiro canal IPTV conhecido em afterX
    for (const ch of IPTV_CHANNELS) {
      const re = new RegExp(`\\b${ch.replace(/\s+/g, '\\s+')}\\b`, 'i');
      const idx = afterX.search(re);
      if (idx !== -1) {
        teamB      = afterX.slice(0, idx).trim().replace(/[,;.\s]+$/, '');
        channelRaw = afterX.slice(idx).trim();
        break;
      }
    }

    // Se não achou canal IPTV, pelo menos remove streaming do teamB
    if (!channelRaw) {
      for (const kw of STREAMING_KEYWORDS) {
        const idx = teamB.toLowerCase().indexOf(kw);
        if (idx !== -1) {
          teamB = teamB.slice(0, idx).trim().replace(/[,;.\s]+$/, '');
          break;
        }
      }
    }

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

    const channels = extractChannels(channelRaw);

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

// ─── Sync principal ───────────────────────────────────────────────────────────
async function syncAgenda(targetDate) {
  console.log(`📅 Sincronizando agenda: ${targetDate}`);
  try {
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
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

module.exports = { syncAgenda, getAgendaForDate, todayStr, tomorrowStr };

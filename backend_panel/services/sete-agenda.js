const host = 'setenosesportes.com.br';
const fields = 'id,link,date,modified,title,content';
const weekdays = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

async function fetchFromSite(url) {
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) {
    throw new Error('Endereço inesperado na fonte da agenda.');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Fonte respondeu HTTP ' + response.status);
  return response;
}

function selectImages(html) {
  const images = [];
  // Only use images in the article body that credits the @EsportesNaTV programming.
  const credit = /Arte\s*:\s*(?:<[^>]+>\s*)*@esportesnatv/i;
  if (!credit.test(html)) return images;
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = /\bsrc=["']([^"']+)/i.exec(tag)?.[1];
    const srcset = /\bsrcset=["']([^"']+)/i.exec(tag)?.[1] || '';
    const ranked = srcset.split(',').map(entry => entry.trim().split(/\s+/))
      .sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0));
    for (const candidate of [...ranked.map(entry => entry[0]), src]) {
      if (!candidate) continue;
      let image;
      try { image = new URL(candidate); } catch { continue; }
      if (image.hostname === host && image.protocol === 'https:' &&
          /^\/wp-content\/uploads\/.*\.(jpg|jpeg|png|webp)$/i.test(image.pathname)) {
        images.push(image);
        break;
      }
    }
  }
  return images.slice(0, 8);
}

async function findSeteAgenda(date) {
  if (!validDate(date)) return null;
  const day = new Date(date);
  const [year, month, number] = date.split('-');
  const slug = 'agenda-esportiva-para-' + weekdays[day.getUTCDay()] + '-dia-' + number + '-' + month;
  const url = new URL('/wp-json/wp/v2/posts', 'https://' + host);
  url.search = new URLSearchParams({ slug, _fields: fields });
  let rows = await (await fetchFromSite(url)).json();
  const matchesDate = row => {
    const title = row.title?.rendered || '';
    const match = /\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?/g;
    return /agenda esportiva/i.test(title) && row.date?.startsWith(year + '-') &&
      [...title.matchAll(match)].some(item => Number(item[1]) === Number(number) &&
        Number(item[2]) === Number(month) && (!item[3] || item[3] === year));
  };
  if (!rows.some(matchesDate)) {
    const neighboringDay = offset => new Date(+day + offset * 86_400_000).toISOString().slice(0, 10);
    url.search = new URLSearchParams({
      search: 'agenda esportiva', after: neighboringDay(-2) + 'T00:00:00',
      before: neighboringDay(1) + 'T23:59:59', per_page: '20', _fields: fields
    });
    rows = await (await fetchFromSite(url)).json();
  }
  const post = rows.find(matchesDate);
  if (!post) return null;
  const imageUrls = selectImages(post.content?.rendered || '');
  if (!imageUrls.length) return null;
  return { key: 'sete:' + post.id + ':' + post.modified, url: post.link, imageUrls };
}

async function downloadSeteImage(url) {
  const response = await fetchFromSite(url);
  if (!/^image\/(jpeg|png|webp)\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error('A publicação não retornou uma imagem de programação.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('Imagem de programação acima do limite.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { findSeteAgenda, downloadSeteImage, validDate };

/**
 * BlueTV Backend — parser.js
 * 
 * Extrai credenciais Xtream de mensagens do BotBot/Painel IPTV.
 * Suporta mensagens do painel Megga IPTV e similares.
 * Funciona tanto com mensagens multi-linha quanto numa linha só (formato WhatsApp).
 */

function parseXtreamMessage(message) {
  if (!message || typeof message !== 'string') {
    return { success: false, error: 'Mensagem inválida ou vazia' };
  }

  const result = {
    success: false,
    host: null,
    username: null,
    password: null,
    m3u_url: null,
    epg_url: null,
    plano: null,
    validade: null,
    criado_em: null,
    preco: null,
    conexoes: null,
    raw: message
  };

  const hostPatterns = [
    /Dns\/Url\s*:\s*(https?:\/\/[^\s\n│├╰╭|*_~`]+)/i,
    /DNS\s*:\s*(https?:\/\/[^\s\n│├╰╭|*_~`]+)/i,
    /📡[^\n]*:\s*(https?:\/\/[^\s\n│├╰╭|*_~`]+)/i,
  ];
  for (const p of hostPatterns) {
    const m = message.match(p);
    if (m) { result.host = m[1].trim(); break; }
  }

  const userPatterns = [
    /USU[AÁ]RIO\s*:\s*([^\s\n│├╰╭|*_~`]+)/i,
    /User(?:name)?\s*:\s*([^\s\n│├╰╭|*_~`]+)/i,
    /👤[^\n:]*:\s*([^\s\n│├╰╭|*_~`]+)/i,
  ];
  for (const p of userPatterns) {
    const m = message.match(p);
    if (m) { result.username = m[1].trim(); break; }
  }

  const passPatterns = [
    /SENHA\s*:\s*([^\s\n│├╰╭|*_~`]+)/i,
    /Password\s*:\s*([^\s\n│├╰╭|*_~`]+)/i,
    /🔐[^\n:]*:\s*([^\s\n│├╰╭|*_~`]+)/i,
  ];
  for (const p of passPatterns) {
    const m = message.match(p);
    if (m) { result.password = m[1].trim(); break; }
  }

  const m3uMatch = message.match(/(https?:\/\/[^\s*_~`]+get\.php\?[^\s*_~`]+type=m3u[^\s*_~`]*)/i)
    || message.match(/M3U\)[^\n:]*:\s*\*?\s*(https?:\/\/[^\s*_~`]+)/i);
  if (m3uMatch) result.m3u_url = m3uMatch[1].trim();

  const epgMatch = message.match(/EPG[^\n:]*:\s*\*?\s*(https?:\/\/[^\s*_~`]+)/i);
  if (epgMatch) result.epg_url = epgMatch[1].trim();

  const planoMatch = message.match(/Plano[*_\s]*:\s*\*?\s*([^*╭├╰📦💵📶🟢\n]{3,40})/i);
  if (planoMatch) result.plano = planoMatch[1].trim().replace(/[*_~`]/g, '').trim();

  const validadeMatch = message.match(/Vencimento[*_\s]*:\s*\*?\s*([\d\/\s:]+)/i)
    || message.match(/Validade[*_\s]*:\s*\*?\s*([\d\/\s:]+)/i);
  if (validadeMatch) result.validade = validadeMatch[1].trim();

  const criadoMatch = message.match(/Criado\s*em[*_\s]*:\s*\*?\s*([\d\/\s:]+)/i);
  if (criadoMatch) result.criado_em = criadoMatch[1].trim();

  const precoMatch = message.match(/Pre[çc]o[^:]*:\s*\*?\s*(R\$\s*[\d.,]+)/i)
    || message.match(/(R\$\s*[\d.,]+)/);
  if (precoMatch) result.preco = (precoMatch[1] || precoMatch[0]).trim().replace(/[*_~`]/g, '').trim();

  const conexoesMatch = message.match(/Conex[õo]es[*_\s]*:\s*\*?\s*(\d+)/i);
  if (conexoesMatch) result.conexoes = parseInt(conexoesMatch[1], 10);

  if (result.host && result.username && result.password) {
    result.success = true;
    if (!result.m3u_url) {
      result.m3u_url = `${result.host}/get.php?username=${result.username}&password=${result.password}&type=m3u_plus&output=mpegts`;
    }
    if (!result.epg_url) {
      result.epg_url = `${result.host}/xmltv.php?username=${result.username}&password=${result.password}`;
    }
  } else {
    const missing = [];
    if (!result.host) missing.push('DNS/Host');
    if (!result.username) missing.push('Usuário');
    if (!result.password) missing.push('Senha');
    result.error = `Campos não encontrados: ${missing.join(', ')}`;
  }

  return result;
}

function isXtreamResponse(message) {
  if (!message || typeof message !== 'string') return false;
  const signals = [
    /dns\/url/i, /usu[aá]rio/i, /senha/i,
    /get\.php\?username=/i, /m3u_plus/i,
    /vencimento/i, /plano:/i, /📡/, /👤/, /🔐/,
  ];
  return signals.filter(p => p.test(message)).length >= 2;
}

function extractM3uUrl(message) {
  if (!message) return null;
  const m = message.match(/(https?:\/\/[^\s*_~`]+get\.php\?[^\s*_~`]+type=m3u[^\s*_~`]*)/i);
  if (m) return m[1].trim();
  const parsed = parseXtreamMessage(message);
  return parsed.success ? parsed.m3u_url : null;
}

function parseAtivarTesteCommand(message) {
  if (!message || typeof message !== 'string') return { success: false };
  const match = message.trim().match(/^ATIVAR[_\s]TESTE\s+(\S+)\s+(\S+)$/i);
  if (match) return { success: true, login: match[1].trim(), senha: match[2].trim() };
  return { success: false };
}

function parseClientIdFromMessage(message) {
  if (!message || typeof message !== 'string') return null;
  const match = message.match(/BLUETV-([A-Z0-9]{5})/i);
  if (match) return match[0].toUpperCase();
  return null;
}

module.exports = { 
  parseXtreamMessage, 
  isXtreamResponse, 
  extractM3uUrl, 
  parseAtivarTesteCommand,
  parseClientIdFromMessage
};

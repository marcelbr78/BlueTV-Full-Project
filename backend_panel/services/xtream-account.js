const { lookup } = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');

const nonPublicIpv4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3]
]) nonPublicIpv4.addSubnet(network, prefix);

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const specialIpv6 = new BlockList();
specialIpv6.addSubnet('2001::', 23, 'ipv6');
specialIpv6.addSubnet('2001:db8::', 32, 'ipv6');
specialIpv6.addSubnet('2002::', 16, 'ipv6');

function isPublicAddress(address) {
  if (isIP(address) === 4) return !nonPublicIpv4.check(address);
  return isIP(address) === 6 && globalIpv6.check(address, 'ipv6') && !specialIpv6.check(address, 'ipv6');
}

function lookupProvider(host, options, callback) {
  lookup(host, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    const usable = addresses.filter(({ address }) => isPublicAddress(address));
    if (!usable.length) return callback(new Error('Endereço do provedor indisponível'));
    if (options.all) return callback(null, usable);
    callback(null, usable[0].address, usable[0].family);
  });
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });

function expiryDate(value) {
  const raw = String(value ?? '').trim();
  if (/^[1-9]\d{9}$/.test(raw)) return dateFormat.format(Number(raw) * 1000);
  if (/^[1-9]\d{12}$/.test(raw)) return dateFormat.format(Number(raw));
  return null;
}

async function checkXtreamAccount(account) {
  const start = Date.now();
  try {
    const host = account.host.trim();
    const url = new URL(host.includes('://') ? host : 'http://' + host);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (isIP(hostname) && !isPublicAddress(hostname))) {
      return { ok: false, error: 'Endereço do provedor inválido' };
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + '/player_api.php';
    url.search = new URLSearchParams({ username: account.username, password: account.password }).toString();
    url.hash = '';

    const transport = url.protocol === 'https:' ? https : http;
    const response = await new Promise((resolve, reject) => {
      const request = transport.get(url, {
        agent: false, lookup: lookupProvider, signal: AbortSignal.timeout(8000)
      }, resolve);
      request.on('error', reject);
    });
    const statusCode = response.statusCode;
    if (statusCode < 200 || statusCode >= 300) {
      response.destroy();
      return { ok: false, statusCode, error: 'O provedor respondeu com HTTP ' + statusCode };
    }

    response.setEncoding('utf8');
    let body = '';
    for await (const chunk of response) {
      body += chunk;
      if (body.length > 256 * 1024) throw new Error('Resposta muito grande');
    }
    let user;
    try {
      user = JSON.parse(body)?.user_info;
    } catch {
      return { ok: false, statusCode, error: 'Resposta inválida da API do provedor' };
    }
    if (!user || ![1, '1', true].includes(user.auth)) {
      return { ok: false, statusCode, error: 'O provedor não confirmou a conta' };
    }
    return { ok: true, statusCode, ms: Date.now() - start, host: account.host, validade: expiryDate(user.exp_date) };
  } catch (error) {
    return { ok: false, ms: null, error: error.name === 'AbortError'
      ? 'O provedor não respondeu a tempo' : 'Não foi possível consultar o provedor' };
  }
}

module.exports = { checkXtreamAccount };

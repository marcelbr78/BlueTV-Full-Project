const express = require('express');

const connectionStates = new Map([
  ['open', 'connected'],
  ['connecting', 'connecting'],
  ['close', 'disconnected']
]);

class EvolutionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getConfig() {
  const address = process.env.EVOLUTION_API_URL?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!address || !apiKey) {
    throw new EvolutionError(503, 'Configure o endereço e a chave do Evolution no servidor BlueTV.');
  }

  let url;
  try {
    url = new URL(address);
  } catch {
    throw new EvolutionError(503, 'Configure um endereço HTTPS válido para o Evolution.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new EvolutionError(503, 'Configure um endereço HTTPS válido para o Evolution.');
  }
  return { baseUrl: url.href.replace(/\/+$/, ''), apiKey, instanceName: process.env.EVOLUTION_INSTANCE?.trim() };
}

async function requestEvolution(config, path, query) {
  const url = new URL(config.baseUrl + path);
  if (query) url.search = new URLSearchParams(query).toString();

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', apikey: config.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(9000)
    });
  } catch {
    throw new EvolutionError(502, 'Evolution indisponível. Confira se o serviço está rodando no Render.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new EvolutionError(502, 'O Evolution recusou a chave configurada no servidor BlueTV.');
  }
  if (!response.ok) {
    throw new EvolutionError(502, 'O Evolution retornou um erro. Confira o estado do serviço e da instância.');
  }

  try {
    return await response.json();
  } catch {
    throw new EvolutionError(502, 'A resposta do Evolution é inválida. Confira o endereço da API.');
  }
}

function instanceSummary(entry) {
  const instance = entry?.instance || entry;
  const name = instance?.instanceName || instance?.name;
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..') return null;
  const state = instance.state || instance.status || instance.connectionStatus;
  const owner = instance.ownerJid || instance.owner;
  const phone = typeof owner === 'string' ? /^(\d{7,15})(?::\d+)?@s\.whatsapp\.net$/.exec(owner)?.[1] : null;
  return { name, state: connectionStates.get(state) || 'unknown', phone: phone || null };
}

async function listInstances(config) {
  const data = await requestEvolution(config, '/instance/fetchInstances',
    config.instanceName ? { instanceName: config.instanceName } : undefined);
  if (!Array.isArray(data) && !data?.instance && !data?.name) {
    throw new EvolutionError(502, 'O Evolution não retornou a lista de instâncias.');
  }

  const entries = Array.isArray(data) ? data : [data];
  const instances = entries.map(instanceSummary).filter(Boolean);
  if (!config.instanceName) return instances;

  const configuredInstance = instances.filter(({ name }) => name === config.instanceName);
  if (configuredInstance.length) return configuredInstance;

  // EVOLUTION_INSTANCE can become stale after an instance is recreated or renamed.
  // Retry without the filter so the admin can select the real instance and pair it.
  const allData = await requestEvolution(config, '/instance/fetchInstances');
  if (!Array.isArray(allData) && !allData?.instance && !allData?.name) {
    throw new EvolutionError(502, 'O Evolution não retornou a lista de instâncias.');
  }
  const allEntries = Array.isArray(allData) ? allData : [allData];
  return allEntries.map(instanceSummary).filter(Boolean);
}

function getPairingDetails(data, phone) {
  const pairing = data?.qrcode ?? data;
  if (phone) {
    const code = pairing?.pairingCode;
    if (typeof code === 'string' && /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(code)) {
      return { code };
    }
    throw new EvolutionError(409, 'O Evolution ainda não retornou o código. Tente novamente ou use o QR Code.');
  }

  const image = pairing?.base64;
  if (typeof image === 'string' && image.length <= 1_000_000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    return { image };
  }
  throw new EvolutionError(409, 'O Evolution ainda não retornou o QR Code. Aguarde alguns segundos e tente novamente.');
}

function sendResult(handler) {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      if (error instanceof EvolutionError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(502).json({ error: 'Não foi possível consultar o Evolution.' });
    }
  };
}

module.exports = function registerEvolutionAdmin(app, requireAuth) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireAuth);

  router.get('/instances', sendResult(async () => ({
    instances: await listInstances(getConfig())
  })));

  router.post('/pair', sendResult(async req => {
    if (!req.is('application/json')) throw new EvolutionError(415, 'Envie a solicitação de pareamento em JSON.');

    const { instance, phone } = req.body || {};
    if (typeof instance !== 'string' || !instance) throw new EvolutionError(400, 'Escolha a instância do BlueTV.');
    if (phone !== undefined && (typeof phone !== 'string' || !/^[1-9]\d{6,14}$/.test(phone))) {
      throw new EvolutionError(400, 'Informe o número com código do país e DDD.');
    }

    const config = getConfig();
    const selected = (await listInstances(config)).find(({ name }) => name === instance);
    if (!selected) throw new EvolutionError(404, 'Instância do Evolution não encontrada.');
    if (selected.state === 'connected') return { connected: true };

    const data = await requestEvolution(config, '/instance/connect/' + encodeURIComponent(selected.name),
      phone ? { number: phone } : undefined);
    if (data?.instance?.state === 'open' || data?.instance?.status === 'open') return { connected: true };
    return getPairingDetails(data, phone);
  }));

  app.use('/admin/evolution', router);
};

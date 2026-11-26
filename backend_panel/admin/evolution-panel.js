window.evolutionPanel = (() => {
  const fields = Object.fromEntries([
    'Refresh', 'InstanceRow', 'Instance', 'Status', 'PairControls', 'ShowQr', 'PhoneForm',
    'Phone', 'Challenge', 'Instructions', 'Qr', 'Code', 'Feedback'
  ].map(name => [name, document.getElementById('evolution' + name)]));
  const stateLabels = {
    connected: 'WhatsApp conectado',
    connecting: 'Aguardando conexão',
    disconnected: 'WhatsApp desconectado',
    unknown: 'Estado da conexão indisponível'
  };
  let instances = [];
  let activeRequest;
  let pollTimer;
  let pairingDeadline;

  function clearPairing() {
    clearTimeout(pollTimer);
    pairingDeadline = null;
    fields.Challenge.hidden = true;
    fields.Qr.hidden = true;
    fields.Qr.removeAttribute('src');
    fields.Code.hidden = true;
    fields.Code.textContent = '';
  }

  function renderStatus() {
    const instance = instances.find(({ name }) => name === fields.Instance.value);
    fields.InstanceRow.hidden = !instances.length;
    fields.PairControls.hidden = !instance || instance.state === 'connected';
    if (!instance) {
      fields.Status.textContent = 'Nenhuma instância encontrada no Evolution.';
      return;
    }
    const { state, phone } = instance;
    fields.Status.textContent = phone ? stateLabels[state] + ' · +' + phone : stateLabels[state];
    if (state === 'connected' && pairingDeadline) {
      clearPairing();
      fields.Feedback.textContent = 'Pareamento concluído.';
    }
  }

  async function consult(path, signal, data) {
    const response = await fetch('/admin/evolution/' + path, {
      signal,
      cache: 'no-store',
      ...(data && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    });
    if (response.status === 401) {
      window.location.assign('/admin/login.html');
      return null;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Falha ao acessar o Evolution.');
    return result;
  }

  function setBusy(busy) {
    fields.Refresh.disabled = busy;
    fields.Instance.disabled = busy;
    fields.ShowQr.disabled = busy;
    fields.PhoneForm.querySelector('button').disabled = busy;
  }

  async function run(action) {
    if (activeRequest) return;
    const controller = new AbortController();
    activeRequest = controller;
    setBusy(true);
    try {
      await action(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) fields.Feedback.textContent = error.message;
    } finally {
      if (activeRequest === controller) {
        activeRequest = null;
        setBusy(false);
      }
    }
  }

  async function updateInstances(signal) {
    const result = await consult('instances', signal);
    if (!result || signal.aborted) return;
    const selected = fields.Instance.value;
    instances = result.instances;
    fields.Instance.replaceChildren(...instances.map(({ name }) => new Option(name, name)));
    if (instances.some(({ name }) => name === selected)) {
      fields.Instance.value = selected;
    } else {
      clearPairing();
    }
    fields.Feedback.textContent = '';
    renderStatus();
  }

  function refresh() {
    return run(async signal => {
      fields.Feedback.textContent = '';
      fields.Status.textContent = 'Consultando o Evolution…';
      try {
        await updateInstances(signal);
      } catch (error) {
        if (!signal.aborted) {
          fields.Status.textContent = 'Conexão indisponível';
          fields.PairControls.hidden = true;
        }
        throw error;
      }
    });
  }

  function scheduleStatusCheck() {
    clearTimeout(pollTimer);
    if (!pairingDeadline) return;
    if (Date.now() >= pairingDeadline) {
      clearPairing();
      fields.Feedback.textContent = 'Se o pareamento não foi concluído, gere um novo código.';
      return;
    }
    pollTimer = setTimeout(async () => {
      await run(updateInstances);
      scheduleStatusCheck();
    }, 4000);
  }

  function pair(phone) {
    return run(async signal => {
      clearPairing();
      fields.Feedback.textContent = 'Gerando código de pareamento…';
      const result = await consult('pair', signal, { instance: fields.Instance.value, phone });
      if (!result || signal.aborted) return;
      if (result.connected) {
        await updateInstances(signal);
        return;
      }

      fields.Feedback.textContent = '';
      if (result.image) {
        fields.Instructions.textContent = 'No celular, abra o WhatsApp e vá em Dispositivos conectados → Conectar dispositivo. Escaneie este QR Code.';
        fields.Qr.src = result.image;
        fields.Qr.hidden = false;
      } else {
        fields.Instructions.textContent = 'No WhatsApp, vá em Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone e digite este código.';
        fields.Code.textContent = result.code;
        fields.Code.hidden = false;
      }
      fields.Challenge.hidden = false;
      pairingDeadline = Date.now() + 90_000;
      scheduleStatusCheck();
    });
  }

  fields.Refresh.addEventListener('click', refresh);
  fields.Instance.addEventListener('change', () => {
    clearPairing();
    fields.Feedback.textContent = '';
    renderStatus();
  });
  fields.ShowQr.addEventListener('click', () => pair());
  fields.PhoneForm.addEventListener('submit', event => {
    event.preventDefault();
    const phone = fields.Phone.value.replace(/[+()\s-]/g, '');
    if (!/^[1-9]\d{6,14}$/.test(phone)) {
      fields.Feedback.textContent = 'Informe o número com código do país e DDD.';
      return;
    }
    pair(phone);
  });

  return {
    navigate(section) {
      if (section === 'evolution') {
        refresh();
        return;
      }
      clearPairing();
      activeRequest?.abort();
      activeRequest = null;
      setBusy(false);
    }
  };
})();

(() => {
  const field = id => document.getElementById(id);
  const dateInput = field('sportsDate');
  const catalogInput = field('sportsCatalog');
  const catalogStatus = field('sportsCatalogStatus');
  const games = field('sportsGames');
  const status = field('sportsStatus');
  const publish = field('sportsPublish');
  const add = field('sportsAdd');
  const reset = field('sportsReset');
  const sync = field('sportsSync');
  const viewDraft = field('sportsViewDraft');
  const suggest = field('sportsCatalogSuggestions');
  let catalog = [];
  let suggestions = [];
  let loadedDate = '';
  let loaded = false;
  let busy = false;
  let dirty = false;
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  async function request(path, method = 'GET', data) {
    const response = await fetch(path.startsWith('/') ? path : '/admin/sports/' + path, {
      method,
      ...(data && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    });
    if (response.status === 401) logout();
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a configuração.');
    return result;
  }

  function setBusy(value) {
    busy = value;
    for (const button of [dateInput, field('sportsToday'), field('sportsTomorrow')]) button.disabled = value;
    for (const button of [add, publish, reset, sync, viewDraft]) button.disabled = value || !loaded;
  }

  function create(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function input(label, type, value, maxLength, required = true) {
    const row = create('label', label);
    Object.assign(row.style, { display: 'grid', gap: '4px' });
    const control = create('input');
    Object.assign(control, { type, value: value || '', required, className: 'filter-input' });
    if (maxLength) control.maxLength = maxLength;
    row.append(control);
    return row;
  }

  function renderMatch(match) {
    const card = create('article');
    Object.assign(card.style, {
      borderTop: '1px solid #ffffff20', marginTop: '12px', paddingTop: '12px',
      display: 'grid', gap: '10px'
    });
    const details = create('div');
    Object.assign(details.style, { display: 'flex', gap: '12px', flexWrap: 'wrap' });
    details.append(
      input('Partida', 'text', match.match, 180),
      input('Campeonato', 'text', match.league, 120, false),
      input('Horário de Brasília', 'time', match.time)
    );

    const options = create('div');
    Object.assign(options.style, { display: 'flex', flexWrap: 'wrap', gap: '8px 16px' });
    const selected = (match.channels || []).map(channel => typeof channel === 'string' ? channel : channel?.name)
      .filter(Boolean);
    const choices = new Map([...catalog, ...selected].map(name => [name.toLowerCase(), name]));
    for (const [key, name] of choices) {
      const label = create('label');
      const check = create('input');
      Object.assign(check, {
        type: 'checkbox', value: name, checked: selected.some(channel => channel.toLowerCase() === key)
      });
      label.append(check, document.createTextNode(' ' + name));
      options.append(label);
    }
    const remove = create('button', 'Remover jogo');
    Object.assign(remove, { type: 'button', className: 'btn btn-sm btn-edit' });
    remove.style.justifySelf = 'start';
    remove.addEventListener('click', () => {
      card.remove();
      dirty = true;
      showEmpty();
    });
    card.append(details, create('p', 'Canais de transmissão'), options, remove);
    games.append(card);
  }

  function showEmpty() {
    const previous = games.querySelector('.empty');
    if (games.querySelector('article')) previous?.remove();
    else if (!previous) {
      const empty = create('p', 'Nenhum jogo nesta data.');
      empty.className = 'empty';
      games.append(empty);
    }
    renderByChannel();
  }

  function renderByChannel() {
    const panel = field('sportsByChannel');
    const byChannel = new Map();
    for (const match of readMatches().sort((a, b) => a.time.localeCompare(b.time))) {
      if (!match.match.trim()) continue;
      const channels = match.channels.length ? match.channels : ['Canal a confirmar'];
      for (const name of channels) {
        if (!byChannel.has(name)) byChannel.set(name, []);
        byChannel.get(name).push(match);
      }
    }
    panel.replaceChildren();
    for (const [name, matches] of [...byChannel].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))) {
      const group = create('div');
      group.style.marginBottom = '8px';
      const list = create('ul');
      list.style.paddingLeft = '24px';
      matches.forEach(match => list.append(create('li', [match.time, match.match].filter(Boolean).join(' · '))));
      group.append(create('strong', name), list);
      panel.append(group);
    }
    if (!byChannel.size) panel.textContent = 'Nenhum jogo nesta data.';
  }

  function readMatches() {
    return [...games.querySelectorAll('article')].map(card => {
      const [match, league, time] = card.querySelectorAll('input:not([type="checkbox"])');
      const channels = [...card.querySelectorAll('input:checked')].map(control => control.value);
      return { match: match.value, league: league.value, time: time.value, channels };
    });
  }

  function renderAgenda(data) {
    loaded = true;
    loadedDate = data.date;
    dateInput.value = data.date;
    dirty = false;
    const source = field('sportsSource');
    source.textContent = data.manual ? 'Agenda manual publicada.' :
      data.draft ? 'Rascunho importado. Confira os jogos e canais antes de publicar. ' : 'Agenda automática.';
    if (data.draft && data.source) {
      const url = new URL(data.source);
      if (url.protocol === 'https:' && url.hostname === 'setenosesportes.com.br') {
        const link = create('a', 'Ver publicação original');
        Object.assign(link, { href: url.href, target: '_blank', rel: 'noopener noreferrer' });
        source.append(link);
      }
    }
    reset.hidden = !data.manual;
    viewDraft.hidden = !data.draft_available;
    games.replaceChildren();
    data.matches.forEach(renderMatch);
    showEmpty();
  }

  async function loadAgenda(date, preferDraft = false) {
    if (!date || busy) return;
    if (dirty && !confirm('Descartar as alterações ainda não publicadas?')) {
      dateInput.value = loadedDate;
      return;
    }
    loaded = false;
    setBusy(true);
    status.textContent = 'Carregando agenda…';
    try {
      const data = await request('calendar?date=' + encodeURIComponent(date) + (preferDraft ? '&draft=1' : ''));
      renderAgenda(data);
      status.textContent = '';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  window.openSportsSettings = async () => {
    if (loaded || busy) return;
    try {
      const data = await request('channels');
      catalog = data.channels;
      suggestions = data.suggestions;
      suggest.disabled = !suggestions.length;
      catalogInput.value = catalog.join('\n');
    } catch (error) {
      catalogStatus.textContent = error.message;
    }
    await loadAgenda(day.format(new Date()));
  };

  suggest.addEventListener('click', () => {
    const existing = catalogInput.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    const known = new Set(existing.map(name => name.toLowerCase()));
    catalogInput.value = [...existing, ...suggestions.filter(name => !known.has(name.toLowerCase()))].join('\n');
    catalogStatus.textContent = 'Confira a lista e selecione Salvar canais.';
  });

  sync.addEventListener('click', async () => {
    if (!loaded || busy) return;
    setBusy(true);
    status.textContent = 'Buscando a programação…';
    try {
      const data = await request('/admin/agenda-sync', 'POST', { date: loadedDate });
      if (!dirty) renderAgenda(await request('calendar?date=' + encodeURIComponent(loadedDate)));
      status.textContent = data.count + ' jogos encontrados na fonte. Confira o calendário antes de publicar.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });

  field('sportsCatalogForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const channels = catalogInput.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
      const data = await request('channels', 'PUT', { channels });
      catalog = data.channels;
      catalogInput.value = catalog.join('\n');
      if (loaded) {
        const draft = readMatches();
        games.replaceChildren();
        draft.forEach(renderMatch);
        showEmpty();
      }
      catalogStatus.textContent = catalog.length
        ? catalog.length + ' canal(is) salvo(s). Abra novamente Jogos → Canais de Jogos no app para atualizar.'
        : 'Lista publicada sem canais. Adicione os nomes para preencher Canais de Jogos no app.';
    } catch (error) {
      catalogStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  viewDraft.addEventListener('click', () => loadAgenda(loadedDate, true));
  dateInput.addEventListener('change', () => loadAgenda(dateInput.value));
  field('sportsToday').addEventListener('click', () => loadAgenda(day.format(new Date())));
  field('sportsTomorrow').addEventListener('click', () => loadAgenda(day.format(new Date(Date.now() + 86_400_000))));
  games.addEventListener('input', () => { dirty = true; renderByChannel(); });

  add.addEventListener('click', () => {
    renderMatch({});
    showEmpty();
    dirty = true;
    games.lastElementChild.querySelector('input')?.focus();
  });

  async function updateAgenda(method) {
    if (!loaded || busy) return;
    const matches = readMatches();
    if (method === 'DELETE' && !confirm('Retirar a agenda manual e restaurar a agenda automática deste dia?')) return;
    if (method === 'PUT' && !matches.length && !confirm('Publicar este dia sem jogos?')) return;
    setBusy(true);
    try {
      const data = await request('calendar/' + encodeURIComponent(loadedDate), method,
        method === 'PUT' ? { matches } : undefined);
      renderAgenda(data);
      status.textContent = method === 'PUT' ? 'Agenda publicada.' : 'Agenda automática restaurada.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  field('sportsGamesForm').addEventListener('submit', event => {
    event.preventDefault();
    updateAgenda('PUT');
  });
  reset.addEventListener('click', () => updateAgenda('DELETE'));
})();

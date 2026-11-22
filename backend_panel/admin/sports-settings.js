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
  let catalog = [];
  let loadedDate = '';
  let loaded = false;
  let busy = false;
  let dirty = false;
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  async function request(path, method = 'GET', data) {
    const response = await fetch('/admin/sports/' + path, {
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
    for (const button of [add, publish, reset]) button.disabled = value || !loaded;
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
    field('sportsSource').textContent = data.manual ? 'Agenda manual publicada.' : 'Agenda automática.';
    reset.hidden = !data.manual;
    games.replaceChildren();
    data.matches.forEach(renderMatch);
    showEmpty();
  }

  async function loadAgenda(date) {
    if (!date || busy) return;
    if (dirty && !confirm('Descartar as alterações ainda não publicadas?')) {
      dateInput.value = loadedDate;
      return;
    }
    loaded = false;
    setBusy(true);
    status.textContent = 'Carregando agenda…';
    try {
      const data = await request('calendar?date=' + encodeURIComponent(date));
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
      catalogInput.value = catalog.join('\n');
    } catch (error) {
      catalogStatus.textContent = error.message;
    }
    await loadAgenda(day.format(new Date()));
  };

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
      catalogStatus.textContent = 'Canais salvos.';
    } catch (error) {
      catalogStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  dateInput.addEventListener('change', () => loadAgenda(dateInput.value));
  field('sportsToday').addEventListener('click', () => loadAgenda(day.format(new Date())));
  field('sportsTomorrow').addEventListener('click', () => loadAgenda(day.format(new Date(Date.now() + 86_400_000))));
  games.addEventListener('input', () => { dirty = true; });

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

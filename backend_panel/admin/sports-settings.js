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
  const photoInput = field('sportsImageFile');
  const extractPhoto = field('sportsImageExtract');
  const photoStatus = field('sportsImageStatus');
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
  let competitionCatalog = [];
  let dynamicTeamCatalog = false;
  const teamCatalogPromises = new Map();
  function normalizeLabel(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function findCompetition(value) {
    const key = normalizeLabel(value);
    return competitionCatalog.find(item => normalizeLabel(item.name) === key) ||
      (key.startsWith('premier league') ? competitionCatalog.find(item => item.name === 'Premier League') : null) ||
      (key === 'serie a' ? competitionCatalog.find(item => item.name === 'Serie A (Itália)') : null);
  }

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
    photoInput.disabled = value || !loaded;
    extractPhoto.disabled = value || !loaded || !photoInput.files?.length;
  }

  function create(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function input(label, type, value, maxLength, required = true, dataField = '') {
    const row = create('label', label);
    row.className = 'sports-field';
    const control = create('input');
    Object.assign(control, { type, value: value || '', required, className: 'filter-input' });
    if (maxLength) control.maxLength = maxLength;
    if (dataField) control.dataset.field = dataField;
    row.append(control);
    return row;
  }

  function competitionField(value) {
    const row = create('div');
    row.className = 'sports-field sports-field-league';
    const select = create('select');
    select.className = 'filter-input';
    select.dataset.field = 'league-choice';
    select.id = 'sports-competition-' + Math.random().toString(36).slice(2);
    const placeholder = create('option', 'Selecione um campeonato');
    placeholder.value = '';
    select.append(placeholder);
    const groups = new Map();
    for (const competition of competitionCatalog) {
      if (!groups.has(competition.group)) {
        const group = create('optgroup');
        group.label = competition.group;
        groups.set(competition.group, group);
        select.append(group);
      }
      const option = create('option', competition.name);
      option.value = competition.name;
      groups.get(competition.group).append(option);
    }
    const other = create('option', 'Outro campeonato (digitar)');
    other.value = '__custom__';
    select.append(other);

    const label = create('label', 'Campeonato');
    label.htmlFor = select.id;
    const custom = create('input');
    Object.assign(custom, { type: 'text', value: '', className: 'filter-input', maxLength: 120,
      placeholder: 'Digite o nome do campeonato' });
    custom.dataset.field = 'league-custom';
    custom.setAttribute('aria-label', 'Nome do campeonato personalizado');
    const match = findCompetition(value);
    if (match) select.value = match.name;
    else if (value) {
      select.value = '__custom__';
      custom.value = value;
    }
    custom.hidden = select.value !== '__custom__';
    row.append(label, select, custom);
    return row;
  }

  function leagueForCard(card) {
    const choice = card.querySelector('[data-field="league-choice"]');
    return choice.value === '__custom__' ? card.querySelector('[data-field="league-custom"]').value.trim() : choice.value;
  }

  function teamPickerField(labelText, value, dataField) {
    const row = create('div');
    row.className = 'sports-field sports-team-field';
    const controlId = 'sports-team-' + Math.random().toString(36).slice(2);
    const label = create('label', labelText);
    label.htmlFor = controlId;
    const picker = create('div');
    picker.className = 'sports-team-picker';
    picker.dataset.picker = dataField;
    const toolbar = create('div');
    toolbar.className = 'sports-team-search';
    const control = create('input');
    Object.assign(control, { type: 'text', value: value || '', required: true, maxLength: 90,
      className: 'filter-input', placeholder: '⌕  Pesquise ou digite o time' });
    Object.assign(control.dataset, { field: dataField, role: 'team-search' });
    control.id = controlId;
    control.autocomplete = 'off';
    const toggle = create('button', '▾');
    Object.assign(toggle, { type: 'button', className: 'sports-team-toggle' });
    toggle.setAttribute('aria-label', 'Abrir lista de times');
    const list = create('div');
    Object.assign(list, { className: 'sports-team-list', hidden: true, role: 'listbox' });
    toolbar.append(control, toggle);
    picker.append(toolbar, list);
    row.append(label, picker);

    const drawList = (term = '') => {
      const card = picker.closest('.sports-match');
      const needle = normalizeLabel(term);
      const teams = card?.teamOptions || [];
      const filtered = teams.filter(team => !needle || normalizeLabel(team.name).includes(needle));
      list.replaceChildren();
      if (!filtered.length) {
        list.append(create('p', term ? 'Nenhum resultado. Você pode manter o nome digitado.' : 'Nenhum time carregado. Digite o nome manualmente.'));
      } else {
        for (const team of filtered) {
          const option = create('button', team.name);
          Object.assign(option, { type: 'button', className: 'sports-team-option', role: 'option' });
          option.addEventListener('click', () => {
            control.value = team.name;
            control.dispatchEvent(new Event('input', { bubbles: true }));
            list.hidden = true;
          });
          list.append(option);
        }
      }
      list.hidden = false;
    };
    control.addEventListener('focus', () => drawList(''));
    control.addEventListener('click', () => { if (list.hidden) drawList(''); });
    control.addEventListener('input', () => drawList(control.value));
    toggle.addEventListener('click', () => list.hidden ? drawList('') : (list.hidden = true));
    picker.drawList = drawList;
    return row;
  }

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.sports-team-picker')) {
      document.querySelectorAll('.sports-team-list:not([hidden])').forEach(list => { list.hidden = true; });
    }
  });

  function validLogo(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['media.api-sports.io', 'conteudo.cbf.com.br'].includes(url.hostname)
        ? url.href : '';
    } catch {
      return '';
    }
  }

  function teamMark(name, logo) {
    const safeName = name.trim() || 'Time';
    if (logo) {
      const image = create('img');
      Object.assign(image, { src: logo, alt: '', loading: 'lazy', className: 'sports-team-logo' });
      image.addEventListener('error', () => {
        const fallback = create('span', safeName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase());
        fallback.className = 'sports-team-fallback';
        image.replaceWith(fallback);
      }, { once: true });
      return image;
    }
    const fallback = create('span', safeName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase());
    fallback.className = 'sports-team-fallback';
    return fallback;
  }

  function renderMatchPreview(card) {
    const homeField = card.querySelector('[data-field="home"]');
    const awayField = card.querySelector('[data-field="away"]');
    const timeField = card.querySelector('[data-field="time"]');
    const home = homeField.value.trim() || 'Time da casa';
    const away = awayField.value.trim() || 'Adversário';
    const normalizeTeam = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const homeLogo = normalizeTeam(home) === normalizeTeam(card.dataset.home || '') ? card.dataset.homeLogo : '';
    const awayLogo = normalizeTeam(away) === normalizeTeam(card.dataset.away || '') ? card.dataset.awayLogo : '';
    const preview = card.querySelector('.sports-match-preview');
    const meta = create('div');
    meta.className = 'sports-preview-meta';
    meta.append(create('span', timeField.value || '--:--'));
    meta.firstElementChild.className = 'sports-preview-time';
    meta.append(create('span', leagueForCard(card) || 'Campeonato não informado'));
    meta.lastElementChild.className = 'sports-preview-league';

    const teams = create('div');
    teams.className = 'sports-preview-teams';
    const homeTeam = create('div');
    homeTeam.className = 'sports-preview-team';
    homeTeam.append(teamMark(home, validLogo(homeLogo)), create('span', home));
    homeTeam.lastElementChild.className = 'sports-team-name';
    const awayTeam = create('div');
    awayTeam.className = 'sports-preview-team';
    awayTeam.append(teamMark(away, validLogo(awayLogo)), create('span', away));
    awayTeam.lastElementChild.className = 'sports-team-name';
    teams.append(homeTeam, create('span', 'VS'), awayTeam);
    teams.children[1].className = 'sports-preview-vs';

    const channels = create('div');
    channels.className = 'sports-preview-channels';
    const selected = [...card.querySelectorAll('input[type="checkbox"]:checked')].map(control => control.value);
    if (selected.length) {
      selected.forEach(name => {
        const chip = create('span', name);
        chip.className = 'sports-channel-chip';
        channels.append(chip);
      });
    } else {
      const empty = create('span', 'Selecione os canais desta partida');
      empty.className = 'sports-channel-empty';
      channels.append(empty);
    }
    preview.replaceChildren(meta, teams, channels);
  }

  function renderMatch(match) {
    const card = create('article');
    card.className = 'sports-match';
    card.dataset.homeLogo = validLogo(match.homeLogo);
    card.dataset.awayLogo = validLogo(match.awayLogo);
    card.dataset.home = match.home || '';
    card.dataset.away = match.away || '';
    const preview = create('div');
    preview.className = 'sports-match-preview';
    const details = create('div');
    details.className = 'sports-match-fields';
    const sides = typeof match.match === 'string' ? match.match.split(/\s+(?:x|×|vs\.?|versus)\s+/i, 2) : [];
    const home = match.home || sides[0] || '';
    const away = match.away || sides[1] || '';
    const league = match.league || '';
    const leagueField = competitionField(league);
    const timeField = input('Horário de Brasília', 'time', match.time, null, true, 'time');
    timeField.classList.add('sports-field-time');
    details.append(
      leagueField,
      timeField,
      teamPickerField('Time da casa', home, 'home'),
      teamPickerField('Time visitante', away, 'away')
    );
    const teamStatus = create('p');
    teamStatus.className = 'sports-team-catalog-status';
    teamStatus.setAttribute('role', 'status');
    details.append(teamStatus);

    const options = create('div');
    options.className = 'sports-channel-options';
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
    remove.classList.add('sports-remove');
    remove.addEventListener('click', () => {
      card.remove();
      dirty = true;
      showEmpty();
    });
    const channelEditor = create('div');
    channelEditor.className = 'sports-channel-editor';
    channelEditor.append(create('p', 'Canais de transmissão'), options);
    channelEditor.firstElementChild.className = 'sports-channel-title';
    card.append(preview, details, channelEditor, remove);
    loadTeamCatalog(card);
    renderMatchPreview(card);
    games.append(card);
  }

  function refreshTeamPickers(card) {
    for (const picker of card.querySelectorAll('.sports-team-picker')) {
      if (!picker.classList.contains('sports-team-picker')) continue;
      if (!picker.querySelector('.sports-team-list').hidden) picker.drawList(picker.querySelector('[data-role="team-search"]').value);
    }
  }

  async function loadTeamCatalog(card) {
    const competitionName = leagueForCard(card);
    const competition = findCompetition(competitionName);
    const status = card.querySelector('.sports-team-catalog-status');
    const requestId = Number(card.dataset.teamRequest || 0) + 1;
    card.dataset.teamRequest = String(requestId);
    card.dataset.loadedCompetition = competition?.name || '';
    card.teamOptions = (competition?.fallback || []).map(name => ({ id: null, name, logo: '' }));
    refreshTeamPickers(card);
    if (!competition) {
      status.textContent = competitionName
        ? 'Para esse campeonato, digite os times manualmente.'
        : 'Selecione um campeonato para carregar os clubes correspondentes.';
      return;
    }
    status.textContent = 'Carregando a lista de times de ' + competition.name + '…';
    let pending = teamCatalogPromises.get(competition.name);
    if (!pending) {
      pending = request('/admin/sports/teams?competition=' + encodeURIComponent(competition.name))
        .catch(() => null);
      teamCatalogPromises.set(competition.name, pending);
    }
    const result = await pending;
    if (card.dataset.teamRequest !== String(requestId) || normalizeLabel(leagueForCard(card)) !== normalizeLabel(competition.name)) return;
    if (result?.teams?.length) {
      card.teamOptions = result.teams;
      status.textContent = result.source === 'api-football'
        ? result.teams.length + ' clubes carregados do catálogo atualizado.'
        : dynamicTeamCatalog
          ? result.teams.length + ' sugestões locais; o catálogo online não respondeu. Você também pode digitar outro time.'
          : result.teams.length + ' sugestões locais. Para carregar todos os clubes atuais, configure FOOTBALL_API_KEY no serviço BlueTV no Render.';
    } else {
      status.textContent = 'Não foi possível carregar a lista. Você pode digitar o nome do time.';
    }
    refreshTeamPickers(card);
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
      const home = card.querySelector('[data-field="home"]').value.trim();
      const away = card.querySelector('[data-field="away"]').value.trim();
      const league = leagueForCard(card);
      const time = card.querySelector('[data-field="time"]').value;
      const channels = [...card.querySelectorAll('input:checked')].map(control => control.value);
      return { match: [home, away].filter(Boolean).join(' x '), league, time, channels };
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
      const sports = await request('/admin/sports/competitions');
      competitionCatalog = sports.competitions || [];
      dynamicTeamCatalog = Boolean(sports.dynamicAvailable);
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

  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoStatus.textContent = file ? file.name + ' selecionada. Toque em “Extrair jogos” para preencher a agenda.' :
      'Revise os dados extraídos e publique quando estiverem corretos.';
    extractPhoto.disabled = !loaded || busy || !file;
  });

  extractPhoto.addEventListener('click', async () => {
    const file = photoInput.files?.[0];
    if (!loaded || busy || !file) return;
    if (dirty && !confirm('Descartar as alterações atuais e substituir pelos jogos extraídos da foto?')) return;
    if (file.size > 8 * 1024 * 1024) {
      photoStatus.textContent = 'A imagem precisa ter até 8 MB.';
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      photoStatus.textContent = 'Use uma foto JPG, PNG ou WebP.';
      return;
    }

    setBusy(true);
    photoStatus.textContent = 'Lendo a imagem e procurando horários, partidas e canais…';
    try {
      const response = await fetch('/admin/sports/calendar/' + encodeURIComponent(loadedDate) + '/image', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) logout();
      if (!response.ok) throw new Error(result.error || 'Não foi possível ler esta imagem.');
      renderAgenda({ date: loadedDate, manual: false, draft: true, draft_available: false, matches: result.matches });
      dirty = true;
      const count = result.matches.length;
      status.textContent = count + (count === 1 ? ' jogo extraído da foto.' : ' jogos extraídos da foto.');
      photoStatus.textContent = 'Extração concluída. Revise os cartões e os canais antes de publicar.';
      photoInput.value = '';
      games.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      photoStatus.textContent = error.message;
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
  games.addEventListener('input', event => {
    dirty = true;
    const card = event.target.closest('.sports-match');
    if (card) {
      if (event.target.matches('[data-field="league-choice"]')) {
        const custom = card.querySelector('[data-field="league-custom"]');
        custom.hidden = event.target.value !== '__custom__';
        loadTeamCatalog(card);
      } else if (event.target.matches('[data-field="league-custom"]')) loadTeamCatalog(card);
      renderMatchPreview(card);
    }
    renderByChannel();
  });
  games.addEventListener('change', event => {
    const card = event.target.closest('.sports-match');
    if (!card) return;
    dirty = true;
    if (event.target.matches('[data-field="league-choice"]')) {
      const custom = card.querySelector('[data-field="league-custom"]');
      custom.hidden = event.target.value !== '__custom__';
      loadTeamCatalog(card);
    } else if (event.target.matches('[data-field="league-custom"]')) loadTeamCatalog(card);
    renderMatchPreview(card);
    renderByChannel();
  });

  add.addEventListener('click', () => {
    renderMatch({});
    showEmpty();
    dirty = true;
    games.lastElementChild.querySelector('[data-field="home"]')?.focus();
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

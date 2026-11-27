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
  let suggestionListId = 0;
  const competitionSuggestions = [
    'Brasileirão Série A', 'Brasileirão Série B', 'Copa do Brasil', 'Campeonato Paulista',
    'Campeonato Carioca', 'Campeonato Mineiro', 'Campeonato Gaúcho', 'Premier League',
    'EFL Championship', 'FA Cup', 'La Liga', 'Serie A (Itália)', 'Bundesliga', 'Ligue 1',
    'Eredivisie', 'Primeira Liga', 'Champions League', 'Europa League', 'Conference League',
    'Copa Libertadores', 'Copa Sul-Americana', 'Mundial de Clubes'
  ];
  const teamsByRegion = {
    brazil: ['América-MG', 'Athletico-PR', 'Atlético-MG', 'Athletic Club', 'Amazonas', 'Avaí', 'Bahia',
      'Botafogo', 'Botafogo-SP', 'Bragantino', 'Ceará', 'Chapecoense', 'Corinthians', 'Coritiba',
      'CRB', 'Cruzeiro', 'Cuiabá', 'Ferroviária', 'Flamengo', 'Fluminense', 'Fortaleza', 'Goiás',
      'Grêmio', 'Guarani', 'Internacional', 'Juventude', 'Mirassol', 'Náutico', 'Novorizontino',
      'Operário-PR', 'Palmeiras', 'Paysandu', 'Ponte Preta', 'Remo', 'Sampaio Corrêa', 'Santos',
      'São Paulo', 'Sport', 'Vasco', 'Vila Nova', 'Vitória'],
    england: ['Arsenal', 'Aston Villa', 'Birmingham City', 'Blackburn Rovers', 'Bournemouth', 'Brentford',
      'Brighton', 'Bristol City', 'Burnley', 'Cardiff City', 'Chelsea', 'Coventry City', 'Crystal Palace',
      'Derby County', 'Everton', 'Fulham', 'Leeds United', 'Leicester City', 'Liverpool', 'Manchester City',
      'Manchester United', 'Middlesbrough', 'Newcastle United', 'Norwich City', 'Nottingham Forest',
      'Oxford United', 'Portsmouth', 'Preston North End', 'Queens Park Rangers', 'Sheffield United',
      'Southampton', 'Stoke City', 'Sunderland', 'Swansea City', 'Tottenham', 'Watford', 'West Bromwich',
      'West Ham', 'Wolverhampton'],
    europe: ['Ajax', 'Atalanta', 'Atlético de Madrid', 'Barcelona', 'Bayern de Munique', 'Benfica',
      'Borussia Dortmund', 'Celtic', 'Club Brugge', 'Fenerbahçe', 'Inter de Milão', 'Juventus',
      'Lazio', 'Lille', 'Liverpool', 'Manchester City', 'Milan', 'Monaco', 'Napoli', 'Newcastle United',
      'Nottingham Forest', 'Olympique de Marseille', 'Paris Saint-Germain', 'Porto', 'Real Madrid',
      'Roma', 'Sporting', 'Stade Brestois 29', 'Sevilla', 'Venezia', 'Bologna', 'Chelsea']
  };
  const allTeamSuggestions = [...new Set(Object.values(teamsByRegion).flat())].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  function teamSuggestionsFor(league) {
    const value = (league || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/brasileir|serie\s*b|copa do brasil|paulista|carioca|mineiro|gaucho/.test(value)) return teamsByRegion.brazil;
    if (/england|inglaterra|premier|championship|fa cup|efl/.test(value)) return teamsByRegion.england;
    if (/la liga|italia|serie\s*a|bundesliga|ligue|eredivisie|primeira liga|champions|europa league|conference league|libertadores|sul-americana|mundial/.test(value)) return teamsByRegion.europe;
    return allTeamSuggestions;
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

  function searchableInput(label, value, maxLength, required, dataField, suggestions, placeholder) {
    const row = create('label', label);
    row.className = 'sports-field';
    const listId = 'sports-suggestions-' + (++suggestionListId);
    const wrap = create('span');
    wrap.className = 'sports-search-wrap';
    const control = create('input');
    Object.assign(control, { type: 'text', value: value || '', required, className: 'filter-input', placeholder });
    Object.assign(control.dataset, { field: dataField, listId });
    control.maxLength = maxLength;
    control.setAttribute('list', listId);
    const list = create('datalist');
    list.id = listId;
    setSuggestions(list, suggestions);
    wrap.append(control);
    row.append(wrap, list);
    return row;
  }

  function setSuggestions(list, values) {
    list.replaceChildren(...[...new Set(values)].map(value => {
      const option = create('option');
      option.value = value;
      return option;
    }));
  }

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
    const leagueField = card.querySelector('[data-field="league"]');
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
    meta.append(create('span', leagueField.value.trim() || 'Campeonato não informado'));
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
    const leagueField = searchableInput('Campeonato', league, 120, false, 'league', competitionSuggestions,
      'Digite ou pesquise um campeonato');
    leagueField.classList.add('sports-field-league');
    const timeField = input('Horário de Brasília', 'time', match.time, null, true, 'time');
    timeField.classList.add('sports-field-time');
    details.append(
      leagueField,
      timeField,
      searchableInput('Time da casa', home, 90, true, 'home', teamSuggestionsFor(league), 'Buscar ou digitar o time'),
      searchableInput('Time visitante', away, 90, true, 'away', teamSuggestionsFor(league), 'Buscar ou digitar o time')
    );

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
    refreshTeamSuggestions(card);
    renderMatchPreview(card);
    games.append(card);
  }

  function refreshTeamSuggestions(card) {
    const league = card.querySelector('[data-field="league"]').value;
    for (const side of ['home', 'away']) {
      const field = card.querySelector('[data-field="' + side + '"]');
      const list = field && document.getElementById(field.dataset.listId);
      if (list) setSuggestions(list, [field.value, ...teamSuggestionsFor(league)].filter(Boolean));
    }
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
      const league = card.querySelector('[data-field="league"]').value.trim();
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
      if (event.target.matches('[data-field="league"]')) refreshTeamSuggestions(card);
      renderMatchPreview(card);
    }
    renderByChannel();
  });
  games.addEventListener('change', event => {
    const card = event.target.closest('.sports-match');
    if (!card) return;
    dirty = true;
    if (event.target.matches('[data-field="league"]')) refreshTeamSuggestions(card);
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

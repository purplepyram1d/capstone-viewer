(() => {
  const $ = id => document.getElementById(id);
  const deskById = new Map(DESKS.map(desk => [desk.id, desk]));
  const groupById = new Map(GROUPS.map(group => [group.id, group]));
  const search = $('q');
  const chipPanel = $('chips');
  const collection = $('source-scope');
  const collectorId = source => !source.mine && /^[a-z0-9-]+$/.test(source.collector || '') ? source.collector : null;
  const results = $('desks');
  const status = $('sync');
  const filterIds = new Set(['all', 'fav', 'mine', ...DESKS.map(desk => desk.id), ...GROUPS.map(group => 'g:' + group.id)]);

  function readList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function normalizedUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }
  const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));
  const groupOf = deskId => deskById.get(deskId)?.g;
  const params = new URLSearchParams(location.search);
  const collectorLinks = location.pathname.replace(/\/$/,'') === '/sources';
  let deskSaved;
  try { deskSaved = localStorage.getItem('lwd-desk'); } catch {}
  const requested = params.get('desk') || deskSaved;
  let active = filterIds.has(requested) ? requested : 'all';
  search.value = params.get('q')?.slice(0, 160) || '';
  const requestedCollection = params.get('collection');
  if (['feeds','references'].includes(requestedCollection)) collection.value = requestedCollection;

  let favorites = new Set(readList('lwd-favs').filter(url => typeof url === 'string'));
  let custom = readList('lwd-custom').filter(source => source && typeof source.n === 'string' && normalizedUrl(source.u) && deskById.has(source.d));
  function allSources() {
    return SOURCES.concat(custom.map(source => ({
      ...source,
      mine: true,
      p: typeof source.p === 'string' ? source.p : '',
      t: Array.isArray(source.t) ? source.t.filter(tag => typeof tag === 'string').slice(0, 5) : []
    })));
  }

  function updateAddress() {
    const url = new URL(location.href);
    if (active === 'all' && !search.value.trim()) url.searchParams.delete('desk');
    else url.searchParams.set('desk', active);
    if (search.value.trim()) url.searchParams.set('q', search.value.trim());
    else url.searchParams.delete('q');
    if (collection.value) url.searchParams.set('collection',collection.value);
    else url.searchParams.delete('collection');
    try { window.history.replaceState(null, '', url); } catch {}
  }

  function saveFavorites() {
    const ok = store('lwd-favs', [...favorites]);
    status.textContent = ok ? 'Stars and added sources are saved on this device.' : 'Stars changed for this session. Browser storage is unavailable.';
  }

  function renderFilters(list) {
    const focusId = document.activeElement?.dataset.desk;
    const chip = (id, label, count, extra = '') =>
      `<button class="chip ${extra}" type="button" data-desk="${id}" aria-pressed="${id === active}">${esc(label)} <span class="n">${count}</span></button>`;
    const primary = chip('all', 'All sources', list.length) +
      GROUPS.map(group => chip('g:' + group.id, group.name, list.filter(source => groupOf(source.d) === group.id).length, 'grp')).join('') +
      chip('fav', 'Starred', list.filter(source => favorites.has(source.u)).length, 'fav') +
      chip('mine', 'My links', list.filter(source => source.mine).length);
    const focusGroup = active.startsWith('g:') ? active.slice(2) : groupOf(active);
    const desks = DESKS.filter(desk => !focusGroup || desk.g === focusGroup)
      .map(desk => chip(desk.id, desk.name, list.filter(source => source.d === desk.id).length)).join('');
    const markup = `<div class="chiprow">${primary}</div><div class="chiprow sub">${desks}</div>`;
    if (chipPanel.innerHTML !== markup) {
      chipPanel.innerHTML = markup;
      if (focusId) focusChip(focusId);
    }
  }

  function focusChip(id) {
    [...chipPanel.querySelectorAll('[data-desk]')].find(button => button.dataset.desk === id)?.focus({ preventScroll: true });
  }

  function card(source) {
    const url = new URL(source.u);
    const domain = url.hostname.replace(/^www\./, '') + (url.hostname === 'github.com' ? url.pathname.replace(/\/$/, '') : '');
    const tags = (source.mine ? ['mine'] : []).concat(source.t).map(tag => {
      const style = ['live', 'gh', 'mine'].includes(tag) ? tag : '';
      return `<span class="tag ${style}">${tag === 'gh' ? 'github' : esc(tag)}</span>`;
    }).join('');
    const collector = collectorId(source);
    const history = collectorLinks && collector ?
      `<a class="source-collector-link" href="/feeds?collector=${encodeURIComponent(collector)}">Collector history ↗</a>` : '';
    const remove = source.mine ? `<button type="button" class="rm" data-rm="${esc(source.u)}">Remove ${esc(source.n)}</button>` : '';
    const on = favorites.has(source.u);
    return `<article class="src">
      <div class="src-top">
        <div><a class="name" href="${esc(source.u)}" target="_blank" rel="noopener">${esc(source.n)}</a><div class="host">${esc(domain)}</div></div>
        <button type="button" class="star" data-u="${esc(source.u)}" aria-pressed="${on}" aria-label="${on ? 'Unstar' : 'Star'} ${esc(source.n)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1 6.3 20.2l1.2-6.3L2.8 9.5l6.4-.8z"/></svg>
        </button>
      </div>
      ${source.p ? `<p>${esc(source.p)}</p>` : ''}
      <div class="tags">${tags}</div>${history}${remove}
    </article>`;
  }

  function render() {
    const kind = collection.value;
    const sources = allSources().filter(source => !kind || (kind === 'feeds' ? collectorId(source) : !collectorId(source)));
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const pool = sources.filter(source => {
      const desk = deskById.get(source.d);
      const matchesDesk = active === 'all' || active === source.d || active === 'g:' + desk.g ||
        (active === 'fav' && favorites.has(source.u)) || (active === 'mine' && source.mine);
      const searchable = [source.n, source.p, source.u, desk.name, groupById.get(desk.g)?.name, ...source.t].join(' ').toLowerCase();
      return matchesDesk && words.every(word => searchable.includes(word));
    });

    renderFilters(sources);
    const label = `${pool.length} ${pool.length === 1 ? 'source' : 'sources'} shown`;
    if ($('source-count').textContent !== label) $('source-count').textContent = label;
    const focusedUrl = document.activeElement?.dataset.u;
    if (!pool.length) {
      const empty = active === 'fav' && !words.length && !kind ? 'Star a source to save it here.' :
        active === 'mine' && !words.length && !kind ? 'Add a source to save a link of your own.' : 'No sources match these filters.';
      results.innerHTML = `<p class="empty">${empty}</p>`;
    } else {
      const sections = GROUPS.map(group => {
        const found = DESKS.filter(desk => desk.g === group.id).map(desk => {
          const items = pool.filter(source => source.d === desk.id);
          if (!items.length) return '';
          const guidance = desk.id === 'exposure' ? '<p class="caution">Use these tools to audit exposure on systems you own or are authorized to assess.</p>' : '';
          return `<section class="desk" aria-labelledby="source-desk-${desk.id}"><div class="desk-head"><h3 id="source-desk-${desk.id}">${esc(desk.name)}</h3><p>${esc(desk.blurb)}</p></div>${guidance}<div class="grid">${items.map(card).join('')}</div></section>`;
        }).join('');
        return found ? `<section class="source-results" aria-labelledby="source-group-${group.id}"><div class="band band-${group.id}"><h2 id="source-group-${group.id}">${esc(group.name)}</h2></div>${found}</section>` : '';
      }).join('');
      results.innerHTML = `<div class="source-results">${sections}</div>`;
    }
    if (focusedUrl) {
      const target = [...results.querySelectorAll('.star')].find(button => button.dataset.u === focusedUrl);
      if (target) target.focus({ preventScroll: true });
      else focusChip(active);
    }
  }

  function choose(id) {
    active = id;
    try { localStorage.setItem('lwd-desk', id); } catch {}
    updateAddress();
    render();
  }

  chipPanel.onclick = event => {
    const button = event.target.closest('[data-desk]');
    if (button) choose(button.dataset.desk);
  };
  search.addEventListener('input', () => { updateAddress(); render(); });
  collection.onchange = () => { updateAddress(); render(); };
  $('source-clear').onclick = () => { search.value = ''; collection.value = ''; choose('all'); search.focus(); };
  $('source-copy').onclick = async () => {
    const url = new URL(location.href);
    url.searchParams.set('desk', active);
    const feedback = $('source-copy-status');
    try {
      await navigator.clipboard.writeText(url.href);
      feedback.textContent = 'View link copied';
    } catch {
      const input = document.createElement('input');
      input.type = 'url';
      input.readOnly = true;
      input.value = url.href;
      input.setAttribute('aria-label', 'Source directory view link');
      feedback.replaceChildren(input);
      input.select();
    }
  };

  $('f-desk').innerHTML = DESKS.map(desk => `<option value="${desk.id}">${esc(desk.name)}</option>`).join('');
  $('addform').onsubmit = event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('f-msg');
    const name = $('f-name').value.trim();
    const value = $('f-url').value.trim();
    const url = normalizedUrl(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    message.className = '';
    if (!name || !url) {
      message.textContent = 'Enter a name and a website link.';
      message.className = 'err';
      (name ? $('f-url') : $('f-name')).focus();
      return;
    }
    if (allSources().some(source => normalizedUrl(source.u) === url)) {
      message.textContent = 'This source is already in the directory.';
      message.className = 'err';
      $('f-url').focus();
      return;
    }
    custom.push({ d: $('f-desk').value, n: name.slice(0, 120), u: url,
      p: $('f-desc').value.trim().slice(0, 300),
      t: $('f-tags').value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean).slice(0, 5),
      added: Date.now() });
    const saved = store('lwd-custom', custom);
    form.reset();
    message.textContent = saved ? `Saved ${name} under My links.` : `Added ${name} for this session.`;
    render();
  };
  results.onclick = event => {
    const button = event.target.closest('button');
    if (button?.matches('.star')) {
      const url = button.dataset.u;
      if (!favorites.delete(url)) favorites.add(url);
      saveFavorites();
      render();
    } else if (button?.matches('[data-rm]')) {
      const url = button.dataset.rm;
      custom = custom.filter(source => source.u !== url);
      if (favorites.delete(url)) saveFavorites();
      const saved = store('lwd-custom', custom);
      status.textContent = saved ? 'Source removed.' : 'Source removed for this session.';
      render();
      focusChip(active);
    }
  };

  function tick() {
    const now = new Date();
    $('utc').textContent = now.toISOString().slice(11, 19) + 'Z';
    $('utcdate').textContent = now.toISOString().slice(0, 10);
    if (!$('source-clockbox').open) return;
    const markup = CITIES.map(([city, tz]) => {
      const time = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
      return `<div class="clock"><span class="city">${esc(city)}</span><span class="t">${time}</span></div>`;
    }).join('');
    if ($('clocks').innerHTML !== markup) $('clocks').innerHTML = markup;
  }

  $('source-clockbox').addEventListener('toggle', tick);
  window.addEventListener('storage', event => {
    if (event.key === 'lwd-custom') {
      custom = readList('lwd-custom').filter(source => source && typeof source.n === 'string' && normalizedUrl(source.u) && deskById.has(source.d));
      render();
    }
    if (event.key === 'lwd-favs') {
      favorites = new Set(readList('lwd-favs').filter(url => typeof url === 'string'));
      render();
    }
  });
  tick();
  setInterval(tick, 1000);
  render();
})();

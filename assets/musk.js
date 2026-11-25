(() => {
  const tracker = document.body.dataset.tracker || 'musk';
  const { esc, api, subscribe, onConnection } = Capstone;
  const $ = id => document.getElementById(id);
  const field = name => $('musk-' + name);
  const list = field('list');
  const filters = field('filters');
  const subjects = field('entities');
  const links = field('official');
  const health = field('health');
  const sourcePanel = links.closest('details');
  const status = field('status');
  const utc = timestamp => new Date(timestamp).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };

  const defaults = { days: '7', kind: '', view: 'stories' };
  const settings = new URLSearchParams(location.search);
  field('search').value = settings.get('q')?.slice(0, 250) || '';
  for (const [name, fallback] of Object.entries(defaults)) {
    const value = settings.get(name);
    field(name).value = [...field(name).options].some(option => option.value === value) ? value : fallback;
  }
  let entity = /^[a-z0-9-]{1,50}$/.test(settings.get('entity') || '') ? settings.get('entity') : '';
  let sequence = 0, filterTimer, liveTimer, offset = 0, result;
  let paused = false;
  field('prev').disabled = field('next').disabled = true;

  filters.insertAdjacentHTML('afterend', `<div class="tracker-live-tools">
    <label><input type="checkbox" id="tracker-hold"> Hold live list</label>
    <button type="button" id="tracker-updates" hidden>Load updates</button>
    <button type="button" id="tracker-copy">Copy view link</button>
    <span id="tracker-action-status" class="subtle" role="status"></span>
  </div>`);
  const showPending = value => { $('tracker-updates').hidden = !value; };

  function params() {
    return new URLSearchParams({ entity, offset, q: field('search').value.trim(),
      days: field('days').value, kind: field('kind').value, view: field('view').value });
  }
  function shareUrl() {
    const url = new URL(location.href);
    for (const [name, value] of params()) {
      if (name === 'offset') continue;
      if (value && defaults[name] !== value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    url.searchParams.delete('offset');
    return url;
  }
  function updateUrl() {
    try { window.history.replaceState(null, '', shareUrl()); } catch {}
  }

  function renderSubjects(data) {
    const focused = document.activeElement?.closest('#musk-entities [data-entity]')?.dataset.entity;
    const html = `<button type="button" data-entity="" aria-pressed="${!entity}">All subjects</button>` + data.entities.map(item =>
      `<button type="button" data-entity="${esc(item.id)}" aria-pressed="${entity === item.id}"><strong>${esc(item.name)}</strong><small>${item.count} ${item.count === 1 ? 'report' : 'reports'}</small></button>`).join('');
    if (subjects.innerHTML === html) return;
    subjects.innerHTML = html;
    if (focused !== undefined) [...subjects.querySelectorAll('[data-entity]')].find(button => button.dataset.entity === focused)?.focus({ preventScroll: true });
  }
  function renderSources(data) {
    links.innerHTML = data.entities.map(item => {
      const url = safeUrl(item.official);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.reference_label || item.name)} ↗</a>` : '';
    }).join('');
    health.innerHTML = data.feeds.map(feed => {
      let state = 'Awaiting collection';
      if (feed.state === 'ok') state = `${feed.count} reports · Last success ${utc(feed.lastSuccess)}`;
      if (feed.state === 'error') state = `Poll failed · ${feed.error}${feed.lastSuccess ? ' · Stored reports retained' : ''}`;
      return `<p class="subtle"><strong>${esc(feed.name.replace(/^(?:Elon|Putin) tracker: /, ''))}</strong> · ${esc(state)}</p>`;
    }).join('');
  }

  function renderResults(data) {
    const names = new Map(data.entities.map(item => [item.id, item.name]));
    const open = new Set([...list.querySelectorAll('details[open]')].map(details => details.dataset.coverage));
    const focusReport = document.activeElement?.closest('#musk-list [data-open-report]')?.dataset.openReport;
    const markup = data.events.map(report => {
      const url = safeUrl(report.url);
      const context = report.source_type === 'official_statement' ? 'Official Russian statement' :
        report.source_type === 'state_media' ? 'Russian state media' : report.tracker ? 'News coverage' :
        report.platform ? `Collected from ${report.platform}` : 'Collected report';
      const date = report.date_precision === 'day' ? report.ts.slice(0, 10) + ' UTC · Day only' : utc(report.ts);
      return `<article class="panel history-event">
        <div class="history-meta"><span>${esc(report.source)} · ${esc(context)}</span><time datetime="${esc(report.ts)}">${esc(date)}</time></div>
        <h2><button type="button" class="report-text-button" data-open-report="${esc(report.id)}">${esc(report.title)}</button></h2>
        <div class="event-tags">${report.entities.map(id => `<button type="button" data-entity="${esc(id)}">${esc(names.get(id) || id)}</button>`).join('')}</div>
        ${!report.tracker && report.summary ? `<p>${esc(report.summary)}</p>` : ''}
        ${report.report_count > 1 ? `<details class="coverage-group" data-coverage="${esc(report.id)}" ${open.has(report.id) ? 'open' : ''}>
          <summary>${report.report_count} related reports · ${report.source_count} publishers</summary><p class="subtle">${esc(report.group_basis)}</p>
          ${report.reports.map(row => `<p><button type="button" class="report-text-button" data-open-report="${esc(row.id)}">${esc(row.source)} · ${esc(row.title)}</button></p>`).join('')}
        </details>` : ''}
        <div class="history-links">
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${report.tracker ? 'Open via Google News' : 'Open original report'} ↗</a>` : ''}
          ${!report.tracker ? `<a href="/ops?event=${encodeURIComponent(report.id)}&amp;period=720">Show in Operations</a>` : ''}
        </div>
      </article>`;
    }).join('') || '<div class="empty-state">No reports match these filters. Try a wider period or check collection health.</div>';
    if (list.innerHTML !== markup) list.innerHTML = markup;
    if (focusReport) list.querySelector('[data-open-report="' + CSS.escape(focusReport) + '"]')?.focus({ preventScroll: true });
  }

  async function load({ automatic = false } = {}) {
    if (automatic && shouldHold()) { showPending(true); return; }
    const id = ++sequence;
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/api/' + tracker + '?' + params());
      if (id !== sequence) return;
      if (automatic && shouldHold()) { showPending(true); return; }
      result = data;
      offset = data.offset;
      if (entity && !data.entities.some(item => item.id === entity)) {
        entity = '';
        updateUrl();
        void load();
        return;
      }
      renderSubjects(data);
      renderSources(data);
      renderResults(data);
      const unit = data.view === 'stories' ? (data.total === 1 ? 'story' : 'stories') : (data.total === 1 ? 'report' : 'reports');
      const mix = data.view === 'stories' ? ` from ${data.total_reports} ${data.total_reports === 1 ? 'report' : 'reports'}` : '';
      const range = data.total ? ` · Showing ${offset + 1}–${Math.min(offset + data.pageSize, data.total)}` : '';
      status.textContent = `${data.total} ${unit}${mix}${range}`;
      field('page').textContent = `Page ${Math.floor(offset / data.pageSize) + 1} of ${Math.max(1, Math.ceil(data.total / data.pageSize))}`;
      field('prev').disabled = offset === 0;
      field('next').disabled = offset + data.pageSize >= data.total;
      showPending(false);
    } catch (error) {
      if (id === sequence) status.textContent = 'Could not load tracker. ' + error.message;
    } finally {
      if (id === sequence) list.setAttribute('aria-busy', 'false');
    }
  }
  function shouldHold() {
    return paused || offset > 0 || sourcePanel.open || CapstoneReports.isOpen ||
      list.contains(document.activeElement) || list.querySelector('details[open]');
  }
  function changeFilters(wait = 0) {
    offset = 0;
    sequence++;
    updateUrl();
    clearTimeout(filterTimer);
    clearTimeout(liveTimer);
    filterTimer = setTimeout(() => { filterTimer = null; void load(); }, wait);
  }
  function selectSubject(event) {
    const button = event.target.closest('[data-entity]');
    if (!button) return;
    entity = button.dataset.entity;
    changeFilters();
  }
  subjects.onclick = selectSubject;
  list.onclick = event => {
    const details = event.target.closest('[data-open-report]');
    if (details) {
      const id = details.dataset.openReport;
      const group = result?.events.find(row => row.id === id || row.reports?.some(report => report.id === id));
      const report = group?.reports?.find(row => row.id === id) || group;
      if (report) void CapstoneReports.open(report, group.reports || [report]);
    } else selectSubject(event);
  };
  filters.onsubmit = event => { event.preventDefault(); changeFilters(); };
  for (const name of ['search', 'days', 'kind', 'view']) {
    field(name).addEventListener(name === 'search' ? 'input' : 'change', () => changeFilters(name === 'search' ? 250 : 0));
  }
  field('clear').onclick = () => { filters.reset(); entity = ''; changeFilters(); field('search').focus(); };
  field('prev').onclick = () => { offset = Math.max(0, offset - result.pageSize); void load(); };
  field('next').onclick = () => { offset += result.pageSize; void load(); };
  $('tracker-hold').onchange = event => { paused = event.target.checked; };
  $('tracker-updates').onclick = () => { void load(); };
  $('tracker-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl().href);
      $('tracker-action-status').textContent = 'View link copied';
    } catch {
      const input = document.createElement('input');
      input.type = 'url';
      input.readOnly = true;
      input.value = shareUrl().href;
      input.setAttribute('aria-label', 'Tracker view link');
      $('tracker-action-status').replaceChildren(input);
      input.select();
    }
  };

  let first = true;
  subscribe(() => {
    if (first) { first = false; return; }
    if (shouldHold()) { showPending(true); return; }
    if (!filterTimer && !liveTimer) {
      liveTimer = setTimeout(() => { liveTimer = null; void load({ automatic: true }); }, 500);
    }
  });
  onConnection((ok, last) => {
    field('connection').textContent = ok ? 'Live updates connected' : last ? `Reconnecting · Last snapshot ${utc(last)}` : 'Waiting for first live snapshot';
  });
  void load();
})();

// Live wall side rails and crawl: market prices on the left (/api/markets; the server refetches at most every 15 minutes),
// world clocks on the right, and a top-stories crawl along the bottom fed by the ranked headlines in the live snapshot.
// New stories are swapped in when the crawl finishes a loop, so it never jumps mid-headline.
(() => {
  const { esc, subscribe, onConnection, sourceTime } = Capstone, $ = id => document.getElementById(id);
  const shortTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const widgets = $('wall-widgets-dialog'), widgetBody = $('wall-widgets-body');
  const grid = $('wall'), stage = grid.parentElement;
  const marketRail = $('market-rail'), clockRail = $('clock-rail');
  $('wall-widgets').onclick = () => {
    widgetBody.append(marketRail,clockRail);
    widgets.showModal();
  };
  $('close-wall-widgets').onclick = () => widgets.close();
  widgets.addEventListener('close', () => {
    stage.insertBefore(marketRail,grid);
    stage.append(clockRail);
  });
  const railButtons = [...widgets.querySelectorAll('[data-wall-rail]')];
  for (const button of railButtons) button.onclick = () => {
    widgetBody.dataset.active = button.dataset.wallRail;
    for (const option of railButtons) option.setAttribute('aria-pressed',String(option===button));
  };

  // ---- Markets ----
  const fmt = (n, digits) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const priceText = i => i.group === 'crypto' ? '$' + fmt(i.price, i.price >= 1000 ? 0 : 2) : fmt(i.price, 2);
  function marketRow(i) {
    const pct = Number.isFinite(i.changePct) ? i.changePct : null, dir = pct === null ? '' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    const time = Number.isFinite(Date.parse(i.asOf)) ? `<time datetime="${esc(i.asOf)}">${esc(sourceTime({ts:i.asOf}))}</time>` : 'Quote time unavailable';
    return `<div class="market-row ${dir}${i.stale ? ' stale' : ''}" title="${esc(i.label)}"><span class="market-name">${esc(i.symbol || i.label)}${i.state === 'closed' ? '<small>CLOSED</small>' : ''}</span><span class="market-price">${priceText(i)}</span><span class="market-change">${pct === null ? '' : (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '') + fmt(Math.abs(pct), 2) + '%'}</span><span class="market-quote">${time}<strong class="market-stale-label">Last known</strong></span></div>`;
  }
  let marketSnapshotTime = null;
  function renderMarkets(board) {
    marketSnapshotTime = board.items?.length ? board.updated : null;
    if (board.disabled) { marketSnapshotTime = null; $('market-list').innerHTML = '<p class="subtle">Prices are off while collectors are off.</p>'; $('market-note').textContent = ''; return; }
    const group = (name, title) => { const rows = board.items.filter(i => i.group === name); return rows.length ? `<p class="rail-head">${title}</p>${rows.map(marketRow).join('')}` : ''; };
    const list = $('market-list');
    const scroll = list.scrollTop;
    list.innerHTML = group('index', 'STOCK INDICES') + group('crypto', 'CRYPTO · 24H') || '<p class="subtle">Prices unavailable right now.</p>';
    list.scrollTop = scroll;
    const failed = board.errors?.length ? ' · Partial quotes' : '';
    $('market-note').textContent = board.updated ? `Checked ${sourceTime({ ts: board.updated })}${failed}. Delayed quotes from Yahoo Finance and CoinGecko.` : 'Price sources unreachable. Retrying.';
  }
  async function loadMarkets() {
    try { const res = await fetch('/api/markets'); if (!res.ok) throw new Error(); renderMarkets(await res.json()); }
    catch {
      const rows = [...$('market-list').querySelectorAll('.market-row')];
      for (const row of rows) row.classList.add('stale');
      if (!rows.length) $('market-list').innerHTML = '<p class="subtle">Prices unavailable.</p>';
      $('market-note').textContent = marketSnapshotTime ?
        'Last price snapshot ' + sourceTime({ ts: marketSnapshotTime }) + ' · Reconnecting' :
        'Price sources unreachable. Retrying.';
    }
  }
  // Polling more often than the server's 15-minute cache only matters when a fetch failed and the server is retrying sooner.
  loadMarkets(); setInterval(loadMarkets, 5 * 60000);

  // ---- World clocks ----
  const CLOCKS = [['Los Angeles', 'America/Los_Angeles'], ['New York', 'America/New_York'], ['UTC', 'UTC'], ['London', 'Europe/London'], ['Kyiv', 'Europe/Kyiv'], ['Moscow', 'Europe/Moscow'],
    ['Jerusalem', 'Asia/Jerusalem'], ['Dubai', 'Asia/Dubai'], ['New Delhi', 'Asia/Kolkata'], ['Beijing', 'Asia/Shanghai'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney']];
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = (date, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  function renderClocks() {
    const now = new Date(), here = parts(now, localZone), today = `${here.year}${here.month}${here.day}`;
    $('clock-list').innerHTML = CLOCKS.map(([city, zone]) => {
      let p; try { p = parts(now, zone); } catch { p = parts(now, zone === 'Europe/Kyiv' ? 'Europe/Kiev' : 'UTC'); }
      const day = `${p.year}${p.month}${p.day}`, shift = day > today ? ' · tomorrow' : day < today ? ' · yesterday' : '', hour = Number(p.hour);
      return `<div class="clock-row${zone === localZone ? ' local' : ''}"><span class="clock-city"><i class="daynight ${hour >= 6 && hour < 18 ? 'day' : 'night'}" title="${hour >= 6 && hour < 18 ? 'Daytime' : 'Night'}"></i>${esc(city)}</span><span class="clock-time">${p.hour}:${p.minute}</span><span class="clock-day">${p.weekday}${shift}</span></div>`;
    }).join('');
  }
  renderClocks(); setInterval(renderClocks, 15000);

  // ---- Top-stories crawl ----
  const track = $('wall-ticker-track');
  const ticker = track.closest('.wall-ticker');
  const headlineWindow = track.parentElement;
  const toggle = $('wall-ticker-mode');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let tickerKey = '', pending = null, shown = null, paused = motion.matches, held = false;
  const windowLabel = hours => !hours ? 'TOP STORIES' : hours === 1 ? 'TOP STORIES · PAST HOUR' : `TOP STORIES · PAST ${hours} HOURS`;
  const safeUrl = url => /^https?:\/\//i.test(url || '') ? url : null;
  const headlinesDialog = $('wall-headlines');
  const headlinesList = $('wall-headlines-list');
  const deskPicker = $('wall-headlines-desk');
  const evidencePicker = $('wall-headlines-evidence'), watchPicker = $('wall-headlines-watch');
  const basisPicker = $('wall-headlines-basis');
  let latestHeadlines = null, headlineDetails = new Map(), drawerMarkup = '', wallLive = false;
  let receiptHeadlines = null, checkingReceipts = false, receiptsDelayed = false;
  const byReceipt = () => basisPicker.value==='received';
  const headlineSnapshot = () => byReceipt() ? receiptHeadlines : latestHeadlines;
  async function refreshReceipts() {
    if (!byReceipt() || !wallLive || checkingReceipts || !latestHeadlines ||
        (receiptHeadlines?.now && receiptHeadlines.now>=latestHeadlines.now)) return;
    const wanted = latestHeadlines.now;
    checkingReceipts = true;
    try {
      const response = await fetch('/api/headlines?basis=received',{signal:AbortSignal.timeout(8_000)});
      if (!response.ok) throw Error('First-receipt rankings unavailable');
      receiptHeadlines = await response.json();
      receiptsDelayed = false;
    } catch {
      receiptsDelayed = true;
    } finally {
      checkingReceipts = false;
      if (byReceipt()) {
        renderHeadlines();
        renderHeadlinesDrawer();
        renderHeadlineHealth();
      }
      if (latestHeadlines.now!==wanted && !receiptsDelayed) void refreshReceipts();
    }
  }

  function apply(next) {
    const left = paused ? headlineWindow.scrollLeft : 0;
    shown = next;
    pending = null;
    $('wall-ticker-label').textContent = next.label;
    track.innerHTML = `<span class="wall-ticker-items">${next.html}</span>` +
      (paused || !next.count ? '' : `<span class="wall-ticker-items" aria-hidden="true">${next.html}</span>`);
    for (const item of track.querySelectorAll('.wall-ticker-items[aria-hidden] :is(a,button)')) item.tabIndex = -1;
    track.style.animation = 'none';
    headlineWindow.scrollLeft = left;
    if (!paused && next.count) {
      const width = track.firstElementChild.offsetWidth;
      track.style.setProperty('--wall-crawl-distance', `-${width}px`);
      track.style.animation = `wall-crawl ${Math.max(24, width / 55)}s linear infinite`;
    }
  }

  function setPaused(value,manual = false) {
    const transform = value && !paused ? getComputedStyle(track).transform : 'none';
    paused = value;
    held = paused && manual;
    ticker.classList.toggle('wall-ticker-paused', paused);
    toggle.textContent = paused ? 'Resume' : 'Pause';
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Resume headlines crawl' : 'Pause headlines crawl');
    const waiting = pending;
    const next = held ? shown || waiting : waiting || shown;
    if (next) apply(next);
    if (transform!=='none') headlineWindow.scrollLeft = Math.max(0,-new DOMMatrixReadOnly(transform).m41);
    if (held && waiting!==next) pending = waiting;
    renderHeadlineHealth();
  }

  toggle.onclick = () => setPaused(!paused,true);
  motion.addEventListener('change', event => setPaused(event.matches));
  setPaused(paused);
  track.addEventListener('animationiteration', () => {
    if (pending && !CapstoneReports.isOpen && !track.contains(document.activeElement)) apply(pending);
  });
  track.addEventListener('pointerdown', event => {
    if (event.target.closest('.wall-ticker-items[aria-hidden] :is(a,button)')) event.preventDefault();
  });
  track.addEventListener('click', event => {
    const button = event.target.closest('[data-wall-report]');
    const row = button && shown?.reports.get(button.dataset.wallReport);
    if (row) void CapstoneReports.open({ ...row, id: row.report_id });
  });
  document.addEventListener('report-drawer-close', () => {
    if (paused && !held && pending && !track.contains(document.activeElement)) apply(pending);
  });
  track.addEventListener('focusout', event => {
    if (paused && !held && pending && !CapstoneReports.isOpen && !track.contains(event.relatedTarget)) apply(pending);
  });
  function renderHeadlineHealth() {
    const indicator = $('wall-headline-state');
    const view = headlineSnapshot();
    const snapshot = Date.parse(view?.now);
    const age = Number.isFinite(snapshot) ? Math.max(0,Math.floor((Date.now()-snapshot)/60000)) : 0;
    const label = !latestHeadlines ? 'Connecting' : !wallLive ? 'Reconnecting' : !latestHeadlines.collecting ? 'Collection paused' :
      byReceipt() && receiptsDelayed ? 'First receipts delayed' : byReceipt() && !view ? 'Checking first receipts' :
        age>=10 ? 'Snapshot '+age+' min old' : held && pending ? 'New headlines waiting' : latestHeadlines.offline ? 'Collection gap' : '';
    if (indicator.textContent!==label) indicator.textContent = label;
    indicator.hidden = !label;
    indicator.title = Number.isFinite(snapshot) ? 'Last headline snapshot '+sourceTime({ts:view.now}) : '';
  }

  function activeHeadlines() {
    const desk = deskPicker.value;
    const view = headlineSnapshot();
    const feed = watchPicker.checked ? view?.watchHeadlines : view;
    const ranking = evidencePicker.value==='primary' ? feed?.primaryHeadlines?.[desk] :
      desk==='all' ? feed?.headlines : feed?.headlinesByDesk?.[desk];
    const rows = (ranking?.rows || []).filter(row=>!window.CapstoneReading?.muted(row));
    return {rows,hours:ranking?.window_hours};
  }
  function renderHeadlinesDrawer(force = false) {
    if (!headlinesDialog.open) return;
    Capstone.collectionGapNotice($('wall-collection-gap'),latestHeadlines?.offline,()=>{
      basisPicker.value = 'received';
      basisPicker.dispatchEvent(new Event('change',{bubbles:true}));
      basisPicker.focus({preventScroll:true});
    },()=>{
      latestHeadlines = {...latestHeadlines,offline:null};
      renderHeadlineHealth();
      basisPicker.focus({preventScroll:true});
    });
    const scope = new URLSearchParams({desk:deskPicker.value,region:'world',reports:'recent',basis:basisPicker.value,
      evidence:evidencePicker.value,watch:watchPicker.checked?'1':'0'});
    const kioskLink = $('wall-headlines-kiosk');
    const destination = '/kiosk?'+scope;
    if (kioskLink.getAttribute('href')!==destination) kioskLink.setAttribute('href',destination);
    const {rows,hours} = activeHeadlines();
    const status = $('wall-headlines-status');
    const period = hours===1 ? 'Past hour' : hours ? 'Past '+hours+' hours' : '';
    const view = headlineSnapshot();
    const state = !latestHeadlines ? 'Waiting for the first snapshot' : !wallLive ? 'Reconnecting' : !latestHeadlines.collecting ? 'Collection paused' :
      byReceipt() && receiptsDelayed ? 'First receipts delayed' : view ? 'Snapshot '+sourceTime({ts:view.now}) : 'Checking first receipts';
    const summary = [view ? rows.length+' headline'+(rows.length===1?'':'s') : '',period,state].filter(Boolean).join(' · ');
    if (status.textContent!==summary) status.textContent = summary;
    if (!force && (headlinesList.contains(document.activeElement) || CapstoneReports.isOpen)) return;
    const markup = rows.map(row=>{
      const reportId = row.report_id || row.representative_id;
      const url = safeUrl(row.url);
      const original = CapstoneTypes.sourceReference(row);
      const watching = watchPicker.checked && row.watch_matches?.length ? '<span>Watching '+esc(row.watch_matches.join(' · '))+'</span>' : '';
      const title = reportId ? `<button type="button" class="report-text-button" data-wall-story="${esc(reportId)}" aria-haspopup="dialog">${esc(row.title)}</button>` : esc(row.title);
      const reportDate = sourceTime({ts:row.report_ts || row.ts,date_precision:row.report_date_precision || row.date_precision});
      const latestReceipt = byReceipt() && row.latest_received && row.latest_received!==row.first_received ?
        `<span>Latest related receipt ${esc(sourceTime({ts:row.latest_received}))}</span>` : '';
      const location = row.place ? `<span>${esc(row.place)}${CapstoneTypes.referencePlacement(row) ? ' · '+esc(CapstoneTypes.placement(row)) : ''}</span>` : '';
      return `<li><small class="wall-headline-meta"><span>${esc(row.evidence)}</span><span>${esc(CapstoneTypes.describe(row).label)}</span></small><h3>${title}</h3><div class="wall-headline-source"><span>${esc(row.source)}</span><span>${CapstoneTypes.sourceDateLabel(row.report_source_date_basis)} ${esc(reportDate)}</span>${location}${watching}</div><div class="wall-headline-source">${row.first_received ? `<span>First received ${esc(sourceTime({ts:row.first_received}))}</span>` : ''}${latestReceipt}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${original ? 'Provider reference' : 'Original source'} ↗</a>` : ''}</div></li>`;
    }).join('');
    const empty = byReceipt() && !view ? 'Newly received reports will appear after the first receipt check.' :
      watchPicker.checked ? 'No recent watchlist matches.' : 'No ranked headlines for this desk yet.';
    const next = rows.length ? `<ol>${markup}</ol>` : '<p class="empty-state">'+empty+'</p>';
    if (drawerMarkup===next) return;
    drawerMarkup = next;
    headlineDetails = new Map(rows.filter(row=>row.report_id || row.representative_id).map(row=>[row.report_id || row.representative_id,row]));
    headlinesList.innerHTML = next;
  }
  function renderHeadlines(force = false) {
    const {rows,hours} = activeHeadlines();
    const headlineDesk = deskPicker.value;
    const receipt = row => row.latest_received || row.first_received;
    const isNew = row => (byReceipt() || row.date_precision !== 'day') &&
      Date.now() - Date.parse(byReceipt()?receipt(row):row.first_ts || row.ts) < 15 * 60000;
    const key = rows.map(row => [row.id, row.ts, row.date_precision, row.title, row.url, row.source, row.evidence, row.report_id, row.summary, row.confidence, isNew(row), receipt(row)]).join('|') + '|' + hours + '|' + headlineDesk + '|' + evidencePicker.value + '|' + watchPicker.checked+'|'+basisPicker.value;
    if (key === tickerKey) return;
    tickerKey = key;
    const html = rows.length ? rows.map(row => {
      const url = safeUrl(row.url);
      const title = row.report_id ? `<button type="button" class="report-text-button" data-wall-report="${esc(row.report_id)}" aria-haspopup="dialog">${esc(row.title)}</button>` :
        url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(row.title)}</a>` : esc(row.title);
      const classification = ['Claim','Unverified','Modeled alert','Automated detection','Provider annotation'].includes(row.evidence) ? `<small>${esc(row.evidence)}</small>` : '';
      const utc = byReceipt() ? 'Received '+sourceTime({ts:receipt(row)}) :
        sourceTime({ts:row.report_ts || row.ts,date_precision:row.report_date_precision || row.date_precision});
      return `<span class="tick"><i class="dot ${esc(row.category)}"></i>${isNew(row) ? '<em class="tick-new">NEW</em>' : ''}${classification}${title} <b>${esc(row.source)} · ${esc(utc)}</b></span>`;
    }).join('') : `<span class="tick">${!headlineSnapshot() ? (byReceipt()?'Waiting for first receipts…':'Waiting for stories…') :
      watchPicker.checked?'No recent watchlist matches':'No recent headlines for this desk'}</span>`;
    const deskLabel = watchPicker.checked ? 'WATCHLIST' : ({all:'',cyber:'CYBER',geo:'WORLD',ai:'AI'})[headlineDesk];
    const label = byReceipt() ? ['RECEIVED',deskLabel].filter(Boolean).join(' · ') : deskLabel || windowLabel(hours);
    const next = { html, label, count: rows.length,
      reports: new Map(rows.filter(row => row.report_id).map(row => [row.report_id, row])) };
    if (force || !shown || !shown.count || (paused && !held && !CapstoneReports.isOpen && !track.contains(document.activeElement))) apply(next);
    else pending = next;
    renderHeadlineHealth();
  }
  $('wall-headlines-open').onclick = () => {
    headlinesDialog.showModal();
    renderHeadlinesDrawer(true);
  };
  $('wall-headlines-close').onclick = () => headlinesDialog.close();
  deskPicker.onchange = evidencePicker.onchange = watchPicker.onchange = basisPicker.onchange = () => {
    headlinesList.scrollTop = 0;
    headlineWindow.scrollLeft = 0;
    renderHeadlines(true);
    renderHeadlinesDrawer(true);
    void refreshReceipts();
  };
  headlinesList.addEventListener('click',event=>{
    const id = event.target.closest('[data-wall-story]')?.dataset.wallStory;
    const row = headlineDetails.get(id);
    if (row) void CapstoneReports.open({...row,id});
  });
  headlinesList.addEventListener('focusout',()=>setTimeout(renderHeadlinesDrawer,0));
  document.addEventListener('report-drawer-close',()=>renderHeadlinesDrawer());
  subscribe(data=>{
    latestHeadlines = data;
    renderHeadlineHealth();
    renderHeadlines();
    renderHeadlinesDrawer();
    void refreshReceipts();
  });
  onConnection(connected=>{
    wallLive = connected;
    renderHeadlineHealth();
    renderHeadlinesDrawer();
    void refreshReceipts();
  });
  setInterval(()=>{ renderHeadlineHealth(); void refreshReceipts(); },30_000);

  // ---- Day's CVE total: CVEs NVD has published since local midnight, against the full day one year earlier (/api/cve-today;
  // the server asks NVD at most hourly). Rechecked every 10 minutes so each new hourly count shows promptly. ----
  async function cveDay() {
    const total = $('cve-day-total'), compare = $('cve-day-compare'), box = $('cve-day'); if (!total) return;
    let d; try { const r = await fetch('/api/cve-today'); d = r.ok ? await r.json() : null; } catch { d = null; }
    const pace = $('cve-day-pace');
    if (!d || d.disabled) {
      total.textContent = '–';
      compare.textContent = d?.disabled ? 'collectors off' : 'NVD unavailable';
      if (pace) pace.style.width = '0';
      box.title = d?.disabled ? 'CVE collection is paused.' : 'The NVD daily count is unavailable.';
      return;
    }
    total.textContent = d.total === null ? '–' : d.total.toLocaleString();
    const last = d.lastYear?.total, lastDate = d.lastYear?.date ? new Date(d.lastYear.date + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) + " '" + d.lastYear.date.slice(2, 4) : '';
    compare.innerHTML = (Number.isInteger(last) ? `${last.toLocaleString()} on ${esc(lastDate)}` : 'last year unavailable') + (d.stale ? ' · <em>stale</em>' : '');
    // Pace line: how far today has come toward last year's full-day count (capped at full).
    if (pace) pace.style.width = Number.isInteger(last) && last > 0 && Number.isInteger(d.total) ? `${Math.min(100, d.total / last * 100).toFixed(1)}%` : '0';
    box.title = `CVEs published to NVD since local midnight, all severities, rejected CVEs excluded. Updated hourly${d.asOf ? '; as of ' + shortTime(d.asOf) : ''}. Last year's figure is that whole day.${d.error ? ' Last check failed: ' + d.error : ''}`;
  }
  cveDay(); setInterval(cveDay, 10 * 60000);
})();

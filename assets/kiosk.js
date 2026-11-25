(() => {
  const { esc, read, save, sourceTime, subscribe, onConnection, nightGeo } = Capstone;
  const $ = id => document.getElementById(id);
  const DAY = 86400000, levelNames = { green: 'QUIET SIGNALS', amber: 'ELEVATED SIGNALS', red: 'HIGH SIGNALS' }, rank = { green: 0, amber: 1, red: 2 };
  const deskPicker = $('kiosk-desk'), reportMode = $('kiosk-report-mode');
  const regions = CapstoneKioskRegions;
  const regionPicker = $('ks-region'), regionSearch = $('ks-region-search');
  const regionLabels = new Map();
  let regionGroups = [];
  const queue = $('kiosk-queue'), settingsDialog = $('kiosk-settings');
  const statusDialog = $('kiosk-status'), mappedDialog = $('kiosk-mapped');
  const dialogOpen = () => queue.open || settingsDialog.open || statusDialog.open || mappedDialog.open || CapstoneReports.isOpen;
  const deskChoices = new Map([...deskPicker.options].map(option=>[option.value,option.textContent]));
  const deskTiles = {cyber:['cyber','internet'],geo:['earth'],ai:[]};
  const defaults = { dwell: 20, projection: 'globe', sound: true, amber: false, volume: 0.6, quietStart: '', quietEnd: '' };
  const stored = read('capstone-kiosk', {});
  const params = new URLSearchParams(location.search);
  const requestedDesk = params.get('desk');
  let desk = deskChoices.has(requestedDesk) ? requestedDesk : deskChoices.has(stored?.desk) ? stored.desk : 'all';
  let region = regions.fromUrl(params,stored?.region);
  const regionLabel = () => regionLabels.get(region)?.name || (region ? region.split(':')[1] : 'All regions');
  deskPicker.value = desk;
  document.body.dataset.kioskDesk = desk;
  const matchesDesk = story => !CapstoneTypes.isNewsCodingAggregate(story) && (desk==='all' || story.category===desk) &&
    (!settings.primary || (story.evidence ? ['Official','Measured'].includes(story.evidence) : CapstoneTypes.matchesEvidence(story,'primary'))) &&
    (!settings.watchOnly || Boolean(story.watch_matches?.length));
  const hasLiveListings = () => Boolean(connected && data?.collecting);
  const matchesScope = (story,now=Date.now()) => matchesDesk(story) && regions.matches(story,region) &&
    (!settings.listed || (hasLiveListings() && CapstoneTypes.currentListing(story,now)));
  const mixedHotspots = () => desk==='all' && !settings.primary && !settings.listed && !settings.watchOnly && !region ? (data?.hotspots || []) : [];
  let settings = { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  settings.primary = params.has('evidence') ? params.get('evidence')==='primary' : settings.primary===true;
  settings.watchOnly = params.has('watch') ? params.get('watch')==='1' : settings.watchOnly===true;
  settings.listed = params.has('reports') ? params.get('reports')==='listed' : settings.listed===true;
  settings.received = params.has('basis') ? params.get('basis')==='received' : settings.received===true;
  const byReceipt = () => settings.received && !settings.listed;
  const rankingTime = story => byReceipt() ? story.latest_received || story.first_received : story.ts;
  reportMode.value = settings.listed ? 'listed' : 'recent';
  let maplibregl;
  let data = null, focusList = [], focusIndex = 0, paused = matchMedia('(prefers-reduced-motion: reduce)').matches, timer = null, map, mapReady = false, fallback = false, fallbackLand = '', countryNames = [];
  let visibleReport = null, scopedStories = [], listingTimer = null;
  const regionShapes = {country:[],state:[],province:[]};
  let paintedRegion, refreshProvinceNames;
  let mapStartupTimer = null, mapRecoveryTimer = null;
  let exploring = false, pauseBeforeExplore = false, exploreNavigation = null;
  const allStories = () => data?.stories || data?.events || [];
  function updateStories() {
    clearTimeout(listingTimer);
    const now = Date.now();
    const hasMutes = data?.reading?.sources?.length || data?.reading?.subjects?.length;
    scopedStories = region || settings.primary || settings.listed || settings.watchOnly || hasMutes ? allStories().map(story=>regions.project(story,
      report=>matchesScope(report,now) && !CapstoneReading.muted(report),region)).filter(Boolean) : allStories().filter(matchesDesk);
    if (!hasLiveListings() || !scopedStories.length) return;
    let next = Infinity;
    for (const story of scopedStories) for (const report of story.reports || [story]) {
      const end = CapstoneTypes.listingCutoff(report);
      if (end>now && end<next) next = end;
    }
    if (Number.isFinite(next)) listingTimer = setTimeout(refreshListingView,Math.max(1,next-now));
  }
  let tickerShown = null, tickerPending = null;
  let connected = false, lastLevels = null, tickerKey = null, displayedFocus = '', audio = null, idleTimer = null, bannerTimer = null;
  function kioskAlertReport(alert) {
    for (const story of scopedStories) {
      const report = (story.reports || [story]).find(report=>report.id===alert.event_id);
      if (report && matchesScope(report) && !CapstoneReading.muted(report)) return report;
    }
    return null;
  }
  Capstone.setWatchToastOptions({
    accepts:alert=>desk==='all' && !settings.primary && !settings.listed && !settings.watchOnly && !region || Boolean(kioskAlertReport(alert)),
    open:alert=>{
      void CapstoneReports.open(kioskAlertReport(alert) || {...alert,id:alert.event_id});
      schedule();
    }
  });
  const isLocated = e => Number.isFinite(e?.lat) && Number.isFinite(e?.lon);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const leadReport = story => story.reports?.find(member=>member.id===story.representative_id) || story;
  const zulu = ts => new Date(ts).toISOString().slice(11, 16) + 'Z';
  const activeLocation = story => (!['airport_disruption','road_closure'].includes(story.kind) && !story.weather_status) ||
    (hasLiveListings() && CapstoneTypes.currentListing(story));
  const located24 = () => scopedStories.filter(e => isLocated(e) && activeLocation(e) && !window.CapstoneReading?.muted(e) && (settings.listed || Date.parse(rankingTime(e)) >= Date.now() - DAY || (e.kind === 'outage' && e.ongoing && e.outage_state !== 'stale')) && !['vendor_hq', 'company_hq'].includes(e.place_basis));

  // ---- Status tiles and escalation alerts ----
  const hasScopedCounts = () => region || settings.watchOnly || settings.primary || settings.listed || byReceipt() || desk==='ai';
  const activeTiles = () => (hasScopedCounts() ? [] : data?.status || []).filter(tile=>desk==='all' || deskTiles[desk].includes(tile.id));
  function renderScopeCounts(total) {
    const counts = $('kiosk-scope-counts');
    counts.hidden = !hasScopedCounts();
    if (counts.hidden) return;
    const stops = focusList.filter(focus=>!focus.held).length;
    const basis = byReceipt() ? 'received in 24h' : 'in the past 24h';
    const status = settings.listed ? `${total} current ${total===1?'listing':'listings'}` : `${total} ${total===1?'story':'stories'} ${basis}`;
    const text = settings.listed && !hasLiveListings() ? 'Waiting for current listings' : `${status} · ${stops} tour ${stops===1?'stop':'stops'}`;
    if (counts.textContent!==text) counts.textContent = text;
  }
  const tileBoard = $('kiosk-tiles'), statusBody = $('kiosk-status-body');
  const coverageButton = $('kiosk-coverage-open');
  const gapButton = $('kiosk-gap-open');
  gapButton.onclick = () => {
    const gap = data?.offline;
    if (!gap) return;
    $('kiosk-status-title').textContent = 'Collection gap';
    const notice = document.createElement('section');
    notice.id = 'kiosk-collection-gap';
    notice.className = 'collection-gap-notice';
    statusBody.replaceChildren(notice);
    Capstone.collectionGapNotice(notice,gap,()=>{
      settings.listed = false;
      settings.received = true;
      reportMode.value = 'recent';
      statusDialog.close();
      persist();
      updateScope();
      $('kiosk-queue-open').focus({preventScroll:true});
    },()=>{
      gapButton.hidden = true;
      statusDialog.close();
      $('kiosk-queue-open').focus({preventScroll:true});
    });
    statusDialog.showModal();
    schedule();
  };
  let tileMarkup = '', openStatus = null;
  function renderTiles(status) {
    tileBoard.hidden = !status.length;
    const markup = status.map(t=>`<button type="button" data-kiosk-tile="${esc(t.id)}" aria-haspopup="dialog" class="kiosk-tile ${t.level==='green'&&t.coverage?.current===0?'coverage-unknown':esc(t.level)}"><span class="status-label">${esc(t.label)}</span><span class="status-level">${t.level==='green'&&t.coverage?.current===0?'COVERAGE UNAVAILABLE':levelNames[t.level] || esc(t.level)}</span><span class="kiosk-tile-headline">${t.gaps?.length ? `⚠ Data gap: ${esc(t.gaps.join(', '))}` : esc(t.headline)}</span>${t.coverage?`<span class="status-coverage">${esc(t.coverage.label)}</span>`:''}</button>`).join('');
    if (tileMarkup!==markup) {
      const focused = document.activeElement?.dataset.kioskTile;
      tileBoard.innerHTML = tileMarkup = markup;
      if (focused) tileBoard.querySelector(`[data-kiosk-tile="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    }
  }
  tileBoard.addEventListener('click',event=>{
    const selected = event.target.closest('[data-kiosk-tile]')?.dataset.kioskTile;
    const tile = activeTiles().find(item=>item.id===selected);
    if (!tile) return;
    openStatus = selected;
    $('kiosk-status-title').textContent = tile.label+' signal activity';
    const asOf = data.now ? 'Snapshot '+sourceTime({ts:data.now}) : '';
    statusBody.innerHTML = '<p class="subtle">'+esc([tile.coverage?.label,asOf].filter(Boolean).join(' · '))+'</p>' +
      CapstoneStatusDetail.markup(tile,{openInNewWindow:true});
    statusDialog.showModal();
    schedule();
  });
  $('kiosk-status-close').onclick = () => statusDialog.close();
  statusDialog.addEventListener('close',()=>{
    if (openStatus) tileBoard.querySelector(`[data-kiosk-tile="${CSS.escape(openStatus)}"]`)?.focus({preventScroll:true});
    openStatus = null;
  });
  let coverageRows = [], coverageSummary = '';
  function renderCoverage() {
    const travelDesk = desk==='all' || desk==='geo';
    const networkDesk = desk==='all' || desk==='cyber';
    coverageButton.hidden = !region && !(settings.listed && (travelDesk || networkDesk));
    if (coverageButton.hidden) return;
    const [type,code] = region.split(':');
    const byId = new Map((data?.feeds || []).map(feed=>[feed.id,feed]));
    const keys = {state:type==='state'?code:'',country:type==='province'?'CA':type==='country'?code:'',province:type==='province'?code:''};
    const checks = travelDesk ? CapstoneRegionCoverage.providers(keys,byId.keys()) : {regular:[],districts:[]};
    const worldListings = settings.listed && !region ? [...byId.values()].filter(feed=>feed.currentListings && (feed.desk==='internet'?networkDesk:travelDesk)).map(feed=>feed.id) : [];
    const cutoff = Date.now()-DAY;
    const counts = new Map();
    for (const story of scopedStories) for (const report of story.reports || [story]) {
      const id = report.feed_id || report.source_id;
      if (!id || (!settings.listed && !(Date.parse(rankingTime(report))>=cutoff))) continue;
      counts.set(id,(counts.get(id) || 0)+1);
    }
    const stateSignals = networkDesk && (type==='state' || keys.country==='US') ? ['ioda-us-states'] : [];
    const candidates = new Set([...checks.regular,...checks.districts,...worldListings,...stateSignals,...counts.keys()]);
    coverageRows = [...candidates].map(id=>byId.get(id)).filter(feed=>feed && (!settings.listed || feed.currentListings || counts.has(feed.id)))
      .map(feed=>({feed,count:counts.get(feed.id) || 0}));
    const current = coverageRows.filter(({feed})=>feed.pollCoverage==='current').length;
    coverageSummary = !data ? 'Waiting for collector checks' : !data.collecting ? 'Collection paused' :
      !connected ? 'Last known checks' : coverageRows.length ? current+'/'+coverageRows.length+' polls current' : 'No dedicated checks for this view';
    const label = coverageRows.length ? coverageSummary : 'Source checks';
    if (coverageButton.textContent!==label) coverageButton.textContent = label;
    coverageButton.setAttribute('aria-label','Source checks for '+(region?regionLabel():'current listings')+'. '+coverageSummary);
  }
  coverageButton.onclick = () => {
    $('kiosk-status-title').textContent = 'Source checks for '+(region?regionLabel():'current listings');
    const asOf = data?.now ? ' · Snapshot '+sourceTime({ts:data.now}) : '';
    const rows = coverageRows.map(({feed,count})=>{
      const [style,label] = CapstoneRegionCoverage.states[feed.pollCoverage] || CapstoneRegionCoverage.states.waiting;
      const time = feed.lastSuccess ? 'Last success '+sourceTime({ts:feed.lastSuccess}) : 'No successful poll yet';
      const countText = settings.listed && (!hasLiveListings() || feed.pollCoverage!=='current') ? 'Current coverage unavailable' :
        settings.listed ? count+' current listing'+(count===1?'':'s') : count+' matching report'+(count===1?'':'s')+(byReceipt()?' received in 24h':' in 24h');
      return `<li><div class="region-feed-line"><strong>${esc(feed.name)}</strong><span class="feed-indicator ${style}">${esc(label)}</span></div>
        <small>${esc(time)}</small><div class="region-feed-line"><span>${esc(countText)}</span>
        <a href="/feeds?collector=${encodeURIComponent(feed.id)}" target="_blank" rel="noopener">Poll history ↗</a></div></li>`;
    }).join('');
    statusBody.innerHTML = '<p class="subtle">'+esc(coverageSummary+asOf)+'</p>'+
      (rows ? '<p class="subtle">Poll checks cover the full feed. Report counts use the current region, desk, and evidence filter.</p><ul class="region-feed-list">'+rows+'</ul>' :
        '<p class="subtle">Broader sources may still contribute reports for this area.</p>');
    statusDialog.showModal();
    schedule();
  };
  function checkLevels(status) {
    const alertTiles = status.map(t => ({ ...t, level: t.alertLevel || t.level, headline: t.alertHeadline || t.headline }));
    const levels = Object.fromEntries(alertTiles.map(t => [t.id, t.level]));
    // The first snapshot sets the baseline; only later escalations alert.
    if (lastLevels) {
      const ups = alertTiles.filter(t => rank[t.level] > rank[lastLevels[t.id] || 'green']);
      if (ups.length) {
        const worst = ups.reduce((a, b) => rank[b.level] > rank[a.level] ? b : a);
        showBanner(ups, worst.level);
        if (worst.level === 'red' || settings.amber) tone(worst.level);
      }
    }
    lastLevels = levels;
  }
  function showBanner(tiles, level) {
    const banner = $('kiosk-banner');
    banner.className = `kiosk-banner ${level}`;
    banner.innerHTML = `${tiles.map(t => `<strong>${esc(t.label.toUpperCase())} → ${levelNames[t.level]}</strong> ${esc(t.headline)}`).join('<span class="kiosk-sep">·</span>')}<button type="button" aria-label="Dismiss alert">✕</button>`;
    banner.hidden = false; banner.querySelector('button').onclick = () => { banner.hidden = true; };
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { banner.hidden = true; }, level === 'red' ? 300000 : 60000);
  }
  function quietNow(date = new Date()) {
    const { quietStart: a, quietEnd: b } = settings; if (!a || !b || a === b) return false;
    const now = date.toTimeString().slice(0, 5);
    return a < b ? now >= a && now < b : now >= a || now < b;
  }
  function ensureAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null;
    if (!audio) audio = new Ctx();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  }
  // Tiered tones, synthesized so no audio files ship: a soft two-note chime for Elevated, a four-pulse alarm for Severe.
  function tone(level, force = false) {
    if (!force && (!settings.sound || quietNow())) return;
    const ctx = ensureAudio(); if (!ctx) return;
    const t0 = ctx.currentTime + 0.05, notes = level === 'red' ? [[880, 0], [660, 0.35], [880, 0.7], [660, 1.05]] : [[660, 0], [990, 0.18]];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), peak = settings.volume * (level === 'red' ? 0.22 : 0.3);
      osc.type = level === 'red' ? 'square' : 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at); gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.3);
      osc.connect(gain).connect(ctx.destination); osc.start(t0 + at); osc.stop(t0 + at + 0.32);
    }
  }

  // ---- Focus tour: the top stories of the past hour (the server's ranked headlines, which widen to 3, 6, 12 or 24 hours
  // when the hour is quiet and hold at most two outages), then up to two hot spots. Unplaced stories show on a world view.
  // A story that joins the list after the first build is shown next, ahead of the normal rotation. ----
  let knownIds = null, arrivals = [];
  function buildFocus() {
    const ranked = (settings.primary ? data.primaryHeadlines?.[desk] : desk==='all' ? data.headlines : data.headlinesByDesk?.[desk]) || data.headlines;
    const prior = focusList[focusIndex];
    const current = prior?.id;
    const byId = new Map(scopedStories.map(story=>[story.id,story]));
    const localRanking = region || settings.listed || settings.watchOnly || byReceipt() ? CapstoneHeadlines.rank(scopedStories,{now:Date.now(),listed:settings.listed,received:byReceipt()}) : null;
    const windowHours = localRanking?.window || ranked?.window_hours || 24;
    const stories = localRanking ? localRanking.selected.map(item=>item.story) : (ranked?.rows || [])
      .filter(row=>matchesDesk(row) && !window.CapstoneReading?.muted(row)).map(row=>byId.get(row.id)).filter(Boolean);
    const list = stories.map(e => ({ type: 'story', id: e.id, lat: activeLocation(e) ? e.lat : null, lon: activeLocation(e) ? e.lon : null, story: e, windowHours }));
    for (const h of mixedHotspots().filter(isLocated).slice(0, 2)) list.push({ type: 'hotspot', id: h.id, lat: h.lat, lon: h.lon, spot: h });
    const ids = new Set(list.map(f => f.id));
    if (paused && prior?.type==='story' && !ids.has(current)) {
      const story = byId.get(current) || prior.story;
      if (matchesScope(story) && !window.CapstoneReading?.muted(story)) {
        const located = activeLocation(story);
        list.unshift({...prior,story,lat:located ? story.lat : null,lon:located ? story.lon : null,held:true});
      }
    }
    if (knownIds) for (const f of list) if (f.type === 'story' && !f.held && !knownIds.has(f.id) && !arrivals.includes(f.id)) arrivals.push(f.id);
    knownIds = new Set([...(knownIds || [])].filter(id=>byId.has(id)).concat([...ids]));
    arrivals = arrivals.filter(id => ids.has(id));
    focusList = list;
    const keep = list.findIndex(f => f.id === current);
    focusIndex = keep >= 0 ? keep : Math.min(focusIndex, Math.max(0, list.length - 1));
  }
  function newlyReceivedOrPublished(story) {
    return (byReceipt() || story.date_precision!=='day') &&
      Date.now()-Date.parse(byReceipt()?rankingTime(story):story.first_ts || story.ts)<15*60_000;
  }
  function renderFocus(fly = true) {
    const f = focusList[focusIndex], card = $('kiosk-focus');
    const previousScroll = card.dataset.focusId === f?.id ? card.querySelector('.kiosk-focus-content')?.scrollTop || 0 : 0;
    if (f) card.dataset.focusId = f.id;
    else delete card.dataset.focusId;
    visibleReport = f?.story ? {report:leadReport(f.story),related:f.story.reports || [f.story]} : null;
    if (!f) {
      card.textContent = '';
      const heading = document.createElement('h2');
      const type = desk==='all' ? 'ranked' : deskChoices.get(desk);
      const listingType = desk==='cyber' ? 'network' : desk==='geo' ? 'weather or travel' : '';
      heading.textContent = settings.listed ? (!hasLiveListings() ? 'Waiting for live '+(desk==='geo'?'weather and travel ':listingType?listingType+' ':'')+'listings' :
        (settings.watchOnly?'No current listings match your watchlists':`No current ${listingType?listingType+' ':''}listings`)+(region?' for '+regionLabel():'')) :
        (settings.watchOnly?'No watchlist matches':'No '+type+' stories')+(region ? ' for '+regionLabel() : '')+
        (byReceipt()?' received in the last 24 hours':' in the last 24 hours');
      card.append(heading);
      if (settings.watchOnly) {
        const watchlists = document.createElement('a');
        watchlists.href = '/watch';
        watchlists.target = '_blank';
        watchlists.rel = 'noopener';
        watchlists.textContent = 'Manage watchlists ↗';
        card.append(watchlists);
      }
      $('kiosk-unplaced')?.setAttribute('hidden', '');
      if (mapReady) {
        paintFocusShape(null);
        setMapData('focus',{type:'FeatureCollection',features:[]});
        if (!exploring) map.jumpTo({...restingMapView(),padding:{top:0,left:0,bottom:0,right:0}});
      }
      if (fallback) renderFallback();
      displayedFocus = focusSignature();
      return;
    }
    const position = `${focusIndex + 1}/${focusList.length}`;
    // Source links open the original report (the desktop app sends them to the default browser).
    const source = (url, label) => /^https?:\/\//i.test(url || '') ? `<a class="kiosk-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : `<span class="kiosk-source-none">${esc(label)}</span>`;
    if (f.type === 'hotspot') {
      const h = f.spot;
      card.innerHTML = `<div class="kiosk-focus-content" tabindex="0" role="region" aria-label="Hot spot summary"><p class="eyebrow">HOT SPOT · ${position}</p><h2>${esc(h.name)}${h.spike ? ` <span class="spike-badge">${esc(h.spike.ratio)}× VOLUME</span>` : ''}</h2><div class="family-chips">${h.families.map(x => `<span>${esc(x.label)} · ${x.count}</span>`).join('')}</div><ol class="kiosk-headlines">${h.top.map(t => `<li><span>${esc(t.title)}</span><small>${source(t.url, t.source)} · ${esc(zulu(t.ts))}</small></li>`).join('')}</ol><p class="kiosk-basis">${esc(h.basis.join(' · '))}. A reason to look, not proof the reports are linked.</p></div>`;
    } else {
      const e = f.story, epss = e.epss ? `<span class="epss${e.epss.epss >= 0.1 ? ' high' : ''}">EPSS ${Math.round(e.epss.epss * 100)}%</span>` : '';
      const rotationLabel = settings.listed ? 'CURRENTLY LISTED' : (byReceipt()?'RECEIVED, ':'TOP STORIES, ')+(f.windowHours===1?'PAST HOUR':`PAST ${f.windowHours} HOURS`);
      const isNew = newlyReceivedOrPublished(e);
      const d = CapstoneTypes.describe(e);
      const report = visibleReport.report;
      const shape = focusShape(f);
      const quakeDetails = CapstoneTypes.seismicFacts(report).slice(0,2)
        .map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
      const mapDetail = shape ? `<div><dt>Map overlay</dt><dd>${esc(shape.label)}</dd></div>` : '';
      const networkDetail = report.outage_received && e.kind==='outage' ?
        `<div><dt>Latest receipt for detection</dt><dd>${esc(sourceTime({ts:report.outage_received}))}</dd></div>` : '';
      const otherReceipt = byReceipt() && e.latest_received && e.latest_received!==report.first_received ?
        `<div><dt>Latest related receipt</dt><dd>${esc(sourceTime({ts:e.latest_received}))}</dd></div>` : '';
      const watch = report.watch_matches?.length ? `<p class="kiosk-watch">Watching ${esc(report.watch_matches.join(' · '))}</p>` : '';
      const reference = CapstoneTypes.sourceReference(report);
      const place = isLocated(e) ? e.place || CapstoneTypes.placement(e) : 'Location not established';
      card.innerHTML = `<div class="kiosk-focus-content" tabindex="0" role="region" aria-label="Focused report"><p class="eyebrow"><span class="etype" style="--tone:var(--${d.tone});--tone-text:var(--${d.tone}-text,var(--${d.tone}))"><b aria-hidden="true">${d.glyph}</b> ${esc(d.label)}</span><span class="evidence ev-${esc(d.evidence.toLowerCase().replace(/[^a-z]+/g, '-'))}">${esc(d.evidence)}</span> · ${f.held ? 'REPORT HELD' : rotationLabel+' · '+position}</p><h2>${isNew ? '<span class="tick-new">NEW</span> ' : ''}${esc(e.title)}</h2><p class="kiosk-summary">${esc(String(e.summary || '').slice(0, 280))}</p><dl class="kiosk-facts"><div><dt>${CapstoneTypes.sourceDateLabel(report.source_date_basis)}</dt><dd>${esc(sourceTime(report))}</dd></div>${report.first_received ? `<div><dt>First received</dt><dd>${esc(sourceTime({ts:report.first_received}))}</dd></div>` : ''}<div><dt>${esc(CapstoneTypes.referencePlacement(e) ? 'Map reference' : 'Location')}</dt><dd>${esc(place)}${CapstoneTypes.referencePlacement(e) ? `<small>${esc(CapstoneTypes.placement(e))}</small>` : ''}</dd></div>${otherReceipt}${networkDetail}${mapDetail}${quakeDetails}</dl>${watch}${epss ? `<p class="kiosk-basis">${epss}</p>` : ''}</div><p class="kiosk-source-row"><button type="button" class="kiosk-report-button" data-kiosk-report aria-haspopup="dialog">Report details</button>${source(report.url, reference ? 'Open '+reference : 'Read '+report.source)}</p>`;
    }
    card.querySelector('.kiosk-focus-content').scrollTop = previousScroll;
    displayedFocus = focusSignature();
    renderMapFocus(f, fly);
  }
  function focusShape(focus) {
    if (!isLocated(focus) || !focus.story) return null;
    const story = focus.story;
    if (hasLiveListings() && CapstoneTypes.currentListing(story)) {
      if (story.weather_area) return {geometry:story.weather_area,label:'Published warning area'};
      if (story.road_geometry) return {geometry:story.road_geometry,label:'Published road segment'};
    }
    return story.observation_track ? {geometry:story.observation_track,label:'Published observation track'} : null;
  }
  const regionCentre = () => regionLabels.get(region);
  function restingMapView() {
    const ref = regionCentre();
    return isLocated(ref) ? {center:[ref.lon,ref.lat],zoom:region.startsWith('country:')?2.8:4.3} :
      {center:[15,22],zoom:settings.projection==='globe'?1.6:1.2};
  }
  function cameraPadding(width,height) {
    const card = $('kiosk-focus');
    const belowMap = window.innerWidth<=600;
    return {top:0,left:0,
      right:belowMap ? 0 : Math.min(card.offsetWidth+40,width*0.45),
      bottom:belowMap ? Math.min(card.offsetHeight+22,height*0.55) : 0};
  }
  function renderMapFocus(f, fly = true) {
    if (!f) {
      if (mapReady && !exploring) map.jumpTo(restingMapView());
      return;
    }
    const located = isLocated(f);
    // Many reports (most CVEs) carry no place; say so on the map instead of leaving a zoomed-out world unexplained.
    let note = document.getElementById('kiosk-unplaced');
    if (!note) { note = document.createElement('p'); note.id = 'kiosk-unplaced'; note.className = 'kiosk-unplaced'; note.textContent = ''; $('kiosk-map').parentElement.append(note); }
    note.hidden = located;
    if (!located) note.textContent = f.story && isLocated(f.story) ? 'Location withheld from the current map view' :
      (region ? 'No point for this report · '+regionLabel()+' view' : 'No point for this report · world view');
    if (mapReady) {
      paintFocusShape(f);
      setMapData('focus',{ type: 'FeatureCollection', features: located ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } }] : [] });
      // Close enough to read the region from across the room; hot spots are country centroids, so they sit a step wider than stories.
      // Keep the point clear of the card, which moves below the map on narrow screens.
      if (fly && !exploring) {
        const globe = settings.projection==='globe';
        const container = map.getContainer();
        const padding = cameraPadding(container.clientWidth,container.clientHeight);
        const target = located ? { center: [f.lon, f.lat], zoom: (f.type === 'hotspot' || ['regional_reference','mapping_area'].includes(f.story?.place_basis) ? 3.8 : 4.6) + (globe ? 0 : 0.4), padding } : { ...restingMapView(), padding };
        reducedMotion() ? map.jumpTo(target) : map.flyTo({ ...target, duration: 4000, essential: true }); }
    } else if (fallback) renderFallback();
  }
  function schedule() {
    clearTimeout(timer);
    const bar = $('kiosk-progress').firstElementChild; bar.style.animation = 'none'; void bar.offsetWidth;
    timer = null; if (paused || dialogOpen() || focusList.length < 2 || $('kiosk-focus').contains(document.activeElement)) return;
    bar.style.animation = `kiosk-progress ${settings.dwell}s linear forwards`;
    timer = setTimeout(advance, settings.dwell * 1000);
  }
  // The automatic step shows a newly arrived top story first; the arrow keys always step in order.
  function advance() { const next = arrivals.shift(), at = next ? focusList.findIndex(f => f.id === next) : -1; if (at >= 0) { focusIndex = at; renderFocus(); schedule(); } else step(1); }
  function step(direction) {
    if (!focusList.length) return;
    focusIndex = (focusIndex + direction + focusList.length) % focusList.length;
    const next = focusList[focusIndex];
    if (!next.held && focusList.some(f=>f.held)) {
      focusList = focusList.filter(f=>!f.held);
      focusIndex = focusList.findIndex(f=>f.id===next.id);
    }
    renderFocus(); schedule();
  }
  function setPaused(value) {
    paused = value;
    document.body.classList.toggle('kiosk-paused', paused);
    $('kiosk-pause').textContent = paused ? 'Resume tour' : 'Pause tour';
    $('kiosk-pause').setAttribute('aria-pressed', String(paused));
    if (!paused && data && focusList.some(f=>f.held)) {
      buildFocus();
      syncFocus(true);
    }
    syncTickerMotion();
    schedule();
  }
  function focusSignature() {
    const focus = focusList[focusIndex];
    if (!focus) return 'empty';
    const story = focus.story;
    const contents = story ? [story.id, story.revision, story.ts, story.title, story.summary, story.confidence, story.place, story.place_basis, story.weather_geometry_revision, story.seismic, story.outage_received, story.latest_received, focusShape(focus)?.label, focus.lat, focus.lon,
      newlyReceivedOrPublished(story)] : focus.spot;
    return JSON.stringify([focusList.length, focusIndex, focus.windowHours, focus.held, contents]);
  }
  function syncFocus(moveCamera) {
    if (!dialogOpen() && !$('kiosk-focus').contains(document.activeElement) && displayedFocus !== focusSignature()) renderFocus(moveCamera);
  }
  $('kiosk-focus').addEventListener('focusin', schedule);
  $('kiosk-focus').addEventListener('click', event=>{
    if (!event.target.closest('[data-kiosk-report]')) return;
    if (!visibleReport) return;
    void CapstoneReports.open(visibleReport.report,visibleReport.related);
    schedule();
  });
  document.addEventListener('report-drawer-close',()=>{ syncFocus(true); schedule(); wake(); });
  $('kiosk-focus').addEventListener('focusout', () => setTimeout(() => {
    if (!$('kiosk-focus').contains(document.activeElement)) { syncFocus(true); schedule(); }
  }, 0));

  function renderQueue(note = '') {
    const title = deskChoices.get(desk);
    const count = focusList.length;
    $('kiosk-queue-status').textContent = [note,title,region?regionLabel():'',settings.listed?'Currently listed':byReceipt()?'By first receipt':'',settings.watchOnly?'Watchlist matches only':'',count+' '+(count===1?'stop':'stops'),settings.primary?'Official or measured':'',count?'Choose a stop to hold it on screen':''].filter(Boolean).join(' · ');
    const rows = focusList.map((focus,index) => {
      const current = index===focusIndex;
      const title = focus.story?.title || focus.spot.name;
      const meta = focus.story ? [CapstoneTypes.describe(focus.story).evidence,focus.story.source,sourceTime(leadReport(focus.story))].filter(Boolean).join(' · ') : 'Hot spot';
      return `<li><button type="button" data-kiosk-stop="${esc(focus.id)}"${current?' aria-current="true"':''}><span>${esc(title)}</span><small>${esc(meta)}${current?' · Current':''}${focus.held?' · Held':''}</small></button></li>`;
    }).join('');
    $('kiosk-queue-list').innerHTML = rows ? `<ol>${rows}</ol>` : '<p class="empty-state">No stories in this rotation.</p>';
  }
  function openQueue() {
    renderQueue();
    queue.showModal();
    schedule();
    const selected = queue.querySelector('[aria-current="true"]');
    selected?.scrollIntoView({block:'nearest'});
  }
  $('kiosk-queue-open').onclick = openQueue;
  $('kiosk-queue-close').onclick = () => queue.close();
  $('kiosk-queue-list').addEventListener('click',event=>{
    const id = event.target.closest('[data-kiosk-stop]')?.dataset.kioskStop;
    if (!id) return;
    const index = focusList.findIndex(f=>f.id===id);
    if (index<0) {
      renderQueue('That story has left the rotation');
      $('kiosk-queue-close').focus();
      return;
    }
    const selected = focusList[index];
    setExploration(false,false);
    if (!selected.held) focusList = focusList.filter(f=>!f.held);
    focusIndex = focusList.indexOf(selected);
    arrivals = arrivals.filter(arrival=>arrival!==id);
    setPaused(true);
    queue.close();
    renderFocus();
  });
  for (const dialog of [queue,settingsDialog,statusDialog]) dialog.addEventListener('close',()=>{ syncFocus(true); schedule(); wake(); });

  // Queue changed headlines until the crawl finishes its current loop.
  const tickerTrack = $('kiosk-ticker-track'), tickerWindow = tickerTrack.parentElement;
  const staticTicker = () => paused || reducedMotion();
  function showTicker(next, reset = false) {
    const stationary = staticTicker();
    const scroll = reset || !stationary ? 0 : tickerWindow.scrollLeft;
    tickerShown = next;
    tickerPending = null;
    tickerTrack.style.animation = 'none';
    tickerTrack.innerHTML = `<span class="kiosk-ticker-segment">${next.items}</span>` +
      (stationary || !next.count ? '' : `<span class="kiosk-ticker-segment" aria-hidden="true" inert>${next.items}</span>`);
    tickerWindow.scrollLeft = scroll;
    if (!stationary && next.count) {
      void tickerTrack.offsetWidth;
      tickerTrack.style.animation = `kiosk-ticker ${Math.max(22,tickerTrack.firstElementChild.offsetWidth / 65)}s linear infinite`;
    }
  }
  function syncTickerMotion() {
    const stationary = staticTicker();
    tickerWindow.classList.toggle('kiosk-ticker-static',stationary);
    tickerWindow.tabIndex = stationary ? 0 : -1;
    const next = tickerPending || tickerShown;
    if (next) showTicker(next);
  }
  tickerTrack.addEventListener('animationiteration',()=>{ if (tickerPending) showTicker(tickerPending); });
  function renderTicker(reset = false) {
    const cutoff = Date.now()-DAY;
    const matches = scopedStories.filter(row => row.outage_state!=='stale' &&
      (settings.listed || Date.parse(rankingTime(row))>=cutoff) && !window.CapstoneReading?.muted(row));
    renderScopeCounts(matches.length);
    const rows = matches.sort((a,b)=>Date.parse(rankingTime(b))-Date.parse(rankingTime(a))).slice(0,40);
    $('kiosk-ticker-label').textContent = settings.listed ? 'LISTED' : byReceipt() ? 'RECEIVED' : desk==='all' ? 'LATEST' : ({cyber:'CYBER',geo:'WORLD',ai:'AI'})[desk];
    const key = JSON.stringify([desk,region,settings.primary,settings.listed,settings.watchOnly,settings.received,rows.map(row=>[row.id,row.revision,row.ts,row.title])]);
    if (!reset && key===tickerKey) return;
    tickerKey = key;
    const items = rows.map(row => {
      const report = leadReport(row);
      const {evidence} = CapstoneTypes.describe(report);
      const uncertain = ['Claim','Unverified','Modeled alert','Automated detection','Provider annotation'].includes(evidence);
      return `<span class="tick"><i class="dot ${esc(row.category)}"></i>${esc(sourceTime(byReceipt()?{ts:rankingTime(row)}:report))} · ${uncertain ? `<small>${esc(evidence)}</small>` : ''}${esc(row.title)} <b>${esc(report.source)}</b></span>`;
    }).join('') || '<span class="tick">No headlines available</span>';
    const next = {items,count:rows.length};
    if (reset || staticTicker() || !tickerShown?.count) showTicker(next,reset);
    else tickerPending = next;
  }

  // ---- Map ----
  // Points take their type's color (event-types.js) and grow with score; chatter posts stay small and faint, so the
  // strongest stories read first from across the room.
  function pointsGeo() {
    const styles = getComputedStyle(document.body);
    const colors = new Map();
    const features = located24().slice(0,250).map(report=>{
      const detail = CapstoneTypes.describe(report);
      if (!colors.has(detail.tone)) colors.set(detail.tone,styles.getPropertyValue('--'+detail.tone).trim() || styles.getPropertyValue('--signal').trim());
      const radius = detail.chatter ? 3.5 : detail.severity==='critical' ? 10 : detail.severity==='high' ? 7.5 : 5.5;
      return {type:'Feature',properties:{id:report.id,color:colors.get(detail.tone),r:radius,o:detail.chatter?0.45:0.95},
        geometry:{type:'Point',coordinates:[report.lon,report.lat]}};
    }).sort((a,b)=>a.properties.r-b.properties.r);
    return {type:'FeatureCollection',features};
  }
  const spotsGeo = () => ({ type: 'FeatureCollection', features: mixedHotspots().filter(isLocated).map(h => ({ type: 'Feature', properties: { families: h.families.length }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })) });
  const selectedCode = type => region.startsWith(type+':') ? region.slice(type.length+1) : '';
  function selectedRegionFeature() {
    if (!region) return null;
    const [type,code] = region.split(':');
    return regionShapes[type]?.find(feature=>feature.properties?.code===code) || null;
  }
  const mapKeys = new Map();
  function setMapData(id,data) {
    const source = map.getSource(id);
    if (!source) return;
    const key = JSON.stringify(data);
    if (mapKeys.get(id)===key) return;
    source.setData(data);
    mapKeys.set(id,key);
  }
  let nightMinute, nightShape;
  function nightLayer() {
    const minute = Math.floor(Date.now()/60_000);
    if (minute!==nightMinute) {
      nightMinute = minute;
      nightShape = nightGeo(new Date(minute*60_000));
    }
    return nightShape;
  }
  function paintFocusShape(focus) {
    const geometry = focusShape(focus)?.geometry;
    setMapData('kiosk-report-shape',{type:'FeatureCollection',features:geometry ? [{type:'Feature',properties:{},geometry}] : []});
  }
  function updateMap() {
    if (mapReady) {
      setMapData('points',pointsGeo());
      setMapData('spots',spotsGeo());
      setMapData('night',nightLayer());
      paintFocusShape(focusList[focusIndex]);
      if (paintedRegion!==region) {
        const feature = selectedRegionFeature();
        map.getSource('kiosk-area')?.setData({type:'FeatureCollection',features:feature?[feature]:[]});
        paintedRegion = region;
        usStateLayer?.refresh();
        refreshProvinceNames?.();
      }
    } else if (fallback) renderFallback();
  }
  async function initMap() {
    try {
      const responses = await Promise.all([fetch('/assets/world.json'), fetch('/assets/world-paths.json'), fetch('/assets/countries.json')]); if (responses.some(r => !r.ok)) throw new Error('Map data unavailable');
      const readAtlas = name => fetch('/assets/'+name+'.json').then(r=>r.ok?r.json():null).catch(()=>null);
      const [[world,paths,names],states,provinces] = await Promise.all([
        Promise.all(responses.map(r=>r.json())),readAtlas('us-states'),readAtlas('ca-provinces')
      ]);
      fallbackLand = paths.map(d=>`<path class="fallback-land" d="${esc(d)}"/>`).join('');
      regionShapes.country = world.features || [];
      regionShapes.state = states?.areas.features || [];
      regionShapes.province = provinces?.areas.features || [];
      countryNames = Object.values(names).filter(c=>c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon));
      maplibregl = await import('/assets/vendor/maplibre-gl.mjs');
      const styles = getComputedStyle(document.body), color = name => styles.getPropertyValue(name).trim();
      map = new maplibregl.Map({ container: 'kiosk-map', center: [15, 22], zoom: 1.6, scrollZoom:false,dragPan:false,dragRotate:false,boxZoom:false,doubleClickZoom:false,keyboard:false,
        touchZoomRotate:false,touchPitch:false,renderWorldCopies:false,attributionControl:false,
        style: { version: 8, sources: { world: { type: 'geojson', data: world } }, layers: [{ id: 'water', type: 'background', paint: { 'background-color': color('--water') } }, { id: 'land', type: 'fill', source: 'world', paint: { 'fill-color': color('--land') } }, { id: 'borders', type: 'line', source: 'world', paint: { 'line-color': color('--borders'), 'line-width': 0.6 } }] } });
      map.addControl(new maplibregl.AttributionControl({ customAttribution: 'Natural Earth · MapLibre', compact: true }));
      map.on('load', () => {
        if (fallback) return;
        clearTimeout(mapStartupTimer);
        map.addSource('night', { type: 'geojson', data: nightLayer() }); map.addLayer({ id: 'night', type: 'fill', source: 'night', paint: { 'fill-color': color('--night-shade'), 'fill-opacity': Number(color('--night-alpha')) || 0.5 } });
        if (states) CapstoneMapLabels.usStates(maplibregl.Marker,map,{
          before:'night',minZoom:3.4,data:states,selected:()=>selectedCode('state')
        }).then(layer=>{ usStateLayer = layer; });
        if (provinces) {
          map.addSource('kiosk-provinces',{type:'geojson',data:provinces.areas});
          map.addLayer({id:'kiosk-province-borders',type:'line',source:'kiosk-provinces',minzoom:2.55,
            paint:{'line-color':color('--borders'),'line-width':0.6,'line-opacity':0.8}},'night');
          refreshProvinceNames = CapstoneMapLabels.attachRegions(maplibregl.Marker,map,provinces.provinces,{
            minZoom:3.4,selected:()=>selectedCode('province')
          });
        }
        map.addSource('kiosk-area',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        map.addLayer({id:'kiosk-area-fill',type:'fill',source:'kiosk-area',paint:{'fill-color':color('--signal'),'fill-opacity':0.17}});
        map.addLayer({id:'kiosk-area-border',type:'line',source:'kiosk-area',paint:{'line-color':color('--signal'),'line-width':1.5}});
        map.addSource('kiosk-report-shape',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
        map.addLayer({id:'kiosk-report-fill',type:'fill',source:'kiosk-report-shape',
          paint:{'fill-color':color('--sun'),'fill-opacity':0.24}});
        map.addLayer({id:'kiosk-report-outline',type:'line',source:'kiosk-report-shape',
          paint:{'line-color':color('--sun'),'line-width':2,'line-dasharray':[3,2]}});
        map.addSource('spots', { type: 'geojson', data: spotsGeo() }); map.addLayer({ id: 'spots', type: 'circle', source: 'spots', paint: { 'circle-radius': ['+', 16, ['*', 7, ['get', 'families']]], 'circle-color': color('--hot'), 'circle-opacity': 0.14, 'circle-stroke-color': color('--hot'), 'circle-stroke-width': 1.4, 'circle-pitch-alignment': 'map' } });
        map.addSource('points', { type: 'geojson', data: pointsGeo() }); map.addLayer({ id: 'points', type: 'circle', source: 'points', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'o'], 'circle-stroke-opacity': ['get', 'o'], 'circle-stroke-color': color('--paper'), 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } });
        map.addSource('focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); map.addLayer({ id: 'focus', type: 'circle', source: 'focus', paint: { 'circle-radius': 34, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': color('--ink'), 'circle-stroke-width': 4, 'circle-pitch-alignment': 'map' } });
        map.on('click','points',event=>{
          if (exploring) selectMappedReports((event.features || []).map(feature=>feature.properties?.id));
        });
        map.on('mouseenter','points',()=>{if (exploring) map.getCanvas().style.cursor='pointer';});
        map.on('mouseleave','points',()=>{map.getCanvas().style.cursor='';});
        map.setProjection({type:settings.projection});
        mapReady = true;
        map.getCanvas().tabIndex = -1;
        $('kiosk-explore').disabled = false;
        addCountryLabels(); updateMap(); renderMapFocus(focusList[focusIndex]);
      });
      function repaint() {
        if (!mapReady) return; const c = name => getComputedStyle(document.body).getPropertyValue(name).trim();
        map.setPaintProperty('water', 'background-color', c('--water')); map.setPaintProperty('land', 'fill-color', c('--land')); map.setPaintProperty('borders', 'line-color', c('--borders'));
        map.setPaintProperty('night', 'fill-color', c('--night-shade')); map.setPaintProperty('night', 'fill-opacity', Number(c('--night-alpha')) || 0.5);
        map.setPaintProperty('spots', 'circle-color', c('--hot')); map.setPaintProperty('spots', 'circle-stroke-color', c('--hot'));
        setMapData('points',pointsGeo()); map.setPaintProperty('points', 'circle-stroke-color', c('--paper')); usStateLayer?.repaint(c('--borders'));
        map.setPaintProperty('focus', 'circle-stroke-color', c('--ink'));
        map.setPaintProperty('kiosk-area-fill','fill-color',c('--signal'));
        map.setPaintProperty('kiosk-area-border','line-color',c('--signal'));
        map.setPaintProperty('kiosk-report-fill','fill-color',c('--sun'));
        map.setPaintProperty('kiosk-report-outline','line-color',c('--sun'));
        if (map.getLayer('kiosk-province-borders')) map.setPaintProperty('kiosk-province-borders','line-color',c('--borders'));
      }
      Capstone.onTheme(repaint);
      map.on('webglcontextlost',()=>{
        if (!mapReady || fallback) return;
        mapReady = false;
        $('kiosk-explore').disabled = true;
        mapStatus('Restoring globe…');
        mapRecoveryTimer = setTimeout(enableFallback,6000);
      });
      map.on('webglcontextrestored',()=>{
        if (!mapRecoveryTimer || fallback) return;
        map.once('style.load',()=>{
          if (fallback) return;
          if (!map.getSource('points')) return enableFallback();
          clearTimeout(mapRecoveryTimer);
          mapRecoveryTimer = null;
          mapReady = true;
          paintedRegion = undefined;
          mapKeys.clear();
          $('kiosk-explore').disabled = false;
          mapStatus('');
          map.setProjection({type:settings.projection});
          repaint();
          updateMap();
          renderMapFocus(focusList[focusIndex],!exploring);
        });
      });
      mapStartupTimer = setTimeout(()=>{if(!mapReady) enableFallback();},10000);
    } catch (error) { console.warn(error); enableFallback(); }
  }
  // Country names come from map-labels.js (shared with Operations); the focus is the current tour stop.
  const focusTarget = f => f ? { lon: f.lon, lat: f.lat, name: f.spot?.name || f.story?.place || '' } : null;
  // From the world view only countries with a story or hot spot are named (all 240 names was unreadable clutter);
  // zoomed in on a stop, every name may show, decluttered.
  let usStateLayer = null, countryLabels = null;
  function relevantNames() {
    if (map.getZoom() >= 3.2) return null;
    const active = CapstoneMapLabels.matcher({ name: [...located24().map(e => e.place), ...mixedHotspots().map(h => h.name)].join(' | ') });
    return name => active(name);
  }
  function addCountryLabels() { countryLabels=CapstoneMapLabels.attach(maplibregl.Marker,map, countryNames, () => focusTarget(focusList[focusIndex]), { relevant: relevantNames }); }
  const countryMatcher = f => CapstoneMapLabels.matcher(focusTarget(f));
  function mapStatus(message) {
    const status = $('kiosk-map-status');
    status.textContent = message;
    status.hidden = !message;
  }
  function enableFallback() {
    if (fallback) return;
    fallback = true;
    mapReady = false;
    clearTimeout(mapStartupTimer);
    clearTimeout(mapRecoveryTimer);
    mapRecoveryTimer = null;
    map?.remove();
    exploreNavigation = null;
    mapStatus('Simplified map');
    $('kiosk-map').hidden = true;
    $('kiosk-fallback').hidden = false;
    $('kiosk-explore').disabled = false;
    renderFallback();
  }
  let fallbackKey = '';
  function renderFallback() {
    if (!fallbackLand) return;
    const point = ([lon, lat]) => [((lon + 180) * 2).toFixed(1), ((90 - lat) * 2).toFixed(1)], f = focusList[focusIndex];
    // Zoom the flat map onto the focus like the globe does: about 85 degrees across for a hot spot, 55 for a story,
    // with the point centred in the part of the screen the focus card leaves clear. Markers shrink by the zoom so they stay screen-sized.
    const stage = $('kiosk-fallback'), W = stage.clientWidth || 1600, H = stage.clientHeight || 900;
    let box = '0 0 720 360', z = 1;
    const centre = isLocated(f) ? f : regionCentre();
    if (isLocated(centre)) {
      const vw = isLocated(f) ? f.type==='hotspot' ? 170 : 110 : region.startsWith('country:') ? 220 : 110;
      const vh = vw*H/W, [x,y] = point([centre.lon,centre.lat]).map(Number);
      const {right,bottom} = cameraPadding(W,H);
      z = 720/vw;
      box = `${(x-vw*(W-right)/2/W).toFixed(1)} ${(y-vh*(H-bottom)/2/H).toFixed(1)} ${vw} ${vh.toFixed(1)}`;
    }
    const r = n => (n * 1.4 / z).toFixed(2);
    const night = `<path class="fallback-night" d="M${nightLayer().geometry.coordinates[0].map(point).join('L')}Z"/>`;
    const path = geometry => {
      const line = coordinates => 'M'+coordinates.map(point).join('L');
      if (geometry?.type==='LineString') return line(geometry.coordinates);
      if (geometry?.type==='MultiLineString') return geometry.coordinates.map(line).join('');
      const polygons = geometry?.type==='Polygon' ? [geometry.coordinates] : geometry?.type==='MultiPolygon' ? geometry.coordinates : [];
      return polygons.flatMap(polygon=>polygon.map(ring=>line(ring)+'Z')).join('');
    };
    const outline = path(selectedRegionFeature()?.geometry);
    const boundary = outline ? `<path class="kiosk-region-outline" d="${outline}" fill-rule="evenodd"/>` : '';
    const geometry = focusShape(f)?.geometry;
    const footprint = path(geometry);
    const overlay = footprint ? `<path class="kiosk-report-outline ${geometry.type.endsWith('Polygon')?'filled':''}" d="${footprint}" fill-rule="evenodd"/>` : '';
    const locations = located24();
    const hotSpots = mixedHotspots();
    const rings = hotSpots.filter(isLocated).map(h => { const [x, y] = point([h.lon, h.lat]); return `<circle class="fallback-hotspot" cx="${x}" cy="${y}" r="${r(6 + 3 * h.families.length)}"/>`; }).join('');
    const dots = locations.slice(0, 250).map(e => { const [x, y] = point([e.lon, e.lat]), d = CapstoneTypes.describe(e), size = d.chatter ? 1.4 : d.severity === 'critical' ? 3.6 : d.severity === 'high' ? 2.9 : 2.2;
      return `<circle data-kiosk-map-item="${esc(e.id)}" class="fallback-point ${esc(e.category)}" style="fill:var(--${d.tone});opacity:${d.chatter ? 0.45 : 0.95}" cx="${x}" cy="${y}" r="${r(size)}"/>`; }).join('');
    const focus = f && isLocated(f) ? (([x, y]) => `<circle class="kiosk-fallback-focus" cx="${x}" cy="${y}" r="${r(11)}"/>`)(point([f.lon, f.lat])) : '';
    // Country names at about 18 screen pixels, below each centre point; a name that would overlap one already placed is skipped.
    // As on the globe, the focus country's name is twice the base size and the rest shrink with distance from the focus point.
    const base = Math.max(13, Math.min(19, W / 105)) * (720 / z) / W, placed = [], isFocus = countryMatcher(f), [fx, fy] = isLocated(centre) ? point([centre.lon,centre.lat]).map(Number) : [360,180], reach = 720 / z * 0.45;
    // On the whole-world view, only countries with a story or hot spot are named, as on the globe.
    const relevant = z===1 ? [...locations.map(report=>report.place),...hotSpots.map(spot=>spot.name)].join(' | ') : '';
    const key = JSON.stringify([box,W,night,boundary,overlay,rings,dots,focus,focusTarget(f)?.name,relevant]);
    if (key===fallbackKey) return;
    fallbackKey = key;
    const active = z===1 ? CapstoneMapLabels.matcher({name:relevant}) : null;
    const names = countryNames.filter(c => !active || isFocus(c.name) || active(c.name)).map(c => { const [x, y] = point([c.lon, c.lat]).map(Number), focus = isFocus(c.name); return { c, x, y, focus, s: focus ? 2 : 0.72 + 0.4 * Math.max(0, 1 - Math.hypot(x - fx, y - fy) / reach) }; })
      .sort((a, b) => Number(b.focus) - Number(a.focus) || b.s - a.s).map(({ c, x, y, focus, s }) => {
        const fs = base * s, w = c.name.length * fs * 0.56, top = y + (focus ? r(11) * 1.15 : fs * 0.6), rect = [x - w / 2, top, x + w / 2, top + fs];
        if (placed.some(p => rect[0] < p[2] + fs * 0.5 && rect[2] > p[0] - fs * 0.5 && rect[1] < p[3] && rect[3] > p[1])) return ''; placed.push(rect);
        return `<text class="fallback-country${focus ? ' focus' : ''}" x="${x.toFixed(1)}" y="${(top + fs * 0.85).toFixed(2)}" font-size="${fs.toFixed(3)}">${esc(c.name)}</text>`;
      }).join('');
    $('kiosk-fallback').innerHTML = `<svg class="fallback-svg" viewBox="${box}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="World map, simplified renderer">${fallbackLand}${night}${boundary}${overlay}${rings}${dots}${focus}${names}</svg>`;
  }

  new ResizeObserver(()=>{
    if (fallback) renderFallback();
    else if (mapReady && !exploring && focusList.length) {
      const area = map.getContainer();
      map.setPadding(cameraPadding(area.clientWidth,area.clientHeight));
    }
  }).observe($('kiosk-map').closest('.kiosk-stage'));

  $('kiosk-fallback').addEventListener('click',event=>{
    const point = exploring && event.target.closest('[data-kiosk-map-item]');
    if (!point) return;
    const x = point.getAttribute('cx'), y = point.getAttribute('cy');
    selectMappedReports([...$('kiosk-fallback').querySelectorAll('[data-kiosk-map-item]')]
      .filter(item=>item.getAttribute('cx')===x && item.getAttribute('cy')===y)
      .map(item=>item.dataset.kioskMapItem));
  });
  let mappedStories = new Map();
  function openMappedReport(story) {
    if (!story || CapstoneReports.isOpen) return;
    void CapstoneReports.open(leadReport(story),story.reports || [story]);
    schedule();
  }
  function selectMappedReports(ids) {
    if (!ids.length || dialogOpen()) return;
    const targets = new Set(ids);
    const stories = located24().filter(story=>targets.has(story.id))
      .sort((a,b)=>b.score-a.score || Date.parse(b.ts)-Date.parse(a.ts));
    if (stories.length<2) return openMappedReport(stories[0]);
    mappedStories = new Map(stories.map(story=>[story.id,story]));
    $('kiosk-mapped-title').textContent = stories.length+' reports at this point';
    const rows = stories.map(story=>{
      const lead = leadReport(story);
      const meta = [CapstoneTypes.describe(lead).evidence,lead.source,sourceTime(lead)].join(' · ');
      return `<li><button type="button" data-mapped-report="${esc(story.id)}" aria-haspopup="dialog">
        <span>${esc(lead.title)}</span><small>${esc(meta)}</small></button></li>`;
    }).join('');
    $('kiosk-mapped-list').innerHTML = '<ol>'+rows+'</ol>';
    mappedDialog.showModal();
    schedule();
  }
  $('kiosk-mapped-close').onclick = () => mappedDialog.close();
  $('kiosk-mapped-list').addEventListener('click',event=>{
    const id = event.target.closest('[data-mapped-report]')?.dataset.mappedReport;
    openMappedReport(mappedStories.get(id));
  });
  mappedDialog.addEventListener('close',()=>{
    mappedStories.clear();
    schedule();
    wake();
  });
  const compactControls = matchMedia('(max-width: 600px)');
  const controls = $('kiosk-controls');
  const controlsToggle = $('kiosk-controls-toggle');
  let controlsOpen = false;
  function setCompactControls(open) {
    controlsOpen = open;
    controlsToggle.setAttribute('aria-expanded', String(open));
    wake();
  }
  controlsToggle.onclick = () => {
    setCompactControls(!controlsOpen);
    if (controlsOpen) controls.querySelector('button:not([disabled])')?.focus({preventScroll:true});
  };
  compactControls.addEventListener('change', () => setCompactControls(false));

  function setExploration(value,restoreTour=true) {
    if (value===exploring || mapRecoveryTimer || (value && !mapReady && !fallback)) return;
    exploring = value;
    setCompactControls(false);
    controlsToggle.disabled = exploring;
    document.body.classList.toggle('kiosk-exploring',exploring);
    const toggle = $('kiosk-explore');
    toggle.setAttribute('aria-pressed',String(exploring));
    toggle.textContent = exploring ? 'Return to tour' : 'Explore map';
    toggle.title = exploring ? ((mapReady?'Drag or zoom · ':'')+'Select a point · Esc return to tour') : 'Pause and inspect mapped reports';
    if (exploring) $('kiosk-scope-actions').append(toggle);
    else $('kiosk-controls').insertBefore(toggle,$('kiosk-sound'));
    for (const id of ['kiosk-pause','kiosk-prev','kiosk-next']) $(id).disabled = exploring;
    if (mapReady) {
      const canvas = map.getCanvas();
      canvas.tabIndex = exploring ? 0 : -1;
      for (const handler of [map.scrollZoom,map.dragPan,map.doubleClickZoom,map.keyboard,map.touchZoomRotate]) {
        if (exploring) handler.enable();
        else handler.disable();
      }
      if (exploring) {
        map.stop();
        exploreNavigation = new maplibregl.NavigationControl({showCompass:false});
        map.addControl(exploreNavigation,'top-left');
        map.resize();
        canvas.focus({preventScroll:true});
      } else if (exploreNavigation) {
        map.removeControl(exploreNavigation);
        exploreNavigation = null;
        canvas.style.cursor = '';
        map.resize();
      }
    }
    if (exploring) {
      pauseBeforeExplore = paused;
      setPaused(true);
    } else if (restoreTour) {
      setPaused(pauseBeforeExplore);
      renderMapFocus(focusList[focusIndex]);
    }
    wake();
    if (!exploring && restoreTour) (compactControls.matches ? controlsToggle : toggle).focus({preventScroll:true});
    else if (exploring && fallback) toggle.focus({preventScroll:true});
  }
  $('kiosk-explore').onclick = () => setExploration(!exploring);

  function wake() {
    clearTimeout(idleTimer);
    document.body.classList.remove('idle');
    controls.hidden = exploring || (compactControls.matches && !controlsOpen);
    if (compactControls.matches) return;
    idleTimer = setTimeout(() => {
      if (!dialogOpen() && !exploring && !controls.querySelector(':focus-visible')) {
        controls.hidden = true;
        document.body.classList.add('idle');
      }
    }, 4000);
  }
  deskPicker.onchange = () => {
    if (!deskChoices.has(deskPicker.value) || deskPicker.value===desk) return;
    desk = deskPicker.value;
    settings.desk = desk;
    persist();
    updateScope();
  };
  reportMode.onchange = () => {
    settings.listed = reportMode.value==='listed';
    persist();
    updateScope();
  };
  function refreshListingView() {
    const prior = focusList[focusIndex]?.id;
    updateStories(); renderCoverage(); buildFocus(); renderTicker(settings.listed); updateMap();
    syncFocus(true);
    if (!timer || focusList[focusIndex]?.id!==prior) schedule();
  }
  function renderRegion() {
    $('kiosk-region-open').textContent = regionLabel();
    $('kiosk-region-open').setAttribute('aria-label','Kiosk region: '+regionLabel());
    document.title = [desk==='all'?'Kiosk':deskChoices.get(desk)+' Kiosk',region?regionLabel():'','Capstone Viewer'].filter(Boolean).join(' · ');
    renderCoverage();
  }
  const foldRegion = value => value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
  function renderRegionChoices(selected = regionPicker.value) {
    const needle = foldRegion(regionSearch.value.trim());
    const exactCode = needle && regionGroups.some(group=>group.choices.some(place=>place.codes.includes(needle)));
    const matches = place => !needle || (exactCode ? place.codes.includes(needle) : foldRegion(place.name).includes(needle));
    const matched = [];
    const groups = [];
    for (const {label,choices} of regionGroups) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const place of choices) {
        const visible = matches(place);
        if (visible) matched.push(place.value);
        if (visible || place.value===selected) group.append(new Option(place.name,place.value));
      }
      if (group.children.length) groups.push(group);
    }
    regionPicker.replaceChildren(new Option('All regions',''),...groups);
    regionPicker.value = selected;
    const status = $('ks-region-results');
    status.hidden = !needle;
    status.textContent = matched.length ? `${matched.length} matching ${matched.length===1?'region':'regions'}` : 'No matching region names or codes';
    return matched;
  }
  regionSearch.addEventListener('input',()=>renderRegionChoices());
  regionSearch.addEventListener('keydown',event=>{
    if (event.key!=='Enter') return;
    event.preventDefault();
    const found = renderRegionChoices();
    if (found.length===1) regionPicker.value = found[0];
    regionPicker.focus();
  });
  let loadingRegions = null;
  function loadRegions() {
    if (regionLabels.size || loadingRegions) return loadingRegions;
    const message = $('ks-region-message');
    message.hidden = false;
    message.textContent = 'Loading region choices…';
    loadingRegions = Capstone.api('/api/geography').then(options=>{
      const groups = [['state','United States · states and territories',options.states,'us-'],
        ['province','Canada · provinces and territories',options.provinces,'ca-'],['country','Countries and territories',options.countries,'']];
      regionGroups = groups.map(([type,label,places,prefix])=>({label,choices:places.map(place=>{
        const value = type+':'+place.code;
        const code = place.code.toLowerCase();
        regionLabels.set(value,place);
        return {name:place.name,value,codes:prefix?[code,prefix+code]:[code]};
      })}));
      regionPicker.disabled = regionSearch.disabled = false;
      message.hidden = true;
      if (region && !regionLabels.has(region)) { region = ''; updateScope(); }
      else if (region && data) {
        if (!dialogOpen() && !$('kiosk-focus').contains(document.activeElement)) renderFocus(!isLocated(focusList[focusIndex]));
      }
      renderRegionChoices(region);
      renderRegion();
    }).catch(()=>{message.textContent = 'Region choices could not be loaded. Reopen Settings to retry.';})
      .finally(()=>{loadingRegions=null;});
    return loadingRegions;
  }
  function renderScopeSummary() {
    const summary = $('kiosk-evidence-mode');
    const filters = [settings.primary?'Official or measured':'',settings.watchOnly?'Watchlist matches only':'',byReceipt()?'By first receipt':''].filter(Boolean);
    summary.textContent = filters.join(' · ');
    summary.hidden = !filters.length;
  }
  function scopeUrl() {
    const url = new URL('/kiosk',location.origin);
    url.searchParams.set('desk',desk);
    url.searchParams.set('evidence',settings.primary?'primary':'all');
    url.searchParams.set('reports',settings.listed?'listed':'recent');
    url.searchParams.set('watch',settings.watchOnly?'1':'0');
    url.searchParams.set('basis',settings.received?'received':'source');
    regions.toUrl(url.searchParams,region);
    return url;
  }
  function updateScope() {
    document.body.dataset.kioskDesk = desk;
    renderRegion();
    renderScopeSummary();
    history.replaceState(null,'',scopeUrl());
    knownIds = null; arrivals = []; focusList = []; focusIndex = 0; lastLevels = null;
    clearTimeout(bannerTimer);
    $('kiosk-banner').hidden = true;
    document.getElementById('watch-toast')?.remove();
    if (!data) return;
    updateStories();
    renderCoverage();
    const status = activeTiles();
    renderTiles(status); checkLevels(status); buildFocus(); renderTicker(true); updateMap();
    renderFocus(); countryLabels?.refresh(); schedule();
  }
  function renderSoundButton() { $('kiosk-sound').textContent = settings.sound ? 'Sound on' : 'Sound off'; $('kiosk-sound').setAttribute('aria-pressed', String(settings.sound)); }
  function persist() { if (!save('capstone-kiosk', settings)) console.warn('Kiosk settings could not be saved; they last this session.'); }
  document.addEventListener('mousemove', wake);
  document.addEventListener('pointerdown', event => {
    ensureAudio();
    if (controlsOpen && !controls.contains(event.target) && event.target !== controlsToggle) setCompactControls(false);
    else wake();
  });
  document.addEventListener('keydown', e => {
    if (dialogOpen() || e.ctrlKey || e.altKey || e.metaKey || e.target.closest?.('.kiosk-ticker-window') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    wake(); ensureAudio();
    if (exploring) {
      if (e.key==='Escape') setExploration(false);
      return;
    }
    if (e.key === 'Escape' && controlsOpen) {
      setCompactControls(false);
      controlsToggle.focus({preventScroll:true});
      return;
    }
    if (e.target.closest?.('.kiosk-focus-content')) return;
    if (e.key === ' ' && !e.target.closest?.('button, a, summary')) { e.preventDefault(); setPaused(!paused); }
    else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key.toLowerCase() === 'm') { settings.sound = !settings.sound; persist(); renderSoundButton(); }
    else if (e.key.toLowerCase() === 'f') $('fullscreen').click();
    else if (e.key.toLowerCase() === 's') openSettings();
    else if (e.key.toLowerCase() === 'q') openQueue();
  });
  $('kiosk-pause').onclick = () => setPaused(!paused); $('kiosk-next').onclick = () => step(1); $('kiosk-prev').onclick = () => step(-1);
  $('kiosk-sound').onclick = () => { settings.sound = !settings.sound; persist(); renderSoundButton(); };
  function openSettings() {
    $('ks-link-fallback').hidden = true;
    $('ks-link-status').textContent = '';
    regionSearch.value = '';
    renderRegionChoices(region);
    void loadRegions();
    $('ks-evidence').value = settings.primary ? 'primary' : 'all';
    $('ks-watch-only').checked = settings.watchOnly;
    $('ks-time-basis').value = settings.received ? 'received' : 'source';
    $('ks-time-basis').disabled = settings.listed;
    $('ks-dwell').value = settings.dwell; $('ks-projection').value = settings.projection; $('ks-sound').checked = settings.sound; $('ks-amber').checked = settings.amber;
    $('ks-volume').value = settings.volume; $('ks-quiet-start').value = settings.quietStart; $('ks-quiet-end').value = settings.quietEnd; settingsDialog.showModal(); schedule();
  }
  $('kiosk-settings-open').onclick = openSettings; $('kiosk-settings-close').onclick = () => $('kiosk-settings').close();
  $('kiosk-region-open').onclick = () => { openSettings(); if (!regionSearch.disabled) regionSearch.focus(); };
  $('ks-copy-view').onclick = async () => {
    const value = scopeUrl().href;
    const status = $('ks-link-status');
    try {
      await navigator.clipboard.writeText(value);
      $('ks-link-fallback').hidden = true;
      status.textContent = 'Copied view link';
    } catch {
      const field = $('ks-link-value');
      $('ks-link-fallback').hidden = false;
      field.value = value;
      field.focus();
      field.select();
      status.textContent = 'Link ready to copy';
    }
  };
  $('ks-test').onclick = () => tone('red', true);
  $('kiosk-settings-form').onsubmit = e => {
    e.preventDefault();
    const dwell = Math.min(180, Math.max(8, Number($('ks-dwell').value) || defaults.dwell)), projection = $('ks-projection').value === 'mercator' ? 'mercator' : 'globe';
    const primary = $('ks-evidence').value==='primary';
    const selectedRegion = regionPicker.disabled ? region : regionPicker.value;
    const watchOnly = $('ks-watch-only').checked;
    const received = $('ks-time-basis').value==='received';
    const scopeChanged = primary!==settings.primary || selectedRegion!==region || watchOnly!==settings.watchOnly || received!==settings.received;
    region = selectedRegion;
    settings = { ...settings, primary, region, watchOnly, received, dwell, projection, sound: $('ks-sound').checked, amber: $('ks-amber').checked, volume: Math.min(1, Math.max(0, Number($('ks-volume').value))), quietStart: $('ks-quiet-start').value, quietEnd: $('ks-quiet-end').value };
    persist(); renderSoundButton(); if (mapReady) map.setProjection({ type: projection }); $('kiosk-settings').close(); if (scopeChanged) updateScope(); else { renderFocus(); schedule(); }
  };

  function localClock() {
    $('kiosk-local').textContent = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' local';
    const status = $('kiosk-freshness');
    const received = Date.parse(data?.now);
    status.hidden = !connected || !Number.isFinite(received);
    if (status.hidden) return;
    const age = Math.max(0,Math.floor((Date.now() - received) / 60_000));
    const stale = age >= 10;
    const label = !data.collecting ? 'Collection paused' :
      stale ? 'Snapshot ' + age + ' min old' : 'Updated ' + zulu(received);
    const limited = data.reportWindow?.limited;
    const text = limited ? label + ' · Report limit reached' : label;
    if (status.textContent !== text) status.textContent = text;
    status.classList.toggle('stale',stale || !data.collecting || Boolean(limited));
    status.title = 'Last snapshot ' + zulu(received);
  }
  subscribe(snapshot => {
    if (!Array.isArray(snapshot.stories || snapshot.events)) return;
    const prior = focusList[focusIndex];
    data = snapshot;
    gapButton.hidden = !snapshot.offline;
    if (gapButton.hidden && statusDialog.open && $('kiosk-collection-gap')) {
      statusDialog.close();
      $('kiosk-queue-open').focus({preventScroll:true});
    }
    updateStories();
    renderCoverage();
    localClock();
    const status = activeTiles();
    renderTiles(status); checkLevels(status); buildFocus(); renderTicker(); updateMap();
    const next = focusList[focusIndex];
    const changed = next?.id!==prior?.id;
    syncFocus(changed || next?.lat!==prior?.lat || next?.lon!==prior?.lon);
    if (changed || !timer) schedule();
  });
  onConnection((ok,last) => {
    connected = ok;
    if (!ok && data) refreshListingView();
    renderCoverage();
    localClock();
    const status = $('kiosk-connection');
    status.textContent = ok ? '' : last ? 'Reconnecting · last snapshot '+zulu(last) : 'Waiting for a live snapshot';
    status.hidden = ok;
  });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',syncTickerMotion);
  controls.addEventListener('focusout', wake);
  setPaused(paused); renderSoundButton(); localClock(); setInterval(localClock, 15000);
  setInterval(() => { if (data) updateMap(); }, 300000);
  renderRegion(); renderScopeSummary(); void loadRegions(); void initMap(); wake();
})();

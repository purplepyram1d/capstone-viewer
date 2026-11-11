(() => {
  const { esc, read, save, subscribe, onConnection, nightGeo } = Capstone;
  const $ = id => document.getElementById(id);
  const DAY = 86400000, levelNames = { green: 'NORMAL', amber: 'ELEVATED', red: 'SEVERE' }, rank = { green: 0, amber: 1, red: 2 };
  const labels = { cyber: 'CYBER', geo: 'WORLD', ai: 'AI' };
  const defaults = { dwell: 20, projection: 'globe', sound: true, amber: false, volume: 0.6, quietStart: '', quietEnd: '' };
  const stored = read('capstone-kiosk', {});
  let settings = { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
  let data = null, focusList = [], focusIndex = 0, paused = false, timer = null, map, mapReady = false, fallback = false, worldPaths = null, countryNames = [];
  let lastLevels = null, tickerKey = '', audio = null, idleTimer = null, bannerTimer = null;
  const isLocated = e => Number.isFinite(e?.lat) && Number.isFinite(e?.lon);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zulu = ts => new Date(ts).toISOString().slice(11, 16) + 'Z';
  const located24 = () => (data?.stories || data?.events || []).filter(e => isLocated(e) && (Date.parse(e.ts) >= Date.now() - DAY || (e.kind === 'outage' && e.ongoing)) && !['vendor_hq', 'company_hq'].includes(e.place_basis));

  // ---- Status tiles and escalation alerts ----
  function renderTiles(status) {
    $('kiosk-tiles').innerHTML = status.map(t => `<div class="kiosk-tile ${esc(t.level)}"><span class="status-label">${esc(t.label)}</span><span class="status-level">${levelNames[t.level] || esc(t.level)}</span><span class="kiosk-tile-headline">${t.gaps?.length ? `⚠ Data gap: ${esc(t.gaps.join(', '))}` : esc(t.headline)}</span></div>`).join('');
  }
  function checkLevels(status) {
    const levels = Object.fromEntries(status.map(t => [t.id, t.level]));
    // The first snapshot sets the baseline; only later escalations alert.
    if (lastLevels) {
      const ups = status.filter(t => rank[t.level] > rank[lastLevels[t.id] || 'green']);
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
    const current = focusList[focusIndex]?.id, byId = new Map((data.stories || []).map(s => [s.id, s])), windowHours = data.headlines?.window_hours || 24;
    const list = (data.headlines?.rows || []).filter(r => !window.CapstoneReading?.muted(r)).map(r => byId.get(r.id)).filter(Boolean)
      .map(e => ({ type: 'story', id: e.id, lat: e.lat, lon: e.lon, story: e, windowHours }));
    for (const h of (data.hotspots || []).filter(isLocated).slice(0, 2)) list.push({ type: 'hotspot', id: h.id, lat: h.lat, lon: h.lon, spot: h });
    const ids = new Set(list.map(f => f.id));
    if (knownIds) for (const f of list) if (f.type === 'story' && !knownIds.has(f.id) && !arrivals.includes(f.id)) arrivals.push(f.id);
    knownIds = new Set([...(knownIds || []), ...ids]); arrivals = arrivals.filter(id => ids.has(id));
    focusList = list;
    const keep = list.findIndex(f => f.id === current);
    focusIndex = keep >= 0 ? keep : Math.min(focusIndex, Math.max(0, list.length - 1));
  }
  function renderFocus(fly = true) {
    const f = focusList[focusIndex], card = $('kiosk-focus');
    if (!f) { card.innerHTML = '<p class="eyebrow">QUIET BOARD</p><h2>No stories in the last 24 hours.</h2><p class="subtle">Headlines keep running below.</p>'; return; }
    const position = `${focusIndex + 1}/${focusList.length}`;
    // Source links open the original report (the desktop app sends them to the default browser).
    const source = (url, label) => /^https?:\/\//i.test(url || '') ? `<a class="kiosk-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : `<span class="kiosk-source-none">${esc(label)}</span>`;
    if (f.type === 'hotspot') {
      const h = f.spot;
      card.innerHTML = `<p class="eyebrow">HOT SPOT · ${position}</p><h2>${esc(h.name)}${h.spike ? ` <span class="spike-badge">${esc(h.spike.ratio)}× VOLUME</span>` : ''}</h2><div class="family-chips">${h.families.map(x => `<span>${esc(x.label)} · ${x.count}</span>`).join('')}</div><ol class="kiosk-headlines">${h.top.map(t => `<li><span>${esc(t.title)}</span><small>${source(t.url, t.source)} · ${esc(zulu(t.ts))}</small></li>`).join('')}</ol><p class="kiosk-basis">${esc(h.basis.join(' · '))}. A reason to look, not proof the reports are linked.</p>`;
    } else {
      const e = f.story, epss = e.epss ? `<span class="epss${e.epss.epss >= 0.1 ? ' high' : ''}">EPSS ${Math.round(e.epss.epss * 100)}%</span>` : '';
      const windowText = f.windowHours === 1 ? 'PAST HOUR' : `PAST ${f.windowHours} HOURS`, isNew = Date.now() - Date.parse(e.first_ts || e.ts) < 15 * 60000;
      card.innerHTML = `<p class="eyebrow"><i class="dot ${esc(e.category)}"></i> ${labels[e.category] || 'REPORT'} · TOP STORIES, ${windowText} · ${position}</p><h2>${isNew ? '<span class="tick-new">NEW</span> ' : ''}${esc(e.title)}</h2><p class="kiosk-summary">${esc(String(e.summary || '').slice(0, 280))}</p><p class="kiosk-basis">${esc(e.place || 'Location not reported')} · ${esc(e.confidence)} · ${esc(zulu(e.ts))} ${epss}</p><p class="kiosk-source-row">${source(e.url, 'Source: ' + e.source)}</p>`;
    }
    if (mapReady) {
      const located = isLocated(f);
      map.getSource('focus')?.setData({ type: 'FeatureCollection', features: located ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } }] : [] });
      // Close enough to read the region from across the room; hot spots are country centroids, so they sit a step wider than stories.
      // Right padding keeps the point clear of the focus card. A story with no place pulls back to the whole world.
      if (fly) { const globe = settings.projection === 'globe', padding = { top: 0, bottom: 0, left: 0, right: Math.min(card.offsetWidth + 40, map.getContainer().clientWidth * 0.45) };
        const target = located ? { center: [f.lon, f.lat], zoom: (f.type === 'hotspot' ? 3.8 : 4.6) + (globe ? 0 : 0.4), padding } : { center: [15, 22], zoom: globe ? 1.6 : 1.2, padding };
        reducedMotion() ? map.jumpTo(target) : map.flyTo({ ...target, duration: 4000, essential: true }); }
    } else if (fallback) renderFallback();
  }
  function schedule() {
    clearTimeout(timer);
    const bar = $('kiosk-progress').firstElementChild; bar.style.animation = 'none'; void bar.offsetWidth;
    timer = null; if (paused || focusList.length < 2) return;
    bar.style.animation = `kiosk-progress ${settings.dwell}s linear forwards`;
    timer = setTimeout(advance, settings.dwell * 1000);
  }
  // The automatic step shows a newly arrived top story first; the arrow keys always step in order.
  function advance() { const next = arrivals.shift(), at = next ? focusList.findIndex(f => f.id === next) : -1; if (at >= 0) { focusIndex = at; renderFocus(); schedule(); } else step(1); }
  function step(direction) { if (!focusList.length) return; focusIndex = (focusIndex + direction + focusList.length) % focusList.length; renderFocus(); schedule(); }
  function setPaused(value) { paused = value; $('kiosk-pause').textContent = paused ? 'Resume tour' : 'Pause tour'; schedule(); }

  // ---- Headline ticker: rebuilt only when the story list changes, so the crawl does not jump ----
  function renderTicker() {
    const rows = (data.stories || data.events || []).slice().sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 40);
    const key = rows.map(e => e.id + e.revision).join('|'); if (key === tickerKey) return; tickerKey = key;
    const items = rows.map(e => `<span class="tick"><i class="dot ${esc(e.category)}"></i>${esc(zulu(e.ts))} · ${esc(e.title)} <b>${esc(e.source)}</b></span>`).join('');
    const track = $('kiosk-ticker-track'); track.innerHTML = items + items;
    track.style.animation = 'none'; void track.offsetWidth;
    if (!reducedMotion() && rows.length) track.style.animation = `kiosk-ticker ${Math.max(60, track.scrollWidth / 2 / 70)}s linear infinite`;
  }

  // ---- Map ----
  const pointsGeo = () => ({ type: 'FeatureCollection', features: located24().slice(0, 250).map(e => ({ type: 'Feature', properties: { category: e.category }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } })) });
  const spotsGeo = () => ({ type: 'FeatureCollection', features: (data?.hotspots || []).filter(isLocated).map(h => ({ type: 'Feature', properties: { families: h.families.length }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })) });
  function updateMap() {
    if (mapReady) { map.getSource('points')?.setData(pointsGeo()); map.getSource('spots')?.setData(spotsGeo()); map.getSource('night')?.setData(nightGeo()); }
    else if (fallback) renderFallback();
  }
  async function initMap() {
    try {
      const responses = await Promise.all([fetch('/assets/world.json'), fetch('/assets/world-paths.json'), fetch('/assets/countries.json')]); if (responses.some(r => !r.ok)) throw new Error('Map data unavailable');
      const [world, paths, names] = await Promise.all(responses.map(r => r.json())); worldPaths = paths;
      countryNames = Object.values(names).filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon));
      const probe = document.createElement('canvas');
      if (!window.maplibregl || !(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL unavailable');
      const styles = getComputedStyle(document.body), color = name => styles.getPropertyValue(name).trim();
      map = new maplibregl.Map({ container: 'kiosk-map', center: [15, 22], zoom: 1.6, interactive: false, renderWorldCopies: false, attributionControl: false,
        style: { version: 8, sources: { world: { type: 'geojson', data: world } }, layers: [{ id: 'water', type: 'background', paint: { 'background-color': color('--water') } }, { id: 'land', type: 'fill', source: 'world', paint: { 'fill-color': color('--land') } }, { id: 'borders', type: 'line', source: 'world', paint: { 'line-color': color('--borders'), 'line-width': 0.6 } }] } });
      map.addControl(new maplibregl.AttributionControl({ customAttribution: 'Natural Earth · MapLibre', compact: true }));
      map.on('load', () => {
        map.addSource('night', { type: 'geojson', data: nightGeo() }); map.addLayer({ id: 'night', type: 'fill', source: 'night', paint: { 'fill-color': color('--night-shade'), 'fill-opacity': Number(color('--night-alpha')) || 0.5 } });
        map.addSource('spots', { type: 'geojson', data: spotsGeo() }); map.addLayer({ id: 'spots', type: 'circle', source: 'spots', paint: { 'circle-radius': ['+', 16, ['*', 7, ['get', 'families']]], 'circle-color': color('--hot'), 'circle-opacity': 0.14, 'circle-stroke-color': color('--hot'), 'circle-stroke-width': 1.4, 'circle-pitch-alignment': 'map' } });
        map.addSource('points', { type: 'geojson', data: pointsGeo() }); map.addLayer({ id: 'points', type: 'circle', source: 'points', paint: { 'circle-radius': 8, 'circle-color': ['match', ['get', 'category'], 'geo', color('--geo'), 'ai', color('--ai'), color('--signal')], 'circle-stroke-color': color('--paper'), 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'map' } });
        map.addSource('focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); map.addLayer({ id: 'focus', type: 'circle', source: 'focus', paint: { 'circle-radius': 34, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': color('--ink'), 'circle-stroke-width': 4, 'circle-pitch-alignment': 'map' } });
        map.setProjection({ type: settings.projection }); mapReady = true; addCountryLabels(); updateMap(); renderFocus();
      });
      // A theme switch (from any window) repaints the globe's layers in the new palette.
      Capstone.onTheme(() => {
        if (!mapReady) return; const c = name => getComputedStyle(document.body).getPropertyValue(name).trim();
        map.setPaintProperty('water', 'background-color', c('--water')); map.setPaintProperty('land', 'fill-color', c('--land')); map.setPaintProperty('borders', 'line-color', c('--borders'));
        map.setPaintProperty('night', 'fill-color', c('--night-shade')); map.setPaintProperty('night', 'fill-opacity', Number(c('--night-alpha')) || 0.5);
        map.setPaintProperty('spots', 'circle-color', c('--hot')); map.setPaintProperty('spots', 'circle-stroke-color', c('--hot'));
        map.setPaintProperty('points', 'circle-color', ['match', ['get', 'category'], 'geo', c('--geo'), 'ai', c('--ai'), c('--signal')]); map.setPaintProperty('points', 'circle-stroke-color', c('--paper'));
        map.setPaintProperty('focus', 'circle-stroke-color', c('--ink'));
      });
      setTimeout(() => { if (!mapReady) enableFallback(); }, 10000);
    } catch (error) { console.warn(error); enableFallback(); }
  }
  // Country names come from map-labels.js (shared with Operations); the focus is the current tour stop.
  const focusTarget = f => f ? { lon: f.lon, lat: f.lat, name: f.spot?.name || f.story?.place || '' } : null;
  function addCountryLabels() { CapstoneMapLabels.attach(map, countryNames, () => focusTarget(focusList[focusIndex])); }
  const countryMatcher = f => CapstoneMapLabels.matcher(focusTarget(f));
  function enableFallback() { if (fallback) return; fallback = true; mapReady = false; map?.remove(); $('kiosk-map').hidden = true; $('kiosk-fallback').hidden = false; renderFallback(); }
  function renderFallback() {
    if (!worldPaths) { $('kiosk-fallback').innerHTML = ''; return; }
    const point = ([lon, lat]) => [((lon + 180) * 2).toFixed(1), ((90 - lat) * 2).toFixed(1)], f = focusList[focusIndex];
    // Zoom the flat map onto the focus like the globe does: about 85 degrees across for a hot spot, 55 for a story,
    // with the point centred in the part of the screen the focus card leaves clear. Markers shrink by the zoom so they stay screen-sized.
    const stage = $('kiosk-fallback'), W = stage.clientWidth || 1600, H = stage.clientHeight || 900, card = $('kiosk-focus').offsetWidth + 40;
    let box = '0 0 720 360', z = 1;
    if (f && isLocated(f)) { const vw = f.type === 'hotspot' ? 170 : 110, vh = vw * H / W, [x, y] = point([f.lon, f.lat]).map(Number), clear = W > 900 ? Math.min(card, W * 0.45) : 0; z = 720 / vw; box = `${(x - vw * ((W - clear) / 2) / W).toFixed(1)} ${(y - vh / 2).toFixed(1)} ${vw} ${vh.toFixed(1)}`; }
    const r = n => (n * 1.4 / z).toFixed(2);
    const night = `<path class="fallback-night" d="M${nightGeo().geometry.coordinates[0].map(point).join('L')}Z"/>`;
    const rings = (data?.hotspots || []).filter(isLocated).map(h => { const [x, y] = point([h.lon, h.lat]); return `<circle class="fallback-hotspot" cx="${x}" cy="${y}" r="${r(6 + 3 * h.families.length)}"/>`; }).join('');
    const dots = located24().slice(0, 250).map(e => { const [x, y] = point([e.lon, e.lat]); return `<circle class="fallback-point ${esc(e.category)}" cx="${x}" cy="${y}" r="${r(2.6)}"/>`; }).join('');
    const focus = f && isLocated(f) ? (([x, y]) => `<circle class="kiosk-fallback-focus" cx="${x}" cy="${y}" r="${r(11)}"/>`)(point([f.lon, f.lat])) : '';
    // Country names at about 18 screen pixels, below each centre point; a name that would overlap one already placed is skipped.
    // As on the globe, the focus country's name is twice the base size and the rest shrink with distance from the focus point.
    const base = Math.max(13, Math.min(19, W / 105)) * (720 / z) / W, placed = [], isFocus = countryMatcher(f), [fx, fy] = f && isLocated(f) ? point([f.lon, f.lat]).map(Number) : [360, 180], reach = 720 / z * 0.45;
    const names = countryNames.map(c => { const [x, y] = point([c.lon, c.lat]).map(Number), focus = isFocus(c.name); return { c, x, y, focus, s: focus ? 2 : 0.72 + 0.4 * Math.max(0, 1 - Math.hypot(x - fx, y - fy) / reach) }; })
      .sort((a, b) => Number(b.focus) - Number(a.focus) || b.s - a.s).map(({ c, x, y, focus, s }) => {
        const fs = base * s, w = c.name.length * fs * 0.56, top = y + (focus ? r(11) * 1.15 : fs * 0.6), rect = [x - w / 2, top, x + w / 2, top + fs];
        if (placed.some(p => rect[0] < p[2] + fs * 0.5 && rect[2] > p[0] - fs * 0.5 && rect[1] < p[3] && rect[3] > p[1])) return ''; placed.push(rect);
        return `<text class="fallback-country${focus ? ' focus' : ''}" x="${x.toFixed(1)}" y="${(top + fs * 0.85).toFixed(2)}" font-size="${fs.toFixed(3)}">${esc(c.name)}</text>`;
      }).join('');
    $('kiosk-fallback').innerHTML = `<svg class="fallback-svg" viewBox="${box}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="World map, simplified renderer">${worldPaths.map(d => `<path class="fallback-land" d="${esc(d)}"/>`).join('')}${night}${rings}${dots}${focus}${names}</svg>`;
  }

  // ---- Controls: hidden until the mouse moves or a key is pressed ----
  function wake() {
    document.body.classList.remove('idle'); $('kiosk-controls').hidden = false;
    clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!$('kiosk-settings').open) { $('kiosk-controls').hidden = true; document.body.classList.add('idle'); } }, 4000);
  }
  function renderSoundButton() { $('kiosk-sound').textContent = settings.sound ? 'Sound on' : 'Sound off'; $('kiosk-sound').setAttribute('aria-pressed', String(settings.sound)); }
  function persist() { if (!save('capstone-kiosk', settings)) console.warn('Kiosk settings could not be saved; they last this session.'); }
  document.addEventListener('mousemove', wake); document.addEventListener('pointerdown', () => { ensureAudio(); wake(); });
  document.addEventListener('keydown', e => {
    if ($('kiosk-settings').open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    wake(); ensureAudio();
    if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
    else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key.toLowerCase() === 'm') { settings.sound = !settings.sound; persist(); renderSoundButton(); }
    else if (e.key.toLowerCase() === 'f') $('fullscreen').click();
    else if (e.key.toLowerCase() === 's') openSettings();
  });
  $('kiosk-pause').onclick = () => setPaused(!paused); $('kiosk-next').onclick = () => step(1); $('kiosk-prev').onclick = () => step(-1);
  $('kiosk-sound').onclick = () => { settings.sound = !settings.sound; persist(); renderSoundButton(); };
  function openSettings() {
    $('ks-dwell').value = settings.dwell; $('ks-projection').value = settings.projection; $('ks-sound').checked = settings.sound; $('ks-amber').checked = settings.amber;
    $('ks-volume').value = settings.volume; $('ks-quiet-start').value = settings.quietStart; $('ks-quiet-end').value = settings.quietEnd; $('kiosk-settings').showModal();
  }
  $('kiosk-settings-open').onclick = openSettings; $('kiosk-settings-close').onclick = () => $('kiosk-settings').close();
  $('ks-test').onclick = () => tone('red', true);
  $('kiosk-settings-form').onsubmit = e => {
    e.preventDefault();
    const dwell = Math.min(180, Math.max(8, Number($('ks-dwell').value) || defaults.dwell)), projection = $('ks-projection').value === 'mercator' ? 'mercator' : 'globe';
    settings = { ...settings, dwell, projection, sound: $('ks-sound').checked, amber: $('ks-amber').checked, volume: Math.min(1, Math.max(0, Number($('ks-volume').value))), quietStart: $('ks-quiet-start').value, quietEnd: $('ks-quiet-end').value };
    persist(); renderSoundButton(); if (mapReady) map.setProjection({ type: projection }); $('kiosk-settings').close(); renderFocus(); schedule();
  };

  function localClock() { $('kiosk-local').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' local'; }
  subscribe(snapshot => {
    if (!Array.isArray(snapshot.stories || snapshot.events)) return;
    const first = !data; data = snapshot;
    const status = Array.isArray(data.status) ? data.status : [];
    renderTiles(status); checkLevels(status); buildFocus(); renderTicker(); updateMap();
    if (first) { renderFocus(); schedule(); } else if (!timer && !paused) schedule();
  });
  onConnection(ok => document.body.classList.toggle('kiosk-offline', !ok));
  renderSoundButton(); localClock(); setInterval(localClock, 15000);
  setInterval(() => { if (data) updateMap(); }, 300000);
  void initMap(); wake();
})();

(() => {
  const { esc, read, save, channel, api, subscribe, onConnection, onPulse } = Capstone;
  const desk=CapstoneDesks.initial('ops');
  let readingRows=[];
  const labels = { cyber: 'CYBER', geo: 'WORLD', ai: 'AI & ROBOTICS' };
  const bases = { manual:'Manually assigned by you',event_location: 'Reported event coordinates', country_centroid: 'Country reference point · approximate', victim: 'Victim location', vendor_hq: 'Vendor HQ city · not attack location', company_hq: 'Company HQ city · not event location', unlocated: 'No reliable location · not mapped' };
  const storedArray = key => { const v = read(key, []); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; };
  let pinned = new Set(storedArray('capstone-pinned')), hidden = new Set(storedArray('capstone-hidden'));
  let events = [], category = desk?.category||'all', sourceFilter=desk?.source||'all', query = desk?.query?.trim().toLowerCase()||'', selected = null,selectedReport=null, map, mapReady = false, fallback = false, world, worldPaths,countries={}, markerCache = new Map(), mapEvents = [], known = new Map(), initialized = false,placementReport=null,placementMode=false,groupReport=null,countryLabels=null;
  let hotspots=[],statusTiles=[],openStatus=null,activeHotspot=null,hotspotFilter=null,windowBeforeHotspot=null,projection=(desk?.projection||read('capstone-projection','mercator'))==='globe'?'globe':'mercator';
  const replay={on:false,start:0,minute:0,timer:null};
  const $ = id => document.getElementById(id);
  const captionDefault=$('map-caption').innerHTML;
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLocated = e => Number.isFinite(e.lat) && Number.isFinite(e.lon);
  const aliases=e=>[e.id,...(e.report_ids||[])],isPinned=e=>aliases(e).some(id=>pinned.has(id));
  const findEvent=id=>events.find(e=>aliases(e).includes(id));
  const members=e=>e.reports||[e];
  const matches = e => !aliases(e).some(id=>hidden.has(id)) && (!hotspotFilter||aliases(e).some(id=>hotspotFilter.has(id))) && members(e).some(r=>(category==='all'||r.category===category)&&(sourceFilter==='all'||sourceFilter==='core'&&!r.platform||r.platform===sourceFilter||r.source_id===sourceFilter)) && (!$('watch-only').checked||e.watch_matches?.length) && `${e.title} ${e.summary} ${e.place} ${e.source} ${members(e).map(r=>r.title+' '+r.source+' '+r.summary).join(' ')} ${(e.display_tags||[]).map(t=>t.label).join(' ')}`.toLowerCase().includes(query);
  const epssPct=v=>v>=0.1?Math.round(v*100)+'%':(v*100).toFixed(v>=0.01?1:2)+'%';
  function ageLabel(ts, precision) { return precision === 'day' ? `${ts.slice(0,10)} · day only` : new Date(ts).toLocaleString('en-GB', { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC' }) + 'Z'; }
  function tagChips(e,limit=6){const tags=e.display_tags||[];return tags.length?`<span class="timeline-tags">${tags.slice(0,limit).map(t=>`<span class="timeline-tag" data-tag-type="${esc(t.type)}" title="${esc(t.type)} · ${t.origin==='manual'?'your label':'source context'}">${esc(t.type)}: ${esc(t.label)}</span>`).join('')}${tags.length>limit?`<span class="timeline-tag">+${tags.length-limit} more</span>`:''}</span>`:'';}
  function renderTimeline() {
    const range = $('time-window').value;
    const cutoff = range === 'today' ? Date.parse(new Date().toISOString().slice(0,10)) : Date.now() - Number(range)*3600000;
    const rows = events.filter(matches).filter(e => Date.parse(e.ts) >= cutoff);
    $('timeline-count').textContent = rows.length;
    $('timeline').innerHTML = rows.length ? rows.map(e => `<article class="timeline-card${selected === e.id ? ' selected' : ''}" data-event="${esc(e.id)}"><button type="button" class="timeline-open" data-event="${esc(e.id)}" aria-pressed="${selected === e.id}"><span class="timeline-top"><i class="dot ${esc(e.category)}"></i>${labels[e.category]}${isPinned(e) ? ' · PINNED' : ''}${e.watch_matches?.length?' · WATCH':''}${e.epss?`<span class="epss${e.epss.epss>=0.1?' high':''}" title="FIRST EPSS: chance of exploitation in the next 30 days for ${esc(e.epss.cve)}">EPSS ${epssPct(e.epss.epss)}</span>`:''}<time datetime="${esc(e.ts)}">${esc(ageLabel(e.ts,e.date_precision))}</time></span><span class="timeline-title">${esc(e.title)}</span>${e.report_count>1?`<span class="story-evidence">${e.report_count} reports · ${e.source_count} source origin${e.source_count === 1 ? "" : "s"}</span>`:''}${tagChips(e)}</button><span class="timeline-bottom"><a class="timeline-source" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" title="Open the original report${e.report_count>1?' (the strongest of '+e.report_count+'; the rest are in the story detail)':''}">${esc(e.source)} ↗</a><span>${isLocated(e) ? esc(e.place) : 'Location unknown'}</span></span></article>`).join('') : `<div class="empty-state">No stories match ${range === 'today' ? 'today’s UTC window' : 'this window'}.${range === 'today' ? '<br>Feeds may not publish every day.<br><button id="show-week">Show the last 7 days</button>' : '<br>Try another category, a wider time window, or clear your search.'}</div>`;
    $('show-week')?.addEventListener('click', () => { $('time-window').value = '168'; renderTimeline(); });
  }
  function curated() {
    const week = Date.now() - 7*86400000;
    const ranked = events.filter(matches).filter(e => isLocated(e) && Date.parse(e.ts) >= week && (e.score >= 55 || isPinned(e)))
      .sort((a,b) => Number(isPinned(b))-Number(isPinned(a)) || b.score-a.score || Date.parse(b.ts)-Date.parse(a.ts));
    const chosen = new Map(ranked.filter(isPinned).slice(0,40).map(e=>[e.id,e]));
    if(category==='all')for(const desk of ['cyber','geo','ai'])for(const e of ranked.filter(e=>e.category===desk).slice(0,4)){if(chosen.size<40)chosen.set(e.id,e);}
    for(const e of ranked){if(chosen.size>=40)break;chosen.set(e.id,e);}return [...chosen.values()];
  }
  const replayTime=()=>replay.start+replay.minute*60000;
  const replayFresh=e=>replay.on&&Date.parse(e.ts)>replayTime()-90*60000;
  function replayEvents(){const t=replayTime();return events.filter(matches).filter(e=>isLocated(e)&&Date.parse(e.ts)>=replay.start&&Date.parse(e.ts)<=t).sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)).slice(0,300);}
  function renderMap() {
    mapEvents = replay.on ? replayEvents() : curated();
    $('map-count').textContent = mapEvents.length;
    if(replay.on)$('map-caption').textContent=`REPLAY · LAST 24 HOURS · ${mapEvents.length} LOCATED STORIES SO FAR`;else $('map-caption').innerHTML=captionDefault;
    const unlocated = events.filter(matches).filter(e => !isLocated(e) && Date.parse(e.ts)>=Date.now()-7*86400000).length;
    $('map-note').textContent = `${unlocated} weekly stories without a reliable point stay in the timeline. HQ markers show context.`;
    if (fallback) return renderFallback();
    if (!mapReady) return;
    const list=[...mapEvents],current=events.find(e=>e.id===selected);if(current&&isLocated(current)&&matches(current)&&!list.includes(current))list.push(current);
    // Shared HQ/country points fan out in screen pixels; their geographic point stays unchanged.
    // Markers are reused by story ID so replay can redraw several times a second.
    const groups = new Map(),keep=new Set();
    for (const e of list) { const key = `${e.lon.toFixed(2)},${e.lat.toFixed(2)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); }
    for (const group of groups.values()) group.forEach((e, i) => {
      const radius = group.length > 1 ? Math.min(40, 14+group.length*2) : 0, angle = i*2*Math.PI/group.length, offset=[radius*Math.cos(angle),radius*Math.sin(angle)];
      const states={cyber:e.category==='cyber',geo:e.category==='geo',ai:e.category==='ai',selected:selected===e.id,new:(initialized && known.get(e.id)!==e.revision)||replayFresh(e)};
      let entry=markerCache.get(e.id);
      // On the globe, markers on the far side are hidden outright (MapLibre's default leaves them at 20%, which
      // read as live events on light themes); a hidden marker also ignores clicks.
      if(!entry){const el=document.createElement('button');el.className='marker';el.addEventListener('click',ev=>{ev.stopPropagation();if(el.style.opacity==='0')return;selectEvent(el.dataset.id,true);});entry={el,marker:new maplibregl.Marker({element:el,offset,opacityWhenCovered:'0'}).setLngLat([e.lon,e.lat]).addTo(map)};markerCache.set(e.id,entry);}
      else entry.marker.setOffset(offset).setLngLat([e.lon,e.lat]);
      // Toggle only our classes: MapLibre adds its own positioning classes to the same element.
      for(const [name,on] of Object.entries(states))entry.el.classList.toggle(name,on);
      entry.el.dataset.id=e.id;entry.el.setAttribute('aria-label', e.title);entry.el.title=`${e.title}\n${bases[e.place_basis]}`;keep.add(e.id);
    });
    for(const [id,entry] of markerCache)if(!keep.has(id)){entry.marker.remove();markerCache.delete(id);}
    map.getSource('hotspots')?.setData(hotspotGeo());
    if(replay.on||replay.nightStale){map.getSource('night')?.setData(nightGeo(replay.on?new Date(replayTime()):new Date()));replay.nightStale=replay.on;}
  }
  const nightGeo=Capstone.nightGeo;
  const hotspotGeo=()=>({type:'FeatureCollection',features:hotspots.filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lon)).map(h=>({type:'Feature',properties:{id:h.id,families:h.families.length,active:h.id===activeHotspot?1:0},geometry:{type:'Point',coordinates:[h.lon,h.lat]}}))});
  function renderHotspots(){
    $('hotspot-count').textContent=hotspots.length;$('clear-hotspot').hidden=!activeHotspot;
    $('hotspots').innerHTML=hotspots.length?hotspots.map(h=>`<button class="hotspot-card" data-hotspot="${esc(h.id)}" aria-pressed="${activeHotspot===h.id}"><span class="hotspot-name">${esc(h.name)}${h.spike?`<span class="spike-badge">${esc(h.spike.ratio)}× VOLUME</span>`:`<small>${h.report_count} report${h.report_count===1?'':'s'}</small>`}</span><span class="family-chips">${h.families.map(f=>`<span>${esc(f.label)} · ${f.count}</span>`).join('')}</span><span class="hotspot-top">${esc(h.top[0]?.title||'')}</span><span class="hotspot-basis">${esc(h.basis.join(' · '))}</span></button>`).join(''):'<div class="empty-state">No country has two kinds of signal in the last 24 hours.<br>A quiet day, not a broken feed: check Collector health below.</div>';
  }
  function toggleHotspot(id){
    const wasActive=!!activeHotspot;activeHotspot=activeHotspot===id?null:id;const h=hotspots.find(h=>h.id===activeHotspot);
    // Widen to 7 days so older ongoing outages show, then hand back the window the viewer had chosen.
    if(h&&!wasActive)windowBeforeHotspot=$('time-window').value;
    if(h&&['today','24'].includes($('time-window').value))$('time-window').value='168';
    if(!h&&windowBeforeHotspot){$('time-window').value=windowBeforeHotspot;windowBeforeHotspot=null;}
    if(h&&mapReady&&Number.isFinite(h.lat))map.flyTo({center:[h.lon,h.lat],zoom:Math.max(map.getZoom(),3.8),essential:false});else countryLabels?.refresh();
    renderHotspots();render();
  }
  const levelNames={green:'NORMAL',amber:'ELEVATED',red:'SEVERE'};
  // "Since you looked": this window records when you last had Operations in front of you (the kiosk does not count).
  const LAST_SEEN='capstone-last-seen',HOUR=3600000;
  const previousLook=Number(read(LAST_SEEN,0))||0;let digestSince=previousLook;
  const markSeen=()=>{if(document.visibilityState==='visible')save(LAST_SEEN,Date.now());};
  const span=ms=>{const h=Math.floor(ms/HOUR),m=Math.round(ms%HOUR/60000);return h>=48?`${Math.round(h/24)} days`:h?`${h}h ${m}m`:`${m} min`;};
  const pct=v=>v===null||v===undefined?'n/a':`${Math.round(v*100)}%`;
  async function openDigest(){
    const choice=$('digest-window').value,since=Math.max(choice==='last'?digestSince||Date.now()-24*HOUR:Date.now()-Number(choice)*HOUR,Date.now()-8*24*HOUR+60000);
    if(!$('digest-dialog').open)$('digest-dialog').showModal();
    $('digest-title').textContent=`What changed in the last ${span(Date.now()-since)}`;$('digest-body').innerHTML='<p class="subtle">Loading…</p>';
    try{renderDigest(await api('/api/digest?since='+encodeURIComponent(new Date(since).toISOString())));}catch(error){$('digest-body').innerHTML=`<p class="feed-error">${esc(error.message)}</p>`;}
  }
  function renderDigest(d){
    const section=(title,items)=>items.length?`<section class="digest-section"><h3>${esc(title)}</h3><ul>${items.join('')}</ul></section>`:'';
    const tiles=d.tiles.filter(t=>t.changed||t.peaked).map(t=>`<li><b>${esc(t.label)}</b> ${t.then?`${levelNames[t.then]} → `:''}<span class="digest-level ${esc(t.now)}">${levelNames[t.now]}</span>${t.peaked?` <small>(peaked ${levelNames[t.peak]} in between)</small>`:''}</li>`);
    const parts=[
      d.partial?`<p class="digest-note">Not enough history to compare the whole stretch: checkpoints only go back to ${d.history_from?esc(new Date(d.history_from).toLocaleString()):'now'}. Changes before that are not shown, so this is not an all-clear.</p>`:'',
      section('Status board',tiles.length?tiles:['<li>No tile changed color.</li>']),
      section('New hot spots',d.hotspots.added.map(h=>`<li><button class="digest-link" data-hotspot="${esc(h.id)}">${esc(h.name)}</button> <small>${h.families} kinds of signal</small></li>`)),
      section('Places no longer meeting the hot spot threshold',d.hotspots.cleared.map(h=>`<li>${esc(h.name)}</li>`)),
      section('Outages that started',d.outages.started.map(o=>`<li>${esc(o.name)}</li>`)),
      section('No longer listed as ongoing (recovery unconfirmed)',d.outages.ended.map(o=>`<li>${esc(o.name)}</li>`)),
      section('EPSS jumps (chance of exploitation in 30 days)',d.epss_movers.map(m=>`<li><button class="digest-link" data-search="${esc(m.cve)}">${esc(m.cve)}</button> ${pct(m.then)} → <b>${pct(m.now)}</b></li>`)),
      section('New CISA KEV entries',d.kev.map(k=>`<li><button class="digest-link" data-event="${esc(k.id)}">${esc(k.title)}</button></li>`)),
      section('New critical CVEs (CVSS 9+)',d.critical.map(c=>`<li><button class="digest-link" data-event="${esc(c.id)}">${esc(c.title)}</button>${c.epss!==null?` <small>EPSS ${pct(c.epss)}</small>`:''}</li>`)),
      d.trending?section('CVEs your sources keep naming',[`<li>${esc(d.trending)}</li>`]):'',
      section(`${d.report_count} new reports`,[`<li>Cyber ${d.totals.cyber||0} · World ${d.totals.geo||0} · AI ${d.totals.ai||0} · from social feeds ${d.totals.social||0}</li>`,...d.sources.map(s=>`<li>${esc(s.source)} <small>${s.count}</small></li>`)])
    ];
    const b=d.briefing;
    const context=$('digest-window').value==='last'&&!previousLook?'<p class="digest-note">First visit: comparing the last 24 hours where history exists.</p>':digestSince&&Date.now()-digestSince>8*24*HOUR&&$('digest-window').value==='last'?'<p class="digest-note">Your last visit is outside retained history. Showing the last eight days.</p>':'';
    $('digest-body').innerHTML=context+(b?b.coverage.map(note=>`<p class="digest-note">⚠ ${esc(note)}</p>`).join('')+`<div class="briefing-cards">${b.cards.map((c,i)=>`<article class="briefing-card"><p class="eyebrow">${i+1} / ${esc(c.label)}</p><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>${c.observed?`<small>Observed by this app ${esc(new Date(c.observed).toLocaleString())}</small>`:''}<div class="briefing-actions">${c.href?`<a href="${esc(c.href)}">Inspect evidence ↗</a>`:''}${c.status?`<button class="digest-link" data-status="${esc(c.status)}">Inspect status rule</button>`:''}${c.links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</div></article>`).join('')}</div>`+(!b.cards.length?`<p class="${b.quiet?'digest-quiet':'digest-note'}">${b.quiet?'No ranked changes detected in the available comparisons. This is not a prediction or an all-clear.':'No ranked changes found. Coverage is incomplete; conditions during gaps are unknown.'}</p>`:'')+(b.remaining?`<p class="subtle">${b.remaining} additional changes in the full comparison.</p>`:''):'')+'<details class="digest-full"><summary>Full comparison & source counts</summary>'+parts.join('')+'</details>';
  }
  $('open-digest').onclick=()=>{$('digest-window').value='last';void openDigest();};
  $('digest-window').onchange=()=>void openDigest();
  $('close-digest').onclick=()=>$('digest-dialog').close();
  $('digest-body').addEventListener('click',e=>{const b=e.target.closest('.digest-link');if(!b)return;$('digest-dialog').close();
    if(b.dataset.status){openStatus=b.dataset.status;renderStatus();$('status-tiles').scrollIntoView({block:'center'});}
    else if(b.dataset.hotspot){if(activeHotspot!==b.dataset.hotspot)toggleHotspot(b.dataset.hotspot);}
    else if(b.dataset.search){$('event-search').value=b.dataset.search;query=b.dataset.search.toLowerCase();$('time-window').value='720';render();}
    else if(b.dataset.event){$('time-window').value='720';render();selectEvent(b.dataset.event,true);}});
  setInterval(markSeen,60000);document.addEventListener('visibilitychange',markSeen);window.addEventListener('pagehide',markSeen);
  // Away more than an hour: open the summary once the first snapshot has had a moment to arrive.
  if(previousLook&&Date.now()-previousLook>HOUR)setTimeout(()=>void openDigest(),2000);
  markSeen();
  function renderStatus(){
    // A tile missing a failing feed's input can look calmer than it is, so the gap is shown on the tile itself.
    $('status-tiles').innerHTML=statusTiles.map(t=>`<button class="status-tile ${esc(t.level)}" data-status="${esc(t.id)}" aria-expanded="${openStatus===t.id}" aria-controls="status-detail"><span class="status-label">${esc(t.label)}</span><span class="status-level">${levelNames[t.level]||esc(t.level)}</span><span class="status-headline">${esc(t.headline)}</span>${t.gaps?.length?`<span class="status-gap">⚠ Data gap: ${esc(t.gaps.join(', '))}</span>`:''}</button>`).join('');
    const t=statusTiles.find(t=>t.id===openStatus);$('status-detail').hidden=!t;
    if(t)$('status-detail').innerHTML=`<p class="eyebrow">${esc(t.label.toUpperCase())} · WHAT SET THIS COLOR</p>${t.gaps?.length?`<p class="status-gap-note">Missing input: ${esc(t.gaps.join(', '))} ${t.gaps.length===1?'is':'are'} failing, so this color may understate the situation.</p>`:''}<dl class="status-inputs">${t.inputs.map(i=>`<div><dt>${esc(i.label)}</dt><dd>${esc(i.value)}${i.note?`<small>${esc(i.note)}</small>`:''}</dd></div>`).join('')}</dl><p class="subtle status-rule">${esc(t.rule)}</p>`;
  }
  // Startup notice when collection was off: the gap, its length, and how the previous session ended.
  function renderOffline(gap){
    const box=$('offline-gap');box.hidden=!gap;if(!gap)return;
    box.innerHTML=`<b>⚠ ${esc(gap.title)}.</b> ${esc(gap.body)} <small>${esc(gap.cause)}</small> <button type="button" id="dismiss-offline">Dismiss</button>`;
    $('dismiss-offline').onclick=async()=>{try{await api('/api/offline/dismiss','POST',{});box.hidden=true;}catch(error){box.querySelector('small').textContent=error.message;}};
  }
  function renderFeedGaps(problems){
    const line=$('feed-gaps');line.hidden=!problems.length;if(!problems.length)return;
    line.innerHTML=`⚠ <b>${problems.length} feed${problems.length===1?'':'s'} ${problems.length===1?'has':'have'} been down over an hour:</b> ${problems.map(p=>`${esc(p.name)} <small>(${p.kind==='stalled'?'stalled':'failing'} since ${esc(new Date(p.since).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))})</small>`).join(', ')} · <a href="#feed-health-panel">Collector health</a>`;
  }
  function renderOutages(){
    // IODA reports one outage per signal (BGP, probing, traffic); list each place once, strongest first.
    const seen=new Set(),rows=events.filter(e=>e.kind==='outage'&&e.ongoing).sort((a,b)=>b.score-a.score||Date.parse(b.ts)-Date.parse(a.ts)).filter(e=>{const key=isLocated(e)?e.place:e.id;if(seen.has(key))return false;seen.add(key);return true;});
    $('outage-count').textContent=rows.length;
    $('outage-list').innerHTML=rows.length?rows.slice(0,8).map(e=>`<button data-event="${esc(e.id)}"><span>${esc(isLocated(e)?e.place:e.title)}</span><small>${esc(e.source)} · since ${esc(new Date(e.first_ts||e.ts).toISOString().slice(5,16).replace('T',' '))}Z</small></button>`).join(''):'<p class="subtle">No ongoing country-level outage reported.</p>';
  }
  function renderPulse(p){
    const state=$('pulse-state'),reading=$('pulse-reading'),spark=$('pulse-spark');
    if(!p){state.textContent='Off';reading.textContent='The routing pulse runs when collectors are on (desktop app or server mode).';spark.innerHTML='';return;}
    state.textContent=p.state==='ok'?(p.surge?'SURGE':'Live'):p.state==='connecting'?'Connecting':'Offline';state.classList.toggle('surge',!!p.surge);
    const values=p.minutes.map(m=>m[2]),max=Math.max(1,...values);
    spark.classList.toggle('surge',!!p.surge);reading.classList.toggle('surge',!!p.surge);
    spark.innerHTML=values.length>1?`<polyline points="${values.map((v,i)=>`${(i/(values.length-1)*240).toFixed(1)},${(46-v/max*44).toFixed(1)}`).join(' ')}"/>`:'';
    reading.textContent=p.state==='error'?`RIS Live unavailable: ${p.error}`:p.last5===null?'Collecting the first five minutes…':`${p.last5.toLocaleString('en-US')} withdrawals / 5 min${p.ratio!==null?` · ${p.ratio}× median`:` · baseline building (${p.baselineWindows}/12)`}`;
  }
  function applyProjection(){
    $('projection-toggle').setAttribute('aria-pressed',String(projection==='globe'));$('projection-toggle').textContent=projection==='globe'?'Flat map':'Globe';
    if(mapReady)map.setProjection({type:projection});
  }
  function startReplay(){
    replay.on=true;replay.start=Date.now()-86400000;replay.minute=reducedMotion()?1440:0;$('replay-slider').value=replay.minute;$('replay-bar').hidden=false;
    $('replay-toggle').setAttribute('aria-pressed','true');$('replay-toggle').textContent='Exit replay';
    if(reducedMotion())renderReplay();else playReplay();
  }
  function stopReplay(){pauseReplay();replay.on=false;$('replay-bar').hidden=true;$('replay-toggle').setAttribute('aria-pressed','false');$('replay-toggle').textContent='Replay 24h';renderMap();}
  function playReplay(){
    if(replay.minute>=1440)replay.minute=0;clearInterval(replay.timer);$('replay-play').textContent='❚❚';$('replay-play').setAttribute('aria-label','Pause');
    replay.timer=setInterval(()=>{replay.minute=Math.min(1440,replay.minute+10);$('replay-slider').value=replay.minute;renderReplay();if(replay.minute>=1440)pauseReplay();},200);renderReplay();
  }
  function pauseReplay(){clearInterval(replay.timer);replay.timer=null;$('replay-play').textContent='▶';$('replay-play').setAttribute('aria-label','Play');}
  function renderReplay(){$('replay-time').textContent=new Date(replayTime()).toISOString().slice(5,16).replace('T',' ')+'Z';renderMap();}
  function renderDetail() {
    const e = events.find(e => e.id === selected);
    if (!e) return;
    $('event-detail').innerHTML = `<p class="eyebrow">${labels[e.category]} / ${esc(e.source)}</p><h3>${esc(e.title)}</h3><p class="subtle">${esc(e.summary)}</p><p class="detail-meta">Updated ${esc(ageLabel(e.ts,e.date_precision))} · ${esc(e.confidence)} · Score ${e.score}/100${e.cvss?` · CVSS ${esc(e.cvss)}`:''}</p>${e.epss?`<p class="epss-detail">EPSS ${epssPct(e.epss.epss)} for ${esc(e.epss.cve)} (${Math.round(e.epss.percentile*100)}th percentile, ${esc(e.epss.date||'latest')}). FIRST's daily estimate of exploitation in the next 30 days; a probability, not a sighting.</p>`:''}${e.watch_matches?.length?`<p class="watch-match">Watching: ${e.watch_matches.map(esc).join(' · ')}</p>`:''}<p class="subtle">${esc(e.place)} — ${esc(bases[e.place_basis] || e.place_basis)}${e.location_note ? '. ' + esc(e.location_note) : ''}</p>${tagChips(e,100)}<div class="detail-actions"><button id="follow-developing">Follow developing story</button><button id="tag-event">Edit tags & notes</button><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Read source ↗</a><button id="place-event">${e.manual_location?'Edit location':'Place on map'}</button>${e.manual_location?'<button id="clear-location">Restore source location</button>':''}<button id="pin-event" aria-pressed="${isPinned(e)}">${isPinned(e) ? 'Unpin' : 'Pin to week map'}</button><button id="hide-event">Hide story</button><button id="group-event">Group with story…</button></div><details class="story-reports"><summary>${e.report_count||1} report${e.report_count>1?'s':''} · ${e.source_count||1} source origin${e.source_count>1?'s':''}</summary>${e.report_count>1?`<p class="subtle">Linked by ${e.group_basis.map(esc).join(', ')}. Sources may quote each other; grouping does not confirm their claims.</p>`:''}${members(e).map(r=>`<article class="report-evidence"><button data-report-tags="${esc(r.id)}">Edit this report’s tags</button><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ↗</a><p class="subtle">${esc(r.source)} · ${esc(ageLabel(r.ts,r.date_precision))} · ${esc(r.confidence)}</p>${e.report_count>1?`<button data-separate="${esc(r.id)}">Keep this report separate</button>`:r.separate?`<button data-restore-group="${esc(r.id)}">Allow automatic grouping</button>`:''}</article>`).join('')}</details><p id="detail-message" class="subtle" role="status"></p>`;
    $('pin-event').disabled = !isLocated(e) || Date.parse(e.ts)<Date.now()-7*86400000;
    $('follow-developing').onclick=async()=>{try{const t=await api('/api/developing/follow','POST',{storyId:e.id});location.href='/developing?id='+encodeURIComponent(t.id);}catch(error){$('detail-message').textContent=error.message;}};
    $('tag-event').onclick=()=>void CapstoneReports.open(members(e).find(r=>r.id===selectedReport)||members(e).find(r=>r.id===e.representative_id)||members(e)[0],members(e));
    $('event-detail').querySelectorAll('[data-report-tags]').forEach(b=>b.onclick=()=>void CapstoneReports.open(members(e).find(r=>r.id===b.dataset.reportTags),members(e)));
    $('pin-event').onclick = () => {if(isPinned(e))aliases(e).forEach(id=>pinned.delete(id));else aliases(e).forEach(id=>pinned.add(id));persist();render();};
    $('hide-event').onclick = () => {aliases(e).forEach(id=>hidden.add(id));selected=null;selectedReport=null;persist();$('event-detail').innerHTML='<p class="subtle">Story hidden. Use Restore hidden to bring hidden stories back.</p>';render();};
    $('place-event').onclick=()=>openLocation(e);
    $('clear-location')?.addEventListener('click',async()=>{try{for(const report of members(e).filter(r=>r.manual_location))await api('/api/events/'+report.id+'/location','DELETE');await loadSnapshot();}catch(error){$('detail-message').textContent=error.message;}});
    $('group-event').onclick=()=>{groupReport=e.representative_id||e.id;$('group-search').value='';$('group-status').textContent='';renderGroupChoices();$('group-dialog').showModal();};
    $('event-detail').querySelectorAll('[data-separate],[data-restore-group]').forEach(button=>button.onclick=async()=>{try{const id=button.dataset.separate||button.dataset.restoreGroup;await api('/api/stories/separate','POST',{eventId:id,restore:!!button.dataset.restoreGroup});selectedReport=id;await loadSnapshot();selectEvent(id);}catch(error){$('detail-message').textContent=error.message;}});
  }
  function persist() { const ok = save('capstone-pinned', [...pinned]) && save('capstone-hidden', [...hidden]); if (!ok) $('connection').textContent = 'Browser storage unavailable; curation lasts this session.'; channel?.postMessage({type:'curation'}); }
  function selectEvent(id, announce = false) {
    const e=findEvent(id);if(!e||!matches(e))return;
    selected=e.id;selectedReport=e.representative_id||e.id;render();
    if (mapReady && isLocated(e)) map.flyTo({ center:[e.lon,e.lat], zoom:Math.max(map.getZoom(),4.6), essential:false }); else countryLabels?.refresh();
    const card = document.querySelector(`[data-event="${CSS.escape(e.id)}"]`);
    if (card) card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
    if (announce) channel?.postMessage({type:'select-event',id:selectedReport});
  }
  function render() {events=$('ops-show-muted').checked?readingRows:readingRows.flatMap(e=>{const visible=members(e).filter(r=>!CapstoneReading.muted(r));if(!visible.length)return [];if(visible.length===members(e).length)return [e];const rep=visible.find(r=>r.id===e.representative_id);return [{...e,...(rep?{}:{...visible[0],lat:null,lon:null,place:'Location not established for remaining reports'}),id:e.id,reports:visible,report_ids:visible.map(r=>r.id),representative_id:rep?.id||visible[0].id,report_count:visible.length,source_count:new Set(visible.map(r=>r.source_id||r.source)).size,display_tags:visible.flatMap(r=>r.display_tags||[])}];});const spot=hotspots.find(h=>h.id===activeHotspot);if(activeHotspot&&!spot){activeHotspot=null;renderHotspots();}hotspotFilter=spot?new Set(spot.report_ids):null;renderOutages();const current=findEvent(selected)||findEvent(selectedReport);if(current&&matches(current))selected=current.id;else if(selected){selected=null;selectedReport=null;$('event-detail').innerHTML='<p class="subtle">Select a story to inspect its reports and location.</p>';}renderTimeline();renderMap();renderDetail();}
  function renderDeveloping(rows){const active=rows.filter(t=>t.state!=='resolved'),featured=active.filter(t=>t.followed).slice(0,4);for(const family of ['cyber','outage','geo','ai']){const t=active.find(t=>t.family===family&&!featured.includes(t));if(t&&featured.length<4)featured.push(t);}for(const t of active)if(featured.length<4&&!featured.includes(t))featured.push(t);$('ops-dev-count').textContent=active.length;$('ops-developing').innerHTML=active.length?featured.map(t=>`<a class="ops-dev-card" href="/developing?id=${esc(t.id)}"><span class="dev-kicker">${t.followed?'FOLLOWING':'AUTO WATCH'} · ${esc(t.state.toUpperCase())}</span><strong>${esc(t.title)}</strong><span>${esc(t.source_condition)}</span><small>${t.report_count} reports · ${esc(t.evidence.join(' / '))}</small></a>`).join(''):'<p class="subtle">No developing threads yet. Select an event and follow its story to start an evidence trail.</p>';}
  const savedBalance=Number(desk?.balance??read('capstone-ops-balance',60));$('ops-balance').value=Number.isFinite(savedBalance)?Math.max(40,Math.min(70,savedBalance)):60;
  function balance(){const value=Number($('ops-balance').value);document.querySelector('.ops-grid').style.setProperty('--ops-map-share',value+'%');$('ops-balance-value').textContent=value+' / '+(100-value);if(!CapstoneDesks.active())save('capstone-ops-balance',value);if(mapReady)map.resize();}
  $('ops-balance').oninput=balance;balance();$('ops-diagnostics').onclick=()=>{const show=$('ops-situation').hidden;$('ops-situation').hidden=!show;$('ops-diagnostics').setAttribute('aria-expanded',String(show));$('ops-diagnostics').textContent=show?'Hide network diagnostics':'Show network diagnostics';};
  function applySnapshot(data) {
    readingRows=data.stories||data.events||[];
    if (!Array.isArray(data.stories||data.events) || !Array.isArray(data.feeds)) return;
    renderDeveloping(data.developing||[]);events = data.stories||data.events;hotspots=Array.isArray(data.hotspots)?data.hotspots:[];statusTiles=Array.isArray(data.status)?data.status:[];renderStatus();renderFeedGaps(Array.isArray(data.feedHealth)?data.feedHealth:[]);renderOffline(data.offline);renderHotspots();renderPulse(data.pulse);
    const options=[['all','All sources'],['telegram','Telegram'],['x','X'],['bluesky','Bluesky'],['mastodon','Mastodon'],['core','Core feeds'],...data.feeds.filter(f=>f.platform).map(f=>[f.id,f.name])];
    if(!options.some(([value])=>value===sourceFilter))sourceFilter='all';
    $('platform-filter').innerHTML=options.map(([value,name])=>`<option value="${esc(value)}"${value===sourceFilter?' selected':''}>${esc(name)}</option>`).join('');
    render(); known = new Map(events.map(e => [e.id,e.revision])); initialized = true;
    const activeFeeds=data.feeds.filter(f=>f.enabled!==false&&f.state!=='needs-key'),healthy = activeFeeds.filter(f => f.state === 'ok').length;
    $('feed-summary').textContent = `${healthy}/${activeFeeds.length} active feeds healthy${data.refreshing ? ' · refreshing' : ''}`;
    $('feed-health').innerHTML = data.feeds.map(f => `<div class="health-item"><span class="status-dot${f.state === 'ok' ? '' : ' offline'}"></span><b>${esc(f.name)}</b><small>${f.state === 'ok' ? `${f.count} ${f.platform?'posts on last poll':'reports in last 30 days'}` : f.state === 'paused'?'Paused':f.state === 'collecting'?'Collecting…':f.state === 'waiting' ? 'Awaiting first collection' : esc(f.error)}${!f.platform&&f.usedUrl && f.usedUrl !== f.url ? ' · official mirror' : ''}</small><small>${f.lastSuccess ? `Last success: ${esc(new Date(f.lastSuccess).toLocaleTimeString('en-GB',{timeZone:'UTC'}))}Z` : 'No successful collection yet'}${f.state === 'error' && f.lastSuccess ? ' · stored data retained' : ''}</small></div>`).join('');
    $('refresh').disabled = data.refreshing;
  }
  function connection(ok) { $('connection').textContent = ok ? 'Connected · updates push live' : 'Reconnecting · showing stored events'; document.querySelector('.connection .status-dot').classList.toggle('offline',!ok); }
  async function initFeed() {
    try { await loadSnapshot(); }
    catch { $('connection').textContent = 'Collector unavailable. Start the Capstone app or server.'; }
    subscribe(applySnapshot);onConnection(connection);
  }
  async function loadSnapshot(){applySnapshot(await api('/api/events'));}
  async function initMap() {
    try {
      const responses=await Promise.all([fetch('/assets/world.json'),fetch('/assets/world-paths.json'),fetch('/assets/countries.json')]);if(responses.some(r=>!r.ok))throw new Error('Map data unavailable');[world,worldPaths,countries]=await Promise.all(responses.map(r=>r.json()));
      $('location-country').innerHTML='<option value="">Choose a country (optional)</option>'+Object.entries(countries).sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([code,c])=>`<option value="${esc(code)}">${esc(c.name)}</option>`).join('');
      // MapLibre 5 removed maplibregl.supported(); probe WebGL directly.
      const probe=document.createElement('canvas');
      if (!window.maplibregl || !(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL unavailable');
      const styles = getComputedStyle(document.body), color = name => styles.getPropertyValue(name).trim();
      map = new maplibregl.Map({ container:'map', center:desk?.camera?.center||[15,22],zoom:desk?.camera?.zoom??1.25,bearing:desk?.camera?.bearing||0,pitch:desk?.camera?.pitch||0,minZoom:0.6,maxZoom:8,renderWorldCopies:false,attributionControl:false,
        style:{version:8,sources:{world:{type:'geojson',data:world}},layers:[{id:'water',type:'background',paint:{'background-color':color('--water')}},{id:'land',type:'fill',source:'world',paint:{'fill-color':color('--land')}},{id:'borders',type:'line',source:'world',paint:{'line-color':color('--borders'),'line-width':0.6}}]} });
      map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'bottom-right');
      map.addControl(new maplibregl.AttributionControl({customAttribution:'Natural Earth · MapLibre',compact:true}));
      map.on('load', () => {
        map.addSource('night',{type:'geojson',data:nightGeo()});map.addLayer({id:'night',type:'fill',source:'night',paint:{'fill-color':color('--night-shade'),'fill-opacity':Number(color('--night-alpha'))||0.5}});
        map.addSource('hotspots',{type:'geojson',data:hotspotGeo()});
        map.addLayer({id:'hotspot-rings',type:'circle',source:'hotspots',paint:{'circle-radius':['+',16,['*',7,['get','families']]],'circle-color':color('--hot'),'circle-opacity':['case',['==',['get','active'],1],0.28,0.12],'circle-stroke-color':color('--hot'),'circle-stroke-width':['case',['==',['get','active'],1],2.5,1.2],'circle-pitch-alignment':'map'}});
        map.on('click','hotspot-rings',ev=>{if(placementMode)return;const id=ev.features?.[0]?.properties?.id;if(id)toggleHotspot(id);});
        map.on('mouseenter','hotspot-rings',()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave','hotspot-rings',()=>{map.getCanvas().style.cursor='';});
        mapReady=true;applyProjection();renderMap();
        // Country names (map-labels.js): the selected event's country, else the active hot spot's, is drawn largest.
        countryLabels=CapstoneMapLabels.attach(map,Object.values(countries),()=>{const e=selected&&findEvent(selected);if(e&&isLocated(e))return {lon:e.lon,lat:e.lat,name:e.place||''};const h=activeHotspot&&hotspots.find(h=>h.id===activeHotspot);return h&&Number.isFinite(h.lat)?{lon:h.lon,lat:h.lat,name:h.name}:null;},{focusOffset:30});
      });
      // Theme switches repaint the map's own layers; markers and the SVG fallback follow the CSS tokens directly.
      Capstone.onTheme(()=>{if(!mapReady)return;const c=name=>getComputedStyle(document.body).getPropertyValue(name).trim();
        map.setPaintProperty('water','background-color',c('--water'));map.setPaintProperty('land','fill-color',c('--land'));map.setPaintProperty('borders','line-color',c('--borders'));
        map.setPaintProperty('night','fill-color',c('--night-shade'));map.setPaintProperty('night','fill-opacity',Number(c('--night-alpha'))||0.5);
        map.setPaintProperty('hotspot-rings','circle-color',c('--hot'));map.setPaintProperty('hotspot-rings','circle-stroke-color',c('--hot'));});
      map.on('click',event=>{if(placementMode)acceptPoint(event.lngLat.lng,event.lngLat.lat);});
      map.on('moveend',()=>{if(mapReady&&!replay.on)CapstoneDesks.update();});
      map.on('error', e => { console.warn('Map renderer',e.error); if (!mapReady) enableFallback(); });
      setTimeout(() => { if (!mapReady) enableFallback(); },8000);
    } catch(error) { console.warn(error); enableFallback(); }
  }
  let fallbackView=desk?.fallback?.slice()||[0,0,720,360],drag=null,suppressMapClick=false;
  function applyView(){const svg=$('map-fallback').querySelector('svg');if(svg)svg.setAttribute('viewBox',fallbackView.join(' '));}
  function zoomFallback(factor,anchor){const [x,y,w,h]=fallbackView,nw=Math.max(90,Math.min(720,w/factor)),nh=nw/2,c=anchor||[x+w/2,y+h/2];fallbackView=[Math.max(0,Math.min(720-nw,c[0]-(c[0]-x)*nw/w)),Math.max(0,Math.min(360-nh,c[1]-(c[1]-y)*nh/h)),nw,nh];applyView();}
  $('map-zoom-in').onclick=()=>{if(fallback)zoomFallback(1.5);else if(mapReady)map.zoomIn();};
  $('map-zoom-out').onclick=()=>{if(fallback)zoomFallback(1/1.5);else if(mapReady)map.zoomOut();};
  $('map-fallback').addEventListener('wheel',e=>{const svg=$('map-fallback').querySelector('svg');if(!svg)return;e.preventDefault();const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());zoomFallback(e.deltaY<0?1.2:1/1.2,[p.x,p.y]);},{passive:false});
  $('map-fallback').addEventListener('pointerdown',e=>{if(placementMode||e.button!==0)return;const svg=$('map-fallback').querySelector('svg');if(!svg)return;const m=svg.getScreenCTM();drag={x:e.clientX,y:e.clientY,view:[...fallbackView],scale:m.a};suppressMapClick=false;});
  $('map-fallback').addEventListener('pointermove',e=>{if(!drag)return;const dx=(e.clientX-drag.x)/drag.scale,dy=(e.clientY-drag.y)/drag.scale;if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4){suppressMapClick=true;$('map-fallback').setPointerCapture(e.pointerId);}fallbackView=[Math.max(0,Math.min(720-drag.view[2],drag.view[0]-dx)),Math.max(0,Math.min(360-drag.view[3],drag.view[1]-dy)),drag.view[2],drag.view[3]];applyView();});
  for(const event of ['pointerup','pointercancel'])$('map-fallback').addEventListener(event,()=>{drag=null;});
  $('map-fallback').addEventListener('click',e=>{if(suppressMapClick){e.stopImmediatePropagation();suppressMapClick=false;}},true);
  function enableFallback() { if (fallback) return; fallback=true; mapReady=false; markerCache.clear(); map?.remove(); $('map').hidden=true; $('map-fallback').hidden=false; $('reset-map').disabled=false; $('reset-map').textContent='Reset map'; $('projection-toggle').disabled=true; $('projection-toggle').title='Globe view needs WebGL'; renderFallback(); }
  function renderFallback() {
    if (!world) { $('map-fallback').innerHTML = '<div class="empty-state">World geometry could not load. Event details and timeline remain available.</div>'; return; }
    const point = c => [((c[0]+180)*2).toFixed(2),((90-c[1])*2).toFixed(2)];
    const paths = worldPaths.map(d=>`<path class="fallback-land" d="${esc(d)}"/>`).join('');
    const points = [...mapEvents]; const e = events.find(e=>e.id===selected); if(e && isLocated(e) && !points.includes(e)) points.push(e);
    const groups=new Map();for(const row of points){const key=`${row.lon.toFixed(2)},${row.lat.toFixed(2)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    const dots=[...groups.values()].map(group=>group.map((e,i)=>{const anchor=point([e.lon,e.lat]).map(Number),radius=group.length>1?Math.min(16,7+group.length):0,angle=i*2*Math.PI/group.length;const p=[anchor[0]+radius*Math.cos(angle),anchor[1]+radius*Math.sin(angle)];return `${radius?`<path class="fallback-link" d="M${anchor}L${p}"/>`:''}<circle class="fallback-point ${esc(e.category)}${selected===e.id?' selected':''}" cx="${p[0]}" cy="${p[1]}" r="4" role="button" tabindex="0" data-map-event="${esc(e.id)}" aria-label="${esc(e.title)}"><title>${esc(e.title)}</title></circle>`;}).join('')).join('');
    const night=`<path class="fallback-night" d="M${nightGeo(replay.on?new Date(replayTime()):new Date()).geometry.coordinates[0].map(c=>point([c[0],Math.max(-90,Math.min(90,c[1]))])).join('L')}Z"/>`;
    const rings=hotspots.filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lon)).map(h=>{const [x,y]=point([h.lon,h.lat]);return `<circle class="fallback-hotspot" cx="${x}" cy="${y}" r="${6+3*h.families.length}" data-hotspot="${esc(h.id)}" stroke-width="${h.id===activeHotspot?2:.8}"><title>Hot spot: ${esc(h.name)}</title></circle>`;}).join('');
    $('map-fallback').innerHTML = `<svg class="fallback-svg" viewBox="${fallbackView.join(' ')}" aria-label="World map, simplified renderer">${paths}${night}${rings}${dots}</svg><span class="fallback-message">Simplified map · WebGL unavailable · Natural Earth</span>`;
  }
  $('map-fallback').addEventListener('click',e=>{if(placementMode){const svg=$('map-fallback').querySelector('svg');if(!svg)return;const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());const lon=p.x/2-180,lat=90-p.y/2;if(Math.abs(lon)<=180&&Math.abs(lat)<=90)acceptPoint(lon,lat);return;}const spot=e.target.closest('[data-hotspot]')?.dataset.hotspot;if(spot)return toggleHotspot(spot);const id=e.target.closest('[data-map-event]')?.dataset.mapEvent; if(id) selectEvent(id,true);});
  $('map-fallback').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const id=e.target.closest('[data-map-event]')?.dataset.mapEvent;if(id){e.preventDefault();selectEvent(id,true);}}});
  // The source link opens the original report; anywhere else on a card selects the story.
  $('timeline').addEventListener('click',e=>{if(e.target.closest('a'))return;const id=e.target.closest('[data-event]')?.dataset.event; if(id)selectEvent(id,true);});
  document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category; document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
  $('event-search').oninput = e => {query=e.target.value.trim().toLowerCase();render();};
  $('time-window').onchange=renderTimeline;
  $('platform-filter').onchange=e=>{sourceFilter=e.target.value;render();};
  $('watch-only').onchange=render;
  $('reset-map').onclick=()=>{if(fallback){fallbackView=[0,0,720,360];applyView();}else if(mapReady)map.flyTo({center:[15,22],zoom:1.25});};
  $('restore-hidden').onclick=()=>{hidden.clear();persist();render();};
  $('refresh').onclick=async()=>{ $('refresh').disabled=true; try { const r=await fetch('/api/refresh',{method:'POST'}); const result=await r.json(); if(!r.ok)$('connection').textContent=result.error; }catch{$('connection').textContent='Could not reach collectors.';}finally{$('refresh').disabled=false;} };
  channel?.addEventListener('message',e=>{if(e.data?.type==='select-event')selectEvent(e.data.id);if(e.data?.type==='curation'){pinned=new Set(storedArray('capstone-pinned'));hidden=new Set(storedArray('capstone-hidden'));render();}});
  function openLocation(e){placementReport=e.representative_id||e.id;$('location-story').textContent=e.title;$('location-place').value=isLocated(e)?e.place:'';$('location-lat').value=isLocated(e)?e.lat:'';$('location-lon').value=isLocated(e)?e.lon:'';$('location-note').value=e.manual_location?.note||'';$('location-country').value='';$('location-status').textContent='';$('location-pin').disabled=Date.parse(e.ts)<Date.now()-7*86400000;$('location-pin').checked=!$('location-pin').disabled;$('pick-on-map').disabled=!world;$('location-dialog').showModal();}
  function acceptPoint(lon,lat){placementMode=false;$('map-pick-hint').hidden=true;$('location-lat').value=lat.toFixed(5);$('location-lon').value=(((lon+180)%360+360)%360-180).toFixed(5);$('location-dialog').showModal();}
  $('location-country').onchange=()=>{const country=countries[$('location-country').value];if(!country)return;$('location-place').value=country.name;$('location-lat').value=country.lat;$('location-lon').value=country.lon;$('location-note').value='Country reference point manually selected; approximate location.';};
  $('close-location').onclick=()=>$('location-dialog').close();
  $('pick-on-map').onclick=()=>{placementMode=true;$('location-dialog').close();$('map-pick-hint').hidden=false;document.querySelector('.map-stage').scrollIntoView({block:'center'});};
  $('cancel-map-pick').onclick=()=>{placementMode=false;$('map-pick-hint').hidden=true;$('location-dialog').showModal();};
  $('location-form').onsubmit=async event=>{event.preventDefault();$('save-location').disabled=true;try{await api('/api/events/'+placementReport+'/location','PUT',{place:$('location-place').value,lat:Number($('location-lat').value),lon:Number($('location-lon').value),note:$('location-note').value});await loadSnapshot();const story=findEvent(placementReport);if(story&&$('location-pin').checked){aliases(story).forEach(id=>pinned.add(id));persist();}selectEvent(placementReport,true);$('location-dialog').close();}catch(error){$('location-status').textContent=error.message;}finally{$('save-location').disabled=false;}};
  function renderGroupChoices(){const q=$('group-search').value.trim().toLowerCase(),current=findEvent(groupReport);$('group-target').innerHTML='<option value="">Choose a related story</option>'+events.filter(e=>e!==current&&(`${e.title} ${e.cves?.join(' ')}`).toLowerCase().includes(q)).slice(0,200).map(e=>`<option value="${esc(e.representative_id||e.id)}">${esc(e.title)}</option>`).join('');}
  $('group-search').oninput=renderGroupChoices;$('close-group').onclick=()=>$('group-dialog').close();
  $('group-form').onsubmit=async event=>{event.preventDefault();try{await api('/api/stories/group','POST',{eventId:groupReport,targetId:$('group-target').value});selectedReport=groupReport;await loadSnapshot();selectEvent(groupReport);$('group-dialog').close();}catch(error){$('group-status').textContent=error.message;}};
  const params=new URLSearchParams(location.search);sourceFilter=params.get('source')||sourceFilter;selectedReport=params.get('event');$('watch-only').checked=params.has('watch')?params.get('watch')==='1':desk?.watchOnly||false;const range=params.get('period')||desk?.period;if(['today','24','168','720'].includes(range))$('time-window').value=range;
  $('event-search').value=desk?.query||'';document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
  if(desk?.diagnostics)$('ops-diagnostics').click();$('feed-health-panel').open=desk?.health||false;
  $('hotspots').addEventListener('click',e=>{const id=e.target.closest('[data-hotspot]')?.dataset.hotspot;if(id)toggleHotspot(id);});
  $('status-tiles').addEventListener('click',e=>{const id=e.target.closest('[data-status]')?.dataset.status;if(!id)return;openStatus=openStatus===id?null:id;renderStatus();});
  $('clear-hotspot').onclick=()=>{if(activeHotspot)toggleHotspot(activeHotspot);};
  $('outage-list').addEventListener('click',e=>{const id=e.target.closest('[data-event]')?.dataset.event;if(id)selectEvent(id,true);});
  $('projection-toggle').onclick=()=>{projection=projection==='globe'?'mercator':'globe';if(!CapstoneDesks.active())save('capstone-projection',projection);applyProjection();};
  $('replay-toggle').onclick=()=>replay.on?stopReplay():startReplay();
  $('replay-play').onclick=()=>replay.timer?pauseReplay():playReplay();
  $('replay-slider').oninput=e=>{pauseReplay();replay.minute=Number(e.target.value);renderReplay();};
  onPulse(renderPulse);applyProjection();
  const readingControls=document.createElement('div');readingControls.className='ops-reading-controls';readingControls.innerHTML='<label><input type="checkbox" id="ops-show-muted"> Include muted reports</label><a href="/timeline">Source roles & noise controls ↗</a><small>View-only mutes. Status and alerts still use all sources.</small>';document.querySelector('.ops-workspace-tools').append(readingControls);$('ops-show-muted').onchange=render;
  CapstoneDesks.register('ops',()=>({category,source:sourceFilter,query:$('event-search').value,period:$('time-window').value,watchOnly:$('watch-only').checked,balance:Number($('ops-balance').value),projection,diagnostics:!$('ops-situation').hidden,health:$('feed-health-panel').open,camera:mapReady?{center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}:desk?.camera||null,fallback:fallbackView.slice()}));
  let deskTimer;const saveDesk=()=>{clearTimeout(deskTimer);deskTimer=setTimeout(()=>CapstoneDesks.update(),200);};
  for(const id of ['event-search','ops-balance'])$(id).addEventListener('input',saveDesk);
  for(const id of ['time-window','platform-filter','watch-only'])$(id).addEventListener('change',saveDesk);
  for(const selector of ['[data-category]','#ops-diagnostics','#projection-toggle','#map-zoom-in','#map-zoom-out','#reset-map'])document.querySelectorAll(selector).forEach(b=>b.addEventListener('click',saveDesk));
  $('feed-health-panel').addEventListener('toggle',saveDesk);$('map-fallback').addEventListener('pointerup',saveDesk);
  window.addEventListener('pagehide',()=>{clearTimeout(deskTimer);CapstoneDesks.update();});
  setInterval(()=>{if(mapReady)map.getSource('night')?.setData(nightGeo());else if(fallback)renderFallback();},300000);
  setInterval(render,60000); void initMap(); void initFeed();
})();

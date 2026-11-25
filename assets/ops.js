(() => {
  const { esc, read, save, channel, api, subscribe, onConnection, onPulse } = Capstone;
  const desk=CapstoneDesks.initial('ops');
  let readingRows=[], maplibregl;
  const labels = { cyber: 'CYBER', geo: 'WORLD', ai: 'AI & ROBOTICS' };
  const bases = { manual:'Manually assigned by you',event_location: 'Reported event coordinates', seismic_origin: 'Reported earthquake origin', cyclone_center:'NHC reported storm center', gauge_location:'Reporting gauge location', airport_reference:'FAA airport reference point', road_closure_start:'Caltrans closure start point', road_segment:'Point on the published road segment', country_centroid: 'Country reference point · approximate', regional_reference: 'Alert area reference point · approximate', mapping_area: 'Source mapping area center · approximate', weather_area:'NWS alert area', international_weather_area:'Source weather alert area', fire_origin:'Reported wildfire origin', catalog_point:'Source catalog location', state_reference:'Approximate state reference point', nws_zone_reference:'Approximate NWS forecast-zone reference point', nws_marine_reference:'Approximate NWS marine-zone reference point', victim: 'Victim location', vendor_hq: 'Vendor HQ city · not attack location', company_hq: 'Company HQ city · not event location', unlocated: 'No reliable location · not mapped' };
  const storedArray = key => { const v = read(key, []); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; };
  const savedPlacesKey = 'capstone-saved-places';
  const loadSavedPlaces = () => new Set(storedArray(savedPlacesKey).filter(place=>/^(?:country|state|province):[A-Z]{2}$/.test(place)));
  let savedPlaces = loadSavedPlaces();
  let pinned = new Set(storedArray('capstone-pinned')), hidden = new Set(storedArray('capstone-hidden'));
  let events = [], category = desk?.category||'all', sourceFilter=desk?.source||'all', query = desk?.query?.trim().toLowerCase()||'', selected = null,selectedReport=null, map, mapReady = false, fallback = false, world, worldPaths,countries={}, markerCache = new Map(), mapEvents = [], known = new Map(), initialized = false,placementReport=null,placementMode=false,groupReport=null,countryLabels=null;
  let hotspots=[],statusTiles=[],openStatus=null,activeHotspot=null,hotspotFilter=null,windowBeforeHotspot=null,stateBeforeHotspot='',countryBeforeHotspot='',provinceBeforeHotspot='',cameraBeforeHotspot=null,activeHotspotMarker,projection=(desk?.projection||read('capstone-projection','mercator'))==='globe'?'globe':'mercator';
  const replay={on:false,start:0,minute:0,timer:null,rows:null,hotspots:null};
  const $ = id => document.getElementById(id);
  const viewParams = new URLSearchParams(location.search);
  const linkFlag = (key,fallbackValue) => viewParams.has(key) ? viewParams.get(key)==='1' : fallbackValue;
  const sharedProjection = viewParams.get('projection');
  if (['mercator','globe'].includes(sharedProjection)) projection = sharedProjection;
  const coordinates = viewParams.get('camera')?.split(',').map(Number) || [];
  const sharedCamera = coordinates.length===5 && coordinates.every(Number.isFinite) ?
    CapstoneDeskModel.ops({camera:{center:coordinates.slice(0,2),zoom:coordinates[2],bearing:coordinates[3],pitch:coordinates[4]}}).camera : null;
  const openingCamera = sharedCamera || desk?.camera;
  const requestedReport = viewParams.get('event');
  const linkedReportId = /^[a-z0-9_-]{1,64}$/i.test(requestedReport || '') ? requestedReport : null;
  const showLinkedMap = viewParams.get('show')==='map';
  let linkedMapOpened = false, mappedLink = null, linkedCenterPending = false;
  const timeWindow = $('time-window');
  const timeBasis = $('time-basis');
  const defaultRecentPeriod = timeWindow.value;
  let recentPeriod = defaultRecentPeriod;
  timeBasis.value = (viewParams.get('basis') || desk?.basis)==='received' ? 'received' : 'source';
  const byReceipt = () => timeWindow.value!=='active' && timeBasis.value==='received';
  const placement = $('map-placement');
  const mapExtent = $('map-extent');
  const mapOrder = $('map-order');
  const mapLimit = $('map-markers');
  const moreMarkers = $('map-more-markers');
  const countryActivity = $('map-country-activity');
  countryActivity.checked = linkFlag('activity',desk ? desk.countryActivity : read('capstone-map-country-activity',false) === true);
  const nightShading = $('map-night-shading');
  nightShading.checked = linkFlag('night',desk ? desk.nightShading : read('capstone-map-night-shading',true) !== false);
  const imageryControl = $('map-imagery');
  const imagery = viewParams.get('imagery') ?? desk?.imagery ?? read('capstone-map-imagery','');
  if (['radar','satellite'].includes(imagery)) imageryControl.value = imagery;
  let updateImagery;
  const outlookControl = $('map-outlook');
  const requestedOutlook = viewParams.get('outlook') ?? desk?.outlook ?? read('capstone-outlook','');
  if (['1','2'].includes(requestedOutlook)) outlookControl.value = requestedOutlook;
  const outlook = CapstoneMapOutlook.attach(outlookControl,$('map-outlook-caption'),()=>renderMap());
  let currentOutlook = null, renderedOutlook;
  const weatherAreas = $('map-weather-areas');
  weatherAreas.checked = linkFlag('weatherAreas',desk ? desk.weatherAreas : read('capstone-map-weather-areas',false) === true);
  for (const [control,key,initial] of [[mapExtent,'extent',desk?.mapExtent],[mapOrder,'order',desk?.mapOrder],[mapLimit,'markers',desk?.mapLimit]]) {
    const value = viewParams.get(key) || initial || read('capstone-map-'+key,'');
    if ([...control.options].some(option=>option.value===value)) control.value = value;
  }
  const statePicker = $('ops-state');
  const countryPicker = $('ops-country');
  const provincePicker = $('ops-province');
  let provinceAtlas,provinceMarkup='',stateAtlas,stateMarkup='',countryMarkup='',countryChoices=[],geographyUnavailable=false;
  let renderedProvinceActivity,renderedProvinceFocus,renderedProvinceCountry,refreshProvinceLabels;
  let countryCounts = new Map();
  const renderedCountryCounts = new Map();
  let renderedActivityVisibility;
  const validState = value => /^[A-Z]{2}$/.test(value || '') ? value : '';
  const linkHasRegion = ['state','country','province'].some(key=>viewParams.has(key));
  let stateScope = validState(linkHasRegion ? viewParams.get('state') : desk?.state);
  let countryScope = !stateScope ? validState(linkHasRegion ? viewParams.get('country') : desk?.country) : '';
  let provinceScope = !stateScope && (!countryScope || countryScope==='CA') ?
    validState(linkHasRegion ? viewParams.get('province') : desk?.province) : '';
  if (provinceScope) countryScope='CA';
  let countryCamera;
  const inState = (report,code) => !code || (code === 'US' ? report.state_codes?.length > 0 : report.state_codes?.includes(code));
  const inWindow = period => period === 'active' ? 0 : period === 'today' ? Date.parse(new Date().toISOString().slice(0,10)) :
    Date.now() - Number(period)*3600000;
  const placeMode = viewParams.get('placement') || desk?.mapPlacement || read('capstone-map-placement', 'all');
  if ([...placement.options].some(option => option.value === placeMode)) placement.value = placeMode;
  const storySelect = $('map-story-select');
  const storyQuery = $('map-story-query');
  let storyOptions = '', locatableStories = [];
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLocated = e => Number.isFinite(e.lat) && Math.abs(e.lat)<=90 && Number.isFinite(e.lon) && Math.abs(e.lon)<=180;
  const isHeadquarters = e => ['vendor_hq', 'company_hq'].includes(e.place_basis);
  function eligiblePlacement(event) {
    if (!isLocated(event)) return false;
    if (placement.value === 'no-hq') return !isHeadquarters(event);
    if (placement.value === 'reported') return ['event_location','seismic_origin','fire_origin','catalog_point','cyclone_center','road_closure_start','road_segment'].includes(event.place_basis);
    return true;
  }
  const aliases=e=>[e.id,...(e.report_ids||[])],isPinned=e=>aliases(e).some(id=>pinned.has(id));
  const findEvent=id=>id ? events.find(e=>aliases(e).includes(id)) : undefined;
  const members=e=>e.reports||[e];
  const searchIndex = new WeakMap();
  const platforms = ['telegram','x','bluesky','mastodon'];
  let collectorNames = new Map();
  function sourceMatches(report) {
    const categoryMatches = category === 'all' || report.category === category;
    const feedMatches = sourceFilter === 'all' || (sourceFilter === 'core' && !report.platform) ||
      report.platform === sourceFilter || report.source_id === sourceFilter || report.feed_id === sourceFilter;
    return categoryMatches && feedMatches;
  }
  const inProvince = (report,code) => !code || report.province_code===code;
  const currentOnly = () => $('time-window').value==='active' && !replay.on;
  function reportMatches(report, state, country, province) {
    return sourceMatches(report) && typeOk(report) && (!currentOnly() || (liveConnected && T.currentListing(report))) &&
      (storyEvidence.value==='all' || T.matchesEvidence(report,storyEvidence.value)) &&
      (!$('watch-only').checked || report.watch_matches?.length) && inState(report,state) && inProvince(report,province) && (!country || report.country_code===country);
  }
  function matches(story, state = stateScope, country = countryScope, province = provinceScope) {
    const ids = aliases(story);
    if (ids.some(id=>hidden.has(id)) || (hotspotFilter && !ids.some(id=>hotspotFilter.has(id)))) return false;
    const reports = members(story);
    if (!reports.some(report=>reportMatches(report,state,country,province))) return false;
    if (!query) return true;
    let text = searchIndex.get(story);
    if (text === undefined) {
      text = [story.title,story.summary,story.place,story.source,
        ...reports.flatMap(report=>[report.title,report.source,report.summary,
          ...(Array.isArray(report.affected_regions) ? report.affected_regions.map(region=>region.name) : [])]),
        ...(story.display_tags || []).map(tag=>tag.label)].join(' ').toLowerCase();
      searchIndex.set(story,text);
    }
    return text.includes(query);
  }
  const epssPct=v=>v>=0.1?Math.round(v*100)+'%':(v*100).toFixed(v>=0.01?1:2)+'%';
  const liveMarkerEligible = (report,now) => (!['airport_disruption','road_closure'].includes(report.kind) && !report.weather_status) || T.currentListing(report,now);
  function warningState(report, now = Date.now()) {
    if (report.kind==='road_closure') {
      if (Date.parse(report.road_valid_until)<=now) return {css:'ended',label:'Published closure window ended'};
      if (report.road_status==='ended') return {css:'ended',label:'Caltrans marked the closure ended'};
      const roadSource = report.feed_id==='drivebc-closures' ? 'DriveBC' : report.feed_id?.startsWith('wzdx-') ? 'state work-zone' : 'Caltrans';
      return liveMarkerEligible(report,now) ? {css:'listed',label:'Listed in latest '+roadSource+' poll'} :
        {css:'unknown',label:'Current road listing unconfirmed'};
    }
    if (report.kind==='airport_disruption') {
      if (Date.parse(report.airport_valid_until)<=now) return {css:'ended',label:'Scheduled window ended'};
      return liveMarkerEligible(report,now) ? {css:'listed',label:'Listed in latest FAA poll'} :
        {css:'unknown',label:'Current FAA listing unconfirmed'};
    }
    if (report.weather_replaced_at) return {css:'ended',label:report.weather_status ? 'Superseded by a later flood notice' : 'Superseded by a later NWS bulletin'};
    if (report.weather_status==='ended') return {css:'ended',label:'Warning no longer in force'};
    if (report.weather_status==='active') return T.currentListing(report,now) ? {css:'listed',label:'Listed in latest poll'} :
      {css:'unknown',label:'Current flood listing unconfirmed'};
    const end = Date.parse(report.weather_valid_until);
    if (!Number.isFinite(end)) return null;
    if (end<=now) return {css:'ended',label:'Published window ended'};
    if (!replay.on && Date.parse(report.weather_listed_until)>now) return {css:'listed',label:'Listed in latest poll'};
    return {css:'unknown',label:'Current listing unconfirmed'};
  }
  function ageLabel(ts, precision) { return precision === 'day' ? `${ts.slice(0,10)} · day only` : new Date(ts).toLocaleString('en-GB', { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC' }) + 'Z'; }
  // What each report is (event-types.js): type label, evidence, severity and chatter drive cards, markers and the type filter.
const T=CapstoneTypes,TYPE_GROUPS={threat:['kev','cve','advisory','malware'],claim:['ransomware','claim','incident'],internet:['outage','routing'],conflict:['conflict'],news:['news','ainews','cybernews'],posts:['post'],quake:['quake'],withdrawal:['withdrawal'],hazard:['hazard'],weather:['weather'],storm:['storm'],river:['river'],cyclone:['cyclone'],declaration:['declaration'],humanitarian:['humanitarian'],mapping:['mapping'],earthwatch:['earthwatch'],wildfire:['wildfire'],volcano:['volcano'],volcano_weekly:['volcano_weekly'],space:['space'],tsunami:['tsunami'],airport:['airport'],road:['road']};
const defaultType = (()=>{try{return localStorage.getItem('capstone-ops-type') || 'all';}catch{return 'all';}})();
const requestedType = viewParams.get('type');
const matchingType = Object.entries(TYPE_GROUPS).find(([,types])=>types.length===1 && types[0]===requestedType)?.[0];
const initialType = ['all','signal'].includes(requestedType) || Object.hasOwn(TYPE_GROUPS,requestedType) ? requestedType : matchingType;
let typeFilter=initialType || desk?.type || defaultType,usStateLayer=null;
const storyEvidence = $('story-evidence');
for (const value of T.EVIDENCE_FILTERS) storyEvidence.add(new Option(T.evidenceFilterLabel(value),value));
const initialEvidence = viewParams.get('evidence') || desk?.evidence;
if (T.EVIDENCE_FILTERS.includes(initialEvidence)) storyEvidence.value = initialEvidence;
const primaryFilter = $('ops-primary');
const typeOk=r=>(!T.isNewsCodingAggregate(r) || typeFilter==='conflict' || sourceFilter==='gdelt') &&
    (typeFilter==='all'||(typeFilter==='signal'?!T.chatter(r):(TYPE_GROUPS[typeFilter]||[]).includes(T.typeId(r))));
const typeBadge=e=>{const d=T.describe(e);return `<span class="etype" style="--tone:var(--${d.tone});--tone-text:var(--${d.tone}-text,var(--${d.tone}))"><b aria-hidden="true">${d.glyph}</b> ${esc(d.label)}${d.id==='post'?` · ${esc(e.source)}`:''}</span><span class="evidence ev-${esc(d.evidence.toLowerCase().replace(/[^a-z]+/g,'-'))}">${esc(d.evidence)}</span>`;};
function tagChips(e,limit=6){const tags=(e.display_tags||[]).filter(t=>!T.restates(t));return tags.length?`<span class="timeline-tags">${tags.slice(0,limit).map(t=>`<span class="timeline-tag" data-tag-type="${esc(t.type)}" title="${esc(t.type)} · ${t.origin==='manual'?'your label':'source context'}">${esc(t.type)}: ${esc(t.label)}</span>`).join('')}${tags.length>limit?`<span class="timeline-tag">+${tags.length-limit} more</span>`:''}</span>`:'';}
  let timelineLimit = 60;
  const focusedPlaceKey = () => provinceScope ? 'province:'+provinceScope : stateScope ? 'state:'+stateScope : countryScope ? 'country:'+countryScope : '';
  let timelineFilterKey='',timelineMarkup='',timelineMoreKey='',coverageMarkup='';
  let regionalView = null, areaBrief = null, feedbackPlace = '';
  const regionFeedStates = CapstoneRegionCoverage.states;
  function renderRegionCoverage(rows, cutoff, received) {
    regionalView = {rows,cutoff,received};
    const panel = $('region-coverage');
    const state = stateAtlas?.states.find(entry=>entry.code===stateScope);
    const spot = (replay.hotspots || hotspots).find(entry=>entry.id===activeHotspot);
    const province = provinceAtlas?.provinces.find(entry=>entry.code===provinceScope);
    const name = province?.name || state?.name || (stateScope==='US' ? 'U.S. states and territories' : '') || countries[countryScope]?.name ||
      (spot ? spot.name+' hot spot' : '');
    panel.hidden = !name;
    $('ops-map-coverage').hidden = !name;
    if (!name) { areaBrief = null; return ''; }
    $('region-coverage-title').textContent = 'Sources in ' + name;
    const origins = new Map(), matchingReports = new Map();
    for (const story of rows) for (const report of members(story)) {
      if (!reportMatches(report,stateScope,countryScope,provinceScope)) continue;
      const date = received ? report.first_received : report.ts;
      if (!(Date.parse(date)>=cutoff) || matchingReports.has(report.id)) continue;
      matchingReports.set(report.id,report);
      const id = report.feed_id || report.source_id || '';
      const key = id || report.source;
      const current = origins.get(key);
      if (current) {
        current.count++;
        if (date > current.date) Object.assign(current,{date,report});
      } else {
        origins.set(key,{id,name:report.source,count:1,date,report});
      }
    }
    const byId = new Map((feedStatusData?.feeds || []).map(feed=>[feed.id,feed]));
    const region = countryScope || spot?.country;
    const {regular:providerIds,districts:districtIds} = CapstoneRegionCoverage.providers({
      state:stateScope,country:region,province:provinceScope
    },byId.keys());
    const regionalFeeds = [...providerIds,...districtIds].map(id=>byId.get(id)).filter(Boolean);
    const current = regionalFeeds.filter(feed=>feed.pollCoverage==='current').length;
    const summary = !feedStatusData ? 'Loading feed checks' : !regionalFeeds.length ? 'No dedicated checks' :
      feedStatusData.collecting===false ? 'Collection paused' : !liveConnected ? 'Last known checks' :
      `${current}/${regionalFeeds.length} polls current`;
    const hasGap = Boolean(regionalFeeds.length && (!liveConnected || current < regionalFeeds.length));
    $('region-coverage-summary').textContent = summary;
    $('region-coverage-summary').classList.toggle('region-coverage-gap',hasGap);
    $('ops-map-coverage-state').textContent = summary;
    $('ops-map-coverage').classList.toggle('region-coverage-gap',hasGap);
    const lastSuccess = regionalFeeds.reduce((latest,feed)=>feed.lastSuccess && feed.lastSuccess>latest ? feed.lastSuccess : latest,'');
    $('ops-map-last-poll').textContent = lastSuccess ? 'Latest success '+Capstone.sourceTime({ts:lastSuccess}) : regionalFeeds.length ? 'No successful poll yet' : '';
    const reportCount = count => `${count} matching report${count===1?'':'s'}`;
    const timelineLink = (id, label) => {
      const url = new URL($('ops-full-timeline').href);
      if (id) { url.searchParams.set('feed',id);url.searchParams.set('collector',label); }
      else url.searchParams.set('source',label);
      return esc(url.pathname+url.search);
    };
    const briefFeeds = [];
    const statuses = regionalFeeds.map(feed=>{
      const [style,status] = regionFeedStates[feed.pollCoverage] || regionFeedStates.waiting;
      const stamp = feed.lastSuccess ? 'Last success '+ageLabel(feed.lastSuccess,'timestamp') : 'No successful poll yet';
      const match = origins.get(feed.id);
      const recent = match ? received ? ageLabel(match.date,'timestamp') : Capstone.sourceTime(match.report) : '';
      const detail = match ? ` · Latest ${received?'first receipt':'source date'} in view ${recent}` : '';
      const count = reportCount(match?.count || 0);
      briefFeeds.push({name:feed.name,label:status,lastSuccess:feed.lastSuccess,matches:match?.count || 0});
      return `<li data-region-feed="${esc(feed.id)}"><div class="region-feed-line"><strong>${esc(feed.name)}</strong>
        <span class="feed-indicator ${esc(style)}">${esc(status)}</span></div>
        <small>${esc(stamp)}</small><div class="region-feed-line">
        <span>${match ? `<a href="${timelineLink(feed.id,feed.name)}">${esc(count)} ↗</a>` : esc(count)}${esc(detail)}</span>
        <a href="/feeds?collector=${encodeURIComponent(feed.id)}" aria-label="Poll history for ${esc(feed.name)}">Poll history ↗</a></div></li>`;
    });
    const regularChecks = statuses.slice(0,statuses.length-districtIds.length);
    const districtChecks = statuses.slice(statuses.length-districtIds.length);
    const districtsOpen = $('region-coverage-body').querySelector('.region-district-checks')?.open;
    const contributors = [...origins.values()].filter(origin=>!regionalFeeds.some(feed=>feed.id===origin.id))
      .sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name)).slice(0,5).map(origin=>
        `<li><a href="${timelineLink(origin.id,origin.name)}">${esc(origin.name)} ↗</a> <small>${esc(reportCount(origin.count))}</small></li>`);
    const watch = new URL('/watch',location.origin);
    if (stateScope) watch.searchParams.set('state',stateScope);
    if (provinceScope) watch.searchParams.set('province',provinceScope);
    if (countryScope || spot?.country) watch.searchParams.set('country',countryScope || spot.country);
    if (category!=='all') watch.searchParams.set('category',category);
    if (collectorNames.has(sourceFilter)) watch.searchParams.set('feed',sourceFilter);
    else if (sourceFilter!=='all') watch.searchParams.set('platform',sourceFilter);
    if (storyEvidence.value!=='all') watch.searchParams.set('evidence',storyEvidence.value);
    if (TYPE_GROUPS[typeFilter]?.length===1) watch.searchParams.set('reportType',TYPE_GROUPS[typeFilter][0]);
    watch.hash='rule-title';
    const shortcut = '<a href="'+esc(watch.pathname+watch.search+watch.hash)+'">Set up a watchlist for this area ↗</a>';
    const scopeNote = !feedStatusData ? 'Waiting for the first collector snapshot.' : statuses.length ?
      (feedStatusData.collecting && !liveConnected ? 'Live updates are disconnected. The poll results below are from the last snapshot. ' : '')+
        'Poll status applies to the whole feed. Report counts apply to this place and the current time and filters.' :
      'No dedicated feed checks are listed for this area. Broader feeds can still contribute reports.';
    const placeKey = focusedPlaceKey();
    if (feedbackPlace!==placeKey) {
      feedbackPlace = placeKey;
      $('region-place-feedback').textContent = '';
    }
    const saved = savedPlaces.has(placeKey);
    const placeAction = placeKey ? '<button id="region-save-place" type="button" aria-pressed="'+saved+'">'+(saved?'Remove saved place':'Save place')+'</button>' : '';
    areaBrief = {location:name,stories:rows.length,reports:[...matchingReports.values()],feeds:briefFeeds,basis:received?'received':'source',
      period:$('time-window').selectedOptions[0].textContent,snapshot:feedStatusData?.now,connected:liveConnected,collecting:feedStatusData?.collecting};
    const markup = '<p class="region-coverage-note">'+esc(scopeNote)+'</p>' +
      (regularChecks.length ? '<ul class="region-feed-list">'+regularChecks.join('')+'</ul>' : '') +
      (districtChecks.length ? '<details class="region-district-checks"'+(districtsOpen?' open':'')+'><summary>Caltrans district checks · '+districtChecks.length+'</summary><ul class="region-feed-list">'+districtChecks.join('')+'</ul></details>' : '') +
      (contributors.length ? '<h3>Other sources in this view</h3><ul>'+contributors.join('')+'</ul>' : '') +
      (!origins.size ? '<p>No attributed reports match this view.</p>' : '') +
      '<div class="region-coverage-actions"><button id="open-region-brief" type="button">Area briefing</button>'+placeAction+shortcut+
      (stateScope && stateScope!=='US' ? '<a href="/timeline?country=US">Browse broader U.S. reporting ↗</a>' : '')+
      (region==='NZ' ? '<a href="https://www.metservice.com/warnings/home" target="_blank" rel="noopener noreferrer">Current MetService warnings ↗</a>' : '')+'</div>';
    if (coverageMarkup !== markup && !$('region-coverage-body').contains(document.activeElement)) {
      coverageMarkup = markup;
      $('region-coverage-body').innerHTML = markup;
    }
    return name;
  }
  function openRegionalChecks() {
    const coverage = $('region-coverage');
    coverage.open = true;
    const summary = coverage.querySelector('summary');
    summary?.focus();
    summary?.scrollIntoView({block:'nearest'});
  }
  $('ops-map-sources').onclick = openRegionalChecks;

  function timelineCard(e,received) {
    const type = T.describe(e);
    const warning = replay.on ? null : warningState(e);
    const reference = T.sourceReference(e);
    const timestamp = received ? e.latest_received : e.ts;
    const timeLabel = received ? 'Received' : e.report_count>1 ? 'Latest source date' : 'Source date';
    const stale = e.outage_state==='stale';
    const title = stale ? e.title.replace(/ \(ongoing\)$/,'')+' · current state unknown' : e.title;
    const opening = selected===e.id;
    const evidenceCount = e.report_count>1 ? '<span class="story-evidence">'+e.report_count+' reports · '+e.source_count+
      ' source origin'+(e.source_count===1?'':'s')+'</span>' : '';
    const sourceLink = reference ? '<span>'+esc(e.source)+'</span>' :
      '<a class="timeline-source" href="'+esc(e.url)+'" target="_blank" rel="noopener noreferrer" title="Open the original report">'+esc(e.source)+' ↗</a>';
    return `
      <article class="timeline-card sev-${type.severity}${type.chatter?' chatter':''}${opening?' selected':''}" data-event="${esc(e.id)}" data-type="${type.id}">
        <button type="button" class="timeline-open" data-event="${esc(e.id)}" aria-pressed="${opening}">
          <span class="timeline-top">${typeBadge(e)}<span class="desk-label">${labels[e.category]}</span>
            ${isPinned(e)?' · PINNED':''}${e.watch_matches?.length?' · WATCH':''}
            ${e.epss?'<span class="epss'+(e.epss.epss>=0.1?' high':'')+'" title="FIRST EPSS estimates the chance of exploitation within 30 days">EPSS '+epssPct(e.epss.epss)+'</span>':''}
          </span>
          <span class="timeline-title">${esc(title)}</span>
          <time class="timeline-source-date" datetime="${esc(timestamp)}">${timeLabel} ${esc(ageLabel(timestamp,received?'timestamp':e.date_precision))}</time>
          ${evidenceCount}
          ${warning?'<span class="warning-listing '+warning.css+'">'+warning.label+'</span>':''}
          ${tagChips(e)}
        </button>
        <span class="timeline-bottom">
          <span class="timeline-report-actions">${sourceLink}<button type="button" class="report-text-button timeline-evidence-button" data-timeline-report="${esc(e.id)}" aria-label="Open report details from ${esc(e.source)}">Details</button></span>
          <span class="timeline-place" title="${esc(T.placement(e))}">${isLocated(e)?esc(e.place):'Location unknown'}${T.referencePlacement(e)?'<small>'+esc(T.placement(e))+'</small>':''}</span>
        </span>
      </article>`;
  }

  function emptyTimeline(range,regionName) {
    const actions = [
      ['active','today','1','6'].includes(range) ? '<button id="show-day" type="button">Last 24 hours</button>' : '',
      ['today','1','6','24'].includes(range) ? '<button id="show-week" type="button">Last 7 days</button>' : '',
      regionName ? '<button id="show-regional-sources" type="button">Check regional sources</button>' : ''
    ].filter(Boolean);
    const location = regionName ? ' for '+esc(regionName) : '';
    const empty = range==='active' && !replay.on ?
      (feedStatusData?.collecting===false ? 'Collection is paused.' : !liveConnected ? 'Waiting for live collector updates.' :
        'No current weather or transportation listings match this view'+location+'.') : 'No stories match this view'+location+'.';
    return '<div class="empty-state">'+empty+
      (actions.length ? '<div class="empty-period-actions">'+actions.join('')+'</div>' : '<br>Adjust the source, search terms, or report filters.')+'</div>';
  }
  function renderTimeline() {
    const range = $('time-window').value;
    $('current-listings-note').hidden = range!=='active' || replay.on;
    const timelineParams = new URLSearchParams();
    if (category !== 'all') timelineParams.set('category',category);
    if (stateScope) timelineParams.set('state',stateScope);
    if (countryScope) timelineParams.set('country',countryScope);
    if (provinceScope) timelineParams.set('province',provinceScope);
    const searchText = $('event-search').value.trim();
    if (searchText) timelineParams.set('q',searchText.slice(0,250));
    if (range !== '720') timelineParams.set('days',{active:'active',today:'today','1':'1h','6':'6h','24':'1','168':'7'}[range] || 'today');
    const received = byReceipt();
    if (received) timelineParams.set('basis','received');
    if (storyEvidence.value !== 'all') timelineParams.set('evidence',storyEvidence.value);
    if (sourceFilter === 'core' || platforms.includes(sourceFilter)) timelineParams.set('platform',sourceFilter);
    if (collectorNames.has(sourceFilter)) {
      timelineParams.set('feed',sourceFilter);
      timelineParams.set('collector',collectorNames.get(sourceFilter));
    }
    const types = TYPE_GROUPS[typeFilter];
    if (types?.length === 1) timelineParams.set('type',types[0]);
    if ($('ops-show-muted').checked) timelineParams.set('includeMuted','1');
    $('ops-full-timeline').href = '/timeline' + (timelineParams.size ? '?' + timelineParams : '');
    const cutoff = inWindow(range);
    const rows = events.filter(story=>matches(story) && Date.parse(received ? story.latest_received : story.ts)>=cutoff);
    if (received) rows.sort((a,b)=>b.latest_received.localeCompare(a.latest_received) || b.ts.localeCompare(a.ts));
    const regionName = renderRegionCoverage(rows,cutoff,received);
    const panel = $('timeline');
    const filterKey = JSON.stringify([range,timeBasis.value,stateScope,countryScope,provinceScope,category, sourceFilter, typeFilter, storyEvidence.value, query, activeHotspot, $('watch-only').checked, $('ops-show-muted').checked]);
    const reset = filterKey !== timelineFilterKey;
    if (reset) {
      timelineFilterKey = filterKey;
      timelineLimit = 60;
    }
    const top = panel.getBoundingClientRect().top;
    const anchor = !reset && panel.scrollTop > 0 ? [...panel.querySelectorAll('.timeline-card')].find(card=>card.getBoundingClientRect().bottom>top) : null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    const scroll = panel.scrollTop;
    const focusedCard = document.activeElement?.closest('.timeline-card');
    const focusedSelector = ['a.timeline-source','.timeline-evidence-button'].find(selector=>document.activeElement?.matches(selector)) || '.timeline-open';
    const visible = rows.slice(0, timelineLimit);
    const selectedOutsidePage = selected && !visible.some(event=>event.id===selected) && rows.find(event=>event.id===selected);
    if (selectedOutsidePage) visible.unshift(selectedOutsidePage);
    $('timeline-count').textContent = rows.length;
    const markup = rows.length ? visible.map(event=>timelineCard(event,received)).join('') : emptyTimeline(range,regionName);
    const moreKey = (rows.length-visible.length) + ':' + (rows[timelineLimit]?.id || '');
    if (!reset && markup === timelineMarkup && moreKey === timelineMoreKey) return;
    timelineMarkup = markup;
    timelineMoreKey = moreKey;
    panel.innerHTML = markup;
    if (rows.length > visible.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'timeline-more';
      more.textContent = 'Show more stories · ' + (rows.length - visible.length) + ' remaining';
      more.onclick = () => {
        const firstNew = rows[timelineLimit].id;
        timelineLimit += 60;
        renderTimeline();
        panel.querySelector('.timeline-open[data-event="' + CSS.escape(firstNew) + '"]')?.focus();
      };
      panel.append(more);
    }
    for (const [id,period] of [['show-day','24'],['show-week','168']]) {
      $(id)?.addEventListener('click',()=>{
        $('time-window').value = period;
        $('time-window').dispatchEvent(new Event('change',{bubbles:true}));
        $('time-window').focus({preventScroll:true});
      });
    }
    $('show-regional-sources')?.addEventListener('click',openRegionalChecks);
    const restored = anchor && panel.querySelector('.timeline-card[data-event="'+CSS.escape(anchor.dataset.event)+'"]');
    if (reset) panel.scrollTop=0;
    else if (restored) panel.scrollTop += restored.getBoundingClientRect().top - top - anchorOffset;
    else panel.scrollTop = scroll;
    if (focusedCard) panel.querySelector('.timeline-card[data-event="' + CSS.escape(focusedCard.dataset.event) + '"] ' + focusedSelector)?.focus({preventScroll:true});
  }
  function viewport() {
    if (mapExtent.value === 'world') return null;
    const local = mapExtent.value === 'view' || (mapReady && (projection==='globe' || map.getZoom()>=3.1)) ||
      (fallback && fallbackView[2] <= 245);
    if (!local) return null;
    if (fallback) {
      const [x,y,width,height] = fallbackView;
      return e => {
        const px=(e.lon+180)*2,py=(90-e.lat)*2;
        return px>=x && px<=x+width && py>=y && py<=y+height;
      };
    }
    if (!mapReady) return null;
    const bounds = map.getBounds();
    const {clientWidth,clientHeight} = map.getCanvas();
    return ({lon,lat}) => {
      if (!bounds.contains([lon,lat])) return false;
      const point = map.project([lon,lat]);
      if (point.x<0 || point.x>clientWidth || point.y<0 || point.y>clientHeight) return false;
      if (projection!=='globe') return true;
      // Back-of-globe points can project inside the frame. Only the near surface unprojects to itself.
      const near = map.unproject(point);
      const longitudeDelta = ((near.lng-lon+540)%360)-180;
      return Math.abs(near.lat-lat)<0.03 && Math.abs(longitudeDelta*Math.cos(lat*Math.PI/180))<0.03;
    };
  }
  // render() replaces events when the report set or its shared filters change.
  let mapIndex;
  function indexedMapReports() {
    const received = !replay.on && byReceipt();
    if (mapIndex?.events !== events || mapIndex.received!==received) {
      mapIndex = {
        events,received,
        rows:events.filter(story=>matches(story)).map(story=>{
          const time = Date.parse(received ? story.latest_received : story.ts);
          const start = replay.on && story.kind==='road_closure' ? Date.parse(story.road_started_at) : NaN;
          return {story,time,available:Number.isFinite(start) ? start : Math.max(time,Date.parse(story.cyclone_center_at)||time),pinned:isPinned(story)};
        }).filter(row=>Number.isFinite(row.time))
      };
    }
    const key = placement.value + '|' + (replay.on ? 'replay' : mapOrder.value);
    if (mapIndex.order !== key) {
      const priority = mapOrder.value === 'priority';
      const newest = (a,b)=>b.time-a.time;
      const rank = priority ? (a,b)=>b.story.score-a.story.score || newest(a,b) :
        (a,b)=>newest(a,b) || b.story.score-a.story.score;
      mapIndex.order = key;
      const ranked = replay.on ? mapIndex.rows.flatMap(row=>{
        const story = row.story;
        if (story.kind!=='river_gauge' || members(story).length===1) return [row];
        return members(story).filter(report=>report.kind==='river_gauge' && report.url===story.url && reportMatches(report,stateScope,countryScope,provinceScope)).map(report=>{
          const time = Date.parse(report.ts);
          return {time, available:time, story:{...story,...report,id:story.id,representative_id:report.id,
            reports:[report],report_ids:[report.id],report_count:1,source_count:1}};
        });
      }) : mapIndex.rows;
      mapIndex.ranked = ranked.filter(({story,pinned})=>eligiblePlacement(story) && (replay.on || pinned || !story.weather_replaced_at))
        .sort(replay.on ? (a,b)=>b.available-a.available : (a,b)=>Number(b.pinned)-Number(a.pinned) || rank(a,b));
      mapIndex.desks = replay.on || category!=='all' ? [] :
        ['cyber','geo','ai'].map(desk=>mapIndex.ranked.filter(({story})=>story.category===desk));
    }
    return mapIndex;
  }
  function rankedInView(rows, cutoff, inView, limit) {
    const found = [], now = Date.now();
    for (const row of rows) {
      if (row.time>=cutoff && (row.pinned || liveMarkerEligible(row.story,now)) && (!inView || inView(row.story))) {
        found.push(row);
        if (found.length>=limit) break;
      }
    }
    return found;
  }
  const liveMarkerLimit = () => mapLimit.value==='auto' ? (countryScope || stateScope ? 80 : 40) : Number(mapLimit.value);
  function curated(index,cutoff,inView,limit) {
    const spreadAcrossStates = stateScope==='US';
    const spreadAcrossPlaces = mapOrder.value==='spread';
    const spreadLimit = Math.floor(limit*.8);
    const ranked = rankedInView(index.ranked,cutoff,inView,spreadAcrossStates ? Infinity : spreadAcrossPlaces ? limit*5 : limit);
    const chosen = new Map();
    for (const {story,pinned} of ranked) {
      if (!pinned || chosen.size>=limit) break;
      chosen.set(story.id,story);
    }
    if (spreadAcrossStates) {
      const represented = new Set([...chosen.values()].flatMap(e=>e.state_codes || []));
      for (const {story} of ranked) {
        const codes = story.state_codes || [];
        if (chosen.size>=spreadLimit) break;
        if (codes.some(code=>!represented.has(code))) {
          chosen.set(story.id,story);
          for (const code of codes) represented.add(code);
        }
      }
    }
    if (spreadAcrossPlaces) {
      const degrees = stateScope && stateScope!=='US' ? 1 : countryScope || inView ? 3 : 12;
      const cell = story=>Math.floor(story.lon/degrees)+','+Math.floor(story.lat/degrees);
      const shown = new Set([...chosen.values()].map(cell));
      for (const {story} of ranked) {
        if (chosen.size>=spreadLimit) break;
        const key = cell(story);
        if (shown.has(key)) continue;
        shown.add(key);
        chosen.set(story.id,story);
      }
    }
    for (const desk of index.desks) {
      if (chosen.size>=limit) break;
      for (const {story} of rankedInView(desk,cutoff,inView,4)) {
        if (chosen.size<limit) chosen.set(story.id,story);
      }
    }
    for (const {story} of ranked) {
      if (chosen.size>=limit) break;
      chosen.set(story.id,story);
    }
    return [...chosen.values()];
  }
  const replayTime=()=>replay.start+replay.minute*60000;
  const replayFresh=e=>replay.on&&Math.max(Date.parse(e.ts),Date.parse(e.cyclone_center_at)||0)>replayTime()-90*60000;
  function replayEvents(index,inView) {
    const cursor = replayTime();
    const visible = new Map();
    for (const {story,available} of index.ranked) {
      if (available<replay.start || visible.size>=300) break;
      const replaced = Date.parse(story.weather_replaced_at);
      const ended = story.weather_status==='ended' || story.kind==='airport_disruption' && Date.parse(story.airport_valid_until)<=cursor ||
        story.kind==='road_closure' && Date.parse(story.road_ended_at || story.road_valid_until)<=cursor;
      if (available<=cursor && !(replaced<=cursor) && !ended && !visible.has(story.id) && (!inView || inView(story))) visible.set(story.id,story);
    }
    return [...visible.values()];
  }
  function renderLocator() {
    if (document.activeElement === storySelect) return;
    const query = storyQuery.value.trim().toLowerCase();
    const index = indexedMapReports();
    const cutoff = inWindow($('time-window').value);
    const onMap = new Set(mapEvents.map(story=>story.id));
    const matchingTitle = story=>`${story.title} ${story.place}`.toLowerCase().includes(query);
    locatableStories = mapEvents;
    if (query && replay.on) locatableStories = mapEvents.filter(matchingTitle);
    if (query && !replay.on) {
      locatableStories = [];
      for (const {story,time} of index.ranked) {
        if (time<cutoff || !liveMarkerEligible(story,Date.now()) || !matchingTitle(story)) continue;
        locatableStories.push(story);
        if (locatableStories.length>=40) break;
      }
    }
    const value = storySelect.value;
    const options = '<option value="">' + (locatableStories.length ? 'Choose a mapped story' : 'No mapped stories match') + '</option>' +
      locatableStories.map(story => `<option value="${esc(story.id)}">${esc(story.title)} · ${esc(story.place)}${isHeadquarters(story) ? ' (HQ)' : ''}${onMap.has(story.id) ? '' : ' · Marker not shown'}</option>`).join('');
    if (storyOptions !== options) {
      storyOptions = options;
      storySelect.innerHTML = options;
      storySelect.value = locatableStories.some(story=>story.id===value) ? value :
        query && locatableStories.length===1 ? locatableStories[0].id : '';
    }
    storySelect.disabled = !locatableStories.length;
    $('map-locate').disabled = !storySelect.value;
  }
  let geographyActivity;
  function mapGeography(cutoff, end) {
    const received = !replay.on && byReceipt();
    if (geographyActivity?.events===events && geographyActivity.end===end && geographyActivity.received===received &&
        cutoff>=geographyActivity.cutoff && cutoff<=geographyActivity.nextCutoff) return geographyActivity;
    const counts = new Map(), countriesInWindow = new Map(), provinces = new Map(), latest = new Map();
    const recordLatest = (kind,code,date,report) => {
      const key = kind+':'+code;
      if (!latest.has(key) || latest.get(key).date<date) latest.set(key,{date,ts:received ? report.first_received : report.ts,precision:received ? 'timestamp' : report.date_precision});
    };
    let usCount = 0, nextCutoff = Infinity;
    for (const story of events) {
      if (!matches(story,'','','')) continue;
      const codes = new Set(), regions = new Set(), canadian = new Set();
      for (const report of members(story)) {
        const date = Date.parse(received ? report.first_received : report.ts);
        if (!(date>=cutoff && date<=end) || !reportMatches(report,'','','')) continue;
        if (report.country_code) {
          regions.add(report.country_code);
          recordLatest('country',report.country_code,date,report);
        }
        if (report.province_code) {
          canadian.add(report.province_code);
          recordLatest('province',report.province_code,date,report);
        }
        if (report.state_codes?.length) recordLatest('state','US',date,report);
        for (const code of (report.state_codes || [])) {
          codes.add(code);
          recordLatest('state',code,date,report);
        }
        if (report.country_code || report.state_codes?.length) nextCutoff = Math.min(nextCutoff,date);
      }
      for (const code of regions) countriesInWindow.set(code,(countriesInWindow.get(code) || 0)+1);
      for (const code of canadian) provinces.set(code,(provinces.get(code) || 0)+1);
      if (codes.size) usCount++;
      for (const code of codes) counts.set(code,(counts.get(code) || 0)+1);

    }
    geographyActivity = {events,cutoff,end,nextCutoff,received,counts,countriesInWindow,provinces,latest,usCount};
    return geographyActivity;
  }
  const mapPlacePreview = $('map-place-preview');
  const mapStage = $('map').closest('.map-stage');
  let previewFrame = 0;
  let pendingPointer;
  function closePlacePreview() {
    mapPlacePreview.hidden = true;
    pendingPointer = null;
  }
  function previewPlace() {
    previewFrame = 0;
    if (!pendingPointer || placementMode || (mapReady && map.isMoving()) || drag) return closePlacePreview();
    const {clientX,clientY,target} = pendingPointer;
    let code,kind;
    if (fallback) {
      if (target.closest('[data-map-event],[data-hotspot]')) return closePlacePreview();
      const shape = target.closest('[data-state],[data-province],[data-country]');
      if (shape && $('map-fallback').contains(shape)) {
        const {state,province,country} = shape.dataset;
        code = state || province || country;
        kind = state ? 'state' : province ? 'province' : 'country';
      }
    } else if (mapReady && target===map.getCanvas()) {
      const box = target.getBoundingClientRect();
      const layers = ['hotspot-rings','current-weather-fill','us-state-activity','ca-province-fill','land'].filter(id=>map.getLayer(id));
      const features = map.queryRenderedFeatures([clientX-box.left,clientY-box.top],{layers});
      if (features.some(feature=>['hotspot-rings','current-weather-fill'].includes(feature.layer.id))) return closePlacePreview();
      const area = ['us-state-activity','ca-province-fill','land'].map(id=>features.find(feature=>feature.layer.id===id)).find(Boolean);
      code = area?.properties.code;
      kind = area?.layer.id==='us-state-activity' ? 'state' : area?.layer.id==='ca-province-fill' ? 'province' : 'country';
    }
    const name = kind==='state' ? stateAtlas?.states.find(state=>state.code===code)?.name :
      kind==='province' ? provinceAtlas?.provinces.find(province=>province.code===code)?.name : countries[code]?.name;
    if (!name || !geographyActivity) return closePlacePreview();
    const {counts,provinces,countriesInWindow,latest} = geographyActivity;
    const count = (kind==='state' ? counts : kind==='province' ? provinces : countriesInWindow).get(code) || 0;
    const last = latest.get(kind+':'+code);
    const info = count ? count + (count===1 ? ' matching story' : ' matching stories') : 'No matching stories in this period';
    const content = '<strong>'+esc(name)+'</strong><small>'+esc(info)+'</small>'+
      (last ? '<small>'+(geographyActivity.received ? 'Latest receipt' : 'Latest source date')+' · '+esc(ageLabel(last.ts,last.precision))+'</small>' : '');
    if (mapPlacePreview.innerHTML!==content) mapPlacePreview.innerHTML=content;
    mapPlacePreview.hidden = false;
  }
  mapStage.addEventListener('pointermove',event=>{
    if (event.pointerType!=='mouse' || event.buttons) return closePlacePreview();
    pendingPointer = event;
    if (!previewFrame) previewFrame = requestAnimationFrame(previewPlace);
  },{passive:true});
  for (const type of ['pointerdown','pointerleave']) mapStage.addEventListener(type,closePlacePreview);

  function renderStates(cutoff = inWindow($('time-window').value)) {
    if (!stateAtlas) return;
    const {counts,countriesInWindow,usCount} = mapGeography(replay.on ? replay.start : cutoff, replay.on ? replayTime() : Infinity);
    const markup = '<option value="">Anywhere</option><option value="US">All U.S. states and territories · ' + usCount + '</option>' +
      stateAtlas.states.map(state=>`<option value="${state.code}">${esc(state.name)} · ${counts.get(state.code) || 0}</option>`).join('');
    if (stateMarkup !== markup && document.activeElement !== statePicker) {
      stateMarkup = markup;
      statePicker.innerHTML = markup;
      statePicker.value = stateScope;
    }
    usStateLayer?.setActivity(counts,stateScope);
    countryCounts = countriesInWindow;
    const countryOptions = '<option value="">Anywhere</option>' + countryChoices.map(([code,country])=>{
        const count = countryCounts.get(code);
        return `<option value="${esc(code)}">${esc(country.name)}${count ? ' · ' + count : ''}</option>`;
      }).join('');
    if (countryMarkup!==countryOptions && document.activeElement!==countryPicker) {
      countryMarkup=countryOptions;
      countryPicker.innerHTML=countryOptions;
      countryPicker.value=countryScope;
    }
  }
  function renderProvinces(cutoff) {
    $('ops-province-label').hidden = countryScope!=='CA' || !provinceAtlas;
    if (!provinceAtlas) return;
    const {provinces} = mapGeography(replay.on?replay.start:cutoff,replay.on?replayTime():Infinity);
    const markup = '<option value="">All of Canada</option>' + provinceAtlas.provinces.map(({code,name})=>
      `<option value="${code}">${esc(name)} · ${provinces.get(code) || 0}</option>`
    ).join('');
    if (provinceMarkup!==markup && document.activeElement!==provincePicker) {
      provinceMarkup = markup;
      provincePicker.innerHTML = markup;
      provincePicker.value = provinceScope;
    }
    if (!mapReady || !map.getSource('ca-provinces')) return;
    if (renderedProvinceCountry!==countryScope) {
      renderedProvinceCountry = countryScope;
      map.setLayerZoomRange('ca-province-fill',countryScope==='CA' ? 0 : 2.35,24);
      map.setLayerZoomRange('ca-province-borders',countryScope==='CA' ? 0 : 2.2,24);
    }
    if (renderedProvinceActivity===provinces && renderedProvinceFocus===provinceScope) return;
    renderedProvinceActivity=provinces;
    renderedProvinceFocus=provinceScope;
    refreshProvinceLabels?.();
    for (const {code} of provinceAtlas.provinces) {
      map.setFeatureState({source:'ca-provinces',id:code},{count:provinces.get(code)||0,selected:provinceScope===code});
    }
  }
  function renderCountryActivity() {
    $('map-activity-key').hidden = !countryActivity.checked;
    if (!mapReady || !map.getLayer('country-activity')) return;
    if (renderedActivityVisibility !== countryActivity.checked) {
      renderedActivityVisibility = countryActivity.checked;
      map.setLayoutProperty('country-activity','visibility',renderedActivityVisibility?'visible':'none');
    }
    if (!countryActivity.checked) return;
    const countriesOnMap = new Set([...renderedCountryCounts.keys(),...countryCounts.keys()]);
    for (const code of countriesOnMap) {
      const count = countryCounts.get(code) || 0;
      if (renderedCountryCounts.get(code)===count) continue;
      map.setFeatureState({source:'world',id:code},{count});
      if (count) renderedCountryCounts.set(code,count);
      else renderedCountryCounts.delete(code);
    }
  }
  function locationBounds(geometry,longitude) {
    if (!geometry) return null;
    const points = ['Polygon','MultiLineString'].includes(geometry.type) ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
    const bounds = [Infinity,Infinity,-Infinity,-Infinity];
    for (const [raw,lat] of points) {
      const lon = longitude + ((raw-longitude+540)%360)-180;
      bounds[0] = Math.min(bounds[0],lon);
      bounds[1] = Math.min(bounds[1],lat);
      bounds[2] = Math.max(bounds[2],lon);
      bounds[3] = Math.max(bounds[3],lat);
    }
    return bounds.every(Number.isFinite) ? [[bounds[0],bounds[1]],[bounds[2],bounds[3]]] : null;
  }
  function fitFallbackBounds([[west,south],[east,north]]) {
    if (west < -180 || east > 180) {
      fallbackView = [0,0,720,360];
      applyView();
      return;
    }
    const width = Math.min(720,Math.max(fallbackMinWidth,(east-west)*2.8,(north-south)*5.6));
    zoomFallbackAt([(west+east)/2,(south+north)/2],Math.log2(720/width)+1);
  }
  function fitPublishedGeometry(geometry,lon) {
    const bounds = locationBounds(geometry,lon);
    if (!bounds) return;
    if (mapReady) map.fitBounds(bounds,{padding:40,maxZoom:7.6,duration:reducedMotion()?0:450});
    else if (fallback) fitFallbackBounds(bounds);
    saveDesk();
  }
  function chooseState(code, move = true) {
    if (activeHotspot) clearHotspot(false);
    countryScope = provinceScope = '';
    countryCamera = null;
    countryPicker.value = provincePicker.value = '';
    stateScope = code;
    statePicker.value = code;
    if (move && code) {
      const state = stateAtlas?.states.find(state=>state.code===code);
      const center = state ? [state.lon,state.lat] : [-98.5,39.1];
      const zoom = state ? ['AK','HI'].includes(code) ? 3.4 : 4.5 : 2.65;
      const duration = reducedMotion()?0:450;
      const shape = state && stateAtlas?.areas?.features.find(area=>area.properties.code===state.code);
      const bounds = shape ? locationBounds(shape.geometry,state.lon) : null;
      if (fallback && bounds && bounds[0][0]>=-180 && bounds[1][0]<=180) fitFallbackBounds(bounds);
      else if (fallback) zoomFallbackAt(center,zoom);
      else if (mapReady && bounds) map.fitBounds(bounds,{padding:34,maxZoom:6.25,bearing:0,pitch:0,duration});
      else if (mapReady) map.easeTo({center,zoom,bearing:0,pitch:0,duration});
    }
    render();
    countryLabels?.refresh();
    saveDesk();
  }
  function chooseProvince(code) {
    if (activeHotspot) clearHotspot(false);
    if (!code) { chooseCountry('CA'); return; }
    const province = provinceAtlas?.provinces.find(entry=>entry.code===code);
    if (!province) return;
    if (countryScope!=='CA') chooseCountry('CA',false);
    provinceScope = code;
    provincePicker.value = code;
    const shape = provinceAtlas.areas.features.find(feature=>feature.id===code);
    const bounds = locationBounds(shape?.geometry,province.lon);
    if (bounds) {
      if (mapReady) map.fitBounds(bounds,{padding:40,maxZoom:6.2,bearing:0,pitch:0,duration:reducedMotion()?0:430});
      if (fallback) fitFallbackBounds(bounds);
    }
    render();
    countryLabels?.refresh();
    saveDesk();
  }
  function chooseCountry(code, move = true) {
    if (activeHotspot) clearHotspot(false);
    const country = countries[code];
    if (code && !country) return;
    if (!countryScope && country) {
      countryCamera = mapReady ? {center:map.getCenter(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),state:stateScope} :
        fallback ? {view:fallbackView.slice(),state:stateScope} : null;
    }
    countryScope = code;
    provinceScope = '';
    provincePicker.value = '';
    countryPicker.value = code;
    stateScope = '';
    statePicker.value = '';
    const duration = reducedMotion()?0:400;
    if (country && move) {
      const center = [country.lon,country.lat];
      const shape = world?.features.find(feature=>feature.properties.code===code);
      const bounds = locationBounds(shape?.geometry,country.lon);
      if (mapReady && bounds) map.fitBounds(bounds,{padding:36,maxZoom:6.25,bearing:0,pitch:0,duration});
      else if (mapReady) map.easeTo({center,zoom:4.5,bearing:0,pitch:0,duration});
      if (fallback && bounds && bounds[0][0]>=-180 && bounds[1][0]<=180) fitFallbackBounds(bounds);
      else if (fallback) zoomFallbackAt(center,bounds && bounds[1][0]-bounds[0][0] > 35 ? 2.4 : 3.7);
    } else if (!country && countryCamera) {
      const {state,view,...camera} = countryCamera;
      stateScope = state || '';
      statePicker.value = stateScope;
      if (mapReady && camera.center) map.easeTo({...camera,duration});
      if (fallback && view) { fallbackView=view; applyView(); }
      countryCamera = null;
    }
    render();
    countryLabels?.refresh();
    saveDesk();
  }
  let renderedAlert,renderedTrack,renderedCountry,renderedWeather='';
  let currentWeather = [];
  function selectedMapReport() {
    return replay.on ? mapEvents.find(event=>event.id===selected) : mappedLink || findEvent(selected);
  }
  function selectedArea() { return selectedMapReport()?.weather_area; }
  const publishedLine = report => report?.road_geometry || report?.observation_track;
  const lineButtonLabel = report => report.road_geometry ? 'Fit published road segment' : 'Fit observation track';
  const featureCollection = geometry => ({type:'FeatureCollection',features:geometry ? [{type:'Feature',properties:{},geometry}] : []});
  function selectedAlert() {
    const area = selectedArea();
    return featureCollection(area);
  }
  function updateWeather(index) {
    let areas = [];
    if (weatherAreas.checked && !replay.on) {
      index.weather ??= index.rows.flatMap(({story})=>story.weather_area ? [{story,until:Date.parse(story.weather_listed_until)}] : [])
        .sort((a,b)=>b.story.score-a.story.score || b.story.ts.localeCompare(a.story.ts));
      const now = Date.now();
      areas = index.weather.filter(({until})=>until>now).map(({story})=>story);
    }
    currentWeather = areas.slice(0,80);
    const count = $('map-weather-count');
    count.hidden = !weatherAreas.checked || replay.on;
    const status = areas.length > currentWeather.length ? currentWeather.length + ' of ' + areas.length + ' areas shown' :
      currentWeather.length ? currentWeather.length + (currentWeather.length===1 ? ' area' : ' areas') + ' in latest polls' :
      'No source areas from recent polls';
    if (count.textContent !== status) count.textContent = status;
  }
  function weatherGeometry() {
    return {type:'FeatureCollection',features:currentWeather.map(report=>({type:'Feature',properties:{id:report.id},geometry:report.weather_area}))};
  }
  function renderMap() {
    const period = $('time-window');
    const cutoff = inWindow(period.value);
    const index = indexedMapReports();
    renderStates(cutoff);
    renderProvinces(cutoff);
    renderCountryActivity();
    if ($('map-place-dialog').open && document.activeElement===$('map-place-query')) renderPlaceSearch();
    $('map-night-key').hidden = !nightShading.checked;
    updateWeather(index);
    currentOutlook = outlook.view(replay.on);
    const inView = viewport();
    const limit = liveMarkerLimit();
    mapEvents = replay.on ? replayEvents(index,inView) : curated(index,cutoff,inView,limit);
    if (!replay.on && mappedLink) mapEvents = mapEvents.filter(story=>!aliases(story).includes(mappedLink.id));
    const current = selectedMapReport();
    if (!replay.on && current && (mappedLink || eligiblePlacement(current)) && (!inView || inView(current)) && !mapEvents.includes(current)) {
      mapEvents = [...mapEvents.slice(0,limit-1),current];
    }
    const trace = publishedLine(current);
    $('map-track-key').hidden = !trace;
    if (trace) $('map-track-key').textContent = current.road_geometry ? 'Published road segment' : 'Track connects dated source positions';
    renderLocator();
    const count = $('map-count');
    count.textContent = mapEvents.length;
    count.setAttribute('aria-label',mapEvents.length + (mapEvents.length===1 ? ' marker shown' : ' markers shown'));
    $('map-export').disabled = !mapEvents.length && !currentWeather.length && !currentOutlook;
    $('map-linked-clear').hidden = !mappedLink || replay.on;
    const countryButton = $('map-country-clear');
    const country = countries[countryScope];
    countryButton.hidden = !country;
    const province = provinceAtlas?.provinces.find(entry=>entry.code===provinceScope);
    if (country) countryButton.textContent = 'Clear ' + (province?.name || country.name) + ' focus ×';
    const place = province?.name || (stateScope ? (stateScope === 'US' ? 'U.S. states and territories' : stateAtlas?.states.find(state=>state.code===stateScope)?.name || stateScope) : country?.name || 'World');
    const clearState = $('map-state-clear');
    clearState.hidden = !stateScope;
    if (stateScope) clearState.textContent = 'Clear ' + (stateScope==='US' ? 'U.S.' : place) + ' focus ×';
    $('ops-map-title').textContent = place==='World' ? 'World map' : place+' map';
    const shown = new Set(mapEvents.map(story=>story.id));
    const now = Date.now();
    const hasMoreMarkers = !replay.on && shown.size>=limit && index.ranked.some(({story,time,pinned})=>
      !shown.has(story.id) && time>=cutoff && (pinned || liveMarkerEligible(story,now)) && (!inView || inView(story)));
    const nextLimit = [...mapLimit.options].map(option=>Number(option.value)).find(value=>value>limit);
    const focusMore = document.activeElement===moreMarkers;
    moreMarkers.hidden = !hasMoreMarkers || !nextLimit;
    if (!moreMarkers.hidden) moreMarkers.textContent = 'Raise marker limit to '+nextLimit;
    if (focusMore && moreMarkers.hidden) count.focus({preventScroll:true});
    $('map-caption').textContent = replay.on ? `Replay by source date · ${mapEvents.length} mapped · ${place}` :
      `${place} · ${period.selectedOptions[0].textContent}${byReceipt() ? ' · First received' : ''} · ${inView ? 'In view' : 'All locations'} · ${mapEvents.length} shown${hasMoreMarkers ? ' · Marker limit reached' : ''}`;
    index.unlocated ??= index.rows.filter(({story})=>!isLocated(story)).map(({time})=>time);
    const unlocated = index.unlocated.filter(time=>replay.on ? time>=replay.start && time<=replayTime() : time>=cutoff).length;
    const notes = [];
    if (unlocated) notes.push(`${unlocated} ${unlocated === 1 ? 'story has' : 'stories have'} no mapped point in this period.`);
    if (hasMoreMarkers && !nextLimit) notes.push('Search mapped stories to locate reports beyond the marker limit.');
    $('map-note').textContent = notes.join(' ') || 'Select a marker to inspect its source and location.';
    if (fallback) return renderFallback();
    if (!mapReady) return;
    updateImagery?.(imageryControl.value,replay.on,stateScope);
    if (currentOutlook !== renderedOutlook) {
      renderedOutlook = currentOutlook;
      map.getSource('spc-outlook')?.setData(currentOutlook?.areas || featureCollection());
    }
    const weatherKey = currentWeather.map(report=>report.id+':'+(report.weather_geometry_revision || report.revision)).join('|');
    if (weatherKey !== renderedWeather) {
      renderedWeather = weatherKey;
      map.getSource('current-weather')?.setData(weatherGeometry());
    }
    if (map.getLayer('focused-country') && renderedCountry !== countryScope) {
      renderedCountry = countryScope;
      map.setFilter('focused-country',['==',['get','code'],countryScope]);
    }
    if (renderedTrack !== trace) {
      renderedTrack = trace;
      map.getSource('observation-track')?.setData(featureCollection(trace));
    }
    const alert = selectedArea();
    if (renderedAlert !== alert) {
      renderedAlert = alert;
      map.getSource('selected-alert')?.setData(selectedAlert());
    }
    const list = mapEvents;
    // Shared HQ/country points fan out in screen pixels; their geographic point stays unchanged.
    // Markers are reused by story ID so replay can redraw several times a second.
    const groups = new Map(),keep=new Set();
    for (const e of list) { const key = `${e.lon.toFixed(2)},${e.lat.toFixed(2)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); }
    for (const group of groups.values()) group.forEach((e, i) => {
      const radius = group.length > 1 ? Math.min(40, 14+group.length*2) : 0, angle = i*2*Math.PI/group.length, offset=[radius*Math.cos(angle),radius*Math.sin(angle)];
      const linked = mappedLink?.id===e.id;
      const states={cyber:e.category==='cyber',geo:e.category==='geo',ai:e.category==='ai','reference-point':T.referencePlacement(e),
        'linked-marker':linked,selected:linked||selected===e.id,new:!linked&&((initialized && known.get(e.id)!==e.revision)||replayFresh(e))};
      let entry=markerCache.get(e.id);
      // On the globe, markers on the far side are hidden outright (MapLibre's default leaves them at 20%, which
      // read as live events on light themes); a hidden marker also ignores clicks.
      if(!entry){const el=document.createElement('button');el.className='marker';el.addEventListener('click',ev=>{ev.stopPropagation();if(el.style.opacity==='0')return;openMapEvent(el.dataset.id);});entry={el,marker:new maplibregl.Marker({element:el,offset,opacityWhenCovered:'0'}).setLngLat([e.lon,e.lat]).addTo(map),offset,lon:e.lon,lat:e.lat};markerCache.set(e.id,entry);}
      else {
        if (entry.offset[0]!==offset[0] || entry.offset[1]!==offset[1]) {
          entry.offset = offset;
          entry.marker.setOffset(offset);
        }
        if (entry.lon!==e.lon || entry.lat!==e.lat) {
          entry.lon = e.lon;
          entry.lat = e.lat;
          entry.marker.setLngLat([e.lon,e.lat]);
        }
      }
      // Toggle only our classes: MapLibre adds its own positioning classes to the same element.
      for(const [name,on] of Object.entries(states))entry.el.classList.toggle(name,on);
      // Shape and color say what the report is; size says how much it scores; chatter posts stay small and faint.
      {const d=T.describe(e);if(entry.el.dataset.shape!==d.shape){entry.el.classList.remove('shape-'+entry.el.dataset.shape);entry.el.classList.add('shape-'+d.shape);entry.el.dataset.shape=d.shape;}
       for(const s of ['critical','high','normal'])entry.el.classList.toggle('sev-'+s,d.severity===s);entry.el.classList.toggle('chatter',d.chatter);entry.el.style.setProperty('--tone',`var(--${d.tone})`);entry.el.dataset.typeLabel=d.label;}
      entry.el.dataset.id=e.id;entry.el.setAttribute('aria-label',(linked?'Linked report · ':'')+e.title+' · '+T.placement(e));entry.el.title=`${entry.el.dataset.typeLabel} · ${T.evidence(e)}\n${e.title}\n${bases[e.place_basis]}`;keep.add(e.id);
    });
    for(const [id,entry] of markerCache)if(!keep.has(id)){entry.marker.remove();markerCache.delete(id);}
    const visibleHotspots = replay.on ? null : hotspots;
    if (renderedHotspots !== visibleHotspots || renderedHotspotSelection !== activeHotspot) {
      renderedHotspots = visibleHotspots;
      renderedHotspotSelection = activeHotspot;
      map.getSource('hotspots')?.setData(hotspotGeo());
    }
    renderHotspotButton();
    if(replay.on||replay.nightStale){map.getSource('night')?.setData(nightGeo(replay.on?new Date(replayTime()):new Date()));replay.nightStale=replay.on;}
  }
  let renderedHotspots, renderedHotspotSelection;
  const nightGeo=Capstone.nightGeo;
  const hotspotGeo=()=>({type:'FeatureCollection',features:(replay.on?[]:hotspots).filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lon)).map(h=>({type:'Feature',properties:{id:h.id,families:h.families.length,active:h.id===activeHotspot?1:0},geometry:{type:'Point',coordinates:[h.lon,h.lat]}}))});
  function renderHotspotButton() {
    const spot = (replay.hotspots || hotspots).find(h=>h.id===activeHotspot);
    const clear = $('map-hotspot-clear');
    clear.hidden = !spot;
    if (spot) clear.textContent = 'Clear ' + spot.name + ' hot spot ×';
    if (replay.on || !mapReady || !spot || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) {
      activeHotspotMarker?.remove();
      activeHotspotMarker = null;
      return;
    }
    if (!activeHotspotMarker) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'marker-hotspot-active';
      control.textContent = '×';
      control.onclick = event=>{event.stopPropagation();clearHotspot();};
      activeHotspotMarker = new maplibregl.Marker({element:control,opacityWhenCovered:'0'})
        .setLngLat([spot.lon,spot.lat]).addTo(map);
    }
    activeHotspotMarker.setLngLat([spot.lon,spot.lat]);
    activeHotspotMarker.getElement().title = 'Clear ' + spot.name + ' hot spot';
    activeHotspotMarker.getElement().setAttribute('aria-label','Clear ' + spot.name + ' hot spot');
  }
  function renderHotspots(){
    renderHotspotButton();
    const spots = replay.hotspots || hotspots;
    $('hotspot-count').textContent=spots.length;$('clear-hotspot').hidden=!activeHotspot;
    $('hotspots').innerHTML=spots.length?spots.map(h=>`<button class="hotspot-card" data-hotspot="${esc(h.id)}" aria-pressed="${activeHotspot===h.id}"><span class="hotspot-name">${esc(h.name)}${h.spike?`<span class="spike-badge">${esc(h.spike.ratio)}× VOLUME</span>`:`<small>${h.report_count} report${h.report_count===1?'':'s'}</small>`}</span><span class="family-chips">${h.families.map(f=>`<span>${esc(f.label)} · ${f.count}</span>`).join('')}</span><span class="hotspot-top">${esc(h.top[0]?.title||'')}</span><span class="hotspot-basis">${esc(h.basis.join(' · '))}</span></button>`).join(''):'<div class="empty-state">No hot spots met the current rules. See Collector health for available coverage.</div>';
  }
  function clearHotspot(restoreCamera = true) {
    if (!activeHotspot) return;
    const restoreFocus = document.activeElement === $('map-hotspot-clear') ||
      document.activeElement === activeHotspotMarker?.getElement();
    activeHotspot = null;
    hotspotFilter = null;
    stateScope = stateBeforeHotspot;
    countryScope = countryBeforeHotspot;
    provinceScope = provinceBeforeHotspot;
    provincePicker.value = provinceScope;
    stateBeforeHotspot = countryBeforeHotspot = provinceBeforeHotspot = '';
    countryPicker.value = countryScope;
    statePicker.value = stateScope;
    selected = selectedReport = null;
    $('event-detail').innerHTML = '<p class="subtle">Select a story to inspect its reports and location.</p>';
    if (windowBeforeHotspot) $('time-window').value = windowBeforeHotspot;
    windowBeforeHotspot = null;
    const camera = cameraBeforeHotspot;
    cameraBeforeHotspot = null;
    if (restoreCamera && camera) {
      if (mapReady && camera.center) map.easeTo({...camera,duration:reducedMotion()?0:400});
      if (fallback && camera.view) { fallbackView = camera.view; applyView(); }
    }
    renderHotspots();
    render();
    if (restoreFocus) $('map-us').focus({preventScroll:true});
  }
  function toggleHotspot(id) {
    if (activeHotspot === id) { clearHotspot(); return; }
    const spot = (replay.hotspots || hotspots).find(spot=>spot.id===id);
    if (!spot) return;
    if (!activeHotspot) {
      windowBeforeHotspot = $('time-window').value;
      stateBeforeHotspot = stateScope;
      countryBeforeHotspot = countryScope;
      provinceBeforeHotspot = provinceScope;
      cameraBeforeHotspot = mapReady ? {center:map.getCenter(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()} :
        fallback ? {view:fallbackView.slice()} : null;
    }
    activeHotspot = id;
    countryScope = provinceScope = '';
    countryPicker.value = provincePicker.value = '';
    stateScope = '';
    statePicker.value = '';
    if (['active','today','1','6','24'].includes($('time-window').value)) $('time-window').value = '168';
    if (Number.isFinite(spot.lat) && Number.isFinite(spot.lon)) {
      if (mapReady) map.easeTo({center:[spot.lon,spot.lat],zoom:Math.max(map.getZoom(),3.8),duration:reducedMotion()?0:450});
      if (fallback) zoomFallbackAt([spot.lon,spot.lat],3.6);
    }
    renderHotspots();
    render();
  }
  const levelNames={green:'QUIET SIGNALS',amber:'ELEVATED SIGNALS',red:'HIGH SIGNALS'};
  // "Since you looked": this window records when you last had Operations in front of you (the kiosk does not count).
  const LAST_SEEN='capstone-last-seen',HOUR=3600000;
  const previousLook=Number(read(LAST_SEEN,0))||0;let digestSince=previousLook, digestRequest=0, activeDigest=null;
  const markSeen=()=>{if(document.visibilityState==='visible')save(LAST_SEEN,Date.now());};
  const span=ms=>{const h=Math.floor(ms/HOUR),m=Math.round(ms%HOUR/60000);return h>=48?`${Math.round(h/24)} days`:h?`${h}h ${m}m`:`${m} min`;};
  const pct=v=>v===null||v===undefined?'n/a':`${Math.round(v*100)}%`;
  async function openDigest(){
    const request = ++digestRequest;
    const now = Date.now();
    const choice = $('digest-window').value;
    const start = choice === 'last' ? digestSince || now - 24 * HOUR : now - Number(choice) * HOUR;
    const since = Math.min(now - 1000, Math.max(start, now - 8 * 24 * HOUR + 60000));
    activeDigest = null;
    $('copy-digest').disabled = true;
    $('digest-copy-status').textContent = '';
    if(!$('digest-dialog').open)$('digest-dialog').showModal();
    // Say what the window measures: since this Operations window was last on screen, not how long the app was off.
    $('digest-title').textContent=choice==='last'?`What changed since you last viewed Operations (${span(Date.now()-since)} ago)`:`What changed in the last ${span(Date.now()-since)}`;$('digest-body').innerHTML='<p class="subtle">Loading…</p>';
    try {
      const digest = await api('/api/digest?since=' + encodeURIComponent(new Date(since).toISOString()));
      if (request !== digestRequest) return;
      activeDigest = digest;
      renderDigest(digest);
      $('copy-digest').disabled = !digest.briefing;
    } catch (error) {
      if (request === digestRequest) $('digest-body').innerHTML = `<p class="feed-error">${esc(error.message)}</p>`;
    }
  }
  function renderDigest(d){
    const section=(title,items)=>items.length?`<section class="digest-section"><h3>${esc(title)}</h3><ul>${items.join('')}</ul></section>`:'';
    const tiles=d.tiles.filter(t=>t.changed||t.peaked).map(t=>`<li><b>${esc(t.label)}</b> ${t.then?`${levelNames[t.then]} → `:''}<span class="digest-level ${esc(t.now)}">${levelNames[t.now]}</span>${t.peaked?` <small>(peaked ${levelNames[t.peak]} in between)</small>`:''}</li>`);
    const parts=[
      d.partial?`<p class="digest-note">Not enough history to compare the whole stretch: checkpoints only go back to ${d.history_from?esc(new Date(d.history_from).toLocaleString()):'now'}. Changes before that are not shown, so this is not an all-clear.</p>`:'',
      section('Status board',tiles.length?tiles:[d.report_limit_reached?'<li>Some status comparisons are unavailable.</li>':'<li>No tile changed color.</li>']),
      section('New hot spots',d.hotspots.added.map(h=>`<li><button class="digest-link" data-hotspot="${esc(h.id)}">${esc(h.name)}</button> <small>${h.families} kinds of signal</small></li>`)),
      section('Places no longer meeting the hot spot threshold',d.hotspots.cleared.map(h=>`<li>${esc(h.name)}</li>`)),
      section('Outages that started',d.outages.started.map(o=>`<li>${esc(o.name)}</li>`)),
      section('Hazard records received · ' + (d.hazard_receipts?.total || 0),(d.hazard_receipts?.reports || []).map(report=>
        `<li><a href="/ops?event=${encodeURIComponent(report.id)}&amp;period=720">${esc(report.title)} ↗</a> <small>${esc(report.source)} · Received ${esc(ageLabel(report.first_received,'timestamp'))}</small></li>`)),
      section('Outage reports awaiting a fresh receipt',(d.outages.stale||[]).map(o=>`<li>${esc(o.name)} · current state unknown</li>`)),
      section('No longer listed as ongoing (recovery unconfirmed)',d.outages.ended.map(o=>`<li>${esc(o.name)}</li>`)),
      section('EPSS jumps (chance of exploitation in 30 days)',d.epss_movers.map(m=>`<li><button class="digest-link" data-search="${esc(m.cve)}">${esc(m.cve)}</button> ${pct(m.then)} → <b>${pct(m.now)}</b></li>`)),
      section('New CISA KEV entries',d.kev.map(k=>`<li><button class="digest-link" data-event="${esc(k.id)}">${esc(k.title)}</button></li>`)),
      section('New critical CVEs (CVSS 9+)',d.critical.map(c=>`<li><button class="digest-link" data-event="${esc(c.id)}">${esc(c.title)}</button>${c.epss!==null?` <small>EPSS ${pct(c.epss)}</small>`:''}</li>`)),
      d.trending?section('CVEs your sources keep naming',[`<li>${esc(d.trending)}</li>`]):'',
      section(`${d.report_count} new reports`,[`<li>Cyber ${d.totals.cyber||0} · World ${d.totals.geo||0} · AI ${d.totals.ai||0} · from social feeds ${d.totals.social||0}</li>`,...d.sources.map(s=>`<li>${esc(s.source)} <small>${s.count}</small></li>`)])
    ];
    const b=d.briefing;
    const context=$('digest-window').value==='last'&&!previousLook?'<p class="digest-note">First visit: comparing the last 24 hours where history exists.</p>':digestSince&&Date.now()-digestSince>8*24*HOUR&&$('digest-window').value==='last'?'<p class="digest-note">Your last visit is outside retained history. Showing the last eight days.</p>':'';
    $('digest-body').innerHTML=context+(b?b.coverage.map(note=>`<p class="digest-note">⚠ ${esc(note)}</p>`).join('')+`<div class="briefing-cards">${b.cards.map(c=>`<article class="briefing-card"><p class="eyebrow">${esc(c.label)}</p><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>${c.observed?`<small>Observed by this app ${esc(new Date(c.observed).toLocaleString())}</small>`:''}<div class="briefing-actions">${c.href?`<a href="${esc(c.href)}">Inspect evidence ↗</a>`:''}${c.status?`<button class="digest-link" data-status="${esc(c.status)}">Inspect status rule</button>`:''}${c.links.map(l=>`<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</div></article>`).join('')}</div>`+(!b.cards.length?`<p class="${b.quiet?'digest-quiet':'digest-note'}">${b.quiet?'No ranked changes detected in the available comparisons. This is not a prediction or an all-clear.':'No ranked changes found. Coverage is incomplete; conditions during gaps are unknown.'}</p>`:'')+(b.remaining?`<p class="subtle">${b.remaining} additional changes in the full comparison.</p>`:''):'')+'<details class="digest-full"><summary>Full comparison & source counts</summary>'+parts.join('')+'</details>';
  }
  function briefingText(digest) {
    const date = value => new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const briefing = digest.briefing;
    const lines = ['Capstone Viewer briefing', `Comparison ${date(digest.since)} to ${date(digest.until)}`,
      `${digest.report_count} reports dated within this window`, ''];
    if (briefing.coverage.length) lines.push('Coverage', ...briefing.coverage.map(note => '- ' + note), '');
    lines.push('Ranked changes');
    if (!briefing.cards.length) lines.push('No ranked changes in the available comparison.');
    for (const card of briefing.cards) {
      lines.push(`- ${card.title} (${card.label})`, '  ' + card.text);
      if (card.observed) lines.push('  Observed by Capstone ' + date(card.observed));
      for (const link of card.links) lines.push('  ' + link.label + ' · ' + link.url);
    }
    if (briefing.remaining) lines.push('', briefing.remaining + ' additional changes in the full comparison.');
    return lines.join('\n');
  }
  $('copy-digest').onclick = async () => {
    if (!activeDigest?.briefing) return;
    const value = briefingText(activeDigest);
    const feedback = $('digest-copy-status');
    try {
      await navigator.clipboard.writeText(value);
      feedback.textContent = 'Briefing copied';
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.readOnly = true;
      field.rows = 6;
      field.setAttribute('aria-label', 'Briefing text');
      feedback.replaceChildren(field);
      field.select();
    }
  };
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
  // The digest opens by itself only when the app was actually off (the server's offline gap, 45+ minutes without collecting);
  // time away from this window alone is not a reason to interrupt. "Since you looked" still opens it any time.
  let autoDigestChecked=false;
  subscribe(snap=>{if(autoDigestChecked)return;autoDigestChecked=true;if(snap?.offline&&previousLook&&!linkedReportId)setTimeout(()=>{if(!document.querySelector('dialog[open]'))void openDigest();},2000);});
  markSeen();

  function renderStatus(){
    const focusId = document.activeElement?.closest('#status-tiles [data-status]')?.dataset.status;
    // A tile missing a failing feed's input can look calmer than it is, so the gap is shown on the tile itself.
    $('status-tiles').innerHTML=statusTiles.map(t=>`<button class="status-tile ${t.level==='green'&&t.coverage?.current===0?'coverage-unknown':esc(t.level)}" data-status="${esc(t.id)}" aria-expanded="${openStatus===t.id}" aria-controls="status-detail"><span class="status-label">${esc(t.label)}</span><span class="status-level">${t.level==='green'&&t.coverage?.current===0?'COVERAGE UNAVAILABLE':levelNames[t.level]||esc(t.level)}</span><span class="status-headline">${esc(t.headline)}</span>${t.coverage?`<span class="status-coverage">${esc(t.coverage.label)}</span>`:''}${t.gaps?.length?`<span class="status-gap">⚠ Data gap: ${esc(t.gaps.join(', '))}</span>`:''}</button>`).join('');
    const t=statusTiles.find(t=>t.id===openStatus);
    const panel = $('status-detail');
    const evidenceLink = document.activeElement?.closest('#status-detail a')?.getAttribute('href');
    panel.hidden=!t;
    if(focusId) $('status-tiles').querySelector('button[data-status="'+CSS.escape(focusId)+'"]')?.focus({preventScroll:true});
    if (t) {
      const markup = `<p class="eyebrow">${esc(t.label.toUpperCase())} · SIGNAL ACTIVITY</p>` + CapstoneStatusDetail.markup(t);
      if(panel.innerHTML!==markup){
        panel.innerHTML=markup;
        if(evidenceLink)[...panel.querySelectorAll('a')].find(link=>link.getAttribute('href')===evidenceLink)?.focus({preventScroll:true});
      }
    }
  }
  // Startup notice when collection was off: the gap, its length, and how the previous session ended.
  function renderOffline(gap){
    const box=$('offline-gap');box.hidden=!gap;if(!gap)return;
    box.innerHTML=`<b>⚠ ${esc(gap.title)}.</b> ${esc(gap.body)} <small>${esc(gap.cause)}</small> <button type="button" id="dismiss-offline">Dismiss</button>`;
    $('dismiss-offline').onclick=async()=>{try{await Capstone.dismissCollectionGap(gap);box.hidden=true;}catch(error){box.querySelector('small').textContent=error.message;}};
  }
  function renderFeedGaps(problems){
    const line=$('feed-gaps');line.hidden=!problems.length;if(!problems.length)return;
    const rendered = `⚠ <b>${problems.length} collector ${problems.length === 1 ? 'issue' : 'issues'}</b> · ${problems.map(problem =>
      `${esc(problem.name)} <small>(${problem.kind === 'stalled' ? 'overdue since last successful poll' : 'collection failing'})</small>`
    ).join(', ')} · <a href="#feed-health-panel">Collector health</a>`;
    if (line.innerHTML !== rendered && !line.contains(document.activeElement)) line.innerHTML = rendered;
  }
  function renderOutages(){
    // IODA reports one outage per signal (BGP, probing, traffic); list each place once, strongest first.
    const seen=new Set(),rows=events.filter(e=>e.kind==='outage'&&e.ongoing&&e.outage_state!=='stale').sort((a,b)=>b.score-a.score||Date.parse(b.ts)-Date.parse(a.ts)).filter(e=>{const key=isLocated(e)?e.place:e.id;if(seen.has(key))return false;seen.add(key);return true;});
    $('outage-count').textContent=rows.length;
    $('outage-list').innerHTML=rows.length?rows.slice(0,8).map(e=>`<button data-event="${esc(e.id)}"><span>${esc(isLocated(e)?e.place:e.title)}</span><small>${esc(e.source)} · since ${esc(new Date(e.first_ts||e.ts).toISOString().slice(5,16).replace('T',' '))}Z</small></button>`).join(''):'<p class="subtle">No recently received ongoing outage listings.</p>';
  }
  function renderPulse(p){
    const state=$('pulse-state'),reading=$('pulse-reading'),spark=$('pulse-spark');
    if(!p){state.textContent='Off';reading.textContent='The routing pulse runs when collectors are on (desktop app or server mode).';spark.innerHTML='';return;}
    state.textContent=p.state==='ok'?(p.surge?'SURGE':'Live'):p.state==='connecting'?'Connecting':'Offline';state.classList.toggle('surge',!!p.surge);
    const values = p.minutes.map(sample=>sample[2]);
    const max = Math.max(1,...values.filter(Number.isFinite));
    let connected = false;
    const chart = values.map((value,index) => {
      if (!Number.isFinite(value)) { connected = false; return ''; }
      const command = connected ? 'L' : 'M';
      connected = true;
      const x = (index / Math.max(1,values.length-1) * 240).toFixed(1);
      const y = (46 - value / max * 44).toFixed(1);
      return command + x + ' ' + y;
    }).join(' ');
    spark.classList.toggle('surge',!!p.surge);
    reading.classList.toggle('surge',!!p.surge);
    spark.innerHTML = chart.trim() ? `<path d="${chart}"/>` : '';
    const baseline = p.ratio !== null ? ' · ' + p.ratio + '× median' :
      p.baselineWindows < 12 ? ' · building baseline (' + p.baselineWindows + '/12 windows)' : ' · baseline median is zero';
    reading.textContent = p.state === 'error' ? 'RIS Live unavailable · ' + p.error :
      p.last5 === null ? (p.lastMessage ? 'Waiting for five consecutive observed minutes.' : 'Waiting for routing updates.') :
      p.last5.toLocaleString('en-US') + ' withdrawals / 5 min' + baseline;
  }
  function applyProjection(){
    $('projection-toggle').setAttribute('aria-pressed',String(projection==='globe'));$('projection-toggle').textContent=projection==='globe'?'Flat map':'Globe';
    if (mapReady) {
      map.setProjection({type:projection});
      renderMap();
    }
  }
  function startReplay(){
    const period = $('time-window');
    replay.restoreActive = period.value==='active';
    if (replay.restoreActive) period.value = '24';
    replay.rows = readingRows;
    replay.hotspots = hotspots;
    $('replay-hold-status').hidden = false;
    timeBasis.disabled = true;
    closePlacePreview();
    replay.on=true;replay.start=Date.now()-86400000;replay.minute=reducedMotion()?1440:0;$('replay-slider').value=replay.minute;$('replay-bar').hidden=false;
    $('replay-toggle').setAttribute('aria-pressed','true');$('replay-toggle').textContent='Exit replay';
    render();
    if(reducedMotion())renderReplay();else playReplay();
  }
  function stopReplay(){
    pauseReplay();
    replay.on=false;
    if (replay.restoreActive && $('time-window').value==='24') $('time-window').value='active';
    replay.restoreActive = false;
    replay.rows = replay.hotspots = null;
    $('replay-hold-status').hidden = true;
    timeBasis.disabled = false;
    closePlacePreview();
    $('replay-bar').hidden=true;
    $('replay-toggle').setAttribute('aria-pressed','false');
    $('replay-toggle').textContent='Replay 24h';
    render();
  }
  function playReplay(){
    if(replay.minute>=1440)replay.minute=0;clearInterval(replay.timer);$('replay-play').textContent='❚❚';$('replay-play').setAttribute('aria-label','Pause');
    replay.timer=setInterval(()=>{replay.minute=Math.min(1440,replay.minute+10);$('replay-slider').value=replay.minute;renderReplay();if(replay.minute>=1440)pauseReplay();},200);renderReplay();
  }
  function pauseReplay(){clearInterval(replay.timer);replay.timer=null;$('replay-play').textContent='▶';$('replay-play').setAttribute('aria-label','Play');}
  function renderReplay(){
    $('replay-time').textContent=new Date(replayTime()).toISOString().slice(5,16).replace('T',' ')+'Z';
    renderMap();
    const story = findEvent(selected);
    if (['river_gauge','airport_disruption','road_closure'].includes(story?.kind) || story?.weather_replaced_at) renderDetail();
  }
  function replacementLinks(report) {
    return (report.weather_replacements || []).map(update=>
      '<li><a href="'+esc(update.source_url_scope ? '/ops?event='+encodeURIComponent(update.id)+'&period=720' : update.url)+'" target="_blank" rel="noopener noreferrer">'+esc(update.title)+' ↗</a>'+
      (update.place ? ' · '+esc(update.place) : '')+'</li>').join('');
  }
  function renderDetail() {
    if (mappedLink) {
      const report = mappedLink;
      const detail = $('event-detail');
      if (detail.dataset.linked!==report.id) {
        detail.dataset.linked = report.id;
        detail.innerHTML = `<p class="eyebrow">LINKED REPORT · ${esc(String(report.ts || '').slice(0,10) || 'Source date unavailable')}</p>
          <h3>${esc(report.title)}</h3><p class="subtle">${esc(report.summary || '')}</p>
          <p class="detail-meta">${esc(report.source)} · ${esc(T.placement(report))} · ${esc(report.place)}</p>
          ${report.weather_replaced_at ? '<p class="detail-meta">'+esc(warningState(report).label)+'</p><ul class="warning-replacements">'+replacementLinks(report)+'</ul>' : ''}
          <div class="detail-actions"><button id="linked-map-evidence" type="button">Report details &amp; notes</button>
          ${report.weather_area ? '<button id="linked-fit-area" type="button">Fit published warning area</button>' : ''}
          ${publishedLine(report) ? '<button id="linked-fit-track" type="button">'+lineButtonLabel(report)+'</button>' : ''}</div>`;
        $('linked-map-evidence').onclick=()=>void CapstoneReports.open(report);
        $('linked-fit-area')?.addEventListener('click',()=>fitPublishedGeometry(report.weather_area,report.lon));
        $('linked-fit-track')?.addEventListener('click',()=>fitPublishedGeometry(publishedLine(report),report.lon));
      }
      return;
    }
    const live = events.find(e => e.id === selected);
    if (!live) return;
    const detail = $('event-detail');
    const e = replay.on && (['river_gauge','airport_disruption','road_closure'].includes(live.kind) || live.weather_replaced_at) ? mapEvents.find(story=>story.id===live.id) : live;
    if (!e) {
      detail.innerHTML = live.kind==='river_gauge' ? '<p class="subtle">This gauge has no mapped reading at this point in replay.</p>' :
        '<p class="subtle">This bulletin has no marker at the selected replay time.</p>';
      return;
    }
    const same = detail.dataset.story === e.id;
    const expanded = same && detail.querySelector('.story-reports')?.open;
    const focusId = same && detail.contains(document.activeElement) ? document.activeElement.id : null;
    detail.dataset.story = e.id;
    const warning = replay.on ? null : warningState(e);
    const reference = T.sourceReference(e);
    const later = warning && replacementLinks(e);
    const warningMeta = warning ? '<p class="detail-meta">'+warning.label+
      ' · Published end '+esc(ageLabel(e.weather_valid_until,'timestamp'))+'</p>'+
      (later ? '<ul class="warning-replacements">'+later+'</ul>' : '') : '';
    detail.innerHTML = `<p class="eyebrow detail-type">${typeBadge(e)} <span class="desk-label">${labels[e.category]} / ${esc(e.source)}</span></p><h3>${esc(e.outage_state==='stale'?e.title.replace(/ \(ongoing\)$/,''):e.title)}</h3>${e.outage_state==='stale'?'<p class="status-gap-note">Last received as ongoing. Current state unknown.</p>':''}<p class="subtle">${esc(e.summary)}</p><p class="detail-meta">Source date ${esc(ageLabel(e.ts,e.date_precision))}${e.first_received ? ' · First received '+esc(ageLabel(e.first_received,'timestamp')) : ''} · ${esc(e.confidence)} · Display priority ${e.score}/100${e.cvss?` · CVSS ${esc(e.cvss)}`:''}</p>${e.epss?`<p class="epss-detail">EPSS ${epssPct(e.epss.epss)} for ${esc(e.epss.cve)} (${Math.round(e.epss.percentile*100)}th percentile, ${esc(e.epss.date||'latest')}). FIRST's daily estimate of exploitation in the next 30 days; a probability, not a sighting.</p>`:''}${e.watch_matches?.length?`<p class="watch-match">Watching: ${e.watch_matches.map(esc).join(' · ')}</p>`:''}<p class="subtle">${esc(e.place)} — ${esc(bases[e.place_basis] || e.place_basis)}${e.location_note ? '. ' + esc(e.location_note) : ''}</p>${warningMeta}${tagChips(e,100)}<div class="detail-actions"><button id="follow-developing">Follow developing story</button><button id="tag-event">Evidence, tags & notes</button>${publishedLine(e) ? '<button id="fit-observation-track" type="button">'+lineButtonLabel(e)+'</button>' : ''}${e.weather_area ? '<button id="fit-weather-area" type="button">Fit published warning area</button>' : ''}<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(reference?'Open '+reference:'Read source')} ↗</a>${e.source_withdrawn ? '' : `<button id="place-event">${e.manual_location?'Edit location':'Place on map'}</button>`}${e.manual_location?'<button id="clear-location">Restore source location</button>':''}<button id="pin-event" aria-pressed="${isPinned(e)}">${isPinned(e) ? 'Unpin' : 'Pin to week map'}</button><button id="hide-event">Hide story</button>${e.source_withdrawn ? '' : '<button id="group-event">Group with story…</button>'}</div><details class="story-reports" ${expanded?'open':''}><summary>${e.report_count||1} report${e.report_count>1?'s':''} · ${e.source_count||1} source origin${e.source_count>1?'s':''}</summary>${e.report_count>1?`<p class="subtle">Linked by ${e.group_basis.map(esc).join(', ')}. Sources may quote each other; grouping does not confirm their claims.</p>`:''}${members(e).map(r=>`<article class="report-evidence"><button data-report-tags="${esc(r.id)}">Edit this report’s tags</button>${T.sourceReference(r)?`<button type="button" class="report-text-button" data-report-tags="${esc(r.id)}">${esc(r.title)}</button>`:`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ↗</a>`}<p class="subtle">${esc(r.source)} · ${esc(ageLabel(r.ts,r.date_precision))}${r.first_received ? ' · First received '+esc(ageLabel(r.first_received,'timestamp')) : ''} · ${esc(r.confidence)}</p>${e.report_count>1?`<button data-separate="${esc(r.id)}">Keep this report separate</button>`:r.separate&&!e.source_withdrawn?`<button data-restore-group="${esc(r.id)}">Allow automatic grouping</button>`:''}</article>`).join('')}</details><p id="detail-message" class="subtle" role="status"></p>`;
    if (focusId) document.getElementById(focusId)?.focus({preventScroll:true});
    $('pin-event').disabled = !isLocated(e) || Date.parse(e.ts)<Date.now()-7*86400000;
    $('fit-observation-track')?.addEventListener('click',()=>fitPublishedGeometry(publishedLine(e),e.lon));
    $('fit-weather-area')?.addEventListener('click',()=>fitPublishedGeometry(e.weather_area,e.lon));
    $('follow-developing').onclick=async()=>{try{const t=await api('/api/developing/follow','POST',{storyId:e.id});location.href='/developing?id='+encodeURIComponent(t.id);}catch(error){$('detail-message').textContent=error.message;}};
    $('tag-event').onclick=()=>void CapstoneReports.open(members(e).find(r=>r.id===selectedReport)||members(e).find(r=>r.id===e.representative_id)||members(e)[0],members(e));
    $('event-detail').querySelectorAll('[data-report-tags]').forEach(b=>b.onclick=()=>void CapstoneReports.open(members(e).find(r=>r.id===b.dataset.reportTags),members(e)));
    $('pin-event').onclick = () => {if(isPinned(e))aliases(e).forEach(id=>pinned.delete(id));else aliases(e).forEach(id=>pinned.add(id));persist();render();};
    $('hide-event').onclick = () => {aliases(e).forEach(id=>hidden.add(id));selected=null;selectedReport=null;persist();$('event-detail').innerHTML='<p class="subtle">Story hidden. Use Restore hidden to bring hidden stories back.</p>';render();};
    $('place-event')?.addEventListener('click',()=>openLocation(e));
    $('clear-location')?.addEventListener('click',async()=>{try{for(const report of members(e).filter(r=>r.manual_location))await api('/api/events/'+report.id+'/location','DELETE');await loadSnapshot();}catch(error){$('detail-message').textContent=error.message;}});
    $('group-event')?.addEventListener('click',()=>{groupReport=e.representative_id||e.id;$('group-search').value='';$('group-status').textContent='';renderGroupChoices();$('group-dialog').showModal();});
    $('event-detail').querySelectorAll('[data-separate],[data-restore-group]').forEach(button=>button.onclick=async()=>{try{const id=button.dataset.separate||button.dataset.restoreGroup;await api('/api/stories/separate','POST',{eventId:id,restore:!!button.dataset.restoreGroup});selectedReport=id;await loadSnapshot();selectEvent(id);}catch(error){$('detail-message').textContent=error.message;}});
  }
  function persist() { const ok = save('capstone-pinned', [...pinned]) && save('capstone-hidden', [...hidden]); if (!ok) $('connection').textContent = 'Browser storage unavailable; curation lasts this session.'; channel?.postMessage({type:'curation'}); }
  function centerMapOn(report) {
    if (mapReady) map.easeTo({center:[report.lon,report.lat],zoom:Math.max(map.getZoom(),4.6),duration:reducedMotion()?0:450});
    if (fallback) zoomFallbackAt([report.lon,report.lat],Math.max(Math.log2(720/fallbackView[2])+1,Math.log2(720/300)+1));
  }
  function clearMappedLink() {
    if (!mappedLink) return;
    mappedLink = null;
    linkedCenterPending = false;
    const detail = $('event-detail');
    delete detail.dataset.linked;
    detail.innerHTML = '<p class="subtle">Select a story to inspect its reports and location.</p>';
  }
  function openMapEvent(id) {
    if (mappedLink?.id===id) return void CapstoneReports.open(mappedLink);
    selectEvent(id,true);
  }
  function selectEvent(id, announce = false, scrollResult = true) {
    const live=findEvent(id);if(!live||!matches(live))return;
    const e = replay.on && live.kind==='river_gauge' ? mapEvents.find(story=>story.id===live.id) || live : live;
    clearMappedLink();
    selected=e.id;selectedReport=e.representative_id||e.id;render();
    if (eligiblePlacement(e)) centerMapOn(e);
    else countryLabels?.refresh();
    const card = document.querySelector(`[data-event="${CSS.escape(e.id)}"]`);
    if (scrollResult && card) card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});
    if (announce) channel?.postMessage({type:'select-event',id:selectedReport});
  }
  function storyInScope(story) {
    if (!currentOnly() && !stateScope && !countryScope && category==='all' && sourceFilter==='all' && typeFilter==='all' &&
        storyEvidence.value==='all' && !$('watch-only').checked) return story;
    const candidates = members(story).filter(report=>reportMatches(report,stateScope,countryScope,provinceScope));
    if (!candidates.length) return story;
    const representative = candidates.find(report=>report.id===story.representative_id) || candidates[0];
    const latest = candidates.reduce((best,report)=>report.ts>best.ts?report:best,representative);
    const latestReceived = T.latestReceipt(candidates);
    const zone = !story.manual_location && representative.place_basis==='nws_zone_reference' &&
      representative.weather_zone_references?.find(zone=>zone.state===stateScope);
    if (!zone && representative.id===story.representative_id && latest.ts===story.ts &&
        latestReceived===story.latest_received && (!story.manual_location || representative.manual_location)) return story;
    const view = {...story,...representative,id:story.id,representative_id:representative.id,ts:latest.ts,date_precision:latest.date_precision,
      latest_received:latestReceived,first_received:representative.first_received,
      lat:representative.lat ?? null,lon:representative.lon ?? null,place:representative.place || 'Location not established',
      place_basis:representative.place_basis || 'unlocated',location_note:representative.location_note,
      watch_matches:[...new Set(candidates.flatMap(report=>report.watch_matches || []))],display_tags:story.display_tags,
      cvss:representative.cvss,epss:representative.cves?.includes(story.epss?.cve) ? story.epss : undefined,
      country_code:representative.country_code,province_code:representative.province_code,state_codes:representative.state_codes,weather_area:representative.weather_area,
      weather_valid_until:representative.weather_valid_until,weather_listed_until:representative.weather_listed_until,weather_status:representative.weather_status,
      airport_valid_until:representative.airport_valid_until,airport_listed_until:representative.airport_listed_until,
      outage_listed_until:representative.outage_listed_until,
      road_status:representative.road_status,road_started_at:representative.road_started_at,road_ended_at:representative.road_ended_at,road_listed_until:representative.road_listed_until,road_valid_until:representative.road_valid_until,road_geometry:representative.road_geometry,
      weather_replaced_at:representative.weather_replaced_at,weather_replacements:representative.weather_replacements,
      weather_geometry_revision:representative.weather_geometry_revision,observation_track:representative.observation_track,
      cyclone_center_at:representative.cyclone_center_at};
    return zone ? {...view,lon:zone.lon,lat:zone.lat,place:zone.place} : view;
  }
  function render() {
    renderMonitorFilters();
    const rows = replay.rows || readingRows;
    const showMuted = $('ops-show-muted').checked;
    events = (showMuted ? rows : rows.flatMap(story=>{
      const reports = members(story);
      const visible = reports.filter(report=>!CapstoneReading.muted(report));
      if (!visible.length) return [];
      if (visible.length===reports.length) return [story];
      const representative = visible.find(report=>report.id===story.representative_id);
      const head = representative ? story : {...story,...visible[0],
        lat:visible[0].lat ?? null,lon:visible[0].lon ?? null,weather_area:visible[0].weather_area,weather_listed_until:visible[0].weather_listed_until,airport_listed_until:visible[0].airport_listed_until,outage_listed_until:visible[0].outage_listed_until,weather_replaced_at:visible[0].weather_replaced_at,weather_replacements:visible[0].weather_replacements,weather_geometry_revision:visible[0].weather_geometry_revision,observation_track:visible[0].observation_track,
        place:visible[0].place || 'Location not established for remaining reports',
        place_basis:visible[0].place_basis || 'unlocated'};
      return [{...head,id:story.id,latest_received:T.latestReceipt(visible),reports:visible,report_ids:visible.map(report=>report.id),
        representative_id:representative?.id || visible[0].id,report_count:visible.length,
        source_count:new Set(visible.map(report=>report.source_id || report.source)).size,
        display_tags:visible.flatMap(report=>report.display_tags || [])}];
    })).map(storyInScope);
    const spot = (replay.hotspots || hotspots).find(spot=>spot.id===activeHotspot);
    if (activeHotspot && !spot) { clearHotspot(false); return; }
    hotspotFilter = spot ? new Set(spot.report_ids) : null;
    renderOutages();
    const current = findEvent(selected) || findEvent(selectedReport);
    if (current && matches(current)) selected=current.id;
    else if (selected) {
      selected = selectedReport = null;
      $('event-detail').innerHTML = '<p class="subtle">Select a story to inspect its reports and location.</p>';
    }
    renderTimeline();
    renderMap();
    renderDetail();
  }
  function renderDeveloping(rows){const active=rows.filter(t=>t.state!=='resolved'),featured=active.filter(t=>t.followed).slice(0,4);for(const family of ['cyber','outage','geo','ai']){const t=active.find(t=>t.family===family&&!featured.includes(t));if(t&&featured.length<4)featured.push(t);}for(const t of active)if(featured.length<4&&!featured.includes(t))featured.push(t);$('ops-dev-count').textContent=active.length;$('ops-developing').innerHTML=active.length?featured.map(t=>`<a class="ops-dev-card" href="/developing?id=${esc(t.id)}"><span class="dev-kicker">${t.followed?'FOLLOWING':'AUTO WATCH'} · ${esc(t.state.toUpperCase())}</span><strong>${esc(t.title)}</strong><span>${esc(t.source_condition)}</span><small>${t.report_count} reports · ${esc(t.evidence.join(' / '))}</small></a>`).join(''):'<p class="subtle">No developing threads yet. Select an event and follow its story to start an evidence trail.</p>';}
  const savedBalance=Number(desk?.balance??read('capstone-ops-balance',60));$('ops-balance').value=Number.isFinite(savedBalance)?Math.max(40,Math.min(70,savedBalance)):60;
  function balance(){const value=Number($('ops-balance').value);document.querySelector('.ops-grid').style.setProperty('--ops-map-share',value+'%');$('ops-balance-value').textContent=value+' / '+(100-value);if(!CapstoneDesks.active())save('capstone-ops-balance',value);if(mapReady)map.resize();}
  $('ops-balance').oninput=balance;balance();$('ops-diagnostics').onclick=()=>{const show=$('ops-situation').hidden;$('ops-situation').hidden=!show;$('ops-diagnostics').setAttribute('aria-expanded',String(show));$('ops-diagnostics').textContent=show?'Hide network diagnostics':'Show network diagnostics';};
  let feedStatusData, manualRefresh = false, sourceOptions = '';
  function updateRefreshControl() {
    $('refresh').disabled = !feedStatusData?.collecting || feedStatusData.refreshing || manualRefresh;
    if (feedStatusData && !feedStatusData.collecting) $('refresh').title = 'Collection is paused';
    else $('refresh').removeAttribute('title');
  }
  function applySnapshot(data) {
    if (!Array.isArray(data.stories||data.events) || !Array.isArray(data.feeds)) return;
    readingRows=data.stories||data.events||[];
    $('live-report-limit').hidden = !data.reportWindow?.limited;
    renderDeveloping(data.developing||[]);events = data.stories||data.events;hotspots=Array.isArray(data.hotspots)?data.hotspots:[];statusTiles=Array.isArray(data.status)?data.status:[];renderStatus();renderFeedGaps(Array.isArray(data.feedHealth)?data.feedHealth:[]);renderOffline(data.offline);renderHotspots();renderPulse(data.pulse);
    const rows = data.feeds.filter(feed=>!feed.tracker).sort((a,b)=>a.name.localeCompare(b.name));
    collectorNames = new Map(rows.map(feed=>[feed.id,feed.name]));
    const quick = [['all','All sources'],['core','Core feeds'],['telegram','Telegram'],['x','X'],['bluesky','Bluesky'],['mastodon','Mastodon']];
    if (sourceFilter !== 'all' && sourceFilter !== 'core' && !platforms.includes(sourceFilter) && !collectorNames.has(sourceFilter)) sourceFilter = 'all';
    const option = ([value,name]) => `<option value="${esc(value)}">${esc(name)}</option>`;
    const group = (label,collectors) => collectors.length ?
      `<optgroup label="${label}">${collectors.map(feed=>option([feed.id,feed.name])).join('')}</optgroup>` : '';
    const byGroup = new Map();
    for (const feed of rows) {
      const key = Capstone.collectorGroup(feed);
      if (!byGroup.has(key)) byGroup.set(key,[]);
      byGroup.get(key).push(feed);
    }
    const markup = quick.map(option).join('') + Object.entries(Capstone.collectorGroups)
      .map(([key,label])=>group(label,byGroup.get(key) || [])).join('');
    if (sourceOptions !== markup) {
      sourceOptions = markup;
      $('platform-filter').innerHTML = markup;
    }
    if ($('platform-filter').value !== sourceFilter) $('platform-filter').value = sourceFilter;
    const finished = feedStatusData?.refreshing && !data.refreshing;
    feedStatusData = data;
    render(); known = new Map(events.map(e => [e.id,e.revision])); initialized = true;
    locateLinkedReport();
    renderConnection();
    if (finished && $('refresh-feedback').dataset.polling === '1') {
      $('refresh-feedback').textContent = 'Refresh finished. Check Feeds for poll results.';
      delete $('refresh-feedback').dataset.polling;
    }
    renderCollectorHealth();
    updateRefreshControl();
  }

  function renderCollectorHealth() {
    if (!feedStatusData) return;
    const { feeds, collecting, feedHealth = [], refreshing } = feedStatusData;
    const problems = new Map(feedHealth.map(problem => [problem.id, problem]));
    const active = feeds.filter(feed => feed.enabled !== false && !['needs-key', 'paused'].includes(feed.state));
    const successful = active.filter(feed => feed.state === 'ok' && !problems.has(feed.id)).length;
    const paused = feeds.filter(feed => feed.enabled === false || feed.state === 'paused').length;
    $('ops-gap-count').hidden = !problems.size;
    $('ops-gap-count').textContent = problems.size;
    $('feed-summary').textContent = !collecting ? 'Collection paused' :
      `${successful}/${active.length} active feeds with successful polls${refreshing ? ' · refreshing' : ''}${paused ? ' · ' + paused + ' paused' : ''}`;
    const panel = $('feed-health');
    if (!$('feed-health-panel').open || panel.contains(document.activeElement)) return;

    const status = feed => {
      if (feed.state === 'needs-key') return 'Needs connection';
      if (!collecting || feed.enabled === false || feed.state === 'paused') return 'Paused';
      if (problems.get(feed.id)?.kind === 'stalled') return 'Overdue';
      return { ok:'Last poll succeeded', error:'Last poll failed', waiting:'Awaiting first poll', collecting:'Polling…' }[feed.state] || 'Unknown';
    };
    const rows = [...feeds].sort((a, b) => Number(problems.has(b.id)) - Number(problems.has(a.id)));
    const markup = rows.map(feed => {
      const state = status(feed);
      const mirror = feed.officialMirror ? ' · Official mirror' : '';
      const detail = state === 'Overdue' ? problems.get(feed.id)?.detail : ['Needs connection', 'Last poll failed'].includes(state) ? feed.error : '';
      const history = feed.lastSuccess ? 'Last success ' + ageLabel(feed.lastSuccess) : 'No successful collection yet';
      const url = feed.platform ? '/ops?source=' + encodeURIComponent(feed.id) + '&amp;period=168' :
        '/timeline?feed=' + encodeURIComponent(feed.id) + '&amp;collector=' + encodeURIComponent(feed.name);
      return `<div class="health-item"><span class="status-dot${state === 'Last poll succeeded' ? '' : ' offline'}" aria-hidden="true"></span>
        <a href="${url}">${esc(feed.name)} ↗</a><small>${esc(state + mirror)}</small>
        <small>${esc(history)}${detail ? ' · ' + esc(detail) : ''}</small></div>`;
    }).join('');
    if (panel.innerHTML !== markup) panel.innerHTML = markup;
  }
  let liveConnected = false, lastSnapshot = null;
  function renderConnection() {
    const label = liveConnected ? (feedStatusData?.collecting===false ? 'Updates connected · Collection paused' : 'Updates connected') :
      lastSnapshot ? 'Reconnecting · last snapshot '+ageLabel(lastSnapshot,'timestamp') : 'Waiting for a live snapshot';
    if ($('connection').textContent !== label) $('connection').textContent = label;
    document.querySelector('.connection .status-dot').classList.toggle('offline',!liveConnected || feedStatusData?.collecting===false);
  }
  function connection(ok,last) {
    liveConnected=ok;
    lastSnapshot=last;
    renderConnection();
    if (currentOnly()) render();
    else if (regionalView) renderRegionCoverage(regionalView.rows,regionalView.cutoff,regionalView.received);
  }
  function initFeed() {
    let checkedLink = false;
    const checkLinkedReport = () => {
      if (checkedLink) return;
      checkedLink = true;
      if (linkedReportId && !selected) void openLinkedReport();
    };
    const fallbackTimer = setTimeout(async () => {
      if (!initialized) {
        try {
          const data = await api('/api/events?view=ops');
          if (!initialized) {
            applySnapshot(data);
            if (initialized && data.now) $('connection').textContent = 'Snapshot ' + ageLabel(data.now) + ' · Waiting for live updates';
          }
        } catch {
          if (!initialized) $('connection').textContent = 'Collector unavailable. Start the Capstone app or server.';
        }
      }
      checkLinkedReport();
    }, 2500);
    subscribe(data => {
      applySnapshot(data);
      if (!initialized) return;
      clearTimeout(fallbackTimer);
      checkLinkedReport();
    });
    onConnection(connection);
  }
  function locateLinkedReport() {
    if (linkedCenterPending && mappedLink && (mapReady || fallback)) {
      linkedCenterPending = false;
      if (!sharedCamera) centerMapOn(mappedLink);
    }
    if (!linkedReportId || linkedMapOpened || sharedCamera || (!mapReady && !fallback)) return;
    const report = findEvent(linkedReportId);
    if (!report || selected!==report.id || !eligiblePlacement(report)) return;
    linkedMapOpened = true;
    selectEvent(linkedReportId,false,false);
  }
  async function openLinkedReport() {
    const prompt = $('linked-report');
    const status = $('linked-report-status');
    const button = $('open-linked-report');
    const locate = $('locate-linked-report');
    prompt.hidden = false;
    status.textContent = 'Loading the linked report…';
    try {
      const report = await api('/api/reports/' + encodeURIComponent(linkedReportId));
      status.textContent = 'Linked report · ' + report.title;
      button.hidden = false;
      button.onclick = async () => {
        button.disabled = true;
        try { CapstoneReports.showLoaded(await api('/api/reports/' + encodeURIComponent(linkedReportId))); }
        catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      };
      locate.hidden = !isLocated(report);
      locate.onclick = () => {
        if (replay.on) stopReplay();
        const liveReport = findEvent(report.id);
        if (liveReport && matches(liveReport) && eligiblePlacement(liveReport)) return selectEvent(report.id,false,false);
        selected = selectedReport = null;
        mappedLink = report;
        linkedCenterPending = true;
        renderMap();
        renderDetail();
        locateLinkedReport();
      };
      if (showLinkedMap && isLocated(report)) locate.click();
      else if (!selected && !document.querySelector('dialog[open]')) CapstoneReports.showLoaded(report);
    } catch (error) {
      status.textContent = 'Could not open the linked report. ' + error.message;
    }
  }
  async function loadSnapshot(){applySnapshot(await api('/api/events?view=ops'));}
  async function initMap() {
    try {
      const provinceRequest=fetch('/assets/ca-provinces.json').then(response=>response.ok ? response.json() : null).catch(()=>null);
      const statesRequest=fetch('/assets/us-states.json').then(response=>response.ok ? response.json() : null).catch(()=>null);
      const responses=await Promise.all([fetch('/assets/world.json'),fetch('/assets/world-paths.json'),fetch('/assets/countries.json')]);if(responses.some(r=>!r.ok))throw new Error('Map data unavailable');[world,worldPaths,countries]=await Promise.all(responses.map(r=>r.json()));
      $('location-country').innerHTML='<option value="">Choose a country (optional)</option>'+Object.entries(countries).sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([code,c])=>`<option value="${esc(code)}">${esc(c.name)}</option>`).join('');
      countryChoices = Object.entries(countries).sort((a,b)=>a[1].name.localeCompare(b[1].name));
      countryPicker.replaceChildren(new Option('Anywhere',''),...countryChoices.map(([code,country])=>new Option(country.name,code)));
      if (countryScope && !Object.hasOwn(countries,countryScope)) countryScope = '';
      countryPicker.value = countryScope;
      [stateAtlas,provinceAtlas] = await Promise.all([statesRequest,provinceRequest]);
      if (provinceScope && !provinceAtlas?.provinces.some(place=>place.code===provinceScope)) provinceScope='';
      if (stateAtlas && stateScope && stateScope !== 'US' && !stateAtlas.states.some(state=>state.code===stateScope)) stateScope = '';
      renderStates();
      maplibregl = await import('/assets/vendor/maplibre-gl.mjs');
      const styles = getComputedStyle(document.body), color = name => styles.getPropertyValue(name).trim();
      map = new maplibregl.Map({ container:'map', center:openingCamera?.center||[15,22],zoom:openingCamera?.zoom??1.25,bearing:openingCamera?.bearing||0,pitch:openingCamera?.pitch||0,minZoom:0.6,maxZoom:8,renderWorldCopies:false,attributionControl:false,doubleClickZoom:false,
        style:{version:8,sources:{world:{type:'geojson',data:world,promoteId:'code'}},layers:[{id:'water',type:'background',paint:{'background-color':color('--water')}},{id:'land',type:'fill',source:'world',paint:{'fill-color':color('--land')}},{id:'borders',type:'line',source:'world',paint:{'line-color':color('--borders'),'line-width':0.6}}]} });
      map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:false}),'bottom-right');
      map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
      map.addControl(new maplibregl.AttributionControl({customAttribution:'Natural Earth · MapLibre',compact:true}));
      map.on('load', () => {
        map.addLayer({id:'country-activity',source:'world',type:'fill',paint:{
          'fill-color':color('--signal'),
          'fill-opacity':['interpolate',['linear'],['number',['feature-state','count'],0],0,0,1,.08,10,.24,40,.48]
        }},'borders');
        map.addLayer({id:'focused-country',source:'world',type:'fill',filter:['==',['get','code'],countryScope],
          paint:{'fill-color':color('--signal'),'fill-opacity':0.24}},'borders');
        map.addSource('night',{type:'geojson',data:nightGeo()});map.addLayer({id:'night',type:'fill',source:'night',layout:{visibility:nightShading.checked?'visible':'none'},paint:{'fill-color':color('--night-shade'),'fill-opacity':Number(color('--night-alpha'))||0.5}});
        // US state borders under the night shade; state names appear from zoom 3 (map-labels.js).
        CapstoneMapLabels.usStates(maplibregl.Marker,map,{before:'night',data:stateAtlas,onState:(code,event)=>{if(!placementMode && !map.queryRenderedFeatures(event.point,{layers:['hotspot-rings','current-weather-fill'].filter(id=>map.getLayer(id))}).length)chooseState(stateScope===code?'US':code);}}).then(layer=>{usStateLayer=layer;renderStates();});
        if (provinceAtlas) {
          map.addSource('ca-provinces',{type:'geojson',data:provinceAtlas.areas,promoteId:'code'});
          map.addLayer({id:'ca-province-fill',source:'ca-provinces',type:'fill',minzoom:2.35,paint:{
            'fill-color':color('--signal'),'fill-opacity':['case',['boolean',['feature-state','selected'],false],.38,
              ['interpolate',['linear'],['number',['feature-state','count'],0],0,0,1,.1,15,.28]]
          }},'night');
          map.addLayer({id:'ca-province-borders',source:'ca-provinces',type:'line',minzoom:2.2,paint:{
            'line-color':color('--borders'),'line-width':.7
          }},'night');
        }
        map.addSource('observation-track',{type:'geojson',data:featureCollection(publishedLine(selectedMapReport()))});
        map.addLayer({id:'observation-track-line',source:'observation-track',type:'line',paint:{
          'line-color':color('--signal'),'line-width':2.4,'line-dasharray':[2,1]
        }});
        map.addSource('spc-outlook',{type:'geojson',data:currentOutlook?.areas || featureCollection()});
        map.addLayer({id:'spc-outlook-fill',source:'spc-outlook',type:'fill',paint:{'fill-color':['get','color'],'fill-opacity':.18}});
        map.addLayer({id:'spc-outlook-line',source:'spc-outlook',type:'line',paint:{'line-color':['get','color'],'line-width':1.5,'line-dasharray':[3,2]}});
        map.addSource('current-weather',{type:'geojson',data:weatherGeometry()});
        map.addLayer({id:'current-weather-fill',source:'current-weather',type:'fill',paint:{'fill-color':color('--geo'),'fill-opacity':0.2}});
        map.addLayer({id:'current-weather-outline',source:'current-weather',type:'line',paint:{'line-color':color('--geo'),'line-width':1}});
        map.addSource('selected-alert',{type:'geojson',data:selectedAlert()});
        map.addLayer({id:'selected-alert-fill',source:'selected-alert',type:'fill',paint:{'fill-color':color('--geo'),'fill-opacity':0.22}});
        map.addLayer({id:'selected-alert-outline',source:'selected-alert',type:'line',paint:{'line-color':color('--geo'),'line-width':2}});
        map.addSource('hotspots',{type:'geojson',data:hotspotGeo()});
        map.addLayer({id:'hotspot-rings',type:'circle',source:'hotspots',paint:{'circle-radius':['+',16,['*',7,['get','families']]],'circle-color':color('--hot'),'circle-opacity':['case',['==',['get','active'],1],0.28,0.12],'circle-stroke-color':color('--hot'),'circle-stroke-width':['case',['==',['get','active'],1],2.5,1.2],'circle-pitch-alignment':'map'}});
        map.on('click','hotspot-rings',ev=>{if(placementMode)return;const id=ev.features?.[0]?.properties?.id;if(id)toggleHotspot(id);});
        map.on('mouseenter','hotspot-rings',()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave','hotspot-rings',()=>{map.getCanvas().style.cursor='';});
        updateImagery = CapstoneMapImagery.attach(map,$('map-imagery-status'));
        mapReady=true;applyProjection();openMapScope();renderMap();locateLinkedReport();
        if (provinceAtlas) refreshProvinceLabels = CapstoneMapLabels.attachRegions(maplibregl.Marker,map,provinceAtlas.provinces,{
          minZoom:3,overview:()=>countryScope==='CA',selected:()=>provinceScope
        });
        // Country names (map-labels.js): the selected event's country, else the active hot spot's, is drawn largest.
        countryLabels=CapstoneMapLabels.attach(maplibregl.Marker,map,Object.values(countries),()=>{
          const report = selected && findEvent(selected);
          if (report && isLocated(report)) return {lon:report.lon,lat:report.lat,name:countries[report.country_code]?.name || report.place || ''};
          const spot = activeHotspot && hotspots.find(spot=>spot.id===activeHotspot);
          if (spot && Number.isFinite(spot.lat)) return {lon:spot.lon,lat:spot.lat,name:spot.name};
          return countries[countryScope] || null;
        },{
          focusOffset:30,
          clearable:()=>activeHotspot || provinceScope || placementMode ? null : countries[countryScope]?.name,
          onClear:()=>$('map-country-clear').click()
        });
      });
      // Theme switches repaint the map's own layers; markers and the SVG fallback follow the CSS tokens directly.
      Capstone.onTheme(()=>{if(!mapReady)return;const c=name=>getComputedStyle(document.body).getPropertyValue(name).trim();
        map.setPaintProperty('water','background-color',c('--water'));map.setPaintProperty('land','fill-color',c('--land'));map.setPaintProperty('borders','line-color',c('--borders'));usStateLayer?.repaint(c('--borders'),c('--signal'));
        if (map.getLayer('ca-province-fill')) {
          map.setPaintProperty('ca-province-fill','fill-color',c('--signal'));
          map.setPaintProperty('ca-province-borders','line-color',c('--borders'));
        }
        map.setPaintProperty('observation-track-line','line-color',c('--signal'));
        map.setPaintProperty('country-activity','fill-color',c('--signal'));
        map.setPaintProperty('focused-country','fill-color',c('--signal'));
        map.setPaintProperty('current-weather-fill','fill-color',c('--geo'));
        map.setPaintProperty('current-weather-outline','line-color',c('--geo'));
        map.setPaintProperty('selected-alert-fill','fill-color',c('--geo'));
        map.setPaintProperty('selected-alert-outline','line-color',c('--geo'));
        map.setPaintProperty('night','fill-color',c('--night-shade'));map.setPaintProperty('night','fill-opacity',Number(c('--night-alpha'))||0.5);
        map.setPaintProperty('hotspot-rings','circle-color',c('--hot'));map.setPaintProperty('hotspot-rings','circle-stroke-color',c('--hot'));});
      map.on('click',event=>{
        if (placementMode) { acceptPoint(event.lngLat.lng,event.lngLat.lat); return; }
        if (!mapReady) return;
        const layers = ['hotspot-rings','current-weather-fill','us-state-activity','ca-province-fill'].filter(layer=>map.getLayer(layer));
        const hits = layers.length ? map.queryRenderedFeatures(event.point,{layers}) : [];
        if (hits.some(feature=>feature.layer.id==='hotspot-rings')) return;
        const alert = hits.find(feature=>feature.layer.id==='current-weather-fill');
        if (alert?.properties.id) { selectEvent(alert.properties.id,true); return; }
        if (hits.some(feature=>feature.layer.id==='us-state-activity')) return;
        const province = hits.find(feature=>feature.layer.id==='ca-province-fill')?.properties.code;
        if (province) { chooseProvince(provinceScope===province?'':province); return; }
        const code = map.queryRenderedFeatures(event.point,{layers:['land']})[0]?.properties?.code;
        if (code && Object.hasOwn(countries,code)) chooseCountry(countryScope===code?'':code);
      });
      map.on('movestart',closePlacePreview);
      map.on('moveend',()=>{if(mapReady){renderMap();if(!replay.on)CapstoneDesks.update();}});
      map.on('projectiontransition',()=>{if(mapReady)renderMap();});
      map.on('error', e => { console.warn('Map renderer',e.error); if (!mapReady) enableFallback(); });
      setTimeout(() => { if (!mapReady) enableFallback(); },8000);
    } catch(error) { geographyUnavailable=!countryChoices.length; console.warn(error); enableFallback(); }
  }
  const fallbackMinWidth = 720 / 128;
  let fallbackView=desk?.fallback?.slice()||[0,0,720,360],drag=null,suppressMapClick=false;
  let fallbackScene = null;
  let fallbackPaint;
  function applyView(){
    const svg=$('map-fallback').querySelector('svg');
    if (svg) svg.setAttribute('viewBox',fallbackView.join(' '));
    if (!fallbackPaint && fallback) fallbackPaint = requestAnimationFrame(()=>{
      fallbackPaint = null;
      renderMap();
    });
  }
  function zoomFallback(factor,anchor){const [x,y,w,h]=fallbackView,nw=Math.max(fallbackMinWidth,Math.min(720,w/factor)),nh=nw/2,c=anchor||[x+w/2,y+h/2];fallbackView=[Math.max(0,Math.min(720-nw,c[0]-(c[0]-x)*nw/w)),Math.max(0,Math.min(360-nh,c[1]-(c[1]-y)*nh/h)),nw,nh];applyView();}
  function zoomFallbackAt([lon,lat], zoom) {
    const width = Math.max(fallbackMinWidth,Math.min(720,720 / Math.pow(2,zoom-1)));
    const height = width/2;
    fallbackView = [Math.max(0,Math.min(720-width,(lon+180)*2-width/2)),
      Math.max(0,Math.min(360-height,(90-lat)*2-height/2)),width,height];
    applyView();
  }
  $('map-zoom-in').onclick=()=>{if(fallback)zoomFallback(1.5);else if(mapReady)map.zoomIn();};
  $('map-zoom-out').onclick=()=>{if(fallback)zoomFallback(1/1.5);else if(mapReady)map.zoomOut();};
  $('map-fallback').addEventListener('wheel',e=>{const svg=$('map-fallback').querySelector('svg');if(!svg)return;e.preventDefault();const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const p=point.matrixTransform(svg.getScreenCTM().inverse());zoomFallback(e.deltaY<0?1.2:1/1.2,[p.x,p.y]);},{passive:false});
  $('map-fallback').addEventListener('pointerdown',e=>{if(placementMode||e.button!==0)return;const svg=$('map-fallback').querySelector('svg');if(!svg)return;const m=svg.getScreenCTM();drag={x:e.clientX,y:e.clientY,view:[...fallbackView],scale:m.a};suppressMapClick=false;});
  $('map-fallback').addEventListener('pointermove',e=>{if(!drag)return;const dx=(e.clientX-drag.x)/drag.scale,dy=(e.clientY-drag.y)/drag.scale;if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4){suppressMapClick=true;$('map-fallback').setPointerCapture(e.pointerId);}fallbackView=[Math.max(0,Math.min(720-drag.view[2],drag.view[0]-dx)),Math.max(0,Math.min(360-drag.view[3],drag.view[1]-dy)),drag.view[2],drag.view[3]];applyView();});
  for(const event of ['pointerup','pointercancel'])$('map-fallback').addEventListener(event,()=>{drag=null;});
  $('map-fallback').addEventListener('click',e=>{if(suppressMapClick){e.stopImmediatePropagation();suppressMapClick=false;}},true);
  function openMapScope() {
    if (openingCamera && countryScope && !countryCamera) countryCamera = fallback ? {view:[0,0,720,360]} :
      {center:[15,22],zoom:1.25,bearing:0,pitch:0};
    if (fallback && sharedCamera) {
      zoomFallbackAt(sharedCamera.center,sharedCamera.zoom);
      return;
    }
    if (openingCamera) return;
    if (stateScope) chooseState(stateScope);
    else if (provinceScope) {
      const province = provinceScope;
      countryScope = '';
      chooseProvince(province);
    } else if (countryScope) {
      const country = countryScope;
      countryScope = '';
      chooseCountry(country);
    }
  }
  function enableFallback() { if (fallback) return; fallback=true; mapReady=false; markerCache.clear(); map?.remove(); $('map').hidden=true; $('map-fallback').hidden=false; $('reset-map').disabled=false;  $('projection-toggle').disabled=true; $('projection-toggle').title='Globe view needs WebGL'; imageryControl.disabled=true; imageryControl.title='Weather imagery needs the interactive map'; openMapScope(); renderMap(); locateLinkedReport(); }
  function renderFallback() {
    const host = $('map-fallback');
    if (!worldPaths) {
      host.innerHTML = '<div class="empty-state">World geometry could not load. Event details and timeline remain available.</div>';
      return;
    }
    if (!fallbackScene) {
      const paths = worldPaths.map((d,index)=>{
        const code = world?.features[index]?.properties.code || '';
        return `<path class="fallback-land" data-country="${esc(code)}" d="${esc(d)}"/>`;
      }).join('');
      host.innerHTML = `<svg class="fallback-svg" viewBox="${fallbackView.join(' ')}" aria-label="World map, simplified renderer">
        <g>${paths}</g><g class="fallback-states"></g><g class="fallback-provinces"></g><path class="fallback-night"></path><g class="fallback-outlook"></g><g class="fallback-weather"></g><path class="fallback-track"></path><path class="fallback-alert"></path><g class="fallback-rings"></g><g class="fallback-labels"></g><g class="fallback-markers"></g>
        </svg><span class="fallback-message">Simplified map · Natural Earth</span>`;
      fallbackScene = {
        svg: host.querySelector('svg'),
        night: host.querySelector('.fallback-night'),
        states: host.querySelector('.fallback-states'),
        provinces: host.querySelector('.fallback-provinces'),
        alert: host.querySelector('.fallback-alert'),
        weatherAreas: host.querySelector('.fallback-weather'),
        track: host.querySelector('.fallback-track'),
        outlook: host.querySelector('.fallback-outlook'),
        rings: host.querySelector('.fallback-rings'),
        labels: host.querySelector('.fallback-labels'),
        markers: host.querySelector('.fallback-markers'),
        ringMarkup: '', markerMarkup: '', nightTime: null
      };
      new ResizeObserver(applyView).observe(host);
    }
    const unitsPerPixel = 1 / Math.max(.001,Math.min(
      fallbackScene.svg.clientWidth / fallbackView[2],fallbackScene.svg.clientHeight / fallbackView[3]
    ));
    const point = ([lon, lat]) => [((lon + 180) * 2).toFixed(2), ((90 - lat) * 2).toFixed(2)];
    const pathFor = geometry => {
      const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || [];
      return polygons.map(polygon=>polygon.map(ring=>'M'+ring.map(point).join('L')+'Z').join('')).join('');
    };
    const activityKey = countryScope + '|' + (countryActivity.checked ?
      [...countryCounts].sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>code+':'+count).join(',') : '');
    if (fallbackScene.country !== activityKey) {
      fallbackScene.country = activityKey;
      host.querySelectorAll('.fallback-land').forEach(path=>{
        path.classList.toggle('geo-focused',!!countryScope && path.dataset.country===countryScope);
        const count = countryActivity.checked ? countryCounts.get(path.dataset.country) || 0 : 0;
        if (count) path.style.setProperty('--activity-strength',Math.min(48,6+count*1.2)+'%');
        else path.style.removeProperty('--activity-strength');
      });
    }
    const states = fallbackScene.states;
    if (fallbackScene.stateAtlas!==stateAtlas && stateAtlas?.areas) {
      fallbackScene.stateAtlas = stateAtlas;
      const names = new Map(stateAtlas.states.map(({code,name})=>[code,name]));
      states.innerHTML = stateAtlas.areas.features.map(({geometry,properties:{code}})=>
        `<path class="fallback-state" data-state="${esc(code)}" d="${pathFor(geometry)}"><title>${esc(names.get(code))}</title></path>`
      ).join('');
    }
    states.style.display = stateScope || fallbackView[2]<=313 ? '' : 'none';
    const stateCounts = geographyActivity?.counts;
    if (fallbackScene.state !== stateScope || fallbackScene.stateCounts !== stateCounts) {
      fallbackScene.state = stateScope;
      fallbackScene.stateCounts = stateCounts;
      for (const path of states.children) {
        const code = path.dataset.state;
        const count = stateCounts?.get(code) || 0;
        path.classList.toggle('geo-focused',code===stateScope);
        path.style.setProperty('--state-activity',count ? Math.min(.32,.13+(count-1)*.014) : .0);
      }
    }
    const provinces = fallbackScene.provinces;
    if (fallbackScene.provinceAtlas!==provinceAtlas && provinceAtlas?.areas) {
      fallbackScene.provinceAtlas=provinceAtlas;
      provinces.innerHTML=provinceAtlas.areas.features.map(({geometry,properties:{code,name}})=>
        `<path class="fallback-state" data-province="${code}" d="${pathFor(geometry)}"><title>${esc(name)}</title></path>`
      ).join('');
    }
    provinces.style.display = countryScope==='CA' || fallbackView[2]<=300 ? '' : 'none';
    const provinceCounts = geographyActivity?.provinces;
    if (fallbackScene.province!==provinceScope || fallbackScene.provinceCounts!==provinceCounts) {
      fallbackScene.province=provinceScope;
      fallbackScene.provinceCounts=provinceCounts;
      for (const path of provinces.children) {
        const code = path.dataset.province;
        const count = provinceCounts?.get(code) || 0;
        path.classList.toggle('geo-focused',code===provinceScope);
        path.style.setProperty('--state-activity',count ? Math.min(.32,.13+(count-1)*.014) : 0);
      }
    }
    const weatherKey = currentWeather.map(report=>report.id+':'+(report.weather_geometry_revision || report.revision)).join('|');
    if (fallbackScene.currentWeather !== weatherKey) {
      fallbackScene.currentWeather = weatherKey;
      fallbackScene.weatherAreas.innerHTML = currentWeather.map(report=>
        `<path class="fallback-weather-item" data-map-event="${esc(report.id)}" d="${pathFor(report.weather_area)}"><title>${esc(report.title)}</title></path>`
      ).join('');
    }
    if (fallbackScene.outlookData !== currentOutlook) {
      fallbackScene.outlookData = currentOutlook;
      fallbackScene.outlook.innerHTML = (currentOutlook?.areas.features || []).map(feature=>
        `<path style="--outlook-color:${esc(feature.properties.color)}" d="${pathFor(feature.geometry)}"><title>${esc(feature.properties.name)} severe-weather risk</title></path>`).join('');
    }
    const track = publishedLine(selectedMapReport());
    if (track !== fallbackScene.observationTrack) {
      const segments = track?.type==='LineString' ? [track.coordinates] : track?.coordinates || [];
      fallbackScene.observationTrack = track;
      fallbackScene.track.setAttribute('d',segments.map(line=>'M'+line.map(point).join('L')).join(''));
    }
    const weather = selectedArea();
    if (fallbackScene.weather !== weather) {
      fallbackScene.weather = weather;
      fallbackScene.alert.setAttribute('d',pathFor(weather));
    }
    renderFallbackLabels(point,unitsPerPixel);
    const points = mapEvents;
    const groups=new Map();for(const row of points){const key=`${row.lon.toFixed(2)},${row.lat.toFixed(2)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    const shapes = {
      diamond:'<path d="M0 -6 L5 0 L0 6 L-5 0Z"/>',
      triangle:'<path d="M0 -6 L6 5 L-6 5Z"/>',
      square:'<rect x="-4.5" y="-4.5" width="9" height="9" rx="1"/>',
      ring:'<circle r="5" class="fallback-ring-shape"/>',
      dot:'<circle r="4"/>'
    };
    const dots = [...groups.values()].map(group=>group.map((report,index)=>{
      const anchor = point([report.lon,report.lat]).map(Number);
      const radius = group.length>1 ? Math.min(16,7+group.length)*unitsPerPixel : 0;
      const angle = index*2*Math.PI/group.length;
      const position = [anchor[0]+radius*Math.cos(angle),anchor[1]+radius*Math.sin(angle)];
      const style = T.describe(report);
      const linked = mappedLink?.id===report.id;
      const label = (linked?'Linked report · ':'') + report.title + ' · ' + T.placement(report);
      const reference = T.referencePlacement(report) ? '<circle class="fallback-reference-ring" r="8"/>' : '';
      return (radius ? `<path class="fallback-link" d="M${anchor}L${position}"/>` : '') +
        `<g class="fallback-point${selected===report.id||linked?' selected':''}${linked?' linked-marker':''}" transform="translate(${position}) scale(${unitsPerPixel.toFixed(5)})"
          style="--tone:var(--${style.tone})" role="button" tabindex="0" data-map-event="${esc(report.id)}" aria-label="${esc(label)}">
          <title>${esc(label)}</title>${reference}${shapes[style.shape]}
        </g>`;
    }).join('')).join('');
    fallbackScene.night.style.display = nightShading.checked ? '' : 'none';
    const nightTime = replay.on ? replayTime() : Math.floor(Date.now() / 300_000) * 300_000;
    if (fallbackScene.nightTime !== nightTime) {
      fallbackScene.nightTime = nightTime;
      const path = nightGeo(new Date(nightTime)).geometry.coordinates[0].map(([lon, lat]) => point([lon, Math.max(-90, Math.min(90, lat))]));
      fallbackScene.night.setAttribute('d', 'M' + path.join('L') + 'Z');
    }
    const rings=(replay.on?[]:hotspots).filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lon)).map(h=>{const [x,y]=point([h.lon,h.lat]);return `<circle class="fallback-hotspot" cx="${x}" cy="${y}" r="${(6+3*h.families.length)*unitsPerPixel}" data-hotspot="${esc(h.id)}" stroke-width="${h.id===activeHotspot?2:.8}"><title>Hot spot: ${esc(h.name)}</title></circle>`;}).join('');
    if (fallbackScene.ringMarkup !== rings) {
      fallbackScene.ringMarkup = rings;
      fallbackScene.rings.innerHTML = rings;
    }
    if (fallbackScene.markerMarkup !== dots) {
      const focus = fallbackScene.markers.contains(document.activeElement) && document.activeElement.dataset.mapEvent;
      fallbackScene.markerMarkup = dots;
      fallbackScene.markers.innerHTML = dots;
      if (focus) fallbackScene.markers.querySelector('[data-map-event="' + CSS.escape(focus) + '"]')?.focus({ preventScroll: true });
    }
  }
  function renderFallbackLabels(point,unitsPerPixel) {
    const clearCountry = activeHotspot || provinceScope || placementMode ? '' : countryScope;
    const labelKey = [fallbackView.join(','),unitsPerPixel.toFixed(4),countryScope,stateScope,provinceScope,clearCountry].join('|');
    if (fallbackScene.labelKey===labelKey && fallbackScene.labelCounts===countryCounts) return;
    fallbackScene.labelKey = labelKey;
    fallbackScene.labelCounts = countryCounts;
    const [left,top,width,height] = fallbackView;
    const showStates = Boolean(stateScope || width<=300);
    const showProvinces = countryScope==='CA' || width<=245;
    const labels = [
      ...(showStates ? (stateAtlas?.states || []).map(place=>({...place,region:true,active:place.code===stateScope})) : []),
      ...(showProvinces ? (provinceAtlas?.provinces || []).map(place=>({...place,region:true,active:place.code===provinceScope})) : []),
      ...countryChoices.filter(([code])=>code===clearCountry || (!(code==='US' && showStates) && !(code==='CA' && showProvinces)))
        .map(([code,place])=>({...place,code,clear:code===clearCountry,active:code===countryScope,count:countryCounts.get(code) || 0}))
    ].sort((a,b)=>Number(b.active)-Number(a.active) || Number(Boolean(b.region))-Number(Boolean(a.region)) ||
      (b.count || 0)-(a.count || 0));
    const positioned = [];
    for (const place of labels) {
      const [x,baseY] = point([place.lon,place.lat]).map(Number);
      const y = baseY + (place.clear ? 20*unitsPerPixel : 0);
      if (x<left || x>left+width || y<top || y>top+height) continue;
      const label = place.region && width>118 && !place.active ? place.code : place.name;
      const font = (place.active ? 12 : 10)*unitsPerPixel;
      const half = label.length*font*.27;
      if (positioned.some(previous=>Math.abs(previous.x-x)<previous.half+half+font*.4 &&
        Math.abs(previous.y-y)<font*1.24)) continue;
      const clear = place.clear ? ' class="active clear-focus" data-clear-country="'+esc(place.code)+
        '" role="button" tabindex="0" aria-label="Clear '+esc(place.name)+' focus"' : place.active ? ' class="active"' : '';
      positioned.push({x,y,half,markup:'<text x="'+x+'" y="'+y+'" font-size="'+font.toFixed(3)+'"'+clear+
        '>'+esc(label+(place.clear ? ' ×' : ''))+'</text>'});
    }
    fallbackScene.labels.innerHTML = positioned.map(label=>label.markup).join('');
  }
  $('map-fallback').addEventListener('click',event=>{
    if (placementMode) {
      const svg = fallbackScene?.svg;
      if (!svg) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const {x,y} = point.matrixTransform(svg.getScreenCTM().inverse());
      const lon = x/2-180, lat = 90-y/2;
      if (Math.abs(lon)<=180 && Math.abs(lat)<=90) acceptPoint(lon,lat);
      return;
    }
    const target = event.target;
    const spot = target.closest('[data-hotspot]')?.dataset.hotspot;
    if (spot) return toggleHotspot(spot);
    const report = target.closest('[data-map-event]')?.dataset.mapEvent;
    if (report) return openMapEvent(report);
    if (target.closest('[data-clear-country]')) return $('map-country-clear').click();
    const state = target.closest('[data-state]')?.dataset.state;
    if (state) return chooseState(stateScope===state?'US':state);
    const province = target.closest('[data-province]')?.dataset.province;
    if (province) return chooseProvince(provinceScope===province?'':province);
    const country = target.closest('[data-country]')?.dataset.country;
    if (country) chooseCountry(countryScope===country?'':country);
  });
  $('map-fallback').addEventListener('keydown',event=>{
    if (!['Enter',' '].includes(event.key)) return;
    if (event.target.closest('[data-clear-country]')) {
      event.preventDefault();
      $('map-country-clear').click();
      return;
    }
    const id = event.target.closest('[data-map-event]')?.dataset.mapEvent;
    if (id) { event.preventDefault(); openMapEvent(id); }
  });
  // The source link opens the original report; anywhere else on a card selects the story.
  $('timeline').addEventListener('click', event => {
    const reportButton = event.target.closest('[data-timeline-report]');
    if (reportButton) {
      const story = findEvent(reportButton.dataset.timelineReport);
      if (!story) return;
      const reports = members(story);
      void CapstoneReports.open(reports.find(report=>report.id===story.representative_id) || reports[0],reports);
      return;
    }
    if (event.target.closest('a')) return;
    const id = event.target.closest('[data-event]')?.dataset.event;
    if (id) selectEvent(id,true);
  });
  document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category; document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
  $('event-search').oninput = e => {query=e.target.value.trim().toLowerCase();render();};
  for (const [id,showCurrent] of [['ops-recent-reports',false],['ops-current-reports',true]]) {
    $(id).onclick=()=>{
      const value = showCurrent ? 'active' : recentPeriod;
      if (timeWindow.value===value) return;
      timeWindow.value = value;
      timeWindow.dispatchEvent(new Event('change',{bubbles:true}));
    };
  }
  timeWindow.onchange=()=>{
    replay.restoreActive = false;
    if (replay.on && $('time-window').value==='active') { stopReplay(); return; }
    closePlacePreview();
    render();
  };
  timeBasis.onchange=()=>{closePlacePreview();render();};
  $('platform-filter').onchange=e=>{sourceFilter=e.target.value;render();};
  storyEvidence.onchange = render;
  primaryFilter.onclick=()=>{
    storyEvidence.value = storyEvidence.value==='primary' ? 'all' : 'primary';
    storyEvidence.dispatchEvent(new Event('change',{bubbles:true}));
  };
  $('type-filter').value=typeFilter;if($('type-filter').value!==typeFilter){typeFilter='all';$('type-filter').value='all';}
  $('type-filter').onchange=e=>{
    typeFilter=e.target.value;
    if (!CapstoneDesks.active()) {
      try { localStorage.setItem('capstone-ops-type',typeFilter); } catch {}
    }
    render();
  };
  $('watch-only').onchange=render;
  $('reset-map').onclick=()=>{
    chooseState('',false);
    if(fallback){fallbackView=[0,0,720,360];applyView();}
    else if(mapReady)map.easeTo({center:[15,22],zoom:1.25,bearing:0,pitch:0,duration:reducedMotion()?0:450});
  };
  $('map-us').onclick=()=>chooseState('US');
  const mapExpand = $('map-expand');
  function expandMap(expanded) {
    mapExpand.setAttribute('aria-pressed',String(expanded));
    mapExpand.textContent = expanded ? 'Compact map' : 'Expand map';
    mapExpand.closest('.ops-grid').classList.toggle('map-expanded',expanded);
    if (mapReady) {
      map.resize();
      countryLabels?.refresh();
      usStateLayer?.refresh();
      renderMap();
    }
  }
  mapExpand.onclick=()=>expandMap(mapExpand.getAttribute('aria-pressed')!=='true');
  $('map-state-clear').onclick=()=>{
    chooseState(stateScope==='US'?'':'US');
    statePicker.focus({preventScroll:true});
  };
  const placeDialog = $('map-place-dialog');
  const placeQuery = $('map-place-query');
  const placeResults = $('map-place-results');
  const placeLevel = $('map-place-level');
  const placeOrder = $('map-place-order');
  const normalizePlace = value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const countryAliases = {US:['usa','u s a','united states of america'],GB:['uk','u k','great britain'],
    AE:['uae','u a e'],NZ:['aotearoa']};
  let placeOptions = '';
  function renderPlaceSearch() {
    const query = normalizePlace(placeQuery.value);
    const cutoff = inWindow($('time-window').value);
    const activity = mapGeography(replay.on ? replay.start : cutoff, replay.on ? replayTime() : Infinity);
    const dateLabel = activity.received ? 'Latest receipt' : 'Latest source date';
    placeOrder.options[1].textContent = dateLabel;
    const states = [{name:'U.S. states and territories',code:'US'},...(stateAtlas?.states || [])];
    const rows = [
      ...countryChoices.map(([code,{name}])=>({code,name,kind:'country',count:activity.countriesInWindow.get(code) || 0})),
      ...states.map(({code,name})=>({code,name,kind:'state',count:code==='US' ? activity.usCount : activity.counts.get(code) || 0})),
      ...(provinceAtlas?.provinces || []).map(({code,name})=>({code,name,kind:'province',count:activity.provinces.get(code)||0}))
    ].filter(row=>!placeLevel.value || (placeLevel.value==='saved' ? savedPlaces.has(row.kind+':'+row.code) : row.kind===placeLevel.value)).map(row=>{
      const name = normalizePlace(row.name);
      const code = row.code.toLowerCase();
      const regionCode = row.kind==='province' ? 'ca '+code : row.kind==='state' && code!=='us' ? 'us '+code : code;
      const alternative = row.kind==='country' && countryAliases[row.code]?.includes(query);
      const rank = !query || query===code || query===name || query===regionCode || alternative ? 0 :
        name.startsWith(query) ? 1 : name.includes(query) ? 2 : Infinity;
      return {...row,rank,latest:activity.latest.get(row.kind+':'+row.code)};
    }).filter(row=>Number.isFinite(row.rank));
    const sort = placeOrder.value==='count' ? (a,b)=>b.count-a.count :
      placeOrder.value==='latest' ? (a,b)=>(b.latest?.date || 0)-(a.latest?.date || 0) : ()=>0;
    rows.sort((a,b)=>a.rank-b.rank || sort(a,b) || a.name.localeCompare(b.name));
    const options = rows.slice(0,10).map(({name,code,kind,count,latest})=>{
      const active = code===(kind==='state' ? stateScope : kind==='province' ? provinceScope : countryScope);
      const context = kind==='state' ? 'U.S. state or territory' : kind==='province' ? 'Canadian province or territory' : 'Country or territory';
      const label = kind==='province' ? 'CA-'+code : kind==='state' && code!=='US' ? 'US-'+code : code;
      return '<li><button type="button" data-place-kind="'+kind+'" data-place-code="'+esc(code)+'"'+
        (active ? ' aria-current="true"' : '')+'><strong>'+esc(name)+'</strong><small>'+esc(context)+' · '+esc(label)+
        ' · '+count+(count===1 ? ' story' : ' stories')+'</small>'+
        (latest ? '<small>'+dateLabel+' · '+esc(ageLabel(latest.ts,latest.precision))+'</small>' : '')+'</button></li>';
    }).join('');
    if (options!==placeOptions) {
      placeOptions = options;
      placeResults.innerHTML = options;
    }
    const status = $('map-place-status');
    const shown = rows.length>10 ? 'Showing 10 of ' + rows.length + ' places' : rows.length + (rows.length===1 ? ' place' : ' places');
    const period = replay.on ? 'Replay through '+$('replay-time').textContent : $('time-window').selectedOptions[0].textContent;
    const message = rows.length ? shown+' · '+period : placeLevel.value==='saved' && !savedPlaces.size ?
      'Open a place and choose Save place in its Sources panel.' : countryChoices.length ? 'No matching places' :
      geographyUnavailable ? 'Place search is unavailable' : 'Loading places…';
    if (status.textContent!==message) status.textContent=message;
  }
  $('map-find-place').onclick=()=>{
    placeQuery.value='';
    renderPlaceSearch();
    placeDialog.showModal();
  };
  $('map-place-close').onclick=()=>placeDialog.close();
  placeQuery.oninput=renderPlaceSearch;
  placeLevel.onchange=placeOrder.onchange=renderPlaceSearch;
  placeQuery.onkeydown=event=>{
    if (!['ArrowDown','Enter'].includes(event.key)) return;
    const first = placeResults.querySelector('button');
    if (!first) return;
    event.preventDefault();
    if (event.key==='Enter' && placeResults.children.length===1) first.click();
    else first.focus();
  };
  placeResults.onkeydown=event=>{
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    const list = [...placeResults.querySelectorAll('button[data-place-kind]')];
    const index = list.indexOf(event.target.closest('button'));
    if (index<0) return;
    event.preventDefault();
    const target = event.key==='Home' ? list[0] : event.key==='End' ? list.at(-1) :
      event.key==='ArrowDown' ? list[index+1] : list[index-1] || placeQuery;
    target?.focus();
  };
  placeResults.onclick=event=>{
    const button=event.target.closest('button[data-place-kind]');
    if (!button) return;
    placeDialog.close();
    if (button.dataset.placeKind==='state') chooseState(button.dataset.placeCode);
    else if (button.dataset.placeKind==='province') chooseProvince(button.dataset.placeCode);
    else if (countryScope!==button.dataset.placeCode || provinceScope) chooseCountry(button.dataset.placeCode);
  };
  statePicker.onchange=()=>chooseState(statePicker.value);
  statePicker.addEventListener('blur',()=>renderStates());
  countryPicker.onchange = ()=>chooseCountry(countryPicker.value);
  countryPicker.addEventListener('blur',()=>renderStates());
  provincePicker.onchange = ()=>chooseProvince(provincePicker.value);
  provincePicker.addEventListener('blur',()=>renderProvinces(inWindow($('time-window').value)));
  $('map-country-clear').onclick = ()=>{
    if (provinceScope) { chooseProvince(''); provincePicker.focus({preventScroll:true}); }
    else { chooseCountry(''); countryPicker.focus({preventScroll:true}); }
  };
  $('map-copy-view').onclick = async () => {
    const url = new URL('/ops',location.origin);
    const sharedView = {
      projection,period:$('time-window').value,basis:timeBasis.value,category,type:typeFilter,evidence:storyEvidence.value,
      source:sourceFilter,q:$('event-search').value.trim().slice(0,250),watch:Number($('watch-only').checked),
      includeMuted:Number($('ops-show-muted').checked),extent:mapExtent.value,order:mapOrder.value,markers:mapLimit.value,
      placement:placement.value,activity:Number(countryActivity.checked),night:Number(nightShading.checked),
      imagery:imageryControl.value,outlook:outlookControl.value,weatherAreas:Number(weatherAreas.checked),...(stateScope ? {state:stateScope} : {country:countryScope,province:provinceScope})
    };
    for (const [key,value] of Object.entries(sharedView)) url.searchParams.set(key,value);
    if (mappedLink && !replay.on) {
      url.searchParams.set('event',mappedLink.id);
      url.searchParams.set('show','map');
    } else if (selectedReport && !replay.on) url.searchParams.set('event',selectedReport);
    const current = mapReady ? [...map.getCenter().toArray(),map.getZoom(),map.getBearing(),map.getPitch()] :
      fallback ? [(fallbackView[0]+fallbackView[2]/2)/2-180,90-(fallbackView[1]+fallbackView[3]/2)/2,
        Math.log2(720/fallbackView[2])+1,0,0] : [];
    if (current.length) url.searchParams.set('camera',current.map((value,index)=>Number((index===0 ? ((value+540)%360)-180 : value).toFixed(4))).join(','));
    const status = $('map-copy-status');
    try {
      await navigator.clipboard.writeText(url.href);
      status.textContent = 'Map link copied';
    } catch {
      const input = document.createElement('input');
      input.type = 'url';
      input.readOnly = true;
      input.value = url.href;
      input.setAttribute('aria-label','Map view link');
      status.replaceChildren(input);
      input.focus();
      input.select();
    }
  };
  $('map-export').onclick=()=>{
    const at = new Date().toISOString();
    const file = CapstoneMapExport.featureCollection(mapEvents,currentWeather,{
      exported_at:at,live_connected:liveConnected,basis:replay.on ? 'source' : timeBasis.value,period:$('time-window').value,
      replay_at:replay.on ? new Date(replayTime()).toISOString() : null,
      live_marker_limit:replay.on ? null : liveMarkerLimit(),
      country:countryScope || null,state:stateScope || null,province:provinceScope || null
    },currentOutlook);
    if (!file.features.length) return;
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(file,null,2) + '\n'],{type:'application/geo+json'}));
    link.href = url;
    link.download = 'capstone-map-'+at.slice(0,19).replaceAll(':','-')+'Z.geojson';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('map-copy-status').textContent = 'Exported '+file.features.length+(file.features.length===1 ? ' feature' : ' features');
  };
  $('restore-hidden').onclick=()=>{hidden.clear();persist();render();};
  $('refresh').onclick = async () => {
    manualRefresh = true;
    updateRefreshControl();
    const previous = feedStatusData;
    const feedback = $('refresh-feedback');
    delete feedback.dataset.polling;
    feedback.textContent = 'Checking which feeds are due…';
    try {
      const result = await api('/api/refresh', 'POST');
      if (result.refreshing) {
        if (feedStatusData !== previous && !feedStatusData.refreshing) {
          feedback.textContent = 'Refresh finished. Check Feeds for poll results.';
          return;
        }
        feedback.dataset.polling = '1';
        if (feedStatusData === previous) feedStatusData = {...previous, refreshing:true};
        feedback.textContent = result.count ? 'Polling ' + result.count + (result.count === 1 ? ' feed' : ' feeds') : 'Refresh is already running.';
      } else if (result.nextPoll) {
        const next = new Date(result.nextPoll).toISOString().slice(11,19);
        feedback.textContent = 'No feeds due. Next at ' + next + ' UTC.';
      } else {
        feedback.textContent = 'No feeds available to poll.';
      }
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      manualRefresh = false;
      updateRefreshControl();
    }
  };
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
  const params=viewParams;sourceFilter=params.get('source')||sourceFilter;selectedReport=linkedReportId;$('watch-only').checked=params.has('watch')?params.get('watch')==='1':desk?.watchOnly||false;const range=params.get('period')||desk?.period;if([...$('time-window').options].some(option=>option.value===range))$('time-window').value=range;
  if (['all','cyber','geo','ai'].includes(params.get('category'))) category=params.get('category');
  $('event-search').value=params.has('q') ? (params.get('q') || '').slice(0,250) : desk?.query || '';
  query=$('event-search').value.trim().toLowerCase();
  document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
  if(desk?.diagnostics)$('ops-diagnostics').click();$('feed-health-panel').open=desk?.health||false;
  $('hotspots').addEventListener('click',e=>{const id=e.target.closest('[data-hotspot]')?.dataset.hotspot;if(id)toggleHotspot(id);});
  $('status-tiles').addEventListener('click',e=>{const id=e.target.closest('[data-status]')?.dataset.status;if(!id)return;openStatus=openStatus===id?null:id;renderStatus();});
  $('clear-hotspot').onclick=()=>clearHotspot();
  $('map-hotspot-clear').onclick=()=>clearHotspot();
  $('map-linked-clear').onclick=()=>{
    clearMappedLink();
    render();
    $('locate-linked-report').focus({preventScroll:true});
  };
  document.querySelector('.map-panel').addEventListener('keydown',event=>{
    if (event.key !== 'Escape' || placementMode) return;
    if (replay.on) { event.preventDefault(); stopReplay(); }
    else if (mappedLink) { event.preventDefault(); $('map-linked-clear').click(); }
    else if (activeHotspot) { event.preventDefault(); clearHotspot(); }
    else if (countryScope) { event.preventDefault(); $('map-country-clear').click(); }
    else if (stateScope) { event.preventDefault(); $('map-state-clear').click(); }
    else if (mapExpand.getAttribute('aria-pressed')==='true') { event.preventDefault(); expandMap(false); }
  });
  $('outage-list').addEventListener('click',e=>{const id=e.target.closest('[data-event]')?.dataset.event;if(id)selectEvent(id,true);});
  $('projection-toggle').onclick=()=>{projection=projection==='globe'?'mercator':'globe';if(!CapstoneDesks.active())save('capstone-projection',projection);applyProjection();};
  $('replay-toggle').onclick=()=>replay.on?stopReplay():startReplay();
  $('replay-play').onclick=()=>replay.timer?pauseReplay():playReplay();
  $('replay-slider').oninput=e=>{pauseReplay();replay.minute=Number(e.target.value);renderReplay();};
  onPulse(renderPulse);applyProjection();
  const readingControls=document.createElement('div');readingControls.className='ops-reading-controls';readingControls.innerHTML='<label><input type="checkbox" id="ops-show-muted"> Include muted reports</label><a href="/timeline">Source roles & noise controls ↗</a><small>View-only mutes. Status and alerts still use all sources.</small>';document.querySelector('.ops-filter-fields').append(readingControls);$('ops-show-muted').checked=linkFlag('includeMuted',desk?.includeMuted===true);$('ops-show-muted').onchange=render;
  const moreFilters = $('ops-more-filters');
  function renderMonitorFilters() {
    const listed = timeWindow.value==='active';
    if (!listed && !replay.on) recentPeriod = timeWindow.value;
    $('ops-recent-reports').setAttribute('aria-pressed',String(!listed));
    $('ops-current-reports').setAttribute('aria-pressed',String(listed));
    $('ops-report-range').hidden = listed;
    primaryFilter.setAttribute('aria-pressed',String(storyEvidence.value==='primary'));
    const active = Number(sourceFilter !== 'all') + Number(typeFilter !== 'all') + Number(storyEvidence.value !== 'all') + Number($('watch-only').checked) + Number($('ops-show-muted').checked);
    const badge = $('ops-filter-count');
    badge.textContent = active ? active + ' active' : '';
    badge.hidden = !active;
    return active;
  }
  if (renderMonitorFilters()) moreFilters.open = true;
  CapstoneDesks.register('ops',()=>({category,source:sourceFilter,evidence:storyEvidence.value,type:typeFilter,includeMuted:$('ops-show-muted').checked,query:$('event-search').value,period:$('time-window').value,basis:timeBasis.value,mapPlacement:placement.value,mapExtent:mapExtent.value,mapOrder:mapOrder.value,mapLimit:mapLimit.value,imagery:imageryControl.value,outlook:outlookControl.value,weatherAreas:weatherAreas.checked,countryActivity:countryActivity.checked,nightShading:nightShading.checked,watchOnly:$('watch-only').checked,balance:Number($('ops-balance').value),projection,diagnostics:!$('ops-situation').hidden,health:$('feed-health-panel').open,state:stateScope,country:countryScope,province:provinceScope,camera:mapReady?{center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}:desk?.camera||null,fallback:fallbackView.slice()}));
  let deskTimer;const saveDesk=()=>{clearTimeout(deskTimer);deskTimer=setTimeout(()=>CapstoneDesks.update(),200);};
  for(const id of ['event-search','ops-balance'])$(id).addEventListener('input',saveDesk);
  for(const id of ['time-window','time-basis','platform-filter','story-evidence','type-filter','watch-only','ops-show-muted'])$(id).addEventListener('change',saveDesk);
  for(const selector of ['[data-category]','#ops-diagnostics','#projection-toggle','#map-zoom-in','#map-zoom-out','#reset-map'])document.querySelectorAll(selector).forEach(b=>b.addEventListener('click',saveDesk));
  $('ops-network-jump').onclick = () => {
    if ($('ops-situation').hidden) $('ops-diagnostics').click();
  };
  $('ops-collectors-jump').onclick = () => { $('feed-health-panel').open = true; };
  function revealSection() {
    if (location.hash === '#ops-situation' && $('ops-situation').hidden) $('ops-diagnostics').click();
    if (location.hash === '#feed-health-panel') $('feed-health-panel').open = true;
    if (location.hash === '#ops-status') $('ops-status').open = true;
    if (['#ops-situation','#feed-health-panel','#ops-status'].includes(location.hash)) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
  window.addEventListener('hashchange',revealSection);
  revealSection();
  $('reset-monitor-filters').onclick = () => {
    category = sourceFilter = typeFilter = 'all';
    stateScope = countryScope = provinceScope = '';
    countryCamera = null;
    statePicker.value = countryPicker.value = provincePicker.value = '';
    query = '';
    activeHotspot = hotspotFilter = null;
    windowBeforeHotspot = cameraBeforeHotspot = null;
    stateBeforeHotspot = countryBeforeHotspot = provinceBeforeHotspot = '';
    $('event-search').value = '';
    $('platform-filter').value = 'all';
    $('type-filter').value = 'all';
    storyEvidence.value = 'all';
    timeWindow.value = defaultRecentPeriod;
    timeBasis.value = 'source';
    $('watch-only').checked = false;
    $('ops-show-muted').checked = false;
    document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === 'all')));
    if (!CapstoneDesks.active()) {
      try { localStorage.setItem('capstone-ops-type','all'); } catch {}
    }
    renderHotspots();
    render();
    saveDesk();
  };
  for (const [control,key] of [[mapExtent,'extent'],[mapOrder,'order']]) control.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-map-'+key,control.value);
    renderMap();
    saveDesk();
  };
  countryActivity.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-map-country-activity',countryActivity.checked);
    renderMap();
    saveDesk();
  };
  nightShading.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-map-night-shading',nightShading.checked);
    if (mapReady && map.getLayer('night')) map.setLayoutProperty('night','visibility',nightShading.checked?'visible':'none');
    renderMap();
    saveDesk();
  };
  mapLimit.onchange=()=>{
    if (!CapstoneDesks.active()) save('capstone-map-markers',mapLimit.value);
    renderMap();
    saveDesk();
  };
  moreMarkers.onclick=()=>{
    const next = [...mapLimit.options].find(option=>Number(option.value)>liveMarkerLimit());
    if (!next) return;
    mapLimit.value = next.value;
    mapLimit.dispatchEvent(new Event('change'));
  };
  imageryControl.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-map-imagery',imageryControl.value);
    updateImagery?.(imageryControl.value,replay.on,stateScope);
    saveDesk();
  };
  outlookControl.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-outlook',outlookControl.value);
    renderMap();
    saveDesk();
  };
  weatherAreas.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-map-weather-areas',weatherAreas.checked);
    renderMap();
    saveDesk();
  };
  placement.onchange = () => {
    if (!CapstoneDesks.active()) save('capstone-map-placement', placement.value);
    renderMap();
    saveDesk();
  };
  storyQuery.oninput = renderLocator;
  storySelect.onchange = () => { $('map-locate').disabled = !storySelect.value; };
  storySelect.addEventListener('blur', renderLocator);
  $('map-locator').onsubmit = event => {
    event.preventDefault();
    const id = storySelect.value;
    if (mappedLink?.id===id) centerMapOn(mappedLink);
    else if (locatableStories.some(story=>story.id===id)) selectEvent(id,true,false);
  };
  $('feed-health-panel').addEventListener('toggle', renderCollectorHealth);
  const areaBriefDialog = $('region-brief');
  const refreshAreaControls = () => {
    if (regionalView) renderRegionCoverage(regionalView.rows,regionalView.cutoff,regionalView.received);
    if (placeDialog.open) renderPlaceSearch();
  };
  $('region-coverage-body').addEventListener('click', event => {
    const savePlace = event.target.closest('#region-save-place');
    if (savePlace) {
      const key = focusedPlaceKey();
      if (!key) return;
      const saved = !savedPlaces.has(key);
      if (saved) savedPlaces.add(key);
      else savedPlaces.delete(key);
      savePlace.setAttribute('aria-pressed',String(saved));
      savePlace.textContent = saved ? 'Remove saved place' : 'Save place';
      const persisted = save(savedPlacesKey,[...savedPlaces]);
      if (persisted) channel?.postMessage({type:'saved-places'});
      $('region-place-feedback').textContent = saved ? persisted ? 'Place saved.' : 'Place saved for this session.' : 'Place removed.';
      refreshAreaControls();
      return;
    }
    if (!event.target.closest('#open-region-brief') || !areaBrief) return;
    const filters = [];
    if (category!=='all') filters.push($('ops-monitor').querySelector('[data-category="'+category+'"]').textContent.trim());
    for (const select of [$('platform-filter'),$('type-filter'),storyEvidence]) {
      if (select.value!=='all') filters.push(select.selectedOptions[0].textContent.trim());
    }
    const search = $('event-search').value.trim();
    if (search) filters.push('Search '+search);
    if ($('watch-only').checked) filters.push('Watchlist matches');
    if ($('ops-show-muted').checked) filters.push('Includes muted reports');
    $('region-brief-title').textContent = areaBrief.location+' briefing';
    $('region-brief-text').value = CapstoneRegionBrief.format({...areaBrief,filters});
    $('region-brief-status').textContent = '';
    areaBriefDialog.showModal();
  });
  $('close-region-brief').onclick = () => areaBriefDialog.close();
  areaBriefDialog.addEventListener('close',()=> $('open-region-brief')?.focus({preventScroll:true}));
  $('copy-region-brief').onclick = async () => {
    const field = $('region-brief-text'), status = $('region-brief-status');
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = 'Briefing copied.';
    } catch {
      field.focus();
      field.select();
      status.textContent = 'Briefing selected. Use your copy shortcut.';
    }
  };
  $('region-coverage-body').addEventListener('focusout', () => setTimeout(() => {
    if (regionalView) renderRegionCoverage(regionalView.rows,regionalView.cutoff,regionalView.received);
  },0));
  channel?.addEventListener('message', event => {
    if (event.data?.type!=='saved-places') return;
    savedPlaces = loadSavedPlaces();
    refreshAreaControls();
  });
  $('feed-health').addEventListener('focusout', () => setTimeout(renderCollectorHealth, 0));
  $('feed-health-panel').addEventListener('toggle',saveDesk);$('map-fallback').addEventListener('pointerup',saveDesk);
  window.addEventListener('pagehide',()=>{clearTimeout(deskTimer);CapstoneDesks.update();});
  setInterval(()=>{if(mapReady&&!replay.on)map.getSource('night')?.setData(nightGeo());else if(fallback)renderFallback();},300000);
  setInterval(render,60000); void initMap(); void initFeed();
})();

// What each incoming report is, so cards and markers can tell a KEV entry from a leak-site claim or a social post.
// Shared by Operations, the timeline page and the kiosk (classic script) and by node tests (imported for its side effect).
// Labels describe the source record only: a type never upgrades a claim, and evidence is the source's own standing.
globalThis.CapstoneTypes = (() => {
  // tone = a CSS color token; shape = map marker and card glyph (◆ vulnerability/threat, ▲ claim/incident,
  // ■ internet measurement, ○ machine-coded or natural signal, ● reporting and posts).
  const TYPES = {
    kev:        { label: 'KEV · EXPLOITED', tone: 'hot', shape: 'diamond' },
    cve:        { label: 'CRITICAL CVE', tone: 'signal', shape: 'diamond' },
    advisory:   { label: 'ADVISORY', tone: 'signal', shape: 'diamond' },
    malware:    { label: 'MALWARE INFRA', tone: 'hot', shape: 'diamond' },
    ransomware: { label: 'RANSOMWARE CLAIM', tone: 'hot', shape: 'triangle' },
    claim:      { label: 'ATTACK CLAIM', tone: 'ai', shape: 'triangle' },
    incident:   { label: 'INCIDENT', tone: 'hot', shape: 'triangle' },
    outage:     { label: 'OUTAGE', tone: 'night', shape: 'square' },
    routing:    { label: 'BGP / ROUTING', tone: 'night', shape: 'square' },
    conflict:   { label: 'GDELT NEWS CODING', tone: 'geo', shape: 'ring' },
    withdrawal: { label: 'EARTHQUAKE WITHDRAWAL', tone:'muted',shape:'ring' },
    quake:      { label: 'EARTHQUAKE', tone: 'muted', shape: 'ring' },
    hazard:     { label: 'HAZARD ALERT', tone: 'geo', shape: 'ring' },
    earthwatch: { label:'EARTH OBSERVATION',tone:'geo',shape:'ring' },
    storm:      { label: 'LOCAL STORM REPORT', tone:'geo',shape:'ring' },
    river:      { label: 'OBSERVED FLOOD STAGE', tone:'night',shape:'ring' },
    cyclone:    { label: 'TROPICAL CYCLONE ADVISORY', tone:'geo',shape:'ring' },
    humanitarian:{ label:'HUMANITARIAN CATALOG', tone:'geo',shape:'ring' },
    declaration:{ label: 'DISASTER DECLARATION', tone:'geo',shape:'ring' },
    wildfire:   { label: 'WILDFIRE RECORD', tone: 'geo', shape: 'ring' },
    volcano_weekly: { label:'WEEKLY VOLCANO UPDATE',tone:'geo',shape:'ring' },
    volcano:    { label: 'VOLCANO BULLETIN', tone: 'geo', shape: 'ring' },
    mapping:    { label: 'MAPPING ACTIVATION', tone: 'geo', shape: 'ring' },
    weather:    { label: 'WEATHER BULLETIN', tone: 'geo', shape: 'ring' },
    airport:    { label: 'AIRPORT DISRUPTION', tone: 'geo', shape: 'square' },
    road:       { label: 'ROAD CLOSURE', tone: 'geo', shape: 'square' },
    tsunami:    { label: 'TSUNAMI BULLETIN', tone: 'geo', shape: 'ring' },
    space:      { label: 'SPACE WEATHER', tone: 'night', shape: 'ring' },
    news:       { label: 'NEWS', tone: 'geo', shape: 'dot' },
    ainews:     { label: 'AI NEWS', tone: 'ai', shape: 'dot' },
    cybernews:  { label: 'CYBER NEWS', tone: 'signal', shape: 'dot' },
    post:       { label: 'POST', tone: 'live', shape: 'dot' }
  };
  const GLYPH = { diamond: '◆', triangle: '▲', square: '■', ring: '○', dot: '●' };
  const PLATFORM = { telegram: 'TELEGRAM', bluesky: 'BLUESKY', mastodon: 'MASTODON', x: 'X' };
  const ORDER = Object.keys(TYPES);
  const sections = {
    'Cybersecurity':['kev','cve','advisory','malware','ransomware','claim','incident'],
    'Internet':['outage','routing'],
    'Earth and weather':['quake','withdrawal','hazard','weather','storm','river','cyclone','declaration','humanitarian','wildfire','volcano','volcano_weekly','mapping','earthwatch','tsunami','space'],
    'Transportation':['airport','road'],
    'Reporting':['conflict','news','ainews','cybernews','post']
  };
  function addReportTypeOptions(select) {
    for (const [label,types] of Object.entries(sections)) {
      const group = select.ownerDocument.createElement('optgroup');
      group.label = label;
      for (const id of types) {
        const option = select.ownerDocument.createElement('option');
        option.value = id;
        option.textContent = TYPES[id].label;
        group.append(option);
      }
      select.append(group);
    }
  }
  const PLACEMENTS = {
    manual: 'Manually assigned',
    event_location: 'Reported coordinates',
    seismic_origin: 'Reported earthquake origin',
    cyclone_center: 'NHC reported storm center',
    gauge_location: 'Reporting gauge location',
    airport_reference: 'FAA airport reference point',
    road_closure_start: 'Reported closure start point',
    road_segment: 'Point on the published road segment',
    country_centroid: 'Approximate country reference point',
    regional_reference: 'Approximate alert area reference point',
    mapping_area: 'Source mapping area center',
    weather_area: 'NWS alert area',
    international_weather_area: 'Source weather alert area',
    fire_origin: 'Reported wildfire origin',
    catalog_point: 'Source catalog location',
    state_reference: 'Approximate state reference point',
    nws_zone_reference: 'Approximate NWS forecast-zone reference point',
    nws_marine_reference: 'Approximate NWS marine-zone reference point',
    victim: 'Organization location',
    vendor_hq: 'Vendor headquarters',
    company_hq: 'Company headquarters',
    unlocated: 'Location not established'
  };
  const placement = event => PLACEMENTS[event.place_basis] || PLACEMENTS.unlocated;
  const referencePlacements = new Set(['vendor_hq','company_hq','country_centroid','regional_reference','state_reference','nws_zone_reference','nws_marine_reference',
    'mapping_area','weather_area','international_weather_area','catalog_point','airport_reference','manual']);
  const referencePlacement = event => referencePlacements.has(event.place_basis);
  const EVIDENCE = ['Official', 'Measured', 'Statement', 'Reported', 'Community intel', 'Machine-coded', 'Modeled alert', 'Provider annotation', 'Automated detection', 'Claim', 'Unverified'];

  const EVIDENCE_FILTERS = ['primary',...EVIDENCE];
  const evidenceFilterLabel = filter => filter==='primary' ? 'Official or measured' : filter;
  const matchesEvidence = (report,filter) => {
    const label = evidence(report);
    return filter==='primary' ? label==='Official' || label==='Measured' : label===filter;
  };

  const latestReceipt = reports => reports.reduce((latest,report)=>
    report.first_received && (!latest || report.first_received>latest) ? report.first_received : latest,null);

  function archiveLink(report) {
    if (report.source_url_scope === 'archive') return true;
    if (!['Cloudflare Radar', 'RIPE RIS Live'].includes(report.source)) return false;
    try {
      const url = new URL(report.url);
      if (report.source === 'RIPE RIS Live') return url.hostname === 'ris-live.ripe.net' && url.pathname === '/';
      return url.hostname === 'radar.cloudflare.com' && ['/outage-center', '/routing'].includes(url.pathname.replace(/\/$/, ''));
    } catch { return false; }
  }

  function listingCutoff(report) {
    if (report.kind==='weather_alert' && !report.weather_replaced_at) return Date.parse(report.weather_listed_until);
    if (report.kind==='airport_disruption') return Date.parse(report.airport_listed_until);
    if (report.kind==='road_closure') return Date.parse(report.road_listed_until);
    if (report.kind==='outage') return Date.parse(report.outage_listed_until);
    return NaN;
  }
  const currentListing = (report,now=Date.now()) => listingCutoff(report)>now;

  function seismicFacts(report) {
    const data = report.seismic;
    if (!data) return [];
    return [
      ...(Number.isFinite(data.shakemap) ? [['Peak ShakeMap intensity','MMI '+data.shakemap.toFixed(1)+' · Estimated']] : []),
      ...(Number.isSafeInteger(data.felt) ? [['Felt responses',data.felt.toLocaleString()+' · Reported to USGS']] : []),
      ...(Number.isFinite(data.reported) ? [['Peak reported intensity','CDI '+data.reported.toFixed(1)+' · Public responses']] : [])
    ];
  }

  const isNewsCodingAggregate = report => report.kind==='conflict' && (report.source==='GDELT' || report.feed_id==='gdelt');
  const sourceDateLabel = basis => basis==='updated' ? 'Source update' : basis==='catalog_observation' ? 'Catalog observation' : 'Source date';

  function sourceReference(report) {
    if (isNewsCodingAggregate(report)) return 'sampled article';
    if (report.source_url_scope === 'live_listing') {
      if (report.kind === 'airport_disruption') return 'FAA live status';
      if (report.kind === 'road_closure') return /^Caltrans/i.test(report.source || '') ? 'Caltrans highway conditions' : 'live road closure inventory';
      if (report.source === 'Environment Agency flood notices') return 'GOV.UK flood area';
      return 'live source listing';
    }
    if (!archiveLink(report)) return null;
    if (report.source === 'RIPE RIS Live') return 'RIPE RIS Live reference';
    if (report.kind === 'space_weather') return 'NOAA bulletins';
    return 'source archive';
  }

  function typeId(e) {
    const k = e.kind;
    if (e.platform && (k === 'social' || !k)) return 'post';
    if (k === 'exploitation' || e.source === 'CISA KEV') return 'kev';
    if (k === 'vulnerability') return 'cve';
    if (k === 'infrastructure') return 'malware';
    if (k === 'ransomware') return 'ransomware';
    if (k === 'claim') return 'claim';
    if (k === 'incident') return 'incident';
    if (k === 'outage') return 'outage';
    if (k === 'routing') return 'routing';
    if (k === 'conflict') return 'conflict';
    if (k === 'earthquake') return 'quake';
    if (k === 'earthquake_withdrawal') return 'withdrawal';
    if (k === 'hazard') return 'hazard';
    if (k === 'local_storm_report') return 'storm';
    if (k === 'river_gauge') return 'river';
    if (k === 'tropical_cyclone') return 'cyclone';
    if (k === 'humanitarian_record') return 'humanitarian';
    if (k === 'disaster_declaration') return 'declaration';
    if (k === 'space_weather') return 'space';
    if (k === 'earth_observation') return 'earthwatch';
    if (k === 'wildfire_record') return 'wildfire';
    if (k === 'volcano_weekly') return 'volcano_weekly';
    if (k === 'volcano_bulletin') return 'volcano';
    if (k === 'mapping_activation') return 'mapping';
    if (k === 'weather_alert') return 'weather';
    if (k === 'airport_disruption') return 'airport';
    if (k === 'road_closure') return 'road';
    if (k === 'tsunami') return 'tsunami';
    if (k === 'advisory' || ['CISA advisories', 'CERT-FR advisories'].includes(e.source)) return 'advisory';
    if (e.platform) return 'post';
    return e.category === 'ai' ? 'ainews' : e.category === 'cyber' ? 'cybernews' : 'news';
  }
  // The source's own standing, not a judgement of the content. Mirrors evidenceClass() in lib/developing.mjs.
  function evidence(e) {
    const c = String(e.confidence || '');
    if (e.kind === 'hazard') return 'Modeled alert';
    if (e.feed_id === 'gdelt' || /machine.coded/i.test(c)) return 'Machine-coded';
    if (e.kind === 'incident' && /relayed by a tracker/i.test(c)) return 'Unverified';
    if (['claim', 'ransomware'].includes(e.kind) || /actor claim/i.test(c)) return 'Claim';
    if (/unverified|unconfirmed/i.test(c)) return 'Unverified';
    if (/operator annotation/i.test(c)) return 'Provider annotation';
    if (/automated detection/i.test(c) && !/measure/i.test(c)) return 'Automated detection';
    if (['outage', 'routing', 'earthquake'].includes(e.kind) || /measure/i.test(c)) return 'Measured';
    if (/official/i.test(c) || ['kev', 'cisa', 'nvd'].includes(e.feed_id)) return 'Official';
    if (/community threat intelligence/i.test(c)) return 'Community intel';
    if (/company announcement|statement/i.test(c)) return 'Statement';
    return 'Reported';
  }
  // A post with nothing to anchor it (no CVE, cited link, watch match or claim) is chatter: still shown, but quieter.
  const chatter = e => typeId(e) === 'post' && !(e.cves?.length) && !(e.citation_urls?.length) && !(e.watch_matches?.length);
  const severity = e => (e.score >= 85 ? 'critical' : e.score >= 65 ? 'high' : 'normal');

  function describe(e) {
    const id = typeId(e), t = TYPES[id];
    const label = id === 'post' ? `${PLATFORM[e.platform] || 'SOCIAL'} POST` : id === 'claim' && e.claim_type ? `${String(e.claim_type).toUpperCase()} CLAIM` : t.label;
    return { id, label, tone: t.tone, shape: t.shape, glyph: GLYPH[t.shape], evidence: evidence(e), severity: severity(e), chatter: chatter(e) };
  }
  // Source tags that only restate the type or category ("subject: Social post", "subject: Cyber") add nothing on a card that shows the type.
  const RESTATED = new Set(['ransomware claim', 'attack claim', 'reported incident', 'internet outage', 'routing', 'vulnerability', 'known exploited vulnerability', 'earthquake', 'natural hazard', 'conflict', 'social post', 'cyber', 'world', 'ai & robotics']);
  const restates = t => t.origin === 'source' && t.type === 'subject' && (RESTATED.has(String(t.label).toLowerCase()) || /\bclaim$/i.test(t.label));

  return { TYPES, GLYPH, ORDER, EVIDENCE, EVIDENCE_FILTERS, evidenceFilterLabel, matchesEvidence, latestReceipt, addReportTypeOptions, typeId, evidence, describe, placement, referencePlacement, archiveLink, sourceReference, isNewsCodingAggregate, sourceDateLabel, seismicFacts, listingCutoff, currentListing, chatter, restates, label: id => TYPES[id]?.label || id };
})();

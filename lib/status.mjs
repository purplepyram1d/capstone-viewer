// Status board: tiles use fixed, published thresholds over data the app
// already holds. Every tile returns the inputs and the rule that set its color; there is no composite score.
import { canonicalCitation } from './reading.mjs';
import { currentOutage, staleOutage } from './outage-state.mjs';

const HOUR = 3600000, DAY = 24 * HOUR;
const within = (e, ms, now) => { const t = Date.parse(e.ts); return Number.isFinite(t) && t >= now - ms && t <= now + 5 * 60000; };

// Last 24 hours against the daily rate before that, per source. A feed's first poll returns days of backlog
// (a Telegram preview holds about 20 posts), so a source only counts once the app has collected it for
// three full days, and its baseline only covers days since it started collecting (`since`: source ID -> ms).
export const sourceOf = e => e.feed_id || e.source_id || null;
export function volume(rows, now = Date.now(), since = {}) {
  const bySource = new Map();
  for (const e of rows) { const s = sourceOf(e), t = Date.parse(e.ts); if (!s || !Number.isFinite(t)) continue; if (!bySource.has(s)) bySource.set(s, []); bySource.get(s).push(t); }
  let last24 = 0, baseline = 0, mature = 0, building = 0;
  for (const [s, times] of bySource) {
    const start = Math.max(since[s] ?? Infinity, now - 8 * DAY), days = (now - DAY - start) / DAY;
    if (!(days >= 3)) { building++; continue; }
    mature++; last24 += times.filter(t => t >= now - DAY && t <= now + 5 * 60000).length;
    baseline += times.filter(t => t >= start && t < now - DAY).length / days;
  }
  if (!mature) return { last24: null, baseline: null, ratio: null, mature, building };
  return { last24, baseline: Math.round(baseline * 10) / 10, ratio: Math.round(last24 / Math.max(baseline, 1) * 10) / 10, mature, building };
}
const volumeText = v => !v ? 'Comparison unavailable · live report limit reached' : v.baseline === null ? `baseline building (${v.building} source${v.building === 1 ? '' : 's'} with under 3 days collected)` : `${v.last24} in 24h vs ${v.baseline}/day (${v.ratio}x) from ${v.mature} source${v.mature === 1 ? '' : 's'}${v.building ? `; ${v.building} still building history` : ''}`;
const tile = (id, label, level, headline, inputs, rule) => ({ id, label, level, headline, inputs, rule });

// Collapse accounts that cite the same article for a CVE. Unlinked mentions can still be related.
function mentionGroups(posts) {
  const parents = new Map(), citations = new Map();
  function root(id) {
    while (parents.has(id)) id = parents.get(id);
    return id;
  }
  const accounts = new Set();
  for (const post of posts) {
    const account = post.source_id || post.source;
    if (!account) continue;
    accounts.add(account);
    const links = [...new Set((post.citation_urls || []).map(canonicalCitation).filter(Boolean))];
    if (links.length !== 1) continue;
    const link = links[0];
    if (!citations.has(link)) citations.set(link, account);
    const earlier = root(citations.get(link)), current = root(account);
    if (earlier !== current) parents.set(current, earlier);
  }
  return new Set([...accounts].map(root)).size;
}

export function computeStatus({ reports = [], hotspots = [], pulse = null, since = {}, volumeComparable = true, now = Date.now() } = {}) {
  const countriesOf = list => [...new Set(list.map(e => e.country).filter(Boolean))];

  const regional = reports.filter(report=>report.outage_scope==='state' && currentOutage(report));
  const ongoing = reports.filter(report=>report.outage_scope!=='state' && currentOutage(report)), major = countriesOf(ongoing.filter(e => e.score >= 85));
  const activeCountries = countriesOf(ongoing);
  const staleCountries = countriesOf(reports.filter(report=>report.outage_scope!=='state' && staleOutage(report))).filter(code => !activeCountries.includes(code));
  const hijacks = reports.filter(e => e.kind === 'routing' && e.source === 'Cloudflare Radar' && within(e, DAY, now));
  const surge = reports.filter(e => e.kind === 'routing' && e.source === 'RIPE RIS Live' && within(e, 6 * HOUR, now));
  const internetLevel = pulse?.surge || surge.length || major.length >= 3 || hijacks.length >= 3 ? 'red' : major.length || hijacks.length || (pulse?.ratio ?? 0) >= 2 ? 'amber' : 'green';
  const internet = tile('internet', 'Internet', internetLevel, `${countriesOf(ongoing).length} countries with ongoing outages, ${major.length} major`, [
    { label: 'Countries with an ongoing outage', value: countriesOf(ongoing).length, note: countriesOf(ongoing).slice(0, 12).join(', ') },
    { label: 'U.S. states with a current detection', value: new Set(regional.flatMap(report=>report.state_codes || [])).size, note: [...new Set(regional.map(report=>report.place).filter(Boolean))].slice(0,12).join(', ') },
    { label: 'Major ongoing outages (IODA score 100k+ or Radar nationwide)', value: major.length, note: major.join(', ') },
    { label: 'BGP hijacks flagged in 24h (Radar, confidence 8+)', value: hijacks.length },
    { label: 'Routing pulse (withdrawals vs median)', value: pulse ? (pulse.ratio === null ? 'baseline building' : `${pulse.ratio}x${pulse.surge ? ' SURGE' : ''}`) : 'off' },
    { label: 'Routing surges stored in the last 6h', value: surge.length },
    { label: 'Last listed as ongoing, current state unknown', value: staleCountries.length, note: staleCountries.slice(0,12).join(', ') }
  ], 'Red: a routing surge, 3+ countries with a major outage, or 3+ hijacks in 24h. Amber: any major outage, any hijack, or the routing pulse at 2x.');

  const kev = reports.filter(e => e.source === 'CISA KEV' && within(e, 2 * DAY, now)), kevRansom = kev.filter(e => e.score >= 95);
  const criticals = reports.filter(e => e.kind === 'vulnerability' && within(e, DAY, now));
  const highEpss = [...new Map(reports.filter(e => within(e, DAY, now) && e.epss?.epss >= 0.5).map(e => [e.epss.cve, e])).values()];
  const ransom = volumeComparable ? volume(reports.filter(e => e.kind === 'ransomware'), now, since) : null;
  // Shown for context; they do not set the tile color until there is enough history to judge a normal day.
  const relayed = reports.filter(e => (e.kind === 'claim' || e.kind === 'incident') && within(e, DAY, now)), byPlace = new Map();
  for (const e of relayed) byPlace.set(e.place, (byPlace.get(e.place) || 0) + 1);
  const relayedNote = [...byPlace].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => `${p} ${n}`).join(', ');
  const cyberLevel = kevRansom.length || (ransom?.ratio >= 2 && ransom.last24 >= 10) ? 'red' : kev.length || highEpss.length || ransom?.ratio >= 1.5 ? 'amber' : 'green';
  const cyber = tile('cyber', 'Cyber', cyberLevel, `${kev.length} KEV additions in 48h, ${criticals.length} critical CVEs in 24h`, [
    { label: 'CISA KEV additions, last 48h', value: kev.length, note: kev.slice(0, 8).map(e => e.cves?.[0]).filter(Boolean).join(', ') },
    { label: 'KEV additions with known ransomware use', value: kevRansom.length, note: kevRansom.map(e => e.cves?.[0]).filter(Boolean).join(', ') },
    { label: 'Critical CVEs published in 24h (NVD, CVSS 9+)', value: criticals.length },
    { label: 'CVEs in today\'s reports with EPSS 50%+', value: highEpss.length, note: highEpss.slice(0, 8).map(e => `${e.epss.cve} ${Math.round(e.epss.epss * 100)}%`).join(', ') },
    { label: 'Ransomware leak-site claims', value: volumeText(ransom) },
    { label: 'Relayed attack claims and incident reports, 24h', value: relayed.length, note: relayedNote },
    { label: 'Hacktivist claims, 24h', value: relayed.filter(e => e.claim_type === 'hacktivist').length }
  ],'Red: a KEV addition with known ransomware use in 48h, or ransomware claims at 2x baseline with 10+ in 24h. Amber: any KEV addition, any CVE in today\'s reports with EPSS 50%+, or claims at 1.5x.');

  const multi = hotspots.filter(h => (h.kinds ?? h.families.length) >= 3), spikes = hotspots.filter(h => h.spike);
  const world = volumeComparable ? volume(reports.filter(e => e.category === 'geo' && !['earthquake','hazard','space_weather','tsunami','weather_alert','mapping_activation','volcano_bulletin','wildfire_record','earth_observation','river_gauge','tropical_cyclone','disaster_declaration','earthquake_withdrawal','local_storm_report','humanitarian_record','volcano_weekly','conflict'].includes(e.kind)), now, since) : null;
  const fighting = reports.filter(e => e.kind === 'conflict' && within(e, DAY, now)).sort((a, b) => (b.outlets || 0) - (a.outlets || 0));
  const conflictLevel = multi.length || world?.ratio >= 2 ? 'red' : hotspots.length >= 3 || spikes.length || world?.ratio >= 1.5 ? 'amber' : 'green';
  const conflict = tile('conflict', 'Conflict & world', conflictLevel, `${hotspots.length} hot spots, ${multi.length} with 3+ kinds of signal`, [
    { label: 'Hot spots (last 24h)', value: hotspots.length, note: hotspots.slice(0, 8).map(h => h.name).join(', ') },
    { label: 'Hot spots with 3+ kinds of signal', value: multi.length, note: multi.map(h => h.name).join(', ') },
    { label: 'Hot spots driven by a volume spike', value: spikes.length, note: spikes.map(h => h.name).join(', ') },
    { label: 'Country tags in GDELT news coding, last 24h', value: fighting.length, note: fighting.slice(0, 8).map(e => `${e.country_code || e.country || e.place} (${e.outlets} domains)`).join(', ') },
    { label: 'World news and conflict-channel reports', value: volumeText(world) }
  ], 'Red: any hot spot with 3+ kinds of signal, or world-desk volume at 2x baseline. Amber: 3+ hot spots, any spike-driven hot spot, or world-desk volume at 1.5x.');

  const listedWarnings = reports.filter(report=>report.kind==='weather_alert' && Date.parse(report.weather_listed_until)>now);
  const strongQuakes = reports.filter(report=>report.kind==='earthquake' && report.magnitude>=6 && within(report,DAY,now))
    .sort((a,b)=>b.magnitude-a.magnitude);
  const gauges = new Map();
  for (const report of reports) {
    if (report.kind==='river_gauge' && report.url && within(report,3*HOUR,now) &&
        (!gauges.has(report.url) || gauges.get(report.url).ts<report.ts)) gauges.set(report.url,report);
  }
  const majorStages = [...gauges.values()].filter(report=>report.flood_stage==='major');
  const impacts = reports.filter(report=>report.kind==='local_storm_report' && within(report,DAY,now));
  const cycloneAdvisories = reports.filter(report=>report.kind==='tropical_cyclone' && within(report,DAY,now));
  const earthLevel = strongQuakes.some(report=>report.magnitude>=7) ? 'red' :
    strongQuakes.length || listedWarnings.length || majorStages.length ? 'amber' : 'green';
  const earth = tile('earth','Earth & weather',earthLevel,
    `${listedWarnings.length} listed warnings · ${strongQuakes.length} M6+ earthquake reports`,[
      {label:'Weather bulletins listed in fresh polls',value:listedWarnings.length},
      {label:'M6+ earthquake reports, last 24h',value:strongQuakes.length,
        note:strongQuakes.slice(0,3).map(report=>'M'+report.magnitude+' '+(report.place || report.title || '')).join(' · ')},
      {label:'Gauges whose latest collected reading showed major stage, last 3h',value:majorStages.length},
      {label:'Preliminary U.S. storm-impact reports, last 24h',value:impacts.length},
      {label:'NHC tropical cyclone advisories, last 24h',value:cycloneAdvisories.length}
    ],'Red: an M7+ earthquake report in 24h. Amber: an M6+ report in 24h, a currently listed weather bulletin, or a qualifying major-stage gauge reading.');
  earth.assessment = 'Read the source times and collector coverage alongside the counts. Open the original bulletins and gauge pages for updates.';
  earth.alertLevel = 'green';

  const social = reports.filter(e => e.platform && e.kind === 'social'), chatter = volumeComparable ? volume(social, now, since) : null, byCve = new Map();
  for (const e of social.filter(e => within(e, DAY, now))) for (const cve of e.cves || []) { if (!byCve.has(cve)) byCve.set(cve, []); byCve.get(cve).push(e); }
  const trending = [...byCve].map(([cve, posts]) => [cve, mentionGroups(posts)]).filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]);
  const socialLevel = trending.some(([, count]) => count >= 3) || chatter?.ratio >= 2.5 ? 'red' : trending.length || chatter?.ratio >= 1.75 ? 'amber' : 'green';
  const chatterTile = tile('social', 'Researcher chatter', socialLevel, trending.length ? `${trending.length} CVEs with 2+ mention groups in 24h` : `${social.filter(e => within(e, DAY, now)).length} posts in 24h`, [
    { label: 'Posts from your social feeds', value: volumeText(chatter) },
    { label: 'CVEs named by 2+ mention groups in 24h', value: trending.length, note: trending.slice(0, 8).map(([cve, s]) => `${cve} (${s})`).join(', ') }
  ], 'Red: a CVE with 3+ mention groups in 24h, or post volume at 2.5x baseline. Amber: a CVE with 2 mention groups, or volume at 1.75x. Shared citations count once. Other groups may still repeat one another.');

  internet.alertLevel = major.length >= 3 ? 'red' : major.length ? 'amber' : 'green';
  cyber.alertLevel = kevRansom.length ? 'red' : kev.length ? 'amber' : 'green';
  conflict.alertLevel = 'green';
  chatterTile.alertLevel = 'green';
  internet.alertHeadline = `${major.length} countries with recently received major outage listings.`;
  cyber.alertHeadline = `${kev.length} CISA KEV additions in 48h, ${kevRansom.length} with known ransomware use.`;
  internet.assessment = major.length
    ? `Sources report major outages in ${major.length} countries. Local reachability requires separate checks.`
    : 'Assess reachability from direct measurements for the network in question.';
  cyber.assessment = kev.length
    ? 'CISA lists recent vulnerabilities as exploited in the wild. Local exposure depends on your assets and mitigations.'
    : 'Local exposure requires matching reports to your assets and checking mitigations.';
  conflict.assessment = 'Hot spots summarize overlapping signals. Assess incident and impact from original reporting.';
  chatterTile.assessment = 'Posting activity measures attention. Assess exploitation or impact from primary evidence.';
  return [internet, cyber, conflict, earth, chatterTile];
}

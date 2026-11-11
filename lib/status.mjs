// Status board: four tiles turned green, amber or red by fixed, published thresholds over data the app
// already holds. Every tile returns the inputs and the rule that set its color; there is no composite score.
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
const volumeText = v => v.baseline === null ? `baseline building (${v.building} source${v.building === 1 ? '' : 's'} with under 3 days collected)` : `${v.last24} in 24h vs ${v.baseline}/day (${v.ratio}x) from ${v.mature} source${v.mature === 1 ? '' : 's'}${v.building ? `; ${v.building} still building history` : ''}`;
const tile = (id, label, level, headline, inputs, rule) => ({ id, label, level, headline, inputs, rule });

export function computeStatus({ reports = [], hotspots = [], pulse = null, since = {}, now = Date.now() } = {}) {
  const countriesOf = list => [...new Set(list.map(e => e.country).filter(Boolean))];

  const ongoing = reports.filter(e => e.kind === 'outage' && e.ongoing), major = countriesOf(ongoing.filter(e => e.score >= 85));
  const hijacks = reports.filter(e => e.kind === 'routing' && e.source === 'Cloudflare Radar' && within(e, DAY, now));
  const surge = reports.filter(e => e.kind === 'routing' && e.source === 'RIPE RIS Live' && within(e, 6 * HOUR, now));
  const internetLevel = pulse?.surge || surge.length || major.length >= 3 || hijacks.length >= 3 ? 'red' : major.length || hijacks.length || (pulse?.ratio ?? 0) >= 2 ? 'amber' : 'green';
  const internet = tile('internet', 'Internet', internetLevel, `${countriesOf(ongoing).length} countries with ongoing outages, ${major.length} major`, [
    { label: 'Countries with an ongoing outage', value: countriesOf(ongoing).length, note: countriesOf(ongoing).slice(0, 12).join(', ') },
    { label: 'Major ongoing outages (IODA score 100k+ or Radar nationwide)', value: major.length, note: major.join(', ') },
    { label: 'BGP hijacks flagged in 24h (Radar, confidence 8+)', value: hijacks.length },
    { label: 'Routing pulse (withdrawals vs median)', value: pulse ? (pulse.ratio === null ? 'baseline building' : `${pulse.ratio}x${pulse.surge ? ' SURGE' : ''}`) : 'off' },
    { label: 'Routing surges stored in the last 6h', value: surge.length }
  ], 'Red: a routing surge, 3+ countries with a major outage, or 3+ hijacks in 24h. Amber: any major outage, any hijack, or the routing pulse at 2x.');

  const kev = reports.filter(e => e.source === 'CISA KEV' && within(e, 2 * DAY, now)), kevRansom = kev.filter(e => e.score >= 95);
  const criticals = reports.filter(e => e.kind === 'vulnerability' && within(e, DAY, now));
  const highEpss = [...new Map(reports.filter(e => within(e, DAY, now) && e.epss?.epss >= 0.5).map(e => [e.epss.cve, e])).values()];
  const ransom = volume(reports.filter(e => e.kind === 'ransomware'), now, since);
  // Shown for context; they do not set the tile color until there is enough history to judge a normal day.
  const relayed = reports.filter(e => (e.kind === 'claim' || e.kind === 'incident') && within(e, DAY, now)), byPlace = new Map();
  for (const e of relayed) byPlace.set(e.place, (byPlace.get(e.place) || 0) + 1);
  const relayedNote = [...byPlace].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => `${p} ${n}`).join(', ');
  const cyberLevel = kevRansom.length || (ransom.ratio >= 2 && ransom.last24 >= 10) ? 'red' : kev.length || highEpss.length || ransom.ratio >= 1.5 ? 'amber' : 'green';
  const cyber = tile('cyber', 'Cyber', cyberLevel, `${kev.length} KEV additions in 48h, ${criticals.length} critical CVEs in 24h`, [
    { label: 'CISA KEV additions, last 48h', value: kev.length, note: kev.slice(0, 8).map(e => e.cves?.[0]).filter(Boolean).join(', ') },
    { label: 'KEV additions with known ransomware use', value: kevRansom.length, note: kevRansom.map(e => e.cves?.[0]).filter(Boolean).join(', ') },
    { label: 'Critical CVEs published in 24h (NVD, CVSS 9+)', value: criticals.length },
    { label: 'CVEs in today\'s reports with EPSS 50%+', value: highEpss.length, note: highEpss.slice(0, 8).map(e => `${e.epss.cve} ${Math.round(e.epss.epss * 100)}%`).join(', ') },
    { label: 'Ransomware leak-site claims', value: volumeText(ransom) },
    { label: 'Relayed attack claims and confirmed incidents, 24h', value: relayed.length, note: relayedNote },
    { label: 'Hacktivist claims, 24h', value: relayed.filter(e => e.claim_type === 'hacktivist').length }
  ],'Red: a KEV addition with known ransomware use in 48h, or ransomware claims at 2x baseline with 10+ in 24h. Amber: any KEV addition, any CVE in today\'s reports with EPSS 50%+, or claims at 1.5x.');

  const multi = hotspots.filter(h => (h.kinds ?? h.families.length) >= 3), spikes = hotspots.filter(h => h.spike);
  const world = volume(reports.filter(e => e.category === 'geo' && e.kind !== 'earthquake' && e.kind !== 'conflict'), now, since);
  const fighting = reports.filter(e => e.kind === 'conflict' && within(e, DAY, now)).sort((a, b) => (b.outlets || 0) - (a.outlets || 0));
  const conflictLevel = multi.length || world.ratio >= 2 ? 'red' : hotspots.length >= 3 || spikes.length || world.ratio >= 1.5 ? 'amber' : 'green';
  const conflict = tile('conflict', 'Conflict & world', conflictLevel, `${hotspots.length} hot spots, ${multi.length} with 3+ kinds of signal`, [
    { label: 'Hot spots (last 24h)', value: hotspots.length, note: hotspots.slice(0, 8).map(h => h.name).join(', ') },
    { label: 'Hot spots with 3+ kinds of signal', value: multi.length, note: multi.map(h => h.name).join(', ') },
    { label: 'Hot spots driven by a volume spike', value: spikes.length, note: spikes.map(h => h.name).join(', ') },
    { label: 'Countries with machine-coded fighting today (GDELT, 5+ events, 3+ outlets)', value: fighting.length, note: fighting.slice(0, 8).map(e => `${e.place} (${e.outlets} outlets)`).join(', ') },
    { label: 'World-desk reports (news and conflict channels, no earthquakes)', value: volumeText(world) }
  ], 'Red: any hot spot with 3+ kinds of signal, or world-desk volume at 2x baseline. Amber: 3+ hot spots, any spike-driven hot spot, or world-desk volume at 1.5x.');

  const social = reports.filter(e => e.platform && e.kind === 'social'), chatter = volume(social, now, since), byCve = new Map();
  for (const e of social.filter(e => within(e, DAY, now))) for (const cve of e.cves || []) { if (!byCve.has(cve)) byCve.set(cve, new Set()); byCve.get(cve).add(e.source_id || e.source); }
  const trending = [...byCve].filter(([, sources]) => sources.size >= 2).sort((a, b) => b[1].size - a[1].size);
  const socialLevel = trending.some(([, s]) => s.size >= 3) || chatter.ratio >= 2.5 ? 'red' : trending.length || chatter.ratio >= 1.75 ? 'amber' : 'green';
  const chatterTile = tile('social', 'Researcher chatter', socialLevel, trending.length ? `${trending.length} CVEs named by 2+ of your sources today` : `${social.filter(e => within(e, DAY, now)).length} posts in 24h`, [
    { label: 'Posts from your social feeds', value: volumeText(chatter) },
    { label: 'CVEs named by 2+ separate sources in 24h', value: trending.length, note: trending.slice(0, 8).map(([cve, s]) => `${cve} (${s.size})`).join(', ') }
  ], 'Red: a CVE named by 3+ of your sources in 24h, or post volume at 2.5x baseline. Amber: a CVE named by 2 sources, or volume at 1.75x. Sources can quote each other.');

  return [internet, cyber, conflict, chatterTile];
}

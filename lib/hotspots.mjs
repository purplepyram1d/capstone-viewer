// Cross-feed hot spots: different kinds of signal landing in the same country inside one day,
// plus per-country volume spikes against the previous week. Co-occurrence is a reason to look,
// never evidence that the reports are related or that one caused another.
const HOUR = 3600000, DAY = 24 * HOUR;
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\[.*?\]/g, '').replace(/[^a-z]+/g, ' ').trim();
// world-atlas abbreviations that do not match the country reference names.
const atlasAliases = { 'W. Sahara': 'EH', 'United States of America': 'US', 'Dem. Rep. Congo': 'CD', 'Dominican Rep.': 'DO', 'Falkland Is.': 'FK', 'Fr. S. Antarctic Lands': 'TF',
  'Central African Rep.': 'CF', 'Eq. Guinea': 'GQ', eSwatini: 'SZ', Palestine: 'PS', 'Solomon Is.': 'SB', Czechia: 'CZ', 'N. Cyprus': 'CY', Somaliland: 'SO', 'Bosnia and Herz.': 'BA', 'S. Sudan': 'SS' };
export const families = { internet: 'Internet outage', routing: 'Routing anomaly', ransomware: 'Ransomware claim', exploitation: 'Exploitation', physical: 'Earthquake',
  cyber: 'Cyber report', world: 'World news', social: 'Social chatter', ai: 'AI news', infrastructure: 'Malware infrastructure', vulnerability: 'Critical CVE',
  hacktivist: 'Hacktivist claim', claims: 'Breach claim', incident: 'Confirmed incident', conflict: 'Armed conflict (machine-coded)' };
export function family(e) {
  // Relayed attack claims come from social feeds but are their own signal, not chatter.
  if (e.kind === 'claim') return { hacktivist: 'hacktivist', ransomware: 'ransomware' }[e.claim_type] || 'claims';
  if (e.kind === 'incident') return 'incident';
  if (e.platform) return 'social';
  return { outage: 'internet', routing: 'routing', ransomware: 'ransomware', exploitation: 'exploitation', earthquake: 'physical', infrastructure: 'infrastructure', vulnerability: 'vulnerability', conflict: 'conflict' }[e.kind] || { cyber: 'cyber', geo: 'world', ai: 'ai' }[e.category] || 'world';
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polygonContains = (polygon, x, y) => ringContains(polygon[0], x, y) && !polygon.slice(1).some(hole => ringContains(hole, x, y));

export function createCountryResolver(world, countries) {
  const byName = new Map(Object.entries(countries).map(([code, c]) => [norm(c.name), code]));
  const shapes = (world?.features || []).map(f => {
    const code = atlasAliases[f.properties?.name] || byName.get(norm(f.properties?.name));
    const polygons = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    const box = polygons.flat(2).reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
    return code ? { code, polygons, box } : null;
  }).filter(Boolean);
  const cache = new Map();
  function atPoint(lon, lat) {
    const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
    if (!cache.has(key)) { if (cache.size > 5000) cache.clear(); cache.set(key, shapes.find(s => lon >= s.box[0] && lon <= s.box[2] && lat >= s.box[1] && lat <= s.box[3] && s.polygons.some(p => polygonContains(p, lon, lat)))?.code || null); }
    return cache.get(key);
  }
  // Context placements (vendor or company HQ) say nothing about where something happened, so they never count.
  return e => {
    if (e.country && countries[e.country]) return e.country;
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || ['vendor_hq', 'company_hq', 'unlocated'].includes(e.place_basis)) return null;
    if (e.place_basis === 'country_centroid') { const code = byName.get(norm(e.place)); if (code) return code; }
    return atPoint(e.lon, e.lat);
  };
}

export function computeHotspots(reports, { resolve, countries, now = Date.now(), limit = 12, since = null } = {}) {
  // A feed's first collection lands days of backlog at once, which looks like a spike against an empty week.
  // Only sources collected for a full week (`since`: source ID -> first successful poll) count toward spikes;
  // without that record, fall back to signal types whose oldest report is a week old.
  const earliest = new Map();
  for (const e of reports) { const t = Date.parse(e.ts), f = family(e); if (Number.isFinite(t) && t < (earliest.get(f) ?? Infinity)) earliest.set(f, t); }
  const mature = since ? e => (since[e.feed_id || e.source_id] ?? Infinity) <= now - 7 * DAY : e => (earliest.get(family(e)) ?? Infinity) <= now - 7 * DAY;
  // Machine-coded fighting is chronic in some countries (and statements made in Washington are coded as US
  // events), so a GDELT report only counts toward a hot spot when it escalates: outlets for that day at least
  // double the country's average over 3+ earlier days held, and at least 5 more than that average.
  const conflictDays = new Map();
  for (const e of reports) if (e.kind === 'conflict' && e.country) { if (!conflictDays.has(e.country)) conflictDays.set(e.country, new Map()); const days = conflictDays.get(e.country), d = e.ts.slice(0, 10); days.set(d, Math.max(days.get(d) || 0, e.outlets || 0)); }
  const escalating = e => {
    const earlier = [...(conflictDays.get(e.country) || [])].filter(([d]) => d < e.ts.slice(0, 10)).map(([, o]) => o);
    if (earlier.length < 3) return false;
    const mean = earlier.reduce((s, o) => s + o, 0) / earlier.length;
    return (e.outlets || 0) >= Math.max(2 * mean, mean + 5);
  };
  const byCountry = new Map();
  for (const e of reports) {
    if (e.kind === 'conflict' && !escalating(e)) continue;
    const t = Date.parse(e.ts); if (!Number.isFinite(t) || t < now - 8 * DAY) continue;
    const code = resolve(e); if (!code) continue;
    if (!byCountry.has(code)) byCountry.set(code, { recent: [], previous: 0 });
    const bucket = byCountry.get(code);
    // An ongoing outage stays a current signal even when it started days ago.
    if (t >= now - DAY || e.ongoing === true) bucket.recent.push(e); else if (t < now - DAY && mature(e)) bucket.previous++;
  }
  const spots = [];
  for (const [code, { recent, previous }] of byCountry) {
    if (!recent.length) continue;
    const counts = new Map(); for (const e of recent) { const f = family(e); counts.set(f, (counts.get(f) || 0) + 1); }
    const fresh = recent.filter(e => Date.parse(e.ts) >= now - DAY && mature(e)).length, baseline = previous / 7;
    const spike = fresh >= 4 && fresh >= 3 * Math.max(baseline, 1) ? { last24: fresh, baselineDaily: Math.round(baseline * 10) / 10, ratio: Math.round(fresh / Math.max(baseline, 1) * 10) / 10 } : null;
    // Two unrelated background signals (one ransomware claim, one quake) are too common to flag on their own:
    // a mixed spot needs a strong signal in the mix (internet or routing trouble, or fighting that has
    // escalated; steady fighting was filtered out above), or at least three reports.
    const internetLed = counts.has('internet') || counts.has('routing') || counts.has('conflict');
    // Ransomware, breach and confirmed-incident reports are flavors of one signal (criminal attacks); the
    // US logs them daily, so together they count once. Hacktivist claims stay separate: they track conflict.
    const kinds = new Set([...counts.keys()].map(f => ['ransomware', 'claims', 'incident'].includes(f) ? 'attacks' : f)).size;
    if (!spike && !(kinds >= 2 && (internetLed || recent.length >= 3))) continue;
    const c = countries[code] || {}, sorted = [...recent].sort((a, b) => b.score - a.score || Date.parse(b.ts) - Date.parse(a.ts));
    const basis = [];
    if (kinds >= 2) basis.push(`${kinds} kinds of signal in the last 24 hours`);
    if (spike) basis.push(`${fresh} reports in 24 hours vs ${spike.baselineDaily} a day over the previous week`);
    spots.push({ id: 'hotspot-' + code, country: code, name: c.name || code, lat: c.lat ?? null, lon: c.lon ?? null,
      families: [...counts].map(([id, count]) => ({ id, label: families[id], count })).sort((a, b) => b.count - a.count),
      kinds, report_count: recent.length, report_ids: sorted.slice(0, 40).map(e => e.id), top: sorted.filter((e, i) => sorted.findIndex(x => x.title === e.title) === i).slice(0, 3).map(e => ({ id: e.id, title: e.title, source: e.source, ts: e.ts, url: e.url || null })),
      latest_ts: recent.reduce((m, e) => e.ts > m ? e.ts : m, recent[0].ts), spike, basis });
  }
  return spots.sort((a, b) => b.kinds - a.kinds || Number(!!b.spike) - Number(!!a.spike) || b.report_count - a.report_count || a.country.localeCompare(b.country)).slice(0, limit);
}

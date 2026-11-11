// "Since you looked": compare the situation now against a stored checkpoint from when the viewer last looked.
// Checkpoints are small summaries saved every 15 minutes and kept 8 days; reports themselves are not copied.
const MINUTE = 60000, DAY = 86400000, rank = { green: 0, amber: 1, red: 2 };

export function situation({ status = [], hotspots = [], events = [] } = {}, now = Date.now()) {
  const epss = {};
  for (const e of events) if (e.epss && e.epss.epss >= 0) epss[e.epss.cve] = e.epss.epss;
  return { ts: new Date(now).toISOString(),
    levels: Object.fromEntries(status.map(t => [t.id, t.level])),
    hotspots: hotspots.map(h => ({ id: h.id, name: h.name, families: h.families.length })),
    outages: [...new Set(events.filter(e => e.kind === 'outage' && e.ongoing && e.country).map(e => e.country))].sort(),
    epss };
}

export function createCheckpoints(db) {
  db.exec('CREATE TABLE IF NOT EXISTS checkpoints (ts TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const latest = () => db.prepare('SELECT ts FROM checkpoints ORDER BY ts DESC LIMIT 1').get()?.ts || null;
  return {
    latest,
    // Saves at most one checkpoint per interval; returns true when it wrote one.
    record(state, now = Date.now(), interval = 15 * MINUTE) {
      const last = latest(); if (last && now - Date.parse(last) < interval) return false;
      db.prepare('INSERT OR REPLACE INTO checkpoints VALUES (?, ?)').run(state.ts, JSON.stringify(state));
      db.prepare('DELETE FROM checkpoints WHERE ts < ?').run(new Date(now - 8 * DAY).toISOString());
      return true;
    },
    // The last checkpoint at or before `since`; if history starts later, the earliest one (the digest says so).
    at(since) {
      const row = db.prepare('SELECT data FROM checkpoints WHERE ts <= ? ORDER BY ts DESC LIMIT 1').get(since) || db.prepare('SELECT data FROM checkpoints ORDER BY ts ASC LIMIT 1').get();
      return row ? JSON.parse(row.data) : null;
    },
    between(since) { return db.prepare('SELECT data FROM checkpoints WHERE ts > ? ORDER BY ts').all(since).map(r => JSON.parse(r.data)); }
  };
}

export function buildDigest({ since, then, between = [], current, status = [], events = [], countries = {}, now = Date.now() }) {
  const sinceMs = Date.parse(since), name = code => countries[code]?.name || code;
  const tileLabels = Object.fromEntries(status.map(t => [t.id, t.label]));
  const tiles = status.map(t => {
    const before = then?.levels?.[t.id] || null, peak = [...between.map(c => c.levels?.[t.id]), t.level, before].filter(Boolean).reduce((a, b) => rank[b] > rank[a] ? b : a, 'green');
    return { id: t.id, label: tileLabels[t.id], then: before, now: t.level, peak, changed: before !== null && before !== t.level, peaked: rank[peak] > Math.max(rank[t.level], rank[before] ?? 0) };
  });
  const thenSpots = new Map((then?.hotspots || []).map(h => [h.id, h])), nowSpots = new Map(current.hotspots.map(h => [h.id, h]));
  const thenOut = new Set(then?.outages || []), nowOut = new Set(current.outages);
  // An EPSS move matters when the score crosses into meaningful territory: up 10 points, or doubled to at least 10%.
  const movers = Object.entries(current.epss).map(([cve, value]) => ({ cve, then: then?.epss?.[cve], now: value }))
    .filter(m => m.then !== undefined && (m.now - m.then >= 0.1 || (m.now >= 0.1 && m.now >= 2 * m.then)))
    .sort((a, b) => (b.now - b.then) - (a.now - a.then)).slice(0, 10);
  const fresh = events.filter(e => { const t = Date.parse(e.ts); return Number.isFinite(t) && t > sinceMs && t <= now + 5 * MINUTE; });
  const bySource = new Map(); for (const e of fresh) bySource.set(e.source, (bySource.get(e.source) || 0) + 1);
  const totals = { cyber: 0, geo: 0, ai: 0, social: 0 }; for (const e of fresh) { totals[e.category] = (totals[e.category] || 0) + 1; if (e.platform) totals.social++; }
  const kev = fresh.filter(e => e.source === 'CISA KEV').map(e => ({ id: e.id, title: e.title })).slice(0, 10);
  const critical = fresh.filter(e => e.kind === 'vulnerability').sort((a, b) => (b.epss?.epss || 0) - (a.epss?.epss || 0)).map(e => ({ id: e.id, title: e.title, epss: e.epss?.epss ?? null })).slice(0, 8);
  const trending = status.find(t => t.id === 'social')?.inputs?.find(i => /CVEs named/.test(i.label))?.note || '';
  const digest = { since, until: new Date(now).toISOString(), history_from: then?.ts || null, partial: !then || Date.parse(then.ts) > sinceMs + 20 * MINUTE,
    tiles, hotspots: { added: [...nowSpots.values()].filter(h => !thenSpots.has(h.id)), cleared: [...thenSpots.values()].filter(h => !nowSpots.has(h.id)) },
    outages: { started: [...nowOut].filter(c => !thenOut.has(c)).map(c => ({ code: c, name: name(c) })), ended: [...thenOut].filter(c => !nowOut.has(c)).map(c => ({ code: c, name: name(c) })) },
    epss_movers: movers, kev, critical, trending, totals, report_count: fresh.length,
    sources: [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([source, count]) => ({ source, count })) };
  // A stretch the app was not watching is never called quiet.
  digest.quiet = !digest.partial && !digest.tiles.some(t => t.changed || t.peaked) && !digest.hotspots.added.length && !digest.outages.started.length && !movers.length && !kev.length;
  return digest;
}

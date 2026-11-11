// Top stories for the live wall crawl and the kiosk tour: the past hour's strongest stories, widening to 3, 6, 12 and
// then 24 hours when the hour is quiet. An ongoing outage that began before the window is not news in it and stays out,
// and at most two outages make the list, so measured outages cannot crowd out reported stories.
const WINDOWS = [1, 3, 6, 12, 24], HOUR = 3600000, MAX_OUTAGES = 2;

export function topHeadlines(stories, { now = Date.now(), min = 8, limit = 15 } = {}) {
  const inWindow = hours => stories.filter(s => {
    const last = Date.parse(s.ts), first = Date.parse(s.first_ts || s.ts), from = now - hours * HOUR;
    if (!(last >= from) || last > now + 5 * 60000) return false;
    return s.kind !== 'outage' || first >= from;
  });
  let window = WINDOWS[0], pool = [];
  for (const hours of WINDOWS) { window = hours; pool = inWindow(hours); if (pool.length >= min) break; }
  pool.sort((a, b) => (b.score || 0) - (a.score || 0) || Date.parse(b.ts) - Date.parse(a.ts) || String(a.id).localeCompare(String(b.id)));
  const rows = []; let outages = 0;
  for (const s of pool) {
    if (rows.length >= limit) break;
    if (s.kind === 'outage') { if (outages >= MAX_OUTAGES) continue; outages++; }
    rows.push({ id: s.id, title: s.title, source: s.source, source_key: s.source_key, category: s.category, url: s.url, ts: s.ts, first_ts: s.first_ts || s.ts, score: s.score ?? null, report_count: s.report_count || 1, kind: s.kind || null });
  }
  return { window_hours: window, rows };
}

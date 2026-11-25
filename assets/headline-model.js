// Shared by the server and the Kiosk region selector so candidate limits follow the same ranking rules.
globalThis.CapstoneHeadlines = (() => {
  const WINDOWS = [1, 3, 6, 12, 24];
  const HOUR = 3_600_000;
  const MAX_OUTAGES = 2;
  const MAX_UNVERIFIED = 3;
  const FIRST_PASS_PER_SOURCE = 4;
  const { evidence, latestReceipt, isNewsCodingAggregate } = globalThis.CapstoneTypes;

  function select(pool, limit) {
    const chosen = new Set();
    const sourceCounts = new Map();
    let outages = 0;
    let unverified = 0;

    function pass(perSource) {
      for (const item of pool) {
        if (chosen.size >= limit) break;
        const { story, source, uncertain } = item;
        if (chosen.has(item) || (story.kind === 'outage' && outages >= MAX_OUTAGES) ||
          (uncertain && unverified >= MAX_UNVERIFIED)) continue;
        const count = sourceCounts.get(source) || 0;
        if (count >= perSource) continue;
        sourceCounts.set(source, count + 1);
        if (story.kind === 'outage') outages++;
        if (uncertain) unverified++;
        chosen.add(item);
      }
    }

    pass(FIRST_PASS_PER_SOURCE);
    if (chosen.size < limit) pass(Infinity);
    return pool.filter(item => chosen.has(item));
  }

  function rank(stories, { now = Date.now(), min = 8, limit = 15, listed = false, received = false } = {}) {
    const candidates = stories.flatMap(story => {
      if (isNewsCodingAggregate(story)) return [];
      const date = Date.parse(received ? story.latest_received || story.first_received : story.ts);
      if (!Number.isFinite(date) || (!listed && date < now - 24 * HOUR) || date > now + 5 * 60000 || story.outage_state === 'stale') return [];
      const classification = evidence(story);
      return [{ story, date, firstDate: Date.parse(story.first_ts || story.ts), classification,
        source: story.source_key || story.feed_id || story.source || 'Unknown source',
        uncertain: ['Claim', 'Unverified'].includes(classification) }];
    }).sort((a, b) => (b.story.score || 0) - (a.story.score || 0) || b.date - a.date || String(a.story.id).localeCompare(String(b.story.id)));

    if (listed) return {window:null,selected:select(candidates,limit)};
    let window = WINDOWS[0];
    let selected = [];
    for (const hours of WINDOWS) {
      window = hours;
      const cutoff = now - hours * HOUR;
      selected = select(candidates.filter(item => item.date >= cutoff && (received || hours===24 || item.story.date_precision!=='day') &&
        (received || item.story.kind!=='outage' || item.firstDate>=cutoff)), limit);
      if (selected.length >= Math.min(min, limit)) break;
    }
    return {window,selected};
  }
  function projectMatchingReports(story,accept) {
    const reports = (story.reports || [story]).filter(accept);
    if (!reports.length) return null;
    const representative = reports.find(report=>report.id===story.representative_id) || reports[0];
    const latest = reports.reduce((mostRecent,report)=>report.ts>mostRecent.ts ? report : mostRecent,representative);
    const first = reports.reduce((earliest,report)=>report.ts<earliest ? report.ts : earliest,representative.ts);
    return {...representative,id:story.id,revision:story.revision,representative_id:representative.id,
      ts:latest.ts,date_precision:latest.date_precision,first_ts:first,latest_received:latestReceipt(reports),reports,report_count:reports.length,
      ongoing:representative.outage_state==='current',
      epss:representative.cves?.includes(story.epss?.cve) ? story.epss : undefined};
  }
  return {rank,projectMatchingReports};
})();

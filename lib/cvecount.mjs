// Day's CVE total for the live wall: how many CVEs NVD has published since local midnight (all severities, not only the
// critical ones the NVD feed collects; rejected/withdrawn CVEs excluded with noRejected), and for comparison the full-day total for the same date last year. Each count is one
// keyless request asking for a single result: NVD's totalResults is the count. Today's count refetches at most hourly;
// last year's is fetched once per day. A failure keeps the last good count marked stale and retries after 10 minutes; a new
// local day fetches at once. Collectors off means no request at all.
const HOUR = 3600000, RETRY = 10 * 60000;
const iso = t => new Date(t).toISOString().replace('Z', '');
export const localMidnight = (now = Date.now()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const localDate = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// The same calendar date one year earlier, local midnight to the next local midnight (29 Feb falls back to 28 Feb).
export function sameDayLastYear(now = Date.now()) {
  const d = new Date(localMidnight(now)), month = d.getMonth(); d.setFullYear(d.getFullYear() - 1); if (d.getMonth() !== month) d.setDate(0);
  const end = new Date(d); end.setDate(end.getDate() + 1);
  return { start: d.getTime(), end: end.getTime() };
}
export const cveCountUrl = (start, end) => `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${iso(start)}&pubEndDate=${iso(end)}&resultsPerPage=1&noRejected`;

export function createCveCount({ request = fetch, enabled = true, clock = Date.now } = {}) {
  let today = { date: null, total: null, asOf: null, stale: false, error: null }, lastYear = { date: null, total: null, error: null };
  let nextAt = 0, pending = null;
  async function count(start, end) {
    const res = await request(cveCountUrl(start, end), { headers: { 'User-Agent': 'CapstoneViewer/0.1 (+local OSINT dashboard)', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`NVD returned HTTP ${res.status}`);
    const total = (await res.json())?.totalResults;
    if (!Number.isInteger(total) || total < 0) throw new Error('NVD gave no count');
    return total;
  }
  async function refresh() {
    const now = clock(), date = localDate(now), prior = sameDayLastYear(now), priorDate = localDate(prior.start);
    if (today.date !== date) today = { date, total: null, asOf: null, stale: false, error: null };
    let failed = false;
    try { today = { date, total: await count(localMidnight(now), now), asOf: new Date(now).toISOString(), stale: false, error: null }; }
    catch (error) { failed = true; today = { ...today, stale: today.total !== null, error: String(error.message).slice(0, 120) }; }
    if (lastYear.date !== priorDate || lastYear.total === null) {
      try { lastYear = { date: priorDate, total: await count(prior.start, prior.end), error: null }; }
      catch (error) { failed = true; lastYear = { date: priorDate, total: null, error: String(error.message).slice(0, 120) }; }
    }
    nextAt = now + (failed ? RETRY : HOUR);
    return snapshot();
  }
  const snapshot = () => ({ ...today, lastYear });
  return {
    async get() {
      if (!enabled) return { ...snapshot(), disabled: true };
      const now = clock();
      if (now < nextAt && today.date === localDate(now)) return snapshot();
      pending ||= refresh().finally(() => { pending = null; });
      return pending;
    }
  };
}

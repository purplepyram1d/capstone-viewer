import { inflateRawSync } from 'node:zlib';
import { event, safeUrl } from './events.mjs';

// GDELT 2.0 event exports: machine-coded from world news every 15 minutes. Raw rows are noisy (crime coded as
// "military force", statements about strikes placed where they were made), so only clearly kinetic actions
// count, rolled up to one report per country per UTC day, and only when several separate outlets carry them.
export const gdeltBase = 'https://data.gdeltproject.org/gdeltv2/';
const ARMED = new Set(['MIL', 'REB', 'INS', 'SEP', 'UAF']);
// Bombings, artillery and tanks, air strikes, ceasefire violations and mass violence count on their own.
const KINETIC = /^(183|194|195|196|20)/;
// Assaults, abductions and blockades count only when an armed actor is involved. The generic "use military
// force" (190) and "small arms" (193) codes are dropped: in testing they were mostly crime and statements.
const ARMED_ONLY = /^(18[0-6]|192)/;
const MIN_EVENTS = 5, MIN_OUTLETS = 3;
const signalTitle = (name,date) => `GDELT news coding · ${name} · ${date}`;
const signalSummary = (rows,domains) => `GDELT assigned violence-related codes to ${rows} database rows from ${domains} website domains. Repeated and syndicated articles can produce multiple rows. Review linked coverage to verify the event and its location.`;
export function relabelLegacy(report) {
  if (report?.source!=='GDELT') return null;
  const current = String(report.title).match(/^GDELT signal: (\d+) news reports from (\d+) outlets machine-coded as armed violence in (.+?) (?:today|on (\d{4}-\d{2}-\d{2}))$/);
  const earlier = String(report.title).match(/^Fighting reported in (.+): (\d+) machine-coded events from (\d+) outlets (?:today|on (\d{4}-\d{2}-\d{2}))$/);
  if (!current && !earlier) return null;
  const [name,rows,domains,date] = current ? [current[3],current[1],current[2],current[4]] : earlier.slice(1);
  return {...report,kind:'conflict',title:signalTitle(name,date || String(report.ts).slice(0,10)),summary:signalSummary(rows,domains),
    lat:null,lon:null,place_basis:'unlocated',score:25,source_date_basis:'catalog_observation',
    date_precision:'day',coded_events:Number(rows),outlets:Number(domains)};
}
const stamp = t => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const stampTime = s => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));

export function unzipSingle(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('GDELT export is not a zip file');
  const method = buf.readUInt16LE(8), size = buf.readUInt32LE(18), start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const body = buf.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(body) : body).toString('utf8');
}

export function conflictRows(tsv, resolve) {
  const rows = [];
  for (const line of tsv.split('\n')) {
    const c = line.split('\t'); if (c.length < 61) continue;
    const code = c[26]; if (!/^(18|19|20)/.test(code)) continue;
    const armed = [c[12], c[13], c[14], c[22], c[23], c[24]].some(x => ARMED.has(x)) || !!c[8] || !!c[18];
    if (!(KINETIC.test(code) || (armed && ARMED_ONLY.test(code)))) continue;
    const lat = Number(c[56]), lon = Number(c[57]); if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const country = resolve({ lat, lon, place_basis: 'event_location' }); if (!country) continue;
    const url = safeUrl(c[60]);
    if (!url) continue;
    const host = new URL(url).hostname.replace(/^www\./, '');
    rows.push({ country, code, place: c[52], url, host, added: /^\d{14}$/.test(c[59]) ? stampTime(c[59]) : null });
  }
  return rows;
}

export function createGdelt({ resolve, countries, request = fetch, now = () => Date.now() }) {
  const days = new Map(), done = new Set();
  function add(rows) {
    for (const r of rows) {
      if (!r.added) continue;
      const key = `${new Date(r.added).toISOString().slice(0, 10)}|${r.country}`;
      if (!days.has(key)) days.set(key, { events: 0, hosts: new Set(), urls: new Map(), latest: 0 });
      const d = days.get(key); d.events++; d.hosts.add(r.host);
      d.urls.set(r.url, (d.urls.get(r.url) || 0) + 1); d.latest = Math.max(d.latest, r.added);
    }
  }
  async function fetchStamp(s) {
    const response = await request(`${gdeltBase}${s}.export.CSV.zip`, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'CapstoneViewer/0.1 (+local OSINT dashboard)' } });
    // GDELT lists each file a few minutes before it exists; a recent 404 is retried, an old one is given up.
    if (response.status === 404) { if (now() - stampTime(s) > 3 * 3600000) done.add(s); return; }
    if (!response.ok) throw new Error(`GDELT returned HTTP ${response.status}`);
    add(conflictRows(unzipSingle(Buffer.from(await response.arrayBuffer())), resolve)); done.add(s);
  }
  return {
    async collect() {
      // Every 15-minute file of the current UTC day (a restart backfills the day), at most 100 per run.
      const t = now(), day = new Date(t); day.setUTCHours(0, 0, 0, 0);
      const wanted = []; for (let x = day.getTime(); x <= t - 15 * 60000; x += 15 * 60000) if (!done.has(stamp(x))) wanted.push(stamp(x));
      const batch = wanted.slice(0, 100); let failures = 0, lastError = null;
      for (let i = 0; i < batch.length; i += 4) await Promise.all(batch.slice(i, i + 4).map(s => fetchStamp(s).catch(e => { failures++; lastError = e; })));
      if (batch.length && failures === batch.length) throw lastError;
      const keep = new Date(t - 2 * 86400000).toISOString().slice(0, 10);
      for (const key of days.keys()) if (key.slice(0, 10) < keep) days.delete(key);
      for (const s of done) if (stampTime(s) < t - 2 * 86400000) done.delete(s);
      return [...days].filter(([, d]) => d.events >= MIN_EVENTS && d.hosts.size >= MIN_OUTLETS).map(([key, d]) => {
        const [date, code] = key.split('|'), c = countries[code]; if (!c) return null;
        const links = [...d.urls].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,8).map(([url])=>url);
        return event({ key: `gdelt:${date}:${code}`, ts: new Date(d.latest).toISOString(), source: 'GDELT', category: 'geo', kind: 'conflict', country: code,
          title: signalTitle(c.name,date),summary:signalSummary(d.events,d.hosts.size),
          url:links[0],citation_urls:links,place:c.name,place_basis:'unlocated',confidence:'Machine-coded from news (GDELT)',
          score:25,source_date_basis:'catalog_observation',date_precision:'day',outlets:d.hosts.size,coded_events:d.events }, t);
      }).filter(Boolean);
    }
  };
}

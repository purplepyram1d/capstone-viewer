import { inflateRawSync } from 'node:zlib';
import { event } from './events.mjs';

// GDELT 2.0 event exports: machine-coded from world news every 15 minutes. Raw rows are noisy (crime coded as
// "military force", statements about strikes placed where they were made), so only clearly kinetic actions
// count, rolled up to one report per country per UTC day, and only when several separate outlets carry them.
const BASE = 'http://data.gdeltproject.org/gdeltv2/';
const ARMED = new Set(['MIL', 'REB', 'INS', 'SEP', 'UAF']);
// Bombings, artillery and tanks, air strikes, ceasefire violations and mass violence count on their own.
const KINETIC = /^(183|194|195|196|20)/;
// Assaults, abductions and blockades count only when an armed actor is involved. The generic "use military
// force" (190) and "small arms" (193) codes are dropped: in testing they were mostly crime and statements.
const ARMED_ONLY = /^(18[0-6]|192)/;
const MIN_EVENTS = 5, MIN_OUTLETS = 3;
// The title says what this is (news a machine tagged as violence), never that fighting happened: on 2026-11-04 every one of
// 24 United States rows was a misread (a plane crash coded as a bombing, election coverage, foreign strikes placed in Washington).
const signalTitle = (name, events, outlets, when) => `GDELT signal: ${events} news reports from ${outlets} outlets machine-coded as armed violence in ${name} ${when}`;
const signalSummary = (name, events, outlets, places) => `GDELT's automatic coding tagged ${events} news reports from ${outlets} outlets as armed violence (air strikes, artillery, bombings, armed assaults) placed in ${name}${places.length ? `, mostly ${places.join(', ')}` : ''}. Not verified, and not a report of fighting: the coding misreads crashes, metaphors and politics, often codes one incident many times, and places stories about strikes elsewhere where officials spoke. Open the source to check.`;
// Stored roll-ups from before 2026-11-04 carry "Fighting reported in X: ..." titles. The server rewrites them once at
// startup through its own connection; returns the relabelled report, or null when the title is not the old form.
export function relabelLegacy(e) {
  const m = e?.source === 'GDELT' && String(e.title).match(/^Fighting reported in (.+): (\d+) machine-coded events from (\d+) outlets (?:today|on (\d{4}-\d{2}-\d{2}))$/);
  if (!m) return null;
  const [, name, events, outlets, date] = m, places = String(e.summary || '').match(/, mostly (.+?), from \d+ separate outlets/)?.[1]?.split(', ') || [];
  return { ...e, title: signalTitle(name, events, outlets, `on ${date || String(e.ts).slice(0, 10)}`), summary: signalSummary(name, events, outlets, places) };
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
    let host = ''; try { host = new URL(c[60]).hostname.replace(/^www\./, ''); } catch {}
    rows.push({ country, code, place: c[52], url: c[60], host, added: /^\d{14}$/.test(c[59]) ? stampTime(c[59]) : null });
  }
  return rows;
}

export function createGdelt({ resolve, countries, request = fetch, now = () => Date.now() }) {
  const days = new Map(), done = new Set();
  function add(rows) {
    for (const r of rows) {
      if (!r.added) continue;
      const key = `${new Date(r.added).toISOString().slice(0, 10)}|${r.country}`;
      if (!days.has(key)) days.set(key, { events: 0, hosts: new Set(), places: new Map(), urls: new Map(), kinetic: 0, latest: 0 });
      const d = days.get(key); d.events++; if (r.host) d.hosts.add(r.host); if (KINETIC.test(r.code)) d.kinetic++;
      d.places.set(r.place, (d.places.get(r.place) || 0) + 1); d.urls.set(r.url, (d.urls.get(r.url) || 0) + 1); d.latest = Math.max(d.latest, r.added);
    }
  }
  async function fetchStamp(s) {
    const response = await request(`${BASE}${s}.export.CSV.zip`, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'CapstoneViewer/0.1 (+local OSINT dashboard)' } });
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
      const today = new Date(t).toISOString().slice(0, 10);
      return [...days].filter(([, d]) => d.events >= MIN_EVENTS && d.hosts.size >= MIN_OUTLETS).map(([key, d]) => {
        const [date, code] = key.split('|'), c = countries[code]; if (!c) return null;
        const places = [...d.places].sort((a, b) => b[1] - a[1]).map(([p]) => p.split(',')[0]).filter((p, i, list) => p && list.indexOf(p) === i).slice(0, 3);
        const url = [...d.urls].sort((a, b) => b[1] - a[1])[0]?.[0];
        return event({ key: `gdelt:${date}:${code}`, ts: new Date(d.latest).toISOString(), source: 'GDELT', category: 'geo', kind: 'conflict', country: code,
          title: signalTitle(c.name, d.events, d.hosts.size, date === today ? 'today' : 'on ' + date),
          summary: signalSummary(c.name, d.events, d.hosts.size, places),
          url, lat: c.lat, lon: c.lon, place: c.name, place_basis: 'country_centroid', confidence: 'Machine-coded from news (GDELT)',
          score: (d.hosts.size >= 10 ? 65 : 55) + (d.kinetic * 2 >= d.events ? 5 : 0), outlets: d.hosts.size, coded_events: d.events }, t);
      }).filter(Boolean);
    }
  };
}

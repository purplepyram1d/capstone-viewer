import { event } from './events.mjs';

// Internet-health measurements. These are automated anomaly detections and operator annotations,
// never attribution: a drop in a country's signals does not say who or what caused it.
const iodaSignals = { bgp: 'BGP routing visibility', 'ping-slash24': 'active probing (ping)', gtr: 'Google traffic', 'merit-nt': 'network telescope traffic' };
const isoTime = seconds => new Date(seconds * 1000).toISOString();
const utc = seconds => isoTime(seconds).slice(0, 16).replace('T', ' ') + 'Z';
const countryPoint = (code, countries) => { const c = countries[String(code || '').toUpperCase()]; return c ? { country: String(code).toUpperCase(), lat: c.lat, lon: c.lon, place: c.name, place_basis: 'country_centroid' } : {}; };

export function iodaUrl(now = Date.now()) {
  const until = Math.floor(now / 1000);
  return `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${until - 2 * 86400}&until=${until}&entityType=country&includeAlerts=false&format=ioda`;
}

export function normalizeIODA(data, countries, now = Date.now()) {
  if (!Array.isArray(data?.data)) throw new Error('Invalid IODA outage events');
  const requested = Number(data.requestParameters?.until) || Math.floor(now / 1000);
  return data.data.filter(o => o?.entity?.type === 'country' && Number.isFinite(o.from)).map(o => {
    const ongoing = o.until >= requested - 600, signal = iodaSignals[o.datasource] || o.datasource, code = o.entity.code;
    return event({ key: `ioda:${code}:${o.datasource}:${o.from}`, ts: isoTime(o.from), source: 'IODA', category: 'cyber', kind: 'outage', ongoing,
      title: `Internet disruption: ${o.entity.name}${ongoing ? ' (ongoing)' : ''}`,
      summary: `IODA measured ${signal} for ${o.entity.name} below its ${o.method || 'historical'} baseline from ${utc(o.from)}${ongoing ? '; still below baseline at the last check' : ` until ${utc(o.until)}`}. Automated measurement; the cause is not established.`,
      url: `https://ioda.inetintel.cc.gatech.edu/country/${encodeURIComponent(code)}?from=${o.from}&until=${o.until}`,
      score: o.score >= 100000 ? 85 : o.score >= 10000 ? 75 : 60, confidence: 'Measured anomaly · IODA automated detection', signal: o.datasource,
      ...countryPoint(code, countries) }, now);
  }).filter(Boolean);
}

export function normalizeRadarOutages(data, countries, now = Date.now()) {
  const rows = data?.result?.annotations;
  if (data?.success !== true || !Array.isArray(rows)) throw new Error('Invalid Cloudflare Radar outage annotations');
  return rows.map(a => {
    const places = (a.locationsDetails || []).map(l => l.name).filter(Boolean), cause = String(a.outage?.outageCause || 'UNKNOWN').replace(/_/g, ' ').toLowerCase();
    const type = String(a.outage?.outageType || '').toLowerCase(), ongoing = !a.endDate;
    return event({ key: `radar-outage:${a.id}`, ts: a.startDate, source: 'Cloudflare Radar', category: 'cyber', kind: 'outage', ongoing,
      title: `Internet outage: ${places.join(', ') || a.scope || 'unspecified location'}${type ? ` · ${type}` : ''}${ongoing ? ' (ongoing)' : ''}`,
      summary: `${a.description || 'Outage annotated by Cloudflare Radar.'} Reported cause: ${cause}.${a.scope ? ` Scope: ${a.scope}.` : ''}${(a.asnsDetails || []).length ? ` Networks: ${a.asnsDetails.slice(0, 4).map(n => `${n.name} (AS${n.asn})`).join(', ')}.` : ''}`,
      url: a.linkedUrl || 'https://radar.cloudflare.com/outage-center', score: a.outage?.outageCause === 'GOVERNMENT_DIRECTED' || a.outage?.outageType === 'NATIONWIDE' ? 85 : 75,
      confidence: 'Operator annotation · Cloudflare Radar', ...((a.locations || []).length === 1 ? countryPoint(a.locations[0], countries) : {}) }, now);
  }).filter(Boolean);
}

export function normalizeRadarHijacks(data, countries, now = Date.now()) {
  const rows = data?.result?.events;
  if (data?.success !== true || !Array.isArray(rows)) throw new Error('Invalid Cloudflare Radar hijack events');
  return rows.filter(h => h.is_stale !== true).map(h => {
    const victims = (h.victim_asns || []).map(a => 'AS' + a), prefixes = h.prefixes || [], victimCountries = [...new Set(h.victim_countries || [])];
    return event({ key: `radar-hijack:${h.id}`, ts: h.min_hijack_ts, source: 'Cloudflare Radar', category: 'cyber', kind: 'routing',
      title: `Possible BGP hijack: AS${h.hijacker_asn} announced ${prefixes.length} prefix${prefixes.length === 1 ? '' : 'es'} of ${victims.slice(0, 3).join(', ') || 'another network'}`,
      summary: `Cloudflare Radar flagged AS${h.hijacker_asn}${h.hijacker_country ? ` (${h.hijacker_country})` : ''} originating ${prefixes.slice(0, 4).join(', ')}${prefixes.length > 4 ? ' and more' : ''}. Confidence ${h.confidence_score} on Radar's 1-10 scale. Seen by ${h.peer_ip_count ?? 'an unknown number of'} peers. Detection, not a confirmed attack; route changes also come from misconfiguration.`,
      url: 'https://radar.cloudflare.com/routing', score: h.confidence_score >= 9 ? 80 : 70, confidence: 'Automated detection · Cloudflare Radar',
      ...(victimCountries.length === 1 ? countryPoint(victimCountries[0], countries) : {}) }, now);
  }).filter(Boolean);
}

// Global routing churn from one RIPE RIS collector. Counts BGP withdrawals per minute and flags
// a surge against the trailing median. It locates nothing: a surge can be one large network flapping.
export function createBgpPulse({ onSurge = () => {}, onChange = () => {}, WebSocketImpl = globalThis.WebSocket, url = 'wss://ris-live.ripe.net/v1/ws/?client=capstone-viewer', host = 'rrc00', now = () => Date.now() } = {}) {
  const buckets = new Map(); let socket = null, state = 'idle', error = null, lastMessage = null, retry = 5000, timer = null, lastSurge = 0, stopped = false;
  const minute = t => Math.floor(t / 60000) * 60000;
  function count(ann, wd) { const key = minute(now()); const b = buckets.get(key) || { t: key, ann: 0, wd: 0 }; b.ann += ann; b.wd += wd; buckets.set(key, b); lastMessage = now(); }
  function trim() { const cutoff = minute(now()) - 180 * 60000; for (const key of buckets.keys()) if (key < cutoff) buckets.delete(key); }
  function summary() {
    trim(); const current = minute(now()), complete = [...buckets.values()].filter(b => b.t < current).sort((a, b) => a.t - b.t);
    const recent = complete.slice(-5), windows = [];
    for (let i = 0; i + 5 <= complete.length - 5; i += 5) windows.push(complete.slice(i, i + 5).reduce((s, b) => s + b.wd, 0));
    const sorted = [...windows].sort((a, b) => a - b), median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const last5 = recent.length === 5 ? recent.reduce((s, b) => s + b.wd, 0) : null;
    const ratio = median && last5 !== null ? last5 / median : null;
    return { state, error, host, lastMessage: lastMessage ? new Date(lastMessage).toISOString() : null, last5, median, ratio: ratio === null ? null : Math.round(ratio * 10) / 10,
      baselineWindows: windows.length, surge: ratio !== null && windows.length >= 12 && ratio >= 4,
      minutes: complete.slice(-60).map(b => [new Date(b.t).toISOString(), b.ann, b.wd]) };
  }
  function check() {
    const s = summary(); if (!s.surge || now() - lastSurge < 30 * 60000) return;
    lastSurge = now();
    onSurge(event({ key: `ris-surge:${host}:${minute(now())}`, ts: new Date(now()).toISOString(), source: 'RIPE RIS Live', category: 'cyber', kind: 'routing',
      title: `BGP withdrawal surge at RIPE RIS ${host}`,
      summary: `${s.last5.toLocaleString('en-US')} prefix withdrawals in 5 minutes, ${s.ratio}x the trailing median of ${s.median.toLocaleString('en-US')}. Measured at one RIPE collector; a surge can be one large network flapping or a wide outage. No location or attribution established.`,
      url: 'https://ris-live.ripe.net/', score: 70, confidence: 'Measured anomaly · single collector' }, now()));
  }
  function connect() {
    if (stopped) return;
    if (typeof WebSocketImpl !== 'function') { state = 'error'; error = 'WebSocket is unavailable in this runtime.'; onChange(); return; }
    state = 'connecting'; onChange();
    try { socket = new WebSocketImpl(url); } catch (e) { return fail(e); }
    socket.onopen = () => { state = 'ok'; error = null; retry = 5000; socket.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'UPDATE', host } })); onChange(); };
    socket.onmessage = message => { try { const d = JSON.parse(message.data); if (d.type !== 'ris_message') return; count((d.data.announcements || []).reduce((s, a) => s + (a.prefixes?.length || 0), 0), (d.data.withdrawals || []).length); } catch {} };
    socket.onerror = e => { error = String(e?.message || 'RIS Live connection error').slice(0, 180); };
    socket.onclose = () => fail(new Error(error || 'RIS Live connection closed'));
  }
  function fail(e) { socket = null; if (stopped) return; state = 'error'; error = String(e.message).slice(0, 180); onChange(); clearTimeout(timer); timer = setTimeout(connect, retry); retry = Math.min(retry * 2, 300000); }
  const tick = setInterval(check, 60000); tick.unref?.();
  return { start: connect, stop() { stopped = true; clearInterval(tick); clearTimeout(timer); try { socket?.close(); } catch {} }, summary, count, check };
}

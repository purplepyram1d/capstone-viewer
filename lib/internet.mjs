import { event, text } from './events.mjs';
import { usStates } from './us-geography.mjs';

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

const iodaStates = new Map(Object.values(usStates).map(state=>[state.name.toLowerCase(),state]));
const regionScope = 'country/US';
const regionLimit = 100;
export function iodaStateUrl(now=Date.now()) {
  const until = Math.floor(now/1000);
  const params = new URLSearchParams({from:String(until-86400),until:String(until),entityType:'region',relatedTo:regionScope,
    includeAlerts:'false',format:'ioda',extendWindow:String(7*86400),limit:String(regionLimit)});
  return 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?'+params;
}

export function normalizeIodaStates(data,now=Date.now()) {
  const rows = data?.data;
  const query = data?.requestParameters;
  const requested = Number(query?.until);
  if (!Array.isArray(rows) || query?.relatedTo!==regionScope || !Number.isSafeInteger(requested) || Math.abs(now/1000-requested)>300) {
    throw Error('Expected IODA outage events for U.S. states.');
  }
  if (rows.length>=regionLimit) throw Error('The IODA state event limit was reached; coverage may be incomplete.');
  return rows.flatMap(row=>{
    const entity = row?.entity;
    const state = iodaStates.get(String(entity?.name || '').toLowerCase());
    const signal = Object.hasOwn(iodaSignals,row?.datasource) ? iodaSignals[row.datasource] : null;
    if (!state || entity?.type!=='region' || entity.attrs?.country_code!=='US' || !/^\d+$/.test(String(entity.code)) ||
        !signal || !Number.isSafeInteger(row.from) || !Number.isSafeInteger(row.until) || row.from<=0 ||
        row.until-row.from<900 || row.until>requested || row.until<requested-86400) return [];
    const ongoing = row.until===requested;
    const report = event({key:`ioda-region:${entity.code}:${row.datasource}:${row.from}`,ts:isoTime(row.from),source:'IODA',
      category:'cyber',kind:'outage',outage_scope:'state',ongoing,signal:row.datasource,
      title:`Internet disruption signal · ${state.name}`,
      summary:`IODA detected ${signal} below its ${text(row.method) || 'historical'} baseline for ${state.name} from ${utc(row.from)} ${ongoing ? `through the latest source query at ${utc(row.until)}` : `to ${utc(row.until)}`}. State-level measurement; cause and local impact were not established.`,
      url:`https://ioda.inetintel.cc.gatech.edu/region/${entity.code}?from=${row.from}&until=${row.until}`,
      score:row.score>=100_000?74:row.score>=10_000?67:58,confidence:'Measured anomaly · IODA automated detection',
      country:'US',state_codes:[state.code],state_basis:'source_coverage',lat:state.lat,lon:state.lon,place:state.name,
      place_basis:'state_reference',location_note:'State reference point for a regional IODA detection. The source does not identify an incident site.'},now);
    return report ? [report] : [];
  });
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
      url: a.linkedUrl || 'https://radar.cloudflare.com/outage-center', source_url_scope: a.linkedUrl ? undefined : 'archive', score: a.outage?.outageCause === 'GOVERNMENT_DIRECTED' || a.outage?.outageType === 'NATIONWIDE' ? 85 : 75,
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
      url: 'https://radar.cloudflare.com/routing', source_url_scope: 'archive', score: h.confidence_score >= 9 ? 80 : 70, confidence: 'Automated detection · Cloudflare Radar',
      ...(victimCountries.length === 1 ? countryPoint(victimCountries[0], countries) : {}) }, now);
  }).filter(Boolean);
}

// Global routing churn from one RIPE RIS collector. Counts BGP withdrawals per minute and flags
// a surge against the trailing median. It locates nothing: a surge can be one large network flapping.
export function createBgpPulse({ onSurge = () => {}, onChange = () => {}, WebSocketImpl = globalThis.WebSocket, url = 'wss://ris-live.ripe.net/v1/ws/?client=capstone-viewer', host = 'rrc00', now = () => Date.now() } = {}) {
  const buckets = new Map(); let socket = null, state = 'idle', error = null, lastMessage = null, socketActivity = 0, retry = 5000, timer = null, lastSurge = 0, stopped = false;
  const MINUTE = 60_000, WINDOW = 5 * MINUTE;
  const minute = stamp => Math.floor(stamp / MINUTE) * MINUTE;
  function count(ann, wd) {
    const stamp = now(), key = minute(stamp);
    const bucket = buckets.get(key) || {ann:0,wd:0};
    bucket.ann += ann;
    bucket.wd += wd;
    buckets.set(key,bucket);
    lastMessage = socketActivity = stamp;
  }
  function withdrawals(start) {
    let total = 0;
    for (let offset = 0; offset < WINDOW; offset += MINUTE) {
      const bucket = buckets.get(start + offset);
      if (!bucket) return null;
      total += bucket.wd;
    }
    return total;
  }
  function summary() {
    const end = minute(now());
    const cutoff = end - 180 * MINUTE;
    for (const key of buckets.keys()) if (key < cutoff) buckets.delete(key);
    const last5 = withdrawals(end - WINDOW), windows = [];
    for (let start = end - 2 * WINDOW; start >= cutoff; start -= WINDOW) {
      const value = withdrawals(start);
      if (value !== null) windows.push(value);
    }
    windows.sort((a,b)=>a-b);
    const median = windows.length ? windows[Math.floor(windows.length / 2)] : null;
    const ratio = median && last5 !== null ? last5 / median : null;
    const minutes = [];
    if (buckets.size) {
      const first = Math.max(end - 60 * MINUTE, Math.min(...buckets.keys()));
      for (let stamp = first; stamp < end; stamp += MINUTE) {
        const sample = buckets.get(stamp);
        minutes.push([new Date(stamp).toISOString(),sample?.ann ?? null,sample?.wd ?? null]);
      }
    }
    return {state,error,host,lastMessage:lastMessage ? new Date(lastMessage).toISOString() : null,
      last5,median,ratio:ratio === null ? null : Math.round(ratio * 10) / 10,
      baselineWindows:windows.length,surge:state === 'ok' && ratio !== null && windows.length >= 12 && ratio >= 4,minutes};
  }
  function check() {
    if (socket && now() - socketActivity >= 2 * MINUTE) {
      const expired = socket;
      socket = null;
      try { expired.close(); } catch {}
      fail(new Error('No routing updates received for two minutes. Reconnecting.'));
      return;
    }
    const s = summary(); if (!s.surge || now() - lastSurge < 30 * 60000) return;
    lastSurge = now();
    onSurge(event({ key: `ris-surge:${host}:${minute(now())}`, ts: new Date(now()).toISOString(), source: 'RIPE RIS Live', category: 'cyber', kind: 'routing',
      title: `BGP withdrawal surge at RIPE RIS ${host}`,
      summary: `${s.last5.toLocaleString('en-US')} prefix withdrawals in 5 minutes, ${s.ratio}x the trailing median of ${s.median.toLocaleString('en-US')}. Measured at one RIPE collector; a surge can be one large network flapping or a wide outage. No location or attribution established.`,
      url: 'https://ris-live.ripe.net/', source_url_scope: 'archive', score: 70, confidence: 'Measured anomaly · single collector' }, now()));
  }
  function connect() {
    if (stopped || socket) return;
    clearTimeout(timer);
    if (typeof WebSocketImpl !== 'function') { state = 'error'; error = 'WebSocket is unavailable in this runtime.'; onChange(); return; }
    state = 'connecting'; onChange();
    try { socket = new WebSocketImpl(url); } catch (error) { return fail(error); }
    const current = socket;
    socketActivity = now();
    current.onopen = () => {
      if (socket !== current) return;
      state = 'ok'; error = null; retry = 5000; socketActivity = now();
      current.send(JSON.stringify({type:'ris_subscribe',data:{type:'UPDATE',host}}));
      onChange();
    };
    current.onmessage = message => {
      if (socket !== current) return;
      try {
        const data = JSON.parse(message.data);
        if (data.type !== 'ris_message') return;
        count((data.data.announcements || []).reduce((sum,item)=>sum + (item.prefixes?.length || 0),0),
          (data.data.withdrawals || []).length);
      } catch {}
    };
    current.onerror = event => {
      if (socket === current) error = String(event?.message || 'RIS Live connection error').slice(0,180);
    };
    current.onclose = () => {
      if (socket === current) fail(new Error(error || 'RIS Live connection closed'));
    };
  }
  function fail(e) { socket = null; if (stopped) return; state = 'error'; error = String(e.message).slice(0, 180); onChange(); clearTimeout(timer); timer = setTimeout(connect, retry); retry = Math.min(retry * 2, 300000); }
  const tick = setInterval(check, 60000); tick.unref?.();
  return { start: connect, stop() { stopped = true; clearInterval(tick); clearTimeout(timer); try { socket?.close(); } catch {} }, summary, count, check };
}

import { DAY, event, text } from './events.mjs';

export const faaAirportSource = 'FAA airport status';
export const faaAirportReference = 'https://nasstatus.faa.gov/';
export const faaAirportUrl = faaAirportReference + 'api/airport-events';

const types = {
  groundStop: {label:'Ground stop', score:75},
  groundDelay: {label:'Ground delay program', score:65},
  airportClosure: {label:'Airport closure', score:80},
  freeForm: {label:'Airport operating restriction', score:58},
  arrivalDelay: {label:'Arrival delays', score:52},
  departureDelay: {label:'Departure delays', score:52},
  deicing: {label:'Deicing reported', score:45}
};

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) ? Date.parse(value) : NaN;
}

function coordinate(value) {
  return (typeof value === 'number' || typeof value === 'string' && value.trim()) ? Number(value) : NaN;
}

function advisoryLink(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value,'https://www.fly.faa.gov');
    if (!['www.fly.faa.gov','fly.faa.gov'].includes(url.host) || !/^https?:$/.test(url.protocol) ||
        url.username || url.password || !/^\/adv\/adv_(?:otherdis|spt)\.jsp$/i.test(url.pathname)) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

const iso = time => new Date(time).toISOString();
const timeLabel = time => iso(time).slice(0,16).replace('T',' ') + ' UTC';

export function normalizeFaaAirports(data, now = Date.now()) {
  if (!Array.isArray(data)) throw new Error('Invalid FAA airport event list');
  const airports = data.filter(row => row && /^[A-Z0-9]{3,4}$/.test(row.airportId || '') &&
    Object.keys(types).some(key=>Object.hasOwn(row,key)));
  if (data.length && !airports.length) throw new Error('FAA airport event fields were missing');
  const reports = new Map();
  for (const airport of airports) {
    const code = airport.airportId;
    const lat = coordinate(airport.latitude), lon = coordinate(airport.longitude);
    for (const [type,{label,score}] of Object.entries(types)) {
      const item = airport[type];
      if (!item || typeof item !== 'object' || (item.airportId && item.airportId !== code)) continue;
      const cutoffDelay = type === 'arrivalDelay' || type === 'departureDelay';
      const delay = item.avgDelay ?? item.averageDelay;
      const minutes = /^\d{1,4}$/.test(String(delay)) ? Number(delay) : null;
      if (cutoffDelay && (minutes === null || minutes < 30)) continue;
      const starts = timestamp(item.startTime ?? item.eventTime ?? item.issuedDate);
      const updated = timestamp(item.updateTime ?? item.updatedAt);
      const ends = timestamp(item.endTime ?? item.expTime);
      if (starts > now || ends <= now || starts >= ends) continue;
      const date = Number.isFinite(updated) && !(updated < starts) ? updated : starts;
      if (!(date >= now - 30 * DAY && date <= now + 5 * 60_000)) continue;
      const scope = text(item.text);
      const restricted = type === 'airportClosure' && scope.length > 0;
      if (type === 'freeForm' && !scope) continue;
      const detail = text(item.impactingCondition ?? item.reason ?? item.text);
      const trend = ['increasing','decreasing'].includes(item.trend) ? ' ('+item.trend+')' : '';
      const summary = [
        Number.isFinite(starts) ? 'Started '+timeLabel(starts)+'.' : '',
        Number.isFinite(ends) ? 'Scheduled end '+timeLabel(ends)+'.' : '',
        minutes === null ? '' : 'FAA average delay '+minutes+' min'+trend+'.',
        detail ? (type==='airportClosure' || type==='freeForm' ? 'Published scope: ' : 'FAA reason: ') + detail + '.' : '',
        type==='deicing' ? 'The FAA reported deicing at this airport.' : '',
        Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180 ? 'The map point marks the airport.' : ''
      ].filter(Boolean).join(' ');
      const advice = advisoryLink(item.advisoryUrl);
      const sourceId = typeof item.id === 'string' && /^[\w-]{1,100}$/.test(item.id) ? item.id : '';
      const identity = [code,type,sourceId, Number.isFinite(starts) ? iso(starts) : ''].join(':');
      const displayName = text(airport.airportLongName) || code;
      const report = event({
        key:'faa-airport:'+identity, ts:iso(date), source_date_basis:date===updated && date!==starts ? 'updated' : undefined,
        title:(restricted ? 'Airport closure with exceptions' : label)+' at '+code,
        summary, url:advice || faaAirportReference, source_url_scope:advice ? undefined : 'live_listing',
        source:faaAirportSource, kind:'airport_disruption', category:'geo', airport_code:code, airport_event_type:type,
        airport_started_at:Number.isFinite(starts) ? iso(starts) : null,
        airport_valid_until:Number.isFinite(ends) ? iso(ends) : null,
        confidence:'Official FAA status listing', score:restricted ? 64 : minutes >= 60 ? Math.max(score,68) : score,
        lat, lon, place:displayName===code ? code : displayName+' · '+code, place_basis:'airport_reference',
        location_note:'Airport reference point published by FAA.'
      }, now);
      if (report && (!reports.has(identity) || report.ts>reports.get(identity).ts)) reports.set(identity,report);
    }
  }
  return [...reports.values()];
}

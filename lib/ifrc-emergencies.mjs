import { DAY, event, text } from './events.mjs';
import { countries, isCountryCode } from './geography.mjs';

export const ifrcSource = 'IFRC GO emergencies';
export const ifrcReference = 'https://go-wiki.ifrc.org/en/go-api/api-overview';

export function ifrcUrl(now = Date.now()) {
  const cutoff = new Date(now - 30 * DAY).toISOString().slice(0,10);
  return 'https://goadmin.ifrc.org/api/v2/event/?' + new URLSearchParams({
    limit:'100', ordering:'-created_at', created_at__gte:cutoff
  });
}

function dateOnly(value) {
  const day = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value || '')?.[1];
  const parsed = Date.parse(day);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10)===day ? day : '';
}

export function normalizeIfrcEmergencies(data, now = Date.now()) {
  if (!Array.isArray(data?.results) || !Number.isInteger(data.count) || data.count!==data.results.length || data.next) {
    throw Error('Expected a complete IFRC GO emergency collection');
  }
  const reports = new Map();
  for (const row of data.results) {
    const title = text(row?.name);
    if (!Number.isSafeInteger(row?.id) || row.id<=0 || !title ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(row.created_at || '')) continue;
    const codeList = Array.isArray(row.countries) ?
      [...new Set(row.countries.map(place=>place?.iso).filter(isCountryCode))] : [];
    const country = codeList.length===1 ? codeList[0] : null;
    const place = country ? countries[country] : null;
    const type = text(row.dtype?.name);
    const start = dateOnly(row.disaster_start_date);
    const scope = codeList.length ? 'Countries named by IFRC GO: ' + codeList.map(code=>countries[code].name).join(', ') + '.' : '';
    const report = event({
      key:'ifrc-go:' + row.id, ts:row.created_at, source_date_basis:'catalog_created',
      source:ifrcSource, category:'geo', kind:'humanitarian_record', score:48, title,
      confidence:'Official catalog record' + (row.auto_generated===true ? ' · automatic entry' : ''),
      summary:[
        'Dated by entry creation in the IFRC GO catalog.',
        type && 'Listed event type: ' + type + '.',
        start && 'Listed incident start date: ' + start + '.',
        scope
      ].filter(Boolean).join(' '),
      url:'https://go.ifrc.org/emergencies/' + row.id + '/details',
      ...(place ? {country,lon:place.lon,lat:place.lat,place:place.name,place_basis:'country_centroid',
        location_note:'Country named by IFRC GO. The map point is an approximate country reference.'} : {})
    },now);
    if (report) reports.set(report.id,report);
  }
  return [...reports.values()];
}

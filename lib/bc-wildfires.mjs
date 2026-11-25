import { DAY, event, text } from './events.mjs';

const layer = 'WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP';
export const bcWildfireSource = 'BC Wildfire Service incidents';
export const bcWildfireReference = 'https://catalogue.data.gov.bc.ca/dataset/2790e3f7-6395-4230-8545-04efb5a18800';

export function bcWildfireUrl(now = Date.now()) {
  const cutoff = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    service:'WFS', version:'2.0.0', request:'GetFeature', typeNames:'pub:' + layer,
    outputFormat:'application/json', srsName:'EPSG:4326',
    propertyName:'SHAPE,FIRE_YEAR,FIRE_NUMBER,FIRE_TYPE,IGNITION_DATE,FIRE_STATUS,FIRE_OUT_DATE,GEOGRAPHIC_DESCRIPTION,CURRENT_SIZE,FIRE_OF_NOTE_IND',
    CQL_FILTER:"IGNITION_DATE >= '" + cutoff + "'"
  });
  return 'https://openmaps.gov.bc.ca/geo/pub/' + layer + '/ows?' + params;
}

function calendarDay(value) {
  const day = /^(\d{4}-\d{2}-\d{2})Z?$/.exec(value || '')?.[1];
  if (!day) return '';
  const date = new Date(day);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(day) ? day : '';
}

export function normalizeBcWildfires(data, now = Date.now()) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) ||
      !Number.isSafeInteger(data.numberMatched) || data.numberMatched !== data.features.length) {
    throw Error('Expected a complete BC Wildfire Service point collection');
  }
  const reports = new Map();
  for (const feature of data.features) {
    const row = feature?.properties;
    const day = calendarDay(row?.IGNITION_DATE);
    const incident = row?.FIRE_NUMBER;
    if (row?.FIRE_TYPE !== 'Fire' || !day || !/^[A-Z]\d{4,8}$/.test(incident || '') ||
        row.FIRE_YEAR !== Number(day.slice(0, 4))) continue;
    const key = 'bc-wildfire:' + row.FIRE_YEAR + ':' + incident;
    const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const [lon, lat] = Array.isArray(coords) ? coords : [];
    const validPoint = Number.isFinite(lon) && lon >= -140 && lon <= -113 &&
      Number.isFinite(lat) && lat >= 47 && lat <= 61;
    const name = text(row.GEOGRAPHIC_DESCRIPTION);
    const size = Number.isFinite(row.CURRENT_SIZE) && row.CURRENT_SIZE >= 0 ? row.CURRENT_SIZE : null;
    const stage = text(row.FIRE_STATUS);
    const out = calendarDay(row.FIRE_OUT_DATE);
    const report = event({
      key, ts:day, date_precision:'day',
      source:bcWildfireSource, category:'geo', kind:'wildfire_record', confidence:'Official incident record',
      title:'Wildfire · ' + incident + (name ? ' · ' + name : ''),
      summary:[
        stage && 'Stage in the collected inventory: ' + stage + '.',
        out && 'Reported out on ' + out + '.',
        size !== null && 'Reported size: ' + size + ' hectares.',
        'Dated by the source ignition date. Visit BC Wildfire Service for incident updates.'
      ].filter(Boolean).join(' '),
      url:'https://wildfiresituation.nrs.gov.bc.ca/incidents?' + new URLSearchParams({fireYear:String(row.FIRE_YEAR),incidentNumber:incident}),
      score:row.FIRE_OF_NOTE_IND === 'Y' || size >= 500 ? 78 : size >= 50 ? 65 : 46,
      country:'CA', province:'BC',
      ...(validPoint ? {lon,lat,place:name || 'British Columbia',place_basis:'event_location',
        location_note:'Incident point published by the BC Wildfire Service.'} : {})
    },now);
    if (report) reports.set(key, report);
  }
  return [...reports.values()];
}

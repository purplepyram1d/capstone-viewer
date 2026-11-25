import { event, text } from './events.mjs';
import { isUSState } from './us-geography.mjs';

const layer = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0';
export const riverGaugeSource = 'NOAA observed flood stages';
export const riverGaugeReference = layer;
const params = new URLSearchParams({
  where:"status IN ('moderate','major')", outFields:'gaugelid,status,location,waterbody,state,obstime,units,observed',
  returnGeometry:'true', outSR:'4326', f:'json'
});
export const riverGaugeUrl = layer + '/query?' + params;
const categories = new Map([['moderate','Moderate'],['major','Major']]);
const sixHours = 6 * 3_600_000;

export function normalizeRiverGauges(data, now = Date.now()) {
  if (data?.geometryType !== 'esriGeometryPoint' || !Array.isArray(data.features) || data.exceededTransferLimit) {
    throw Error('Expected a complete NOAA observed river stage collection');
  }
  const reports = new Map();
  for (const feature of data.features) {
    const row = feature?.attributes;
    const severity = categories.get(row?.status);
    const id = text(row?.gaugelid).toUpperCase();
    const state = text(row?.state).toUpperCase();
    if (!severity || !/^[A-Z0-9]{5,10}$/.test(id) || !isUSState(state)) continue;
    const utc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(row.obstime || '');
    if (!utc) continue;
    const ts = utc[1] + 'T' + utc[2] + 'Z';
    const time = Date.parse(ts);
    if (!Number.isFinite(time) || !new Date(time).toISOString().startsWith(ts.slice(0,-1)) || time < now-sixHours) continue;
    const {x:lon,y:lat} = feature.geometry || {};
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90 ||
        (lon===0 && lat===0)) continue;
    const value = text(row.observed);
    const unit = text(row.units);
    const level = /^-?\d+(?:\.\d+)?$/.test(value) && ![-999,-9999].includes(Number(value)) && unit ? value + ' ' + unit : '';
    const name = [text(row.waterbody),text(row.location)].filter(Boolean).join(' at ') || id;
    const report = event({
      key:'nwps-observed:' + id + ':' + ts, ts, kind:'river_gauge', category:'geo', flood_stage:row.status,
      source:riverGaugeSource, confidence:'Gauge measurement', score:severity==='Major' ? 81 : 68,
      title:severity + ' flood stage observed · ' + name,
      summary:(level ? 'Measured level: ' + level + '. ' : '') +
        'NOAA classified gauge ' + id + ' as ' + severity.toLowerCase() +
        ' flood stage at the observation time. Open the gauge for the latest readings and forecast.',
      url:'https://water.noaa.gov/gauges/' + id.toLowerCase(), country:'US', state_codes:[state],
      state_basis:'source_location', lon, lat, place:name, place_basis:'gauge_location',
      location_note:'The point identifies a gauge. It does not describe the extent of flooding.'
    },now);
    if (report) reports.set(report.id,report);
  }
  return [...reports.values()];
}

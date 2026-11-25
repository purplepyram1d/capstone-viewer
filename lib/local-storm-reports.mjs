import { event, text } from './events.mjs';
import { isUSState } from './us-geography.mjs';

const layer = 'https://mapservices.weather.noaa.gov/vector/rest/services/obs/nws_local_storm_reports/MapServer/2';
export const stormReportSource = 'NWS local storm reports';
export const stormReportReference = 'https://mapservices.weather.noaa.gov/vector/rest/services/obs/nws_local_storm_reports/MapServer';
const reportsByType = new Map([
  ['Tornado',['Tornado',79]],['Landspout',['Landspout',72]],['Waterspout',['Waterspout',70]],
  ['Flash Flood',['Flash flooding',75]],['Flood',['Flooding',65]],['Coastal Flood',['Coastal flooding',69]],
  ['Storm Surge',['Storm surge',75]],['Downburst',['Downburst',70]],['Tstm Wnd Dmg',['Thunderstorm wind damage',67]],
  ['Non-Tstm Wnd Dmg',['Wind damage',67]],['Avalanche',['Avalanche',75]],['Debris Flow',['Debris flow',74]],
  ['Landslide',['Landslide',74]],['Snow/Ice Dmg',['Snow or ice damage',66]]
]);
const fields = 'wfo_id,lsr_validtime,valid_time,descript,loc_desc,state,magnitude,units,remarks';
const quoted = value => "'" + value.replaceAll("'","''") + "'";
const query = where => layer + '/query?' + new URLSearchParams({
  where, outFields:fields, returnGeometry:'true', outSR:'4326', f:'pjson'
});
export const stormReportUrl = query('descript IN (' + [...reportsByType.keys()].map(quoted).join(',') + ')');

export function normalizeStormReports(data, now = Date.now()) {
  if (data?.geometryType!=='esriGeometryPoint' || !Array.isArray(data.features) || data.exceededTransferLimit) {
    throw Error('Expected a complete NWS local storm report collection');
  }
  const reports = new Map();
  for (const feature of data.features) {
    const row = feature?.attributes;
    const type = reportsByType.get(row?.descript);
    const office = text(row?.wfo_id);
    const state = text(row?.state);
    const place = text(row?.loc_desc);
    const {x:lon,y:lat} = feature?.geometry || {};
    if (!type || !/^[A-Z]{3}$/.test(office) || !isUSState(state) || typeof row.loc_desc!=='string' || !place ||
        !Number.isSafeInteger(row.lsr_validtime) || row.lsr_validtime<=0 || row.lsr_validtime>8.64e15 ||
        !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90 ||
        (lon===0 && lat===0) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+00$/.test(row.valid_time || '')) continue;
    const date = new Date(row.lsr_validtime).toISOString();
    if (date.slice(0,19).replace('T',' ')+'+00'!==row.valid_time) continue;
    const [label,score] = type;
    const signature = [office,state,row.valid_time,row.descript,place];
    const where = [
      'wfo_id=' + quoted(office), 'state=' + quoted(state), 'valid_time=' + quoted(row.valid_time),
      'descript=' + quoted(row.descript), 'loc_desc=' + quoted(row.loc_desc)
    ].join(' AND ');
    const value = text(row.magnitude), unit = text(row.units);
    const magnitude = value && unit ? 'Magnitude as reported: ' + value + ' ' + unit + '. ' : '';
    const remarks = text(row.remarks).slice(0,285);
    const report = event({
      key:'nws-storm-report:' + JSON.stringify(signature),ts:date,
      source:stormReportSource,category:'geo',kind:'local_storm_report',confidence:'Official preliminary report',score,
      title:label + ' reported · ' + place + ', ' + state,
      summary:'Preliminary report from NWS office ' + office + '. ' + magnitude + remarks,
      url:query(where),country:'US',state_codes:[state],state_basis:'source_location',
      lon,lat,place:place+', '+state,place_basis:'event_location',
      location_note:'Point published by the reporting NWS office. The linked feed retains 72 hours of reports.'
    },now);
    if (report) reports.set(report.id,report);
  }
  return [...reports.values()];
}

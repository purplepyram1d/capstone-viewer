import { event, text } from './events.mjs';
import { isUSState, usStates } from './us-geography.mjs';

const layer = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0';
export const wildfireSource = 'NIFC wildfire records';
export const wildfireReference = 'https://www.arcgis.com/home/item.html?id=4181a117dc9e43db8598533e29972015';
const params = new URLSearchParams({
  where:"IncidentTypeCategory='WF'",f:'json',returnGeometry:'true',outSR:'4326',
  outFields:'OBJECTID,IrwinID,IncidentName,IncidentTypeCategory,FireDiscoveryDateTime,IncidentSize,PercentContained,POOState',
  orderByFields:'FireDiscoveryDateTime DESC',resultRecordCount:'2000'
});
export const wildfireUrl = layer + '/query?' + params;

export function normalizeWildfires(data, now = Date.now()) {
  if (!Array.isArray(data?.features) || data.geometryType !== 'esriGeometryPoint') throw Error('Expected a NIFC wildfire point collection');
  if (data.exceededTransferLimit) throw Error('NIFC returned an incomplete wildfire list');
  const reports = new Map();
  for (const feature of data.features) {
    const row = feature?.attributes;
    if (row?.IncidentTypeCategory !== 'WF') continue;
    const incident = /^\{?([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\}?$/i.exec(row.IrwinID || '')?.[1].toLowerCase();
    const name = text(row.IncidentName);
    const {OBJECTID,FireDiscoveryDateTime,IncidentSize,PercentContained} = row;
    if (!incident || reports.has(incident) || !name || !Number.isSafeInteger(OBJECTID) ||
        OBJECTID <= 0 || !Number.isSafeInteger(FireDiscoveryDateTime) || Math.abs(FireDiscoveryDateTime)>8.64e15) continue;
    const state = /^US-([A-Z]{2})$/.exec(row.POOState || '')?.[1];
    const place = isUSState(state) ? usStates[state].name : 'Fire origin from NIFC';
    const size = Number.isFinite(IncidentSize) && IncidentSize >= 0 ? IncidentSize : null;
    const contained = Number.isFinite(PercentContained) && PercentContained >= 0 && PercentContained <= 100 ? PercentContained : null;
    const point = feature.geometry || {};
    const report = event({
      key:'nifc-wildfire:' + incident, ts:new Date(FireDiscoveryDateTime).toISOString(),
      source:wildfireSource, title:'Wildfire · ' + name,
      summary:[
        size === null ? '' : 'Reported size: ' + size + ' acres.',
        contained === null ? '' : 'Reported containment: ' + contained + '%.',
        'NIFC record dated by fire discovery.'
      ].filter(Boolean).join(' '),
      url:layer + '/' + OBJECTID + '?f=pjson', confidence:'Official incident record',
      category:'geo', kind:'wildfire_record', score:size >= 1000 ? 78 : size >= 100 ? 65 : 46,
      ...(isUSState(state) ? {state_codes:[state],state_basis:'source_origin'} : {}),
      lon:point.x,lat:point.y,place,
      place_basis:'fire_origin',location_note:'Point of origin in the official incident inventory.'
    },now);
    if (report) reports.set(incident,report);
  }
  return [...reports.values()];
}
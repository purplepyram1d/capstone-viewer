import { DAY, event, text } from './events.mjs';

const query = 'https://www.seismicportal.eu/fdsnws/event/1/query';
export const emscSource = 'EMSC regional earthquakes';
export const emscReference = 'https://www.seismicportal.eu/fdsn-wsevent.html';
const bounds = {minlat:28,maxlat:72,minlon:-30,maxlon:44};
const maxResults = 1000;

export function emscUrl(now = Date.now()) {
  const starttime = new Date(now - 7 * DAY).toISOString().slice(0,19);
  return query+'?'+new URLSearchParams({
    format:'json',starttime, ...bounds,minmag:3,maxmag:4.49,limit:maxResults,orderby:'time',nodata:204
  });
}

export function normalizeEmscQuakes(data, now = Date.now()) {
  if (data?.type!=='FeatureCollection' || !Array.isArray(data.features) || data.features.length>=maxResults) {
    throw Error('Expected a complete EMSC earthquake collection');
  }
  const records = new Map();
  for (const feature of data.features) {
    const row = feature?.properties;
    const id = row?.unid;
    if (row?.evtype!=='ke' || !/^\d{8}_\d{7}$/.test(id || '') || feature.id!==id ||
        !Number.isFinite(row.mag) || row.mag<3 || row.mag>=4.5) continue;
    const coordinates = feature.geometry?.type==='Point' && feature.geometry.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const [lon,lat] = coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
        lon<bounds.minlon || lon>bounds.maxlon || lat<bounds.minlat || lat>bounds.maxlat) continue;
    const place = text(row.flynn_region) || 'Europe and Mediterranean monitoring region';
    const authority = text(row.auth);
    const report = event({
      key:'emsc-earthquake:'+id,ts:row.time,source:emscSource,category:'geo',kind:'earthquake',
      title:'M '+row.mag+' earthquake · '+place,
      summary:(authority ? 'Solution from '+authority+', indexed by EMSC. ' : 'Solution indexed by EMSC. ')+
        (Number.isFinite(row.depth) ? 'Reported depth '+row.depth+' km. ' : '')+
        'Data: EMSC / SeismicPortal, CC BY 4.0.',
      url:query+'?'+new URLSearchParams({format:'json',eventid:id}),
      confidence:'Source measurement',magnitude:row.mag,score:row.mag>=4 ? 54 : 42,
      lon,lat,place,place_basis:'seismic_origin',location_note:'Epicenter from the EMSC event catalog.'
    },now);
    if (report) records.set(id,report);
  }
  return [...records.values()];
}

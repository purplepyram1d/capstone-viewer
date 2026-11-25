import { event, text } from './events.mjs';
import { trackSegments } from './geo-track.mjs';
export { trackSegments } from './geo-track.mjs';

const endpoint = 'https://eonet.gsfc.nasa.gov/api/v3/events';
export const eonetName = 'NASA Earth Observatory Natural Event Tracker';
export const eonetUrl = endpoint + '?status=open&days=30';
export const eonetReference = 'https://eonet.gsfc.nasa.gov/docs/v3';
const categories = new Set(['seaLakeIce','severeStorms','volcanoes','floods','wildfires','landslides','dustHaze','snow','waterColor']);

export function normalizeEonet(data,now = Date.now()) {
  if (!Array.isArray(data?.events)) throw Error('Expected the NASA EONET event catalog');
  const reports = new Map();
  for (const row of data.events) {
    if (!/^EONET_\d{1,12}$/.test(row?.id || '') || reports.has(row.id) || row.closed) continue;
    const kind = Array.isArray(row.categories) && row.categories.find(category=>categories.has(category?.id));
    if (!kind || !Array.isArray(row.geometry)) continue;
    const sources = Array.isArray(row.sources) ? row.sources : [];
    // The U.S. wildfire inventory is already collected from the underlying interagency source.
    if (kind.id==='wildfires' && sources.length && sources.every(source=>source?.id==='IRWIN')) continue;
    const points = row.geometry.flatMap(geometry => {
      if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates) || !/Z$/.test(geometry.date || '')) return [];
      const [lon,lat] = geometry.coordinates;
      const stamp = Date.parse(geometry.date);
      return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon)<=180 && Math.abs(lat)<=90 &&
        Number.isFinite(stamp) && stamp<=now+300_000 ? [{coords:[lon,lat],stamp,geometry}] : [];
    }).sort((a,b)=>a.stamp-b.stamp).slice(-60);
    const latest = points.at(-1);
    if (!latest) continue;
    const [lon,lat]=latest.coords;
    const ts=new Date(latest.stamp).toISOString();
    const byDay=ts.endsWith('T00:00:00.000Z');
    const names=[...new Set(sources.map(source=>text(source?.id)).filter(Boolean))].slice(0,5);
    const measurement=latest.geometry.magnitudeValue, unit=text(latest.geometry.magnitudeUnit);
    const lines=trackSegments(points.map(point=>point.coords));
    const summary=[
      'Curated NASA catalog · '+text(kind.title || kind.id)+'.',
      names.length ? 'Catalog references: '+names.join(', ')+'.' : '',
      Number.isFinite(measurement) && unit ? 'Latest catalog measurement: '+measurement+' '+unit+'.' : '',
      lines.length ? points.length+' dated positions available on the map.' : ''
    ].filter(Boolean).join(' ');
    const report=event({
      key:'eonet:'+row.id,ts,date_precision:byDay?'day':'timestamp',source_date_basis:'catalog_observation',
      source:eonetName,title:row.title,summary,url:endpoint+'/'+row.id,
      category:'geo',kind:'earth_observation',confidence:'Official curated catalog',score:kind.id==='severeStorms'?70:52,
      lon,lat,place:row.title,place_basis:'catalog_point',location_note:'Latest location in the NASA catalog.',
      ...(lines.length ? {observation_track:{type:'MultiLineString',coordinates:lines}} : {})
    },now);
    if (report) reports.set(row.id,report);
  }
  return [...reports.values()];
}
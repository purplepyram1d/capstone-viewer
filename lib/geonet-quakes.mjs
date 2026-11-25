import { event, text } from './events.mjs';

export const geoNetQuakeSource = 'GeoNet earthquakes';
export const geoNetQuakeUrl = 'https://api.geonet.org.nz/quake?MMI=4';
export const geoNetQuakeReference = 'https://api.geonet.org.nz/#quakes';
const reportUrl = id => 'https://www.geonet.org.nz/earthquake/' + id;

export function normalizeGeoNetQuakes(data, now = Date.now()) {
  if (data?.type!=='FeatureCollection' || !Array.isArray(data.features)) {
    throw Error('Expected a GeoNet earthquake feature collection');
  }
  const reports = new Map();
  for (const feature of data.features) {
    const row = feature?.properties;
    const id = row?.publicID;
    if (!/^\d{4}p\d{6,9}$/.test(id || '') || !['best','deleted'].includes(row.quality)) continue;
    const key = 'geonet-quake:' + id;
    if (reports.get(key)?.source_withdrawn) continue;
    const base = {key,ts:row.time,url:reportUrl(id),source:geoNetQuakeSource,category:'geo'};
    if (row.quality==='deleted') {
      const withdrawn = event({...base,kind:'earthquake_withdrawal',source_withdrawn:true,
        title:'GeoNet withdrew earthquake solution ' + id,
        summary:'GeoNet marked the previously collected solution as deleted. The source date is the original event time.',
        confidence:'Official catalog correction',score:40
      },now);
      if (withdrawn) reports.set(key,withdrawn);
      continue;
    }
    const point = feature.geometry?.type==='Point' && feature.geometry.coordinates;
    const [lon,lat] = Array.isArray(point) ? point : [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90 ||
        !Number.isFinite(row.magnitude) || !Number.isInteger(row.mmi) || row.mmi<4 || row.mmi>12) continue;
    const place = text(row.locality) || 'New Zealand monitoring region';
    const magnitude = row.magnitude.toFixed(1);
    const depth = Number.isFinite(row.depth) ? ' Reported depth ' + row.depth.toFixed(1) + ' km.' : '';
    const report = event({...base,kind:'earthquake',magnitude:row.magnitude,
      title:'M ' + magnitude + ' earthquake · ' + place,
      summary:'GeoNet preferred solution.' + depth +
        ' Estimated shaking at the closest locality: MMI ' + row.mmi + '.',
      confidence:'Official measurement · preferred solution',score:row.mmi>=7 ? 88 : row.mmi>=6 ? 72 : 48,
      lon,lat,place,place_basis:'seismic_origin',
      location_note:'GeoNet’s reported epicenter. The named locality is a geographic reference.'
    },now);
    if (report) reports.set(key,report);
  }
  return [...reports.values()];
}

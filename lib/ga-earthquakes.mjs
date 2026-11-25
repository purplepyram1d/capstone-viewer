import { DAY, event, text } from './events.mjs';

const site = 'https://earthquakes.ga.gov.au';
export const gaQuakeSource = 'Geoscience Australia earthquakes';
export const gaQuakeReference = site + '/emailSubscription';
export const gaQuakeUrl = site + '/geoserver/earthquakes/wfs?' + new URLSearchParams({
  service:'WFS',request:'getfeature',typeNames:'earthquakes:earthquakes_seven_days',
  outputFormat:'application/json',CQL_FILTER:"display_flag='Y'"
});

function solutionStatus(row) {
  if (row.evaluation_mode==='automatic') return 'automatic solution';
  if (row.evaluation_status==='final') return 'final solution';
  if (row.evaluation_status==='reviewed' || row.evaluation_status==='confirmed') return row.evaluation_status+' solution';
  return 'published solution';
}

export function normalizeGaQuakes(data, now = Date.now()) {
  if (data?.type!=='FeatureCollection' || !Array.isArray(data.features)) {
    throw Error('Expected a Geoscience Australia earthquake feature collection');
  }
  const reports = new Map();
  for (const feature of data.features) {
    const row = feature?.properties;
    const id = row?.event_id;
    const magnitude = row?.preferred_magnitude;
    const origin = Date.parse(row?.origin_time);
    if (row?.source!=='GA' || row.display_flag!=='Y' || row.located_in_australia!=='Y' ||
        !/^ga\d{4}[a-z]{6}$/.test(id || '') || !Number.isFinite(magnitude) || magnitude<2 || magnitude>=4.5 ||
        !(origin>=now-7*DAY) || ['rejected','deleted'].includes(row.evaluation_status)) continue;

    const point = feature.geometry?.type==='Point' && feature.geometry.coordinates;
    const [lon,lat] = Array.isArray(point) ? point : [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90) continue;
    const revision = Date.parse(row.event_modification_time) || origin;
    if (reports.get(id)?.revision >= revision) continue;

    const place = text(row.description) || 'Australian monitoring area';
    const magnitudeType = text(row.preferred_magnitude_type);
    const depth = Number.isFinite(row.depth) && row.depth>=0 ? 'Reported depth '+row.depth.toFixed(1)+' km. ' : '';
    const report = event({
      key:'ga-earthquake:'+id,ts:row.origin_time,source:gaQuakeSource,url:site+'/event/'+id,
      kind:'earthquake',category:'geo',title:'M '+magnitude.toFixed(1)+' earthquake · '+place,
      summary:(magnitudeType ? 'Preferred magnitude scale: '+magnitudeType+'. ' : '')+depth+
        'Data: Geoscience Australia, CC BY 4.0.',
      magnitude,score:magnitude>=4 ? 54 : 42,confidence:'Official measurement · '+solutionStatus(row),
      place,lon,lat,country:'AU',place_basis:'seismic_origin',
      location_note:'Geoscience Australia’s reported epicenter. Its Australian monitoring area includes offshore events.'
    },now);
    if (report) reports.set(id,{report,revision});
  }
  return [...reports.values()].map(({report})=>report);
}

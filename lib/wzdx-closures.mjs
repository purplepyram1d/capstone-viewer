import {DAY,event,text} from './events.mjs';

export const workZoneSources = [
  {code:'WA',name:'Washington State DOT work-zone closures',url:'https://wzdx.wsdot.wa.gov/api/v4/WorkZoneFeed'},
  {code:'ID',name:'Idaho Transportation Department work-zone closures',url:'https://511.idaho.gov/api/wzdx'},
  {code:'FL',name:'Florida DOT work-zone closures',url:'https://api.depot.fdot.gov/wzdx-latest'},
  {code:'DE',name:'Delaware DOT work-zone closures',url:'https://wzdx.e-dot.com/del_dot_feed_wzdx_v4.1.geojson',intervalMinutes:10},
  {code:'MD',name:'Maryland DOT work-zone closures',url:'https://filter.ritis.org/wzdx_v4.1/mdot.geojson'},
  {code:'MS',name:'Mississippi DOT work-zone closures',url:'https://api.mdottraffic.com/prod/v3/data/wzdx'},
  {code:'MO',name:'Missouri DOT work-zone closures',url:'https://traveler.modot.org/timconfig/feed/desktop/mo_wzdx.json',intervalMinutes:10},
  {code:'WI',name:'Wisconsin DOT work-zone closures',url:'https://511wi.gov/api/wzdx',intervalMinutes:15}
];
const date = value => typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)
  ? Date.parse(value) : NaN;
const iso = time => new Date(time).toISOString();
const clock = time => iso(time).slice(0,16).replace('T',' ')+' UTC';
const positionOk = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
  Math.abs(point[0])<=180 && Math.abs(point[1])<=90;

export function normalizeWorkZoneClosures(data,source,now=Date.now()) {
  if (data?.type!=='FeatureCollection' || !Array.isArray(data.features) || !/^4(?:\.\d+)*$/.test(String(data.feed_info?.version))) {
    throw Error('Expected a WZDx version 4 road inventory.');
  }
  const collectedAt = date(data.feed_info.update_date);
  if (!Number.isFinite(collectedAt) || collectedAt>now+5*60_000 || collectedAt<now-30*60_000) {
    throw Error(Number.isFinite(collectedAt) ? 'Work-zone inventory is out of date. Publisher timestamp '+clock(collectedAt)+'.' :
      'Work-zone inventory has no valid publisher timestamp.');
  }
  return data.features.flatMap(row=>{
    const details = row?.properties, core = details?.core_details;
    if (core?.event_type!=='work-zone' || details.vehicle_impact!=='all-lanes-closed' ||
        details.is_end_date_verified===true || (details.event_status && details.event_status!=='active')) return [];
    const start = date(details.start_date), end = date(details.end_date), updated = date(core.update_date);
    if (!(start<=now && now<end) || (core.update_date!=null && !Number.isFinite(updated)) || updated>collectedAt+5*60_000) return [];
    const id = text(row.id ?? details.road_event_id);
    if (!id || id.length>180 || !Array.isArray(core.road_names)) return [];
    const names = core.road_names.slice(0,5).map(text).filter(Boolean).join(' / ');
    if (!names) return [];
    const geometry = row.geometry;
    if (!['LineString','MultiPoint'].includes(geometry?.type) || !Array.isArray(geometry.coordinates) ||
        !geometry.coordinates.length || !geometry.coordinates.every(positionOk)) return [];
    const [lon,lat] = geometry.coordinates[0];
    const line = geometry.type==='LineString' && geometry.coordinates.length>=2 && geometry.coordinates.length<=350;
    const direction = text(core.direction);
    const before = text(details.beginning_cross_street), after = text(details.ending_cross_street);
    const observed = !Number.isFinite(updated) || updated<now-30*DAY;
    const recordedAt = observed ? Math.floor(collectedAt/DAY)*DAY : updated;
    const created = date(core.creation_date);
    const report = event({
      key:'wzdx:'+source.code+':'+id,ts:iso(recordedAt),date_precision:observed?'day':'timestamp',
      source_date_basis:observed?'catalog_observation':'updated',
      ...(Number.isFinite(created) && created<=updated ? {source_published_at:iso(created)} : {}),
      source:source.name,url:source.url,source_url_scope:'live_listing',category:'geo',kind:'road_closure',
      title:'Full work-zone closure · '+names+(direction?' · '+direction:''),
      summary:[before && after && before!==after ? 'From '+before+' to '+after+'.' : '',
        'Published closure window '+clock(start)+' to '+clock(end)+'.',
        details.is_start_date_verified===true ? 'Publisher verified the start.' :
          details.is_start_date_verified===false ? 'Publisher has not verified the start.' : '',
        Number.isFinite(updated) ? 'Record updated '+clock(updated)+'.' : 'Publisher supplies a listing date only.'].filter(Boolean).join(' '),
      confidence:'Official work-zone closure listing',score:63,country:'US',state_codes:[source.code],state_basis:'source_coverage',
      lon,lat,place:names+' · '+source.code,place_basis:'road_closure_start',location_note:'Start point in the agency’s published work-zone geometry.',
      road_status:'active',road_started_at:iso(start),road_valid_until:iso(end),
      ...(line ? {road_geometry:{type:'LineString',coordinates:geometry.coordinates.map(([x,y])=>[x,y])}} : {})
    },now);
    return report ? [report] : [];
  });
}

export const workZoneClosureFeeds = workZoneSources.map(source=>({
  id:'wzdx-'+source.code.toLowerCase(),name:source.name,url:source.url,desk:'geo',group:'transport',format:'json',
  intervalMs:(source.intervalMinutes || 5)*60_000,timeout:22_000,currentListings:true,parse:data=>normalizeWorkZoneClosures(data,source),
  profile:{evidence:'Official closure listing',description:'Published full work-zone closures in the current time window, with the named direction, exact window, and reported road geometry.',
    url:'https://data.transportation.gov/Roadways-and-Bridges/Work-Zone-Data-Feed-Registry/69qe-yiui'}
}));

import { DAY, event, text } from './events.mjs';

const origin = 'https://api.open511.gov.bc.ca';
export const driveBcSource = 'DriveBC road closures';
export const driveBcReference = 'https://api.open511.gov.bc.ca/help';
export const driveBcUrl = origin+'/events?status=ACTIVE&limit=500&format=json';
const iso = timestamp => new Date(timestamp).toISOString();
const shortUtc = timestamp => iso(timestamp).slice(0,16).replace('T',' ')+' UTC';

function scheduleStamp(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) return NaN;
  // DriveBC publishes bare interval stamps in UTC. Unplanned open intervals can be checked against the offset on created.
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value+'Z');
}

function currentInterval(schedule, now) {
  for (const interval of Array.isArray(schedule?.intervals) ? schedule.intervals : []) {
    if (typeof interval !== 'string') continue;
    const [start,end,extra] = interval.split('/');
    if (end===undefined || extra!==undefined) continue;
    const begins = scheduleStamp(start), until = end ? scheduleStamp(end) : Infinity;
    if (begins <= now && now < until) return {begins,until};
  }
  return null;
}

function eventLink(row) {
  if (typeof row.id !== 'string' || !/^drivebc\.ca\/[A-Z0-9-]{1,64}$/i.test(row.id)) return '';
  try {
    const url = new URL(row.url || '/events/'+row.id,origin);
    return url.origin===origin && !url.username && !url.password && url.pathname==='/events/'+row.id ?
      origin+url.pathname : '';
  } catch { return ''; }
}

function position(geometry) {
  const valid = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    point[0]>=-141 && point[0]<=-113 && point[1]>=48 && point[1]<=61;
  if (geometry?.type==='Point' && valid(geometry.coordinates)) {
    const [lon,lat] = geometry.coordinates;
    return {lon,lat,place_basis:'event_location',location_note:'Point published by DriveBC.'};
  }
  if (geometry?.type==='LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length>=2 &&
      geometry.coordinates.every(valid)) {
    const [lon,lat] = geometry.coordinates[Math.floor(geometry.coordinates.length/2)];
    return {lon,lat,place_basis:'road_segment',location_note:'Point on the road segment published by DriveBC.',
      ...(geometry.coordinates.length<=250 ? {road_geometry:{type:'LineString',coordinates:geometry.coordinates.map(([x,y])=>[x,y])}} : {})};
  }
  return {};
}

export function normalizeDriveBc(data, now = Date.now()) {
  if (!Array.isArray(data?.events)) throw new Error('Invalid DriveBC events response');
  return data.events.flatMap(row=>{
    if (row?.status!=='ACTIVE' || !Array.isArray(row.roads)) return [];
    const closed = row.roads.filter(road=>road?.state==='CLOSED');
    const interval = currentInterval(row.schedule,now), url = eventLink(row);
    if (!closed.length || !interval || !url) return [];
    const updated = Date.parse(row.updated), created = Date.parse(row.created);
    if (!Number.isFinite(updated) || !Number.isFinite(created) || updated<created || updated>now+5*60_000) return [];
    const road = closed[0];
    const label = text(road.name)==='Other Roads' ? text(road.from) || 'Local road' : text(road.name) || 'Road';
    const from = text(road.from), to = text(road.to), area = text(row.areas?.[0]?.name);
    const old = updated < now-30*DAY;
    const ts = old ? Math.floor(now/DAY)*DAY : updated;
    const direction = text(road.direction);
    const extra = closed.length>1 ? ' Also listed: '+closed.slice(1,4).map(item=>text(item.name)).filter(Boolean).join(', ')+'.' : '';
    const report = event({
      key:'drivebc-road:'+row.id+':'+iso(created)+':'+iso(interval.begins), ts:iso(ts),
      date_precision:old?'day':'timestamp',source_date_basis:old?'catalog_observation':updated>created?'updated':undefined,
      source_published_at:iso(created), source:driveBcSource, kind:'road_closure', category:'geo',
      title:'Road closure · '+label+(from && from!==label ? ' · '+from : ''),
      summary:[from && to && from!==to ? 'From '+from+' to '+to+'.' : '',
        direction ? 'Direction '+direction.toLowerCase()+'.' : '',
        'DriveBC update '+shortUtc(updated)+'.',
        Number.isFinite(interval.until) ? 'Published window ends '+shortUtc(interval.until)+'.' : '',
        text(row.description),extra].filter(Boolean).join(' '),
      url, confidence:'Official DriveBC closure listing',score:row.severity==='MAJOR'?72:54,
      country:'CA',province:'BC',place:[label,area].filter(Boolean).join(' · '),
      road_status:'active',road_started_at:iso(interval.begins),
      road_valid_until:Number.isFinite(interval.until)?iso(interval.until):null,...position(row.geography)
    },now);
    return report ? [report] : [];
  });
}

export function createDriveBcCollector(readJson) {
  return async function collectDriveBc() {
    const events = [];
    let url = driveBcUrl;
    const visited = new Set();
    while (url) {
      if (visited.has(url) || visited.size>=20) throw new Error('DriveBC did not finish returning the event inventory');
      visited.add(url);
      const data = await readJson(url);
      if (!Array.isArray(data?.events)) throw new Error('Invalid DriveBC events response');
      events.push(...data.events);
      const link = data.pagination?.next;
      if (!link) break;
      const page = new URL(link,origin);
      if (page.origin!==origin || page.pathname!=='/events' || !/^\d{1,5}$/.test(page.searchParams.get('offset') || ''))
        throw new Error('Invalid DriveBC events pagination');
      const next = new URL(driveBcUrl);
      next.searchParams.set('offset',page.searchParams.get('offset'));
      url = next.href;
    }
    return normalizeDriveBc({events});
  };
}

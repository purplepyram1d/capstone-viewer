import { DAY, event, text } from './events.mjs';

export const caltransFeedReference = 'https://cwwp2.dot.ca.gov/lane-closure.html';
const highwayStatus = 'https://roads.dot.ca.gov/';
const minute = 60_000;
const mainline = new Set(['Mainline','Conventional Hwy']);
const truth = value => value === true || value === 'true';
const iso = time => new Date(time).toISOString();
const shortUtc = time => iso(time).slice(0,16).replace('T',' ')+' UTC';

function epoch(value) {
  if (!/^\d{10,13}$/.test(String(value))) return NaN;
  const number = Number(value);
  return number < 1e12 ? number * 1000 : number;
}

function point(location) {
  if (!String(location?.beginLatitude ?? '').trim() || !String(location?.beginLongitude ?? '').trim()) return {};
  const lat = Number(location.beginLatitude), lon = Number(location.beginLongitude);
  return lat>=31 && lat<=43 && lon>=-126 && lon<=-113 ?
    {lat,lon,place_basis:'road_closure_start',location_note:'Closure start point published by Caltrans.'} : {};
}

export function normalizeCaltransClosures(data, district, now = Date.now()) {
  if (!Array.isArray(data?.data)) throw new Error('Invalid Caltrans closure file');
  const records = data.data.map(row=>row?.lcs).filter(row=>row && typeof row.index==='string' && row.location?.begin &&
    Number(row.location.begin.beginDistrict)===district && row.closure);
  if (data.data.length && !records.length) throw new Error('Caltrans district closure fields were missing');
  const snapshotTime = records.reduce((latest,row)=>{
    const stamp=epoch(row.recordTimestamp?.recordEpoch);
    return stamp <= now + 5*minute ? Math.max(latest,stamp) : latest;
  },-Infinity);
  if (records.length && snapshotTime < now - 25*minute) throw new Error('The published Caltrans district file is over 25 minutes old');
  const output = new Map();
  for (const row of records) {
    const { closure, location } = row;
    const {begin,end} = location;
    if (closure.typeOfClosure!=='Full' || !mainline.has(closure.facility) || !truth(closure.code1097?.isCode1097)) continue;
    const route = text(begin.beginRoute);
    const routeNumber = /^(?:I|US|SR)-(\d{1,3})$/.exec(route)?.[1];
    if (!routeNumber || !row.index.trim()) continue;
    const actualStart = epoch(closure.code1097.code1097Timestamp?.code1097Epoch);
    if (!(actualStart > 0 && actualStart <= now)) continue;

    const opened = truth(closure.code1098?.isCode1098);
    const cancelled = truth(closure.code1022?.isCode1022);
    const terminal = opened || cancelled;
    const endStamp = opened ? epoch(closure.code1098.code1098Timestamp?.code1098Epoch) :
      cancelled ? epoch(closure.code1022.code1022Timestamp?.code1022Epoch) : NaN;
    if (terminal && !(endStamp >= actualStart && endStamp <= now+5*minute)) continue;
    const scheduled = !truth(closure.closureTimestamp?.isClosureEndIndefinite) ?
      epoch(closure.closureTimestamp?.closureEndEpoch) : NaN;
    const archivedStart = !terminal && actualStart < now-30*DAY;
    const when = terminal ? endStamp : archivedStart ? Math.floor(snapshotTime/DAY)*DAY : actualStart;
    const direction = text(location.travelFlowDirection);
    const routeLabel = route + (direction && direction.toLowerCase()!=='not reported' ? ' '+direction : '');
    const county = text(begin.beginCounty);
    const nearby = text(begin.beginNearbyPlace);
    const from = text(begin.beginLocationName || begin.beginFreeFormDescription);
    const to = text(end?.endLocationName || end?.endFreeFormDescription);
    const work = text(closure.typeOfWork);
    const place = [nearby || county,routeLabel].filter(Boolean).join(' · ');
    const title = opened ? 'Highway reopened' : cancelled ? 'Highway closure cancelled' : 'Full highway closure';
    const summary = [
      from && to && from!==to ? 'From '+from+' to '+to+'.' : from ? 'At '+from+'.' : '',
      county ? county+' County.' : '', work ? 'Caltrans lists '+work+'.' : '',
      'Closure began '+shortUtc(actualStart)+'.',
      terminal ? (opened ? 'Caltrans reported reopening ' : 'Caltrans reported cancellation ')+shortUtc(endStamp)+'.' :
        Number.isFinite(scheduled) ? 'Scheduled end '+shortUtc(scheduled)+'.' : '',
      'District '+district+' closure '+text(closure.closureID)+' / '+text(closure.logNumber)+'.'
    ].filter(Boolean).join(' ');
    const report = event({
      key:'caltrans-road:'+district+':'+row.index, ts:iso(when), date_precision:archivedStart?'day':'timestamp',
      source_date_basis:archivedStart?'catalog_observation':undefined,
      title:title+' · '+routeLabel+(county?' · '+county+' County':''),
      summary, url:highwayStatus+'?roadnumber='+routeNumber, source_url_scope:'live_listing',
      source:'Caltrans highway closures', kind:'road_closure', category:'geo', confidence:'Official Caltrans closure listing',
      score:terminal ? 38 : /emergency|accident|fire|flood|inclement|winter/i.test(work) ? 70 : 58,
      road_status:terminal?'ended':'active', road_started_at:iso(actualStart),road_ended_at:terminal?iso(endStamp):null,
      district, state_codes:['CA'],state_basis:'source_location',country:'US',place,...point(begin)
    },now);
    if (report && (!output.has(report.id) || report.ts>=output.get(report.id).ts)) output.set(report.id,report);
  }
  return [...output.values()];
}

export const caltransClosureFeeds = Array.from({length:12},(_,index)=>{
  const district = index+1;
  const suffix = String(district).padStart(2,'0');
  return {
    id:'caltrans-closure-'+suffix, name:'Caltrans district '+district+' full highway closures', desk:'geo',group:'transport',
    url:'https://cwwp2.dot.ca.gov/data/d'+district+'/lcs/lcsStatusD'+suffix+'.json',
    format:'json',currentListings:true,timeout:20_000,parse:data=>normalizeCaltransClosures(data,district),
    profile:{evidence:'Official closure status',description:'Full mainline and conventional highway closures reported by Caltrans district '+district+'. The source file refreshes every five minutes.',url:caltransFeedReference}
  };
});

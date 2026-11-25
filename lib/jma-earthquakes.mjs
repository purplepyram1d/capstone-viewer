import { event, text } from './events.mjs';

const catalog = 'https://www.jma.go.jp/bosai/quake/data/';
export const jmaQuakeSource = 'Japan Meteorological Agency earthquakes';
export const jmaQuakeUrl = catalog + 'list.json';
export const jmaQuakeReference = 'https://www.data.jma.go.jp/eqev/data/en/guide/earthinfo.html';
const levels = ['0','1','2','3','4','5-','5+','6-','6+','7'];
const labels = new Map([['5-','5 lower'],['5+','5 upper'],['6-','6 lower'],['6+','6 upper']]);
const prefectureNames = [
  'Hokkaido','Aomori','Iwate','Miyagi','Akita','Yamagata','Fukushima','Ibaraki','Tochigi','Gunma',
  'Saitama','Chiba','Tokyo','Kanagawa','Niigata','Toyama','Ishikawa','Fukui','Yamanashi','Nagano',
  'Gifu','Shizuoka','Aichi','Mie','Shiga','Kyoto','Osaka','Hyogo','Nara','Wakayama','Tottori','Shimane',
  'Okayama','Hiroshima','Yamaguchi','Tokushima','Kagawa','Ehime','Kochi','Fukuoka','Saga','Nagasaki',
  'Kumamoto','Oita','Miyazaki','Kagoshima','Okinawa'
];
function affectedPrefectures(observations) {
  const byCode = new Map();
  for (const observation of Array.isArray(observations) ? observations : []) {
    const code = /^\d{1,2}$/.test(observation?.code || '') ? Number(observation.code) : 0;
    const level = levels.indexOf(observation?.maxi);
    if (prefectureNames[code-1] && level>=3 && level>(byCode.get(code) ?? -1)) byCode.set(code,level);
  }
  return [...byCode].sort((a,b)=>b[1]-a[1] || a[0]-b[0]).map(([code,level])=>({
    code:String(code).padStart(2,'0'),name:prefectureNames[code-1],intensity:labels.get(levels[level]) || levels[level]
  }));
}
const isoTime = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value || '') ? Date.parse(value) : NaN;

export function normalizeJmaQuakes(data, now = Date.now()) {
  if (!Array.isArray(data)) throw Error('Expected a JMA earthquake catalog');
  const latest = new Map();
  for (const row of data) {
    if (row?.en_ttl!=='Earthquake and Seismic Intensity Information' || !/^\d{14}$/.test(row.eid || '') ||
        !/^\d{14}_\d{14}_[A-Za-z0-9]+_\d+\.json$/.test(row.json || '') || !row.json.includes('_'+row.eid+'_')) continue;
    const issued = isoTime(row.rdt);
    if (!Number.isFinite(issued) || issued>now+300_000 || !['発表','訂正','取消'].includes(row.ift)) continue;
    const serial = Number(row.ser) || 0;
    const earlier = latest.get(row.eid);
    if (!earlier || issued>earlier.issued || (issued===earlier.issued && serial>earlier.serial)) {
      latest.set(row.eid,{row,issued,serial});
    }
  }
  const reports = [];
  for (const {row,issued} of latest.values()) {
    const base = {key:'jma-earthquake:'+row.eid,source:jmaQuakeSource,category:'geo',country:'JP',
      source_published_at:new Date(issued).toISOString(),url:catalog+row.json};
    const origin = isoTime(row.at);
    const place = text(row.en_anm || row.anm) || 'Japan monitoring region';
    if (row.ift==='取消') {
      const removed = event({...base,ts:new Date(Number.isFinite(origin) ? origin : issued).toISOString(),
        kind:'earthquake_withdrawal',source_withdrawn:true,confidence:'Official catalog correction',score:40,
        title:'JMA withdrew an earthquake report · '+place,
        summary:'The Japan Meteorological Agency issued a cancellation. Earlier receipts retain the previously collected report.'
      },now);
      if (removed) reports.push(removed);
      continue;
    }
    const level = levels.indexOf(row.maxi);
    const corrected = row.ift==='訂正';
    if (!Number.isFinite(origin) || level<0 || (level<3 && !corrected)) continue;
    const coordinates = /^([+-]\d{1,2}(?:\.\d+)?)([+-]\d{2,3}(?:\.\d+)?)([+-]\d+)?\/$/.exec(row.cod || '');
    const lat = Number(coordinates?.[1]);
    const lon = Number(coordinates?.[2]);
    const placed = Math.abs(lat)<=90 && Math.abs(lon)<=180 && (lat!==0 || lon!==0);
    const depth = -Number(coordinates?.[3])/1000;
    const magnitude = /^\d+(?:\.\d+)?$/.test(row.mag || '') ? Number(row.mag) : null;
    const intensity = labels.get(row.maxi) || row.maxi;
    const regions = affectedPrefectures(row.int);
    const affected = regions.length ? ' Prefectures reporting intensity 3 or higher: '+
      regions.slice(0,6).map(region=>region.name+' ('+region.intensity+')').join(', ')+
      (regions.length>6 ? ' and '+(regions.length-6)+' more.' : '.') : '';
    const report = event({...base,kind:'earthquake',ts:new Date(origin).toISOString(),
      ...(level<3 ? {updates_existing_only:true} : {}),
      ...(regions.length ? {affected_regions:regions} : {}),
      title:(magnitude===null ? 'Earthquake' : 'M '+magnitude+' earthquake')+' · '+place,
      summary:'Highest reported shaking in Japan: intensity '+intensity+' on the JMA scale. '+
        (Number.isFinite(depth) && depth>=0 ? 'Reported depth '+depth+' km. ' : '')+
        'Source: Japan Meteorological Agency website. Selected and formatted by Capstone Viewer.'+affected,
      confidence:'Official measurement'+(corrected ? ' · corrected by source' : ''),
      magnitude,score:level>=7 ? 83 : level>=5 ? 69 : 49,
      ...(placed ? {lon,lat,place,place_basis:'seismic_origin',location_note:'Hypocenter coordinates from the Japan Meteorological Agency.'} : {})
    },now);
    if (report) reports.push(report);
  }
  return reports;
}

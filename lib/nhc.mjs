import { event, safeUrl, text } from './events.mjs';
import { trackSegments } from './geo-track.mjs';

const provider = 'https://www.nhc.noaa.gov';
export const nhcSource = 'NOAA National Hurricane Center';
export const nhcUrl = provider+'/CurrentStorms.json';
export const nhcReference = provider+'/cyclones/';
const names = {
  TD:'Tropical depression',STD:'Subtropical depression',TS:'Tropical storm',HU:'Hurricane',
  STS:'Subtropical storm',PTC:'Post-tropical cyclone',TY:'Typhoon',PC:'Potential tropical cyclone'
};
const utc = time => typeof time==='string' && /Z$/.test(time) ? Date.parse(time) : NaN;
const numeric = value => typeof value==='number' || (typeof value==='string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) ?
  Number(value) : NaN;
const labelTime = time => new Date(time).toISOString().replace('T',' ').slice(0,16)+' UTC';

export function normalizeNHC(data, now = Date.now()) {
  if (!Array.isArray(data?.activeStorms)) throw Error('Expected NOAA National Hurricane Center tropical cyclone status');
  const reports = new Map();
  for (const storm of data.activeStorms) {
    if (!/^(?:al|ep|cp)\d{2}20\d{2}$/.test(storm?.id || '') || !Object.hasOwn(names,storm.classification)) continue;
    const advisory = storm.publicAdvisory;
    const number = typeof advisory?.advNum==='string' && /^\d{3}[a-z]?$/i.test(advisory.advNum) ? advisory.advNum.toUpperCase() : '';
    const issued = utc(advisory?.issuance);
    const href = safeUrl(advisory?.url);
    const source = href && new URL(href);
    if (!number || !Number.isFinite(issued) || source?.protocol!=='https:' ||
        !['www.nhc.noaa.gov','www.hurricanes.gov'].includes(source.hostname)) continue;

    const name = text(storm.name) || storm.id.toUpperCase();
    const classification = names[storm.classification];
    const centerUpdated = utc(storm.lastUpdate);
    const lat = numeric(storm.latitudeNumeric ?? storm.latitude_numeric);
    const lon = numeric(storm.longitudeNumeric ?? storm.longitude_numeric);
    const located = Number.isFinite(centerUpdated) && centerUpdated<=now+300_000 &&
      Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180;
    const wind = numeric(storm.intensity), pressure = numeric(storm.pressure);
    const base = provider+'/archive/'+storm.id.slice(4)+'/'+storm.id.slice(0,4)+'/';
    const interim = number.length>3;
    const report = event({
      key:'nhc:'+storm.id+':'+number,ts:new Date(issued).toISOString(),source:nhcSource,source_date_basis:'advisory_issued',
      title:classification+' '+name+' · Advisory '+number,
      summary:[
        located ? 'NHC reported center as of '+labelTime(centerUpdated)+'.' : '',
        Number.isFinite(wind) && wind>=0 ? 'Maximum sustained wind '+wind+' kt.' : '',
        Number.isFinite(pressure) && pressure>0 ? 'Central pressure '+pressure+' hPa.' : '',
        interim ? 'The source link opens the storm’s public advisory archive.' : ''
      ].filter(Boolean).join(' '),
      url:interim ? base : base+storm.id+'.public.'+number+'.shtml',
      ...(interim ? {source_url_scope:'archive'} : {}),
      category:'geo',kind:'tropical_cyclone',cyclone_id:storm.id,confidence:'Official tropical cyclone advisory',
      score:storm.classification==='HU' ? 83 : storm.classification==='TS' ? 72 : 61,
      ...(located ? {lat,lon,cyclone_center_at:new Date(centerUpdated).toISOString(),place:name+' storm center',place_basis:'cyclone_center',
        location_note:'Storm center reported by the National Hurricane Center. Read the advisory for the areas affected.'} : {})
    },now);
    if (report && !reports.has(report.id)) reports.set(report.id,report);
  }
  return [...reports.values()];
}
export function withCycloneTracks(reports) {
  const storms = new Map();
  for (const report of reports) {
    if (report.kind!=='tropical_cyclone' || !report.cyclone_id || !Number.isFinite(report.lat) ||
        !Number.isFinite(report.lon) || !Number.isFinite(Date.parse(report.cyclone_center_at))) continue;
    if (!storms.has(report.cyclone_id)) storms.set(report.cyclone_id,[]);
    storms.get(report.cyclone_id).push(report);
  }
  if (!storms.size) return reports;
  const tracks = new Map();
  for (const advisories of storms.values()) {
    const positions = new Map();
    advisories.sort((a,b)=>a.ts.localeCompare(b.ts) || a.cyclone_center_at.localeCompare(b.cyclone_center_at));
    for (const report of advisories) {
      positions.set(report.cyclone_center_at,[report.lon,report.lat]);
      const dates = [...positions.keys()].filter(date=>date<=report.cyclone_center_at).sort().slice(-24);
      const points = [];
      for (const date of dates) {
        const point = positions.get(date);
        const prior = points.at(-1);
        if (!prior || point[0]!==prior[0] || point[1]!==prior[1]) points.push(point);
      }
      const lines = trackSegments(points);
      if (lines.length) tracks.set(report.id,{type:'MultiLineString',coordinates:lines});
    }
  }
  return reports.map(report=>tracks.has(report.id) ? {...report,observation_track:tracks.get(report.id)} : report);
}
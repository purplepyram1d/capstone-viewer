import '../assets/event-types.js';
import {createHash} from 'node:crypto';
import {reportTags} from './report-tags.mjs';
export const sourceRoles=['publisher','researcher','vendor','relay','official','measurement','unknown'];
const known={thehackernews:['publisher','en'],vxunderground:['researcher','en'],osintindustries:['vendor','en'],liveuamap:['relay','en'],osintdefender:['relay','en'],kyivindependent_official:['publisher','en'],bbcrussian:['publisher','ru'],meduzalive:['publisher','ru']};
export function sourceContext(r){let handle='';try{const u=new URL(r.url);if(u.hostname==='t.me')handle=u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();}catch{}
 const context=known[handle];if(context)return {role:context[0],language:context[1],basis:'Reviewed starter channel role; individual reports remain unverified.'};
 if(r.kind==='volcano_weekly')return {role:'official',language:'en',basis:'Preliminary weekly synthesis from the Smithsonian Global Volcanism Program and USGS. Open the dated report for contributing source material.'};
 if(r.kind==='volcano_bulletin')return {role:'official',language:'en',basis:'Volcano observatory notice. Open the issuing agency’s latest bulletin for current status.'};
 if(r.kind==='mapping_activation')return {role:'official',language:'en',basis:'An emergency mapping activation. Review published maps or assessments for measured damage.'};
 if(r.kind==='earth_observation')return {role:'official',language:'en',basis:'NASA catalog entry based on listed source references. Tracks show the dates and positions supplied by the catalog.'};
 if(r.kind==='wildfire_record')return {role:'official',language:'en',basis:r.source==='BC Wildfire Service incidents' ?
   'Provincial wildfire incident dated by ignition. The point comes from the published incident inventory.' :
   'Federal wildfire record dated by fire discovery. The source point marks the origin. Check the inventory for current status.'};
 if(r.source==='EMSC regional earthquakes')return {role:'measurement',basis:'Seismic solution indexed by EMSC. The record names the contributing authority when published.'};
 if(r.source==='Japan Meteorological Agency earthquakes')return r.kind==='earthquake_withdrawal' ?
   {role:'official',basis:'Japan Meteorological Agency cancellation. Earlier receipts preserve the original report.'} :
   {role:'measurement',basis:'Japan Meteorological Agency website. Shaking intensity uses the JMA scale. Capstone selects and formats the source records.'};
 if(r.source==='GeoNet earthquakes')return r.kind==='earthquake_withdrawal' ?
   {role:'official',language:'en',basis:'GeoNet removed the previous solution. Earlier receipts preserve what was previously collected.'} :
   {role:'measurement',language:'en',basis:'GeoNet’s preferred earthquake solution. The reported shaking at the closest locality is an estimate.'};
 if(r.kind==='tropical_cyclone')return {role:'official',language:'en',basis:'National Hurricane Center advisory. The mapped center is dated at the time stated by the advisory.'};
 if(r.kind==='disaster_declaration')return {role:'official',language:'en',basis:'Federal declaration of designated areas. The declaration date and incident period are separate source fields.'};
 if(r.kind==='humanitarian_record')return {role:'official',basis:'IFRC GO emergency catalog. The source date is the entry creation time and the listed incident start is shown separately when provided.'};
 if(r.kind==='local_storm_report')return {role:'official',language:'en',basis:'Preliminary local storm report relayed by an NWS office. Open the source for the reported impact. The source feed covers 72 hours.'};
 if(r.kind==='river_gauge')return {role:'measurement',language:'en',basis:'Observed gauge stage at the source time. The gauge page shows updated measurements and forecasts.'};
 if(r.feed_id==='ea-floods')return {role:'official',language:'en',basis:'Environment Agency flood alert, warning or removal. Area boundaries are generalized on the map. Open GOV.UK for the latest area status.'};
 if(r.feed_id==='drivebc-closures')return {role:'official',language:'en',basis:'DriveBC closure listing with the currently applicable published time window and source geography.'};
 if(r.kind==='road_closure')return {role:'official',language:'en',basis:'Full closure reported by Caltrans for the named highway or direction. The point identifies the start of the closure.'};
 if(r.kind==='airport_disruption')return {role:'official',language:'en',basis:'FAA status for the airport reference point. The airport source provides listing times and stated scope.'};
 if(r.kind==='weather_alert' && r.feed_id==='eccc-weather')return {role:'official',basis:'Environment and Climate Change Canada bulletin at issue time. Open the bulletin for the affected areas and latest instructions.'};
 if(r.kind==='weather_alert')return {role:'official',language:'en',basis:r.source?.startsWith('MeteoAlarm · ') ?
   'Bulletin from an EUMETNET member via MeteoAlarm. Check the issuing service for current conditions.' :
   'A National Weather Service bulletin at the time it was issued. Check NWS for the latest bulletin and instructions.'};
 if(r.kind==='tsunami')return {role:'official',language:'en',basis:'National Weather Service bulletin. Check the original and local authorities for current instructions.'};
 if(r.kind==='space_weather')return {role:'official',basis:'NOAA distinguishes observations from forecasts. Open the bulletins and use the serial number to find the original.'};
 if(r.kind==='hazard')return {role:'official',basis:'GDACS models potential impact. Use local authorities for emergency instructions.'};
 if(!r.platform&&['Japan Vulnerability Notes','JPCERT/CC security alerts'].includes(r.source))return {role:'official',language:'en',basis:'Japan’s coordinated vulnerability disclosures and incident advisories. Verify affected products and local exposure.'};
 if(!r.platform&&r.source==='CERT-FR advisories')return {role:'official',language:'fr',basis:'National CERT advisory in French. Check affected products and your local exposure.'};
 if(!r.platform&&['CISA KEV','CISA advisories','NVD','UK NCSC publications','CERT-EU advisories'].includes(r.source))return {role:'official',basis:'Government advisory/catalog source; local exposure is not established.'};
 if(r.source==='Cloudflare Radar')return {role:'measurement',basis:'Provider annotations and detections reflect available network observations. Check attribution separately.'};
 if(!r.platform&&['IODA','IODA internet outages','USGS earthquakes','RIS Live','RIPE RIS Live'].includes(r.source))return {role:'measurement',basis:'Source measurement; coverage and attribution have limits.'};
 if(!r.platform&&['BBC World','The Guardian World','UN News','IEEE Spectrum Robotics'].includes(r.source))return {role:'publisher',language:'en',basis:'Publisher reporting; individual claims require context.'};
 if(!r.platform&&['OpenAI News','Google DeepMind'].includes(r.source))return {role:'vendor',language:'en',basis:'The company describes its own products or research. Check methods and independent results for performance claims.'};
 if(!r.platform&&r.source==='CMU Robotics Institute')return {role:'researcher',language:'en',basis:'University reporting on its robotics programs and research.'};
 return {role:'unknown',basis:'Source role has not been reviewed.'};
}
export const sourceKey=r=>r.source_id||r.source||'Unknown source';
const fold=v=>String(v||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export function muted(r,tags,state){if(state.sources.some(s=>s.key===sourceKey(r)))return true;if(!state.subjects.length)return false;const text=fold([r.title,r.summary,...reportTags(r,tags).map(t=>t.label)].join(' '));return state.subjects.some(term=>text.includes(fold(term)));}
export function canonicalCitation(value) {
 try {
  const u = new URL(value);
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.pathname === '/' ||
      ['t.me','x.com','twitter.com'].includes(u.hostname.replace(/^(?:www|mobile)\./,''))) return null;
  u.hash='';
  for (const key of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
  return u.href;
 } catch { return null; }
}
export function coverageKey(r){if(globalThis.CapstoneTypes.sourceReference(r))return 'report:'+r.id;const day=String(r.ts).slice(0,10);
 const cited=[...new Set((r.citation_urls||[]).map(canonicalCitation).filter(Boolean))];
 const link=cited.length===1?cited[0]:!r.platform?canonicalCitation(r.url):null;
 if(link)return 'link:'+day+':'+link;
 const body=fold(r.title)+'|'+fold(r.summary);return body.length>=80?'text:'+day+':'+createHash('sha256').update(body).digest('hex'):'report:'+r.id;
}
export function createReading(db){
 db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL)');
 const state=()=>JSON.parse(db.prepare("SELECT data FROM settings WHERE key='reading'").get()?.data||'{"sources":[],"subjects":[]}');
 return {state,update(input){if(!input||!Array.isArray(input.sources)||!Array.isArray(input.subjects)||input.sources.length>100||input.subjects.length>100)throw Error('Use up to 100 source and subject mutes.');
 const sources=input.sources.map(s=>{if(!s||typeof s.key!=='string'||!s.key.trim()||s.key.length>200||typeof s.label!=='string'||!s.label.trim()||s.label.length>200)throw Error('Each source mute needs a key and label of 1 to 200 characters.');return {key:s.key,label:s.label};});
 const subjects=input.subjects.map(s=>{if(typeof s!=='string'||!s.trim()||s.trim().length>100)throw Error('Use subject phrases of 1 to 100 characters.');return s.trim();});
 const next={sources:[...new Map(sources.map(s=>[s.key,s])).values()],subjects:[...new Map(subjects.map(s=>[fold(s),s])).values()]};db.prepare("INSERT INTO settings VALUES('reading',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(next));return next;}};
}

import {createHash} from 'node:crypto';
import {reportTags} from './report-tags.mjs';
export const sourceRoles=['publisher','researcher','vendor','relay','official','measurement','unknown'];
const known={thehackernews:['publisher','en'],vxunderground:['researcher','en'],osintindustries:['vendor','en'],liveuamap:['relay','en'],osintdefender:['relay','en'],kyivindependent_official:['publisher','en'],bbcrussian:['publisher','ru'],meduzalive:['publisher','ru']};
export function sourceContext(r){let handle='';try{const u=new URL(r.url);if(u.hostname==='t.me')handle=u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();}catch{}
 const context=known[handle];if(context)return {role:context[0],language:context[1],basis:'Reviewed starter channel role; individual reports remain unverified.'};
 if(!r.platform&&['CISA KEV','CISA advisories','NVD'].includes(r.source))return {role:'official',basis:'Government advisory/catalog source; local exposure is not established.'};
 if(!r.platform&&['IODA','IODA internet outages','USGS earthquakes','RIS Live','Cloudflare Radar'].includes(r.source))return {role:'measurement',basis:'Source measurement; coverage and attribution have limits.'};
 if(!r.platform&&r.source==='BBC World')return {role:'publisher',language:'en',basis:'Publisher reporting; individual claims require context.'};
 return {role:'unknown',basis:'Source role has not been reviewed.'};
}
export const sourceKey=r=>r.source_id||r.source||'Unknown source';
const fold=v=>String(v||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
export function muted(r,tags,state){if(state.sources.some(s=>s.key===sourceKey(r)))return true;const text=fold([r.title,r.summary,...reportTags(r,tags).map(t=>t.label)].join(' '));return state.subjects.some(term=>text.includes(fold(term)));}
export function coverageKey(r){const day=String(r.ts).slice(0,10);let url;try{const u=new URL(r.url);if(!['t.me','x.com','twitter.com'].includes(u.hostname)&&!r.platform&&u.pathname!=='/'){u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/.test(k))u.searchParams.delete(k);url=u.href;}}catch{}
 const cited=(r.citation_urls||[]).filter(v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)&&!['t.me','x.com','twitter.com'].includes(u.hostname)&&u.pathname!=='/';}catch{return false;}});
 const link=cited.length===1?cited[0]:url;
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

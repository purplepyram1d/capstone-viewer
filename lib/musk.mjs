import {groupCoverage} from './coverage.mjs';
import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';
import { event, parseRSS, safeUrl, DAY } from './events.mjs';
export const muskEntities = [
 {id:'elon',name:'Elon Musk',query:'"Elon Musk"',official:'https://x.com/elonmusk'},
 {id:'tesla',name:'Tesla',query:'Tesla (Musk OR electric OR robotaxi OR Optimus OR Cybertruck)',official:'https://ir.tesla.com/'},
 {id:'spacex',name:'SpaceX',query:'SpaceX',official:'https://www.spacex.com/updates/'},
 {id:'starlink',name:'Starlink',query:'Starlink',official:'https://www.starlink.com/updates'},
 {id:'xai',name:'xAI / Grok',query:'(xAI OR "Grok AI" OR "Grok chatbot")',official:'https://x.ai/news'},
 {id:'neuralink',name:'Neuralink',query:'Neuralink',official:'https://neuralink.com/updates/'},
 {id:'boring',name:'The Boring Company',query:'"The Boring Company"',official:'https://www.boringcompany.com/'},
 {id:'x',name:'X / Twitter',query:'("X" (Musk OR Twitter))',official:'https://blog.x.com/'}
];
const plain=value=>load(String(value??'')).text().replace(/\s+/g,' ').trim();
export function matchMuskEntities(value) {
 const t=String(value||'').normalize('NFKC');const ids=[];
 if(/\belon\s+musk\b/i.test(t))ids.push('elon');
 if(/\btesla\b/i.test(t)&&(!/\bnikola tesla\b|\btesla coils?\b/i.test(t)||/\bmusk\b|\bcybertruck\b|\brobotaxi\b/i.test(t)))ids.push('tesla');
 if(/\bspacex\b|\bspace exploration technologies\b/i.test(t))ids.push('spacex');
 if(/\bstarlink\b/i.test(t))ids.push('starlink');
 if(/\bgrok\b/i.test(t)||/\bxai\b/i.test(t)&&!/\bxai octagon\b/i.test(t))ids.push('xai');
 if(/\bneuralink\b/i.test(t))ids.push('neuralink');
 if(/\b(?:the\s+)?boring (?:company|co\.?)\b/i.test(t))ids.push('boring');
 if(/\btwitter\b|\bx\.com\b|\bx corp\b|\bx platform\b|\bx \(formerly twitter\)|\bmusk(?:'s|’s)?\s+x\b|\bx(?:'s|’s)?\s+(?:social network|algorithm|premium|subscription|users|accounts|owner|ceo|advertising|payments|content moderation)\b/i.test(t))ids.push('x');
 return ids;
}
export function muskNewsUrl(entity) {return 'https://news.google.com/rss/search?'+new URLSearchParams({q:entity.query+' when:7d',hl:'en-US',gl:'US',ceid:'US:en'});}
export function normalizeMuskNews(xml,now=Date.now(),{match=matchMuskEntities,tracker='musk',category=null}={}) {
 const parsed=parseRSS(xml),doc=new XMLParser({ignoreAttributes:false,processEntities:false}).parse(xml);let items=doc.rss?.channel?.item||[];if(!Array.isArray(items))items=[items];
 return parsed.map((row,i)=>{
   const source=items[i]?.source,publisher=plain(typeof source==='object'?source?.['#text']:source)||'Publisher listed on Google News';
   let title=plain(row.title);const suffix=' - '+publisher;if(title.endsWith(suffix))title=title.slice(0,-suffix.length);
   const entities=match(title);if(!entities.length)return null;
   const url=safeUrl(plain(row.url));let host;try{host=new URL(url).hostname;}catch{return null;}if(host!=='news.google.com')return null;
   return event({key:tracker+':'+url,title,url,ts:row.ts,summary:'News coverage indexed by Google News. Open the publisher report to read the full account.',source:publisher,publisher,tracker,entities,source_type:'coverage',category:category||(entities.includes('xai')?'ai':'geo'),kind:'report',score:35,confidence:'Publisher coverage via Google News, not independently verified'},now);
 }).filter(Boolean);
}
export function createMuskTracker(db,{registry=muskEntities,match=matchMuskEntities,tracker='musk',matchXAuthors=true,decorate=report=>report}={}) {
 return {list(params=new URLSearchParams()) {
   const now=Date.now(),days=[1,7,30].includes(Number(params.get('days')))?Number(params.get('days')):7;
   const query=(params.get('q')||'').trim().toLowerCase().slice(0,250),entity=params.get('entity')||'',kind=params.get('kind')||'';
   const raw=db.prepare('SELECT data FROM events WHERE ts>=? ORDER BY ts DESC,id DESC').all(new Date(now-days*DAY).toISOString());
   const seen=new Set(),reports=[];
   for(const row of raw){const e=JSON.parse(row.data);const ids=match(e.title);if(matchXAuthors&&e.platform==='x'){try{const u=new URL(e.url),account=u.pathname.split('/')[1]?.toLowerCase(),author={elonmusk:'elon',tesla:'tesla',spacex:'spacex',starlink:'starlink',xai:'xai',grok:'xai',neuralink:'neuralink',boringcompany:'boring',x:'x'}[account];if(['x.com','twitter.com'].includes(u.hostname)&&author&&!ids.includes(author))ids.push(author);}catch{}}if(!ids.length)continue;const entities=e.tracker===tracker?[...new Set([...(e.entities||[]),...ids])]:ids;
     if(query&&!`${e.title} ${e.summary} ${e.source}`.toLowerCase().includes(query))continue;
     if(kind==='coverage'&&e.tracker!==tracker||kind==='collected'&&e.tracker===tracker)continue;
     const key=e.title.toLowerCase()+'|'+String(e.source||'').toLowerCase()+'|'+e.ts.slice(0,10);if(seen.has(key))continue;seen.add(key);reports.push(decorate({...e,entities}));
   }
   const counts=Object.fromEntries(registry.map(e=>[e.id,reports.filter(r=>r.entities.includes(e.id)).length]));
   const selectedReports=entity?reports.filter(e=>e.entities.includes(entity)):reports;
   const selected=params.get('view')==='stories'?groupCoverage(selectedReports):selectedReports,total=selected.length;
   const offset=Math.min(Math.max(0,Math.floor(Number(params.get('offset'))||0)),Math.max(0,Math.floor((total-1)/50)*50));
   return {now:new Date(now).toISOString(),entities:registry.map(e=>({id:e.id,name:e.name,official:e.official,reference_label:e.reference_label,count:counts[e.id]})),events:selected.slice(offset,offset+50),total,total_reports:selectedReports.length,view:params.get('view')==='stories'?'stories':'reports',offset,pageSize:50};
 }};
}

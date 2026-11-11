import {createHash} from 'node:crypto';
const stop=new Set('a an the and or to of in on at for by with from is are was were has have as its it after over says said'.split(' '));
function words(title){return String(title).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(w=>w&&!stop.has(w));}
const direction=t=>[...String(t).toLowerCase().matchAll(/\b(no|not|never|denies|denied|confirms|confirmed|approves|approved|rejects|rejected|cancels|cancelled)\b/g)].map(m=>m[0]).sort().join('|');
const numbers=t=>[...String(t).matchAll(/\d+(?:[.,]\d+)*/g)].map(m=>m[0]).sort().join('|');
export function groupCoverage(reports){
 const groups=[],index=new Map();
 for(const report of reports){const tokens=new Set(words(report.title)),key=words(report.title).join(' '),candidates=new Map();for(const w of tokens)for(const i of index.get(w)||[])candidates.set(i,(candidates.get(i)||0)+1);
 let group;
 for(const [i,shared] of candidates){const candidate=groups[i],r=candidate.reports[0];if(Math.abs(Date.parse(report.ts)-Date.parse(r.ts))>48*3600000||!(report.entities||[]).some(e=>(r.entities||[]).includes(e)))continue;
 const exact=key===candidate.key&&tokens.size>=4;
 const similar=shared>=6&&shared/(tokens.size+candidate.tokens.size-shared)>=.8&&numbers(report.title)===numbers(r.title)&&direction(report.title)===direction(r.title);
 if(exact||similar){group=candidate;break;}}
 if(group)group.reports.push(report);else{const i=groups.length;groups.push({key,tokens,reports:[report]});for(const w of tokens){if(!index.has(w))index.set(w,[]);index.get(w).push(i);}}
 }
 return groups.map(g=>({...g.reports[0],story_id:'coverage-'+createHash('sha256').update(g.key).digest('hex').slice(0,20),reports:g.reports,report_count:g.reports.length,source_count:new Set(g.reports.map(r=>r.source)).size,entities:[...new Set(g.reports.flatMap(r=>r.entities||[]))],group_basis:g.reports.length>1?'Matching or very similar headlines within 48 hours. Sources may quote each other.':null}));
}

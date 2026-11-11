import {readFileSync} from 'node:fs';
const countries=JSON.parse(readFileSync(new URL('../assets/countries.json',import.meta.url)));
export function mergeTags(tags){const seen=new Set();return tags.filter(t=>{const key=t.type+':'+t.label.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});}
export function reportTags(report,manual=[]){const tags=manual.map(t=>({...t,origin:'manual'}));
 const subjects={ransomware:'Ransomware claim',claim:report.claim_type?report.claim_type+' claim':'Attack claim',incident:'Reported incident',outage:'Internet outage',routing:'Routing',cve:'Vulnerability',kev:'Known exploited vulnerability',earthquake:'Earthquake',conflict:'Conflict',social:'Social post'};
 if(subjects[report.kind])tags.push({type:'subject',label:subjects[report.kind],origin:'source'});
 if(['cyber','geo','ai'].includes(report.category))tags.push({type:'subject',label:{cyber:'Cyber',geo:'World',ai:'AI & robotics'}[report.category],origin:'source'});
 const code=String(report.country||'').toUpperCase(),country=countries[code]?.name||(report.place_basis==='country_centroid'?report.place:null);
 if(country)tags.push({type:'country',label:country,origin:'source'});
 for(const cve of report.cves||[])tags.push({type:'cve',label:cve,origin:'source'});
 return mergeTags(tags);
}

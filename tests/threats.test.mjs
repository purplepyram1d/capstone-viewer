import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { normalizeThreatFox, normalizeURLhaus, normalizeNVD, createEpss, nvdUrl } from '../lib/threats.mjs';
const now=Date.parse('2026-10-23T15:00:00Z');

test('ThreatFox rolls up to one report per family per day, never per indicator',()=>{
 const ioc=(malware,printable,t,i)=>({ioc:`198.51.100.${i}:443`,threat_type:'botnet_cc',threat_type_desc:'Botnet C2',malware,malware_printable:printable,first_seen:`2026-10-23 ${t} UTC`});
 const data={query_status:'ok',data:[...Array.from({length:30},(_,i)=>ioc('win.cobalt_strike','Cobalt Strike','10:0'+(i%10)+':00',i)),ioc('win.x','Lumma',  '09:00:00',1),ioc('win.x','Lumma','09:01:00',2),ioc('unknown','Unknown malware','09:00:00',3),ioc('unknown','Unknown malware','09:00:00',4),ioc('unknown','Unknown malware','09:00:00',5)]};
 const events=normalizeThreatFox(data,now);
 assert.equal(events.length,1,'families under 3 indicators and Unknown malware are dropped');
 const [e]=events;assert.equal(e.indicator_count,30);assert.equal(e.kind,'infrastructure');assert.equal(e.score,60);assert.equal(e.url,'https://threatfox.abuse.ch/browse/malware/win.cobalt_strike/');
 assert.doesNotMatch(JSON.stringify(e),/198\.51\.100/,'indicators are not copied');assert.equal(e.ts,'2026-10-23T10:09:00.000Z');
 assert.equal(normalizeThreatFox(data,now)[0].id,e.id);
 assert.deepEqual(normalizeThreatFox({query_status:'no_result'},now),[]);assert.throws(()=>normalizeThreatFox({query_status:'unknown_auth_key'},now),/unknown_auth_key/);
});

test('URLhaus groups by the first non-generic tag and counts what is still online',()=>{
 const url=(i,tags,status)=>({url:`http://203.0.113.${i}/x`,url_status:status,date_added:'2026-10-23 08:00:00 UTC',tags});
 const data={query_status:'ok',urls:[url(1,['elf','Mozi'],'online'),url(2,['32-bit','elf','Mozi'],'offline'),url(3,['Mozi'],'online'),url(4,['exe'],'online'),url(5,['exe'],'online'),url(6,['exe'],'online')]};
 const [e,...rest]=normalizeURLhaus(data,now);
 assert.equal(rest.length,0,'generic file-type tags do not form a group');assert.match(e.title,/^Mozi: 3 new/);assert.match(e.summary,/2 still online/);assert.equal(e.url,'https://urlhaus.abuse.ch/browse/tag/Mozi/');
 assert.doesNotMatch(JSON.stringify(e),/203\.0\.113/);
});

test('NVD keeps CVSS 9+ records with publisher attribution and UTC timestamps',()=>{
 const cve=(id,score,status='Analyzed')=>({cve:{id,published:'2026-10-22T19:17:00.78',vulnStatus:status,descriptions:[{lang:'en',value:`Buffer overflow in Widget ${id}. More text.`}],metrics:{cvssMetricV31:[{source:'cna@example.org',type:'Secondary',cvssData:{baseScore:score}},{source:'nvd@nist.gov',type:'Primary',cvssData:{baseScore:score}}]}}});
 const events=normalizeNVD({vulnerabilities:[cve('CVE-2026-1000',9.8),cve('CVE-2026-1001',8.1),cve('CVE-2026-1002',10,'Rejected')]},now);
 assert.equal(events.length,1);const [e]=events;
 assert.equal(e.ts,'2026-10-22T19:17:00.780Z');assert.deepEqual(e.cves,['CVE-2026-1000']);assert.equal(e.cvss,9.8);assert.match(e.summary,/nvd@nist\.gov/);assert.match(e.summary,/not evidence of exploitation/);
 assert.match(nvdUrl(now),/cvssV3Severity=CRITICAL/);
});

test('EPSS caches scores daily, retries unscored CVEs, and attaches the highest score',async()=>{
 const db=new DatabaseSync(':memory:');let calls=[];
 const request=async url=>{calls.push(url);return {ok:true,json:async()=>({data:[{cve:'CVE-2024-3400',epss:'0.97',percentile:'0.999',date:'2026-10-23'},{cve:'CVE-2026-0001',epss:'0.02',percentile:'0.6',date:'2026-10-23'}]})};};
 const epss=createEpss(db,request);
 assert.equal(await epss.refresh(['CVE-2024-3400','CVE-2026-0001','CVE-2026-9999','not-a-cve'],now),3);
 assert.equal(calls.length,1);assert.match(calls[0],/cve=CVE-2024-3400,CVE-2026-0001,CVE-2026-9999$/);
 assert.equal(await epss.refresh(['CVE-2024-3400','CVE-2026-9999'],now+3600000),0,'fresh within 20 hours, including the unscored one');
 assert.equal(await epss.refresh(['CVE-2026-9999'],now+21*3600000),1,'unscored CVEs are retried the next day');
 const [story,plain]=epss.attach([{id:'s',cves:['CVE-2026-0001','CVE-2024-3400','CVE-2026-9999']},{id:'p',cves:[]}]);
 assert.equal(story.epss.cve,'CVE-2024-3400');assert.equal(story.epss.epss,0.97);assert.equal(plain.epss,undefined);
});

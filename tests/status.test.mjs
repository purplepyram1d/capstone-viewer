import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, volume } from '../lib/status.mjs';
const now=Date.parse('2026-10-23T15:00:00Z'),hours=h=>new Date(now-h*3600000).toISOString();
const tile=(status,id)=>status.find(t=>t.id===id);

test('volume compares each source only against days it has really been collected',()=>{
 // A Telegram channel added an hour ago returns a week of backlog: no baseline, no spike.
 const backlog=[...Array(20)].map((_,i)=>({source_id:'new',ts:hours(i*8)}));
 const fresh=volume(backlog,now,{new:now-3600000});assert.equal(fresh.baseline,null);assert.equal(fresh.building,1);
 // A source collected for 6 days: 4 posts today against 2 a day before.
 const steady=[...Array(4)].map((_,i)=>({feed_id:'old',ts:hours(1+i)})).concat([...Array(10)].map((_,i)=>({feed_id:'old',ts:hours(25+i*10)})));
 const v=volume([...steady,...backlog],now,{old:now-6*86400000,new:now-3600000});
 assert.equal(v.last24,4,'the new source is left out of both sides');assert.equal(v.baseline,2);assert.equal(v.ratio,2);assert.equal(v.mature,1);assert.equal(v.building,1);
 assert.equal(volume([{ts:hours(1)}],now,{}).baseline,null,'reports without a source are not counted');
});

test('quiet data is green on every tile, and each tile explains itself',()=>{
 const status=computeStatus({reports:[],hotspots:[],pulse:null,now});
 assert.deepEqual(status.map(t=>t.level),['green','green','green','green']);
 for(const t of status){assert.ok(t.inputs.length);assert.match(t.rule,/Red:.*Amber:/);}
});

test('thresholds escalate tiles from their own inputs',()=>{
 const reports=[
  {kind:'outage',ongoing:true,score:85,country:'IR',ts:hours(50)},{kind:'outage',ongoing:true,score:60,country:'GU',ts:hours(5)},
  {source:'CISA KEV',score:95,cves:['CVE-2026-1'],ts:hours(20)},
  {kind:'vulnerability',ts:hours(3),cves:['CVE-2026-2']},
  {platform:'bluesky',kind:'social',source_id:'a',cves:['CVE-2026-9'],ts:hours(2)},{platform:'mastodon',kind:'social',source_id:'b',cves:['CVE-2026-9'],ts:hours(4)},{platform:'bluesky',kind:'claim',claim_type:'hacktivist',source_id:'h',place:'Lithuania',cves:['CVE-2026-9'],ts:hours(1)},
  {ts:hours(6),cves:['CVE-2024-3400'],epss:{cve:'CVE-2024-3400',epss:0.97}}
 ];
 const hotspots=[{name:'Iran',families:[{id:'internet'},{id:'world'},{id:'social'}],spike:null}];
 const s=computeStatus({reports,hotspots,pulse:{ratio:1.1,surge:false},now});
 assert.equal(tile(s,'internet').level,'amber');assert.match(tile(s,'internet').headline,/2 countries with ongoing outages, 1 major/);
 assert.equal(tile(s,'cyber').level,'red','KEV with known ransomware use');assert.match(tile(s,'cyber').inputs[3].note,/CVE-2024-3400 97%/);
 assert.equal(tile(s,'conflict').level,'red','hot spot with three kinds of signal');
 assert.equal(tile(s,'social').level,'amber','claims are not chatter, so CVE-2026-9 has 2 sources, not 3');assert.equal(tile(s,'cyber').inputs[5].value,1);assert.match(tile(s,'cyber').inputs[5].note,/Lithuania 1/);assert.equal(tile(s,'cyber').inputs[6].value,1);assert.match(tile(s,'social').inputs[1].note,/CVE-2026-9 \(2\)/);
 assert.equal(tile(computeStatus({reports,hotspots,pulse:{ratio:5,surge:true},now}),'internet').level,'red');
});

test('the Conflict tile counts kinds of signal, not flavors of one kind',()=>{
 const flavors=[{name:'United States',families:[{id:'ransomware'},{id:'claims'},{id:'incident'}],kinds:1,spike:null}];
 assert.equal(computeStatus({reports:[],hotspots:flavors,now}).find(t=>t.id==='conflict').level,'green');
 const three=[{name:'Iran',families:[{id:'internet'},{id:'world'},{id:'hacktivist'}],kinds:3,spike:null}];
 assert.equal(computeStatus({reports:[],hotspots:three,now}).find(t=>t.id==='conflict').level,'red');
});

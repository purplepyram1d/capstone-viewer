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

test('a partial live window withholds volume comparisons but keeps observed incident thresholds',()=>{
 const stored = [
  ...[26,50,74,98,122].map(offset=>({kind:'report',category:'geo',feed_id:'world',ts:hours(offset)})),
  ...Array.from({length:7},(_,i)=>({kind:'report',category:'geo',feed_id:'world',ts:hours(i+1)})),
  {kind:'outage',score:85,country:'IR',ongoing:true,ts:hours(1)}
 ];
 const since={world:now-6*86400000};
 assert.equal(tile(computeStatus({reports:stored,since,now}),'conflict').level,'red');
 const partial=computeStatus({reports:stored,since,now,volumeComparable:false});
 assert.equal(tile(partial,'conflict').level,'green');
 assert.match(tile(partial,'conflict').inputs.at(-1).value,/limit reached/);
 assert.equal(tile(partial,'internet').level,'amber');
});

test('weather bulletins and mapping activations do not inflate the world news baseline',()=>{
 const older = [...Array(5)].map((_,i)=>({kind:'report',category:'geo',feed_id:'world',ts:hours(26+i*24)}));
 const background = [...Array(5)].map((_,i)=>({kind:'weather_alert',category:'geo',feed_id:'nws-alerts',ts:hours(26+i*24)}));
 const newProducts = ['weather_alert','mapping_activation','tsunami'].map((kind,i)=>({kind,category:'geo',ts:hours(1+i),
   feed_id:['nws-alerts','copernicus-mapping','ntwc'][i]}));
 const report = {kind:'report',category:'geo',feed_id:'world',ts:hours(1)};
 const since = Object.fromEntries(['world','nws-alerts','copernicus-mapping','ntwc'].map(id=>[id,now-7*86400000]));
 const baseline = tile(computeStatus({reports:[...older,report],since,now}),'conflict');
 const extraProducts = tile(computeStatus({reports:[...older,...background,...newProducts,report],since,now}),'conflict');
 assert.deepEqual(extraProducts,baseline);
});

test('quiet data is green on every tile, and each tile explains itself',()=>{
 const status=computeStatus({reports:[],hotspots:[],pulse:null,now});
 assert.deepEqual(status.map(t=>t.level),['green','green','green','green','green']);
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

test('Earth and weather uses fresh published warnings, recent gauges and measured earthquakes',()=>{
 const expired = {kind:'weather_alert',weather_listed_until:hours(1),ts:hours(2)};
 const listed = {...expired,weather_listed_until:new Date(now+60000).toISOString()};
 const gauge = {kind:'river_gauge',flood_stage:'major',url:'https://water.noaa.gov/gauges/test',ts:hours(2)};
 const moderate = {...gauge,flood_stage:'moderate',ts:hours(1)};
 const quake = {kind:'earthquake',magnitude:7.2,place:'Source epicenter',ts:hours(5)};
 const byEarth = reports => tile(computeStatus({reports,now}),'earth');
 assert.equal(byEarth([expired,{...gauge,ts:hours(4)}]).level,'green');
 assert.equal(byEarth([listed]).level,'amber');
 assert.equal(byEarth([gauge]).inputs[2].value,1);
 assert.equal(byEarth([gauge,moderate]).inputs[2].value,0);
 assert.equal(byEarth([quake]).level,'red');
 assert.equal(byEarth([quake]).alertLevel,'green');
});

test('the Conflict tile counts kinds of signal, not flavors of one kind',()=>{
 const flavors=[{name:'United States',families:[{id:'ransomware'},{id:'claims'},{id:'incident'}],kinds:1,spike:null}];
 assert.equal(computeStatus({reports:[],hotspots:flavors,now}).find(t=>t.id==='conflict').level,'green');
 const three=[{name:'Iran',families:[{id:'internet'},{id:'world'},{id:'hacktivist'}],kinds:3,spike:null}];
 assert.equal(computeStatus({reports:[],hotspots:three,now}).find(t=>t.id==='conflict').level,'red');
});

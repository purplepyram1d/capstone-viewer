import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { feedHealth, tileOf, withGaps } from '../lib/feedhealth.mjs';
import { createNotifier } from '../lib/notifier.mjs';
const now=Date.parse('2026-10-23T18:00:00Z'),ago=m=>new Date(now-m*60000).toISOString();

test('a feed is failing after an hour of errors, stalled after an hour quiet, and ignored when paused or keyless',()=>{
 const feeds=[
  {id:'ioda',name:'IODA',state:'error',failingSince:ago(75),error:'HTTP 500'},
  {id:'kev',name:'CISA KEV',state:'error',failingSince:ago(20),error:'timeout'},
  {id:'bbc',name:'BBC',state:'ok',lastSuccess:ago(90)},
  {id:'cisa',name:'CISA',state:'ok',lastSuccess:ago(10)},
  {id:'radar-outages',name:'Radar',state:'needs-key'},
  {id:'social-1',name:'Slow channel',platform:'telegram',category:'geo',intervalMinutes:60,enabled:true,state:'ok',lastSuccess:ago(150)},
  {id:'social-2',name:'Paused',platform:'x',enabled:false,state:'error',failingSince:ago(500)},
  {id:'social-3',name:'Hackmanac',platform:'bluesky',claims:true,category:'cyber',intervalMinutes:15,enabled:true,state:'error',failingSince:ago(61),error:'Bluesky returned HTTP 502.'}
 ];
 const p=feedHealth(feeds,{now,pulse:{lastMessage:ago(70),error:null}});
 assert.deepEqual(p.map(x=>`${x.id}:${x.kind}:${x.tile}`),['ioda:failing:internet','bbc:stalled:conflict','social-3:failing:cyber','ris-pulse:failing:internet']);
 assert.equal(feedHealth(feeds.slice(5,6),{now:now+40*60000}).length,1,'a 60-minute feed stalls only after three intervals');
 assert.equal(feedHealth([{id:'cisa',state:'ok',lastSuccess:ago(10)}],{now,pulse:{lastMessage:null}}).length,0,'a pulse that never connected yet is not reported');
 assert.equal(tileOf({id:'x',platform:'telegram',category:'cyber'}),'social');assert.equal(tileOf({id:'usgs'}),null);
 const tiles=withGaps([{id:'internet'},{id:'cyber'},{id:'social'}],p);
 assert.deepEqual(tiles.map(t=>t.gaps),[['IODA','RIPE RIS routing pulse'],['Hackmanac'],[]]);
});

test('feed failures notify once per outage, batch together, and respect the setting',()=>{
 let t=now;const sent=[],n=createNotifier(new DatabaseSync(':memory:'),m=>sent.push(m),{now:()=>t,clock:()=>new Date(2026,9,23,12,0)});
 const fail=(id,name)=>({id,name,kind:'failing',since:ago(70),detail:'HTTP 500'});
 n.check({feedHealth:[fail('old','Already broken')]});assert.equal(sent.length,0,'startup baseline');
 n.check({feedHealth:[fail('old','Already broken'),fail('ioda','IODA')]});
 assert.equal(sent.length,1);assert.equal(sent[0].title,'Feed failing: IODA');assert.match(sent[0].body,/^Failing since .* HTTP 500/);
 n.check({feedHealth:[fail('old','Already broken'),fail('ioda','IODA')]});assert.equal(sent.length,1,'no repeat while still failing');
 n.check({feedHealth:[fail('old','Already broken')]});n.check({feedHealth:[fail('old','Already broken'),fail('ioda','IODA')]});assert.equal(sent.length,2,'recovery then failure again notifies');
 n.check({feedHealth:[]});n.check({feedHealth:[fail('a','A'),fail('b','B')]});assert.equal(sent[2].title,'2 feeds failing');
 n.update({feeds:false});n.check({feedHealth:[]});n.check({feedHealth:[fail('c','C')]});assert.equal(sent.length,3,'setting off');
});

test('time the app was not running is not a stall',()=>{
 const feed={id:'social-9',name:'Channel',platform:'telegram',category:'geo',intervalMinutes:10,enabled:true,state:'ok',lastSuccess:ago(4*24*60)};
 assert.equal(feedHealth([feed],{now,startedAt:now-5*60000}).length,0,'restarted 5 minutes ago after 4 days off: not stalled yet');
 assert.equal(feedHealth([feed],{now,startedAt:now-61*60000})[0].kind,'stalled','running an hour without a success is a stall');
});

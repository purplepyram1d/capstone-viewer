import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { situation, createCheckpoints, buildDigest } from '../lib/digest.mjs';
const now=Date.parse('2026-10-23T18:00:00Z'),at=h=>new Date(now-h*3600000).toISOString();
const tiles=levels=>Object.entries(levels).map(([id,level])=>({id,label:id.toUpperCase(),level,inputs:[]}));

test('checkpoints save at most every 15 minutes, keep 8 days, and find the one before a time',()=>{
 const store=createCheckpoints(new DatabaseSync(':memory:'));
 const s=(h,extra={})=>({...situation({},now-h*3600000),...extra});
 assert.equal(store.record(s(200),now-200*3600000),true);assert.equal(store.record(s(5),now-5*3600000),true);
 assert.equal(store.record(s(4.9),now-4.9*3600000),false,'within 15 minutes of the last');
 assert.equal(store.record(s(2,{levels:{internet:'red'}}),now-2*3600000),true);
 assert.equal(store.at(at(4)).ts,at(5));assert.equal(store.between(at(4)).length,1);
 assert.equal(store.record(s(0),now),true);assert.equal(store.at(at(300)).ts,at(5),'older than 8 days was pruned; earliest is returned');
});

test('the digest reports changes, peaks, new and cleared hot spots, outages and EPSS jumps',()=>{
 const then={ts:at(6),levels:{internet:'green',cyber:'amber'},hotspots:[{id:'hotspot-NG',name:'Nigeria',families:2}],outages:['NG','LT'],epss:{'CVE-1':0.02,'CVE-2':0.5,'CVE-3':0.05}};
 const between=[{levels:{internet:'red',cyber:'amber'}}];
 const status=tiles({internet:'amber',cyber:'amber'});
 const current={levels:{internet:'amber',cyber:'amber'},hotspots:[{id:'hotspot-IR',name:'Iran',families:3}],outages:['LT','IR'],epss:{'CVE-1':0.41,'CVE-2':0.52,'CVE-3':0.12}};
 const events=[{id:'k',source:'CISA KEV',title:'CVE-9 KEV',category:'cyber',ts:at(1)},{id:'n',kind:'vulnerability',source:'NVD',title:'CVE-8',category:'cyber',ts:at(2),epss:{epss:0.3}},{id:'old',source:'BBC World',category:'geo',ts:at(9)},{id:'p',platform:'bluesky',source:'Krebs',category:'cyber',ts:at(3)}];
 const d=buildDigest({since:at(6),then,between,current,status,events,countries:{IR:{name:'Iran'},NG:{name:'Nigeria'}},now});
 const internet=d.tiles.find(t=>t.id==='internet');assert.equal(internet.changed,true);assert.equal(internet.peak,'red');assert.equal(internet.peaked,true);
 assert.equal(d.tiles.find(t=>t.id==='cyber').changed,false);
 assert.deepEqual(d.hotspots.added.map(h=>h.name),['Iran']);assert.deepEqual(d.hotspots.cleared.map(h=>h.name),['Nigeria']);
 assert.deepEqual(d.outages.started,[{code:'IR',name:'Iran'}]);assert.deepEqual(d.outages.ended,[{code:'NG',name:'Nigeria'}]);
 assert.deepEqual(d.epss_movers.map(m=>m.cve),['CVE-1','CVE-3'],'CVE-2 moved 2 points: not a jump; CVE-3 doubled past 10%');
 assert.equal(d.kev.length,1);assert.equal(d.critical[0].epss,0.3);assert.equal(d.report_count,3,'reports before since are not counted');assert.equal(d.totals.social,1);
 assert.equal(d.partial,false);assert.equal(d.quiet,false);
});

test('missing history is partial and never called quiet; a watched calm stretch is quiet',()=>{
 const current={levels:{internet:'green'},hotspots:[],outages:[],epss:{}};
 const unwatched=buildDigest({since:at(3),then:null,current,status:tiles({internet:'green'}),events:[],now});
 assert.equal(unwatched.partial,true);assert.equal(unwatched.quiet,false);assert.equal(unwatched.tiles[0].changed,false);
 const late=buildDigest({since:at(3),then:{ts:at(1),levels:{internet:'green'},hotspots:[],outages:[],epss:{}},current,status:tiles({internet:'green'}),events:[],now});
 assert.equal(late.partial,true,'history starting two hours after since is partial');assert.equal(late.quiet,false);
 const watched=buildDigest({since:at(3),then:{ts:at(3.1),levels:{internet:'green'},hotspots:[],outages:[],epss:{}},current,status:tiles({internet:'green'}),events:[],now});
 assert.equal(watched.partial,false);assert.equal(watched.quiet,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, feeds } from '../lib/collectors.mjs';
import { normalizeWildfires } from '../lib/wildfires.mjs';
import { statesForReport } from '../lib/us-geography.mjs';

test('wildfire inventory keeps source origin, discovery time, size and containment', () => {
  const now = Date.parse('2026-11-23T18:00:00Z');
  const fixture = {geometry:{x:-122.5,y:38.5},attributes:{
    OBJECTID:123,IrwinID:'{06515884-6225-427F-B538-2BB83D4842AF}',IncidentName:'Fixture fire',
    IncidentTypeCategory:'WF',FireDiscoveryDateTime:now-60_000,IncidentSize:50,PercentContained:0,POOState:'US-CA'
  }};
  const collection = (...features)=>({geometryType:'esriGeometryPoint',features});
  const [report] = normalizeWildfires(collection(fixture,fixture,{...fixture,attributes:{...fixture.attributes,IncidentTypeCategory:'RX'}}),now);
  assert.equal(report.title,'Wildfire · Fixture fire');
  assert.equal(report.ts,'2026-11-23T17:59:00.000Z');
  assert.equal(report.place_basis,'fire_origin');
  assert.equal(report.state_basis,'source_origin');
  assert.deepEqual(report.state_codes,['CA']);
  assert.match(report.summary,/50 acres.*0%/);
  assert.match(report.url,/FeatureServer\/0\/123\?f=pjson$/);
  assert.equal(normalizeWildfires(collection(fixture,fixture),now).length,1);
  assert.equal(normalizeWildfires(collection({...fixture,attributes:{...fixture.attributes,POOState:'CA'}}),now)[0].state_codes,undefined);
  assert.throws(()=>normalizeWildfires({...collection(),exceededTransferLimit:true},now),/incomplete wildfire list/);
});

test('USGS retains smaller U.S. and Canadian epicenters and keeps the worldwide threshold at 4.5', async () => {
  const time=Date.now();
  const row=(id,mag,coordinates,extras={})=>({properties:{time,mag,type:'earthquake',status:'reviewed',title:id,place:id,url:'https://example.org/'+id,...extras},geometry:{coordinates}});
  const items=[
    row('Washington',2.6,[-122.33,47.60,4],{felt:7,cdi:2.1,mmi:null}),
    row('Ontario',2.7,[-79.38,43.65]),
    row('Quarry blast',3.3,[-79.38,43.65],{type:'quarry blast'}),
    row('Japan smaller',3.5,[139.69,35.68]),
    row('Japan larger',4.5,[139.69,35.68],{alert:'orange',mmi:5.3,felt:-4,cdi:19}),
    row('U.S. offshore',3.1,[-128,44])
  ];
  const data=await collect(feeds.find(feed=>feed.id==='usgs'),'',{request:async()=>Response.json({features:items})});
  assert.deepEqual(data.events.map(event=>event.title),['Washington','Ontario','Japan larger']);
  assert.deepEqual(statesForReport(data.events[0]),['WA']);
  assert.equal(data.events[0].magnitude,2.6);
  assert.equal(data.events[0].place_basis,'seismic_origin');
  assert.deepEqual(data.events[0].seismic,{felt:7,reported:2.1});
  assert.deepEqual(data.events[2].seismic,{shakemap:5.3});
  assert.equal(data.events[1].seismic,undefined);
  assert.match(data.events[0].summary,/Reported depth 4 km/);
  assert.match(data.events[0].confidence,/reviewed by source/);
  assert.match(data.events[2].summary,/PAGER ORANGE is a USGS model estimate/);
  assert.equal(data.events[2].score,92);
});
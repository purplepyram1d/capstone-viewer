import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmscQuakes, emscUrl } from '../lib/emsc-earthquakes.mjs';
import { collect, feeds } from '../lib/collectors.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now=Date.parse('2026-11-24T06:45:00Z');
const sample={id:'20261123_0000217',geometry:{type:'Point',coordinates:[40.674,39.6797,-7]},
  properties:{evtype:'ke',unid:'20261123_0000217',time:'2026-11-23T17:22:58Z',flynn_region:'EASTERN TURKEY',
    mag:3.8,depth:7,auth:'AFAD'}};
const collection=(...features)=>({type:'FeatureCollection',features});

test('EMSC regional earthquakes preserve origins and avoid importing above the regional band',()=>{
  assert.equal(new URL(emscUrl(now)).searchParams.get('starttime'),'2026-11-17T06:45:00');
  const [record]=normalizeEmscQuakes(collection(sample),now).map(withReportLocation);
  assert.deepEqual([record.lon,record.lat],[40.674,39.6797]);
  assert.equal(record.country_code,'TR');
  assert.equal(record.ts,'2026-11-23T17:22:58.000Z');
  assert.match(record.summary,/AFAD.*7 km/);
  assert.equal(new URL(record.url).searchParams.get('eventid'),sample.id);
  assert.deepEqual(normalizeEmscQuakes(collection(
    {...sample,properties:{...sample.properties,mag:4.5}},
    {...sample,properties:{...sample.properties,evtype:'fe'}},
    {...sample,geometry:{type:'Point',coordinates:[176.5,-41]}}
  ),now),[]);
});

test('EMSC treats the published 204 no-data response as a successful empty poll',async()=>{
  const result=await collect(feeds.find(feed=>feed.id==='emsc-earthquakes'),'',{
    request:async()=>new Response(null,{status:204})
  });
  assert.deepEqual(result.events,[]);
  assert.equal(result.unchanged,false);
});

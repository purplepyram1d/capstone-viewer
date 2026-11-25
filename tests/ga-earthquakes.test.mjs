import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGaQuakes } from '../lib/ga-earthquakes.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now = Date.parse('2026-11-24T12:30:00Z');
const feature = {
  geometry:{type:'Point',coordinates:[148.676,-19.796]},
  properties:{source:'GA',display_flag:'Y',located_in_australia:'Y',event_id:'ga2026xcnrwu',
    description:'Offshore, 37 km NE of Cape Gloucester, QLD',preferred_magnitude:2.8154,
    preferred_magnitude_type:'MLa075',depth:10,origin_time:'2026-11-22T03:17:25.564Z',
    epicentral_time:'2026-11-22T13:17:25.564Z',event_modification_time:'2026-11-23T02:21:19Z',
    evaluation_mode:'manual',evaluation_status:'reviewed'}
};
const row = properties => ({...feature,properties:{...feature.properties,...properties}});
const collection = (...features) => ({type:'FeatureCollection',features});

test('Australian earthquakes preserve origin time and offshore coordinates under Australian source coverage',()=>{
  const [report] = normalizeGaQuakes(collection(feature),now).map(withReportLocation);
  assert.equal(report.ts,'2026-11-22T03:17:25.564Z');
  assert.equal(report.url,'https://earthquakes.ga.gov.au/event/ga2026xcnrwu');
  assert.deepEqual([report.lon,report.lat],[148.676,-19.796]);
  assert.equal(report.country_code,'AU');
  assert.equal(report.confidence,'Official measurement · reviewed solution');
  assert.match(report.summary,/MLa075.*10\.0 km/);
});

test('Australian earthquake feed selects public recent local solutions and keeps the newest revision',()=>{
  const [current] = normalizeGaQuakes(collection(
    feature,row({event_modification_time:'2026-11-23T04:00:00Z',preferred_magnitude:3,evaluation_mode:'automatic'})
  ),now);
  assert.equal(current.magnitude,3);
  assert.match(current.confidence,/automatic solution/);
  assert.deepEqual(normalizeGaQuakes(collection(
    row({located_in_australia:'N'}),row({preferred_magnitude:4.5}),row({preferred_magnitude:1.9}),
    row({display_flag:'N'}),row({evaluation_status:'rejected'}),row({origin_time:'2026-11-16T04:00:00Z'}),
    {...feature,geometry:{type:'LineString',coordinates:[]}}
  ),now),[]);
  assert.throws(()=>normalizeGaQuakes({},now),/feature collection/);
});

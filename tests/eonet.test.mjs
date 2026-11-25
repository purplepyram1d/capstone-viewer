import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEonet, trackSegments } from '../lib/eonet.mjs';

const now = Date.parse('2026-11-23T18:00:00Z');
const point = (date,lon,lat,changes={})=>({date,type:'Point',coordinates:[lon,lat],...changes});
const storm = {
  id:'EONET_123',title:'Fixture tropical cyclone',closed:null,categories:[{id:'severeStorms',title:'Severe storms'}],
  sources:[{id:'FixtureAgency'}],
  geometry:[point('2026-11-23T16:00:00Z',-178,12,{magnitudeValue:75,magnitudeUnit:'knots'}),
    point('2026-11-22T00:00:00Z',178,10),point('2026-11-24T00:00:00Z',-177,20)]
};

test('NASA observations retain the latest dated point and split tracks over the date line',()=>{
  const [report] = normalizeEonet({events:[storm,storm]},now);
  assert.equal(report.ts,'2026-11-23T16:00:00.000Z');
  assert.equal(report.place_basis,'catalog_point');
  assert.deepEqual([report.lon,report.lat],[-178,12]);
  assert.equal(report.source_date_basis,'catalog_observation');
  assert.deepEqual(report.observation_track.coordinates,[[[178,10],[180,11]],[[-180,11],[-178,12]]]);
  assert.match(report.summary,/75 knots/);
  assert.equal(report.url,'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_123');
  assert.deepEqual(trackSegments([[-178,20],[178,21]]),[[[-178,20],[-180,20.5]],[[180,20.5],[178,21]]]);
  assert.deepEqual(trackSegments([[1,2]]),[]);
});

test('NASA catalog excludes duplicate IRWIN wildfire coverage and carries day-only precision',()=>{
  const fire = {...storm,id:'EONET_999',categories:[{id:'wildfires'}],sources:[{id:'IRWIN'}]};
  const iceberg = {...storm,id:'EONET_111',categories:[{id:'seaLakeIce'}],
    geometry:[point('2026-11-23T00:00:00Z',-18,-58)]};
  const [report] = normalizeEonet({events:[fire,iceberg,{...storm,closed:'2026-11-23'}]},now);
  assert.equal(report.date_precision,'day');
  assert.equal(report.title,iceberg.title);
  assert.equal(report.observation_track,undefined);
  assert.throws(()=>normalizeEonet({}),/Expected the NASA EONET event catalog/);
});
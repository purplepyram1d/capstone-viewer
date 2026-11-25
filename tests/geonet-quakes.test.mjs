import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeoNetQuakes } from '../lib/geonet-quakes.mjs';
import { withReportLocation } from '../lib/geography.mjs';
import { sourceContext } from '../lib/reading.mjs';

const now = Date.parse('2026-11-24T05:30:00Z');
const sample = {type:'Feature',geometry:{type:'Point',coordinates:[173.0323,-42.3595]},
  properties:{publicID:'2026p876575',time:'2026-11-21T07:59:14.748Z',depth:5,magnitude:4.4566,
    mmi:4,locality:'20 km north-east of Hanmer Springs',quality:'best'}};
const report = attrs => ({...sample,properties:{...sample.properties,...attrs}});
const collection = (...features) => ({type:'FeatureCollection',features});

test('GeoNet keeps the preferred epicenter, source time and explicitly estimated shaking', () => {
  const [raw] = normalizeGeoNetQuakes(collection(sample),now);
  const quake = withReportLocation(raw);
  assert.equal(quake.country_code,'NZ');
  assert.equal(quake.ts,sample.properties.time);
  assert.equal(quake.place_basis,'seismic_origin');
  assert.equal(quake.url,'https://www.geonet.org.nz/earthquake/2026p876575');
  assert.match(quake.summary,/Estimated shaking at the closest locality: MMI 4/);
  assert.equal(sourceContext(quake).role,'measurement');
  assert.deepEqual(normalizeGeoNetQuakes(collection(report({quality:'automatic'}),report({mmi:3})),now),[]);
});

test('GeoNet withdrawals retain the identifier and original source time without a mappable point', () => {
  const [original] = normalizeGeoNetQuakes(collection(sample),now);
  const [withdrawn] = normalizeGeoNetQuakes(collection(sample,report({quality:'deleted'})),now);
  assert.equal(withdrawn.id,original.id);
  assert.equal(withdrawn.ts,original.ts);
  assert.equal(withdrawn.kind,'earthquake_withdrawal');
  assert.equal(withdrawn.source_withdrawn,true);
  assert.equal(withdrawn.lat,null);
  assert.equal(globalThis.CapstoneTypes.evidence(withdrawn),'Official');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { bcWildfireUrl, normalizeBcWildfires } from '../lib/bc-wildfires.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now = Date.parse('2026-11-23T18:00:00Z');
const feature = {
  type:'Feature', geometry:{type:'Point',coordinates:[-122.21,52.19]},
  properties:{FIRE_YEAR:2026,FIRE_NUMBER:'C22380',FIRE_TYPE:'Fire',IGNITION_DATE:'2026-11-06Z',
    FIRE_OUT_DATE:'2026-11-07Z',FIRE_STATUS:'Out',CURRENT_SIZE:0.009,GEOGRAPHIC_DESCRIPTION:'East of Soda Creek Road'}
};
const collection = (...features) => ({type:'FeatureCollection',numberMatched:features.length,features});

test('BC Wildfire records use day precision, their incident point, and the published provincial scope', () => {
  const query = new URL(bcWildfireUrl(now));
  assert.equal(query.searchParams.get('CQL_FILTER'),"IGNITION_DATE >= '2026-10-24'");
  const [raw] = normalizeBcWildfires(collection(feature),now);
  const record = withReportLocation(raw);
  assert.equal(record.country_code,'CA');
  assert.equal(record.province_code,'BC');
  assert.equal(record.date_precision,'day');
  assert.equal(record.ts,'2026-11-06T00:00:00.000Z');
  assert.deepEqual([record.lon,record.lat],[-122.21,52.19]);
  assert.match(record.summary,/Out.*2026-11-07.*0\.009 hectares/);
  assert.match(record.url,/fireYear=2026&incidentNumber=C22380$/);
  const [updated] = normalizeBcWildfires(collection({...feature,properties:{...feature.properties,FIRE_STATUS:'Under Control'}}),now);
  assert.equal(updated.id,record.id);
});

test('BC Wildfire distinguishes empty lists from incomplete responses, invalid dates, and invalid points', () => {
  assert.deepEqual(normalizeBcWildfires(collection(),now),[]);
  assert.throws(()=>normalizeBcWildfires({...collection(feature),numberMatched:2},now),/complete/);
  const invalidDate = {...feature,properties:{...feature.properties,IGNITION_DATE:'2026-11-31Z'}};
  const prescribed = {...feature,properties:{...feature.properties,FIRE_TYPE:'Prescribed Fire'}};
  assert.deepEqual(normalizeBcWildfires(collection(invalidDate,prescribed),now),[]);
  const [unlocated] = normalizeBcWildfires(collection({...feature,geometry:{type:'Point',coordinates:[52,-122]}}),now);
  assert.equal(unlocated.place_basis,'unlocated');
  assert.equal(withReportLocation(unlocated).province_code,'BC');
});

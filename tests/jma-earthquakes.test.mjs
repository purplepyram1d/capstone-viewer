import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJmaQuakes } from '../lib/jma-earthquakes.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now=Date.parse('2026-11-24T05:30:00Z');
const report={
  eid:'20261124011217',at:'2026-11-23T08:12:00-08:00',rdt:'2026-11-23T08:15:00-08:00',
  en_ttl:'Earthquake and Seismic Intensity Information',en_anm:'Amakusa and Ashikita Region, Kumamoto Prefecture',
  cod:'+32.6+130.6-10000/',mag:'3.9',maxi:'3',int:[{code:'43',maxi:'3'},{code:'46',maxi:'2'},{code:'99',maxi:'5-'}],json:'20261124011541_20261124011217_VXSE5k_1.json',ift:'発表',ser:'1'
};

test('JMA separates measured intensity, magnitude, hypocenter and issue time',()=>{
  const [raw]=normalizeJmaQuakes([report],now);
  const record=withReportLocation(raw);
  assert.equal(record.ts,'2026-11-23T16:12:00.000Z');
  assert.equal(record.source_published_at,'2026-11-23T16:15:00.000Z');
  assert.deepEqual([record.lon,record.lat],[130.6,32.6]);
  assert.equal(record.country_code,'JP');
  assert.equal(record.magnitude,3.9);
  assert.deepEqual(record.affected_regions,[{code:'43',name:'Kumamoto',intensity:'3'}]);
  assert.match(record.summary,/Prefectures reporting intensity 3 or higher: Kumamoto \(3\)/);
  assert.match(record.summary,/intensity 3 on the JMA scale.*10 km.*Japan Meteorological Agency website/);
  assert.match(record.url,/20261124011541_20261124011217_VXSE5k_1\.json$/);
  assert.deepEqual(normalizeJmaQuakes([{...report,maxi:'2'},{...report,json:'../other'}],now),[]);
});

test('JMA amendments and withdrawals preserve the identifier and do not create independent earthquakes',()=>{
  const [original]=normalizeJmaQuakes([report],now);
  const correction={...report,ift:'訂正',maxi:'2',ser:'2'};
  const [amended]=normalizeJmaQuakes([correction,report],now);
  assert.equal(amended.id,original.id);
  assert.equal(amended.updates_existing_only,true);
  assert.match(amended.summary,/intensity 2 on the JMA scale/);
  const [withdrawn]=normalizeJmaQuakes([{...report,ift:'取消',ser:'3'},correction,report],now);
  assert.equal(withdrawn.id,original.id);
  assert.equal(withdrawn.source_withdrawn,true);
  assert.equal(withdrawn.lat,null);
});

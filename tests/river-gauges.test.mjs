import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRiverGauges, riverGaugeUrl } from '../lib/river-gauges.mjs';
import { withReportLocation } from '../lib/geography.mjs';
import { buildStories } from '../lib/intelligence.mjs';
import { sourceContext } from '../lib/reading.mjs';

const now = Date.parse('2026-11-24T05:30:00Z');
const gauge = {
  attributes:{gaugelid:'ASTF1',status:'major',location:'Astor',waterbody:'St. Johns River',state:'FL',
    obstime:'2026-11-24 04:30:00',units:'ft',observed:'4.13'},
  geometry:{x:-81.52,y:29.17}
};
const alternate = attrs => ({...gauge,attributes:{...gauge.attributes,...attrs}});
const collection = (...features) => ({geometryType:'esriGeometryPoint',features});

test('NOAA measured stages preserve UTC, named states, and the gauge geometry', () => {
  assert.match(new URL(riverGaugeUrl).pathname,/MapServer\/0\/query$/);
  const [raw] = normalizeRiverGauges(collection(gauge,gauge),now);
  const record = withReportLocation(raw);
  assert.equal(record.ts,'2026-11-24T04:30:00.000Z');
  assert.deepEqual([record.lon,record.lat],[-81.52,29.17]);
  assert.equal(record.country_code,'US');
  assert.deepEqual(record.state_codes,['FL']);
  assert.equal(record.state_basis,'source_location');
  assert.equal(record.place_basis,'gauge_location');
  assert.match(record.summary,/Measured level: 4.13 ft/);
  assert.equal(record.url,'https://water.noaa.gov/gauges/astf1');
  assert.equal(globalThis.CapstoneTypes.typeId(record),'river');
  assert.equal(globalThis.CapstoneTypes.evidence(record),'Measured');
  assert.equal(sourceContext(record).role,'measurement');
});

test('only fresh major and moderate observations enter the feed', () => {
  assert.deepEqual(normalizeRiverGauges(collection(
    alternate({status:'minor'}),alternate({status:'fcst_not_current'}),
    alternate({obstime:'2026-11-23 23:29:00'}),alternate({obstime:'2026-11-31 04:30:00'}),
    {...gauge,geometry:{x:0,y:0}}
  ),now),[]);
  assert.throws(()=>normalizeRiverGauges({...collection(gauge),exceededTransferLimit:true},now),/complete/);
  assert.deepEqual(normalizeRiverGauges(collection(),now),[]);
});

test('Operations groups readings from one gauge and displays the newest measured severity', () => {
  const reports = normalizeRiverGauges(collection(gauge,alternate({status:'moderate',obstime:'2026-11-24 05:15:00'})),now);
  const [story] = buildStories(reports);
  assert.equal(story.report_count,2);
  assert.match(story.title,/^Moderate flood stage observed/);
  assert.equal(story.ts,'2026-11-24T05:15:00.000Z');
});

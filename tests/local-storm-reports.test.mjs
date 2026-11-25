import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStormReports,stormReportUrl } from '../lib/local-storm-reports.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now = Date.parse('2026-11-24T05:30:00Z');
const sample = {attributes:{wfo_id:'BOX',lsr_validtime:1795410840000,valid_time:'2026-11-23 05:14:00+00',
  descript:'Flood',loc_desc:"O'Neil Corner",state:'MA',magnitude:' ',units:' ',remarks:'A flooded road was reported.'},
  geometry:{x:-70.66,y:41.77}};
const item = attrs => ({...sample,attributes:{...sample.attributes,...attrs}});
const collection = (...features) => ({geometryType:'esriGeometryPoint',features});

test('NWS storm impacts preserve the published UTC time, location and preliminary evidence label', () => {
  assert.match(new URL(stormReportUrl).searchParams.get('where'),/Flash Flood/);
  const [raw] = normalizeStormReports(collection(sample),now);
  const report = withReportLocation(raw);
  assert.equal(report.ts,'2026-11-23T05:14:00.000Z');
  assert.deepEqual(report.state_codes,['MA']);
  assert.deepEqual([report.lon,report.lat],[-70.66,41.77]);
  assert.equal(report.confidence,'Official preliminary report');
  assert.equal(report.place_basis,'event_location');
  assert.match(report.summary,/NWS office BOX.*flooded road was reported/);
  assert.match(new URL(report.url).searchParams.get('where'),/loc_desc='O''Neil Corner'/);
  assert.equal(normalizeStormReports(collection(item({remarks:'Updated account'})),now)[0].id,report.id);
});

test('NWS storm reports reject mismatched dates, unsupported entries, and partial feeds', () => {
  assert.deepEqual(normalizeStormReports(collection(item({valid_time:'2026-11-23 05:25:00+00'}),
    item({descript:'Rain'}),item({state:'XX'}),item({loc_desc:5}),null),now),[]);
  assert.throws(()=>normalizeStormReports({...collection(sample),exceededTransferLimit:true},now),/complete/);
});

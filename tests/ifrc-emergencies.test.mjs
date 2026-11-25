import test from 'node:test';
import assert from 'node:assert/strict';
import { ifrcUrl, normalizeIfrcEmergencies } from '../lib/ifrc-emergencies.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now = Date.parse('2026-11-24T06:30:00Z');
const sample = {id:8170,name:'Boat incident',created_at:'2026-11-21T16:36:59.635208Z',disaster_start_date:'2026-11-20T00:00:00Z',
  dtype:{name:'Transport Accident'},countries:[{iso:'NG'}],auto_generated:true,emergency_response_contact_email:'internal@example.org'};
const collection = (...results) => ({count:results.length,next:null,results});

test('IFRC reports distinguish the catalog timestamp, event start, source country and approximate placement', () => {
  assert.equal(new URL(ifrcUrl(now)).searchParams.get('created_at__gte'),'2026-10-25');
  const [raw] = normalizeIfrcEmergencies(collection(sample),now);
  const report = withReportLocation(raw);
  assert.equal(report.ts,'2026-11-21T16:36:59.635Z');
  assert.equal(report.source_date_basis,'catalog_created');
  assert.equal(report.country_code,'NG');
  assert.equal(report.place_basis,'country_centroid');
  assert.match(report.summary,/Listed incident start date: 2026-11-20/);
  assert.match(report.confidence,/automatic entry/);
  assert.equal(report.url,'https://go.ifrc.org/emergencies/8170/details');
  assert.doesNotMatch(JSON.stringify(report),/internal@example.org/);
});

test('IFRC multi-country records preserve named scope without assigning a single location', () => {
  const [report] = normalizeIfrcEmergencies(collection({...sample,countries:[{iso:'NG'},{iso:'PE'}]}),now);
  assert.equal(report.lat,null);
  assert.match(report.summary,/Nigeria, Peru/);
  assert.throws(()=>normalizeIfrcEmergencies({...collection(sample),count:3},now),/complete/);
});

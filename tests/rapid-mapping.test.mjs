import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRapidMapping, mappingDirectory } from '../lib/rapid-mapping.mjs';
import { evidenceClass } from '../lib/developing.mjs';

const now = Date.parse('2026-11-23T16:00:00Z');
const activation = {
  code:'EMSR937', name:'Flood mapping in a monitored area', category:'Flood',
  activationTime:'2026-11-22T12:34:00', centroid:'POINT (-7.54 40.41)',
  countries:['Portugal'], n_products:3, closed:false
};

test('emergency mapping uses its activation date and labels the publisher’s mapping-area center', () => {
  const [report] = normalizeRapidMapping({results:[activation]},now);
  assert.equal(report.ts,'2026-11-22T00:00:00.000Z');
  assert.equal(report.date_precision,'day');
  assert.equal(report.source_date_basis,'activation');
  assert.equal(report.url,mappingDirectory+'EMSR937/');
  assert.equal(report.place_basis,'mapping_area');
  assert.equal(report.place,'Portugal');
  assert.deepEqual([report.lon,report.lat],[-7.54,40.41]);
  assert.equal(evidenceClass(report),'Official mapping activation');
  assert.match(report.summary,/3 published mapping products/);
  const [updated] = normalizeRapidMapping({results:[{...activation,activationTime:'2026-11-22T12:34:00+01:00',closed:true,n_products:4}]},now);
  assert.equal(updated.id,report.id);
  assert.equal(updated.ts,'2026-11-22T11:34:00.000Z');
  assert.equal(updated.date_precision,'timestamp');
  assert.match(updated.summary,/Mapping status: closed.*4 published/);
});

test('mapping collection excludes ambiguous activations and preserves records with no valid point', () => {
  const [unlocated] = normalizeRapidMapping({results:[
    {...activation,centroid:'POINT (-999 99)'},
    {...activation,code:'EMSR938',activationTime:'2026-11-31T10:00:00'},
    {...activation,code:'EMSR939',category:'Other'},
    {...activation,code:'EMSN076'}
  ]},now);
  assert.equal(unlocated.lat,null);
  assert.equal(unlocated.place_basis,'unlocated');
  assert.equal(normalizeRapidMapping({results:[
    {...activation,activationTime:'2026-11-31T10:00:00'}, {...activation,category:'Other'}
  ]},now).length,0);
  assert.throws(()=>normalizeRapidMapping({},now),/Expected a Copernicus mapping activation list/);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import { femaUrl, normalizeFemaDeclarations } from '../lib/fema-declarations.mjs';
import { collect, feeds } from '../lib/collectors.mjs';
import { withReportLocation } from '../lib/geography.mjs';

const now=Date.parse('2026-11-23T21:00:00Z');
const row={disasterNumber:4955,state:'FL',declarationType:'DR',declarationDate:'2026-10-27T00:00:00Z',
  declarationTitle:'Fixture hurricane',incidentBeginDate:'2026-10-06T00:00:00Z',incidentEndDate:'2026-10-12T00:00:00Z',designatedArea:'Gulf (County)'};
const collection = (...rows) => ({DisasterDeclarationsSummaries:rows});

test('FEMA groups designated counties by declaration and separates the declaration date from the incident limits',()=>{
  const data=collection(row,{...row,designatedArea:'Bay (County)'},row);
  const [report,...other]=normalizeFemaDeclarations(data,now).map(withReportLocation);
  assert.deepEqual(other,[]);
  assert.equal(report.ts,'2026-10-27T00:00:00.000Z');
  assert.equal(report.date_precision,'day');
  assert.equal(report.country_code,'US');
  assert.deepEqual(report.state_codes,['FL']);
  assert.equal(report.place_basis,'state_reference');
  assert.match(report.summary,/began 2026-10-06.+ended 2026-10-12.+Bay \(County\); Gulf \(County\)/);
  assert.equal(new URL(report.url).searchParams.get('$filter'),'disasterNumber eq 4955');
  assert.equal(CapstoneTypes.typeId(report),'declaration');
  assert.equal(CapstoneTypes.evidence(report),'Official');
});

test('FEMA handles malformed, old, and partial payloads and collects from the rolling source date query',async()=>{
  assert.deepEqual(normalizeFemaDeclarations(collection({...row,state:'XX'},{...row,declarationDate:'2026-08-01T00:00:00Z'}),now),[]);
  assert.throws(()=>normalizeFemaDeclarations({},now),/Expected OpenFEMA/);
  assert.throws(()=>normalizeFemaDeclarations(collection(...Array(1000).fill(row)),now),/truncated/);
  assert.match(new URL(femaUrl(now)).searchParams.get('$filter'),/2026-10-24T21:00:00.000Z/);
  const result=await collect(feeds.find(feed=>feed.id==='fema-declarations'),'',{request:async url=>{
    assert.equal(new URL(url).pathname,'/api/open/v2/DisasterDeclarationsSummaries');
    return Response.json(collection());
  }});
  assert.deepEqual(result.events,[]);
});
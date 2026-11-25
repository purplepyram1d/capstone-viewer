import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTsunami, tsunamiCenters } from '../lib/tsunami.mjs';
import { sourceContext } from '../lib/reading.mjs';
import '../assets/event-types.js';

const now = Date.parse('2026-11-23T11:00:00Z');
const [ntwc, ptwc] = tsunamiCenters;
function message({source='NTWC', id='PAAQ-1-fixture', status='Actual', scope='Public', type='Alert',
  event='Tsunami Information', point='-13.500,172.300 0.000', url='http://www.tsunami.gov/events/PAAQ/2026/11/23/fixture/1/WEAK53/WEAK53.txt'} = {}) {
  return `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>${id}</identifier><source>${source}</source><sent>2026-11-23T02:49:25-00:00</sent>
    <status>${status}</status><scope>${scope}</scope><msgType>${type}</msgType>
    <info><event>${event}</event><web>${url}</web>
      <headline>Issued statement fixture.</headline>
      <parameter><valueName>EventLocationName</valueName><value>Example islands</value></parameter>
      <parameter><valueName>EventLatLon</valueName><value>${point}</value></parameter>
    </info>
  </alert>`;
}

test('tsunami information preserves official UTC time, HTTPS bulletin link, and earthquake origin labels', () => {
  const [report] = normalizeTsunami(message(),ntwc,now);
  assert.equal(report.ts,'2026-11-23T02:49:25.000Z');
  assert.match(report.title,/^Tsunami information statement/);
  assert.match(report.summary,/Source headline at issuance/);
  assert.equal(report.url,'https://www.tsunami.gov/events/PAAQ/2026/11/23/fixture/1/WEAK53/WEAK53.txt');
  assert.equal(report.source_url_scope,'bulletin');
  assert.deepEqual([report.lat,report.lon,report.place_basis],[-13.5,172.3,'seismic_origin']);
  assert.equal(globalThis.CapstoneTypes.placement(report),'Reported earthquake origin');
  assert.equal(globalThis.CapstoneTypes.describe(report).evidence,'Official');
  assert.equal(sourceContext(report).role,'official');
  assert.equal(report.ongoing,undefined);
});

test('a source cancellation is distinct from an update and does not infer a live or mapped threat', () => {
  const [cancel] = normalizeTsunami(message({type:'Cancel',id:'PAAQ-2-fixture',event:'Tsunami',point:'92,995',url:'http://example.org/nonofficial.txt'}),ntwc,now);
  assert.match(cancel.title,/^Tsunami bulletin cancellation/);
  assert.doesNotMatch(cancel.summary,/map point/);
  assert.equal(cancel.source_url_scope,'archive');
  assert.equal(cancel.lat,null);
  const [update] = normalizeTsunami(message({type:'Update',id:'PAAQ-3-fixture',event:'Tsunami'}),ntwc,now);
  assert.match(update.title,/^Tsunami bulletin update/);
  assert.notEqual(update.id,cancel.id);
});

test('nonpublic, test, wrong-center, unrelated and malformed CAP content is excluded', () => {
  for (const record of [{status:'Test'},{scope:'Private'},{source:'PTWC'},{event:'Special Weather Statement'}]) {
    assert.deepEqual(normalizeTsunami(message(record),ntwc,now),[]);
  }
  assert.deepEqual(normalizeTsunami(message(),ptwc,now),[]);
  assert.throws(()=>normalizeTsunami('<html>Unavailable</html>',ntwc,now),/Expected a tsunami CAP bulletin/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import {normalizeCaltransClosures,caltransClosureFeeds} from '../lib/caltrans-closures.mjs';

const now=Date.parse('2026-11-24T12:00:00Z');
const seconds = at => String(Math.floor(at/1000));
const started=now-3_600_000;
const row = () => ({lcs:{
  index:'C470A-0004-2026-11-24-03:00:00',
  recordTimestamp:{recordEpoch:seconds(now-60_000)},
  location:{travelFlowDirection:'North',
    begin:{beginDistrict:'7',beginCounty:'Los Angeles',beginRoute:'SR-47',beginNearbyPlace:'Long Beach',
      beginLocationName:'Harbor Boulevard',beginLatitude:'33.743',beginLongitude:'-118.268'},
    end:{endLocationName:'Ferry Street'}},
  closure:{closureID:'C470A',logNumber:'4',facility:'Mainline',typeOfWork:'Bridge Work',typeOfClosure:'Full',
    code1097:{isCode1097:'true',code1097Timestamp:{code1097Epoch:seconds(started)}},
    code1098:{isCode1098:'false'},code1022:{isCode1022:'false'},
    closureTimestamp:{closureEndEpoch:seconds(now+3_600_000),isClosureEndIndefinite:'false'}}
}});

test('Caltrans records confirmed full mainline closures with their direction and actual start',()=>{
  const valid=row(), ramp=row(), planned=row(), canceled=row();
  ramp.lcs.closure.facility='Off Ramp';
  planned.lcs.closure.code1097.isCode1097='false';
  canceled.lcs.closure.code1022.isCode1022='true';
  const [closure,...ignored]=normalizeCaltransClosures({data:[ramp,planned,canceled,valid]},7,now);
  assert.equal(ignored.length,0);
  assert.equal(closure.title,'Full highway closure · SR-47 North · Los Angeles County');
  assert.equal(closure.ts,'2026-11-24T11:00:00.000Z');
  assert.equal(closure.road_status,'active');
  assert.equal(closure.place_basis,'road_closure_start');
  assert.deepEqual(closure.state_codes,['CA']);
  assert.match(closure.summary,/Harbor Boulevard to Ferry Street/);
  assert.match(closure.summary,/District 7 closure C470A \/ 4/);
  assert.equal(closure.url,'https://roads.dot.ca.gov/?roadnumber=47');
  assert.equal(globalThis.CapstoneTypes.sourceReference(closure),'Caltrans highway conditions');
  assert.equal(caltransClosureFeeds.length,12);
});

test('an explicit reopening updates the same closure report and preserves its start time',()=>{
  const valid=row();
  const [closure]=normalizeCaltransClosures({data:[valid]},7,now);
  valid.lcs.closure.code1098={isCode1098:true,code1098Timestamp:{code1098Epoch:seconds(now-120_000)}};
  const [reopened]=normalizeCaltransClosures({data:[valid]},7,now);
  assert.equal(reopened.id,closure.id);
  assert.equal(reopened.road_status,'ended');
  assert.equal(reopened.road_started_at,closure.road_started_at);
  assert.equal(reopened.road_ended_at,'2026-11-24T11:58:00.000Z');
  assert.match(reopened.title,/Highway reopened/);
});

test('old active closures use a stable listing day and stale district files fail visibly',()=>{
  const valid=row();
  valid.lcs.closure.code1097.code1097Timestamp.code1097Epoch=seconds(now-35*86_400_000);
  const [first]=normalizeCaltransClosures({data:[valid]},7,now);
  assert.equal(first.date_precision,'day');
  assert.equal(first.source_date_basis,'catalog_observation');
  valid.lcs.recordTimestamp.recordEpoch=String(now+120_000);
  const [second]=normalizeCaltransClosures({data:[valid]},7,now+180_000);
  assert.equal(first.ts,second.ts);
  assert.equal(first.id,second.id);
  assert.throws(()=>normalizeCaltransClosures({data:[valid]},7,now+28*60_000),/over 25 minutes old/);
  assert.deepEqual(normalizeCaltransClosures({data:[]},7,now),[]);
  assert.throws(()=>normalizeCaltransClosures({data:[valid]},8,now),/district closure fields were missing/);
});

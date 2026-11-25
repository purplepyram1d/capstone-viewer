import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkZoneClosures,workZoneSources} from '../lib/wzdx-closures.mjs';
const now = Date.parse('2026-11-25T17:00:00Z');
const stamp = offset=>new Date(now+offset).toISOString();
const source = workZoneSources.find(row=>row.code==='WA');
const record = (id,patch={}) => ({type:'Feature',id,geometry:{type:'LineString',coordinates:[[-122.5,47],[-122.46,47.01]]},properties:{
  event_status:'active',start_date:stamp(-3600_000),end_date:stamp(3600_000),vehicle_impact:'all-lanes-closed',
  core_details:{event_type:'work-zone',road_names:['SR 7'],direction:'northbound',update_date:stamp(-60_000)},...patch
}});
const data = (features,updated=stamp(-30_000))=>({type:'FeatureCollection',feed_info:{version:'4.2',update_date:updated},features});

test('work-zone collection keeps active full closures and their published direction, window, and geometry',()=>{
  const fixture = data([record('one'),record('future',{start_date:stamp(60_000)}),record('part',{vehicle_impact:'some-lanes-closed'}),
    record('completed',{event_status:'completed'}),record('past',{end_date:stamp(-60_000)}),
    record('clock',{end_date:'2026-11-25T18:00:00'})]);
  const [closure,...others] = normalizeWorkZoneClosures(fixture,source,now);
  assert.equal(others.length,0);
  assert.equal(closure.road_status,'active');
  assert.equal(closure.road_valid_until,stamp(3600_000));
  assert.deepEqual(closure.state_codes,['WA']);
  assert.match(closure.title,/SR 7 · northbound/);
  assert.equal(closure.source_url_scope,'live_listing');
  assert.equal(closure.url,source.url);
  assert.deepEqual(closure.road_geometry.coordinates,[[-122.5,47],[-122.46,47.01]]);
  assert.equal(closure.ts,stamp(-60_000));
});

test('an old but still listed closure keeps an observation date, and an overdue inventory fails coverage',()=>{
  const [closure] = normalizeWorkZoneClosures(data([record('long',{
    core_details:{event_type:'work-zone',road_names:['I-5'],update_date:stamp(-40*86400_000)}
  })]),source,now);
  assert.equal(closure.source_date_basis,'catalog_observation');
  assert.equal(closure.date_precision,'day');
  assert.throws(()=>normalizeWorkZoneClosures(data([record('one')],stamp(-24*3600_000)),source,now),/out of date/);
  assert.deepEqual(normalizeWorkZoneClosures(data([]),source,now),[]);
});

test('feed dates support inventory observations and preserve publisher start verification',()=>{
  const core = {event_type:'work-zone',road_names:['US 50'],direction:'westbound'};
  const [listed,started] = normalizeWorkZoneClosures(data([
    record('listed',{event_status:undefined,core_details:core,is_start_date_verified:false}),
    record('started',{event_status:undefined,core_details:core,is_start_date_verified:true}),
    record('ended',{is_end_date_verified:true}),
    record('malformed',{core_details:{...core,update_date:'unknown'}})
  ]),workZoneSources.find(row=>row.code==='MO'),now);
  assert.equal(listed.source_date_basis,'catalog_observation');
  assert.equal(listed.date_precision,'day');
  assert.deepEqual(listed.state_codes,['MO']);
  assert.match(listed.summary,/has not verified the start/);
  assert.match(started.summary,/verified the start/);
  assert.equal(listed.ts,'2026-11-25T00:00:00.000Z');
});

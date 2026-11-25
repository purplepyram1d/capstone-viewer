import test from 'node:test';
import assert from 'node:assert/strict';
import {createEaFloodCollector, normalizeEaFloods, withEaFloodTransitions, eaFloodUrl} from '../lib/ea-floods.mjs';
import {listedWeatherUntil} from '../lib/weather-visibility.mjs';

const now = Date.parse('2026-11-24T12:00:00Z');
const code = 'TESTA001', nearby = 'TESTB002';
const fixture = (patch={})=>({
  floodAreaID:code,description:'River Example',floodArea:{county:'Devon'},
  severityLevel:3,timeSeverityChanged:'2026-11-23T16:20:00',timeMessageChanged:'2026-11-24T10:30:00',
  message:'Flooding is possible.',...patch
});
const boundary = {type:'Polygon',coordinates:[[[-4,50],[-3,50],[-3,51],[-4,51],[-4,50]]]};

test('EA message changes retain the notice identity, and a later severity phase has its own timestamp',()=>{
  const rows = [{...fixture(),severityLevel:2},fixture({severityLevel:4,timeSeverityChanged:'2026-11-24T11:00:00Z',timeMessageChanged:'2026-11-24T11:00:00Z'})];
  const original = normalizeEaFloods({items:rows},new Map(),now).map(report=>({...report,feed_id:'ea-floods'}));
  const [warning,removed] = withEaFloodTransitions(original);
  const [changed] = normalizeEaFloods({items:[{...rows[0],timeMessageChanged:'2026-11-24T10:40:00Z'}]},new Map(),now);
  assert.equal(warning.id,changed.id);
  assert.equal(warning.title,'Flood warning · River Example');
  assert.equal(warning.ts,'2026-11-24T10:30:00.000Z');
  assert.equal(warning.weather_replaced_at,'2026-11-24T11:00:00.000Z');
  assert.equal(warning.weather_replacements[0].id,removed.id);
  assert.equal(warning.url,removed.url,'the shared area link does not establish a shared report identity');
  assert.notEqual(warning.id,removed.id);
  assert.equal(removed.weather_status,'ended');
  const feed={state:'ok',intervalMinutes:5,lastBodyStarted:'2026-11-24T11:57:00Z',lastSuccess:'2026-11-24T11:58:00Z'};
  assert.equal(listedWeatherUntil(original[0],feed.lastSuccess,feed,now),'2026-11-24T12:13:00.000Z');
  assert.equal(listedWeatherUntil(removed,feed.lastSuccess,feed,now),null);
});

test('EA collector batches boundaries once and uses the official point when the outline is missing',async()=>{
  const urls=[];
  const collector = createEaFloodCollector(async url=>{
    urls.push(url);
    if(url===eaFloodUrl) return {items:[fixture(),fixture({floodAreaID:nearby})]};
    if(url.includes('FeatureServer')) return {features:[{properties:{fws_tacode:code},geometry:boundary}]};
    return {features:[{properties:{ta_code:nearby},geometry:{type:'Point',coordinates:[-3.5,50.7]}}]};
  },()=>now);
  const [shaped,point] = await collector();
  assert.equal(shaped.place_basis,'international_weather_area');
  assert.deepEqual(shaped.weather_area,boundary);
  assert.equal(point.place_basis,'regional_reference');
  assert.equal(point.lat,50.7);
  assert.equal(point.weather_area,undefined);
  assert.equal(point.source_url_scope,'live_listing');
  assert.match(decodeURIComponent(urls[1]),/FloodAlertAreas.*TESTA001.*TESTB002/);
  assert.match(urls[2],/check-for-flooding\.service\.gov\.uk\/api\/warnings\.geojson/);
  await collector();
  assert.equal(urls.length,4,'the second poll only reads the live notices');
});

test('valid EA notices remain available when both geometry sources fail',async()=>{
  const collector = createEaFloodCollector(async url=>{
    if(url===eaFloodUrl) return {items:[fixture()]};
    throw Error('Geometry unavailable');
  },()=>now);
  const [entry] = await collector();
  assert.equal(entry.place_basis,'unlocated');
  assert.equal(entry.lat,null);
  assert.match(entry.location_note,/boundary unavailable/);
  assert.throws(()=>normalizeEaFloods({items:[{bad:true}]},new Map(),now),/fields were missing/);
});

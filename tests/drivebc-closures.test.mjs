import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDriveBc,createDriveBcCollector,driveBcUrl} from '../lib/drivebc-closures.mjs';
import {withReportLocation} from '../lib/geography.mjs';
import '../assets/event-types.js';
import '../assets/map-export.js';

const now=Date.parse('2026-11-24T12:00:00Z');
const provider='https://api.open511.gov.bc.ca/events/drivebc.ca/RIDE-4101';
const geometry={type:'LineString',coordinates:[[-122,51],[-122.1,51.2],[-122.2,51.3]]};
const base={
  id:'drivebc.ca/RIDE-4101',url:provider,status:'ACTIVE',severity:'MAJOR',
  created:'2026-11-24T03:30:00-07:00',updated:'2026-11-24T03:35:00-07:00',
  roads:[{name:'Highway 97',from:'Example junction',to:'Example Creek',state:'CLOSED',direction:'BOTH'}],
  geography:geometry,areas:[{name:'Cariboo District'}],
  schedule:{intervals:['2026-11-24T10:30/2026-11-24T13:40']},description:'Publisher reported a full closure.'
};

test('DriveBC current listings keep the exact event URL and published road geometry',()=>{
  const [report]=normalizeDriveBc({events:[base]},now).map(withReportLocation);
  assert.equal(report.kind,'road_closure');
  assert.equal(report.road_status,'active');
  assert.equal(report.road_started_at,'2026-11-24T10:30:00.000Z');
  assert.equal(report.road_valid_until,'2026-11-24T13:40:00.000Z');
  assert.equal(report.ts,'2026-11-24T10:35:00.000Z');
  assert.equal(report.source_published_at,'2026-11-24T10:30:00.000Z');
  assert.deepEqual(report.road_geometry,geometry);
  assert.equal(report.place_basis,'road_segment');
  assert.equal(report.province_code,'BC');
  assert.equal(report.url,provider);
  const exported=globalThis.CapstoneMapExport.featureCollection([report],[],{});
  const segment=exported.features.find(feature=>feature.properties.geometry_role==='published_road_segment');
  assert.deepEqual(segment.geometry,geometry);
  assert.equal(segment.properties.closure_scheduled_end_utc,report.road_valid_until);
});

test('DriveBC future, expired, partial, cross-origin and recurring-only listings do not appear current',()=>{
  const rows=[
    {...base,schedule:{intervals:['2026-11-24T12:01/2026-11-24T13:40']}},
    {...base,schedule:{intervals:['2026-11-24T10:30/2026-11-24T12:00']}},
    {...base,schedule:{recurring_schedules:[]}},
    {...base,roads:[{name:'Highway 97',state:'RESTRICTIONS'}]},
    {...base,status:'ARCHIVED'},
    {...base,url:'https://example.org/events/drivebc.ca/RIDE-4101'}
  ];
  assert.deepEqual(normalizeDriveBc({events:rows},now),[]);
});

test('DriveBC fetches the next page on its configured origin and rejects repeated or external pages',async()=>{
  const calls=[];
  const collector=createDriveBcCollector(async url=>{
    calls.push(url);
    if (calls.length===1) return {events:[],pagination:{next:'/events?offset=500&limit=500'}};
    return {events:[]};
  });
  assert.deepEqual(await collector(),[]);
  assert.equal(calls[0],driveBcUrl);
  assert.equal(new URL(calls[1]).searchParams.get('offset'),'500');
  await assert.rejects(createDriveBcCollector(async()=>({events:[],pagination:{next:'https://other.example/events?offset=500'}}))(),/Invalid DriveBC events pagination/);
  await assert.rejects(createDriveBcCollector(async()=>({events:[],pagination:{next:'/events?offset=500'}}))(),/did not finish/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import '../assets/region-brief.js';

const {format} = globalThis.CapstoneRegionBrief;
const now = Date.parse('2026-11-24T12:00:00Z');
const report = {
  id:'one',title:'Preliminary storm impact',kind:'local_storm_report',source:'National Weather Service',
  ts:'2026-11-24T09:35:00Z',first_received:'2026-11-24T11:35:00Z',confidence:'Official preliminary report',
  place:'Florida fixture',place_basis:'event_location',url:'https://www.weather.gov/example',
  notes:{note:'private analyst notes'}
};

test('the area briefing carries exact geography, poll health, evidence, and both report clocks',()=>{
  const text=format({location:'Florida',period:'Last hour',basis:'received',filters:['Official or measured'],
    snapshot:'2026-11-24T11:55:00Z',connected:false,collecting:true,stories:1,now,
    reports:[report],feeds:[{name:'NWS storm reports',label:'Overdue',lastSuccess:'2026-11-24T10:45:00Z',matches:1}]});
  assert.match(text,/Florida \| Capstone area briefing/);
  assert.match(text,/Last hour \| Time basis: First received/);
  assert.match(text,/1 matching report across 1 story/);
  assert.match(text,/Overdue \| Last success 2026-11-24 10:45 UTC \| 1 matching report/);
  assert.match(text,/Last known checks/);
  assert.match(text,/National Weather Service \| Official/);
  assert.match(text,/Source date 2026-11-24 09:35 UTC \| First received 2026-11-24 11:35 UTC/);
  assert.match(text,/Source https:\/\/www\.weather\.gov\/example/);
  assert.doesNotMatch(text,/private analyst notes/);
});

test('the briefing shows the newest 12 records by the selected clock and labels generic references',()=>{
  const copy=Array.from({length:13},(_,i)=>({
    ...report,id:'r-'+i,title:'Sample '+i,source:'RIPE RIS Live',kind:'routing',url:'https://ris-live.ripe.net/',
    first_received:new Date(now-i*60_000).toISOString()
  }));
  const text=format({location:'United States',period:'Last 6 hours',basis:'received',collecting:false,stories:13,reports:copy,now});
  assert.match(text,/13 matching reports across 13 stories/);
  assert.match(text,/Collection paused/);
  assert.match(text,/Source reference https:\/\/ris-live\.ripe\.net\//);
  assert.match(text,/Showing 12 of 13 matching reports/);
  assert.doesNotMatch(text,/Sample 12/);
});

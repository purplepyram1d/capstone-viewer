import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { withReportLocation, reportCountry } from '../lib/geography.mjs';
import { createTimeline } from '../lib/timeline.mjs';
import { nwsStates, statesForReport, stateForPoint, usStates } from '../lib/us-geography.mjs';
import { normalizeWeatherAlerts, alertArea } from '../lib/weather-alerts.mjs';

test('state assignment uses official coverage or a reported point and excludes headquarters and country markers', () => {
  assert.equal(Object.keys(usStates).length,56);
  assert.equal(stateForPoint(-122.33,47.60),'WA');
  assert.equal(stateForPoint(-84.39,33.75),'GA');
  assert.equal(stateForPoint(-149.90,61.22),'AK');
  assert.equal(stateForPoint(-157.86,21.31),'HI');
  assert.equal(stateForPoint(-66.10,18.42),'PR');
  assert.equal(stateForPoint(-125.8,43.0),null);
  assert.deepEqual(statesForReport({lon:-122.33,lat:47.60,place_basis:'vendor_hq'}),[]);
  assert.deepEqual(statesForReport({lon:-98.5,lat:39.1,place_basis:'country_centroid'}),[]);
  assert.deepEqual(nwsStates({UGC:['FLZ001','GAC001','FLZ002','AMZ050','CA---1']}),['FL','GA']);
  assert.deepEqual(nwsStates({SAME:['012081','013000',601003]}),['FL','GA']);
});

test('source polygon placement lies outside ascribed holes and state-only markers are labeled', () => {
  const square = (l,t,r,b)=>[[l,t],[r,t],[r,b],[l,b],[l,t]];
  const polygon = {type:'Polygon',coordinates:[square(-85,33,-81,29),square(-84.9,32.9,-81.1,29.1)]};
  const inside = alertArea(polygon);
  assert.ok(inside.lat>29 && inside.lat<33 && inside.lon>-85 && inside.lon<-81);
  assert.ok(inside.lon<-84.9 || inside.lon>-81.1 || inside.lat>32.9 || inside.lat<29.1);
  assert.equal(alertArea({type:'Polygon',coordinates:[[[2,2],[6,2],[9,10],[6,6]]]}),null);
  const now = Date.parse('2026-11-23T16:00:00Z');
  const feature = {type:'Feature',properties:{
    status:'Actual',messageType:'Alert',severity:'Severe',event:'Storm Warning',
    id:'urn:oid:2.49.0.1.1234',sent:'2026-11-23T15:00:00Z',expires:'2026-11-24T04:00:00Z',
    geocode:{UGC:['FLZ001']}
  }};
  const [single] = normalizeWeatherAlerts({type:'FeatureCollection',features:[feature]},now);
  assert.deepEqual(single.state_codes,['FL']);
  assert.equal(single.place_basis,'state_reference');
  assert.equal(single.place,'Florida');
  feature.properties.geocode.UGC.push('GAZ001');
  const [multiple] = normalizeWeatherAlerts({type:'FeatureCollection',features:[feature]},now);
  assert.deepEqual(multiple.state_codes,['FL','GA']);
  assert.equal(multiple.lat,null);
});

test('country attribution is distinct from a U.S. state and preserves the basis',()=>{
  assert.deepEqual(reportCountry({country:'CA',place_basis:'country_centroid'}),{code:'CA',basis:'source_country'});
  assert.deepEqual(reportCountry({lon:-79.38,lat:43.65,place_basis:'event_location'}),{code:'CA',basis:'reported_point'});
  assert.deepEqual(reportCountry({lon:-79.38,lat:43.65,place_basis:'vendor_hq'}),null);
  const located=withReportLocation({lon:-118.24,lat:34.05,place_basis:'event_location'});
  assert.equal(located.country_code,'US');
  assert.deepEqual(located.state_codes,['CA']);
  assert.deepEqual(reportCountry({state_codes:['FL','GA'],state_basis:'source_coverage'}),{code:'US',basis:'source_coverage'});
});

test('the retained Timeline can select multi-state coverage and older coordinate reports', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,ts TEXT NOT NULL,data TEXT NOT NULL)');
  const put=db.prepare('INSERT INTO events VALUES (?,?,?)');
  const ts = new Date().toISOString();
  const base={ts,title:'Fixture',source:'Source fixture',category:'geo',url:'https://example.org/report'};
  for (const report of [
    {...base,id:'report-point',place_basis:'event_location',lon:-122.33,lat:47.6},
    {...base,id:'hq',place_basis:'vendor_hq',lon:-122.33,lat:47.6},
    {...base,id:'warning',place_basis:'unlocated',state_codes:['WA','OR'],state_basis:'source_coverage'},
    {...base,id:'canada',place_basis:'event_location',lon:-79.38,lat:43.65}
  ]) put.run(report.id,ts,JSON.stringify(report));
  const timeline=createTimeline(db);
  const ids=state=>timeline.list(new URLSearchParams({state})).events.map(entry=>entry.id).sort();
  assert.deepEqual(ids('wa'),['report-point','warning']);
  assert.deepEqual(ids('OR'),['warning']);
  assert.deepEqual(ids('US'),['report-point','warning']);
  assert.deepEqual(ids('NY'),[]);
  const countries = country=>timeline.list(new URLSearchParams({country})).events.map(entry=>entry.id).sort();
  assert.deepEqual(countries('CA'),['canada']);
  assert.deepEqual(countries('US'),['report-point','warning']);
  db.close();
});
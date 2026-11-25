import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpcOutlook,createSpcOutlooks} from '../lib/spc-outlook.mjs';
import '../assets/map-export.js';

const issue = '2026-11-24T06:46:00Z', starts = '2026-11-25T12:00:00Z', ends = '2026-11-26T12:00:00Z';
const now=Date.parse('2026-11-24T12:45:00Z');
const geometry={type:'Polygon',coordinates:[[[-80,30],[-79,30],[-79,31],[-80,31],[-80,30]]]};
const feature=(LABEL,patch={})=>({type:'Feature',geometry,properties:{LABEL,ISSUE_ISO:issue,VALID_ISO:starts,EXPIRE_ISO:ends,...patch}});
const data=features=>({type:'FeatureCollection',features});

test('SPC outlook filters general thunderstorms and preserves original risk geometry and forecast dates',()=>{
  const outlook=normalizeSpcOutlook(data([feature('TSTM'),feature('MRGL'),feature('SLGT')]),2,now);
  assert.equal(outlook.areas.features.length,2);
  assert.deepEqual(outlook.risks.map(r=>r.name),['Marginal','Slight']);
  assert.deepEqual(outlook.areas.features[0].geometry,geometry);
  assert.equal(outlook.issued,'2026-11-24T06:46:00.000Z');
  assert.equal(outlook.starts,'2026-11-25T12:00:00.000Z');
  assert.equal(outlook.ends,'2026-11-26T12:00:00.000Z');
  const file=globalThis.CapstoneMapExport.featureCollection([],[],{},outlook);
  assert.equal(file.features[0].properties.evidence,'Forecast');
  assert.equal(file.features[0].properties.geometry_role,'forecast_area');
  assert.equal(file.features[0].properties.valid_until_utc,outlook.ends);
  assert.equal(normalizeSpcOutlook(data([feature('TSTM')]),2,now).areas.features.length,0);
  assert.throws(()=>normalizeSpcOutlook(data([feature('MRGL')]),2,Date.parse(ends)),/outside its valid time/);
});

test('SPC outlook does not quietly publish incomplete severe-risk geometry',()=>{
  const invalid=feature('MRGL');
  invalid.geometry={type:'Polygon',coordinates:[[[-82,30],[-82,31],[-80,31],[-80,30]]]};
  assert.throws(()=>normalizeSpcOutlook(data([invalid]),1,now),/geometry was unavailable/);
  assert.throws(()=>normalizeSpcOutlook(data([feature('MRGL',{ISSUE_ISO:'bad'})]),1,now),/times were missing/);
  assert.throws(()=>normalizeSpcOutlook(data([]),3,now),/Invalid NOAA/);
});

test('SPC outlook requests are shared and a retained forecast expires even when refresh fails',async()=>{
  let date=now, calls=0;
  const outlook=createSpcOutlooks(async()=>{
    if (++calls>1) throw Error('NOAA unavailable');
    await Promise.resolve();
    return data([feature('MRGL')]);
  },()=>date);
  const [first,other]=await Promise.all([outlook(2),outlook(2)]);
  assert.equal(first,other);
  assert.equal(calls,1);
  date+=16*60_000;
  const stale=await outlook(2);
  assert.equal(stale.stale,true);
  assert.equal(stale.areas.features.length,1);
  date=Date.parse(ends)+1;
  const expired=await outlook(2);
  assert.equal(expired.areas.features.length,0);
  assert.match(expired.error,/NOAA unavailable/);
});

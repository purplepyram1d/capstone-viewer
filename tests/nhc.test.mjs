import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import { nhcSource, nhcUrl, normalizeNHC, withCycloneTracks } from '../lib/nhc.mjs';
import { collect, feeds } from '../lib/collectors.mjs';

const now=Date.parse('2026-09-30T01:00:00Z');
const issued='2026-09-30T00:00:00Z';
const storm={
  id:'al082026',name:'Fixture',classification:'HU',intensity:'90',pressure:'969',
  latitudeNumeric:34,longitudeNumeric:'-44.50',lastUpdate:'2026-09-30T00:08:00Z',
  publicAdvisory:{advNum:'006',issuance:issued,url:'https://www.nhc.noaa.gov/text/MIATCPAT3.shtml'}
};

test('NHC preserves advisory and center times along with official classification, wind, and pressure',()=>{
  const oldNumber={...storm,publicAdvisory:{...storm.publicAdvisory,advNum:'005'}};
  const [current,prior,...extra]=normalizeNHC({activeStorms:[storm,oldNumber,storm]},now);
  assert.deepEqual(extra,[]);
  assert.equal(current.source,nhcSource);
  assert.equal(current.ts,'2026-09-30T00:00:00.000Z');
  assert.equal(current.place_basis,'cyclone_center');
  assert.equal(current.lon,-44.5);
  assert.match(current.summary,/as of 2026-09-30 00:08 UTC/);
  assert.match(current.summary,/90 kt.+969 hPa/);
  assert.equal(current.url,'https://www.nhc.noaa.gov/archive/2026/al08/al082026.public.006.shtml');
  assert.notEqual(current.id,prior.id);
  assert.equal(CapstoneTypes.typeId(current),'cyclone');
  assert.equal(CapstoneTypes.evidence(current),'Official');
});

test('NHC handles interim advisories, missing locations, invalid links, and an empty status feed',async()=>{
  const previous={...storm,latitudeNumeric:null,longitudeNumeric:null,publicAdvisory:{...storm.publicAdvisory,advNum:'006a'}};
  const invalid={...storm,publicAdvisory:{...storm.publicAdvisory,url:'https://unrelated.example/bulletin'}};
  const [interim,...extra]=normalizeNHC({activeStorms:[invalid,previous]},now);
  assert.deepEqual(extra,[]);
  assert.equal(interim.lat,null);
  assert.equal(interim.url,'https://www.nhc.noaa.gov/archive/2026/al08/');
  assert.equal(CapstoneTypes.archiveLink(interim),true);
  assert.throws(()=>normalizeNHC({data:[]},now),/Expected NOAA/);
  const feed=feeds.find(feed=>feed.id==='nhc-cyclones');
  const result=await collect(feed,'',{request:async url=>{
    assert.equal(url,nhcUrl);
    return Response.json({activeStorms:[]});
  }});
  assert.deepEqual(result.events,[]);
});
test('Cyclone tracks stop at the selected advisory and do not jump across the map at the date line',()=>{
  const early={...storm,longitudeNumeric:179,lastUpdate:'2026-09-29T21:00:00Z',
    publicAdvisory:{...storm.publicAdvisory,advNum:'005',issuance:'2026-09-29T21:00:00Z'}};
  const next={...storm,longitudeNumeric:-179};
  const later={...storm,longitudeNumeric:-173,lastUpdate:'2026-09-30T02:00:00Z',
    publicAdvisory:{...storm.publicAdvisory,advNum:'007',issuance:'2026-09-30T02:00:00Z'}};
  const other={...early,id:'ep192026',longitudeNumeric:178};
  const issued=normalizeNHC({activeStorms:[later,other,next,early]},Date.parse('2026-09-30T03:00:00Z'));
  const [third,different,second,first]=withCycloneTracks(issued);
  assert.equal(different.observation_track,undefined);
  assert.equal(first.observation_track,undefined);
  assert.deepEqual(second.observation_track.coordinates,[[[179,34],[180,34]],[[-180,34],[-179,34]]]);
  assert.deepEqual(third.observation_track.coordinates[1],[[-180,34],[-179,34],[-173,34]]);
  assert.equal(issued[2].observation_track,undefined);
});
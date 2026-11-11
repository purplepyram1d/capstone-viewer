import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCountryResolver, computeHotspots, family } from '../lib/hotspots.mjs';
const countries=JSON.parse(readFileSync(new URL('../assets/countries.json',import.meta.url)));
const world=JSON.parse(readFileSync(new URL('../assets/world.json',import.meta.url)));
const resolve=createCountryResolver(world,countries);
const now=Date.parse('2026-10-23T15:00:00Z'),hours=h=>new Date(now-h*3600000).toISOString();
const report=(id,patch)=>({id,title:'Report '+id,source:'Test',ts:hours(1),score:60,category:'geo',place_basis:'unlocated',lat:null,lon:null,...patch});

test('country resolution uses codes, centroid names and polygons, never HQ context',()=>{
 assert.equal(resolve({country:'IR',lat:1,lon:1,place_basis:'country_centroid'}),'IR');
 assert.equal(resolve({lat:countries.UA.lat,lon:countries.UA.lon,place:'Ukraine',place_basis:'country_centroid'}),'UA');
 assert.equal(resolve({lat:35.68,lon:139.69,place:'Tokyo',place_basis:'event_location'}),'JP');
 assert.equal(resolve({lat:39.0,lon:-98.0,place:'Kansas',place_basis:'event_location'}),'US','atlas alias United States of America');
 assert.equal(resolve({lat:37.77,lon:-122.42,place:'San Francisco',place_basis:'company_hq'}),null);
 assert.equal(resolve({lat:47.6,lon:-122.3,place:'Redmond',place_basis:'vendor_hq'}),null);
 assert.equal(resolve({lat:0,lon:-30,place:'Atlantic',place_basis:'event_location'}),null,'open ocean has no country');
 assert.equal(family({platform:'telegram',kind:'report'}),'social');assert.equal(family({kind:'outage'}),'internet');assert.equal(family({category:'cyber',kind:'report'}),'cyber');
});

test('hot spots need two signal families or a volume spike, and ongoing outages stay current',()=>{
 const ir={country:'IR',lat:countries.IR.lat,lon:countries.IR.lon,place:'Iran',place_basis:'country_centroid'};
 const ua={lat:countries.UA.lat,lon:countries.UA.lon,place:'Ukraine',place_basis:'country_centroid'};
 const reports=[
  report('outage',{...ir,category:'cyber',kind:'outage',ongoing:true,ts:hours(60),score:85}),
  report('news',{...ir,title:'Protests reported in Iran',url:'https://example.test/iran'}),
  report('ua1',{...ua}),report('ua-old',{...ua,ts:hours(30)}),
  report('hq',{lat:37.77,lon:-122.42,place_basis:'company_hq',category:'ai'}),
  report('us-news',{lat:39,lon:-98,place_basis:'event_location'}),
  report('old-outage',{...ir,category:'cyber',kind:'outage',ongoing:false,ts:hours(60)})
 ];
 const cl={lat:-33.45,lon:-70.67,place_basis:'event_location'};
 reports.push(report('cl-claim',{...cl,category:'cyber',kind:'ransomware'}),report('cl-quake',{...cl,kind:'earthquake'}));
 for(let i=0;i<6;i++)reports.push(report('jp'+i,{lat:35.68,lon:139.69,place_basis:'event_location',category:'geo',kind:'earthquake'}));
 reports.push(report('quake-history',{lat:0,lon:-30,place_basis:'event_location',kind:'earthquake',ts:hours(24*7.5)}));
 // A brand-new ransomware feed lands a backlog: five claims in one country, but no week of history for the signal.
 for(let i=0;i<5;i++)reports.push(report('de'+i,{lat:52.52,lon:13.4,place_basis:'event_location',category:'cyber',kind:'ransomware',ts:hours(i*3+1)}));
 const spots=computeHotspots(reports,{resolve,countries,now});
 assert.equal(spots.some(s=>s.country==='DE'),false,'a first-collection backlog is not a spike');
 const iran=spots.find(s=>s.country==='IR');
 assert.ok(iran,'outage plus news is a hot spot');assert.deepEqual(iran.families.map(f=>f.id).sort(),['internet','world']);
 assert.equal(iran.top.find(t=>t.id==='news').url,'https://example.test/iran','headlines carry the report link for the kiosk');
 assert.equal(iran.top.find(t=>t.id==='outage').url,null,'a report without a link stays null');
 assert.ok(iran.report_ids.includes('outage'),'ongoing outage counted though it started 60h ago');assert.ok(!iran.report_ids.includes('old-outage'));
 assert.equal(spots.some(s=>s.country==='UA'),false,'one family and no spike is not a hot spot');
 assert.equal(spots.some(s=>s.country==='US'),false);
 assert.equal(spots.some(s=>s.country==='CL'),false,'one claim plus one quake is background, not a hot spot');
 const japan=spots.find(s=>s.country==='JP');assert.ok(japan.spike,'six reports in a day against an empty week is a spike');assert.equal(japan.families.length,1);
 assert.equal(spots[0].country,'IR','multi-family spots rank first');
 assert.match(iran.basis[0],/2 kinds of signal/);
});

test('with collection-start records, only sources held for a week can spike',()=>{
 const jp=i=>({id:'jp'+i,title:'Quake',source:'USGS',feed_id:'usgs',ts:new Date(now-3600000*(i+1)).toISOString(),score:40,category:'geo',kind:'earthquake',lat:35.68,lon:139.69,place_basis:'event_location'});
 const reports=[0,1,2,3,4,5].map(jp);
 assert.ok(computeHotspots(reports,{resolve,countries,now,since:{usgs:now-8*86400000}}).find(s=>s.country==='JP')?.spike);
 assert.equal(computeHotspots(reports,{resolve,countries,now,since:{usgs:now-3600000}}).some(s=>s.country==='JP'),false,'collected for an hour: backlog, not a spike');
});

test('ransomware, breach and confirmed-incident claims count as one kind; hacktivist claims are their own',()=>{
 const us={lat:39,lon:-98,place_basis:'event_location'},lt={lat:55.2,lon:23.9,place_basis:'event_location'};
 const reports=[
  ...[1,2,3,4].map(i=>report('us-r'+i,{...us,category:'cyber',kind:'ransomware'})),report('us-b',{...us,category:'cyber',kind:'claim',claim_type:'breach'}),report('us-c',{...us,category:'cyber',kind:'incident',claim_type:'confirmed'}),
  report('lt-h1',{...lt,category:'cyber',kind:'claim',claim_type:'hacktivist'}),report('lt-h2',{...lt,category:'cyber',kind:'claim',claim_type:'hacktivist'}),report('lt-r',{...lt,category:'cyber',kind:'ransomware'})
 ];
 const spots=computeHotspots(reports,{resolve,countries,now});
 assert.equal(spots.some(s=>s.country==='US'),false,'six criminal claims are one kind of signal');
 const lith=spots.find(s=>s.country==='LT');assert.ok(lith,'hacktivist plus criminal claims are two kinds');assert.match(lith.basis[0],/2 kinds/);
});

test('machine-coded fighting joins a hot spot only when it escalates against 3+ earlier days',()=>{
 const ua={country:'UA',lat:countries.UA.lat,lon:countries.UA.lon,place:'Ukraine',place_basis:'country_centroid'};
 const g=(id,hoursAgo,outlets)=>report(id,{...ua,category:'geo',kind:'conflict',outlets,ts:hours(hoursAgo)});
 const news=report('ua-news',{...ua,title:'Strikes on Kyiv'});
 const chronic=[g('d4',96,14),g('d3',72,15),g('d2',48,16),g('d1',24.5,15),g('today',1,16),news];
 assert.equal(computeHotspots(chronic,{resolve,countries,now}).some(s=>s.country==='UA'),false,'steady fighting is background');
 const surge=[g('d4',96,14),g('d3',72,15),g('d2',48,16),g('d1',24.5,15),g('today',1,40),news];
 const spot=computeHotspots(surge,{resolve,countries,now}).find(s=>s.country==='UA');
 assert.ok(spot,'40 outlets against an average of 15 is an escalation');assert.ok(spot.families.some(f=>f.id==='conflict'));
 assert.equal(computeHotspots([g('today',1,40),news],{resolve,countries,now}).some(s=>s.country==='UA'),false,'no history yet, no escalation');
});

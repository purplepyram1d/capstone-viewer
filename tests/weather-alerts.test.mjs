import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, feeds } from '../lib/collectors.mjs';
import { normalizeWeatherAlerts, weatherAlertsUrl, weatherSource, withNwsReplacements } from '../lib/weather-alerts.mjs';
import { evidenceClass } from '../lib/developing.mjs';
import { sourceContext } from '../lib/reading.mjs';

const feature = (now, suffix = '1', changes = {}) => ({
  type:'Feature',
  geometry:{type:'Polygon',coordinates:[[[-84,30],[-83,30],[-84,31],[-84,30]]]},
  properties:{
    id:'urn:oid:2.49.0.1.840.0000000000.' + suffix,
    '@id':'https://example.org/unsupported',
    status:'Actual',scope:'Public',severity:'Severe',messageType:'Alert',event:'Flood Warning',
    senderName:'NWS Fixture',areaDesc:'Sample County',
    sent:new Date(now-15*60_000).toISOString(),expires:new Date(now+60*60_000).toISOString(),
    ...changes
  }
});
const collection = (...features) => ({type:'FeatureCollection',features});

test('NWS update references retire the original without merging sibling updates for separate areas',()=>{
  const now = Date.parse('2026-11-23T17:00:00Z');
  const original = feature(now,'1',{sent:'2026-11-23T15:00:00Z'});
  const reference = {identifier:original.properties.id,'@id':'https://api.weather.gov/alerts/'+original.properties.id,
    sent:original.properties.sent};
  const inland = feature(now,'2',{messageType:'Update',areaDesc:'Inland area',references:[reference]});
  const coast = feature(now,'3',{messageType:'Update',areaDesc:'Coastal area',references:[reference]});
  const ignored = feature(now,'4',{messageType:'Update',references:[{...reference,sent:'2026-11-23T15:01:00Z'}]});
  const [prior,...updates] = normalizeWeatherAlerts(collection(original,inland,coast,ignored),now);
  const [retired,...kept] = withNwsReplacements([{...prior,weather_listed_until:prior.weather_valid_until},...updates]);
  assert.equal(retired.weather_listed_until,null);
  assert.equal(retired.weather_replaced_at,'2026-11-23T16:45:00.000Z');
  assert.deepEqual(new Set(retired.weather_replacements.map(update=>update.place)),new Set(['Inland area','Coastal area']));
  assert.ok(kept.every(record=>!record.weather_replaced_at));
  assert.equal(kept.length,3);
});

test('NWS keeps time-stamped severe bulletins and turns only trusted identifiers into source links', async () => {
  const now = Date.parse('2026-11-23T17:00:00Z');
  const start = feature(now);
  const update = feature(now,'2',{messageType:'Update',severity:'Extreme',ends:'2026-11-23T17:45:00Z'});
  const [original,revised] = normalizeWeatherAlerts(collection(start,update,start),now);
  assert.equal(original.title,'Flood Warning · NWS Fixture');
  assert.equal(revised.title,'Flood Warning update · NWS Fixture');
  assert.equal(revised.source,weatherSource);
  assert.equal(revised.weather_valid_until,'2026-11-23T17:45:00.000Z');
  assert.equal(original.ts,'2026-11-23T16:45:00.000Z');
  assert.notEqual(original.id,revised.id);
  assert.equal(normalizeWeatherAlerts(collection(start),now+60_000)[0].id,original.id);
  assert.equal(normalizeWeatherAlerts(collection(start,update,start),now).length,2);
  assert.equal(original.url,'https://api.weather.gov/alerts/' + start.properties.id);
  assert.match(revised.summary,/Extreme severity\. Bulletin expiration 2026-11-23 18:00 UTC\. Event end time in bulletin 2026-11-23 17:45 UTC/);
  assert.match(revised.summary,/Areas named by NWS: Sample County\./);
  assert.equal(revised.place_basis,'weather_area');
  assert.ok(revised.lat>30 && revised.lat<31 && revised.lon>-84 && revised.lon<-83);
  assert.equal(evidenceClass(revised),'Official bulletin');
  assert.equal(sourceContext(revised).role,'official');
  assert.equal(globalThis.CapstoneTypes.typeId(revised),'weather');

  const feed = feeds.find(feed=>feed.id === 'nws-alerts');
  const polled = await collect(feed,'',{request:async url => {
    assert.equal(url,weatherAlertsUrl);
    return Response.json(collection(feature(Date.now())));
  }});
  assert.equal(polled.events.length,1);
  assert.equal(polled.usedUrl,weatherAlertsUrl);
});

test('NWS ignores tests, private products, cancellations, expired messages, and lower-severity alerts', () => {
  const now = Date.parse('2026-11-23T17:00:00Z');
  const changes = [
    {status:'Test'}, {scope:'Restricted'}, {messageType:'Cancel'}, {severity:'Moderate'},
    {expires:'2026-11-23T17:00:00Z'}, {ends:'2026-11-23T16:59:00Z'}, {expires:null},
    {id:'https://example.org/fake'}, {sent:'not a date'}, {event:''}
  ];
  assert.deepEqual(normalizeWeatherAlerts(collection(...changes.map((change,index)=>feature(now,index+1,change))),now),[]);
  assert.deepEqual(normalizeWeatherAlerts(collection(),now),[]);
  assert.throws(()=>normalizeWeatherAlerts({features:[]},now),/Expected a National Weather Service alert collection/);
});
test('NWS public forecast zones place polygon-free bulletins using the named zone in each state',()=>{
  const now = Date.parse('2026-11-23T17:00:00Z');
  const alert = feature(now,'12',{
    geocode:{UGC:['CAZ006','ORZ101','AZZ008','FLZ041']},
    affectedZones:[
      'https://unrelated.example/zones/forecast/AZZ008',
      'https://api.weather.gov/zones/fire/AZZ008',
      'https://api.weather.gov/zones/forecast/WA999',
      'https://api.weather.gov/zones/forecast/CAZ006',
      'https://api.weather.gov/zones/forecast/ORZ101'
    ]
  });
  const [zoned,precise] = normalizeWeatherAlerts(collection({...alert,geometry:null},feature(now,'13',{...alert.properties,id:'urn:oid:2.49.0.1.840.0000000000.13'})),now);
  assert.deepEqual(zoned.state_codes,['AZ','CA','FL','OR']);
  assert.equal(zoned.place_basis,'nws_zone_reference');
  assert.equal(zoned.place,'San Francisco, CA');
  assert.deepEqual(zoned.weather_zone_references.map(row=>row.state),['CA','OR']);
  assert.equal(zoned.weather_zone_references[1].place,'Clatsop County Coast, OR');
  assert.equal(zoned.weather_area,undefined);
  assert.equal(globalThis.CapstoneTypes.referencePlacement(zoned),true);
  assert.equal(precise.place_basis,'weather_area');
  assert.equal(precise.weather_zone_references,undefined);
});
test('Marine zone references place offshore bulletins without assigning a state',()=>{
  const now = Date.parse('2026-11-23T17:00:00Z');
  const notice = feature(now,'15',{event:'Storm Warning',geocode:{UGC:['ANZ650']},
    affectedZones:['https://api.weather.gov/zones/forecast/ANZ650']});
  const [report] = normalizeWeatherAlerts(collection({...notice,geometry:null}),now);
  assert.equal(report.place_basis,'nws_marine_reference');
  assert.equal(report.state_codes,undefined);
  assert.equal(report.weather_area,undefined);
  assert.ok(Number.isFinite(report.lat) && Number.isFinite(report.lon));
  assert.match(report.location_note,/one marine zone named by NWS \(ANZ650\)/);
});
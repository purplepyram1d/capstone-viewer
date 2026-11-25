import test from 'node:test';
import assert from 'node:assert/strict';
import { canadaWeatherUrl, normalizeCanadaWeather } from '../lib/canada-weather.mjs';
import { collect, feeds } from '../lib/collectors.mjs';
import { withReportLocation } from '../lib/geography.mjs';
import { listedWeatherUntil } from '../lib/weather-visibility.mjs';

const now = Date.parse('2026-11-23T19:00:00Z');
const issue = '2026-11-23T18:08:00Z';
const end = '2026-11-23T20:00:00Z';

function feature(zone, lon, changes = {}) {
  return {
    type:'Feature',id:'1417102851845970586202611230503_fea1-'+zone,
    geometry:{type:'Polygon',coordinates:[[[lon,44],[lon+1,44],[lon+1,45],[lon,44]]]},
    properties:{
      alert_type:'warning',status_en:'issued',alert_name_en:'snow squall warning',risk_colour_en:'yellow',
      province:'ON',feature_name_en:'Forecast area '+zone,publication_datetime:issue,
      expiration_datetime:'2026-11-23T22:00:00Z',event_end_datetime:end,...changes
    }
  };
}
const collection = (...features) => ({type:'FeatureCollection',features,numberMatched:features.length});

test('GeoMet groups areas of the same bulletin and preserves the publisher’s status, place and date',()=>{
  const west = feature(1,-82), east = feature(2,-80,{status_en:'changed_from'});
  const data = collection(east,west);
  const [report,...duplicates] = normalizeCanadaWeather(data,now).map(withReportLocation);
  assert.deepEqual(duplicates,[]);
  assert.equal(report.title,'Yellow · snow squall warning · Ontario');
  assert.equal(report.ts,'2026-11-23T18:08:00.000Z');
  assert.equal(report.weather_valid_until,'2026-11-23T20:00:00.000Z');
  assert.equal(report.country_code,'CA');
  assert.equal(report.state_codes,undefined);
  assert.equal(report.place_basis,'international_weather_area');
  assert.equal(report.weather_area.coordinates.length,2);
  assert.match(report.url,/items\/1417102851845970586202611230503_fea1-1\?f=html$/);
  assert.match(report.summary,/Forecast area 1; Forecast area 2/);
  assert.equal(normalizeCanadaWeather(collection(west,east),now)[0].id,report.id);
  const feed = {state:'ok',lastBodyStarted:'2026-11-23T18:58:00Z',lastSuccess:'2026-11-23T18:58:05Z',intervalMinutes:5};
  assert.ok(listedWeatherUntil(report,feed.lastSuccess,feed,now));
  assert.equal(listedWeatherUntil(report,feed.lastSuccess,{...feed,lastBodyStarted:'2026-11-23T18:59:00Z'},now),null);
});

test('GeoMet excludes ended and expired warnings, marks missing geometry approximate, and rejects incomplete polls',async()=>{
  const ignored = [
    feature(1,-82,{status_en:'ended'}), feature(2,-82,{status_en:'test'}),
    feature(3,-82,{alert_type:'watch'}), feature(4,-82,{event_end_datetime:'2026-11-23T18:59:00Z'}),
    feature(5,-82,{publication_datetime:'2026-11-23T18:20:00'}), feature(6,-82,{risk_colour_en:null}),
    {...feature(7,-82),id:'https://example.test/invalid'}
  ];
  const approximate = {...feature(8,-82),geometry:null};
  const [report,...extra] = normalizeCanadaWeather(collection(...ignored,approximate),now);
  assert.deepEqual(extra,[]);
  assert.equal(report.place_basis,'country_centroid');
  assert.equal(report.weather_area,undefined);
  assert.throws(()=>normalizeCanadaWeather({...collection(approximate),numberMatched:2},now),/partial warning collection/);
  assert.throws(()=>normalizeCanadaWeather({...collection(),links:[{rel:'next'}]},now),/partial warning collection/);
  const feed = feeds.find(feed=>feed.id==='eccc-weather');
  const result = await collect(feed,'',{request:async url=>{
    assert.equal(url,canadaWeatherUrl);
    return Response.json(collection());
  }});
  assert.deepEqual(result.events,[]);
});
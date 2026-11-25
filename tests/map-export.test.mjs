import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import '../assets/map-export.js';

test('GeoJSON exports map positions and published geometry with source IDs and avoids duplicate areas', () => {
  const record = {id:'source-report',kind:'weather_alert',lat:29.1,lon:-81.5,source:'NWS fixture',confidence:'Official bulletin',
    title:'Flood warning',url:'https://example.org/alert',ts:'2026-11-24T01:00:00.000Z',source_published_at:'2026-11-24T01:01:00.000Z',first_received:'2026-11-24T01:02:00.000Z',
    weather_valid_until:'2026-11-24T06:00:00.000Z',weather_listed_until:'2026-11-24T01:15:00.000Z',
    tags:['private tag'],notes:'private notes'};
  const area = {type:'Polygon',coordinates:[[[-81.5,29.1],[-81.3,29.1],[-81.3,29.15],[-81.5,29.1]]]};
  const track = {type:'MultiLineString',coordinates:[[[-81.5,29.1],[-80.3,30.1]]]};
  const marker = {...record,id:'story-fixture',representative_id:record.id,reports:[record],state_codes:['FL'],
    weather_area:area,observation_track:track,place_basis:'weather_area'};
  const exported = CapstoneMapExport.featureCollection([marker],[marker],{basis:'source',live_connected:true});
  assert.equal(exported.type,'FeatureCollection');
  assert.deepEqual(exported.features.map(feature=>feature.properties.geometry_role),['mapped_point','published_area','observation_track']);
  assert.deepEqual(exported.features[0].geometry.coordinates,[-81.5,29.1]);
  assert.equal(exported.features[0].properties.report_id,record.id);
  assert.equal(exported.features[0].properties.source_url,record.url);
  assert.equal(exported.features[0].properties.source_published_utc,record.source_published_at);
  assert.equal(exported.features[0].properties.first_received_utc,record.first_received);
  assert.deepEqual(exported.features[0].properties.state_codes,['FL']);
  assert.equal(exported.features[1].properties.published_window_end_utc,record.weather_valid_until);
  assert.equal(exported.features[1].properties.listing_fresh_until_utc,record.weather_listed_until);
  for (const view of [{live_connected:false},{live_connected:true,replay_at:'2026-11-24T01:12:00.000Z'}]) {
    const historical = CapstoneMapExport.featureCollection([marker],[],view).features[0].properties;
    assert.equal(historical.published_window_end_utc,record.weather_valid_until);
    assert.equal(historical.listing_fresh_until_utc,null);
  }
  assert.doesNotMatch(JSON.stringify(exported),/private/);
});

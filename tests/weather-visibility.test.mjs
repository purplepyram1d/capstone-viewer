import test from 'node:test';
import assert from 'node:assert/strict';
import { listedWeatherUntil } from '../lib/weather-visibility.mjs';

test('only unexpired warnings in the latest successful payload can appear as recently listed',()=>{
  const at = minute=>new Date(Date.UTC(2026,10,23,18,minute)).toISOString();
  const now=Date.parse(at(25));
  const report={kind:'weather_alert',weather_area:{type:'Polygon',coordinates:[[]]},weather_valid_until:at(50)};
  const feed={state:'ok',intervalMinutes:5,lastBodyStarted:at(19),lastSuccess:at(20)};
  assert.equal(listedWeatherUntil(report,at(20),feed,now),at(35));
  assert.equal(listedWeatherUntil({...report,weather_area:null},at(20),feed,now),at(35));
  assert.equal(listedWeatherUntil({...report,weather_valid_until:at(28)},at(20),feed,now),at(28));
  assert.equal(listedWeatherUntil(report,at(20),{...feed,lastSuccess:at(24),unchanged:true},now),at(39));
  assert.equal(listedWeatherUntil(report,at(18),feed,now),null);
  assert.equal(listedWeatherUntil(report,at(20),{...feed,state:'error'},now),null);
  assert.equal(listedWeatherUntil(report,at(20),{...feed,enabled:false},now),null);
  assert.equal(listedWeatherUntil({...report,weather_valid_until:at(24)},at(20),feed,now),null);
  assert.equal(listedWeatherUntil(report,at(20),feed,Date.parse(at(36))),null);
  assert.equal(listedWeatherUntil(report,null,feed,now),null);
  assert.equal(listedWeatherUntil(report,at(20),{...feed,lastBodyStarted:undefined},now),null);
});
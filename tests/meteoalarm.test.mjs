import test from 'node:test';
import assert from 'node:assert/strict';
import { meteoRegions, normalizeMeteoAlarm } from '../lib/meteoalarm.mjs';

const region=meteoRegions.find(region=>region.country==='FR');
const now=Date.parse('2026-11-23T18:00:00Z');
const notice='https://feeds.meteoalarm.org/api/v1/warnings/feeds-france/61b6e320-469c-427f-ab8f-136ab88442dd';
function item({severity='Severe',expires='2026-11-24T04:00:00Z',scope='Public',type='Alert',area='Test region',url=notice,areaShape=''}={}){
  return '<entry><cap:scope>'+scope+'</cap:scope><cap:status>Actual</cap:status><cap:message_type>'+type+'</cap:message_type>' +
    '<cap:severity>'+severity+'</cap:severity><cap:event>Flooding</cap:event><cap:areaDesc>'+area+'</cap:areaDesc>' +
    '<cap:sent>2026-11-23T16:00:00+01:00</cap:sent><cap:expires>'+expires+'</cap:expires>' +
    (areaShape ? '<cap:polygon>'+areaShape+'</cap:polygon>' : '') +
    '<link type="application/cap+xml" href="'+url+'"/></entry>';
}
const feed=(...items)=>'<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">'+
  '<title>MeteoAlarm - Alerting Europe</title>'+items.join('')+'</feed>';

test('MeteoAlarm combines parts of the same notice with public country and shape attribution',()=>{
  const [report]=normalizeMeteoAlarm(feed(item({area:'Area A',areaShape:'46,1 47,1 47,2 46,1'}),
    item({area:'Area B',areaShape:'47,2 48,2 48,3 47,2',severity:'Extreme'})),region,now);
  assert.equal(report.ts,'2026-11-23T15:00:00.000Z');
  assert.equal(report.country,'FR');
  assert.equal(report.url,notice);
  assert.equal(report.place_basis,'international_weather_area');
  assert.equal(report.weather_area.coordinates.length,2);
  assert.ok(report.lat>46 && report.lat<48);
  assert.match(report.summary,/Area A; Area B/);
  assert.match(report.summary,/EUMETNET/);
  assert.equal(normalizeMeteoAlarm(feed(item(),item()),region,now).length,1);
  assert.equal(normalizeMeteoAlarm(feed(item()),region,now)[0].place_basis,'country_centroid');
});

test('MeteoAlarm preserves explicit source dates and filters stale, moderate, private and unexpected notices',()=>{
  assert.deepEqual(normalizeMeteoAlarm(feed(
    item({expires:'2026-11-23T18:00:00Z'}),item({expires:'2026-11-24T00:00:00'}),
    item({severity:'Moderate'}),item({scope:'Restricted'}),item({type:'Cancel'}),
    item({url:'https://example.org/pretend-feed'})
  ),region,now),[]);
  assert.throws(()=>normalizeMeteoAlarm('<feed><title>Another feed</title></feed>',region,now),/Expected a MeteoAlarm feed/);
});
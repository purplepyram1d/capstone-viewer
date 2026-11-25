import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUSGSVolcanoes, normalizeGeoNetVolcanoes } from '../lib/volcano-bulletins.mjs';

const now = Date.parse('2026-11-23T17:00:00Z');
const issued = Date.parse('2026-11-23T15:00:00Z') / 1000;
const notice = {
  noticeIdentifier:'DOI-USGS-AVO-2026-11-23T14:44:00+00:00',sent_unixtime:issued,
  noticeType:'Daily Update',volcanoes:'Fixture Volcano',obsFullname:'Fixture Observatory',
  notice_url:'https://example.org/untrusted',
  sections:[{volcanoName:'Fixture Volcano',alertLevel:'WATCH',colorCode:'ORANGE',synopsis:'An observation as issued.'}]
};

test('USGS volcano notices use their issue time and keep alert levels separate from observations', () => {
  const [report] = normalizeUSGSVolcanoes([notice,notice],now);
  assert.equal(report.kind,'volcano_bulletin');
  assert.equal(report.ts,'2026-11-23T15:00:00.000Z');
  assert.equal(report.confidence,'Official volcano bulletin');
  assert.match(report.summary,/Fixture Observatory.*WATCH.*Aviation ORANGE.*An observation as issued/);
  assert.equal(report.url,'https://volcanoes.usgs.gov/hans-public/notice/'+encodeURIComponent(notice.noticeIdentifier));
  assert.equal(normalizeUSGSVolcanoes([notice,notice],now).length,1);
  assert.equal(normalizeUSGSVolcanoes([{...notice,sent_unixtime:issued-45*86400}],now).length,0);
  assert.throws(()=>normalizeUSGSVolcanoes({},now),/Expected a USGS volcano notification list/);
});

test('GeoNet includes published Volcano Activity Bulletins with their recorded level and trusted links', () => {
  const bulletin = {type:'vab',val:3,published:'2026-11-23T13:30:00Z',title:'Volcano activity notice',
    link:'https://www.geonet.org.nz/vabs/abc123456?example=1'};
  const feed = [bulletin,bulletin,{...bulletin,type:'newsStory'},
    {...bulletin,link:'https://example.org/vabs/abc123457'}];
  const [report] = normalizeGeoNetVolcanoes({feed},now);
  assert.equal(normalizeGeoNetVolcanoes({feed},now).length,1);
  assert.equal(report.ts,'2026-11-23T13:30:00.000Z');
  assert.equal(report.url,'https://www.geonet.org.nz/vabs/abc123456');
  assert.match(report.summary,/at issue: 3 of 5/);
  assert.equal(report.lat,null);
  assert.equal(normalizeGeoNetVolcanoes({feed:[{...bulletin,val:17}]},now)[0].summary,'Volcanic activity bulletin published by GeoNet.');
  assert.throws(()=>normalizeGeoNetVolcanoes({items:[]},now),/Expected a GeoNet bulletin feed/);
});
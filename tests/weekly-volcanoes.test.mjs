import test from 'node:test';
import assert from 'node:assert/strict';
import { feeds, collect } from '../lib/collectors.mjs';
import { normalizeWeeklyVolcanoes } from '../lib/weekly-volcanoes.mjs';
import { withReportLocation } from '../lib/geography.mjs';
import '../assets/event-types.js';

const rss = ({title,ts,point='12.7690 124.0560'}) => '<?xml version="1.0" encoding="ISO-8859-1"?>'+
  '<rss xmlns:georss="http://www.georss.org/georss"><channel><item><title>'+title+'</title>'+
  '<guid isPermaLink="false">https://volcano.si.edu/reports_weekly.cfm#vn_273010</guid>'+
  '<pubDate>'+ts+'</pubDate><georss:point>'+point+'</georss:point></item></channel></rss>';

test('weekly volcano records use publisher issue time, catalog point and a dated source reference', () => {
  const XML = rss({title:'Bulusan (Philippines) - Report for 12 November-18 November 2026 - New Unrest',
    ts:'Thu, 19 Nov 2026 03:26:11 -0400'});
  const [raw] = normalizeWeeklyVolcanoes(XML,Date.parse('2026-11-24T06:00:00Z'));
  const report = withReportLocation(raw);
  assert.equal(report.ts,'2026-11-19T07:26:11.000Z');
  assert.equal(report.country_code,'PH');
  assert.equal(report.place_basis,'catalog_point');
  assert.deepEqual([report.lat,report.lon],[12.769,124.056]);
  assert.equal(report.url,'https://volcano.si.edu/showreport.cfm?gvpvar=GVP.WVAR20261112-273010');
  assert.equal(globalThis.CapstoneTypes.evidence(report),'Official');
});

test('weekly report references handle new years and preserve the published character encoding', async () => {
  const xml = rss({title:'Test Éruption - Report for 29 December-4 January 2026 - Continuing Unrest',
    ts:'Mon, 5 Jan 2026 14:00:00 GMT',point:''});
  const [yearBoundary] = normalizeWeeklyVolcanoes(xml,Date.parse('2026-01-08T00:00:00Z'));
  assert.match(yearBoundary.url,/WVAR20251229-/);
  assert.equal(yearBoundary.lat,null);
  const current = rss({title:'Test Éruption - Report for 12 November-18 November 2026 - Continuing Unrest',ts:new Date().toUTCString()});
  const {events:[record]} = await collect(feeds.find(feed=>feed.id==='gvp-volcano-weekly'),'',{
    request:async()=>new Response(Buffer.from(current,'latin1'))
  });
  assert.match(record.title,/Éruption/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import { normalizeGDACS } from '../lib/gdacs.mjs';
import { evidenceClass } from '../lib/developing.mjs';
import { sourceContext } from '../lib/reading.mjs';

const now = Date.parse('2026-11-23T12:00:00Z');
const date = 'Sun, 22 Nov 2026 10:00:00 GMT';
const item = ({ type = 'FL', id = '123', level = 'Green', point = '12.2 125.3',
  temporary = 'false', published = date, description = 'Projected impact &amp; affected area.' } = {}) => `
  <item>
    <pubDate>${published}</pubDate>
    <description>${description}</description>
    <gdacs:datemodified>Mon, 23 Nov 2026 11:00:00 GMT</gdacs:datemodified>
    <gdacs:eventtype>${type}</gdacs:eventtype>
    <gdacs:eventid>${id}</gdacs:eventid>
    <gdacs:country>Philippines, Viet Nam, China</gdacs:country>
    <gdacs:alertlevel>${level}</gdacs:alertlevel>
    <gdacs:temporary>${temporary}</gdacs:temporary>
    <georss:point>${point}</georss:point>
  </item>`;
const feed = (...items) => `\uFEFF<?xml version="1.0"?>
<rss xmlns:gdacs="http://www.gdacs.org" xmlns:georss="http://www.georss.org/georss"><channel>
  <title>GDACS RSS information</title>${items.join('')}
</channel></rss><!-- generated -->`;

test('GDACS alerts retain their source date, model classification, and approximate map location', () => {
  const [report] = normalizeGDACS(feed(item()), now);
  assert.equal(report.ts, '2026-11-22T10:00:00.000Z');
  assert.equal(report.title, 'GDACS green alert · Flood in Philippines, Viet Nam + 1 more');
  assert.match(report.summary, /estimates potential impact.+Projected impact & affected area/);
  assert.equal(report.url, 'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=123');
  assert.equal(report.place_basis, 'regional_reference');
  assert.deepEqual([report.lat, report.lon], [12.2, 125.3]);
  assert.equal(globalThis.CapstoneTypes.describe(report).evidence, 'Modeled alert');
  assert.equal(evidenceClass(report), 'Modeled hazard alert');
  assert.match(sourceContext(report).basis, /models potential impact/);
});

test('GDACS deduplicates source records, leaves malformed coordinates unmapped, and limits low-priority fire noise', () => {
  const rows = normalizeGDACS(feed(
    item(), item({ level: 'Red', published: 'Mon, 23 Nov 2026 10:00:00 GMT' }),
    item({ type: 'WF', id: '124' }),
    item({ type: 'WF', id: '125', level: 'Orange', point: '84 undefined' }),
    item({ type: 'EQ', id: '126', level: 'Red' }),
    item({ type: 'TC', id: '127', temporary: 'true' }),
    item({ type: 'VO', id: 'no-event-id' }),
    item({ id: '128', published: 'Sat, 01 Aug 2026 12:00:00 GMT' })
  ), now);
  assert.equal(rows.length, 2);
  assert.match(rows[0].title, /red alert/);
  assert.equal(rows[1].lat, null);
  assert.equal(rows[1].place_basis, 'unlocated');
  assert.throws(() => normalizeGDACS('<html>Site is down</html>', now), /Expected the GDACS/);
});

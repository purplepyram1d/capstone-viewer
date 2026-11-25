import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import { normalizeSWPC } from '../lib/space-weather.mjs';
import { buildStories } from '../lib/intelligence.mjs';
import { coverageKey } from '../lib/reading.mjs';

const now = Date.parse('2026-11-23T12:00:00Z');
const bulletin = (product, serial, content, extra = '') => ({
  product_id: product, issue_datetime: '2026-11-22 08:54:00.450',
  message: `Space Weather Message Code: test\r\nSerial Number: ${serial}\r\n\r\n${content}\r\n${extra}`
});

test('NOAA thresholds and forecasts are labeled separately with their issue timestamp in UTC', () => {
  const [alert, watch, extension] = normalizeSWPC([
    bulletin('K07A', 13, 'ALERT: Geomagnetic K-index of 7'),
    bulletin('A20F', 23, 'WATCH: Geomagnetic Storm Category G2 Predicted'),
    bulletin('K05W', 44, 'EXTENDED WARNING: Geomagnetic K-index of 5 expected', 'Now Valid Until: 2026 Nov 23 1800 UTC'),
    bulletin('K04W', 6, 'WARNING: Geomagnetic K-index of 4 expected'),
    { product_id: 'K05A', issue_datetime: '2026-11-22 08:54:00' }
  ], now);
  assert.equal(alert.ts, '2026-11-22T08:54:00.450Z');
  assert.equal(alert.confidence, 'Official threshold bulletin');
  assert.equal(alert.title, 'NOAA G3 geomagnetic storm alert');
  assert.equal(watch.confidence, 'Official forecast bulletin');
  assert.equal(watch.title, 'NOAA G2 geomagnetic storm watch');
  assert.match(extension.summary, /validity ends 2026 Nov 23 1800 UTC/);
  assert.equal(extension.place_basis, 'unlocated');
  assert.equal(globalThis.CapstoneTypes.describe(watch).id, 'space');
  assert.equal(normalizeSWPC([bulletin('K04W', 6, 'WARNING: Geomagnetic K-index of 4 expected')], now).length, 0);
});

test('NOAA records using one bulletin archive retain separate report identities', () => {
  const a = bulletin('K05A', 15, 'ALERT: Geomagnetic K-index of 5');
  const b = bulletin('K05A', 16, 'ALERT: Geomagnetic K-index of 5');
  const reports = normalizeSWPC([a, b], now);
  assert.equal(reports[0].url, reports[1].url);
  assert.notEqual(coverageKey(reports[0]), coverageKey(reports[1]));
  assert.equal(buildStories(reports).length, 2);
  assert.equal(normalizeSWPC([a], now)[0].id, reports[0].id);
});

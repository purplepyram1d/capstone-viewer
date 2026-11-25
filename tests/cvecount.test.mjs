import test from 'node:test';
import assert from 'node:assert/strict';
import { createCveCount, sameDayLastYear, localMidnight } from '../lib/cvecount.mjs';

const reply = total => ({ ok: true, json: async () => ({ totalResults: total }) });

test('counts today since local midnight and the same date last year, hourly, keeping stale counts on failure', async () => {
  let now = new Date(2026, 10, 18, 14, 30).getTime(); const calls = [];
  let fail = false;
  const request = async url => { calls.push(url); if (fail) return { ok: false, status: 503 }; return reply(url.includes('2025-') ? 151 : 87); };
  const c = createCveCount({ request, clock: () => now });
  let s = await c.get();
  assert.equal(s.total, 87); assert.equal(s.lastYear.total, 151); assert.equal(s.date, '2026-11-18'); assert.equal(s.lastYear.date, '2025-11-18');
  assert.equal(calls.length, 2); assert.match(calls[0], /resultsPerPage=1/); assert.match(calls[0], /noRejected/); assert.match(calls[1], /noRejected/);
  now += 30 * 60000; await c.get(); assert.equal(calls.length, 2, 'cached inside the hour');
  now += 31 * 60000; fail = true; s = await c.get();
  assert.equal(s.total, 87); assert.equal(s.stale, true); assert.match(s.error, /503/); assert.equal(calls.length, 3, 'last year is not refetched the same day');
  now = new Date(2026, 10, 19, 0, 5).getTime(); fail = false; s = await c.get();
  assert.equal(s.date, '2026-11-19'); assert.equal(s.lastYear.date, '2025-11-19'); assert.equal(s.stale, false);
});

test('last year runs midnight to midnight, and 29 February falls back to 28 February', () => {
  const r = sameDayLastYear(new Date(2028, 1, 29, 10).getTime());
  assert.equal(new Date(r.start).getDate(), 28); assert.equal(new Date(r.start).getMonth(), 1); assert.equal(new Date(r.start).getFullYear(), 2027);
  assert.equal(r.end - r.start, 86400000);
  assert.equal(new Date(localMidnight(new Date(2026, 10, 18, 23, 59).getTime())).getHours(), 0);
});

test('collectors off makes no request', async () => {
  let called = false; const c = createCveCount({ request: async () => { called = true; return reply(1); }, enabled: false });
  assert.equal((await c.get()).disabled, true); assert.equal(called, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { topHeadlines } from '../lib/headlines.mjs';
const now = Date.parse('2026-11-04T15:00:00Z'), ago = minutes => new Date(now - minutes * 60000).toISOString();
const story = (id, minutes, score, patch = {}) => ({ id, title: 'Story ' + id, source: 'Test', category: 'geo', url: 'https://example.org/' + id, ts: ago(minutes), first_ts: ago(minutes), score, ...patch });

test('the past hour is used when it has enough stories, ranked by score', () => {
  const stories = [...Array.from({ length: 9 }, (_, i) => story('h' + i, 10 + i, 50 + i)), story('old', 90, 99)];
  const h = topHeadlines(stories, { now });
  assert.equal(h.window_hours, 1);
  assert.equal(h.rows[0].id, 'h8', 'highest score first');
  assert.ok(!h.rows.some(r => r.id === 'old'), 'older than the window stays out');
  assert.equal(h.rows[0].url, 'https://example.org/h8');
});

test('a quiet hour widens the window until there are enough stories', () => {
  const stories = [story('a', 20, 40), story('b', 150, 60), ...Array.from({ length: 7 }, (_, i) => story('c' + i, 300 + i, 30))];
  const h = topHeadlines(stories, { now });
  assert.equal(h.window_hours, 6);
  assert.deepEqual(h.rows.slice(0, 2).map(r => r.id), ['b', 'a']);
  assert.equal(topHeadlines([story('x', 20, 40)], { now }).window_hours, 24, 'falls back to a day and returns what there is');
});

test('outages: at most two, and an ongoing outage that began before the window is not news in it', () => {
  const outage = (id, minutes, first) => story(id, minutes, 95, { kind: 'outage', ongoing: true, first_ts: ago(first) });
  const stories = [outage('o1', 5, 30), outage('o2', 6, 40), outage('o3', 7, 50), outage('old-start', 8, 600), ...Array.from({ length: 8 }, (_, i) => story('s' + i, 10 + i, 40))];
  const h = topHeadlines(stories, { now });
  assert.equal(h.window_hours, 1);
  assert.deepEqual(h.rows.filter(r => r.kind === 'outage').map(r => r.id), ['o1', 'o2']);
  assert.ok(!h.rows.some(r => r.id === 'old-start'));
});

test('limit, future timestamps and missing first_ts', () => {
  const stories = [...Array.from({ length: 30 }, (_, i) => story('s' + i, i + 1, 50)), story('future', -60, 99), { ...story('nofirst', 5, 70), first_ts: undefined }];
  const h = topHeadlines(stories, { now, limit: 15 });
  assert.equal(h.rows.length, 15);
  assert.ok(!h.rows.some(r => r.id === 'future'), 'a report dated an hour ahead is ignored');
  assert.equal(h.rows[0].id, 'nofirst'); assert.equal(h.rows[0].first_ts, h.rows[0].ts);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPollHistory } from '../lib/poll-history.mjs';

const HOUR = 3_600_000;
const now = Date.parse('2026-11-23T12:00:00Z');

test('poll history separates zero reports from failed attempts and retains daily and weekly counts', () => {
  const db = new DatabaseSync(':memory:');
  const history = createPollHistory(db);
  history.record('feed', now - 4000, true, 0, now - 3500);
  history.record('feed', now - 2000, false, 99, now - 1250);
  history.record('feed', now - 48 * HOUR - 1000, true, 8, now - 48 * HOUR);
  history.record('other', now - 1000, true, 1, now - 500);
  const day = createPollHistory(db).history('feed', 24, now);
  assert.equal(day.succeeded, 1);
  assert.equal(day.failed, 1);
  assert.deepEqual(day.recent.map(poll => [poll.success, poll.duration_ms, poll.reports]), [[false, 750, null], [true, 500, 0]]);
  assert.equal(history.history('feed', 168, now).attempts, 3);
  assert.equal(history.history('unknown', 24, now).attempts, 0);
  db.close();
});

test('poll history bounds the newest rows separately from totals and prunes records after seven days', () => {
  const db = new DatabaseSync(':memory:');
  const history = createPollHistory(db);
  for (let i = 0; i < 31; i++) history.record('feed', now - 1000, true, i, now - 100);
  history.record('feed', now - 8 * 24 * HOUR - 25, false, null, now - 8 * 24 * HOUR);
  const week = history.history('feed', 168, now);
  assert.equal(week.attempts, 31);
  assert.equal(week.recent.length, 20);
  assert.equal(week.recent[0].reports, 30);
  history.prune(now);
  assert.equal(db.prepare('SELECT count(*) n FROM feed_polls').get().n, 31);
  db.close();
});

test('poll history upgrades older records and differentiates changed reports from repeats', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE feed_polls(id INTEGER PRIMARY KEY,feed_id TEXT NOT NULL,completed INTEGER NOT NULL,duration INTEGER NOT NULL,success INTEGER NOT NULL,reports INTEGER)");
  db.prepare("INSERT INTO feed_polls VALUES(1,'feed',?,500,1,2)").run(now-2000);
  const history = createPollHistory(db);
  history.record('feed',now-1500,true,4,now-1000,{added:1,revised:2});
  history.record('feed',now-900,true,4,now-600,{added:0,revised:0});
  history.record('feed',now-500,false,null,now,{error:'HTTP 429'});
  assert.deepEqual(history.history('feed',24,now).recent.map(poll=>[poll.reports,poll.added,poll.revised,poll.error]),[
    [null,null,null,'HTTP 429'],[4,0,0,null],[4,1,2,null],[2,null,null,null]
  ]);
  db.close();
});

test('unchanged publisher results count as successful without implying any reports were returned', () => {
  const db = new DatabaseSync(':memory:');
  const history = createPollHistory(db);
  history.record('feed',now-400,true,null,now,{unchanged:true,added:0,revised:0});
  const result = history.history('feed',24,now);
  assert.equal(result.succeeded,1);
  assert.equal(result.failed,0);
  assert.deepEqual([result.recent[0].unchanged,result.recent[0].reports],[true,null]);
  db.close();
});

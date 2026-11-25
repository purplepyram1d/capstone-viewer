import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createReportHistory } from '../lib/report-history.mjs';
import { repairRelayLabels } from '../lib/claims.mjs';

test('hazard briefing candidates use known first receipts and preserve source provenance',()=>{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const history = createReportHistory(db);
  const put = db.prepare('INSERT INTO events VALUES (?,?)');
  const since = '2026-11-22T17:00:00.000Z';
  const receipt = '2026-11-22T17:05:00.000Z';
  for (const [id,kind,score,first] of [
    ['ordinary','weather_alert',58,receipt],['extreme','weather_alert',82,receipt],
    ['mapping','mapping_activation',55,receipt],['old','earthquake',90,since],
    ['undated','tsunami',65,null],['coverage','report',85,receipt]
  ]) {
    const data = JSON.stringify({id,kind,score,title:id,ts:'2026-11-20T10:00:00Z',url:'https://example.org/'+id,source:'Fixture source'});
    if (first) history.observe(id,data,first);
    put.run(id,data);
    if (!first) history.observe(id,data,receipt);
  }
  const recent=history.receivedHazards(since,receipt);
  assert.equal(recent.total,2);
  assert.deepEqual(recent.reports.map(row=>row.id),['extreme','mapping']);
  assert.ok(recent.reports.every(row=>row.first_received===receipt));
  assert.match(recent.reports[0].url,/extreme$/);
  assert.equal(history.receivedHazards(since,since).total,0);
  db.close();
});

test('hazard receipt previews pick one observation per gauge while preserving the report count',()=>{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const history = createReportHistory(db);
  const add = db.prepare('INSERT INTO events VALUES (?,?)');
  const since='2026-11-24T02:00:00.000Z', received='2026-11-24T04:30:00.000Z';
  for (const [id,hour,kind,score,url] of [
    ['older-gauge','02','river_gauge',81,'https://water.noaa.gov/gauges/example'],
    ['newer-gauge','04','river_gauge',68,'https://water.noaa.gov/gauges/example'],
    ['other','03','weather_alert',69,'https://example.org/weather']
  ]) {
    const report = JSON.stringify({id,kind,score,url,ts:'2026-11-24T'+hour+':10:00.000Z'});
    history.observe(id,report,received);
    add.run(id,report);
  }
  const result = history.receivedHazards(since,received);
  assert.equal(result.total,3);
  assert.deepEqual(result.reports.map(row=>row.id),['other','newer-gauge']);
  db.close();
});

test('assessment saves detect another window and allow an explicit replacement with the latest version',()=>{
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const history=createReportHistory(db);
  const data=JSON.stringify({title:'Fixture report'});
  db.prepare('INSERT INTO events VALUES (?,?)').run('report',data);
  const revision=history.details('report',data).revision;
  const draft={revision,decision:'confirmed',evidence_url:'https://example.org/evidence',rationale:'First window'};
  const first=history.assess('report',{...draft,expected_version:null});
  assert.equal(history.details('report',data).assessment.version,first.version);
  assert.throws(()=>history.assess('report',{...draft,rationale:'Stale window',expected_version:null}),{status:409});
  assert.equal(history.details('report',data).assessment.rationale,'First window');
  const second=history.assess('report',{...draft,rationale:'Explicit replacement',expected_version:first.version});
  assert.notEqual(second.version,first.version);
  assert.throws(()=>history.assess('report',{...draft,expected_version:first.version}),{status:409});
  db.close();
});

test('collection history survives restart, deduplicates receipts, and flags assessments on revision', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const put = db.prepare('INSERT OR REPLACE INTO events VALUES (?,?)');
  const legacy = JSON.stringify({ title:'Earlier report', summary:'Original source excerpt' });
  const received = '2026-11-22T00:01:00.000Z';
  const again = '2026-11-22T00:02:00.000Z';
  put.run('legacy', legacy);
  let history = createReportHistory(db);
  const next = JSON.stringify({ title:'Updated report', summary:'Changed source excerpt' });
  assert.equal(history.details('legacy', legacy).first_seen, null);
  history.observe('legacy', next, received);
  put.run('legacy', next);
  history.observe('legacy', next, again);
  let detail = history.details('legacy', next);
  assert.equal(detail.first_seen, null);
  assert.equal(detail.last_seen, again);
  assert.equal(detail.versions[0].revision, detail.revision);
  assert.notEqual(detail.versions[1].revision, detail.revision);
  assert.deepEqual(detail.versions.map(({observed,title}) => [observed,title]), [[received,'Updated report'],[null,'Earlier report']]);
  const review = { revision: detail.revision, decision:'confirmed', evidence_url:'https://example.org/statement', rationale:'Publisher statement confirms the reported incident.' };
  assert.throws(() => history.assess('legacy', {...review,evidence_url:'javascript:alert(1)'}), /primary-source URL/);
  history.assess('legacy', review);
  history = createReportHistory(db);
  assert.equal(history.details('legacy', next).assessment.needs_review, false);
  history.observe('legacy', legacy, again);
  put.run('legacy', legacy);
  assert.equal(history.details('legacy', legacy).assessment.needs_review, true);
  assert.throws(() => history.assess('legacy', review), /report changed/);
  history.observe('new', next, received);
  put.run('new', next);
  history.observe('new', next, again);
  assert.equal(history.details('new', next).first_seen, received);
  db.exec("DELETE FROM events WHERE id='legacy'");
  history.prune();
  assert.equal(history.details('legacy', legacy).version_count, 0);
  assert.equal(history.details('legacy', legacy).assessment, null);
  db.close();
});

test('legacy relay correction preserves the original source excerpt and unrelated titles', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const put = db.prepare('INSERT INTO events VALUES (?,?)');
  put.run('relay', JSON.stringify({ title:'Confirmed incident: Example', summary:'Relay said confirmed', confidence:'Victim-confirmed incident, relayed by a tracker' }));
  put.run('publisher', JSON.stringify({ title:'Confirmed incident: Press release', confidence:'Official statement' }));
  put.run('malformed', '{invalid');
  repairRelayLabels(db);
  repairRelayLabels(db);
  const find = db.prepare('SELECT data FROM events WHERE id=?');
  assert.deepEqual(JSON.parse(find.get('relay').data), {
    title:'Reported incident: Example', summary:'Relay said confirmed', confidence:'Unverified incident report from a relay'
  });
  assert.equal(JSON.parse(find.get('publisher').data).title,'Confirmed incident: Press release');
  db.close();
});

test('receipts return a different outcome for first records, source revisions, and repeat polls', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, data TEXT NOT NULL)');
  const history = createReportHistory(db);
  const put = db.prepare('INSERT INTO events VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
  const before = JSON.stringify({id:'fixture',title:'Original source record'});
  const after = JSON.stringify({id:'fixture',title:'Source revision'});
  const stamp = '2026-11-23T10:00:00.000Z';
  put.run('legacy',stamp,before);
  assert.equal(history.observe('legacy',before,stamp),'unchanged');
  assert.equal(history.observe('fixture',before,stamp),'added');
  put.run('fixture',stamp,before);
  assert.equal(history.observe('fixture',before,stamp),'unchanged');
  assert.equal(history.observe('fixture',after,stamp),'revised');
  db.close();
});

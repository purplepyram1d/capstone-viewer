import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createIntelligence } from '../lib/intelligence.mjs';
import { createReading } from '../lib/reading.mjs';
import { createReportHistory } from '../lib/report-history.mjs';
import { pruneReports } from '../lib/report-retention.mjs';
import { createReports } from '../lib/reports.mjs';
import { createTimeline } from '../lib/timeline.mjs';

test('saved reports survive retention with review and notes without resurfacing in recent lists or alerts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,ts TEXT NOT NULL,data TEXT NOT NULL)');
    const reading = createReading(db);
    const history = createReportHistory(db);
    const timeline = createTimeline(db, reading, { reviewEnabled:true });
    const reports = createReports(db, history);
    const watchlists = createIntelligence(db);
    const put = db.prepare('INSERT INTO events VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,ts=excluded.ts');
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const now = new Date().toISOString();
    for (const [id,ts] of [['saved',old],['expired',old],['recent',now]]) {
      const data = JSON.stringify({ id, ts, title:'Vendor report '+id, source:id==='saved'?'Archived source':'Recent source', category:'cyber' });
      history.observe(id,data,ts);
      put.run(id,ts,data);
    }
    assert.throws(() => reports.setSaved('missing',true), /no longer available/);
    assert.throws(() => reports.setSaved('saved','true'), /Choose whether/);
    const saved = reports.setSaved('saved',true);
    assert.equal(reports.setSaved('saved',true).saved_at,saved.saved_at);
    reports.save('saved','Keep for the investigation');
    timeline.tags('saved',[{type:'custom',label:'Investigation'}]);
    const revision = reports.get('saved').history.revision;
    history.assess('saved',{revision,decision:'unverified',evidence_url:'https://example.org/primary',rationale:'Await the full advisory.'});
    reading.update({sources:[{key:'Archived source',label:'Archived source'}],subjects:[]});

    assert.equal(pruneReports(db).changes,1);
    history.prune();
    const archived = reports.get('saved');
    assert.equal(archived.notes.note,'Keep for the investigation');
    assert.equal(archived.tags[0].label,'Investigation');
    assert.equal(archived.history.versions[0].title,'Vendor report saved');
    assert.equal(archived.history.assessment.revision,revision);
    assert.deepEqual(timeline.list().events.map(report=>report.id),['recent']);

    const scope = new URLSearchParams({ scope:'saved', tag:'custom:Investigation', review:'unverified', view:'grouped' });
    const archive = timeline.list(scope);
    assert.deepEqual(archive.sources,['Archived source']);
    assert.deepEqual(archive.events.map(report=>[report.id,report.muted,report.saved_at]),[['saved',true,saved.saved_at]]);
    scope.set('days','7');
    assert.equal(timeline.list(scope).total,0);
    assert.equal(watchlists.previewRule({name:'Vendor reports',terms:['vendor']}).matches,1);
    watchlists.addRule({name:'Vendor reports',terms:['vendor']});
    watchlists.evaluate([archived]);
    assert.deepEqual(watchlists.state().alerts.map(alert=>alert.event_id),['recent']);

    assert.equal(reports.setSaved('saved',false).saved_at,null);
    assert.equal(timeline.list(new URLSearchParams({ scope:'saved' })).total,0);
    assert.equal(pruneReports(db).changes,1);
    assert.throws(() => reports.get('saved'),/no longer available/);
  } finally {
    db.close();
  }
});

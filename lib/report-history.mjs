import { createHash } from 'node:crypto';
import { safeUrl } from './events.mjs';

export const revisionKey = data => createHash('sha256').update(data).digest('hex');
const assessmentVersion = assessment => assessment ? revisionKey(JSON.stringify([
  assessment.revision,assessment.decision,assessment.evidence_url,assessment.rationale,assessment.reviewed
])) : null;

export function createReportHistory(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_observations (
      event_id TEXT PRIMARY KEY, first_seen TEXT, last_seen TEXT NOT NULL,
      revision TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS report_observations_first_seen ON report_observations(first_seen);
    CREATE TABLE IF NOT EXISTS report_revisions (
      id INTEGER PRIMARY KEY, event_id TEXT NOT NULL, observed TEXT, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS report_revision_event ON report_revisions(event_id, id);
    CREATE TABLE IF NOT EXISTS report_assessments (
      event_id TEXT PRIMARY KEY, revision TEXT NOT NULL, decision TEXT NOT NULL,
      evidence_url TEXT NOT NULL, rationale TEXT NOT NULL, reviewed TEXT NOT NULL
    );
  `);
  const findEvent = db.prepare('SELECT data FROM events WHERE id=?');
  const findObservation = db.prepare('SELECT * FROM report_observations WHERE event_id=?');
  const findAssessment = db.prepare('SELECT * FROM report_assessments WHERE event_id=?');
  const append = db.prepare('INSERT INTO report_revisions(event_id,observed,data) VALUES (?,?,?)');
  const touch = db.prepare(`
    INSERT INTO report_observations VALUES(?,?,?,?)
    ON CONFLICT(event_id) DO UPDATE SET last_seen=excluded.last_seen, revision=excluded.revision
  `);
  const latest = db.prepare('SELECT observed,data FROM report_revisions WHERE event_id=? ORDER BY id DESC LIMIT 10');
  const count = db.prepare('SELECT count(*) AS n FROM report_revisions WHERE event_id=?');
  const hazardReceipts = db.prepare(`
    WITH candidates AS (
      SELECT e.id,json_extract(e.data,'$.ts') AS ts,e.data,o.first_seen,json_extract(e.data,'$.kind') AS kind,
        json_extract(e.data,'$.score') AS score,json_extract(e.data,'$.url') AS url
      FROM report_observations o JOIN events e ON e.id=o.event_id
      WHERE o.first_seen>? AND o.first_seen<=? AND json_valid(e.data)
    ), ranked AS (
      SELECT *,count(*) OVER () AS total,row_number() OVER (
        PARTITION BY CASE WHEN kind='river_gauge' AND url IS NOT NULL THEN 'gauge:'||url ELSE 'report:'||id END
        ORDER BY ts DESC,first_seen DESC,id
      ) AS preview_rank
      FROM candidates
      WHERE kind='mapping_activation' OR (
        kind IN ('earthquake','hazard','weather_alert','volcano_bulletin','volcano_weekly','tsunami',
          'space_weather','wildfire_record','tropical_cyclone','disaster_declaration','river_gauge','local_storm_report')
        AND score>=64
      )
    )
    SELECT data,first_seen,total FROM ranked WHERE preview_rank=1
    ORDER BY score DESC,first_seen DESC,id LIMIT 3
  `);
  const putAssessment = db.prepare(`
    INSERT INTO report_assessments VALUES(?,?,?,?,?,?)
    ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision, decision=excluded.decision,
    evidence_url=excluded.evidence_url, rationale=excluded.rationale, reviewed=excluded.reviewed
  `);

  // Called before the event upsert, within the same transaction.
  function validJson(data) {
    try { JSON.parse(data); return true; } catch { return false; }
  }

  function observe(id, data, observed) {
    const previous = findObservation.get(id);
    const retained = previous ? null : findEvent.get(id);
    const revision = revisionKey(data);
    if (retained && retained.data !== data && validJson(retained.data)) append.run(id, null, retained.data);
    if (previous?.revision !== revision) append.run(id, observed, data);
    touch.run(id, retained || (previous && !previous.first_seen) ? null : observed, observed, revision);
    if (previous?.revision === revision || retained?.data === data) return 'unchanged';
    return previous || retained ? 'revised' : 'added';
  }

  function details(id, data) {
    const observation = findObservation.get(id);
    const revision = revisionKey(data);
    const assessment = findAssessment.get(id);
    return {
      first_seen: observation?.first_seen ?? null,
      last_seen: observation?.last_seen ?? null,
      revision,
      version_count: count.get(id).n,
      versions: latest.all(id).map(({ observed, data }) => {
        const { title, summary, url, ts, date_precision, source_date_basis, source_published_at, confidence, ongoing, place, place_basis } = JSON.parse(data);
        return { observed, revision: revisionKey(data), title, summary, url, ts, date_precision, source_date_basis, source_published_at, confidence, ongoing, place, place_basis };
      }),
      assessment: assessment ? {...assessment,version:assessmentVersion(assessment),needs_review:assessment.revision !== revision} : null
    };
  }

  function assess(id, value) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = findEvent.get(id);
      if (!row) throw new Error('Report no longer available.');
      if (value?.revision !== revisionKey(row.data)) throw new Error('This report changed. Reopen it and review the current source before saving.');
      if (!['unverified', 'confirmed', 'contradicted'].includes(value.decision)) throw new Error('Choose an assessment.');
      const evidence = safeUrl(value.evidence_url);
      const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
      if (!evidence || evidence.length > 2000 || !rationale || rationale.length > 2000) {
        throw new Error('Enter a primary-source URL and a rationale of up to 2,000 characters.');
      }
      if (value.expected_version !== undefined && value.expected_version !== assessmentVersion(findAssessment.get(id))) {
        throw Object.assign(new Error('A newer assessment has already been saved.'),{status:409});
      }
      const reviewed = new Date().toISOString();
      const next = {decision:value.decision,evidence_url:evidence,rationale,reviewed};
      putAssessment.run(id,value.revision,next.decision,next.evidence_url,next.rationale,next.reviewed);
      db.exec('COMMIT');
      return {...next,version:assessmentVersion({...next,revision:value.revision})};
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function prune() {
    db.exec(`
      DELETE FROM report_observations WHERE event_id NOT IN (SELECT id FROM events);
      DELETE FROM report_revisions WHERE event_id NOT IN (SELECT id FROM events);
      DELETE FROM report_assessments WHERE event_id NOT IN (SELECT id FROM events);
    `);
  }

  function receivedHazards(since, until) {
    const rows = hazardReceipts.all(since,until);
    return {total:rows[0]?.total || 0,reports:rows.map(row=>{
      const {id,title,url,source} = JSON.parse(row.data);
      return {id,title,url,source,first_received:row.first_seen};
    })};
  }

  return { observe, details, assess, prune, receivedHazards, lastReceived: id => findObservation.get(id)?.last_seen };
}

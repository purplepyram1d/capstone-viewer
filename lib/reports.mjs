import { withReportLocation } from './geography.mjs';
import { outageFreshness } from './outage-state.mjs';
import { reportTags } from './report-tags.mjs';
import { revisionKey } from './report-history.mjs';
import { ensureSavedReports } from './report-retention.mjs';
import { nwsReportIdentifier, withNwsReplacements } from './weather-alerts.mjs';
import { withEaFloodTransitions } from './ea-floods.mjs';

export function createReports(db, history) {
  db.exec('CREATE TABLE IF NOT EXISTS event_notes(event_id TEXT PRIMARY KEY,note TEXT NOT NULL,updated TEXT NOT NULL)');
  ensureSavedReports(db);
  const findEvent = db.prepare('SELECT data FROM events WHERE id=? AND json_valid(data)');
  const findNwsUpdates = db.prepare(`
    SELECT e.data FROM events e
    WHERE e.ts>? AND json_valid(e.data) AND json_extract(e.data,'$.feed_id')='nws-alerts'
      AND EXISTS (
        SELECT 1 FROM json_each(e.data,'$.nws_references') reference
        WHERE CASE WHEN reference.type='object' THEN json_extract(reference.value,'$.id') END=?
          AND CASE WHEN reference.type='object' THEN json_extract(reference.value,'$.ts') END=?
      )
    ORDER BY e.ts,e.id LIMIT 8
  `);
  const findEaUpdates = db.prepare(`
    SELECT data FROM events WHERE ts>=? AND json_valid(data) AND json_extract(data,'$.feed_id')='ea-floods'
      AND json_extract(data,'$.ea_flood_area')=? AND json_extract(data,'$.ea_severity_changed')>?
    ORDER BY json_extract(data,'$.ea_severity_changed'),ts LIMIT 8
  `);
  const findSaved = db.prepare('SELECT saved_at FROM saved_reports WHERE event_id=?');
  const findTags = db.prepare('SELECT data FROM event_tags WHERE event_id=?');
  const findNote = db.prepare('SELECT note,updated FROM event_notes WHERE event_id=?');
  function getNote(id) {
    const note = findNote.get(id);
    return note ? {...note,revision:revisionKey(JSON.stringify([note.note,note.updated]))} :
      {note:'',updated:null,revision:null};
  }
  function get(id) {
    const row = findEvent.get(id);
    if (!row) throw new Error('Report no longer available.');
    let report = withReportLocation(JSON.parse(row.data));
    const nwsId = nwsReportIdentifier(report);
    if (nwsId) {
      const updates = findNwsUpdates.all(report.ts,nwsId,report.ts).map(row=>JSON.parse(row.data));
      [report] = withNwsReplacements([report,...updates]);
    } else if (report.feed_id==='ea-floods' && report.ea_flood_area && report.ea_severity_changed) {
      const updates = findEaUpdates.all(report.ea_severity_changed,report.ea_flood_area,report.ea_severity_changed).map(row=>JSON.parse(row.data));
      [report] = withEaFloodTransitions([report,...updates]);
    }
    const tags = JSON.parse(findTags.get(id)?.data || '[]');
    const audit = history?.details(id,row.data);
    return {
      ...(audit ? outageFreshness(report,audit.last_seen) : report),
      history:audit, tags, display_tags:reportTags(report,tags),
      notes:getNote(id),
      saved_at:findSaved.get(id)?.saved_at ?? null
    };
  }
  return {
    get,
    save(id, note, expectedRevision) {
      if (!findEvent.get(id)) throw new Error('Report no longer available.');
      if (typeof note !== 'string' || note.length > 8000) throw new Error('Use a note of up to 8,000 characters.');
      if (expectedRevision !== undefined && expectedRevision !== getNote(id).revision) {
        throw Object.assign(new Error('A newer note was saved in another window.'),{status:409});
      }
      const updated = new Date().toISOString();
      db.prepare('INSERT INTO event_notes VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET note=excluded.note,updated=excluded.updated').run(id,note,updated);
      return getNote(id);
    },
    setSaved(id, saved) {
      if (typeof saved !== 'boolean') throw new Error('Choose whether to save this report.');
      if (!saved) {
        db.prepare('DELETE FROM saved_reports WHERE event_id=?').run(id);
        return { saved_at:null };
      }
      if (!findEvent.get(id)) throw new Error('Report no longer available.');
      const current = findSaved.get(id);
      if (current) return current;
      const savedAt = new Date().toISOString();
      db.prepare('INSERT INTO saved_reports(event_id,saved_at) VALUES(?,?)').run(id,savedAt);
      return { saved_at:savedAt };
    }
  };
}

export const REPORT_RETENTION_DAYS = 30;
export const reportCutoff = (now = Date.now()) => new Date(now - REPORT_RETENTION_DAYS * 86_400_000).toISOString();

export function ensureSavedReports(db) {
  db.exec('CREATE TABLE IF NOT EXISTS saved_reports(event_id TEXT PRIMARY KEY NOT NULL, saved_at TEXT NOT NULL)');
}

export function pruneReports(db, now = Date.now()) {
  return db.prepare('DELETE FROM events WHERE ts < ? AND id NOT IN (SELECT event_id FROM saved_reports)').run(reportCutoff(now));
}

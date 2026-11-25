const HOUR = 3_600_000;
const RETENTION = 7 * 24 * HOUR;

export function createPollHistory(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_polls (
      id INTEGER PRIMARY KEY, feed_id TEXT NOT NULL,
      completed INTEGER NOT NULL, duration INTEGER NOT NULL,
      success INTEGER NOT NULL, reports INTEGER, added INTEGER, revised INTEGER, error TEXT, unchanged INTEGER
    );
    CREATE INDEX IF NOT EXISTS feed_poll_range ON feed_polls(feed_id, completed DESC);
    CREATE INDEX IF NOT EXISTS feed_poll_retention ON feed_polls(completed);
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(feed_polls)').all().map(column=>column.name));
  for (const [name,type] of [['added','INTEGER'],['revised','INTEGER'],['error','TEXT'],['unchanged','INTEGER']]) {
    if (!columns.has(name)) db.exec('ALTER TABLE feed_polls ADD COLUMN ' + name + ' ' + type);
  }
  const insert = db.prepare('INSERT INTO feed_polls(feed_id,completed,duration,success,reports,added,revised,error,unchanged) VALUES (?,?,?,?,?,?,?,?,?)');
  const totals = db.prepare(`
    SELECT count(*) AS attempts, coalesce(sum(success), 0) AS succeeded
    FROM feed_polls WHERE feed_id = ? AND completed >= ? AND completed <= ?
  `);
  const list = db.prepare(`
    SELECT completed, duration, success, reports, added, revised, error, unchanged FROM feed_polls
    WHERE feed_id = ? AND completed >= ? AND completed <= ?
    ORDER BY completed DESC, id DESC LIMIT 20
  `);
  const prune = db.prepare('DELETE FROM feed_polls WHERE completed < ?');
  return {
    record(feedId, started, success, reports = null, now = Date.now(), detail = {}) {
      insert.run(feedId,now,Math.max(0,now-started),Number(success),success ? reports : null,
        success ? detail.added ?? null : null,success ? detail.revised ?? null : null,
        !success && typeof detail.error === 'string' ? detail.error.slice(0,200) : null,
        success && detail.unchanged ? 1 : 0);
    },
    history(feedId, hours = 24, now = Date.now()) {
      const since = now - ([24, 168].includes(hours) ? hours : 24) * HOUR;
      const { attempts, succeeded } = totals.get(feedId, since, now);
      const recent = list.all(feedId, since, now).map(row => ({
        completed: new Date(row.completed).toISOString(), duration_ms: row.duration,
        success:Boolean(row.success), reports:row.reports, added:row.added, revised:row.revised, error:row.error, unchanged:Boolean(row.unchanged)
      }));
      return { since: new Date(since).toISOString(), until: new Date(now).toISOString(),
        attempts, succeeded, failed: attempts - succeeded, recent };
    },
    prune(now = Date.now()) { prune.run(now - RETENTION); }
  };
}

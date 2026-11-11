import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackups } from '../lib/backup.mjs';

test('daily backup writes one readable copy per UTC day and keeps the newest seven', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'capstone-backup-'));
  const db = new DatabaseSync(path.join(dir, 'events.sqlite'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE events (id TEXT PRIMARY KEY, ts TEXT, data TEXT); INSERT INTO events VALUES ('a','2026-11-04','{}')");
  const backups = path.join(dir, 'backups');
  let day = Date.parse('2026-10-20T12:00:00Z');
  const b = createBackups(db, backups, { now: () => day });
  for (let i = 0; i < 9; i++) { assert.ok(b.daily(), 'writes a copy on a new day'); day += 86400000; }
  day -= 86400000;
  assert.equal(b.daily(), null, 'a second run on the same day writes nothing');
  const files = readdirSync(backups);
  assert.equal(files.length, 7);
  assert.equal(files.at(-1), 'events-2026-10-28.sqlite');
  assert.equal(files[0], 'events-2026-10-22.sqlite');
  const copy = new DatabaseSync(path.join(backups, files.at(-1)), { readOnly: true });
  assert.equal(copy.prepare('SELECT count(*) n FROM events').get().n, 1);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  copy.close();
});

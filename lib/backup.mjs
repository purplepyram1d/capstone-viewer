import { readdirSync, renameSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
// Daily copies of the live database, written through the server's own connection (VACUUM INTO makes a consistent,
// compacted copy without stopping writes for long). Never copy or rewrite events.sqlite from another process: an
// external rewrite on 2026-11-04 corrupted it, and only a backup taken minutes earlier saved the data.
const NAME = /^events-(\d{4}-\d{2}-\d{2})\.sqlite$/;
export function createBackups(db, dir, { keep = 7, now = () => Date.now() } = {}) {
  const list = () => { try { return readdirSync(dir).filter(f => NAME.test(f)).sort(); } catch { return []; } };
  return {
    list,
    // Writes today's copy (UTC date) if it does not exist yet, then keeps the newest `keep`. Returns the path written, or null.
    daily() {
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `events-${new Date(now()).toISOString().slice(0, 10)}.sqlite`), tmp = file + '.tmp';
      let written = null;
      if (!existsSync(file)) {
        rmSync(tmp, { force: true });
        try { db.prepare('VACUUM INTO ?').run(tmp); renameSync(tmp, file); written = file; }
        catch (error) { rmSync(tmp, { force: true }); throw error; }
      }
      for (const old of list().slice(0, -keep)) rmSync(path.join(dir, old), { force: true });
      return written;
    }
  };
}

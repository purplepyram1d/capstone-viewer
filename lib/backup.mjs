import { randomUUID } from 'node:crypto';
import { readdirSync, renameSync, rmSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

// VACUUM INTO makes a consistent copy from the collector's live connection.
const DAILY = /^events-\d{4}-\d{2}-\d{2}\.sqlite$/;
const MANUAL = /^capstone-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}\.sqlite$/;

export function createBackups(db, dir, {keep = 7, now = () => Date.now()} = {}) {
  const folder = path.resolve(dir);
  const listFiles = pattern => {
    try {
      return readdirSync(folder,{withFileTypes:true}).filter(file=>file.isFile() && pattern.test(file.name)).map(file=>file.name).sort();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const list = () => listFiles(DAILY);
  const vacuum = db.prepare('VACUUM INTO ?');
  function write(file) {
    mkdirSync(folder,{recursive:true});
    const target = path.join(folder,file);
    const tmp = target + '.tmp';
    rmSync(tmp,{force:true});
    try {
      vacuum.run(tmp);
      renameSync(tmp,target);
      return target;
    } catch (error) {
      rmSync(tmp,{force:true});
      throw error;
    }
  }
  function info(file) {
    if (!file) return null;
    const status = statSync(path.join(folder,file),{throwIfNoEntry:false});
    return status ? {name:file,created:status.mtime.toISOString(),bytes:status.size} : null;
  }
  return {
    list,
    daily() {
      const file = 'events-' + new Date(now()).toISOString().slice(0,10) + '.sqlite';
      const written = existsSync(path.join(folder,file)) ? null : write(file);
      for (const old of list().slice(0,-keep)) rmSync(path.join(folder,old),{force:true});
      return written;
    },
    manual() {
      const stamp = new Date(now()).toISOString().replace(/[:.]/g,'-');
      const file = 'capstone-' + stamp + '-' + randomUUID().slice(0,8) + '.sqlite';
      write(file);
      return info(file);
    },
    status() {
      const daily = list();
      const manual = listFiles(MANUAL);
      return {folder, latestDaily:info(daily.at(-1)), latestManual:info(manual.at(-1)), dailyCount:daily.length, manualCount:manual.length};
    }
  };
}

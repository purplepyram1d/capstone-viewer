import {reportTags} from './report-tags.mjs';
export function createReports(db){
 db.exec('CREATE TABLE IF NOT EXISTS event_notes(event_id TEXT PRIMARY KEY,note TEXT NOT NULL,updated TEXT NOT NULL)');
 const get=id=>{const row=db.prepare('SELECT data FROM events WHERE id=?').get(id);if(!row)throw new Error('Report no longer available.');const report=JSON.parse(row.data),tags=JSON.parse(db.prepare('SELECT data FROM event_tags WHERE event_id=?').get(id)?.data||'[]');return {...report,tags,display_tags:reportTags(report,tags),notes:db.prepare('SELECT note,updated FROM event_notes WHERE event_id=?').get(id)||{note:'',updated:null}};};
 return {get,save(id,note){get(id);if(typeof note!=='string'||note.length>8000)throw new Error('Use a note of up to 8,000 characters.');const updated=new Date().toISOString();db.prepare('INSERT INTO event_notes VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET note=excluded.note,updated=excluded.updated').run(id,note,updated);return {note,updated};}};
}

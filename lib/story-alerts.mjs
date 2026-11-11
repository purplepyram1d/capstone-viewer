import {text} from './events.mjs';
export function meaningfulStoryChange(c){return c.kind==='report_added'||c.kind==='report_updated'&&c.changed_fields?.some(f=>['title','summary','confidence','kind','ongoing','cves','country'].includes(f));}

// Durable local history. Each process starts at the current observation ID, never replaying backfill.
export function createStoryAlerts(db,{now=()=>Date.now()}={}){
 db.exec('CREATE TABLE IF NOT EXISTS story_alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,thread_id TEXT NOT NULL,observed TEXT NOT NULL,data TEXT NOT NULL,read_at TEXT); CREATE INDEX IF NOT EXISTS story_alert_thread ON story_alerts(thread_id,id);');
 let cursor=db.prepare('SELECT max(id) AS id FROM developing_changes').get().id||0;
 const list=()=>db.prepare('SELECT * FROM story_alerts ORDER BY id DESC LIMIT 100').all().map(r=>({...JSON.parse(r.data),id:r.id,thread_id:r.thread_id,observed:r.observed,read_at:r.read_at}));
 return {
  list,
  active(){const follows=new Map();return list().filter(a=>{if(!follows.has(a.thread_id)){const t=db.prepare('SELECT data FROM developing_threads WHERE id=?').get(a.thread_id),f=db.prepare("SELECT id FROM developing_changes WHERE thread_id=? AND kind='follow' ORDER BY id DESC LIMIT 1").get(a.thread_id);follows.set(a.thread_id,t&&JSON.parse(t.data).followed?f?.id:null);}return follows.get(a.thread_id)===a.follow_id;});},
  collect(){
   const changes=db.prepare('SELECT * FROM developing_changes WHERE id>? ORDER BY id').all(cursor),groups=new Map();
   for(const row of changes){
    const c={...JSON.parse(row.data),kind:row.kind};if(!meaningfulStoryChange(c))continue;
    const threadRow=db.prepare('SELECT data FROM developing_threads WHERE id=?').get(row.thread_id);if(!threadRow)continue;const t=JSON.parse(threadRow.data);if(!t.followed)continue;
    // Following establishes a new boundary, including when a user refollows an old thread.
    const follow=db.prepare("SELECT id,data FROM developing_changes WHERE thread_id=? AND kind='follow' ORDER BY id DESC LIMIT 1").get(t.id);
    if(!follow||follow.id>=row.id||JSON.parse(follow.data).text!=='You followed this thread')continue;
    let group=groups.get(t.id);if(!group){group={title:text(t.title).slice(0,250),follow_id:follow.id,changes:[],recovery:false,escalation:false,path:'/developing?id='+encodeURIComponent(t.id)};groups.set(t.id,group);}
    const reportRow=db.prepare('SELECT data FROM developing_reports WHERE thread_id=? AND report_id=?').get(t.id,c.report_id),r=reportRow?JSON.parse(reportRow.data):{};
    const recovery=c.kind==='report_updated'&&c.changed_fields?.includes('ongoing')&&c.report_kind==='outage'&&c.ongoing===false;
    const escalation=c.kind==='report_updated'&&c.changed_fields?.includes('ongoing')&&c.report_kind==='outage'&&c.ongoing===true;
    group.recovery ||= recovery;
    group.escalation ||= escalation;
    group.changes.push({report_id:c.report_id,title:text(c.title).slice(0,250),summary:text(c.summary??r.summary).slice(0,500),source:text(c.source).slice(0,100),evidence:c.evidence||r.evidence||'Reported coverage',url:c.url||r.url,published:c.published,observed:row.observed,fields:c.changed_fields||[],reason:recovery?'Source reports this outage ended':escalation?'Source reports renewed disruption':c.kind==='report_added'?'New report entered the followed thread':'Source changed: '+c.changed_fields.filter(f=>['title','summary','confidence','kind','ongoing','cves','country'].includes(f)).join(', ')});
   }
   db.exec('BEGIN');try{
    for(const [id,group] of groups)db.prepare('INSERT INTO story_alerts(thread_id,observed,data) VALUES(?,?,?)').run(id,new Date(now()).toISOString(),JSON.stringify(group));
    db.prepare('DELETE FROM story_alerts WHERE observed<?').run(new Date(now()-30*86400000).toISOString());
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   if(changes.length)cursor=changes.at(-1).id;
   return list();
  },
  read(id){if(id==='all')db.prepare('UPDATE story_alerts SET read_at=? WHERE read_at IS NULL').run(new Date(now()).toISOString());else {if(!/^\d+$/.test(String(id)))throw new Error('Invalid story alert.');db.prepare('UPDATE story_alerts SET read_at=? WHERE id=?').run(new Date(now()).toISOString(),Number(id));}return list();}
 };
}

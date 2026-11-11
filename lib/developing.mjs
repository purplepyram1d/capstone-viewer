import {createHash} from 'node:crypto';
const DAY=86400000;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
export function evidenceClass(e){
 if(e.feed_id==='gdelt'||/machine.coded/i.test(e.confidence||''))return 'Machine-coded signal';
 if(['claim','ransomware'].includes(e.kind)||/unconfirmed|unverified/i.test(e.confidence||''))return 'Claim / unverified';
 if(['outage','routing','earthquake'].includes(e.kind))return 'Source measurement';
 if(['kev','cisa','nvd'].includes(e.feed_id)||/official (advisory|catalog|measurement)/i.test(e.confidence||''))return 'Official advisory';
 if(/company announcement|official.*statement/i.test(e.confidence||''))return 'Attributed statement';
 return 'Reported coverage';
}
export function createDeveloping(db,{lookupReports=()=>[]}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS developing_threads(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS developing_reports(thread_id TEXT NOT NULL,report_id TEXT NOT NULL,data TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(thread_id,report_id));
 CREATE TABLE IF NOT EXISTS developing_changes(id INTEGER PRIMARY KEY,thread_id TEXT NOT NULL,observed TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);`);
 const put=db.prepare('INSERT INTO developing_threads VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
 const change=(id,kind,data,now)=>db.prepare('INSERT INTO developing_changes(thread_id,observed,kind,data) VALUES(?,?,?,?)').run(id,now,kind,JSON.stringify(data));
 const get=id=>{const row=db.prepare('SELECT data FROM developing_threads WHERE id=?').get(id);if(!row)throw new Error('Developing story not found.');return JSON.parse(row.data);};
 function sync(stories,reports,{now=Date.now(),only=null}={}){
  const stamp=new Date(now).toISOString(),byId=new Map(reports.map(r=>[r.id,r]));
  const threads=db.prepare('SELECT data FROM developing_threads').all().map(r=>JSON.parse(r.data));
  const missing=[...new Set(threads.flatMap(t=>t.report_ids).filter(id=>!byId.has(id)))];for(const report of lookupReports(missing))byId.set(report.id,report);
  const rank=s=>(s.watch_matches?.length?200:0)+(s.ongoing?100:0)+(s.score||0)+(s.report_count>1?20:0);
  let candidates=only?stories.filter(s=>s.id===only):stories.filter(s=>!s.tracker&&s.kind!=='earthquake'&&(s.ongoing||Date.parse(s.ts)>=now-48*3600000)&&((s.score||0)>=70||s.report_count>1||s.ongoing||s.kind==='conflict'||s.watch_matches?.length)).sort((a,b)=>rank(b)-rank(a)||b.ts.localeCompare(a.ts));
  if(!only){const ranked=candidates,chosen=[];for(const family of ['cyber','outage','geo','ai'])chosen.push(...ranked.filter(s=>(s.kind==='outage'?'outage':s.category)===family).slice(0,3));for(const s of ranked)if(chosen.length<12&&!chosen.includes(s))chosen.push(s);candidates=chosen.slice(0,12);}
  for(const t of threads.filter(t=>t.followed)){const s=stories.find(s=>s.id===t.story_id||(s.report_ids||[s.id]).some(id=>t.report_ids.includes(id)));if(s&&!candidates.includes(s))candidates.push(s);}
  // A source may mark an older outage ended after it falls out of the Operations working window.
  // Check retained report IDs directly; absence still says nothing about recovery.
  for(const t of threads){if(candidates.some(s=>s.id===t.story_id||(s.report_ids||[s.id]).some(id=>t.report_ids.includes(id))))continue;const retained=t.report_ids.map(id=>byId.get(id)).filter(Boolean);if(retained.length){const latest=retained.slice().sort((a,b)=>b.ts.localeCompare(a.ts))[0];candidates.push({...latest,id:t.story_id,title:latest.title,report_ids:retained.map(r=>r.id),score:t.score||0,category:t.category});}}
  const present=new Set();
  db.exec('BEGIN');try{for(const story of candidates){const ids=story.report_ids||[story.id];let thread=threads.find(t=>t.story_id===story.id)||threads.find(t=>t.report_ids.some(id=>ids.includes(id)));
   if(!thread){thread={id:'dev-'+hash(ids.slice().sort()),story_id:story.id,title:story.title,state:'watching',followed:false,created:stamp,last_observed:stamp,last_changed:stamp,report_ids:[],category:story.category};threads.push(thread);change(thread.id,'baseline',{text:'Tracking began. Earlier publication dates are source dates, not observations made by this app.'},stamp);}
   if(present.has(thread.id))continue;present.add(thread.id);let changed=false;
   for(const id of ids){const source=byId.get(id);if(!source)continue;const report={id:source.id,title:source.title,summary:source.summary||'',url:source.url,source:source.source,source_id:source.source_id,platform:source.platform,ts:source.ts,date_precision:source.date_precision,confidence:source.confidence||'',kind:source.kind,ongoing:source.ongoing,evidence:evidenceClass(source),cves:source.cves||[],country:source.country||null};const {evidence,...sourceRecord}=report;const fingerprint=hash(sourceRecord),old=db.prepare('SELECT fingerprint,data FROM developing_reports WHERE thread_id=? AND report_id=?').get(thread.id,id);
    if(old?.fingerprint!==fingerprint){db.prepare('INSERT INTO developing_reports VALUES(?,?,?,?) ON CONFLICT(thread_id,report_id) DO UPDATE SET data=excluded.data,fingerprint=excluded.fingerprint').run(thread.id,id,JSON.stringify(report),fingerprint);change(thread.id,old?'report_updated':'report_added',{report_id:id,title:report.title,summary:report.summary,source:report.source,url:report.url,report_kind:report.kind,ongoing:report.ongoing,published:report.ts,date_precision:report.date_precision,evidence:report.evidence,changed_fields:old?Object.keys(sourceRecord).filter(key=>JSON.stringify(JSON.parse(old.data)[key])!==JSON.stringify(sourceRecord[key])):[],text:old?'Source report changed: '+Object.keys(sourceRecord).filter(key=>JSON.stringify(JSON.parse(old.data)[key])!==JSON.stringify(sourceRecord[key])).join(', '):'Report entered this thread'},stamp);changed=true;}else{db.prepare('UPDATE developing_reports SET data=? WHERE thread_id=? AND report_id=?').run(JSON.stringify(report),thread.id,id);}
   }
   thread={...thread,story_id:story.id,title:story.title,category:story.category,family:story.kind==='outage'?'outage':story.category,score:story.score||0,place:story.place,report_ids:[...new Set([...thread.report_ids,...ids])],last_observed:stamp,last_changed:changed?stamp:thread.last_changed};
   const current=ids.map(id=>byId.get(id)).filter(Boolean);thread.source_condition=current.some(r=>r.kind==='outage'&&r.ongoing===true)?'Outage ongoing in source':current.length&&current.every(r=>r.kind==='outage'&&r.ongoing===false)?'Outage ended in source':current.some(r=>evidenceClass(r)==='Machine-coded signal')?'Machine-coded coverage; verify events':current.some(r=>evidenceClass(r)==='Official advisory')?'Advisory issued; local impact unknown':current.some(r=>evidenceClass(r)==='Claim / unverified')?'Unconfirmed claim; impact not established':'Reported development; outcome unknown';
   put.run(thread.id,JSON.stringify(thread));
  }db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 }
 function list(){return db.prepare('SELECT data FROM developing_threads').all().map(r=>JSON.parse(r.data)).filter(t=>Date.parse(t.last_observed)>=Date.now()-30*DAY||t.followed).map(t=>{const reports=db.prepare('SELECT data FROM developing_reports WHERE thread_id=?').all(t.id).map(r=>JSON.parse(r.data));return {...t,report_count:reports.length,evidence:[...new Set(reports.map(r=>r.evidence))],source_count:new Set(reports.map(r=>{try{return r.platform?r.source_id||r.source:new URL(r.url).hostname.replace(/^www\./,'');}catch{return r.source;}})).size};}).sort((a,b)=>Number(b.followed)-Number(a.followed)||b.last_changed.localeCompare(a.last_changed));}
 return {sync,list,
  observations(since){return list().map(t=>({...t,reports:db.prepare('SELECT data FROM developing_reports WHERE thread_id=?').all(t.id).map(r=>JSON.parse(r.data)),changes:db.prepare('SELECT observed,kind,data FROM developing_changes WHERE thread_id=? AND observed>? ORDER BY id DESC').all(t.id,since).map(r=>({...JSON.parse(r.data),observed:r.observed,kind:r.kind}))}));},
  detail(id){const thread=get(id);return {...thread,reports:db.prepare('SELECT data FROM developing_reports WHERE thread_id=?').all(id).map(r=>JSON.parse(r.data)).sort((a,b)=>a.ts.localeCompare(b.ts)),changes:db.prepare('SELECT observed,kind,data FROM developing_changes WHERE thread_id=? ORDER BY id DESC LIMIT 80').all(id).map(r=>({...JSON.parse(r.data),observed:r.observed,kind:r.kind}))};},
  update(id,body){const thread=get(id);if(!body||typeof body!=='object')throw new Error('Expected an update.');if(body.state!==undefined&&!['watching','developing','recovering','resolved'].includes(body.state))throw new Error('Choose a valid analyst status.');if(body.followed!==undefined&&typeof body.followed!=='boolean')throw new Error('Follow must be true or false.');if(body.note!==undefined&&(typeof body.note!=='string'||!body.note.trim()||body.note.length>2000))throw new Error('Use a note of 1 to 2,000 characters.');db.exec('BEGIN');try{const now=new Date().toISOString();if(body.state!==undefined){if(!['watching','developing','recovering','resolved'].includes(body.state))throw new Error('Choose a valid analyst status.');if(body.state!==thread.state){change(id,'analyst_status',{text:`Analyst status: ${thread.state} to ${body.state}`},now);thread.state=body.state;thread.last_changed=now;}}
   if(body.followed!==undefined){if(typeof body.followed!=='boolean')throw new Error('Follow must be true or false.');if(body.followed!==thread.followed){change(id,'follow',{text:body.followed?'You followed this thread':'You stopped following this thread'},now);thread.followed=body.followed;}}
   if(body.note!==undefined){if(typeof body.note!=='string'||!body.note.trim()||body.note.length>2000)throw new Error('Use a note of 1 to 2,000 characters.');change(id,'analyst_note',{text:body.note.trim()},now);thread.last_changed=now;}
   put.run(id,JSON.stringify(thread));db.exec('COMMIT');return thread;}catch(error){db.exec('ROLLBACK');throw error;}
  },
  follow(storyId,stories,reports){if(!stories.some(s=>s.id===storyId))throw new Error('Story is no longer in the current working window.');sync(stories,reports,{only:storyId});const t=list().find(t=>t.story_id===storyId);if(!t)throw new Error('Could not start thread.');return this.update(t.id,{followed:true});}
 };
}

import {createReading,sourceRoles,sourceContext,sourceKey,muted,coverageKey} from './reading.mjs';
export function createTimeline(db,reading=createReading(db)) {
  db.exec('CREATE TABLE IF NOT EXISTS event_tags (event_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS event_annotations(event_id TEXT PRIMARY KEY,location TEXT,separate INTEGER NOT NULL DEFAULT 0)');
  const cutoff=()=>new Date(Date.now()-30*86400000).toISOString();
  let muteState=reading.state();
  db.function('reading_role',s=>sourceContext(JSON.parse(s)).role);
  db.function('reading_visible',(s,t)=>muted(JSON.parse(s),JSON.parse(t||'[]'),muteState)?0:1);
  db.function('reading_group',s=>coverageKey(JSON.parse(s)));
  return {
    tags(id,tags) {
      if(!db.prepare('SELECT id FROM events WHERE id=?').get(id))throw new Error('Report not found.');
      if(!Array.isArray(tags)||tags.length>40)throw new Error('Use up to 40 tags per event.');
      const next=[],seen=new Set();
      for(const tag of tags){if(!tag||!['country','subject','person','custom'].includes(tag.type)||typeof tag.label!=='string'||!tag.label.trim()||tag.label.trim().length>80)throw new Error('Each tag needs a type and a label of 1–80 characters.');const item={type:tag.type,label:tag.label.trim()},key=item.type+':'+item.label.toLowerCase();if(!seen.has(key)){seen.add(key);next.push(item);}}
      db.prepare('INSERT INTO event_tags VALUES (?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(next));return {tags:next};
    },
    list(params=new URLSearchParams()) {
      muteState=reading.state();
      const where=['e.ts>=?'],args=[cutoff()];
      const category=params.get('category');if(['cyber','geo','ai'].includes(category)){where.push("json_extract(e.data,'$.category')=?");args.push(category);}
      const source=params.get('source');if(source){where.push("json_extract(e.data,'$.source')=?");args.push(source);}
      const q=params.get('q')?.trim();if(q){where.push("instr(lower(e.data||coalesce(t.data,'')),lower(?))>0");args.push(q.slice(0,250));}
      const tag=params.get('tag');if(tag){where.push("EXISTS(SELECT 1 FROM json_each(coalesce(t.data,'[]')) j WHERE lower(json_extract(j.value,'$.type')||':'||json_extract(j.value,'$.label'))=lower(?))");args.push(tag);}
      const days=Number(params.get('days'));if([1,7].includes(days)){where.push('e.ts>=?');args.push(new Date(Date.now()-days*86400000).toISOString());}
      const role=params.get('role');if(sourceRoles.includes(role)){where.push('reading_role(e.data)=?');args.push(role);}
      const unmuted=where.slice();if(params.get('includeMuted')!=='1')where.push("reading_visible(e.data,t.data)=1");
      const from=' FROM events e LEFT JOIN event_tags t ON t.event_id=e.id LEFT JOIN event_annotations a ON a.event_id=e.id WHERE '+where.join(' AND ');
      const reportTotal=db.prepare('SELECT count(*) n'+from).get(...args).n,grouped=params.get('view')==='grouped';
      const cte="WITH filtered AS (SELECT e.id,e.ts,e.data,t.data tags,CASE WHEN a.separate=1 THEN 'report:'||e.id ELSE reading_group(e.data) END g"+from+'), ranked AS (SELECT *,row_number() OVER(PARTITION BY g ORDER BY ts DESC,id DESC) rn,count(*) OVER(PARTITION BY g) copies FROM filtered) ';
      const total=grouped?db.prepare(cte+'SELECT count(*) n FROM ranked WHERE rn=1').get(...args).n:reportTotal;
      const offset=Math.min(Math.max(0,Math.floor(Number(params.get('offset'))||0)),Math.max(0,Math.floor((total-1)/100)*100));
      const order=params.get('order')==='oldest'?'ASC':'DESC';
      const rows=grouped?db.prepare(cte+`SELECT * FROM ranked WHERE rn=1 ORDER BY ts ${order},id ${order} LIMIT 100 OFFSET ?`).all(...args,offset):db.prepare('SELECT e.data, t.data tags'+from+` ORDER BY e.ts ${order},e.id ${order} LIMIT 100 OFFSET ?`).all(...args,offset);
      const decorate=r=>{const e=JSON.parse(r.data),tags=JSON.parse(r.tags||'[]');return {...e,tags,source_context:sourceContext(e),source_key:sourceKey(e),muted:muted(e,tags,muteState)};};
      const events=rows.map(r=>{const e=decorate(r);if(grouped){e.coverage_count=r.copies;e.coverage_basis=r.copies>1?(r.g.startsWith('link:')?'Shared source link; content may differ':'Repeated title and text'):'Distinct report text; evidence not assessed';e.coverage_reports=r.copies>1?db.prepare(cte+'SELECT data,tags FROM filtered WHERE g=? ORDER BY ts DESC,id DESC').all(...args,r.g).map(decorate):[];}return e;});
      const sources=db.prepare("SELECT DISTINCT json_extract(data,'$.source') source FROM events WHERE ts>=? ORDER BY source").all(cutoff()).map(r=>r.source).filter(Boolean);
      const tags=db.prepare("SELECT DISTINCT json_extract(j.value,'$.type') type,json_extract(j.value,'$.label') label FROM event_tags t JOIN events e ON e.id=t.event_id,json_each(t.data) j WHERE e.ts>=? ORDER BY type,label").all(cutoff());
      const hidden=db.prepare('SELECT count(*) n FROM events e LEFT JOIN event_tags t ON t.event_id=e.id WHERE '+unmuted.join(' AND ')+" AND reading_visible(e.data,t.data)=0").get(...args).n;
      return {events,total,reportTotal,hidden,grouped,offset,pageSize:100,sources,tags,reading:muteState};
    }
  };
}

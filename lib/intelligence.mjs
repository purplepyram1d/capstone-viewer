import {reportTags,mergeTags} from './report-tags.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { text } from './events.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
const folded=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const termMatchers=new Map();
function termMatcher(term){if(!termMatchers.has(term)){if(termMatchers.size>2000)termMatchers.clear();termMatchers.set(term,new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,'u'));}return termMatchers.get(term);}
export function validateRule(input,previous={}){
  const name=text(input.name??previous.name).slice(0,100),raw=input.terms??previous.terms;
  if(!name)throw new Error('Give the watchlist a name.');
  if(!Array.isArray(raw)||raw.length>20||raw.some(t=>typeof t!=='string'||t.length>100))throw new Error('Use 1–20 literal keywords or phrases, up to 100 characters each.');
  const terms=[...new Set(raw.map(folded).filter(Boolean))];if(!terms.length)throw new Error('Add at least one keyword, CVE, company or place.');
  const mode=input.mode??previous.mode??'any',category=input.category??previous.category??'all',platform=input.platform??previous.platform??'all',enabled=input.enabled??previous.enabled??true;
  if(!['any','all'].includes(mode)||!['all','cyber','geo','ai'].includes(category)||!['all','core','telegram','x','bluesky','mastodon'].includes(platform)||typeof enabled!=='boolean')throw new Error('Invalid watchlist filter.');
  return {id:previous.id||randomUUID(),name,terms,mode,category,platform,enabled,created:previous.created||new Date().toISOString()};
}
export function matchingTerms(rule,event){
  if(!rule.enabled||(rule.category!=='all'&&event.category!==rule.category)||(rule.platform!=='all'&&!(rule.platform==='core'?!event.platform:rule.platform===event.platform)))return [];
  const haystack=folded([event.title,event.summary,event.place,event.source,...(event.cves||[])].join(' '));
  const terms=rule.terms.filter(term=>termMatcher(term).test(haystack));
  return terms.length&&(rule.mode==='any'||terms.length===rule.terms.length)?terms:[];
}
export function validateLocation(input){
  if(typeof input.lat!=='number'||typeof input.lon!=='number'||!Number.isFinite(input.lat)||!Number.isFinite(input.lon)||Math.abs(input.lat)>90||Math.abs(input.lon)>180)throw new Error('Latitude must be −90…90 and longitude −180…180.');
  const place=text(input.place).slice(0,120);if(!place)throw new Error('Name the location you are assigning.');
  return {lat:input.lat,lon:input.lon,place,note:text(input.note).slice(0,300),updated:new Date().toISOString()};
}
function canonicalUrl(value){try{const url=new URL(value);if(url.pathname==='/'||!['http:','https:'].includes(url.protocol))return null;url.hostname=url.hostname.replace(/^www\./,'');url.pathname=url.pathname.replace(/\/+$/,'');url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid'].includes(key))url.searchParams.delete(key);url.searchParams.sort();return url.href;}catch{return null;}}

// Conservative grouping: explicit links, one shared CVE, or the same substantial headline/day.
// Shared subjects/source counts are not evidence that reports independently corroborate each other.
export function buildStories(events,links=[],separateIds=new Set()){
  const parent=new Map(events.map(e=>[e.id,e.id])),reasons=new Map(),keys=new Map();
  const find=id=>{let root=id;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next;}return root;};
  const union=(a,b,reason)=>{if(!parent.has(a)||!parent.has(b))return;const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra);for(const id of [a,b]){if(!reasons.has(id))reasons.set(id,new Set());reasons.get(id).add(reason);}};
  for(const e of events){
    if(separateIds.has(e.id))continue;
    const candidates=[],url=canonicalUrl(e.url);if(url)candidates.push(['url:'+url,'Same source link']);
    if(e.cves?.length===1)candidates.push([`cve:${e.category}:${e.cves[0].toUpperCase()}`,'Shared CVE']);
    // IODA reports one outage per measured signal (BGP, probing, traffic); ongoing ones for a country are one story.
    if(e.kind==='outage'&&/^[A-Z]{2}$/.test(e.country||''))candidates.push([`outage:${e.country}:${e.ongoing?'ongoing':e.ts.slice(0,10)}`,e.ongoing?'Same country, outage ongoing':'Same country outage, same day']);
    const title=folded(e.title).replace(/[^\p{L}\p{N}]+/gu,' ').trim();if(title.length>=35)candidates.push([`title:${e.category}:${e.ts.slice(0,10)}:${title}`,'Matching headline and date']);
    for(const [key,reason] of candidates){if(keys.has(key))union(keys.get(key),e.id,reason);else keys.set(key,e.id);}
  }
  for(const link of links)if(!separateIds.has(link.a)&&!separateIds.has(link.b))union(link.a,link.b,'Manually grouped');
  const groups=new Map();for(const e of events){const root=find(e.id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(e);}
  return [...groups.values()].map(reports=>{
    reports.sort((a,b)=>b.score-a.score||Date.parse(b.ts)-Date.parse(a.ts)||a.id.localeCompare(b.id));
    const representative=reports[0],newest=[...reports].sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)||a.id.localeCompare(b.id))[0];
    const cves=[...new Set(reports.flatMap(e=>e.cves||[]))].sort();
    const basis=[...new Set(reports.flatMap(e=>[...(reasons.get(e.id)||[])]))];
    const sharedCve=cves.length===1&&reports.every(e=>e.cves?.length===1&&e.cves[0]===cves[0])&&!separateIds.has(representative.id);
    const storyKey=sharedCve?'cve:'+representative.category+':'+cves[0]:reports.map(e=>e.id).sort()[0];
    const placement=reports.filter(e=>e.manual_location).sort((a,b)=>b.manual_location.updated.localeCompare(a.manual_location.updated))[0]||representative;
    const origins=new Set(reports.map(e=>{try{return e.platform?e.source_id||e.source:new URL(e.url).hostname.replace(/^www\./,'');}catch{return e.source;}}));
    return {...representative,id:'story-'+hash(storyKey),representative_id:representative.id,report_ids:reports.map(e=>e.id),
      ts:newest.ts,date_precision:newest.date_precision,first_ts:reports.reduce((min,e)=>e.ts<min?e.ts:min,newest.ts),
      lat:placement.lat,lon:placement.lon,place:placement.place,place_basis:placement.place_basis,location_note:placement.location_note,manual_location:placement.manual_location,
      display_tags:mergeTags(reports.flatMap(r=>r.display_tags||[])),report_count:reports.length,source_count:origins.size,group_basis:reports.length>1?basis:[],cves,
      watch_matches:[...new Set(reports.flatMap(e=>e.watch_matches||[]))],
      revision:hash(reports.map(e=>e.id+e.ts+e.title+JSON.stringify(e.manual_location||null)).sort().join('|')),
      reports:reports.map(e=>({id:e.id,title:e.title,url:e.url,source:e.source,source_id:e.source_id,platform:e.platform,category:e.category,ts:e.ts,date_precision:e.date_precision,confidence:e.confidence,summary:e.summary,tags:e.tags||[],display_tags:e.display_tags||[],separate:e.separate,manual_location:e.manual_location||null}))};
  }).sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)||a.id.localeCompare(b.id));
}

export function createIntelligence(db){
  db.exec(`CREATE TABLE IF NOT EXISTS watch_rules (id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS watch_alerts (id TEXT PRIMARY KEY,rule_id TEXT NOT NULL,event_id TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_annotations (event_id TEXT PRIMARY KEY,location TEXT,separate INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS event_tags(event_id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_links (a TEXT NOT NULL,b TEXT NOT NULL,PRIMARY KEY(a,b));`);
  const rules=()=>db.prepare('SELECT data FROM watch_rules ORDER BY id').all().map(r=>JSON.parse(r.data));
  const getEvent=id=>{if(typeof id!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(id))throw new Error('Choose a valid report.');const row=db.prepare('SELECT data FROM events WHERE id=?').get(id);if(!row)throw new Error('Report not found.');return JSON.parse(row.data);};
  function evaluate(events,backfill=false,onlyRule=null){
    const active=rules().filter(r=>r.enabled&&(!onlyRule||r.id===onlyRule)),created=new Date().toISOString();
    for(const e of events)for(const rule of active){const matched=matchingTerms(rule,e);if(!matched.length)continue;
      const id=hash(rule.id+':'+e.id),data={id,rule_id:rule.id,event_id:e.id,rule_name:rule.name,title:e.title,url:e.url,source:e.source,ts:e.ts,terms:matched,backfill};
      db.prepare('INSERT OR IGNORE INTO watch_alerts VALUES (?,?,?,?,NULL,?)').run(id,rule.id,e.id,created,JSON.stringify(data));
    }
  }
  return {
    evaluate,
    state(){const alerts=db.prepare("SELECT data,created,read_at FROM watch_alerts ORDER BY (read_at IS NULL) DESC,created DESC,json_extract(data,'$.ts') DESC,id DESC LIMIT 150").all().map(row=>({...JSON.parse(row.data),created:row.created,read_at:row.read_at}));return {rules:rules(),alerts,unread:db.prepare('SELECT COUNT(*) AS n FROM watch_alerts WHERE read_at IS NULL').get().n};},
    addRule(input){if(rules().length>=50)throw new Error('You can keep up to 50 watchlists.');const rule=validateRule(input);db.prepare('INSERT INTO watch_rules VALUES (?,?)').run(rule.id,JSON.stringify(rule));if(input.includeExisting!==false){const existing=db.prepare('SELECT data FROM events').all().map(row=>JSON.parse(row.data));evaluate(existing,true,rule.id);}return rule;},
    updateRule(id,input){const before=rules().find(r=>r.id===id);if(!before)throw new Error('Watchlist not found.');const rule=validateRule(input,before);db.prepare('UPDATE watch_rules SET data=? WHERE id=?').run(JSON.stringify(rule),id);if(input.includeExisting===true)evaluate(db.prepare('SELECT data FROM events').all().map(r=>JSON.parse(r.data)),true,rule.id);return rule;},
    removeRule(id){db.prepare('DELETE FROM watch_rules WHERE id=?').run(id);},
    markRead(id){db.prepare('UPDATE watch_alerts SET read_at=? WHERE id=?').run(new Date().toISOString(),id);},
    markAllRead(){db.prepare('UPDATE watch_alerts SET read_at=? WHERE read_at IS NULL').run(new Date().toISOString());},
    locate(id,input){getEvent(id);const location=validateLocation(input);db.prepare('INSERT INTO event_annotations (event_id,location) VALUES (?,?) ON CONFLICT(event_id) DO UPDATE SET location=excluded.location').run(id,JSON.stringify(location));return location;},
    clearLocation(id){getEvent(id);db.prepare('UPDATE event_annotations SET location=NULL WHERE event_id=?').run(id);},
    group(a,b){getEvent(a);getEvent(b);if(a===b)throw new Error('Choose a different report.');for(const id of [a,b])db.prepare('UPDATE event_annotations SET separate=0 WHERE event_id=?').run(id);db.prepare('INSERT OR IGNORE INTO story_links VALUES (?,?)').run(...[a,b].sort());},
    separate(id){getEvent(id);db.prepare('INSERT INTO event_annotations (event_id,separate) VALUES (?,1) ON CONFLICT(event_id) DO UPDATE SET separate=1').run(id);db.prepare('DELETE FROM story_links WHERE a=? OR b=?').run(id,id);},
    restoreGrouping(id){getEvent(id);db.prepare('UPDATE event_annotations SET separate=0 WHERE event_id=?').run(id);},
    decorate(events){
      const annotations=new Map(db.prepare('SELECT * FROM event_annotations').all().map(row=>[row.event_id,row])),active=rules();
      const tagMap=new Map(db.prepare('SELECT event_id,data FROM event_tags').all().map(r=>[r.event_id,JSON.parse(r.data)]));
      const reports=events.map(e=>{const tags=tagMap.get(e.id)||[],annotation=annotations.get(e.id),location=annotation?.location?JSON.parse(annotation.location):null;return {...e,tags,display_tags:reportTags(e,tags),watch_matches:active.filter(r=>matchingTerms(r,e).length).map(r=>r.name),
        ...(location?{lat:location.lat,lon:location.lon,place:location.place,place_basis:'manual',location_note:location.note||'Location manually assigned by you.',manual_location:location}:{}),separate:!!annotation?.separate};});
      return {events:reports,stories:buildStories(reports,db.prepare('SELECT * FROM story_links').all(),new Set([...annotations.values()].filter(a=>a.separate).map(a=>a.event_id)))};
    },
    prune(){db.exec('DELETE FROM watch_alerts WHERE event_id NOT IN (SELECT id FROM events); DELETE FROM event_annotations WHERE event_id NOT IN (SELECT id FROM events); DELETE FROM story_links WHERE a NOT IN (SELECT id FROM events) OR b NOT IN (SELECT id FROM events)');}
  };
}

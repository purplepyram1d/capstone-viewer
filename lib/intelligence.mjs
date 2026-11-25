import { caProvinces, isCAProvince } from './ca-geography.mjs';
import { countries, isCountryCode, withReportLocation } from './geography.mjs';
import { isUSState, statesForReport, usStates } from './us-geography.mjs';
import { reportCutoff } from './report-retention.mjs';
import '../assets/event-types.js';
import {reportTags,mergeTags} from './report-tags.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { text } from './events.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
const folded=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const termMatchers=new Map();
const { EVIDENCE_FILTERS, ORDER, matchesEvidence, latestReceipt, typeId, sourceReference, isNewsCodingAggregate } = globalThis.CapstoneTypes;
function termMatcher(term){if(!termMatchers.has(term)){if(termMatchers.size>2000)termMatchers.clear();termMatchers.set(term,new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,'u'));}return termMatchers.get(term);}
export function validateRule(input,previous={}){
  const name=text(input.name??previous.name).slice(0,100),raw=input.terms??previous.terms??[];
  if(!name)throw new Error('Give the watchlist a name.');
  if(!Array.isArray(raw)||raw.length>20||raw.some(t=>typeof t!=='string'||t.length>100))throw new Error('Use 1–20 literal keywords or phrases, up to 100 characters each.');
  const terms=[...new Set(raw.map(folded).filter(Boolean))];
  const mode=input.mode??previous.mode??'any',category=input.category??previous.category??'all',platform=input.platform??previous.platform??'all',enabled=input.enabled??previous.enabled??true;
  const collector = input.collector ?? previous.collector ?? '';
  if (typeof collector!=='string' || (collector && !/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(collector))) throw new Error('Choose a valid collector.');
  const evidenceFilter = input.evidence ?? previous.evidence ?? '';
  const typeFilter = input.reportType ?? previous.reportType ?? '';
  const state = input.state ?? previous.state ?? '';
  const country = input.country ?? previous.country ?? '';
  const province = input.province ?? previous.province ?? '';
  if (typeof state !== 'string' || (state && state!=='US' && !isUSState(state))) throw new Error('Choose a valid U.S. state or territory.');
  if (typeof country !== 'string' || (country && !isCountryCode(country))) throw new Error('Choose a valid country or territory.');
  if (typeof province !== 'string' || (province && !isCAProvince(province))) throw new Error('Choose a valid Canadian province or territory.');
  if (province && (state || (country && country!=='CA'))) throw new Error('A Canadian province requires a Canada location.');
  if (!terms.length && !collector && !((state || country || province) && (typeFilter || evidenceFilter))) {
    throw new Error('Add a keyword, choose a collector, or select both a place and a report or evidence type.');
  }
  const notifyRevisions = input.notifyRevisions ?? previous.notifyRevisions ?? false;
  if (typeof notifyRevisions !== 'boolean') throw new Error('Choose whether revised reports trigger alerts.');
  if (evidenceFilter !== '' && !EVIDENCE_FILTERS.includes(evidenceFilter)) throw new Error('Choose a valid evidence type.');
  if (typeFilter !== '' && !ORDER.includes(typeFilter)) throw new Error('Choose a valid report type.');
  if(!['any','all'].includes(mode)||!['all','cyber','geo','ai'].includes(category)||!['all','core','telegram','x','bluesky','mastodon'].includes(platform)||typeof enabled!=='boolean')throw new Error('Invalid watchlist filter.');
  return {id:previous.id||randomUUID(),name,terms,mode,category,platform,collector,evidence:evidenceFilter,reportType:typeFilter,state,country,province,notifyRevisions,enabled,created:previous.created||new Date().toISOString()};
}
export function matchingTerms(rule,event){
  if (isNewsCodingAggregate(event) && rule.collector!=='gdelt' && rule.reportType!=='conflict') return [];
  if(!rule.enabled||(rule.category!=='all'&&event.category!==rule.category)||(rule.platform!=='all'&&!(rule.platform==='core'?!event.platform:rule.platform===event.platform)))return [];
  if (rule.collector && event.feed_id!==rule.collector && event.source_id!==rule.collector) return [];
  if (rule.evidence && !matchesEvidence(event,rule.evidence)) return [];
  if (rule.reportType && typeId(event) !== rule.reportType) return [];
  if (rule.country || rule.province) {
    const location = withReportLocation(event);
    if ((rule.country && location.country_code!==rule.country) ||
        (rule.province && location.province_code!==rule.province)) return [];
  }
  if (rule.state) {
    const codes=statesForReport(event);
    if (rule.state==='US' ? !codes.length : !codes.includes(rule.state)) return [];
  }
  if (!rule.terms.length) {
    return [rule.state === 'US' ? 'U.S. state or territory' : usStates[rule.state]?.name || caProvinces[rule.province]?.name || countries[rule.country]?.name || (rule.collector && 'Selected collector')].filter(Boolean);
  }
  const affected = Array.isArray(event.affected_regions) ? event.affected_regions.map(region=>region?.name) : [];
  const haystack=folded([event.title,event.summary,event.place,event.source,...(event.cves||[]),...affected].join(' '));
  const terms=rule.terms.filter(term=>termMatcher(term).test(haystack));
  return terms.length&&(rule.mode==='any'||terms.length===rule.terms.length)?terms:[];
}
export function validateLocation(input){
  if(typeof input.lat!=='number'||typeof input.lon!=='number'||!Number.isFinite(input.lat)||!Number.isFinite(input.lon)||Math.abs(input.lat)>90||Math.abs(input.lon)>180)throw new Error('Latitude must be −90…90 and longitude −180…180.');
  const place=text(input.place).slice(0,120);if(!place)throw new Error('Name the location you are assigning.');
  return {lat:input.lat,lon:input.lon,place,note:text(input.note).slice(0,300),updated:new Date().toISOString()};
}
function canonicalUrl(value){try{const url=new URL(value);if(url.pathname==='/'||!['http:','https:'].includes(url.protocol))return null;url.hostname=url.hostname.replace(/^www\./,'');url.pathname=url.pathname.replace(/\/+$/,'');url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid'].includes(key))url.searchParams.delete(key);url.searchParams.sort();return url.href;}catch{return null;}}

const structuredHazards = new Set(['earthquake','hazard','tsunami','space_weather','weather_alert','mapping_activation','volcano_bulletin','wildfire_record','earth_observation','river_gauge','tropical_cyclone','disaster_declaration','local_storm_report','humanitarian_record','volcano_weekly','airport_disruption','road_closure']);

// Conservative grouping: explicit links, one shared CVE, or the same substantial headline/day.
// Shared subjects/source counts are not evidence that reports independently corroborate each other.
export function buildStories(events,links=[],separateIds=new Set()){
  const parent=new Map(events.map(e=>[e.id,e.id])),reasons=new Map(),keys=new Map();
  const find=id=>{let root=id;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next;}return root;};
  const union=(a,b,reason)=>{if(!parent.has(a)||!parent.has(b))return;const ra=find(a),rb=find(b);if(ra!==rb)parent.set(rb,ra);for(const id of [a,b]){if(!reasons.has(id))reasons.set(id,new Set());reasons.get(id).add(reason);}};
  for(const e of events){
    if(separateIds.has(e.id))continue;
    const reference=sourceReference(e),candidates=[],url=reference?null:canonicalUrl(e.url);if(url)candidates.push(['url:'+url,'Same source link']);
    if(e.cves?.length===1)candidates.push([`cve:${e.category}:${e.cves[0].toUpperCase()}`,'Shared CVE']);
    // Group related IODA signals within the same geographic scope.
    if (e.kind==='outage' && /^[A-Z]{2}$/.test(e.country || '')) {
      const state = e.outage_scope==='state' && e.state_codes?.length===1 ? e.state_codes[0] : null;
      const location = state ? e.country+':'+state : e.country;
      const scope = state ? 'state' : 'country';
      candidates.push([`outage:${location}:${e.ongoing?'ongoing':e.ts.slice(0,10)}`,e.ongoing?`Same ${scope}, outage ongoing`:`Same ${scope} outage, same day`]);
    }
    const title=folded(e.title).replace(/[^\p{L}\p{N}]+/gu,' ').trim();if(!reference&&!structuredHazards.has(e.kind)&&title.length>=35)candidates.push([`title:${e.category}:${e.ts.slice(0,10)}:${title}`,'Matching headline and date']);
    for(const [key,reason] of candidates){if(keys.has(key))union(keys.get(key),e.id,reason);else keys.set(key,e.id);}
  }
  for(const link of links)if(!separateIds.has(link.a)&&!separateIds.has(link.b))union(link.a,link.b,'Manually grouped');
  const groups=new Map();for(const e of events){const root=find(e.id);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(e);}
  return [...groups.values()].map(reports=>{
    const readings = reports.length>1 && reports.every(report=>report.kind==='river_gauge' && report.url===reports[0].url);
    reports.sort((a,b)=>Number(a.outage_state==='stale')-Number(b.outage_state==='stale') ||
      (readings ? 0 : Number(matchesEvidence(b,'primary'))-Number(matchesEvidence(a,'primary')) || b.score-a.score) ||
      Date.parse(b.ts)-Date.parse(a.ts) || a.id.localeCompare(b.id));
    const representative=reports[0],newest=[...reports].sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)||a.id.localeCompare(b.id))[0];
    const cves=[...new Set(reports.flatMap(e=>e.cves||[]))].sort();
    const basis=[...new Set(reports.flatMap(e=>[...(reasons.get(e.id)||[])]))];
    const sharedCve=cves.length===1&&reports.every(e=>e.cves?.length===1&&e.cves[0]===cves[0])&&!separateIds.has(representative.id);
    const storyKey=sharedCve?'cve:'+representative.category+':'+cves[0]:reports.map(e=>e.id).sort()[0];
    const placement=reports.filter(e=>e.manual_location).sort((a,b)=>b.manual_location.updated.localeCompare(a.manual_location.updated))[0]||representative;
    const origins=new Set(reports.map(e=>{try{return e.platform?e.source_id||e.source:new URL(e.url).hostname.replace(/^www\./,'');}catch{return e.source;}}));
    return {...representative,id:'story-'+hash(storyKey),representative_id:representative.id,report_ids:reports.map(e=>e.id),
      ts:newest.ts,date_precision:newest.date_precision,latest_received:latestReceipt(reports),first_ts:reports.reduce((min,e)=>e.ts<min?e.ts:min,newest.ts),
      lat:placement.lat,lon:placement.lon,place:placement.place,place_basis:placement.place_basis,location_note:placement.location_note,manual_location:placement.manual_location,
      display_tags:mergeTags(reports.flatMap(r=>r.display_tags||[])),report_count:reports.length,source_count:origins.size,group_basis:reports.length>1?basis:[],cves,
      watch_matches:[...new Set(reports.flatMap(e=>e.watch_matches||[]))],
      revision:hash(reports.map(e=>e.id+e.ts+e.title+JSON.stringify(e.manual_location||null)).sort().join('|')),
      reports:reports.map(e=>({id:e.id,title:e.title,url:e.url,source:e.source,source_id:e.source_id,feed_id:e.feed_id,platform:e.platform,category:e.category,kind:e.kind,outage_scope:e.outage_scope,outage_state:e.outage_state,outage_listed_until:e.outage_listed_until,outage_received:e.outage_received,
        first_received:e.first_received,source_published_at:e.source_published_at,source_date_basis:e.source_date_basis,source_url_scope:e.source_url_scope,affected_regions:e.affected_regions,
        weather_valid_until:e.weather_valid_until,weather_listed_until:e.weather_listed_until,weather_status:e.weather_status,
        weather_replaced_at:e.weather_replaced_at,weather_replacements:e.weather_replacements,
        airport_valid_until:e.airport_valid_until,airport_listed_until:e.airport_listed_until,
        road_status:e.road_status,road_started_at:e.road_started_at,road_ended_at:e.road_ended_at,road_listed_until:e.road_listed_until,road_valid_until:e.road_valid_until,road_geometry:e.road_geometry,
        country_code:e.country_code,country_basis:e.country_basis,province_code:e.province_code,province_basis:e.province_basis,
        ...(e.seismic ? {seismic:e.seismic} : {}),...(e.cves?.length ? {cves:e.cves} : {}),...(e.citation_urls?.length ? {citation_urls:e.citation_urls} : {}),
        ...(e.watch_matches?.length ? {watch_matches:e.watch_matches} : {}),score:e.score,cvss:e.cvss,
        ...(e.country_code || e.state_codes?.length || Number.isFinite(e.lat) || e.weather_area ? {state_codes:e.state_codes,state_basis:e.state_basis,lat:e.lat,lon:e.lon,place:e.place,
          place_basis:e.place_basis,location_note:e.location_note,weather_area:e.weather_area,weather_zone_references:e.weather_zone_references,weather_geometry_revision:e.weather_geometry_revision,observation_track:e.observation_track,cyclone_center_at:e.cyclone_center_at} : {}),ts:e.ts,date_precision:e.date_precision,confidence:e.confidence,summary:e.summary,tags:e.tags||[],display_tags:e.display_tags||[],separate:e.separate,manual_location:e.manual_location||null}))};
  }).sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)||a.id.localeCompare(b.id));
}

export function createIntelligence(db){
  db.exec(`CREATE TABLE IF NOT EXISTS watch_rules (id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS watch_alerts (id TEXT PRIMARY KEY,rule_id TEXT NOT NULL,event_id TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS watch_alert_rule ON watch_alerts(rule_id);
    CREATE TABLE IF NOT EXISTS event_annotations (event_id TEXT PRIMARY KEY,location TEXT,separate INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS event_tags(event_id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS story_links (a TEXT NOT NULL,b TEXT NOT NULL,PRIMARY KEY(a,b));`);
  const rules=()=>db.prepare('SELECT data FROM watch_rules ORDER BY id').all().map(r=>JSON.parse(r.data));
  const alertOrder = " ORDER BY (read_at IS NULL) DESC, created DESC, json_extract(data,'$.ts') DESC, id DESC";
  const alertRow = row => ({...JSON.parse(row.data),created:row.created,read_at:row.read_at});
  const latestAlerts = db.prepare('SELECT data,created,read_at FROM watch_alerts' + alertOrder + ' LIMIT 150');
  const unreadAlerts = db.prepare('SELECT count(*) AS n FROM watch_alerts WHERE read_at IS NULL');
  db.function('watch_alert_search',(data,query) => {
    const alert = JSON.parse(data);
    return [alert.title,alert.source,alert.rule_name,...(alert.terms || [])].some(value=>folded(value || '').includes(query)) ? 1 : 0;
  });
  const historicRules = db.prepare(`
    SELECT rule_id, json_extract(data,'$.rule_name') AS name
    FROM watch_alerts
    WHERE rowid IN (SELECT max(rowid) FROM watch_alerts GROUP BY rule_id)
  `);
  const getEvent=id=>{if(typeof id!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(id))throw new Error('Choose a valid report.');const row=db.prepare('SELECT data FROM events WHERE id=?').get(id);if(!row)throw new Error('Report not found.');return JSON.parse(row.data);};
  const backfillReports = db.prepare('SELECT data FROM events WHERE ts>=? AND json_valid(data)');
  const findWatchAlert = db.prepare('SELECT 1 FROM watch_alerts WHERE id=?');
  const addWatchAlert = db.prepare('INSERT OR IGNORE INTO watch_alerts VALUES (?,?,?,?,NULL,?)');
  function evaluate(events,{backfill = false, onlyRule = null, revisions} = {}) {
    const active = rules().filter(rule=>rule.enabled && (!onlyRule || rule.id === onlyRule));
    if (!active.length) return;
    const created = new Date().toISOString(), cutoff = reportCutoff();
    for (const report of events) {
      if (!(report.ts >= cutoff)) continue;
      for (const rule of active) {
        const terms = matchingTerms(rule,report);
        if (!terms.length) continue;
        const baseId = hash(rule.id+':'+report.id);
        const revision = !backfill && rule.notifyRevisions ? revisions?.get(report.id) : null;
        const revisesMatch = revision && findWatchAlert.get(baseId);
        const id = revisesMatch ? hash(baseId+':'+revision) : baseId;
        const data = {
          id, rule_id:rule.id, event_id:report.id, rule_name:rule.name, title:report.title,
          url:report.url, source:report.source, ts:report.ts, date_precision:report.date_precision,
          source_date_basis:report.source_date_basis, terms, backfill,
          ...(revisesMatch ? {source_revision:revision} : {})
        };
        addWatchAlert.run(id,rule.id,report.id,created,JSON.stringify(data));
      }
    }
  }
  return {
    evaluate,
    previewRule(input) {
      const rule = validateRule({ ...input, enabled: true });
      const previews = [];
      let scanned = 0;
      let matches = 0;
      const scanLimit = 10_000;
      const recent = db.prepare('SELECT data FROM events WHERE ts>=? AND json_valid(data) ORDER BY ts DESC, id DESC LIMIT ?');
      let limited = false;
      for (const row of recent.iterate(reportCutoff(),scanLimit+1)) {
        if (scanned === scanLimit) { limited = true; break; }
        scanned++;
        const report = JSON.parse(row.data);
        const terms = matchingTerms(rule, report);
        if (!terms.length) continue;
        matches++;
        if (previews.length < 6) previews.push({
          id: report.id, title: report.title, ts: report.ts, source: report.source, terms
        });
      }
      return { scanned, matches, previews, limited };
    },
    state() {
      return {rules:rules(),alerts:latestAlerts.all().map(alertRow),unread:unreadAlerts.get().n};
    },
    inbox(params) {
      const conditions = [], args = [];
      if (params.get('unread') === '1') conditions.push('read_at IS NULL');
      const rule = params.get('rule');
      if (rule) { conditions.push('rule_id=?'); args.push(rule.slice(0,64)); }
      const age = params.get('age');
      if (age === 'new') conditions.push("coalesce(json_extract(data,'$.backfill'),0)=0 AND json_extract(data,'$.source_revision') IS NULL");
      if (age === 'backfill') conditions.push("json_extract(data,'$.backfill')=1");
      if (age === 'revision') conditions.push("json_extract(data,'$.source_revision') IS NOT NULL");
      const query = params.get('q')?.trim().slice(0,250);
      if (query) {
        conditions.push('watch_alert_search(data,?)=1');
        args.push(folded(query));
      }
      const from = ' FROM watch_alerts' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
      const total = db.prepare('SELECT count(*) AS n'+from).get(...args).n;
      const pageSize = 40;
      const offset = Math.min(Math.max(0,Math.floor(Number(params.get('offset'))||0)),
        Math.max(0,Math.floor((total - 1) / pageSize) * pageSize));
      const alerts = db.prepare('SELECT data,created,read_at'+from+alertOrder+' LIMIT ? OFFSET ?').all(...args,pageSize,offset).map(alertRow);
      const names = new Map(historicRules.all().filter(row=>row.name).map(row=>[row.rule_id,row.name]));
      for (const rule of rules()) names.set(rule.id,rule.name);
      const watchlists = [...names].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));
      return {alerts,total,offset,pageSize,watchlists,unread:unreadAlerts.get().n};
    },
    addRule(input){if(rules().length>=50)throw new Error('You can keep up to 50 watchlists.');const rule=validateRule(input);db.prepare('INSERT INTO watch_rules VALUES (?,?)').run(rule.id,JSON.stringify(rule));if(input.includeExisting!==false){const existing=backfillReports.all(reportCutoff()).map(row=>JSON.parse(row.data));evaluate(existing,{backfill:true,onlyRule:rule.id});}return rule;},
    updateRule(id,input){const before=rules().find(r=>r.id===id);if(!before)throw new Error('Watchlist not found.');const rule=validateRule(input,before);db.prepare('UPDATE watch_rules SET data=? WHERE id=?').run(JSON.stringify(rule),id);if(input.includeExisting===true)evaluate(backfillReports.all(reportCutoff()).map(row=>JSON.parse(row.data)),{backfill:true,onlyRule:rule.id});return rule;},
    removeRule(id){db.prepare('DELETE FROM watch_rules WHERE id=?').run(id);},
    markRead(id){db.prepare('UPDATE watch_alerts SET read_at=? WHERE id=? AND read_at IS NULL').run(new Date().toISOString(),id);},
    markAllRead(){db.prepare('UPDATE watch_alerts SET read_at=? WHERE read_at IS NULL').run(new Date().toISOString());},
    locate(id,input){if(getEvent(id).source_withdrawn)throw new Error('A withdrawn report cannot be assigned a map point.');const location=validateLocation(input);db.prepare('INSERT INTO event_annotations (event_id,location) VALUES (?,?) ON CONFLICT(event_id) DO UPDATE SET location=excluded.location').run(id,JSON.stringify(location));return location;},
    clearLocation(id){getEvent(id);db.prepare('UPDATE event_annotations SET location=NULL WHERE event_id=?').run(id);},
    group(a,b){if(getEvent(a).source_withdrawn||getEvent(b).source_withdrawn)throw new Error('Withdrawn reports are kept separate.');if(a===b)throw new Error('Choose a different report.');for(const id of [a,b])db.prepare('UPDATE event_annotations SET separate=0 WHERE event_id=?').run(id);db.prepare('INSERT OR IGNORE INTO story_links VALUES (?,?)').run(...[a,b].sort());},
    separate(id){getEvent(id);db.prepare('INSERT INTO event_annotations (event_id,separate) VALUES (?,1) ON CONFLICT(event_id) DO UPDATE SET separate=1').run(id);db.prepare('DELETE FROM story_links WHERE a=? OR b=?').run(id,id);},
    restoreGrouping(id){getEvent(id);db.prepare('UPDATE event_annotations SET separate=0 WHERE event_id=?').run(id);},
    decorate(events){
      const annotations=new Map(db.prepare('SELECT * FROM event_annotations').all().map(row=>[row.event_id,row])),active=rules();
      const tagMap=new Map(db.prepare('SELECT event_id,data FROM event_tags').all().map(r=>[r.event_id,JSON.parse(r.data)]));
      const reports=events.map(e=>{const tags=tagMap.get(e.id)||[],annotation=annotations.get(e.id),location=annotation?.location&&!e.source_withdrawn?JSON.parse(annotation.location):null;return {...withReportLocation(e),tags,display_tags:reportTags(e,tags),watch_matches:active.filter(r=>matchingTerms(r,e).length).map(r=>r.name),
        ...(location?{lat:location.lat,lon:location.lon,place:location.place,place_basis:'manual',location_note:location.note||'Location manually assigned by you.',manual_location:location}:{}),separate:!!annotation?.separate||!!e.source_withdrawn};});
      return {events:reports,stories:buildStories(reports,db.prepare('SELECT * FROM story_links').all(),new Set(reports.filter(report=>report.separate).map(report=>report.id)))};
    },
    prune(){db.prepare('DELETE FROM watch_alerts WHERE event_id NOT IN (SELECT id FROM events WHERE ts>=?)').run(reportCutoff());db.exec('DELETE FROM event_annotations WHERE event_id NOT IN (SELECT id FROM events); DELETE FROM story_links WHERE a NOT IN (SELECT id FROM events) OR b NOT IN (SELECT id FROM events)');}
  };
}

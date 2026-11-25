import '../assets/event-types.js';
import { isUSState, statesForReport } from './us-geography.mjs';
import { isCAProvince } from './ca-geography.mjs';
import { geographyOptions,isCountryCode,withReportLocation } from './geography.mjs';
import { revisionKey } from './report-history.mjs';
import { extractCves } from './events.mjs';
import { outageFreshness } from './outage-state.mjs';
import { ensureSavedReports, reportCutoff } from './report-retention.mjs';
import {createReading,sourceRoles,sourceContext,sourceKey,muted,coverageKey} from './reading.mjs';
const { matchesEvidence, EVIDENCE_FILTERS, typeId, ORDER } = globalThis.CapstoneTypes;
const foldSearch = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const utcDay = 86_400_000;
const rollingHours = new Map([['1h',1],['6h',6],['1',24],['7',168]]);
function dayBoundary(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = Date.parse(value);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0,10) === value ? day : null;
}
const searchableFields = ['title','summary','source','place','url','country','feed_id','source_id','publisher',
  'author','actor','platform','kind','category','confidence','location_note'];

export function createTimeline(db,reading=createReading(db),{lastReceived=()=>null, reviewEnabled=false}={}) {
  db.exec('CREATE TABLE IF NOT EXISTS event_tags (event_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS event_annotations(event_id TEXT PRIMARY KEY,location TEXT,separate INTEGER NOT NULL DEFAULT 0)');
  ensureSavedReports(db);
  let muteState=reading.state();
  db.function('reading_role',s=>sourceContext(JSON.parse(s)).role);
  db.function('reading_visible',(s,t)=>muted(JSON.parse(s),JSON.parse(t||'[]'),muteState)?0:1);
  db.function('reading_revision', revisionKey);
  db.function('reading_matches_evidence',(data,filter)=>matchesEvidence(JSON.parse(data),filter)?1:0);
  db.function('reading_type', data => typeId(JSON.parse(data)));
  db.function('reading_has_cve', (data, cve) => {
    const report = JSON.parse(data);
    const references = Array.isArray(report.cves) ? report.cves : extractCves(report.title + ' ' + report.summary);
    return references.some(value=>String(value).toUpperCase()===cve) ? 1 : 0;
  });
  db.function('reading_fold', { deterministic:true }, foldSearch);
  db.function('reading_search', { deterministic:true }, (data, tags, query) => {
    const report = JSON.parse(data);
    const matches = value => typeof value === 'string' && foldSearch(value).includes(query);
    if (searchableFields.some(field => matches(report[field]))) return 1;
    if (Array.isArray(report.cves) && report.cves.some(matches)) return 1;
    if (Array.isArray(report.affected_regions) && report.affected_regions.some(region=>matches(region?.name))) return 1;
    return JSON.parse(tags || '[]').some(tag => matches(tag?.label)) ? 1 : 0;
  });
  db.function('reading_in_country',{deterministic:true},(data,code)=>withReportLocation(JSON.parse(data)).country_code === code ? 1 : 0);
  db.function('reading_in_province',{deterministic:true},(data,code)=>withReportLocation(JSON.parse(data)).province_code===code ? 1 : 0);
  db.function('reading_in_state',{deterministic:true},(data,state)=>{
    const codes = statesForReport(JSON.parse(data));
    return (state === 'US' ? codes.length > 0 : codes.includes(state)) ? 1 : 0;
  });
  db.function('reading_group',s=>coverageKey(JSON.parse(s)));
  return {
    tags(id,tags) {
      if(!db.prepare('SELECT id FROM events WHERE id=?').get(id))throw new Error('Report not found.');
      if(!Array.isArray(tags)||tags.length>40)throw new Error('Use up to 40 tags per event.');
      const next=[],seen=new Set();
      for(const tag of tags){if(!tag||!['country','subject','person','custom'].includes(tag.type)||typeof tag.label!=='string'||!tag.label.trim()||tag.label.trim().length>80)throw new Error('Each tag needs a type and a label of 1–80 characters.');const item={type:tag.type,label:tag.label.trim()},key=item.type+':'+foldSearch(item.label);if(!seen.has(key)){seen.add(key);next.push(item);}}
      db.prepare('INSERT INTO event_tags VALUES (?,?) ON CONFLICT(event_id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(next));return {tags:next};
    },
    list(params=new URLSearchParams(),{currentIds=[]}={}) {
      muteState=reading.state();
      const savedOnly = params.get('scope') === 'saved';
      const byReceipt = reviewEnabled && params.get('basis') === 'received';
      const dateField = byReceipt ? 'receipt.first_seen' : 'e.ts';
      const receiptJoin = byReceipt ? ' JOIN report_observations receipt ON receipt.event_id=e.id' : '';
      const receiptSelect = byReceipt ? ',receipt.first_seen received' : ',NULL received';
      const where = ['json_valid(e.data)'], args = [];
      if (savedOnly) {
        where.push('s.event_id IS NOT NULL');
      } else {
        where.push('e.ts>=?');
        args.push(reportCutoff());
      }
      if (byReceipt) where.push('receipt.first_seen IS NOT NULL');
      const category=params.get('category');if(['cyber','geo','ai'].includes(category)){where.push("json_extract(e.data,'$.category')=?");args.push(category);}
      const feed = params.get('feed');
      if (feed && /^[a-z0-9_-]{1,80}$/i.test(feed)) {
        where.push("coalesce(json_extract(e.data,'$.feed_id'),json_extract(e.data,'$.source_id'))=?");
        args.push(feed);
      }
      const country = (params.get('country') || '').toUpperCase();
      if (isCountryCode(country)) {
        where.push('reading_in_country(e.data,?)=1');
        args.push(country);
      }
      const state = (params.get('state') || '').toUpperCase();
      if (state === 'US' || isUSState(state)) {
        where.push('reading_in_state(e.data,?)=1');
        args.push(state);
      }
      const province = (params.get('province') || '').toUpperCase();
      if (isCAProvince(province)) {
        where.push('reading_in_province(e.data,?)=1');
        args.push(province);
      }
      const platform = params.get('platform');
      if (platform === 'core') {
        where.push("coalesce(json_extract(e.data,'$.platform'),'')=''");
      } else if (['telegram','x','bluesky','mastodon'].includes(platform)) {
        where.push("json_extract(e.data,'$.platform')=?");
        args.push(platform);
      }
      const cve = (params.get('cve') || '').trim().toUpperCase();
      if (/^CVE-\d{4}-\d{4,}$/.test(cve)) {
        where.push('reading_has_cve(e.data,?)=1');
        args.push(cve);
      }
      const source=params.get('source');if(source){where.push("json_extract(e.data,'$.source')=?");args.push(source);}
      const query = foldSearch(params.get('q')?.slice(0,250));
      if (query) {
        where.push('reading_search(e.data,t.data,?)=1');
        args.push(query);
      }
      const tag = foldSearch(params.get('tag'));
      if (tag) {
        where.push("EXISTS(SELECT 1 FROM json_each(coalesce(t.data,'[]')) j WHERE reading_fold(json_extract(j.value,'$.type')||':'||json_extract(j.value,'$.label'))=?)");
        args.push(tag);
      }
      const period = params.get('days');
      if (period === 'active') {
        where.push('e.id IN (SELECT value FROM json_each(?))');
        args.push(JSON.stringify(currentIds));
      } else if (period === 'today') {
        where.push(dateField + '>=?');
        args.push(new Date(Math.floor(Date.now()/utcDay)*utcDay).toISOString());
      } else if (period === 'range') {
        const from = params.get('from') || '';
        const through = params.get('through') || '';
        const start = dayBoundary(from);
        const end = dayBoundary(through);
        if ((!from && !through) || (from && start === null) || (through && end === null) ||
            (start !== null && end !== null && start > end)) {
          where.push('0');
        } else {
          if (start !== null) {
            where.push(dateField + '>=?');
            args.push(new Date(start).toISOString());
          }
          if (end !== null) {
            where.push(dateField + '<=?');
            args.push(new Date(end + utcDay - 1).toISOString());
          }
        }
      } else {
        const hours = rollingHours.get(period);
        if (hours) {
          where.push(dateField + '>=?');
          args.push(new Date(Date.now()-hours*3_600_000).toISOString());
        }
      }
      const role=params.get('role');if(sourceRoles.includes(role)){where.push('reading_role(e.data)=?');args.push(role);}
      const typeFilter = params.get('type');
      if (ORDER.includes(typeFilter)) {
        where.push('reading_type(e.data)=?');
        args.push(typeFilter);
      }
      const evidenceFilter = params.get('evidence');
      if (EVIDENCE_FILTERS.includes(evidenceFilter)) {
        where.push('reading_matches_evidence(e.data,?)=1');
        args.push(evidenceFilter);
      }
      const reviewFilter = params.get('review');
      const status = "CASE WHEN a_review.event_id IS NULL THEN 'pending' WHEN a_review.revision<>reading_revision(e.data) THEN 'needs-review' ELSE a_review.decision END";
      if (reviewEnabled && ['pending', 'needs-review', 'confirmed', 'contradicted', 'unverified'].includes(reviewFilter)) {
        where.push('(' + status + ')=?');
        args.push(reviewFilter);
      }
      const reviewJoin = reviewEnabled ? ' LEFT JOIN report_assessments a_review ON a_review.event_id=e.id' : '';
      const reviewSelect = reviewEnabled ? ', a_review.decision, a_review.revision' : ', NULL decision, NULL revision';
      const hasMutes = muteState.sources.length > 0 || muteState.subjects.length > 0;
      const unmuted = where.slice();
      if (hasMutes && !savedOnly && params.get('includeMuted') !== '1') where.push("reading_visible(e.data,t.data)=1");
      const savedJoin = ' LEFT JOIN saved_reports s ON s.event_id=e.id';
      const from=' FROM events e LEFT JOIN event_tags t ON t.event_id=e.id LEFT JOIN event_annotations a ON a.event_id=e.id'+reviewJoin+savedJoin+receiptJoin+' WHERE '+where.join(' AND ');
      const reportTotal=db.prepare('SELECT count(*) n'+from).get(...args).n,grouped=params.get('view')==='grouped';
      const cte="WITH filtered AS (SELECT e.id,"+dateField+" sort_ts,e.data,t.data tags,s.saved_at"+receiptSelect+reviewSelect+",CASE WHEN a.separate=1 THEN 'report:'||e.id ELSE reading_group(e.data) END g"+from+'), ranked AS (SELECT *,row_number() OVER(PARTITION BY g ORDER BY sort_ts DESC,id DESC) rn,count(*) OVER(PARTITION BY g) copies FROM filtered) ';
      const total=grouped?db.prepare(cte+'SELECT count(DISTINCT g) n FROM filtered').get(...args).n:reportTotal;
      const offset=Math.min(Math.max(0,Math.floor(Number(params.get('offset'))||0)),Math.max(0,Math.floor((total-1)/100)*100));
      const order=params.get('order')==='oldest'?'ASC':'DESC';
      const rows=grouped?db.prepare(cte+`SELECT * FROM ranked WHERE rn=1 ORDER BY sort_ts ${order},id ${order} LIMIT 100 OFFSET ?`).all(...args,offset):db.prepare('SELECT e.data,t.data tags,s.saved_at'+receiptSelect+reviewSelect+from+` ORDER BY ${dateField} ${order},e.id ${order} LIMIT 100 OFFSET ?`).all(...args,offset);
      const decorate=r=>{const e=withReportLocation(JSON.parse(r.data)),tags=JSON.parse(r.tags||'[]');const review=r.decision?(r.revision===revisionKey(r.data)?r.decision:'needs-review'):'pending';return {...outageFreshness(e,e.kind==='outage'&&e.ongoing?lastReceived(e.id):null),review,tags,saved_at:r.saved_at ?? null,first_received:r.received ?? null,source_context:sourceContext(e),source_key:sourceKey(e),muted:muted(e,tags,muteState)};};
      const members = new Map();
      const sharedGroups = grouped ? rows.filter(row => row.copies > 1).map(row => row.g) : [];
      if (sharedGroups.length) {
        const placeholders = sharedGroups.map(() => '?').join(',');
        const matches = db.prepare(cte + 'SELECT g,data,tags,saved_at,received,decision,revision FROM filtered WHERE g IN (' + placeholders + ') ORDER BY sort_ts DESC,id DESC').all(...args, ...sharedGroups);
        for (const match of matches) {
          if (!members.has(match.g)) members.set(match.g, []);
          members.get(match.g).push(decorate(match));
        }
      }
      const events = rows.map(row => {
        const event = decorate(row);
        if (grouped) {
          event.coverage_count = row.copies;
          event.coverage_basis = row.copies === 1 ? 'Distinct report text; evidence not assessed'
            : row.g.startsWith('link:') ? 'Shared source link; content may differ' : 'Repeated title and text';
          event.coverage_reports = members.get(row.g) || [];
        }
        return event;
      });
      const filterOptions = (savedOnly ? 's.event_id IS NOT NULL' : 'e.ts>=?') +
        (byReceipt ? ' AND receipt.first_seen IS NOT NULL' : '');
      const optionsArgs = savedOnly ? [] : [reportCutoff()];
      const sources = db.prepare("SELECT DISTINCT json_extract(e.data,'$.source') source FROM events e" + savedJoin + receiptJoin +
        ' WHERE json_valid(e.data) AND ' + filterOptions + ' ORDER BY source').all(...optionsArgs).map(r=>r.source).filter(Boolean);
      const tags = db.prepare("SELECT DISTINCT json_extract(j.value,'$.type') type,json_extract(j.value,'$.label') label " +
        'FROM event_tags t JOIN events e ON e.id=t.event_id' + savedJoin + receiptJoin +
        ' JOIN json_each(t.data) j WHERE ' + filterOptions + ' ORDER BY type,label').all(...optionsArgs);
      const hidden = hasMutes && !savedOnly ? db.prepare('SELECT count(*) n FROM events e LEFT JOIN event_tags t ON t.event_id=e.id' +
        reviewJoin + receiptJoin + ' WHERE ' + unmuted.join(' AND ') + ' AND reading_visible(e.data,t.data)=0').get(...args).n : 0;
      return {events,total,reportTotal,hidden,grouped,offset,pageSize:100,sources,tags,...geographyOptions,reading:muteState,savedOnly,basis:byReceipt?'received':'source'};
    }
  };
}

import {createDeveloping} from './lib/developing.mjs';
import {createReading,sourceContext,sourceKey,muted} from './lib/reading.mjs';
import {createStoryAlerts} from './lib/story-alerts.mjs';
import {createPutinTracker} from './lib/putin.mjs';
import { createLiveWriter } from './lib/live-writer.mjs';
import { outageFreshness, FRESH_RECEIPT_MS } from './lib/outage-state.mjs';
import { createReportHistory, revisionKey } from './lib/report-history.mjs';
import { repairRelayLabels } from './lib/claims.mjs';
import {createReports} from './lib/reports.mjs';
import { pruneReports, reportCutoff } from './lib/report-retention.mjs';
import { createMuskTracker } from './lib/musk.mjs';
import http from 'node:http';
import { createTimeline } from './lib/timeline.mjs';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { collect, feeds, fetchText, DEFAULT_POLL_MS, nextCollectorPoll } from './lib/collectors.mjs';
import { createStreamResolver } from './lib/streams.mjs';
import { collectorProfile } from './lib/feed-profiles.mjs';
import { DAY, newestSourceReport } from './lib/events.mjs';
import { createCredentials } from './lib/credentials.mjs';
import { createXAccount } from './lib/x-account.mjs';
import { createTelegramAccount } from './lib/telegram-account.mjs';
import { createSocialManager } from './lib/social-manager.mjs';
import { createIntelligence } from './lib/intelligence.mjs';
import { createBgpPulse } from './lib/internet.mjs';
import { computeHotspots } from './lib/hotspots.mjs';
import { createEpss } from './lib/threats.mjs';
import { computeStatus } from './lib/status.mjs';
import { createCheckpoints, situation, buildDigest } from './lib/digest.mjs';
import { countries, geographyOptions, resolveCountry } from './lib/geography.mjs';
import { listedWeatherUntil, sourceListingUntil } from './lib/weather-visibility.mjs';
import { withEaFloodTransitions } from './lib/ea-floods.mjs';
import { createSpcOutlooks } from './lib/spc-outlook.mjs';
import { createCollectorQueue } from './lib/collector-queue.mjs';
import { withCycloneTracks } from './lib/nhc.mjs';
import { withNwsReplacements } from './lib/weather-alerts.mjs';
import { buildBriefing } from './lib/briefing.mjs';
import { createNotifier } from './lib/notifier.mjs';
import { describeOffline, describeSleepGap } from './lib/offline.mjs';
import { feedHealth, pollCoverageState, withGaps } from './lib/feedhealth.mjs';
import { createPollHistory } from './lib/poll-history.mjs';
import { headlineViews } from './lib/headlines.mjs';
import { relabelLegacy } from './lib/gdelt.mjs';
import { createMarkets } from './lib/markets.mjs';
import { createCveCount } from './lib/cvecount.mjs';
import { createBackups } from './lib/backup.mjs';

// A stray rejection (a failed poll, a request handler) is logged, not fatal: collection keeps running. A synchronous
// uncaught exception still ends the process, and the desktop app restarts the collector.
process.on('unhandledRejection', error => console.error('Unhandled rejection (collection continues):', error?.stack || error));

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'runtime');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'events.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_ts ON events(ts)');
const recordedCollector = db.prepare("SELECT json_extract(data,'$.feed_id') AS feed FROM events WHERE id=? AND json_valid(data)");
const putEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, data=excluded.data WHERE events.ts<>excluded.ts OR events.data<>excluded.data');
const putFeed = db.prepare('INSERT INTO feeds VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
// Relabel older GDELT roll-ups through the server connection while preserving their IDs and source links.
// json_valid() first everywhere SQL reads into the JSON: one malformed row (a partial corruption) otherwise fails the whole query.
{ const old = db.prepare(`SELECT id, ts, data FROM events WHERE json_valid(data) AND json_extract(data,'$.source')='GDELT' AND (json_extract(data,'$.title') LIKE 'Fighting reported in %' OR json_extract(data,'$.title') LIKE 'GDELT signal: %')`).all();
  if (old.length) { db.exec('BEGIN'); try { for (const r of old) { const e = relabelLegacy(JSON.parse(r.data)); if (e) putEvent.run(r.id, r.ts, JSON.stringify(e)); } db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); console.error('GDELT relabel skipped:', error.message); } } }
const clients = new Map();
const serverStartedAt = Date.now();
let coverageStartedAt = serverStartedAt;
let stopping = false;
const collectorQueue = createCollectorQueue({
  run:refreshFeed,
  onChange:broadcast,
  onError:({id},error)=>console.error('Could not update feed status:',id,error?.message)
});
let epssUpdating = false, lastEpssAttempt = 0;
const getStoredFeed = db.prepare('SELECT data FROM feeds WHERE id=?');
const readFeedStatus = id => JSON.parse(getStoredFeed.get(id)?.data || '{}');
db.exec('CREATE TABLE IF NOT EXISTS paused_collectors(id TEXT PRIMARY KEY NOT NULL)');
const pausedCollectors = new Set(db.prepare('SELECT id FROM paused_collectors').all().map(row=>row.id));
function setCollectorEnabled(id, enabled) {
  if (enabled) {
    db.prepare('DELETE FROM paused_collectors WHERE id=?').run(id);
    pausedCollectors.delete(id);
  } else {
    db.prepare('INSERT OR IGNORE INTO paused_collectors(id) VALUES (?)').run(id);
    pausedCollectors.add(id);
    collectorQueue.remove(id);
  }
}
const resolveStream = createStreamResolver(fetchText);
const spcOutlook = createSpcOutlooks(async url=>JSON.parse(await fetchText(url,{timeout:15_000,headers:{Accept:'application/geo+json, application/json'}})));
const credentials=await createCredentials();
const xAccount=createXAccount(await createCredentials('x-account','CAPSTONE_X_ACCOUNT_SESSION'));
const telegramAccount=createTelegramAccount(await createCredentials('telegram-account','CAPSTONE_TELEGRAM_ACCOUNT_SESSION'));
const tokens={radar:await createCredentials('radar','CLOUDFLARE_RADAR_TOKEN'),abusech:await createCredentials('abusech','ABUSECH_AUTH_KEY')};
const providerNames={radar:'a Cloudflare Radar API token',abusech:'an abuse.ch Auth-Key'};
const intelligence=createIntelligence(db);
const epss=createEpss(db);
const checkpoints=createCheckpoints(db);
const backups=createBackups(db,path.join(dataDir,'backups'));
// Was collection off before this start? Checkpoints are written every 15 minutes while collecting, so the newest one
// marks the last time the app was working. The desktop passes how its previous run ended (lifecycle log).
let offlineGap=(()=>{const last=checkpoints.latest();if(!last)return null;const minutes=Math.round((serverStartedAt-Date.parse(last))/60000);if(!(minutes>=45))return null;let previous=null;try{previous=JSON.parse(process.env.CAPSTONE_PREVIOUS_RUN||'null');}catch{}const gap={from:last,to:new Date(serverStartedAt).toISOString(),minutes,previous};return {...gap,...describeOffline(gap)};})();
const offlineMessage=gap=>({title:gap.title,body:gap.body,path:'/ops'});
let offlineDismissed=false;
const offlineNotice=()=>offlineGap&&!offlineDismissed&&Date.now()-Date.parse(offlineGap.to)<86400000?offlineGap:null;
// Windows toasts are shown by the desktop process; in browser/server mode there is no one to hand them to.
const desktopSession = process.env.CAPSTONE_DESKTOP === '1';
const desktopNotify = desktopSession && process.connected;
const notifier=createNotifier(db,message=>{if(desktopNotify&&process.connected)process.send({type:'notify',...message},()=>{});});
const reading=createReading(db);
const muskTracker=createMuskTracker(db);
const putinTracker=createPutinTracker(db);
repairRelayLabels(db);
const reportHistory = createReportHistory(db);
const reportDetails = createReports(db, reportHistory);
const timeline = createTimeline(db, reading, {lastReceived:reportHistory.lastReceived,reviewEnabled:true});
const getDevelopingReport=db.prepare('SELECT e.data, o.last_seen FROM events e LEFT JOIN report_observations o ON o.event_id=e.id WHERE e.id=? AND json_valid(e.data)');
const developing=createDeveloping(db,{lookupReports:ids=>ids.map(id=>getDevelopingReport.get(id)).filter(Boolean).map(row=>outageFreshness(JSON.parse(row.data),row.last_seen))});
const storyAlerts=createStoryAlerts(db);notifier.baselineStories(storyAlerts.list());
function storeEvents(events) {
  const observed = new Date().toISOString();
  const best = new Map();
  const changes = {added:0, revised:0};
  const revisions = new Map();
  const watchCandidates = [];
  for (const report of events) {
    const earlier = best.get(report.id);
    if (!earlier || report.ts > earlier.ts) best.set(report.id,report);
  }
  db.exec('BEGIN');
  try {
    for (const report of best.values()) {
      if ((report.source_withdrawn || report.updates_existing_only) && recordedCollector.get(report.id)?.feed!==report.feed_id) continue;
      const data = JSON.stringify(report);
      const outcome = reportHistory.observe(report.id,data,observed);
      if (outcome !== 'unchanged') {
        changes[outcome]++;
        watchCandidates.push(report);
      }
      if (outcome === 'revised') revisions.set(report.id,revisionKey(data));
      putEvent.run(report.id,report.ts,data);
    }
    if (watchCandidates.length) intelligence.evaluate(watchCandidates,{revisions});
    db.exec('COMMIT');
    return changes;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
const pollHistory = createPollHistory(db);
function recordPoll(id, started, success, count, detail) {
  try { pollHistory.record(id, started, success, count, Date.now(), detail); }
  catch (error) { console.error('Could not record collector history', error.message); }
}
const social=createSocialManager(db,credentials,broadcast,storeEvents,undefined,recordPoll,xAccount);
const collectorsOn=process.env.CAPSTONE_COLLECTORS!=='off';
const markets=createMarkets({enabled:collectorsOn});
const cveToday=createCveCount({enabled:collectorsOn});
const pulse=createBgpPulse({onSurge:e=>{if(e){try{storeEvents([e]);}catch(error){console.error('Could not store routing surge',error.message);}broadcast();}},onChange:()=>broadcastPulse()});
function feedStatus(f){
  const previous = readFeedStatus(f.id);
  const stored = {...previous, profile:collectorProfile(f),
    officialMirror:Boolean(f.fallback && previous.usedUrl === f.fallback),
    intervalMinutes:(f.intervalMs || DEFAULT_POLL_MS) / 60_000};
  delete stored.validators;
  if (pausedCollectors.has(f.id)) return {...stored,enabled:false,state:'paused',polling:false,nextPoll:null};
  if(f.requires&&!tokens[f.requires].get())return {...stored,state:'needs-key',error:`Connect ${providerNames[f.requires]} on the Feeds page.`};
  const now = Date.now();
  return {state:'waiting',...stored,enabled:true,polling:collectorQueue.polling(f.id),queued:collectorQueue.queued(f.id),
    nextPoll:collectorsOn ? new Date(nextCollectorPoll(f,stored,now)).toISOString() : null};
}
// Operations includes recent source dates and receipts, plus older priority or ongoing reports.
const liveReportLimit = 15_000;
function windowReports(feedList) {
  const now = Date.now();
  const byId = new Map(feedList.map(feed=>[feed.id,feed]));
  const recent = new Date(now - 8 * DAY).toISOString();
  const lastHour = new Date(now - 3_600_000).toISOString();
  const rows = db.prepare(`
    SELECT e.data,o.first_seen,o.last_seen,o.revision FROM events e LEFT JOIN report_observations o ON o.event_id=e.id
    WHERE json_valid(e.data) AND e.ts>=?
      AND (e.ts>=? OR o.first_seen>=? OR json_extract(e.data,'$.score')>=85 OR json_extract(e.data,'$.ongoing')=1
        OR (o.last_seen>=? AND json_extract(e.data,'$.kind') IN ('weather_alert','airport_disruption','road_closure')))
      AND coalesce(json_extract(e.data,'$.tracker'),'') NOT IN ('musk','putin')
    ORDER BY CASE WHEN o.first_seen>e.ts THEN o.first_seen ELSE e.ts END DESC,e.ts DESC,e.id DESC LIMIT ?
  `).all(new Date(now - 30 * DAY).toISOString(),recent,recent,lastHour,liveReportLimit + 1);
  const limited = rows.length > liveReportLimit;
  if (limited) rows.pop();
  return {
    reports:withEaFloodTransitions(withNwsReplacements(withCycloneTracks(rows.map(row=>{
      const report = {...outageFreshness(JSON.parse(row.data),row.last_seen,now),
        ...(row.first_seen ? {first_received:row.first_seen} : {})};
      const feed = byId.get(report.feed_id);
      if (report.kind==='outage' && report.outage_state==='current') {
        const measuredUntil = new Date(Date.parse(row.last_seen)+FRESH_RECEIPT_MS).toISOString();
        const outage_listed_until = collectorsOn ? sourceListingUntil(row.last_seen,feed,measuredUntil,now) : null;
        return {...report,outage_listed_until};
      }
      const weather_listed_until = collectorsOn ? listedWeatherUntil(report,row.last_seen,feed,now) : null;
      if (weather_listed_until) return {...report,weather_listed_until,...(report.weather_area ? {weather_geometry_revision:row.revision} : {})};
      if (report.kind === 'airport_disruption') {
        const airport_listed_until = collectorsOn ? sourceListingUntil(row.last_seen,feed,report.airport_valid_until,now) : null;
        return {...report,airport_listed_until};
      }
      if (report.kind === 'road_closure') {
        const road_listed_until = collectorsOn && report.road_status==='active' ? sourceListingUntil(row.last_seen,feed,report.road_valid_until,now) : null;
        return {...report,road_listed_until};
      }
      return report;
    })))),
    reportWindow:{limited,count:rows.length,limit:liveReportLimit}
  };
}
function listFeeds() {
  const coverageOptions = {enabled:collectorsOn,now:Date.now()};
  const builtIn = feeds.map(feed => {
    const status = feedStatus(feed);
    return {id:feed.id,name:feed.name,url:feed.url,tracker:feed.tracker,
      desk:feed.desk || feed.category || 'cyber',group:feed.group,...(feed.currentListings?{currentListings:true}:{}),...status,
      pollCoverage:pollCoverageState(status,coverageOptions)};
  });
  return [...builtIn, ...social.list()];
}
const SNAPSHOT_TTL_MS = 2000;
let cachedSnapshot = null;
const receiptHeadlines = new WeakMap();
let snapshotExpires = 0;
const headlineVisibility = preferences => preferences.sources.length || preferences.subjects.length ?
  report=>!muted(report,report.display_tags || [],preferences) : undefined;
let snapshotDataVersion;
const readDataVersion = db.prepare('PRAGMA data_version');
function snapshot() {
  const version = readDataVersion.get().data_version;
  if (Date.now() < snapshotExpires && cachedSnapshot && version === snapshotDataVersion) return cachedSnapshot;
  const feedList = listFeeds();
  const {reports,reportWindow} = windowReports(feedList);
  const raw=intelligence.decorate(reports);
  const annotate=e=>({...e,source_context:sourceContext(e),source_key:sourceKey(e)});
  const decorated={events:epss.attach(raw.events.map(annotate)),stories:epss.attach(raw.stories.map(s=>({...annotate(s),reports:s.reports.map(annotate)})))};
  developing.sync(decorated.stories,decorated.events);
  storyAlerts.collect();
  const since=Object.fromEntries(feedList.filter(f=>f.firstSuccess).map(f=>[f.id,Date.parse(f.firstSuccess)]));
  const hotspots=computeHotspots(decorated.events,{resolve:resolveCountry,countries,since,allowVolumeSpikes:!reportWindow.limited}),pulseState=collectorsOn?pulse.summary():null;
  const problems=collectorsOn ? feedHealth(feedList,{pulse:pulseState,startedAt:coverageStartedAt}) : [];
  const preferences = reading.state();
  cachedSnapshot = { now: new Date().toISOString(), refreshing:collectorQueue.busy, reportWindow, ...decorated, ...headlineViews(decorated.stories,{includeReport:headlineVisibility(preferences)}), developing:developing.list(), storyAlertUnread:storyAlerts.list().filter(a=>!a.read_at).length, hotspots, pulse: pulseState, status: withGaps(computeStatus({reports:decorated.events,hotspots,pulse:pulseState,since,volumeComparable:!reportWindow.limited}),problems,feedList,{enabled:collectorsOn,pulse:pulseState}), feedHealth: problems, watch:intelligence.state(),
    feeds: feedList,collecting: collectorsOn,reading:preferences, offline: offlineNotice() };
  snapshotDataVersion = version;
  snapshotExpires = Date.now() + SNAPSHOT_TTL_MS;
  return cachedSnapshot;
}
// Live payloads. Map pages get stories (each already carries its reports) without the duplicate flat events
// list; every other page gets a light snapshot with only the status, watch and feed state it renders.
const livePayload = (snap, light) => { const { events, stories, ...rest } = snap; return light ? { now: rest.now, refreshing: rest.refreshing, collecting: rest.collecting, status: rest.status, feedHealth: rest.feedHealth, storyAlertUnread: rest.storyAlertUnread, hotspots: rest.hotspots, pulse: rest.pulse, watch: rest.watch, reading:rest.reading, feeds: rest.feeds, offline: rest.offline, headlines: rest.headlines, headlinesByDesk: rest.headlinesByDesk, primaryHeadlines: rest.primaryHeadlines, watchHeadlines: rest.watchHeadlines } : { ...rest, stories }; };
const trayNames = { green: 'quiet signals', amber: 'elevated signals', red: 'high signals' }, trayTiles = { internet: 'Internet', cyber: 'Cyber', conflict: 'Conflict', earth: 'Earth', social: 'Chatter' };
const trayLine = snap => [...(snap.status || []).map(t => `${trayTiles[t.id] || t.label} ${t.level==='green'&&t.coverage?.current===0?'coverage unavailable':trayNames[t.level] || t.level}`), ...(snap.feedHealth?.length ? [`${snap.feedHealth.length} feed${snap.feedHealth.length === 1 ? ' needs' : 's need'} attention`] : [])].join(' · ');
// A refresh or a round of social polls fires many updates in a burst; coalesce them into one snapshot
// at most every 2 seconds, never holding one back more than 5 seconds.
let broadcastTimer = null, broadcastDeadline = 0;
function broadcast() {
  if (stopping) return;
  snapshotExpires = 0;
  const now = Date.now(); if (!broadcastDeadline) broadcastDeadline = now + 5000;
  clearTimeout(broadcastTimer); broadcastTimer = setTimeout(flushBroadcast, Math.max(0, Math.min(2000, broadcastDeadline - now)));
}
function flushBroadcast() {
  broadcastTimer = null; broadcastDeadline = 0;
  // Runs from a timer: a throw here would be uncaught and stop the server, so a failed snapshot skips this broadcast.
  let snap; try { snap = snapshot(); } catch (error) { console.error('Snapshot failed; broadcast skipped', error?.stack || error); return; }
  const frames = new Map();
  for (const client of clients.values()) {
    if (!frames.has(client.light)) frames.set(client.light, `event: snapshot\ndata: ${JSON.stringify(livePayload(snap, client.light))}\n\n`);
    client.write(frames.get(client.light), true);
  }
  try { notifier.check({ status: snap.status, watch: snap.watch, feedHealth: snap.feedHealth,storyAlerts:storyAlerts.active() }); } catch (error) { console.error('Notification check failed', error.message); }
  // One-line status for the tray icon's tooltip and menu header.
  if (desktopNotify && process.connected) process.send({type:'tray-status',text:trayLine(snap)},()=>{});
}
function broadcastPulse() { if(!collectorsOn)return;snapshotExpires=0;try{const message = `event: pulse\ndata: ${JSON.stringify(pulse.summary())}\n\n`; for (const client of clients.values()) client.write(message);}catch(error){console.error('Pulse push failed',error.message);} }
function requestRefresh() {
  if (!collectorsOn || stopping) return {refreshing:false, count:0, nextPoll:null};
  const now = Date.now();
  const due = [];
  let firstDue = Infinity;
  for (const feed of feeds) {
    if (pausedCollectors.has(feed.id) || collectorQueue.has(feed.id)) continue;
    const token = feed.requires ? tokens[feed.requires].get() : '';
    if (feed.requires && !token) continue;
    const previous = readFeedStatus(feed.id);
    const nextPoll = nextCollectorPoll(feed, previous, now);
    if (nextPoll <= now) due.push({id:feed.id,host:new URL(feed.url).hostname,feed});
    else firstDue = Math.min(firstDue, nextPoll);
  }
  if (!due.length) {
    const refreshing = collectorQueue.busy;
    return {refreshing,count:0,nextPoll:!refreshing && Number.isFinite(firstDue) ? new Date(firstDue).toISOString() : null};
  }
  due.sort((a,b)=>Number(Boolean(a.feed.tracker))-Number(Boolean(b.feed.tracker)));
  collectorQueue.add(due);
  return {refreshing:true, count:due.length, nextPoll:null};
}

async function refreshEpss() {
  const now = Date.now();
  if (!collectorsOn || stopping || epssUpdating || now-lastEpssAttempt<60_000) return;
  lastEpssAttempt = now;
  epssUpdating = true;
  try {
    const reports = db.prepare("SELECT data FROM events WHERE ts>=? AND json_valid(data) AND data LIKE '%CVE-%'").all(reportCutoff());
    const requested = await epss.refresh(reports.flatMap(row=>JSON.parse(row.data).cves || []));
    if (requested) broadcast();
  } catch (error) { console.error('EPSS refresh failed',error.message); }
  finally { epssUpdating = false; }
}

async function refreshFeed({feed}) {
  if (stopping || pausedCollectors.has(feed.id)) return;
  const token = feed.requires ? tokens[feed.requires].get() : '';
  if (feed.requires && !token) return;
  const previous = readFeedStatus(feed.id);
  const started = Date.now();
  const lastAttempt = new Date(started).toISOString();
  let status;
  try {
    const {events,usedUrl,unchanged,validators} = await collect(feed,token,{
      validators:previous.newestReport===undefined ? undefined : previous.validators
    });
    if (stopping || pausedCollectors.has(feed.id)) return;
    const changes = unchanged ? {added:0,revised:0} : storeEvents(events.map(event=>({...event,feed_id:feed.id})));
    const lastSuccess = new Date().toISOString();
    status = {
      state:'ok', count:unchanged ? previous.count : events.length, ...changes,
      newestReport:unchanged ? previous.newestReport : newestSourceReport(events),
      firstSuccess:previous.firstSuccess || lastSuccess,lastSuccess,usedUrl,error:null,
      unchanged:Boolean(unchanged),validators:validators || null,
      lastBodyStarted:unchanged ? previous.lastBodyStarted : lastAttempt
    };
  } catch (error) {
    if (stopping || pausedCollectors.has(feed.id)) return;
    status = {
      ...previous,state:'error',unchanged:false,error:String(error.message).slice(0,180),
      failingSince:previous.state==='error' && previous.failingSince ? previous.failingSince : lastAttempt,
      retryAfter:error.retryAt ? new Date(error.retryAt).toISOString() : null
    };
  }
  putFeed.run(feed.id,JSON.stringify({...status,lastAttempt}));
  recordPoll(feed.id,started,status.state==='ok',status.unchanged ? null : status.count,status);
}
const totalDbChanges = db.prepare('SELECT total_changes() AS count');
function maintainLocalData() {
  if (stopping) return;
  try {
    const previousChanges = totalDbChanges.get().count;
    db.exec('BEGIN');
    try {
      pruneReports(db);
      reportHistory.prune();
      pollHistory.prune();
      intelligence.prune();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (totalDbChanges.get().count !== previousChanges) broadcast();
  } catch (error) { console.error('Report retention maintenance failed',error.message); }

  if (collectorsOn) {
    try {
      const latest = checkpoints.latest();
      if (!latest || Date.now() - Date.parse(latest) >= 15 * 60_000) checkpoints.record(situation(snapshot()));
    } catch (error) { console.error('Checkpoint failed',error.message); }
  }
  try {
    const file = backups.daily();
    if (file) console.log(`Database backup written: ${file}`);
  } catch (error) { console.error('Database backup failed',error.message); }
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function bodyJSON(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new Error('Send JSON data.');
  const limit = 64 * 1024, chunks = [];
  if (Number(req.headers['content-length']) > limit) throw new Error('Request is too large.');
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  let value;
  try {
    const body = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes));
    value = JSON.parse(body);
  } catch { throw new Error('Invalid JSON.'); }
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Expected a JSON object.');return value;
}

// Every request goes through handle(); an error in any route answers 500 and is logged instead of stopping the server.
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  handle(req, res).catch(error => {
    console.error('Request failed', req.method, req.url?.split('?',1)[0], error?.stack || error);
    if (!res.headersSent) json(res, 500, { error: 'Internal error. The request was logged.' }); else if (!res.writableEnded) res.end();
  });
});
async function handle(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  let url,requestHost;
  try{url=new URL(req.url,'http://localhost');requestHost=new URL(`http://${req.headers.host||'localhost'}`).hostname;}
  catch{return json(res,400,{error:'Invalid request URL or Host.'});}
  // Credential and feed settings must never be exposed through DNS rebinding.
  const allowedHosts=['127.0.0.1','localhost','[::1]',...(process.env.CAPSTONE_ALLOWED_HOSTS||'').split(',').filter(Boolean)];
  if(!allowedHosts.includes(requestHost))return json(res,403,{error:'Host is not allowed.'});
  const localAccountRequest = ['127.0.0.1','localhost'].includes(requestHost) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Same-origin requests only'});
  if (url.pathname === '/sources/') { res.writeHead(308, { Location: '/sources' }); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !(/^\/api\/developing(?:\/[a-zA-Z0-9_-]{1,64})?$/.test(url.pathname)&&['POST','PATCH'].includes(req.method)) && !(/^\/api\/reports\/[a-zA-Z0-9_-]{1,64}\/(?:notes|assessment|saved)$/.test(url.pathname)&&req.method==='PUT') && !(/^\/api\/timeline\/[a-zA-Z0-9_-]{1,64}\/tags$/.test(url.pathname)&&req.method==='PUT') && !((req.method === 'POST' && ['/api/refresh','/api/backups'].includes(url.pathname))||(/^\/api\/collectors\/[a-z0-9-]{1,80}$/.test(url.pathname)&&req.method==='PATCH')||/^\/api\/(reading$|social\/|watch(?:\/|$)|stories\/|events\/[^/]+\/location$|providers\/(?:radar|abusech)\/credentials$|notifications(?:\/test)?$|offline\/dismiss$)/.test(url.pathname))) return json(res, 405, { error: 'Method not allowed' });
  if(url.pathname==='/api/reading'){try{if(req.method==='GET')return json(res,200,reading.state());if(req.method==='PUT'){const result=reading.update(await bodyJSON(req));broadcast();return json(res,200,result);}return json(res,405,{error:'Use GET or PUT.'});}catch(error){return json(res,400,{error:error.message});}}
  if (url.pathname==='/api/offline/dismiss') {
    if (req.method!=='POST') return json(res,405,{error:'Use POST.'});
    const noticeTime = url.searchParams.get('to');
    if (noticeTime && noticeTime!==offlineGap?.to) return json(res,409,{error:'A newer collection gap is available.'});
    offlineDismissed = true;
    broadcast();
    return json(res,200,{dismissed:true});
  }
  if(url.pathname==='/api/notifications'||url.pathname==='/api/notifications/test'){
    try{
      if(url.pathname==='/api/notifications/test'){if(req.method!=='POST')return json(res,405,{error:'Use POST.'});if(!desktopNotify)return json(res,409,{error:'Windows notifications need the desktop app.'});notifier.test();return json(res,202,{sent:true});}
      if(req.method==='GET')return json(res,200,{...notifier.settings(),available:desktopNotify});
      if(req.method==='PUT')return json(res,200,{...notifier.update(await bodyJSON(req)),available:desktopNotify});
      return json(res,405,{error:'Unsupported notification operation.'});
    }catch(error){return json(res,400,{error:String(error.message).slice(0,200)});}
  }
  const collectorId = url.pathname.match(/^\/api\/collectors\/([a-z0-9-]{1,80})$/)?.[1];
  if (collectorId && req.method === 'PATCH') {
    const feed = feeds.find(item => item.id === collectorId);
    if (!feed) return json(res,404,{error:'Collector not found.'});
    try {
      const {enabled} = (await bodyJSON(req)) || {};
      if (typeof enabled !== 'boolean') return json(res,400,{error:'Choose whether to collect this feed.'});
      setCollectorEnabled(feed.id,enabled);
      if (enabled) requestRefresh();
      broadcast();
      return json(res,200,{id:feed.id,...feedStatus(feed)});
    } catch (error) { return json(res,400,{error:error.message}); }
  }
  const provider=url.pathname.match(/^\/api\/providers\/(radar|abusech)\/credentials$/)?.[1];
  if(provider){
    try{
      if(req.method==='GET')return json(res,200,tokens[provider].status());
      if(req.method==='PUT'||req.method==='DELETE'){const result=await tokens[provider].set(req.method==='PUT'?(await bodyJSON(req)).token:'');broadcast();if(req.method==='PUT')requestRefresh();return json(res,200,result);}
      return json(res,405,{error:'Unsupported credential operation.'});
    }catch(error){return json(res,400,{error:String(error.message).slice(0,200)});}
  }
  if(url.pathname.startsWith('/api/developing')){try{
    if(url.pathname==='/api/developing/alerts'){if(req.method==='GET'){snapshot();return json(res,200,{alerts:storyAlerts.list()});}if(req.method==='PATCH'){const body=await bodyJSON(req);const alerts=storyAlerts.read(body.id);broadcast();return json(res,200,{alerts});}return json(res,405,{error:'Use GET or PATCH.'});}
    if(url.pathname==='/api/developing'&&req.method==='GET'){snapshot();return json(res,200,{threads:developing.list()});}
    if(url.pathname==='/api/developing/follow'&&req.method==='POST'){const body=await bodyJSON(req),snap=snapshot();const thread=developing.follow(body.storyId,snap.stories,snap.events);broadcast();return json(res,200,thread);}
    const match=url.pathname.match(/^\/api\/developing\/(dev-[a-f0-9]{24})$/);
    if(match&&req.method==='GET')return json(res,200,developing.detail(match[1]));
    if(match&&req.method==='PATCH'){const result=developing.update(match[1],await bodyJSON(req));broadcast();return json(res,200,result);}
    return json(res,405,{error:'Unsupported developing-story operation.'});
  }catch(error){return json(res,400,{error:error.message});}}
  const reportRoute=url.pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]{1,64})(?:\/(notes|assessment|saved))?$/);
  if(reportRoute){try{if(req.method==='GET'&&!reportRoute[2])return json(res,200,reportDetails.get(reportRoute[1]));if(req.method==='PUT'&&reportRoute[2]==='assessment'){const assessment=reportHistory.assess(reportRoute[1],await bodyJSON(req));broadcast();return json(res,200,assessment);}if(req.method==='PUT'&&reportRoute[2]==='saved')return json(res,200,reportDetails.setSaved(reportRoute[1],(await bodyJSON(req))?.saved));if(req.method==='PUT'&&reportRoute[2]==='notes'){const input=await bodyJSON(req);return json(res,200,reportDetails.save(reportRoute[1],input.note,input.expected_revision));}return json(res,405,{error:'Unsupported report operation.'});}catch(error){return json(res,error.status===409?409:400,{error:error.message});}}
  if(url.pathname==='/api/putin'&&req.method==='GET'){const result=putinTracker.list(url.searchParams);result.feeds=feeds.filter(f=>f.tracker==='putin').map(f=>({id:f.id,name:f.name,...feedStatus(f)}));return json(res,200,result);}
  if(url.pathname==='/api/musk'&&req.method==='GET'){const result=muskTracker.list(url.searchParams);result.feeds=feeds.filter(f=>f.tracker==='musk').map(f=>({id:f.id,name:f.name,...feedStatus(f)}));return json(res,200,result);}
  if (url.pathname === '/api/timeline' && req.method === 'GET') {
    const now = Date.now();
    const currentIds = url.searchParams.get('days')==='active' && collectorsOn ?
      snapshot().events.filter(report=>globalThis.CapstoneTypes.currentListing(report,now)).map(report=>report.id) : [];
    return json(res,200,timeline.list(url.searchParams,{currentIds}));
  }
  const tagRoute=url.pathname.match(/^\/api\/timeline\/([a-zA-Z0-9_-]{1,64})\/tags$/);
  if(tagRoute&&req.method==='PUT'){try{const result=timeline.tags(tagRoute[1],(await bodyJSON(req)).tags);broadcast();return json(res,200,result);}catch(error){return json(res,400,{error:error.message});}}
  if(url.pathname==='/api/geography'&&req.method==='GET')return json(res,200,geographyOptions);
  if(url.pathname==='/api/watch'&&req.method==='GET')return json(res,200,intelligence.state());
  if(url.pathname==='/api/watch/inbox'&&req.method==='GET')return json(res,200,intelligence.inbox(url.searchParams));
  if(url.pathname.startsWith('/api/watch/')||url.pathname.startsWith('/api/stories/')||/^\/api\/events\/[^/]+\/location$/.test(url.pathname)){
    try{
      let result;
      const rule=url.pathname.match(/^\/api\/watch\/rules\/([a-zA-Z0-9-]{1,64})$/),alert=url.pathname.match(/^\/api\/watch\/alerts\/([a-f0-9]{24})$/),location=url.pathname.match(/^\/api\/events\/([a-zA-Z0-9_-]{1,64})\/location$/);
      if (url.pathname === '/api/watch/preview' && req.method === 'POST') return json(res, 200, intelligence.previewRule(await bodyJSON(req)));
      if(url.pathname==='/api/watch/rules'&&req.method==='POST')result=intelligence.addRule(await bodyJSON(req));
      else if(rule&&req.method==='PATCH')result=intelligence.updateRule(rule[1],await bodyJSON(req));
      else if(rule&&req.method==='DELETE'){intelligence.removeRule(rule[1]);result={removed:true};}
      else if(alert&&req.method==='PATCH'){intelligence.markRead(alert[1]);result={read:true};}
      else if(url.pathname==='/api/watch/read-all'&&req.method==='POST'){intelligence.markAllRead();result={read:true};}
      else if(location&&req.method==='PUT')result=intelligence.locate(location[1],await bodyJSON(req));
      else if(location&&req.method==='DELETE'){intelligence.clearLocation(location[1]);result={restored:true};}
      else if(url.pathname==='/api/stories/group'&&req.method==='POST'){const body=await bodyJSON(req);intelligence.group(body.eventId,body.targetId);result={grouped:true};}
      else if(url.pathname==='/api/stories/separate'&&req.method==='POST'){const body=await bodyJSON(req);body.restore?intelligence.restoreGrouping(body.eventId):intelligence.separate(body.eventId);result={separated:!body.restore};}
      else return json(res,405,{error:'Unsupported watchlist or story operation.'});
      broadcast();return json(res,200,result);
    }catch(error){return json(res,400,{error:String(error.message).slice(0,200)});}
  }
  if(url.pathname.startsWith('/api/social/')){
    try{
      if (url.pathname.startsWith('/api/social/x-account')) {
        if (!localAccountRequest) return json(res,403,{error:'X sign-in is available on the local Capstone address only.'});
        const callback = 'http://127.0.0.1:'+server.address().port+'/api/social/x-account/callback';
        if (url.pathname==='/api/social/x-account/callback' && req.method==='GET' && requestHost==='127.0.0.1') {
          await xAccount.finish(Object.fromEntries(url.searchParams));
          broadcast();
          res.writeHead(303,{Location:'/feeds#personal-accounts','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
          return res.end();
        }
        if (url.pathname==='/api/social/x-account' && req.method==='GET') return json(res,200,{...xAccount.status(),callback});
        if (url.pathname==='/api/social/x-account' && req.method==='POST') {
          const {clientId} = await bodyJSON(req);
          return json(res,201,{authorize:xAccount.start(clientId,callback)});
        }
        if (url.pathname==='/api/social/x-account' && req.method==='DELETE') {
          const state = await xAccount.disconnect();
          broadcast();
          return json(res,200,state);
        }
        if (url.pathname==='/api/social/x-account/following' && req.method==='POST') {
          await bodyJSON(req);
          const profile = xAccount.status().profile;
          if (!profile) return json(res,409,{error:'Link an X account first.'});
          return json(res,201,social.addFollowing(profile));
        }
        return json(res,405,{error:'Unsupported X account operation.'});
      }
      if (url.pathname.startsWith('/api/social/telegram-account')) {
        if (!localAccountRequest) return json(res,403,{error:'Telegram sign-in is available on the local Capstone address only.'});
        const {pathname} = url;
        if (pathname==='/api/social/telegram-account') {
          if (req.method==='GET') return json(res,200,telegramAccount.status());
          if (req.method==='POST') {
            const {apiId,apiHash} = await bodyJSON(req);
            return json(res,201,telegramAccount.begin(Number(apiId),apiHash));
          }
          if (req.method==='DELETE') return json(res,200,await telegramAccount.disconnect());
        }
        if (req.method==='POST' && pathname==='/api/social/telegram-account/password') {
          const {password} = await bodyJSON(req);
          return json(res,200,telegramAccount.supplyPassword(password));
        }
        if (req.method==='POST' && pathname==='/api/social/telegram-account/channels') {
          await bodyJSON(req);
          return json(res,200,await telegramAccount.channels());
        }
        if (req.method==='POST' && pathname==='/api/social/telegram-account/import') {
          const {handles,category} = await bodyJSON(req);
          return json(res,201,social.addTelegramChannels(telegramAccount.selected(handles),category));
        }
        return json(res,405,{error:'Unsupported Telegram account operation.'});
      }
      if(url.pathname==='/api/social/credentials'){
        if(req.method==='GET')return json(res,200,social.connection());
        if(req.method==='PUT'){const body=await bodyJSON(req);return json(res,200,await social.setToken(body.bearerToken));}
        if(req.method==='DELETE')return json(res,200,await social.setToken(''));
      }
      if(url.pathname==='/api/social/feeds'){
        if(req.method==='GET')return json(res,200,{feeds:social.list(),connection:social.connection()});
        if(req.method==='POST'){const feed=social.add(await bodyJSON(req));if(process.env.CAPSTONE_COLLECTORS!=='off')void social.poll(feed.id);return json(res,201,feed);}
      }
      const match=url.pathname.match(/^\/api\/social\/feeds\/(social-[a-f0-9]{20})(\/refresh)?$/);
      if(match){
        const id=match[1],feed=social.get(id);if(!feed)return json(res,404,{error:'Feed not found.'});
        if(match[2]&&req.method==='POST'){
          if(!collectorsOn)return json(res,409,{error:'Collection is paused.'});
          if(!feed.enabled)return json(res,409,{error:'Enable this feed before polling.'});
          if(!social.canCollect(feed))return json(res,409,{error:'Connect the X account or developer token required for this feed.'});
          const s=social.status(id);if(s.nextPoll&&Date.parse(s.nextPoll)>Date.now())return json(res,429,{error:`Next poll after ${s.nextPoll}.`});
          void social.poll(id);return json(res,202,{queued:true});
        }
        if(!match[2]&&req.method==='PATCH'){const next=social.update(id,await bodyJSON(req));if(process.env.CAPSTONE_COLLECTORS!=='off')void social.poll(id);return json(res,200,next);}
        if(!match[2]&&req.method==='DELETE'){social.remove(id);return json(res,200,{removed:true,postsRetained:true});}
      }
      return json(res,405,{error:'Unsupported feed operation.'});
    }catch(error){return json(res,400,{error:String(error.message).slice(0,200)});}
  }
  if (url.pathname === '/api/events') {
    const state = snapshot();
    return json(res, 200, url.searchParams.get('view') === 'ops' ? livePayload(state, false) : state);
  }
  if (url.pathname === '/api/digest') {
    const since=Date.parse(url.searchParams.get('since')||'');
    if(!Number.isFinite(since)||since>Date.now()||since<Date.now()-8*DAY)return json(res,400,{error:'Use a since time within the last 8 days.'});
    const snap=snapshot(),iso=new Date(since).toISOString();
    const then=checkpoints.at(iso),between=checkpoints.between(iso);
    const digest=buildDigest({since:iso,then,between,current:situation(snap),status:snap.status,events:snap.events,countries});
    digest.hazard_receipts = reportHistory.receivedHazards(iso,new Date().toISOString());
    digest.briefing=buildBriefing({digest,then,between,events:snap.events,threads:developing.observations(iso),gaps:snap.feedHealth,collecting:snap.collecting,limited:snap.reportWindow.limited,hazardReceipts:digest.hazard_receipts});
    return json(res,200,digest);
  }
  if (url.pathname === '/api/health/polls' && req.method === 'GET') {
    const feedId = url.searchParams.get('feed');
    if (!feedId || !(feeds.some(feed => feed.id === feedId) || social.get(feedId))) return json(res, 404, { error: 'Collector not found.' });
    return json(res, 200, pollHistory.history(feedId, Number(url.searchParams.get('hours'))));
  }
  if (url.pathname === '/api/health') {
    const feeds = listFeeds();
    const health = collectorsOn ? feedHealth(feeds, { pulse: pulse.summary(), startedAt: coverageStartedAt }) : [];
    return json(res, 200, { ok: true, refreshing:collectorQueue.busy, feeds, collecting: collectorsOn, feedHealth: health });
  }
  if (url.pathname === '/api/backups') {
    if (req.method === 'GET') return json(res,200,backups.status());
    if (req.method === 'POST') {
      try {
        await bodyJSON(req);
        const backup = backups.manual();
        return json(res,201,{backup,...backups.status()});
      } catch (error) {
        return json(res,400,{error:error.message});
      }
    }
    return json(res,405,{error:'Use GET or POST.'});
  }
  if (url.pathname === '/api/refresh') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Same-origin requests only' });
    if (!collectorsOn) return json(res, 409, { error:'Collection is paused.' });
    const result = requestRefresh();
    return json(res, result.refreshing ? 202 : 200, result);
  }
  if (url.pathname === '/api/live') {
    if (clients.size >= 100) return json(res, 503, { error: 'Too many live clients' });
    const light = url.searchParams.get('light') === '1';
    const initial = JSON.stringify(livePayload(snapshot(), light));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const write = createLiveWriter(res);
    clients.set(res, { light, write });
    const heartbeat = setInterval(() => write('event: heartbeat\ndata: ok\n\n'), 20000);
    res.once('close', () => { clients.delete(res); clearInterval(heartbeat); });
    write(`retry: 5000\nevent: snapshot\ndata: ${initial}\n\n`, true);
    return;
  }
  if (url.pathname === '/api/headlines' && req.method === 'GET') {
    const state = snapshot();
    if (url.searchParams.get('basis')!=='received') return json(res,200,{now:state.now,headlines:state.headlines,
      headlinesByDesk:state.headlinesByDesk,primaryHeadlines:state.primaryHeadlines,watchHeadlines:state.watchHeadlines});
    if (!receiptHeadlines.has(state)) receiptHeadlines.set(state,{now:state.now,...headlineViews(state.stories,{
      now:Date.parse(state.now),received:true,includeReport:headlineVisibility(state.reading)
    })});
    return json(res,200,receiptHeadlines.get(state));
  }
  // Live wall: CVEs NVD has published since local midnight, and the same date last year (lib/cvecount.mjs, hourly).
  if (url.pathname === '/api/cve-today') return json(res, 200, await cveToday.get());
  // Live wall market board (stock indices and crypto), refetched at most every 15 minutes.
  if (url.pathname === '/api/markets') {
    try { return json(res, 200, await markets.get()); } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (url.pathname === '/api/weather/outlook') {
    const day = Number(url.searchParams.get('day'));
    if (![1,2].includes(day)) return json(res,400,{error:'Use outlook day 1 or 2'});
    if (!collectorsOn) return json(res,200,{disabled:true});
    return json(res,200,await spcOutlook(day));
  }
  if (url.pathname === '/api/stream') {
    const channel = url.searchParams.get('channel') || '';
    if (!/^(UC[\w-]{22}|@[\w.-]{3,60})$/.test(channel)) return json(res, 400, { error: 'Use a YouTube channel ID or @handle' });
    const {code,data} = await resolveStream(channel,url.searchParams.get('refresh') === '1');
    return json(res,code,data);
  }
  const pages = { '/developing':'pages/developing.html','/developing/':'pages/developing.html', '/putin':'pages/putin.html','/putin/':'pages/putin.html', '/musk':'pages/musk.html','/musk/':'pages/musk.html', '/timeline':'pages/timeline.html','/timeline/':'pages/timeline.html', '/': 'pages/ops.html', '/ops': 'pages/ops.html', '/ops/': 'pages/ops.html', '/wall': 'pages/wall.html', '/wall/': 'pages/wall.html', '/feeds':'pages/feeds.html','/feeds/':'pages/feeds.html','/watch':'pages/watch.html','/watch/':'pages/watch.html','/kiosk':'pages/kiosk.html','/kiosk/':'pages/kiosk.html', '/sources': 'index.html', '/sources/': 'index.html' };
  let file;
  try { file = pages[url.pathname] || decodeURIComponent(url.pathname).replace(/^\//, ''); }
  catch { return json(res, 400, { error: 'Invalid path' }); }
  // Serve only public pages and assets. App pages live in pages/; index.html stays at the root for the GitHub Pages copy of Sources. Never expose SQLite, config, or source internals.
  if (!['pages/developing.html', 'pages/putin.html', 'pages/musk.html', 'pages/timeline.html', 'pages/ops.html', 'pages/wall.html', 'pages/feeds.html', 'pages/watch.html', 'pages/kiosk.html', 'index.html'].includes(file) && !/^assets\/[a-zA-Z0-9_./-]+$/.test(file)) return json(res, 404, { error: 'Not found' });
  if (file.split('/').some(part => part === '..' || part === '.')) return json(res, 404, { error: 'Not found' });
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const content = await readFile(target);
    const extension = path.extname(target);
    if (extension==='.html') res.setHeader('Content-Security-Policy',[
      file === 'pages/wall.html'
        ? "script-src 'self' https://www.youtube.com/iframe_api https://www.youtube.com/s/player/"
        : "script-src 'self'",
      "worker-src 'self' blob:", "object-src 'none'",
      "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"
    ].join('; '));
    res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': file.startsWith('assets/vendor/') ? 'public, max-age=86400' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { json(res, 404, { error: 'Not found' }); }
}
const port = Number(process.env.PORT || 8080), host = process.env.HOST || '127.0.0.1';
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Local port ${port} is already in use. Close the app using that port, then open Capstone Viewer again.`);
  } else {
    console.error('Capstone could not open its local server.',error.message);
  }
  process.exitCode = 1;
  shutdown();
});
server.listen(port, host, () => {
  const address = `http://${host}:${server.address().port}`;
  console.log(`Capstone Viewer → ${address}/ops`);
  if (process.connected) process.send({type:'ready',url:address},()=>{});
  if (collectorsOn) {
    try { requestRefresh(); }
    catch (error) { console.error('Could not start collectors',error.message); }
    void refreshEpss();
    void social.tick();
    pulse.start();
  }
  if (offlineNotice()) setTimeout(() => {
    const gap = offlineNotice();
    if (gap && !stopping) notifier.notice(offlineMessage(gap));
  },15000).unref();
});
const poll = setInterval(() => {
  try { requestRefresh(); }
  catch (error) { console.error('Could not schedule collectors', error.message); }
  void refreshEpss();
}, 5000);
const firstMaintenance = setTimeout(maintainLocalData, 4000);
const maintenance = setInterval(maintainLocalData, 5 * 60_000);
const socialPoll=setInterval(()=>{if(collectorsOn)void social.tick();},30000);
const pulsePush=setInterval(broadcastPulse,60000);
const storyPush=setInterval(()=>{try{notifier.flushStories();}catch(error){console.error('Story notification failed',error.message);}},5000);
// Clean stop: end live streams, fold the WAL back into the database file, close it. The desktop app asks for this over
// IPC ({type:'shutdown'}) because on Windows a signal kills the process outright and none of this would run.
function shutdown() {
  if (stopping) return; stopping = true;
  collectorQueue.stop();
  telegramAccount.shutdown();
  clearTimeout(firstMaintenance);clearInterval(maintenance);clearInterval(storyPush);clearInterval(poll);clearInterval(socialPoll);clearInterval(pulsePush);clearTimeout(broadcastTimer);pulse.stop();
  for (const res of clients.keys()) res.end();
  const finish = () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (error) { console.error('Database close failed', error.message); } process.exit(process.exitCode || 0); };
  server.close(finish); server.closeIdleConnections?.();
  // A request still in flight must not hold the stop open.
  setTimeout(finish, 2000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
if (desktopSession) {
  process.once('disconnect',shutdown);
  if (!process.connected) shutdown();
}
process.on('message', message => {
  if (message?.type === 'shutdown') {
    shutdown();
  } else if (message?.type === 'resume' && collectorsOn && !stopping) {
    coverageStartedAt = Date.now();
    const sleep = describeSleepGap(message.suspendedAt, coverageStartedAt);
    if (sleep) {
      offlineGap = sleep;
      offlineDismissed = false;
      notifier.notice(offlineMessage(sleep));
    }
    try { requestRefresh(); }
    catch (error) { console.error('Could not resume collectors',error.message); }
    void social.tick();
    pulse.check();
    pulse.start();
    broadcast();
  }
});

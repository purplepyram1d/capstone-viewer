import {createDeveloping} from './lib/developing.mjs';
import {createReading,sourceContext,sourceKey} from './lib/reading.mjs';
import {createStoryAlerts} from './lib/story-alerts.mjs';
import {createPutinTracker} from './lib/putin.mjs';
import {createReports} from './lib/reports.mjs';
import { createMuskTracker } from './lib/musk.mjs';
import http from 'node:http';
import { createTimeline } from './lib/timeline.mjs';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { collect, feeds, fetchText } from './lib/collectors.mjs';
import { DAY } from './lib/events.mjs';
import { createCredentials } from './lib/credentials.mjs';
import { createSocialManager } from './lib/social-manager.mjs';
import { createIntelligence } from './lib/intelligence.mjs';
import { createBgpPulse } from './lib/internet.mjs';
import { createCountryResolver, computeHotspots } from './lib/hotspots.mjs';
import { createEpss } from './lib/threats.mjs';
import { computeStatus } from './lib/status.mjs';
import { createCheckpoints, situation, buildDigest } from './lib/digest.mjs';
import { buildBriefing } from './lib/briefing.mjs';
import { createNotifier } from './lib/notifier.mjs';
import { describeOffline } from './lib/offline.mjs';
import { feedHealth, withGaps } from './lib/feedhealth.mjs';
import { topHeadlines } from './lib/headlines.mjs';
import { relabelLegacy } from './lib/gdelt.mjs';
import { createMarkets } from './lib/markets.mjs';
import { createBackups } from './lib/backup.mjs';

// A stray rejection (a failed poll, a request handler) is logged, not fatal: collection keeps running. A synchronous
// uncaught exception still ends the process, and the desktop app restarts the collector.
process.on('unhandledRejection', error => console.error('Unhandled rejection (collection continues):', error?.stack || error));

const root = path.dirname(fileURLToPath(import.meta.url));
const countries = JSON.parse(readFileSync(path.join(root, 'assets', 'countries.json')));
const resolveCountry = createCountryResolver(JSON.parse(readFileSync(path.join(root, 'assets', 'world.json'))), countries);
const dataDir = process.env.DATA_DIR || path.join(root, 'runtime');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'events.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS feeds (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
const putEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, data=excluded.data');
const putFeed = db.prepare('INSERT INTO feeds VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
// GDELT roll-ups stored before 2026-11-04 were titled "Fighting reported in X"; relabel them once, through this connection.
// json_valid() first everywhere SQL reads into the JSON: one malformed row (a partial corruption) otherwise fails the whole query.
{ const old = db.prepare(`SELECT id, ts, data FROM events WHERE json_valid(data) AND json_extract(data,'$.source')='GDELT' AND json_extract(data,'$.title') LIKE 'Fighting reported in %'`).all();
  if (old.length) { db.exec('BEGIN'); try { for (const r of old) { const e = relabelLegacy(JSON.parse(r.data)); if (e) putEvent.run(r.id, r.ts, JSON.stringify(e)); } db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); console.error('GDELT relabel skipped:', error.message); } } }
const clients = new Map();
const serverStartedAt = Date.now();
let refreshing = false, lastRefresh = 0;
const streamCache = new Map();
const credentials=await createCredentials();
const tokens={radar:await createCredentials('radar','CLOUDFLARE_RADAR_TOKEN'),abusech:await createCredentials('abusech','ABUSECH_AUTH_KEY')};
const providerNames={radar:'a Cloudflare Radar API token',abusech:'an abuse.ch Auth-Key'};
const intelligence=createIntelligence(db);
const epss=createEpss(db);
const checkpoints=createCheckpoints(db);
const backups=createBackups(db,path.join(dataDir,'backups'));
// Was collection off before this start? Checkpoints are written every 15 minutes while collecting, so the newest one
// marks the last time the app was working. The desktop passes how its previous run ended (lifecycle log).
const offlineGap=(()=>{const last=checkpoints.latest();if(!last)return null;const minutes=Math.round((serverStartedAt-Date.parse(last))/60000);if(!(minutes>=45))return null;let previous=null;try{previous=JSON.parse(process.env.CAPSTONE_PREVIOUS_RUN||'null');}catch{}const gap={from:last,to:new Date(serverStartedAt).toISOString(),minutes,previous};return {...gap,...describeOffline(gap)};})();
const offlineMessage=gap=>({title:gap.title,body:gap.body,path:'/ops'});
let offlineDismissed=false;
const offlineNotice=()=>offlineGap&&!offlineDismissed&&Date.now()-serverStartedAt<86400000?offlineGap:null;
// Windows toasts are shown by the desktop process; in browser/server mode there is no one to hand them to.
const desktopNotify=process.env.CAPSTONE_DESKTOP==='1'&&typeof process.send==='function';
const notifier=createNotifier(db,message=>{if(desktopNotify)process.send({type:'notify',...message});});
const reading=createReading(db),timeline=createTimeline(db,reading);
const muskTracker=createMuskTracker(db);
const putinTracker=createPutinTracker(db);
const reportDetails=createReports(db);
const getDevelopingReport=db.prepare('SELECT data FROM events WHERE id=?');
const developing=createDeveloping(db,{lookupReports:ids=>ids.map(id=>getDevelopingReport.get(id)).filter(Boolean).map(row=>JSON.parse(row.data))});
const storyAlerts=createStoryAlerts(db);notifier.baselineStories(storyAlerts.list());
function storeEvents(events){db.exec('BEGIN');try{for(const e of events)putEvent.run(e.id,e.ts,JSON.stringify(e));intelligence.evaluate(events);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
const social=createSocialManager(db,credentials,broadcast,storeEvents);
const collectorsOn=process.env.CAPSTONE_COLLECTORS!=='off';
const markets=createMarkets({enabled:collectorsOn});
const pulse=createBgpPulse({onSurge:e=>{if(e){try{storeEvents([e]);}catch(error){console.error('Could not store routing surge',error.message);}broadcast();}},onChange:()=>broadcastPulse()});
function feedStatus(f){
  const stored=JSON.parse(db.prepare('SELECT data FROM feeds WHERE id = ?').get(f.id)?.data || '{}');
  if(f.requires&&!tokens[f.requires].get())return {...stored,state:'needs-key',error:`Connect ${providerNames[f.requires]} on the Feeds page.`};
  return {state:'waiting',...stored};
}
// The working window: every report from the last 8 days (the baselines need a full week, so no row cap),
// plus only critical reports (score 85+, or an outage still ongoing) back to the 30-day retention limit.
function windowReports() {
  const now = Date.now();
  return db.prepare(`SELECT data FROM events WHERE json_valid(data) AND (ts >= ? OR (ts >= ? AND (json_extract(data,'$.score') >= 85 OR json_extract(data,'$.ongoing') = 1))) AND coalesce(json_extract(data,'$.tracker'),'') NOT IN ('musk','putin') ORDER BY ts DESC LIMIT 15000`)
    .all(new Date(now - 8 * DAY).toISOString(), new Date(now - 30 * DAY).toISOString()).map(r => JSON.parse(r.data));
}
function snapshot() {
  const raw=intelligence.decorate(windowReports());
  const annotate=e=>({...e,source_context:sourceContext(e),source_key:sourceKey(e)});
  const decorated={events:epss.attach(raw.events.map(annotate)),stories:epss.attach(raw.stories.map(s=>({...annotate(s),reports:s.reports.map(annotate)})))};
  developing.sync(decorated.stories,decorated.events);
  storyAlerts.collect();
  const feedList=[...feeds.map(f => ({ id: f.id, name: f.name, url: f.url, ...feedStatus(f) })),...social.list()];
  const since=Object.fromEntries(feedList.filter(f=>f.firstSuccess).map(f=>[f.id,Date.parse(f.firstSuccess)]));
  const hotspots=computeHotspots(decorated.events,{resolve:resolveCountry,countries,since}),pulseState=collectorsOn?pulse.summary():null;
  const problems=feedHealth(feedList,{pulse:pulseState,startedAt:serverStartedAt});
  return { now: new Date().toISOString(), refreshing, ...decorated, headlines: topHeadlines(decorated.stories), developing:developing.list(), storyAlertUnread:storyAlerts.list().filter(a=>!a.read_at).length, hotspots, pulse: pulseState, status: withGaps(computeStatus({reports:decorated.events,hotspots,pulse:pulseState,since}),problems), feedHealth: problems, watch:intelligence.state(),
    feeds: feedList,reading:reading.state(), offline: offlineNotice() };
}
// Live payloads. Map pages get stories (each already carries its reports) without the duplicate flat events
// list; every other page gets a light snapshot with only the status, watch and feed state it renders.
const livePayload = (snap, light) => { const { events, stories, ...rest } = snap; return light ? { now: rest.now, refreshing: rest.refreshing, status: rest.status, feedHealth: rest.feedHealth, storyAlertUnread: rest.storyAlertUnread, hotspots: rest.hotspots, pulse: rest.pulse, watch: rest.watch, reading:rest.reading, feeds: rest.feeds, offline: rest.offline, headlines: rest.headlines } : { ...rest, stories }; };
const trayNames = { green: 'Normal', amber: 'Elevated', red: 'Severe' }, trayTiles = { internet: 'Internet', cyber: 'Cyber', conflict: 'Conflict', social: 'Chatter' };
const trayLine = snap => [...(snap.status || []).map(t => `${trayTiles[t.id] || t.label} ${trayNames[t.level] || t.level}`), ...(snap.feedHealth?.length ? [`${snap.feedHealth.length} feed${snap.feedHealth.length === 1 ? '' : 's'} down`] : [])].join(' · ');
// A refresh or a round of social polls fires many updates in a burst; coalesce them into one snapshot
// at most every 2 seconds, never holding one back more than 5 seconds.
let broadcastTimer = null, broadcastDeadline = 0;
function broadcast() {
  const now = Date.now(); if (!broadcastDeadline) broadcastDeadline = now + 5000;
  clearTimeout(broadcastTimer); broadcastTimer = setTimeout(flushBroadcast, Math.max(0, Math.min(2000, broadcastDeadline - now)));
}
function flushBroadcast() {
  broadcastTimer = null; broadcastDeadline = 0;
  // Runs from a timer: a throw here would be uncaught and stop the server, so a failed snapshot skips this broadcast.
  let snap; try { snap = snapshot(); } catch (error) { console.error('Snapshot failed; broadcast skipped', error?.stack || error); return; }
  const full = `event: snapshot\ndata: ${JSON.stringify(livePayload(snap, false))}\n\n`, light = `event: snapshot\ndata: ${JSON.stringify(livePayload(snap, true))}\n\n`;
  for (const [res, client] of clients) res.write(client.light ? light : full);
  try { notifier.check({ status: snap.status, watch: snap.watch, feedHealth: snap.feedHealth,storyAlerts:storyAlerts.active() }); } catch (error) { console.error('Notification check failed', error.message); }
  // One-line status for the tray icon's tooltip and menu header.
  if (desktopNotify) process.send({ type: 'tray-status', text: trayLine(snap) });
}
function broadcastPulse() { if(!collectorsOn)return;try{const message = `event: pulse\ndata: ${JSON.stringify(pulse.summary())}\n\n`; for (const res of clients.keys()) res.write(message);}catch(error){console.error('Pulse push failed',error.message);} }
async function refresh() {
  if (refreshing) return;
  refreshing = true; lastRefresh = Date.now(); broadcast();
  // Whatever fails, `refreshing` is cleared, or no refresh would ever run again.
  try {
  await Promise.allSettled(feeds.map(async feed => {
    const previous = JSON.parse(db.prepare('SELECT data FROM feeds WHERE id=?').get(feed.id)?.data || '{}');
    let status;
    if(feed.intervalMs&&previous.lastAttempt&&Date.now()-Date.parse(previous.lastAttempt)<feed.intervalMs)return;
    if (feed.requires && !tokens[feed.requires].get()) return;
    try {
      const { events, usedUrl } = await collect(feed, feed.requires ? tokens[feed.requires].get() : '');
      // feed_id and firstSuccess let baselines count only days a source has really been collected.
      storeEvents(events.map(e => ({ ...e, feed_id: feed.id })));
      status = { state: 'ok', count: events.length, firstSuccess: previous.firstSuccess || new Date().toISOString(), lastSuccess: new Date().toISOString(), usedUrl, error: null };
    } catch (e) { status = { ...previous, state: 'error', error: String(e.message).slice(0, 180), failingSince: previous.state === 'error' && previous.failingSince ? previous.failingSince : new Date().toISOString() }; }
    putFeed.run(feed.id, JSON.stringify({ ...status, lastAttempt: new Date().toISOString() }));
    broadcast();
  }));
  db.prepare('DELETE FROM events WHERE ts < ?').run(new Date(Date.now() - 30 * DAY).toISOString());
  intelligence.prune();
  try{await epss.refresh(db.prepare("SELECT data FROM events WHERE data LIKE '%CVE-%'").all().flatMap(r=>JSON.parse(r.data).cves||[]));}catch(error){console.error('EPSS refresh failed',error.message);}
  try{checkpoints.record(situation(snapshot()));}catch(error){console.error('Checkpoint failed',error.message);}
  try{const file=backups.daily();if(file)console.log(`Database backup written: ${file}`);}catch(error){console.error('Database backup failed',error.message);}
  } catch (error) { console.error('Refresh failed', error?.stack || error); }
  finally { refreshing = false; broadcast(); }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function bodyJSON(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new Error('Send JSON data.');
  let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw new Error('Request is too large.');}
  let value;try{value=JSON.parse(body);}catch{throw new Error('Invalid JSON.');}
  if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Expected a JSON object.');return value;
}

// Every request goes through handle(); an error in any route answers 500 and is logged instead of stopping the server.
const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error('Request failed', req.method, req.url, error?.stack || error);
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
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(res,403,{error:'Same-origin requests only'});
  if (url.pathname === '/sources/') { res.writeHead(308, { Location: '/sources' }); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !(/^\/api\/developing(?:\/[a-zA-Z0-9_-]{1,64})?$/.test(url.pathname)&&['POST','PATCH'].includes(req.method)) && !(/^\/api\/reports\/[a-zA-Z0-9_-]{1,64}\/notes$/.test(url.pathname)&&req.method==='PUT') && !(/^\/api\/timeline\/[a-zA-Z0-9_-]{1,64}\/tags$/.test(url.pathname)&&req.method==='PUT') && !((req.method === 'POST' && url.pathname === '/api/refresh')||/^\/api\/(reading$|social\/|watch(?:\/|$)|stories\/|events\/[^/]+\/location$|providers\/(?:radar|abusech)\/credentials$|notifications(?:\/test)?$|offline\/dismiss$)/.test(url.pathname))) return json(res, 405, { error: 'Method not allowed' });
  if(url.pathname==='/api/reading'){try{if(req.method==='GET')return json(res,200,reading.state());if(req.method==='PUT'){const result=reading.update(await bodyJSON(req));broadcast();return json(res,200,result);}return json(res,405,{error:'Use GET or PUT.'});}catch(error){return json(res,400,{error:error.message});}}
  if(url.pathname==='/api/offline/dismiss'){if(req.method!=='POST')return json(res,405,{error:'Use POST.'});offlineDismissed=true;broadcast();return json(res,200,{dismissed:true});}
  if(url.pathname==='/api/notifications'||url.pathname==='/api/notifications/test'){
    try{
      if(url.pathname==='/api/notifications/test'){if(req.method!=='POST')return json(res,405,{error:'Use POST.'});if(!desktopNotify)return json(res,409,{error:'Windows notifications need the desktop app.'});notifier.test();return json(res,202,{sent:true});}
      if(req.method==='GET')return json(res,200,{...notifier.settings(),available:desktopNotify});
      if(req.method==='PUT')return json(res,200,{...notifier.update(await bodyJSON(req)),available:desktopNotify});
      return json(res,405,{error:'Unsupported notification operation.'});
    }catch(error){return json(res,400,{error:String(error.message).slice(0,200)});}
  }
  const provider=url.pathname.match(/^\/api\/providers\/(radar|abusech)\/credentials$/)?.[1];
  if(provider){
    try{
      if(req.method==='GET')return json(res,200,tokens[provider].status());
      if(req.method==='PUT'||req.method==='DELETE'){const result=await tokens[provider].set(req.method==='PUT'?(await bodyJSON(req)).token:'');broadcast();if(req.method==='PUT'&&collectorsOn&&!refreshing)void refresh();return json(res,200,result);}
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
  const reportRoute=url.pathname.match(/^\/api\/reports\/([a-zA-Z0-9_-]{1,64})(\/notes)?$/);
  if(reportRoute){try{if(req.method==='GET'&&!reportRoute[2])return json(res,200,reportDetails.get(reportRoute[1]));if(req.method==='PUT'&&reportRoute[2])return json(res,200,reportDetails.save(reportRoute[1],(await bodyJSON(req)).note));return json(res,405,{error:'Unsupported report operation.'});}catch(error){return json(res,400,{error:error.message});}}
  if(url.pathname==='/api/putin'&&req.method==='GET'){const result=putinTracker.list(url.searchParams);result.feeds=feeds.filter(f=>f.tracker==='putin').map(f=>({id:f.id,name:f.name,...feedStatus(f)}));return json(res,200,result);}
  if(url.pathname==='/api/musk'&&req.method==='GET'){const result=muskTracker.list(url.searchParams);result.feeds=feeds.filter(f=>f.tracker==='musk').map(f=>({id:f.id,name:f.name,...feedStatus(f)}));return json(res,200,result);}
  if(url.pathname==='/api/timeline'&&req.method==='GET')return json(res,200,timeline.list(url.searchParams));
  const tagRoute=url.pathname.match(/^\/api\/timeline\/([a-zA-Z0-9_-]{1,64})\/tags$/);
  if(tagRoute&&req.method==='PUT'){try{const result=timeline.tags(tagRoute[1],(await bodyJSON(req)).tags);broadcast();return json(res,200,result);}catch(error){return json(res,400,{error:error.message});}}
  if(url.pathname==='/api/watch'&&req.method==='GET')return json(res,200,intelligence.state());
  if(url.pathname.startsWith('/api/watch/')||url.pathname.startsWith('/api/stories/')||/^\/api\/events\/[^/]+\/location$/.test(url.pathname)){
    try{
      let result;
      const rule=url.pathname.match(/^\/api\/watch\/rules\/([a-zA-Z0-9-]{1,64})$/),alert=url.pathname.match(/^\/api\/watch\/alerts\/([a-f0-9]{24})$/),location=url.pathname.match(/^\/api\/events\/([a-zA-Z0-9_-]{1,64})\/location$/);
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
          if(!feed.enabled)return json(res,409,{error:'Enable this feed before polling.'});
          if(feed.platform==='x'&&!social.connection().configured)return json(res,409,{error:'Connect an X API token first.'});
          const s=social.status(id);if(s.nextPoll&&Date.parse(s.nextPoll)>Date.now())return json(res,429,{error:`Next poll after ${s.nextPoll}.`});
          if(process.env.CAPSTONE_COLLECTORS!=='off')void social.poll(id);return json(res,202,{queued:true});
        }
        if(!match[2]&&req.method==='PATCH'){const next=social.update(id,await bodyJSON(req));if(process.env.CAPSTONE_COLLECTORS!=='off')void social.poll(id);return json(res,200,next);}
        if(!match[2]&&req.method==='DELETE'){social.remove(id);return json(res,200,{removed:true,postsRetained:true});}
      }
      return json(res,405,{error:'Unsupported feed operation.'});
    }catch(error){return json(res,400,{error:String(error.message).slice(0,200)});}
  }
  if (url.pathname === '/api/events') return json(res, 200, snapshot());
  if (url.pathname === '/api/digest') {
    const since=Date.parse(url.searchParams.get('since')||'');
    if(!Number.isFinite(since)||since>Date.now()||since<Date.now()-8*DAY)return json(res,400,{error:'Use a since time within the last 8 days.'});
    const snap=snapshot(),iso=new Date(since).toISOString();
    const then=checkpoints.at(iso),between=checkpoints.between(iso);
    const digest=buildDigest({since:iso,then,between,current:situation(snap),status:snap.status,events:snap.events,countries});
    digest.briefing=buildBriefing({digest,then,between,events:snap.events,threads:developing.observations(iso),gaps:snap.feedHealth});
    return json(res,200,digest);
  }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, refreshing, feeds: snapshot().feeds });
  if (url.pathname === '/api/refresh') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'Same-origin requests only' });
    if (Date.now() - lastRefresh < 30000) return json(res, 429, { error: 'Feeds refresh every five minutes. Try again in 30 seconds.' });
    void refresh(); return json(res, 202, { refreshing: true });
  }
  if (url.pathname === '/api/live') {
    if (clients.size >= 100) return json(res, 503, { error: 'Too many live clients' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const light = url.searchParams.get('light') === '1';
    res.write(`retry: 5000\nevent: snapshot\ndata: ${JSON.stringify(livePayload(snapshot(), light))}\n\n`);
    clients.set(res, { light });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
    req.on('close', () => { clients.delete(res); clearInterval(heartbeat); }); return;
  }
  // Live wall market board (stock indices and crypto), refetched at most every 15 minutes.
  if (url.pathname === '/api/markets') {
    try { return json(res, 200, await markets.get()); } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if (url.pathname === '/api/stream') {
    const channel = url.searchParams.get('channel') || '';
    if (!/^(UC[\w-]{22}|@[\w.-]{3,60})$/.test(channel)) return json(res, 400, { error: 'Use a YouTube channel ID or @handle' });
    const cached = streamCache.get(channel);
    if (cached && cached.until > Date.now()) return json(res, cached.code, cached.data);
    try {
      const html = await fetchText(`https://www.youtube.com/${channel.startsWith('@') ? channel : `channel/${channel}`}/live`);
      const videoId = html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1] || html.match(/<link rel="canonical" href="https:\/\/www.youtube.com\/watch\?v=([\w-]{11})"/)?.[1];
      if (!videoId || !/"isLive(?:Now|Content)":true/.test(html)) throw new Error('No live video found. Paste a current YouTube watch URL using Edit streams.');
      const data = { videoId }; streamCache.set(channel, { until: Date.now() + 300000, code: 200, data }); return json(res, 200, data);
    } catch (e) { const data = { error: e.message }; streamCache.set(channel, { until: Date.now() + 60000, code: 502, data }); return json(res, 502, data); }
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
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': file.startsWith('assets/vendor/') ? 'public, max-age=86400' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { json(res, 404, { error: 'Not found' }); }
}
const port = Number(process.env.PORT || 8080), host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => { const address = `http://${host}:${server.address().port}`; console.log(`Capstone Viewer → ${address}/ops`); process.send?.({ type: 'ready', url: address }); if(collectorsOn){void refresh();void social.tick();pulse.start();} if(offlineGap)setTimeout(()=>notifier.notice(offlineMessage(offlineGap)),15000); });
const poll = setInterval(() => { if(collectorsOn)void refresh(); }, 300000);
const socialPoll=setInterval(()=>{if(collectorsOn)void social.tick();},30000);
const pulsePush=setInterval(broadcastPulse,60000);
const storyPush=setInterval(()=>{try{notifier.flushStories();}catch(error){console.error('Story notification failed',error.message);}},5000);
// Clean stop: end live streams, fold the WAL back into the database file, close it. The desktop app asks for this over
// IPC ({type:'shutdown'}) because on Windows a signal kills the process outright and none of this would run.
let stopping = false;
function shutdown() {
  if (stopping) return; stopping = true;
  clearInterval(storyPush);clearInterval(poll);clearInterval(socialPoll);clearInterval(pulsePush);clearTimeout(broadcastTimer);pulse.stop();
  for (const res of clients.keys()) res.end();
  const finish = () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch (error) { console.error('Database close failed', error.message); } process.exit(0); };
  server.close(finish); server.closeIdleConnections?.();
  // A request still in flight must not hold the stop open.
  setTimeout(finish, 2000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('message', message => { if (message?.type === 'shutdown') shutdown(); });

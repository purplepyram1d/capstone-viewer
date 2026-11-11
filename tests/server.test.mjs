import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const dataDir=path.resolve('runtime',`test-${Date.now()}`);mkdirSync(dataDir,{recursive:true});
// Tests use a dedicated database, never the live app's collected events.
const db=new DatabaseSync(path.join(dataDir,'events.sqlite'));
db.exec('CREATE TABLE events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, data TEXT NOT NULL)');
const record={id:'test-report',ts:new Date().toISOString(),title:'Integration fixture',url:'https://example.org/report',category:'cyber'};
db.prepare('INSERT INTO events VALUES (?,?,?)').run(record.id,record.ts,JSON.stringify(record));
// Older than the 8-day working window: only critical reports and ongoing outages should still be served.
for(const [id,patch] of [['old-routine',{score:40}],['old-critical',{score:90}],['old-outage',{score:60,kind:'outage',ongoing:true}]]){const ts=new Date(Date.now()-12*86400000).toISOString();db.prepare('INSERT INTO events VALUES (?,?,?)').run(id,ts,JSON.stringify({id,ts,title:id,url:'https://example.org/'+id,category:'cyber',...patch}));}
const muskFixture={id:'musk-fixture',ts:new Date(Date.now()-1000).toISOString(),title:'Tesla and SpaceX announcement',url:'https://news.google.com/rss/articles/test',source:'Test publisher',tracker:'musk',entities:['tesla','spacex'],category:'geo',score:35};
db.prepare('INSERT INTO events VALUES (?,?,?)').run(muskFixture.id,muskFixture.ts,JSON.stringify(muskFixture));
const putinFixture={id:'putin-fixture',ts:new Date(Date.now()-1000).toISOString(),title:'Putin announces talks with Ukraine',url:'https://news.google.com/rss/articles/putin-test',source:'Test publisher',tracker:'putin',entities:['putin','diplomacy','ukraine'],category:'geo',score:35};
db.prepare('INSERT INTO events VALUES (?,?,?)').run(putinFixture.id,putinFixture.ts,JSON.stringify(putinFixture));
// A GDELT roll-up stored with the pre-2026-11-04 title; the server relabels it at startup.
{const ts=new Date(Date.now()-2*3600000).toISOString();db.prepare('INSERT INTO events VALUES (?,?,?)').run('gdelt-legacy',ts,JSON.stringify({id:'gdelt-legacy',ts,source:'GDELT',category:'geo',url:'https://example.org/gdelt',score:40,title:'Fighting reported in Ukraine: 6 machine-coded events from 4 outlets today',summary:'GDELT coded 6 news reports of armed conflict in Ukraine, mostly Kharkiv, from 4 separate outlets. Not verified.'}));}
// A checkpoint from 3 hours ago: the server starts after a collection gap and should say so.
db.exec('CREATE TABLE checkpoints (ts TEXT PRIMARY KEY, data TEXT NOT NULL)');{const ts=new Date(Date.now()-3*3600000).toISOString();db.prepare('INSERT INTO checkpoints VALUES (?,?)').run(ts,JSON.stringify({ts,levels:{},hotspots:[],outages:[],epss:{}}));}
db.close();
const child=fork(new URL('../server.mjs',import.meta.url),[],{env:{...process.env,PORT:'0',DATA_DIR:dataDir,CAPSTONE_COLLECTORS:'off'},silent:true});
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),10000);child.once('message',m=>{clearTimeout(timer);resolve(m.url);});child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
test('local server serves all views, persists events, pushes SSE, and protects internal files',async t=>{
 // Stop the server, wait for it to release the database, then remove this run's data folder so runtime/ does not fill with test-* folders.
 t.after(async()=>{child.kill();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});});const base=await ready;
 for(const route of ['/developing','/assets/developing.js','/putin','/musk','/timeline','/assets/report-drawer.js','/assets/navigation.js','/assets/navigation.css','/assets/musk.js','/ops','/wall','/sources','/feeds','/watch','/kiosk','/assets/ops.js','/assets/kiosk.js','/assets/themes.css','/assets/theme.js','/assets/world.json'])assert.equal((await fetch(base+route)).status,200,route);
 for(const route of ['/runtime/events.sqlite','/server.mjs','/config/headquarters.json','/assets%2f..%2fserver.mjs'])assert.equal((await fetch(base+route)).status,404,route);
 // Collectors are off in tests, so the market board must not reach out; the light live snapshot (live wall) carries ranked headlines but no story list.
 assert.equal((await(await fetch(base+'/api/markets')).json()).disabled,true);
 {const ac=new AbortController(),reader=(await fetch(base+'/api/live?light=1',{signal:ac.signal})).body.getReader();let text='';while(!text.includes('\n\n',text.indexOf('data: '))){const {value,done}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);}ac.abort();
  const snap=JSON.parse(text.slice(text.indexOf('data: ')+6).split('\n\n')[0]);assert.ok(snap.headlines.rows.some(h=>h.title==='Integration fixture'),'light snapshot carries headlines');assert.equal(snap.stories,undefined);}
 for(const route of ['/assets/desk-model.js','/assets/desks.js'])assert.equal((await fetch(base+route)).status,200,route);
 const data=await(await fetch(base+'/api/events')).json();assert.equal(data.events[0].id,record.id);assert.ok(Array.isArray(data.developing));const follow=await fetch(base+'/api/developing/follow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storyId:data.stories.find(s=>s.report_ids.includes('test-report')).id})});assert.equal(follow.status,200);const thread=await follow.json();assert.equal(thread.followed,true);assert.equal((await fetch(base+'/api/developing/'+thread.id,{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({state:'resolved'})})).status,403);assert.equal((await fetch(base+'/api/developing/'+thread.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'developing',note:'Integration assessment'})})).status,200);const threadDetail=await(await fetch(base+'/api/developing/'+thread.id)).json();assert.equal(threadDetail.state,'developing');assert.ok(threadDetail.changes.some(c=>c.kind==='analyst_note'));assert.equal(data.feeds.filter(f=>!f.id.startsWith('musk-')&&!f.id.startsWith('putin-')).length,13);assert.equal(data.feeds.filter(f=>f.id.startsWith('musk-')).length,8);const musk=await(await fetch(base+'/api/musk?entity=tesla')).json();assert.equal(musk.total,1);assert.equal(musk.events[0].id,'musk-fixture');assert.equal(musk.feeds.length,8);const putin=await(await fetch(base+'/api/putin?entity=putin')).json();assert.equal(putin.total,1);assert.equal(putin.events[0].id,'putin-fixture');assert.equal(putin.feeds.length,7);const grouped=await(await fetch(base+'/api/musk?view=stories')).json();assert.equal(grouped.view,'stories');assert.equal(grouped.events[0].report_count,1);const detail=await(await fetch(base+'/api/reports/test-report')).json();assert.equal(detail.id,'test-report');assert.equal((await fetch(base+'/api/reports/test-report/notes',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({note:'blocked'})})).status,403);assert.equal((await fetch(base+'/api/reports/test-report/notes',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:'Integration note'})})).status,200);assert.equal((await(await fetch(base+'/api/reports/test-report')).json()).notes.note,'Integration note');assert.equal(data.feeds.find(f=>f.id==='threatfox').state,'needs-key');assert.equal((await fetch(base+'/api/providers/evil/credentials')).status,404);assert.equal((await fetch(base+'/api/digest?since=bad')).status,400);const ns=await(await fetch(base+'/api/notifications')).json();assert.equal(ns.available,false);assert.equal(ns.severe,true);assert.equal((await fetch(base+'/api/notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({quietStart:'nope'})})).status,400);assert.equal((await fetch(base+'/api/notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({elevated:true})})).status,200);assert.equal((await fetch(base+'/api/notifications/test',{method:'POST'})).status,409);const digest=await(await fetch(base+'/api/digest?since='+new Date(Date.now()-3600000).toISOString())).json();assert.equal(digest.partial,false,'the seeded 3-hour-old checkpoint covers a 1-hour window');assert.ok(Array.isArray(digest.tiles));assert.ok(Array.isArray(data.hotspots));assert.equal(data.pulse,null,'pulse is off with collectors off');
 assert.equal(data.feeds.find(f=>f.id==='radar-outages').state,'needs-key');
 assert.match(data.events.find(e=>e.id==='gdelt-legacy').title,/^GDELT signal: 6 news reports from 4 outlets machine-coded as armed violence in Ukraine on \d{4}-\d{2}-\d{2}$/,'old GDELT titles are relabelled at startup');
 assert.ok(data.offline,'a 3-hour gap is reported');assert.ok(data.offline.minutes>=179);assert.match(data.offline.title,/^Capstone was offline for 3 h/);assert.match(data.offline.cause,/not recorded/);
 assert.equal((await fetch(base+'/api/offline/dismiss')).status,405);assert.equal((await fetch(base+'/api/offline/dismiss',{method:'POST'})).status,200);assert.equal((await(await fetch(base+'/api/events')).json()).offline,null,'dismissed');
 assert.deepEqual(data.events.map(e=>e.id).sort(),['gdelt-legacy','old-critical','old-outage','test-report'],'routine reports past 8 days drop out; critical and ongoing stay');
 const liveFirst=async q=>{const r=await fetch(base+'/api/live'+q),reader=r.body.getReader();let text='';while(!text.includes('\n\n',text.indexOf('data:'))){const {value}=await reader.read();text+=new TextDecoder().decode(value);}await reader.cancel();return JSON.parse(text.slice(text.indexOf('data: ')+6,text.indexOf('\n\n',text.indexOf('data:'))));};
 const fullLive=await liveFirst(''),lightLive=await liveFirst('?light=1');
 assert.ok(Array.isArray(fullLive.stories));assert.equal(fullLive.events,undefined,'map pages get stories only');
 assert.equal(lightLive.stories,undefined);assert.ok(Array.isArray(lightLive.status));assert.ok(lightLive.watch);assert.ok(Array.isArray(lightLive.feeds));
 const radarPut=await fetch(base+'/api/providers/radar/credentials',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'radar-test-token'})});assert.equal(radarPut.status,200);
 assert.equal((await(await fetch(base+'/api/providers/radar/credentials')).text()).includes('radar-test-token'),false);
 assert.equal((await fetch(base+'/api/providers/radar/credentials',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({token:'x'})})).status,403);
 assert.equal((await fetch(base+'/api/providers/radar/credentials',{method:'DELETE'})).status,200);
 const response=await fetch(base+'/api/live');assert.match(response.headers.get('content-type'),/text\/event-stream/);const reader=response.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/event: snapshot/);await reader.cancel();
 assert.equal((await fetch(base+'/api/refresh',{method:'POST',headers:{Origin:'https://unrelated.example'}})).status,403);
 assert.equal((await fetch(base+'/api/stream?channel=..%2Fsecret')).status,400);
 const post=async(route,method,body,extra={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});
 assert.equal((await post('/api/reading','PUT',{sources:[],subjects:['fixture']},{Origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/reading','PUT',{sources:[],subjects:['fixture']})).status,200);
 assert.equal((await(await fetch(base+'/api/timeline?q=Integration%20fixture')).json()).total,0);
 assert.equal((await(await fetch(base+'/api/timeline?q=Integration%20fixture&includeMuted=1')).json()).total,1);
 assert.ok((await(await fetch(base+'/api/events')).json()).events.some(e=>e.id==='test-report'),'reading mutes never remove status/alert inputs');
 assert.equal((await post('/api/reading','PUT',{sources:[],subjects:[]})).status,200);
 assert.equal((await(await fetch(base+'/api/developing/alerts')).json()).alerts.length,0,'follow and analyst notes do not alert');
 const storyFixtureDb=new DatabaseSync(path.join(dataDir,'events.sqlite'));
 storyFixtureDb.prepare('UPDATE events SET data=? WHERE id=?').run(JSON.stringify({...record,summary:'Source reports a new development'}),record.id);storyFixtureDb.close();
 const storyInbox=await(await fetch(base+'/api/developing/alerts')).json();assert.equal(storyInbox.alerts.length,1);assert.equal(storyInbox.alerts[0].thread_id,thread.id);assert.equal(storyInbox.alerts[0].changes[0].url,record.url);
 assert.equal((await post('/api/developing/alerts','PATCH',{id:'all'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/developing/alerts','PATCH',{id:storyInbox.alerts[0].id})).status,200);assert.ok((await(await fetch(base+'/api/developing/alerts')).json()).alerts[0].read_at);
 assert.equal((await post('/api/developing/alerts','PATCH',{id:{invalid:true}})).status,400);
 assert.equal((await post('/api/notifications','PUT',{stories:false})).status,200);assert.equal((await(await fetch(base+'/api/notifications')).json()).stories,false);
 assert.equal((await post('/api/social/feeds','POST',{platform:'telegram',input:'@testchannel'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/social/feeds','POST',{platform:'telegram',input:'https://evil.example/test'})).status,400);
 const added=await post('/api/social/feeds','POST',{platform:'telegram',input:'@testchannel',enabled:false});assert.equal(added.status,201);const feed=await added.json();
 assert.equal((await post('/api/social/feeds','POST',{platform:'telegram',input:'@TESTCHANNEL'})).status,400);
 const saved=await(await fetch(base+'/api/social/feeds')).json();assert.equal(saved.feeds[0].id,feed.id);assert.equal(saved.feeds[0].state,'paused');
 assert.equal((await post('/api/social/feeds/'+feed.id,'PATCH',{name:'Updated feed',category:'geo'})).status,200);
 assert.equal((await post('/api/social/feeds/'+feed.id+'/refresh','POST')).status,409);
 assert.equal((await post('/api/social/credentials','PUT',{bearerToken:'integration-test-token'})).status,200);
 const statusText=await(await fetch(base+'/api/social/credentials')).text();assert.equal(statusText.includes('integration-test-token'),false);
 assert.equal((await post('/api/social/credentials','DELETE')).status,200);
 assert.equal((await post('/api/social/feeds/'+feed.id,'DELETE')).status,200);
 assert.equal((await(await fetch(base+'/api/social/feeds')).json()).feeds.length,0);
 const ruleResponse=await post('/api/watch/rules','POST',{name:'Integration watch',terms:['fixture']});assert.equal(ruleResponse.status,200);const rule=await ruleResponse.json();
 let watch=await(await fetch(base+'/api/watch')).json();assert.equal(watch.unread,1);assert.equal(watch.alerts[0].backfill,true);
 assert.equal((await post('/api/watch/read-all','POST',{})).status,200);assert.equal((await(await fetch(base+'/api/watch')).json()).unread,0);
 assert.equal((await post('/api/events/test-report/location','PUT',{lat:51,lon:30,place:'Manual reference',note:'Integration check'})).status,200);
 const annotated=await(await fetch(base+'/api/events')).json();assert.equal(annotated.events[0].place_basis,'manual');assert.equal(annotated.stories[0].reports[0].id,'test-report');
 assert.equal((await post('/api/events/test-report/location','DELETE')).status,200);
 assert.equal((await post('/api/watch/rules/'+rule.id,'DELETE')).status,200);
 assert.equal((await post('/api/events/test-report/location','PUT',{lat:100,lon:0,place:'Invalid'})).status,400);
 assert.equal((await post('/api/watch/rules','POST',{name:'Bad origin',terms:['fixture']},{Origin:'https://evil.example'})).status,403);
}, {timeout:15000});

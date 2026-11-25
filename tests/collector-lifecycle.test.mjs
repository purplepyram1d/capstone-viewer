import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createServer as reservePort } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { feeds } from '../lib/collectors.mjs';

async function launch(t, port, {prepare, onMessage} = {}) {
  const data = await mkdtemp(path.join(tmpdir(),'capstone-lifecycle-'));
  const execArgv = prepare ? await prepare(data) : [];
  const child = fork(fileURLToPath(new URL('../server.mjs',import.meta.url)),[],{
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:data,
      CAPSTONE_DESKTOP:'1',CAPSTONE_COLLECTORS:prepare?'on':'off',X_BEARER_TOKEN:'',CLOUDFLARE_RADAR_TOKEN:'',ABUSECH_AUTH_KEY:''},
    execArgv,silent:true
  });
  const exit = new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  let stderr = '';
  child.stderr.on('data',chunk=>stderr+=String(chunk));
  child.stdout.resume();
  const ready = new Promise(resolve=>child.on('message',message=>{
    onMessage?.(message);
    if (message.type==='credential-request' && child.connected) {
      child.send({type:'credential-response',requestId:message.requestId,value:''});
    }
    if (message.type==='ready') resolve(message.url);
  }));
  t.after(async ()=>{
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exit.catch(()=>{});
    await rm(data,{recursive:true,force:true});
  });
  return {child,exit,ready,stderr:()=>stderr};
}

test('desktop collector exits cleanly when the desktop disconnects', {timeout:10_000}, async t=>{
  const {child,exit,ready} = await launch(t,0);
  const address = await Promise.race([ready,exit.then(result=>{throw new Error('Collector exited: '+JSON.stringify(result));})]);
  assert.equal((await fetch(address+'/api/health')).status,200);
  child.disconnect();
  assert.deepEqual(await exit,{code:0,signal:null});
  await assert.rejects(fetch(address+'/api/health',{signal:AbortSignal.timeout(1000)}));
});

test('local port collision reports the port and releases the collector without disturbing its owner', {timeout:10_000}, async t=>{
  const owner = reservePort(socket=>socket.end());
  await new Promise((resolve,reject)=>{
    owner.once('error',reject);
    owner.listen(0,'127.0.0.1',resolve);
  });
  t.after(()=>new Promise(resolve=>owner.close(resolve)));
  const port = owner.address().port;
  const {exit,stderr,ready} = await launch(t,port);
  const state = await Promise.race([exit,ready.then(()=>null)]);
  assert.deepEqual(state,{code:1,signal:null});
  assert.match(stderr(),new RegExp('Local port '+port+' is already in use'));
  assert.equal(owner.listening,true);
});

test('due feeds proceed while another provider and score enrichment are pending', {timeout:10_000}, async t=>{
  const events = new Set();
  const {ready} = await launch(t,0,{
    onMessage:message=>events.add(message.type),
    async prepare(data) {
      const db = new DatabaseSync(path.join(data,'events.sqlite'));
      db.exec('CREATE TABLE paused_collectors(id TEXT PRIMARY KEY); CREATE TABLE events(id TEXT PRIMARY KEY,ts TEXT NOT NULL,data TEXT NOT NULL)');
      const pause = db.prepare('INSERT INTO paused_collectors VALUES (?)');
      for (const feed of feeds) if (!['nws-alerts','eccc-weather'].includes(feed.id)) pause.run(feed.id);
      const ts = new Date().toISOString();
      const report = {id:'sample-score',ts,title:'Fixture CVE-2026-11111',cves:['CVE-2026-11111'],
        category:'cyber',kind:'advisory',source:'Fixture',url:'https://example.org/fixture'};
      db.prepare('INSERT INTO events VALUES (?,?,?)').run(report.id,ts,JSON.stringify(report));
      db.close();

      const mock = path.join(data,'mock-collectors.mjs');
      await writeFile(mock,`
        globalThis.WebSocket = class { send() {} close() {} };
        globalThis.fetch = async request=>{
          const {hostname} = new URL(request);
          if (hostname==='api.first.org') {
            process.send({type:'score-pending'});
            return new Promise(()=>{});
          }
          if (hostname==='api.weather.gc.ca') {
            process.send({type:'canada-pending'});
            return new Promise(()=>{});
          }
          if (hostname==='api.weather.gov' || hostname==='earthquake.usgs.gov') {
            return Response.json({type:'FeatureCollection',features:[]});
          }
          return new Response('',{status:503});
        };
      `);
      return ['--import',pathToFileURL(mock).href];
    }
  });
  const base = await ready;
  async function waitFor(check) {
    for (let i=0;i<100;i++) {
      const value = await check();
      if (value) return value;
      await delay(25);
    }
    throw Error('Timed out waiting for fixture collector status');
  }
  const enabled = async id=>(await fetch(base+'/api/collectors/'+id,{
    method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true})
  })).json();
  await waitFor(()=>events.has('canada-pending') && events.has('score-pending'));
  await enabled('usgs');
  const health = await waitFor(async()=>{
    const value = await (await fetch(base+'/api/health')).json();
    return value.feeds.find(feed=>feed.id==='usgs')?.state==='ok' && value;
  });
  assert.equal(health.refreshing,true);
  assert.equal(health.feeds.find(feed=>feed.id==='eccc-weather').polling,true);
  const latest = await (await fetch(base+'/api/health/polls?feed=usgs')).json();
  assert.equal(latest.attempts,1);
});

test('an official work-zone closure stays in its state and leaves current listings when the inventory clears', {timeout:10_000}, async t=>{
  const {child,ready} = await launch(t,0,{
    async prepare(data) {
      const db = new DatabaseSync(path.join(data,'events.sqlite'));
      db.exec('CREATE TABLE paused_collectors(id TEXT PRIMARY KEY)');
      const pause = db.prepare('INSERT INTO paused_collectors VALUES (?)');
      for (const feed of feeds) if (feed.id!=='wzdx-id') pause.run(feed.id);
      db.close();
      const mock = path.join(data,'mock-work-zones.mjs');
      await writeFile(mock,`
        let cleared = false;
        const RealDate = Date;
        const minutes = value => value*60_000;
        globalThis.Date = class extends RealDate {
          constructor(...parts) { super(...(parts.length ? parts : [Date.now()])); }
          static now() { return RealDate.now() + (cleared ? minutes(6) : 0); }
        };
        process.on('message', message=>{ if (message.type==='clear-inventory') { cleared = true; process.send({type:'inventory-cleared'}); } });
        globalThis.WebSocket = class { send() {} close() {} };
        globalThis.fetch = async request=>{
          if (new URL(request).hostname!=='511.idaho.gov') return new Response('',{status:503});
          const date = offset=>new Date(Date.now()+minutes(offset)).toISOString();
          const feature = {type:'Feature',id:'closure-fixture',geometry:{type:'LineString',coordinates:[[-116.2,43.6],[-116.18,43.61]]},properties:{
            event_status:'active',start_date:date(-60),end_date:date(60),vehicle_impact:'all-lanes-closed',
            core_details:{event_type:'work-zone',road_names:['US 20'],direction:'eastbound',update_date:date(-60*72)}
          }};
          return Response.json({type:'FeatureCollection',feed_info:{version:'4.2',update_date:date(0)},features:cleared?[]:[feature]});
        };
      `);
      return ['--import',pathToFileURL(mock).href];
    }
  });
  const base = await ready;
  const timeline = async params=>(await fetch(base+'/api/timeline?'+params)).json();
  async function waitFor(check) {
    for (let i=0;i<100;i++) {
      const value = await check();
      if (value) return value;
      await delay(25);
    }
    throw Error('Timed out waiting for the Idaho work-zone inventory');
  }
  const source = async()=> (await (await fetch(base+'/api/health')).json()).feeds.find(feed=>feed.id==='wzdx-id');
  const active = 'state=ID&days=active';
  await waitFor(async()=> (await source())?.count===1);
  const [report] = (await timeline(active)).events;
  assert.match(report.title,/US 20 · eastbound/);
  assert.deepEqual(report.state_codes,['ID']);
  assert.equal(report.road_geometry.type,'LineString');
  assert.deepEqual((await timeline('state=WA&days=active')).events,[]);
  const cleared = new Promise(resolve=>{
    const acknowledge = message=>{
      if (message.type!=='inventory-cleared') return;
      child.off('message',acknowledge);
      resolve();
    };
    child.on('message',acknowledge);
  });
  child.send({type:'clear-inventory'});
  await cleared;
  const refresh = await fetch(base+'/api/refresh',{method:'POST'});
  assert.ok(refresh.ok);
  await waitFor(async()=> (await source())?.count===0);
  assert.deepEqual((await timeline(active)).events,[]);
  assert.equal((await timeline('state=ID&days=7')).events[0].id,report.id);
});
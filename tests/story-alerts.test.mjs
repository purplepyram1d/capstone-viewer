import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createDeveloping} from '../lib/developing.mjs';
import {createStoryAlerts} from '../lib/story-alerts.mjs';
const now=Date.now();
function setup(){const db=new DatabaseSync(':memory:'),dev=createDeveloping(db);let n=0;const r={id:'report-a',title:'Outage',source:'IODA',ts:new Date(now).toISOString(),url:'https://example.org/outage',kind:'outage',ongoing:true,category:'cyber',score:90};const sync=(patch={})=>{Object.assign(r,patch);dev.sync([{...r,id:'story-a',report_ids:[r.id]}],[r],{now:now+(++n)*1000});};sync();const alerts=createStoryAlerts(db);return {db,dev,alerts,sync,r,id:dev.list()[0].id};}
test('following only alerts on future meaningful source changes, once, with evidence and explicit source recovery',()=>{
 const {db,dev,alerts,sync,id}=setup();dev.update(id,{followed:true});assert.equal(alerts.collect().length,0);
 sync({url:'https://example.org/outage?t=2',ts:new Date(now+1000).toISOString()});assert.equal(alerts.collect().length,0,'polling metadata is noise');
 dev.update(id,{state:'developing',note:'My assessment'});assert.equal(alerts.collect().length,0,'analyst edits are not source changes');
 sync({summary:'Updated source measurement'});let rows=alerts.collect();assert.equal(rows.length,1);assert.equal(rows[0].recovery,false);assert.equal(rows[0].changes[0].evidence,'Source measurement');assert.equal(rows[0].path,'/developing?id='+id);assert.equal(alerts.collect().length,1,'idempotent');
 sync({ongoing:false});rows=alerts.collect();assert.equal(rows.length,2);assert.equal(rows[0].recovery,true);assert.match(rows[0].changes[0].reason,/Source reports/);
 assert.ok(alerts.read(rows[0].id)[0].read_at);assert.ok(alerts.read('all').every(a=>a.read_at));sync({ongoing:true});rows=alerts.collect();assert.equal(rows[0].escalation,true);assert.match(rows[0].changes[0].reason,/renewed disruption/);db.close();
});
test('unfollow/refollow boundaries discard old changes; restart retains inbox without replaying source history',()=>{
 const {db,dev,alerts,sync,id}=setup();dev.update(id,{followed:true});sync({summary:'one'});alerts.collect();dev.update(id,{followed:false});sync({summary:'two'});dev.update(id,{followed:true});assert.equal(alerts.collect().length,1,'no changes before latest follow');
 assert.equal(alerts.active().length,0,'refollow never resurrects historical alerts for notification');sync({summary:'three'});const restarted=createStoryAlerts(db);assert.equal(restarted.collect().length,1,'restart is a new observation baseline');sync({summary:'four'});assert.equal(restarted.collect().length,2);assert.equal(restarted.active().length,1);db.close();
});
test('new linked reports retain claim labels and old source dates without calling them new incidents',()=>{
 const {db,dev,alerts,r,id}=setup();dev.update(id,{followed:true});
 const claim={...r,id:'claim-b',title:'Unverified report',source:'Public claim',url:'https://example.org/claim',kind:'claim',confidence:'Unconfirmed',ts:new Date(now-86400000).toISOString()};
 dev.sync([{...r,id:'story-a',report_ids:[r.id,claim.id]}],[r,claim]);const a=alerts.collect()[0];assert.equal(a.changes[0].evidence,'Claim / unverified');assert.equal(a.changes[0].published,claim.ts);assert.equal(a.changes[0].reason,'New report entered the followed thread');assert.equal(a.recovery,false);db.close();
});

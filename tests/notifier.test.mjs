import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createNotifier, validateNotificationSettings, inQuietHours } from '../lib/notifier.mjs';
const tile=(id,level,headline='Something happened')=>({id,label:id[0].toUpperCase()+id.slice(1),level,headline});
const alert=(id,patch={})=>({id,rule_name:'Fortinet',title:'Fortinet bug '+id,event_id:'ev-'+id,backfill:false,read_at:null,...patch});
function setup(clockHour=12){let t=Date.parse('2026-10-23T18:00:00Z');const sent=[];const n=createNotifier(new DatabaseSync(':memory:'),m=>sent.push(m),{now:()=>t,clock:()=>new Date(2026,9,23,clockHour,0)});return {n,sent,advance:ms=>{t+=ms;}};}
const storyAlert=(id,thread='dev-a',patch={})=>({id,thread_id:thread,title:'Tracked outage',changes:[{reason:'Source changed: summary'}],path:'/developing?id='+thread,recovery:false,read_at:null,...patch});
test('followed stories batch, debounce routine repeats, allow recovery, and link to evidence',()=>{
 const {n,sent,advance}=setup();n.baselineStories([]);n.check({storyAlerts:[storyAlert(1)]});assert.equal(sent.length,0);advance(30000);n.flushStories();assert.equal(sent.length,1);assert.equal(sent[0].path,'/developing?id=dev-a');
 n.check({storyAlerts:[storyAlert(2)]});advance(30000);n.flushStories();assert.equal(sent.length,1,'routine cooldown');
 n.check({storyAlerts:[storyAlert(3,'dev-a',{recovery:true}),storyAlert(4,'dev-b')]});advance(30000);n.flushStories();assert.equal(sent.length,2);assert.equal(sent[1].title,'2 followed stories updated');assert.equal(sent[1].path,'/developing?alerts=1');
});
test('story startup, quiet hours, opt-out, read and unfollow suppress popups without replay',()=>{
 const {n,sent,advance}=setup();n.check({storyAlerts:[storyAlert(1)]});advance(30000);n.flushStories();assert.equal(sent.length,0);
 n.check({storyAlerts:[storyAlert(2)]});n.check({storyAlerts:[]});advance(30000);n.flushStories();assert.equal(sent.length,0,'unfollow cancels pending');
 n.check({storyAlerts:[storyAlert(3)]});n.check({storyAlerts:[storyAlert(3,'dev-a',{read_at:'read'})]});advance(30000);n.flushStories();assert.equal(sent.length,0,'read cancels pending');
 n.update({stories:false});n.check({storyAlerts:[storyAlert(4)]});n.update({stories:true});advance(30000);n.flushStories();assert.equal(sent.length,0);
 const quiet=setup(23);quiet.n.baselineStories([]);quiet.n.update({quietStart:'22:00',quietEnd:'07:00'});quiet.n.check({storyAlerts:[storyAlert(1)]});quiet.advance(30000);quiet.n.flushStories();assert.equal(quiet.sent.length,0);
 assert.throws(()=>validateNotificationSettings({stories:'yes'}),/true or false/);
});

test('the first check is a baseline; only later Severe escalations notify, once per 30 minutes',()=>{
 const {n,sent,advance}=setup();
 n.check({status:[tile('internet','red')],watch:{alerts:[alert('old')]}});assert.equal(sent.length,0,'startup never replays');
 n.check({status:[tile('internet','green'),tile('cyber','amber')]});
 n.check({status:[tile('internet','red','3 countries with major outages'),tile('cyber','amber')]});
 assert.equal(sent.length,1);assert.equal(sent[0].title,'Internet: Severe');assert.equal(sent[0].body,'3 countries with major outages');assert.equal(sent[0].path,'/ops');
 n.check({status:[tile('internet','green')]});n.check({status:[tile('internet','red')]});assert.equal(sent.length,1,'flapping within 30 minutes stays quiet');
 advance(31*60000);n.check({status:[tile('internet','green')]});n.check({status:[tile('internet','red')]});assert.equal(sent.length,2);
 n.check({status:[tile('internet','red'),tile('cyber','amber')]});assert.equal(sent.length,2,'Elevated is off by default');
});

test('new watchlist matches notify singly with a deep link, or as one batch; backfill and read alerts do not',()=>{
 const {n,sent}=setup();
 n.check({watch:{alerts:[alert('a')]}});
 n.check({watch:{alerts:[alert('b'),alert('c',{backfill:true}),alert('a')]}});
 assert.equal(sent.length,1);assert.equal(sent[0].title,'Watchlist: Fortinet');assert.equal(sent[0].path,'/ops?event=ev-b&period=720');
 n.check({watch:{alerts:[alert('d'),alert('e'),alert('f',{read_at:'x'}),alert('b'),alert('a')]}});
 assert.equal(sent[1].title,'2 new watchlist matches');assert.equal(sent[1].path,'/watch');
});

test('settings validate, persist, switch kinds off, and respect quiet hours across midnight',()=>{
 assert.throws(()=>validateNotificationSettings({severe:'yes'}),/true or false/);assert.throws(()=>validateNotificationSettings({quietStart:'25:00'}),/HH:MM/);
 assert.equal(inQuietHours({quietStart:'22:00',quietEnd:'07:00'},new Date(2026,9,23,23,30)),true);
 assert.equal(inQuietHours({quietStart:'22:00',quietEnd:'07:00'},new Date(2026,9,23,12,0)),false);
 assert.equal(inQuietHours({quietStart:'',quietEnd:''},new Date()),false);
 const quiet=setup(23);quiet.n.update({quietStart:'22:00',quietEnd:'07:00'});
 quiet.n.check({status:[tile('internet','green')]});quiet.n.check({status:[tile('internet','red')]});assert.equal(quiet.sent.length,0,'quiet hours suppress');
 const off=setup();off.n.update({watch:false,elevated:true});assert.equal(off.n.settings().elevated,true);
 off.n.check({status:[tile('cyber','green')],watch:{alerts:[]}});off.n.check({status:[tile('cyber','amber')],watch:{alerts:[alert('z')]}});
 assert.deepEqual(off.sent.map(m=>m.title),['Cyber: Elevated'],'watch matches off, Elevated on');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/desk-model.js';
const M=globalThis.CapstoneDeskModel;
test('starter desks inherit existing streams without sharing mutable settings',()=>{
 const streams=[{name:'My stream',input:'@SkyNews'}],profiles=M.starters({wall:{streams,columns:'4'},ops:{projection:'globe'}});
 assert.deepEqual(profiles.map(p=>[p.name,p.view]),[['Overview','/ops'],['Cyber desk','/ops'],['Live wall','/wall']]);
 assert.equal(profiles[0].ops.balance,65);assert.equal(profiles[1].ops.category,'cyber');assert.equal(profiles[1].ops.period,'24');assert.equal(profiles[2].wall.columns,'4');assert.equal(profiles[0].ops.projection,'globe');
 profiles[0].wall.streams[0].name='Changed';assert.equal(profiles[2].wall.streams[0].name,'My stream');assert.equal(streams[0].name,'My stream');
});
test('profiles round trip independent filters, map position, panels and an unlimited stream lineup',()=>{
 const p=M.starters()[0];p.ops={category:'geo',source:'telegram-channel',query:'Ukraine',period:'168',watchOnly:true,balance:57,projection:'globe',diagnostics:true,health:true,camera:{center:[30,50],zoom:4,bearing:15,pitch:30},fallback:[180,90,360,180]};p.wall={columns:'6',streams:Array.from({length:150},(_,i)=>({name:'Stream '+i,input:'https://www.youtube.com/@SkyNews/live'}))};
 const result=M.normalize(JSON.parse(JSON.stringify({version:1,profiles:[p]})));assert.deepEqual(result.profiles[0],p);assert.equal(result.profiles[0].wall.streams.length,150);
});
test('malformed storage recovers safely and profile data cannot choose external routes or invalid map bounds',()=>{
 assert.equal(M.normalize(null).profiles.length,3);assert.equal(M.normalize({version:1,profiles:[null,{},'bad']}).profiles.length,3);
 const p=M.profile({id:'desk-test',name:'Test',view:'https://evil.example',ops:{balance:1000,period:'forever',camera:{center:[900,500],zoom:99,pitch:90},fallback:[0,0,-2,-1]},wall:{columns:99,streams:[{name:'Bad',input:'javascript:bad'}]}});
 assert.equal(p.view,'/ops');assert.equal(p.ops.balance,70);assert.equal(p.ops.period,'today');assert.deepEqual(p.ops.camera.center,[180,85]);assert.equal(p.ops.camera.zoom,8);assert.deepEqual(p.ops.fallback,[0,0,720,360]);assert.equal(p.wall.columns,'auto','an invalid column count falls back to fit-all');assert.deepEqual(p.wall.streams.map(stream=>stream.input), ['@France24_en','@aljazeeraenglish','@SkyNews','@dwnews','@ABCNews','@NBCNews']);assert.equal(M.wall({columns:'auto'}).columns,'auto','auto survives normalization');
 const store=M.normalize({version:1,profiles:[p,p]});assert.equal(store.profiles.length,1);
});
test('desk names validate and stream parsing accepts existing wall inputs only',()=>{
 const profiles=M.starters();assert.throws(()=>M.name(' overview ',profiles),/already/);assert.throws(()=>M.name('',profiles),/1 to 60/);assert.equal(M.name('Overview',profiles,'desk-overview'),'Overview');
 assert.ok(M.parseStream('https://youtu.be/abcdefghijk'));assert.ok(M.parseStream('@SkyNews'));assert.equal(M.parseStream('https://evil.example/watch?v=abcdefghijk'),null);assert.equal(M.validStreams([]),true,'an intentionally empty wall is a layout');
});

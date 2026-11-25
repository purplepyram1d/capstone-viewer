import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import '../assets/headline-model.js';
import '../assets/kiosk-regions.js';

const {fromUrl,toUrl,matches,project} = globalThis.CapstoneKioskRegions;
const {rank} = globalThis.CapstoneHeadlines;
const {currentListing,listingCutoff} = globalThis.CapstoneTypes;
const now = Date.parse('2026-11-26T00:00:00.000Z');
const ts = new Date(now-30*60_000).toISOString();

test('kiosk region links override device preferences and encode global scope explicitly',()=>{
  assert.equal(fromUrl(new URLSearchParams('state=wa'),'province:BC'),'state:WA');
  assert.equal(fromUrl(new URLSearchParams('region=world'),'province:BC'),'');
  assert.equal(fromUrl(new URLSearchParams('desk=geo'),'province:BC'),'province:BC');
  const params = new URLSearchParams('desk=geo&state=WA&country=US');
  toUrl(params,'province:BC');
  assert.equal(params.toString(),'desk=geo&province=BC');
  toUrl(params,'');
  assert.equal(params.toString(),'desk=geo&region=world');
});

test('a current listing can outlive the recent window, but expires at its freshness cutoff',()=>{
  const until = now+60_000;
  const road = {id:'closure',kind:'road_closure',title:'Road closure',ts:new Date(now-3*86400_000).toISOString(),
    road_listed_until:new Date(until).toISOString(),score:80,confidence:'Official notice'};
  assert.equal(listingCutoff(road),until);
  assert.equal(currentListing(road,now),true);
  assert.equal(currentListing(road,until),false);
  assert.deepEqual(rank([road],{now}).selected,[]);
  const listed = [road].filter(report=>currentListing(report,now));
  assert.deepEqual(rank(listed,{now,listed:true}).selected.map(item=>item.story.id),[road.id]);
  const superseded = {kind:'weather_alert',weather_replaced_at:new Date(now).toISOString(),
    weather_listed_until:new Date(until).toISOString()};
  assert.equal(currentListing(superseded,now),false);
  const regionalDetection = {kind:'outage',outage_listed_until:new Date(until).toISOString()};
  assert.equal(currentListing(regionalDetection,now),true);
  assert.equal(currentListing(regionalDetection,until),false);
});

test('receipt-time ranking includes older source dates when newly collected',()=>{
  const late = {id:'late',kind:'advisory',category:'cyber',source:'Official source',
    ts:'2026-11-22T00:00:00.000Z',date_precision:'day',first_received:'2026-11-25T23:58:00.000Z',score:67};
  const neverObserved = {...late,id:'unobserved',ts,first_received:null};
  assert.deepEqual(rank([late,neverObserved],{now,min:1}).selected.map(item=>item.story.id),['unobserved']);
  const arrival = rank([late,neverObserved],{now,min:1,received:true});
  assert.equal(arrival.window,1);
  assert.deepEqual(arrival.selected.map(item=>item.story.id),['late']);
  const group = project({...late,id:'group',reports:[late,neverObserved]},()=>true,'');
  assert.equal(group.latest_received,late.first_received);
});

test('regional tour ranks matching reports before applying the limit and uses their actual location',()=>{
  const outside = {id:'outside',state_codes:['OR'],ts,kind:'weather_alert',category:'geo',score:99,source:'Warning service'};
  const local = {...outside,id:'local',title:'Local official warning',score:62,state_codes:['WA','OR'],
    place_basis:'nws_zone_reference',lat:45,lon:-120,
    weather_zone_references:[{state:'WA',lat:47,lon:-122,place:'Washington warning zone'}]};
  const otherStates = Array.from({length:16},(_,i)=>({...outside,id:'outside-'+i}));
  const story = {...outside,id:'shared',representative_id:'outside',reports:[outside,local]};
  assert.ok(rank([...otherStates,story],{now}).selected.every(item=>item.story.id!=='shared'));
  const rows = [...otherStates,story].map(item=>project(item,report=>matches(report,'state:WA'),'state:WA')).filter(Boolean);
  const ranked = rank(rows,{now});
  assert.equal(ranked.selected.length,1);
  const [selected] = ranked.selected;
  assert.equal(selected.story.id,'shared');
  assert.equal(selected.story.representative_id,'local');
  assert.equal(selected.story.report_count,1);
  assert.equal(selected.story.lat,47);
  assert.equal(selected.story.place,'Washington warning zone');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBriefing} from '../lib/briefing.mjs';
const now=Date.parse('2026-10-24T18:00:00Z'),at=m=>new Date(now-m*60000).toISOString();
const digest=()=>({since:at(60),partial:false,kev:[],critical:[],tiles:[],outages:{started:[],ended:[]},epss_movers:[],hotspots:{added:[],cleared:[]}});
const base=()=>({digest:digest(),now,then:{ts:at(60)},between:[45,30,15,0].map(m=>({ts:at(m)}))});
test('complete calm history can be quiet; monitoring gaps and failing inputs cannot',()=>{
 assert.equal(buildBriefing(base()).quiet,true);
 assert.equal(buildBriefing({...base(),between:[]}).quiet,false);
 assert.equal(buildBriefing({...base(),gaps:[{name:'IODA'}]}).quiet,false);
});
test('initial imports do not become new incidents; later source recovery stays distinct from analyst status',()=>{
 const thread={id:'dev-a',created:at(50),title:'Outage',source_condition:'Outage ended in source',reports:[{id:'r',kind:'outage',ongoing:false,url:'https://example.com/outage',source:'IODA'}],changes:[{kind:'report_added',observed:at(50),report_id:'r'}]};
 assert.equal(buildBriefing({...base(),threads:[thread]}).cards.length,0);
 thread.changes.push({kind:'report_updated',observed:at(15),report_id:'r',changed_fields:['url','ts']});
 assert.equal(buildBriefing({...base(),threads:[thread]}).cards.length,0,'rolling chart URLs and timestamps are not developments');
 thread.changes.push({kind:'report_updated',observed:at(10),report_id:'r',changed_fields:['ongoing']});
 const card=buildBriefing({...base(),threads:[thread]}).cards[0];
 assert.equal(card.label,'Source reports recovery');assert.equal(card.links[0].url,'https://example.com/outage');
 thread.changes=[{kind:'analyst_status',observed:at(5)}];
 assert.equal(buildBriefing({...base(),threads:[thread]}).cards[0].label,'Your assessment changed');
});
test('missing outage listings never establish recovery and ranking is capped at five',()=>{
 const input=base();input.digest.outages.ended=[{name:'Netherlands'}];input.digest.tiles=Array.from({length:8},(_,i)=>({id:String(i),label:'Tile '+i,then:'green',now:'red',changed:true}));
 const result=buildBriefing(input);assert.equal(result.cards.length,5);assert.equal(result.remaining,4);assert.equal(result.cards[0].label,'Rule-based status');
 input.digest.tiles=[];assert.equal(buildBriefing(input).cards[0].label,'Recovery unconfirmed');
});

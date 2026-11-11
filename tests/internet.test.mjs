import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIODA, normalizeRadarOutages, normalizeRadarHijacks, createBgpPulse, iodaUrl } from '../lib/internet.mjs';
const countries={IR:{lat:32.4,lon:53.7,name:'Iran'},LT:{lat:55.2,lon:23.9,name:'Lithuania'},UA:{lat:48.4,lon:31.2,name:'Ukraine'}};
const now=Date.parse('2026-10-23T15:00:00Z'),until=Math.floor(now/1000);

test('IODA outage events become country-placed, flagged ongoing, measured-not-attributed reports',()=>{
 const data={requestParameters:{until:String(until)},data:[
  {entity:{code:'IR',name:'Iran',type:'country'},from:until-7200,until,score:250000,datasource:'bgp',method:'median'},
  {entity:{code:'LT',name:'Lithuania',type:'country'},from:until-86400,until:until-80000,score:5000,datasource:'gtr',method:'sarima'},
  {entity:{code:'ZZ',name:'Nowhere',type:'country'},from:until-3600,until,score:20000,datasource:'ping-slash24',method:'median'},
  {entity:{code:'123',name:'Some AS',type:'asn'},from:until-3600,until,score:20000,datasource:'bgp'}]};
 const events=normalizeIODA(data,countries,now);
 assert.equal(events.length,3);
 const iran=events.find(e=>e.country==='IR');
 assert.equal(iran.ongoing,true);assert.match(iran.title,/Iran \(ongoing\)/);assert.equal(iran.score,85);assert.equal(iran.kind,'outage');assert.equal(iran.place_basis,'country_centroid');
 assert.match(iran.summary,/BGP routing visibility/);assert.match(iran.summary,/cause is not established/);assert.match(iran.url,/^https:\/\/ioda\.inetintel\.cc\.gatech\.edu\/country\/IR\?/);
 const lt=events.find(e=>e.country==='LT');assert.equal(lt.ongoing,false);assert.equal(lt.score,60);assert.doesNotMatch(lt.title,/ongoing/);
 const unknown=events.find(e=>e.title.includes('Nowhere'));assert.equal(unknown.lat,null);assert.equal(unknown.place_basis,'unlocated');
 assert.equal(normalizeIODA(data,countries,now)[0].id,events[0].id,'stable IDs across polls');
 assert.throws(()=>normalizeIODA({error:'x'},countries,now),/Invalid IODA/);
 assert.match(iodaUrl(now),/entityType=country&includeAlerts=false&format=ioda/);
});

test('Cloudflare Radar outages and hijacks normalize from the documented schema',()=>{
 const outages={success:true,result:{annotations:[
  {id:'a1',startDate:'2026-10-23T10:00:00Z',endDate:null,locations:['IR'],locationsDetails:[{code:'IR',name:'Iran'}],asns:[],asnsDetails:[],outage:{outageCause:'GOVERNMENT_DIRECTED',outageType:'NATIONWIDE'},description:'Shutdown during exams.',linkedUrl:'https://example.org/shutdown',scope:'Nationwide'},
  {id:'a2',startDate:'2026-10-22T10:00:00Z',endDate:'2026-10-22T12:00:00Z',locations:['UA','IR'],locationsDetails:[{code:'UA',name:'Ukraine'},{code:'IR',name:'Iran'}],asnsDetails:[{asn:'1',name:'Net'}],outage:{outageCause:'POWER_OUTAGE',outageType:'REGIONAL'}}]}};
 const [a,b]=normalizeRadarOutages(outages,countries,now);
 assert.equal(a.score,85);assert.equal(a.ongoing,true);assert.equal(a.country,'IR');assert.match(a.summary,/government directed/);assert.equal(a.url,'https://example.org/shutdown');
 assert.equal(b.ongoing,false);assert.equal(b.lat,null,'multi-country outages are not placed at one centroid');assert.match(b.summary,/Net \(AS1\)/);
 assert.throws(()=>normalizeRadarOutages({success:false,errors:[]},countries,now),/Invalid Cloudflare Radar/);
 const hijacks={success:true,result:{events:[
  {id:7,confidence_score:9,hijacker_asn:666,hijacker_country:'ZZ',victim_asns:[13335],victim_countries:['UA'],min_hijack_ts:'2026-10-23T09:00:00Z',prefixes:['1.1.1.0/24'],peer_ip_count:40,is_stale:false},
  {id:8,confidence_score:8,hijacker_asn:1,victim_asns:[2],victim_countries:[],min_hijack_ts:'2026-10-23T09:00:00Z',prefixes:[],is_stale:true}]}};
 const h=normalizeRadarHijacks(hijacks,countries,now);
 assert.equal(h.length,1,'stale events are dropped');assert.equal(h[0].kind,'routing');assert.equal(h[0].country,'UA');assert.match(h[0].title,/AS666 announced 1 prefix of AS13335/);assert.match(h[0].summary,/not a confirmed attack/);
});

test('BGP pulse needs a baseline, flags a 4x withdrawal surge once, and reconnects',async()=>{
 let clock=Date.parse('2026-10-23T12:00:30Z');const surges=[],sockets=[];
 class FakeSocket{constructor(url){this.url=url;this.sent=[];sockets.push(this);}send(m){this.sent.push(JSON.parse(m));}close(){this.onclose?.();}}
 const pulse=createBgpPulse({WebSocketImpl:FakeSocket,now:()=>clock,onSurge:e=>surges.push(e)});
 pulse.start();sockets[0].onopen();
 assert.deepEqual(sockets[0].sent[0],{type:'ris_subscribe',data:{type:'UPDATE',host:'rrc00'}});
 const message=wd=>sockets[0].onmessage({data:JSON.stringify({type:'ris_message',data:{announcements:[{prefixes:['10.0.0.0/8']}],withdrawals:Array(wd).fill('10.0.0.0/24')}})});
 for(let m=0;m<70;m++){message(100);clock+=60000;}
 assert.equal(pulse.summary().surge,false);assert.equal(pulse.summary().last5,500);assert.equal(pulse.summary().ratio,1);
 pulse.check();assert.equal(surges.length,0);
 for(let m=0;m<5;m++){message(600);clock+=60000;}
 const s=pulse.summary();assert.equal(s.surge,true);assert.equal(s.ratio,6);
 pulse.check();pulse.check();assert.equal(surges.length,1,'debounced');
 assert.equal(surges[0].lat,null);assert.match(surges[0].summary,/No location or attribution/);
 sockets[0].onclose();assert.equal(pulse.summary().state,'error');pulse.stop();
});

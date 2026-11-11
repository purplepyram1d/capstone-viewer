import test from 'node:test';
import assert from 'node:assert/strict';
import { event, parseRSS, normalizeKEV, normalizeVictims, headlinePlace, safeUrl, DAY } from '../lib/events.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');
const base={title:'Test CVE-2026-12345',summary:'<b>Source report</b>',ts:'2026-10-23T10:00:00Z',source:'Official',url:'https://example.org/report',category:'cyber'};
test('normalization preserves publication time, stable IDs, CVEs, and plain text',()=>{
 const a=event(base,now),b=event(base,now+60000);assert.equal(a.id,b.id);assert.equal(Date.parse(a.ts),Date.parse(base.ts));assert.deepEqual(a.cves,['CVE-2026-12345']);assert.equal(a.summary,'Source report');
});
test('rejects unsafe URLs and invalid, stale, or future timestamps',()=>{
 for(const url of ['javascript:alert(1)','file:///secret','https://user:pass@example.org'])assert.equal(safeUrl(url),'');
 for(const ts of ['nonsense',new Date(now+DAY).toISOString(),new Date(now-31*DAY).toISOString()])assert.equal(event({...base,ts},now),null);
 assert.equal(event({...base,url:'javascript:alert(1)'},now),null);
});
test('missing or invalid coordinates remain unmapped instead of using 0,0',()=>{
 for(const patch of [{},{lat:null,lon:null},{lat:100,lon:0},{lat:'0',lon:0}]){const e=event({...base,...patch},now);assert.equal(e.lat,null);assert.equal(e.place_basis,'unlocated');}
 assert.equal(event({...base,lat:0,lon:0,place:'Equator',place_basis:'event_location'},now).lat,0);
});
test('RSS and Atom formats accept alternate links and reject HTML responses',()=>{
 const rss=parseRSS('<rss><channel><item><title>Advisory</title><link>https://example.org/a</link><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Patch now</p>]]></description></item></channel></rss>');assert.equal(rss[0].title,'Advisory');assert.equal(rss[0].url,'https://example.org/a');
 const atom=parseRSS('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Update</title><link rel="self" href="https://example.org/feed"/><link rel="alternate" href="https://example.org/article"/><updated>2026-10-23T10:00:00Z</updated></entry></feed>');assert.equal(atom[0].url,'https://example.org/article');
 assert.throws(()=>parseRSS('<html>Access denied</html>'));assert.throws(()=>parseRSS('<rss><broken>'));
});
test('KEV uses explicitly labelled vendor context, never fabricated incident geography',()=>{
 const data={vulnerabilities:[{cveID:'CVE-2026-12345',vendorProject:'TestVendor',vulnerabilityName:'A flaw',dateAdded:'2026-10-23',shortDescription:'Known exploitation',requiredAction:'Patch',knownRansomwareCampaignUse:'Known'}]};
 const a=normalizeKEV(data,[{aliases:['TestVendor'],lat:12,lon:34,place:'HQ'}],now)[0];assert.equal(a.place_basis,'vendor_hq');assert.equal(a.date_precision,'day');assert.equal(a.score,95);
 assert.equal(normalizeKEV(data,[],now)[0].lat,null);
});
test('ransomware reports stay claims and country placement is approximate',()=>{
 const rows=[{group_name:'Actor',post_title:'Victim',discovered:'2026-10-23T08:00:00Z',country:'US'},{group_name:'Actor',post_title:'Other',discovered:'2026-10-23T08:00:00Z'}];
 const out=normalizeVictims(rows,{US:{name:'United States',lat:38,lon:-97}},now);assert.match(out[0].title,/^Claim:/);assert.equal(out[0].place_basis,'country_centroid');assert.equal(out[1].lat,null);assert.notEqual(out[0].id,out[1].id);
});
test('ambiguous headline geography stays unmapped',()=>{
 const countries={FR:{name:'France',lat:46,lon:2},DE:{name:'Germany',lat:51,lon:10}};
 assert.equal(headlinePlace('Flooding in France',countries).place,'France');assert.deepEqual(headlinePlace('France and Germany meet',countries),{});assert.deepEqual(headlinePlace('No place here',countries),{});
});

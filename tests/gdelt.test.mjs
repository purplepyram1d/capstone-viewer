import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createGdelt, conflictRows, unzipSingle, relabelLegacy } from '../lib/gdelt.mjs';
import { createCountryResolver, family } from '../lib/hotspots.mjs';
const countries=JSON.parse(readFileSync(new URL('../assets/countries.json',import.meta.url)));
const resolve=createCountryResolver(JSON.parse(readFileSync(new URL('../assets/world.json',import.meta.url))),countries);
// A 61-column GDELT 2.0 event row with the fields the collector reads.
function row({code,lat,lon,place='Somewhere',url='https://news.example/a',added='20261024101500',type1='',type2='',group=''}){
 const c=Array(61).fill('');c[8]=group;c[12]=type1;c[22]=type2;c[26]=code;c[28]=code.slice(0,2);c[52]=place;c[56]=String(lat);c[57]=String(lon);c[59]=added;c[60]=url;return c.join('\t');
}
function zip(text){const data=deflateRawSync(Buffer.from(text)),name=Buffer.from('x.CSV'),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(8,8);h.writeUInt32LE(data.length,18);h.writeUInt16LE(name.length,26);return Buffer.concat([h,name,data]);}
const UA={lat:48.4,lon:31.2},US={lat:38.9,lon:-77.0};

test('only kinetic actions, or assaults by armed actors, survive the filter',()=>{
 const rows=conflictRows([
  row({code:'195',...UA,place:'Kharkiv, Ukraine'}),          // air strike: always counts
  row({code:'190',...US,type1:'MIL'}),                        // generic "use force": dropped even with military actor
  row({code:'193',...US}),                                     // small arms, no armed actor: dropped (crime)
  row({code:'181',...UA,type2:'REB'}),                         // abduction by rebels: counts
  row({code:'182',...US}),                                     // assault without armed actor: dropped
  row({code:'0412',...UA}),                                    // not a conflict code
  row({code:'194',lat:0,lon:0})                                // no usable location
 ].join('\n'),resolve);
 assert.deepEqual(rows.map(r=>`${r.code}:${r.country}`),['195:UA','181:UA']);
 assert.equal(unzipSingle(zip('hello')),'hello');assert.throws(()=>unzipSingle(Buffer.from('<html>404</html>')),/not a zip/);
});

test('rolls up to one report per country per day, needs 5 events and 3 outlets, and retries recent 404s',async()=>{
 const now=Date.parse('2026-10-24T11:10:00Z');const files={};
 // 10:00 file: Ukraine strikes from 4 outlets; Iran only 2 outlets. 10:15 file is not published yet.
 files['20261024100000']=zip([1,2,3,4,5,6].map(i=>row({code:'194',...UA,place:'Kharkiv, Kharkivs\'ka, Ukraine',url:`https://o${i%4}.example/s`,added:'20261024100000'})).concat([1,2,3,4,5].map(i=>row({code:'195',lat:35.7,lon:51.4,url:`https://ir${i%2}.example/x`,added:'20261024100000'}))).join('\n'));
 const asked=[];
 const request=async url=>{const s=url.match(/(\d{14})/)[1];asked.push(s);const body=files[s];return body?{ok:true,status:200,arrayBuffer:async()=>body}:{ok:false,status:s<'20261024080000'?404:404};};
 const g=createGdelt({resolve,countries,request,now:()=>now});
 const events=await g.collect();
 assert.equal(events.length,1,'Iran has only 2 outlets');const [e]=events;
 assert.equal(e.country,'UA');assert.equal(e.kind,'conflict');assert.equal(e.category,'geo');assert.equal(e.outlets,4);assert.equal(e.coded_events,6);
 assert.match(e.title,/^GDELT signal: 6 news reports from 4 outlets machine-coded as armed violence in Ukraine today$/);assert.doesNotMatch(e.title,/fighting/i,'a machine-coded count is never titled as fighting');assert.match(e.summary,/mostly Kharkiv/);assert.match(e.summary,/Not verified/);
 assert.equal(e.score,60,'kinetic-heavy, under 10 outlets');assert.equal(family(e),'conflict');
 asked.length=0;await g.collect();
 assert.ok(asked.includes('20261024104500'),'a recent missing file is retried');assert.ok(!asked.includes('20261024100000'),'a processed file is not fetched again');
 assert.ok(!asked.includes('20261024010000'),'files older than 3 hours that 404 are given up');
});

test('stored roll-ups with the old "Fighting reported" title are relabelled once; anything else is left alone', () => {
 const old = { id: 'g1', source: 'GDELT', ts: '2026-10-24T18:00:00.000Z', title: 'Fighting reported in United States: 15 machine-coded events from 11 outlets today',
  summary: 'GDELT coded 15 news reports of armed conflict (air strikes, artillery, bombings, armed assaults) in United States, mostly Florida, Washington, from 11 separate outlets. Not verified: ...', score: 65 };
 const e = relabelLegacy(old);
 assert.equal(e.title, 'GDELT signal: 15 news reports from 11 outlets machine-coded as armed violence in United States on 2026-10-24', 'a stored "today" becomes the report date');
 assert.match(e.summary, /mostly Florida, Washington\. Not verified, and not a report of fighting/); assert.equal(e.score, 65); assert.equal(e.id, 'g1');
 assert.equal(relabelLegacy({ ...old, title: 'Fighting reported in Ukraine: 6 machine-coded events from 4 outlets on 2026-10-30' }).title, 'GDELT signal: 6 news reports from 4 outlets machine-coded as armed violence in Ukraine on 2026-10-30');
 assert.equal(relabelLegacy(e), null, 'already relabelled'); assert.equal(relabelLegacy({ ...old, source: 'BBC World' }), null, 'only GDELT roll-ups');
});

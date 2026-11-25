import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createTimeline} from '../lib/timeline.mjs';
import {createReportHistory} from '../lib/report-history.mjs';
function setup(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,ts TEXT,data TEXT)');const put=db.prepare('INSERT INTO events VALUES(?,?,?)');for(let i=0;i<3105;i++){const e={id:'e'+String(i).padStart(4,'0'),ts:new Date(Date.now()-i*1000).toISOString(),title:'Report '+i,source:i%2?'Feed A':'Feed B',category:i%2?'cyber':'geo',url:'https://example.com/'+i};put.run(e.id,e.ts,JSON.stringify(e));}return {db,timeline:createTimeline(db)};}
test('full timeline reaches reports beyond live snapshot cap and filters before pagination',()=>{const {db,timeline}=setup();assert.equal(timeline.list().total,3105);const last=timeline.list(new URLSearchParams({offset:'3100'}));assert.equal(last.events.length,5);assert.equal(last.events[4].id,'e3104');const search=timeline.list(new URLSearchParams({q:'Report 3104',category:'geo'}));assert.equal(search.total,1);assert.equal(search.events[0].id,'e3104');assert.equal(timeline.list(new URLSearchParams({source:"' OR 1=1 --"})).total,0);assert.equal(timeline.list(new URLSearchParams({order:'oldest'})).events[0].id,'e3104');db.close();});
test('multiple typed tags persist, deduplicate, filter exactly, and survive source updates',()=>{const {db,timeline}=setup();const tags=[{type:'country',label:'United States'},{type:'subject',label:'Cybersecurity'},{type:'person',label:'Jane Doe'},{type:'subject',label:'cybersecurity'}];assert.equal(timeline.tags('e0000',tags).tags.length,3);const query=new URLSearchParams({tag:'person:Jane Doe'});assert.equal(createTimeline(db).list(query).total,1);db.prepare("UPDATE events SET data=json_set(data,'$.title','Changed') WHERE id='e0000'").run();assert.equal(timeline.list(query).events[0].tags.length,3);assert.equal(timeline.list(new URLSearchParams({tag:'person:Jane'})).total,0);assert.throws(()=>timeline.tags('e0000',[{type:'invalid',label:'x'}]));assert.throws(()=>timeline.tags('missing',[]));timeline.tags('e0000',[]);assert.equal(timeline.list(query).total,0);db.close();});

test('evidence filtering runs before grouping and shares the card labels',()=>{
 const {db,timeline}=setup();
 db.exec(`UPDATE events SET data=json_set(data,'$.confidence','Official advisory') WHERE id IN ('e0000','e3104');
          UPDATE events SET data=json_set(data,'$.kind','claim') WHERE id='e0001';
          UPDATE events SET data=json_set(data,'$.kind','earthquake') WHERE id='e0002';`);
 const selected=timeline.list(new URLSearchParams({evidence:'Official',view:'grouped'}));
 assert.deepEqual(selected.events.map(e=>e.id),['e0000','e3104']);
 assert.deepEqual(timeline.list(new URLSearchParams({evidence:'Claim'})).events.map(e=>e.id),['e0001']);
 assert.deepEqual(timeline.list(new URLSearchParams({evidence:'primary'})).events.map(e=>e.id),['e0000','e0002','e3104']);
 db.close();
});

test('Timeline links can scope to an individual built-in or connected collector and filter platforms',()=>{
  const {db,timeline}=setup();
  db.exec(`
    UPDATE events SET data=json_set(data,'$.feed_id','nws-alerts') WHERE id='e0000';
    UPDATE events SET data=json_set(data,'$.source_id','local-channel','$.platform','telegram') WHERE id='e0001';
    UPDATE events SET data=json_set(data,'$.source_id','other-channel','$.platform','mastodon') WHERE id='e0002';
  `);
  const ids = params => timeline.list(new URLSearchParams(params)).events.map(report=>report.id);
  assert.deepEqual(ids({feed:'nws-alerts'}),['e0000']);
  assert.deepEqual(ids({feed:'local-channel'}),['e0001']);
  assert.deepEqual(ids({platform:'telegram'}),['e0001']);
  assert.deepEqual(ids({platform:'core',feed:'local-channel'}),[]);
  assert.equal(timeline.list(new URLSearchParams({platform:'core'})).total,3103);
  db.close();
});

test('report type filters run before coverage grouping', () => {
  const { db, timeline } = setup();
  db.exec(`
    UPDATE events SET data=json_set(data,'$.kind','advisory','$.url','https://example.org/coverage') WHERE id='e0000';
    UPDATE events SET data=json_set(data,'$.kind','vulnerability','$.url','https://example.org/coverage') WHERE id='e0001';
  `);
  const advisories = timeline.list(new URLSearchParams({ type:'advisory', view:'grouped' }));
  assert.deepEqual(advisories.events.map(event => event.id), ['e0000']);
  assert.equal(advisories.events[0].coverage_count, 1);
  assert.deepEqual(timeline.list(new URLSearchParams({ type:'cve' })).events.map(event => event.id), ['e0001']);
  db.close();
});

test('exact CVE filtering uses normalized references and supports older report records', () => {
  const {db,timeline} = setup();
  db.exec(`
    UPDATE events SET data=json_set(data,'$.cves',json('["CVE-2026-12345"]')) WHERE id='e0000';
    UPDATE events SET data=json_set(data,'$.cves',json('["CVE-2026-123456"]')) WHERE id='e0001';
    UPDATE events SET data=json_set(data,'$.summary','Guidance for cve-2026-12345 and CVE-2026-54321') WHERE id='e0002';
    UPDATE events SET data=json_set(data,'$.summary','Malformed CVE-2026-12345suffix') WHERE id='e0003';
  `);
  const matching = timeline.list(new URLSearchParams({cve:'cve-2026-12345',view:'grouped'}));
  assert.deepEqual(matching.events.map(report=>report.id),['e0000','e0002']);
  db.close();
});

test('Timeline period and ordering can use the recorded first receipt while preserving the source date', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,ts TEXT NOT NULL,data TEXT NOT NULL)');
  const history = createReportHistory(db);
  const timeline = createTimeline(db,undefined,{reviewEnabled:true});
  const add = db.prepare('INSERT INTO events VALUES (?,?,?)');
  const ago = hours => new Date(Date.now() - hours*3_600_000).toISOString();
  for (const [id,sourceDate,firstSeen] of [['delayed',ago(48),ago(2)],['recent',ago(12),ago(1)],['legacy',ago(14),null]]) {
    const record = {id,title:id,ts:sourceDate,source:'Fixture source',category:'cyber',url:'https://example.org/'+id};
    const data = JSON.stringify(record);
    if (firstSeen) history.observe(id,data,firstSeen);
    add.run(id,sourceDate,data);
  }
  const firstReceived = timeline.list(new URLSearchParams({days:'1',basis:'received',view:'grouped'}));
  assert.equal(firstReceived.basis,'received');
  assert.deepEqual(firstReceived.events.map(row=>row.id),['recent','delayed']);
  assert.ok(Date.parse(firstReceived.events[1].first_received)-Date.parse(firstReceived.events[1].ts)>24*3_600_000);
  assert.deepEqual(firstReceived.sources,['Fixture source']);
  const bySource = timeline.list(new URLSearchParams({days:'1'}));
  assert.deepEqual(bySource.events.map(row=>row.id),['recent','legacy']);
  assert.ok(bySource.events.every(row=>row.first_received===null));
  assert.deepEqual(timeline.list(new URLSearchParams({days:'1',basis:'received',order:'oldest'})).events.map(row=>row.id),['delayed','recent']);
  assert.deepEqual(timeline.list(new URLSearchParams({days:'6h',basis:'received'})).events.map(row=>row.id),['recent','delayed']);
  assert.deepEqual(timeline.list(new URLSearchParams({days:'1h',basis:'received'})).events,[]);
  assert.deepEqual(timeline.list(new URLSearchParams({days:'6h'})).events,[]);
  db.close();
});

test('Timeline searches visible text and tags with Unicode normalization', () => {
  const {db,timeline} = setup();
  const details = {
    title:'Bulletin for Ålesund', author:'Renée Durant', cves:['CVE-2026-12345'],
    metadata:{internal_token:'invisible-content'}
  };
  db.prepare("UPDATE events SET data=json_patch(data,?) WHERE id='e0000'").run(JSON.stringify(details));
  timeline.tags('e0000',[
    {type:'person',label:'Søren Øst'},
    {type:'person',label:'SØREN ØST'}
  ]);
  timeline.tags('e0001',[{type:'custom',label:'ＡＢＣ'}]);
  for (const query of ['A\u030ALESUND','RENÉE DURANT','　Rene\u0301e   Durant','cve-2026-12345','SØREN ØST']) {
    assert.deepEqual(timeline.list(new URLSearchParams({q:query})).events.map(report=>report.id),['e0000'],query);
  }
  assert.deepEqual(timeline.list(new URLSearchParams({tag:'person:SØREN ØST'})).events[0].tags,[{type:'person',label:'Søren Øst'}]);
  assert.equal(timeline.list(new URLSearchParams({tag:'custom:abc'})).total,1);
  assert.equal(timeline.list(new URLSearchParams({q:'Feed A'})).total,1552);
  for (const query of ['metadata','internal_token','invisible-content','title','"source":']) {
    assert.equal(timeline.list(new URLSearchParams({q:query})).total,0,query);
  }
  db.close();
});

test('UTC date windows use inclusive days and the selected date basis', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY,ts TEXT NOT NULL,data TEXT NOT NULL)');
  const history = createReportHistory(db);
  const timeline = createTimeline(db,undefined,{reviewEnabled:true});
  const start = Math.floor(Date.now()/86_400_000)*86_400_000 - 2*86_400_000;
  const end = start + 86_400_000;
  const iso = value => new Date(value).toISOString();
  const day = iso(start).slice(0,10);
  const later = iso(end).slice(0,10);
  const add = db.prepare('INSERT INTO events VALUES (?,?,?)');
  for (const [id,date,receipt] of [
    ['before',start-1,start+1],
    ['first',start,end],
    ['last',end-1,end+1],
    ['after',end,end+2],
    ['today',end+86_400_000,end+86_400_000]
  ]) {
    const timestamp = iso(date);
    const data = JSON.stringify({id,ts:timestamp,title:id,category:'geo',source:'Fixture',url:'https://example.org/'+id});
    history.observe(id,data,iso(receipt));
    add.run(id,timestamp,data);
  }
  const select = params => timeline.list(new URLSearchParams(params)).events.map(row=>row.id);
  assert.deepEqual(select({days:'range',from:day,through:day}),['last','first']);
  assert.deepEqual(select({days:'range',from:day,through:day,basis:'received'}),['before']);
  assert.deepEqual(select({days:'range',through:day}),['last','first','before']);
  assert.deepEqual(select({days:'range',from:later}),['today','after']);
  assert.deepEqual(select({days:'range',from:later,through:day}),[]);
  assert.deepEqual(select({days:'range',from:'2026-02-30'}),[]);
  assert.deepEqual(select({days:'range'}),[]);
  assert.deepEqual(select({days:'today'}),['today']);
  assert.deepEqual(select({days:'today',basis:'received'}),['today']);
  db.close();
});
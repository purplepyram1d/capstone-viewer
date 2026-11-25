import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { coverageKey } from '../lib/reading.mjs';
import { matchingTerms,validateRule,validateLocation,buildStories,createIntelligence } from '../lib/intelligence.mjs';
const fixtureTime=new Date().toISOString();
const report=(id,patch={})=>({id,title:'A substantial headline about a particular event',summary:'Vendor recommends patching',source:'Source '+id,url:'https://example.org/'+id,category:'cyber',ts:fixtureTime,score:55,cves:[],lat:null,lon:null,place:'Location not established',place_basis:'unlocated',...patch});
function database(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE events (id TEXT PRIMARY KEY,ts TEXT NOT NULL,data TEXT NOT NULL)');return db;}
const put=(db,e)=>db.prepare('INSERT INTO events VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(e.id,e.ts,JSON.stringify(e));
test('watchlists match literal words, phrases and exact CVEs without substring or regex false positives',()=>{
 const rule=validateRule({name:'Watch',terms:['US','CVE-2026-12345','C++']});
 assert.deepEqual(matchingTerms(rule,report('a',{title:'A business CVE-2026-123456 report'})),[]);
 assert.deepEqual(matchingTerms(rule,report('a',{title:'US: CVE-2026-12345 exploited; C++ affected'})),['us','cve-2026-12345','c++']);
 assert.deepEqual(matchingTerms(validateRule({name:'Phrase',terms:['Palo Alto'],mode:'all'}),report('a',{title:'PALO ALTO update'})),['palo alto']);
 assert.throws(()=>validateRule({name:'Watch',terms:[]}));assert.throws(()=>validateRule({name:'Watch',terms:['x'],mode:'regex'}));
});
test('watchlist category, provider, any/all and pause filters apply together',()=>{
 const base={name:'Watch',terms:['vendor','critical'],category:'cyber',platform:'telegram',mode:'all'};
 assert.equal(matchingTerms(validateRule(base),report('a',{platform:'telegram',title:'Critical vendor update'})).length,2);
 for(const patch of [{platform:'x'},{category:'geo'},{title:'Vendor update'}])assert.deepEqual(matchingTerms(validateRule(base),report('a',{platform:'telegram',title:'Critical vendor update',...patch})),[]);
 assert.deepEqual(matchingTerms(validateRule({...base,enabled:false}),report('a',{platform:'telegram',title:'Critical vendor update'})),[]);
});
test('watchlists can require an evidence type while older rules continue matching all types', () => {
  const base = { name: 'Vendor advisories', terms: ['vendor'] };
  const advisory = report('a', { confidence: 'Official advisory' });
  const relay = report('b', { confidence: 'Unverified report from a relay' });
  const official = validateRule({ ...base, evidence: 'Official' });
  assert.deepEqual(matchingTerms(official, advisory), ['vendor']);
  assert.deepEqual(matchingTerms(official, relay), []);
  const primary = validateRule({ ...base, evidence:'primary' });
  assert.deepEqual(matchingTerms(primary,advisory),['vendor']);
  assert.deepEqual(matchingTerms(primary,{...advisory,kind:'earthquake',confidence:'Source measurement'}),['vendor']);
  assert.deepEqual(matchingTerms(primary,relay),[]);
  assert.deepEqual(matchingTerms(validateRule(base), relay), ['vendor']);
  assert.throws(() => validateRule({ ...base, evidence: 'Guaranteed fact' }), /valid evidence type/);
});

test('geographic watchlists use source placement, support typed place-only rules, and preserve existing keyword rules',()=>{
  const warning=report('storm',{kind:'weather_alert',category:'geo',state_codes:['WA','OR'],state_basis:'source_coverage'});
  const rule=validateRule({name:'Washington weather',state:'WA',reportType:'weather'});
  assert.deepEqual(matchingTerms(rule,warning),['Washington']);
  assert.deepEqual(matchingTerms(rule,{...warning,state_codes:['CA']}),[]);
  assert.deepEqual(matchingTerms(rule,{...warning,state_codes:undefined,place:'United States',place_basis:'country_centroid'}),[]);
  const location=validateRule({name:'Canadian notices',country:'CA',terms:['vendor']});
  assert.deepEqual(matchingTerms(location,report('ca',{country:'CA'})),['vendor']);
  assert.deepEqual(matchingTerms(location,report('us',{country:'US',state_codes:['CA']})),[]);
  assert.deepEqual(matchingTerms(validateRule({name:'Local observation',state:'WA',evidence:'Measured'}),
    {kind:'earthquake',category:'geo',lon:-122.33,lat:47.60,place_basis:'event_location'}),['Washington']);
  assert.throws(()=>validateRule({name:'Unbounded alert',state:'WA'}),/select both a place/);
  assert.throws(()=>validateRule({name:'Bad code',terms:['vendor'],state:'ZZ'}),/valid U.S. state/);
});

test('watchlists apply a report type consistently in previews, existing matches and saved rules',()=>{
  const db=database();
  const watcher=createIntelligence(db);
  const advisory=report('advisory',{kind:'advisory',confidence:'Official advisory'});
  const vulnerability=report('vulnerability',{kind:'vulnerability',confidence:'Official vulnerability record'});
  for (const current of [advisory,vulnerability]) put(db,current);
  const criteria={name:'Vendor advisories',terms:['vendor'],evidence:'Official',reportType:'advisory'};
  const rule=validateRule(criteria);
  assert.deepEqual(matchingTerms(rule,advisory),['vendor']);
  assert.deepEqual(matchingTerms(rule,vulnerability),[]);
  assert.deepEqual(matchingTerms(validateRule({reportType:''},rule),vulnerability),['vendor']);
  assert.equal(validateRule({name:'Renamed'},rule).reportType,'advisory');
  assert.throws(()=>validateRule({...criteria,reportType:'invalid'}),/valid report type/);
  assert.equal(watcher.previewRule(criteria).matches,1);
  const saved=watcher.addRule(criteria);
  assert.equal(watcher.state().rules[0].reportType,'advisory');
  assert.deepEqual(watcher.state().alerts.map(alert=>alert.event_id),[advisory.id]);
  watcher.updateRule(saved.id,{reportType:'',includeExisting:true});
  assert.deepEqual(watcher.state().alerts.map(alert=>alert.event_id).sort(),[advisory.id,vulnerability.id]);
  db.close();
});

test('watchlists preview and match only the exact collector, including older social source IDs',()=>{
  const db=database();
  const watcher=createIntelligence(db);
  const faa=report('faa',{feed_id:'faa-airports',category:'geo',kind:'airport_disruption',source:'FAA NAS status'});
  const relay=report('relay',{source_id:'source-123',category:'geo',kind:'airport_disruption',source:'A local news account'});
  for (const row of [faa,relay]) put(db,row);
  const draft={name:'FAA status',collector:'faa-airports',reportType:'airport'};
  assert.deepEqual(watcher.previewRule(draft).previews.map(row=>row.id),['faa']);
  const saved=watcher.addRule(draft);
  assert.equal(watcher.state().rules[0].collector,'faa-airports');
  assert.deepEqual(watcher.state().alerts.map(alert=>alert.event_id),['faa']);
  watcher.updateRule(saved.id,{collector:'source-123',includeExisting:true});
  assert.deepEqual(watcher.state().alerts.map(alert=>alert.event_id).sort(),['faa','relay']);
  assert.equal(watcher.previewRule({...draft,terms:['unrelated']}).matches,0);
  assert.throws(()=>validateRule({...draft,collector:'https://example.org/'}),/valid collector/);
  db.close();
});

test('grouped coverage leads with its official or measured source even when a relay has a higher score',()=>{
  const relay = report('relayed',{kind:'incident',confidence:'Unverified report from a relay',score:96,source:'Relay'});
  const direct = report('first-party',{kind:'advisory',confidence:'Official advisory',score:65,source:'National CERT'});
  const [story] = buildStories([relay,direct],[{a:relay.id,b:direct.id}]);
  assert.equal(story.representative_id,direct.id);
  assert.equal(story.source,'National CERT');
  assert.equal(story.report_count,2);
  assert.equal(story.reports.find(row=>row.id===relay.id).confidence,relay.confidence);
});

test('official hazard bulletins with the same headline remain separate when their records differ',()=>{
  const ts = '2026-11-23T14:00:00Z';
  const bulletin = {title:'Flood Warning update issued by the same forecast office',ts,category:'geo',kind:'weather_alert',source:'Fixture NWS',score:58};
  const a = {...bulletin,feed_id:'nws-alerts',id:'weather-a',url:'https://example.org/alerts/one',summary:'Area A'};
  const b = {...bulletin,id:'weather-b',url:'https://example.org/alerts/two',summary:'Area B'};
  const duplicate = {...a,id:'weather-copy'};
  const stories = buildStories([a,b,duplicate]);
  assert.equal(stories.length,2);
  assert.deepEqual(stories.map(story=>story.report_count).sort(),[1,2]);
  const member=stories.find(story=>story.reports.some(report=>report.id===a.id)).reports.find(report=>report.id===a.id);
  assert.equal(member.feed_id,'nws-alerts');
  assert.equal(member.kind,'weather_alert');
});

test('groups one shared CVE with transparent evidence counts and no change in confidence',()=>{
 const a=report('a',{url:'https://www.cisa.gov/a',title:'Official exploited vulnerability',score:85,cves:['CVE-2026-12345'],confidence:'Official catalog'}),b=report('b',{title:'A social claim about the same CVE',url:'https://t.me/channel/1',platform:'telegram',source_id:'channel',score:40,cves:['CVE-2026-12345'],confidence:'Unverified post'}),c=report('c',{url:'https://cisa.gov/another',title:'Related CISA advisory',cves:['CVE-2026-12345']});
 const stories=buildStories([a,b,c]);assert.equal(stories.length,1);assert.equal(stories[0].report_count,3);assert.equal(stories[0].source_count,2);assert.equal(stories[0].confidence,'Official catalog');assert.ok(stories[0].group_basis.includes('Shared CVE'));
 assert.equal(stories[0].id,buildStories([a])[0].id);
});
test('does not join multi-CVE roundups or generic home URLs, and separates headline matches by day',()=>{
 const a=report('a',{title:'One specific story about product A',url:'https://example.org/',cves:['CVE-2026-10001','CVE-2026-10002']}),b=report('b',{title:'A different specific story about product B',url:'https://example.org/',cves:['CVE-2026-10001']});assert.equal(buildStories([a,b]).length,2);
 const old=report('old',{ts:'2026-10-22T10:00:00.000Z'});assert.equal(buildStories([report('today',{ts:'2026-10-23T10:00:00.000Z'}),old]).length,2);
 assert.equal(buildStories([report('a'),report('b')]).length,1);
});
test('canonical link grouping strips tracking while preserving identifying query parameters',()=>{
 const a=report('a',{title:'First title',url:'https://example.org/story?id=1&utm_source=mail'}),b=report('b',{title:'Updated title',url:'https://www.example.org/story?utm_source=other&id=1'}),c=report('c',{title:'Different story',url:'https://example.org/story?id=2'});assert.equal(buildStories([a,b,c]).length,2);
});
test('a generic Radar archive does not merge unrelated detections or countries', () => {
  const radar = { source:'Cloudflare Radar', kind:'routing', url:'https://radar.cloudflare.com/routing?dateRange=7d', title:'Possible routing anomaly from a global data source' };
  const a = report('a', radar), b = report('b', radar);
  assert.notEqual(coverageKey(a), coverageKey(b));
  assert.equal(buildStories([a,b]).length, 2);
  const outage = (id,country,source) => report(id,{ kind:'outage', url:source==='Cloudflare Radar'?'https://radar.cloudflare.com/outage-center':'https://example.org/ioda',country,source,ongoing:true });
  assert.equal(buildStories([outage('ng1','NG','Cloudflare Radar'),outage('ng2','NG','IODA'),outage('ke','KE','Cloudflare Radar')]).length,2);
});

test('manual grouping and separation are explicit, and the newest manual placement wins',()=>{
 const a=report('a',{title:'Event A',manual_location:{updated:'2026-10-23T10:00:00Z'},lat:1,lon:2,place:'First',place_basis:'manual'}),b=report('b',{title:'Event B',manual_location:{updated:'2026-10-23T11:00:00Z'},lat:3,lon:4,place:'Latest',place_basis:'manual'});
 const grouped=buildStories([a,b],[{a:'a',b:'b'}]);assert.equal(grouped.length,1);assert.equal(grouped[0].place,'Latest');assert.equal(grouped[0].place_basis,'manual');assert.equal(buildStories([a,b],[{a:'a',b:'b'}],new Set(['b'])).length,2);
});
test('watch alerts deduplicate across polls, persist read state, and keep history when rules are removed',()=>{
 const db=database(),intel=createIntelligence(db),e=report('a',{title:'Critical vendor report'});put(db,e);const rule=intel.addRule({name:'Vendor watch',terms:['vendor'],includeExisting:false});
 intel.evaluate([e]);intel.evaluate([e]);let state=intel.state();assert.equal(state.alerts.length,1);assert.equal(state.unread,1);assert.equal(state.alerts[0].backfill,false);
 intel.markRead(state.alerts[0].id);assert.equal(intel.state().unread,0);const again=createIntelligence(db);assert.equal(again.state().unread,0);again.removeRule(rule.id);assert.equal(again.state().alerts[0].rule_name,'Vendor watch');db.close();
});
test('watchlist previews use literal matching without saving a rule or alert', () => {
  const db = database();
  const intel = createIntelligence(db);
  put(db, report('a', { title: 'US advisory', summary: '', platform: 'telegram' }));
  put(db, report('b', { title: 'A business report', summary: '', platform: 'telegram' }));
  put(db, report('c', { title: 'US advisory', summary: '', platform: 'x' }));
  const preview = intel.previewRule({ name: 'US notices', terms: ['US'], platform: 'telegram', enabled: false });
  assert.equal(preview.scanned, 3);
  assert.equal(preview.matches, 1);
  assert.deepEqual(preview.previews.map(row => [row.id, row.terms]), [['a', ['us']]]);
  assert.deepEqual(intel.state(), { rules: [], alerts: [], unread: 0 });
  db.close();
});

test('backfill is labelled and only evaluates the rule being created or explicitly rescanned',()=>{
 const db=database(),intel=createIntelligence(db),e=report('a',{title:'Critical vendor report'});put(db,e);intel.addRule({name:'Existing no scan',terms:['vendor'],includeExisting:false});intel.addRule({name:'Backfilled',terms:['vendor']});const state=intel.state();assert.equal(state.alerts.length,1);assert.equal(state.alerts[0].rule_name,'Backfilled');assert.equal(state.alerts[0].backfill,true);db.close();
});
test('manual placement survives raw event refresh and restores source data on clear',()=>{
 const db=database(),intel=createIntelligence(db),e=report('a',{lat:47,lon:-122,place:'Vendor HQ',place_basis:'vendor_hq'});put(db,e);intel.locate('a',{lat:0,lon:0,place:'Manual equator reference',note:'Test reference'});
 put(db,{...e,summary:'Updated source summary'});const decorated=intel.decorate([{...e,summary:'Updated source summary'}]);assert.equal(decorated.events[0].lat,0);assert.equal(decorated.events[0].place_basis,'manual');assert.equal(decorated.stories[0].reports[0].manual_location.place,'Manual equator reference');
 intel.clearLocation('a');assert.equal(intel.decorate([e]).events[0].place_basis,'vendor_hq');assert.equal(intel.decorate([e]).events[0].lat,47);
 assert.throws(()=>validateLocation({lat:91,lon:0,place:'Invalid'}));assert.throws(()=>validateLocation({lat:null,lon:0,place:'Invalid'}));db.close();
});
test('manual grouping persists, separation restores one report, and expired report annotations are pruned',()=>{
 const db=database(),intel=createIntelligence(db),a=report('a',{title:'Event A'}),b=report('b',{title:'Event B'});put(db,a);put(db,b);intel.group('a','b');assert.equal(createIntelligence(db).decorate([a,b]).stories.length,1);intel.separate('b');assert.equal(intel.decorate([a,b]).stories.length,2);intel.restoreGrouping('b');intel.locate('b',{lat:5,lon:6,place:'Reference'});db.prepare('DELETE FROM events WHERE id=?').run('b');intel.prune();assert.equal(db.prepare('SELECT COUNT(*) n FROM event_annotations').get().n,0);db.close();
});

test('ongoing outage signals for one country merge into one story; other countries and ended outages stay apart',()=>{
 const o=(id,patch)=>report(id,{kind:'outage',source:'IODA',title:'Internet disruption: '+id,url:'https://ioda.example/'+id,...patch});
 const stories=buildStories([o('ng-bgp',{country:'NG',ongoing:true,score:85}),o('ng-ping',{country:'NG',ongoing:true,score:75,ts:'2026-10-21T10:00:00.000Z'}),o('ng-old',{country:'NG',ongoing:false,ts:'2026-10-20T10:00:00.000Z'}),o('et',{country:'ET',ongoing:true})]);
 const ng=stories.find(s=>s.report_ids.includes('ng-bgp'));
 assert.deepEqual([...ng.report_ids].sort(),['ng-bgp','ng-ping']);assert.equal(ng.representative_id,'ng-bgp');assert.deepEqual(ng.group_basis,['Same country, outage ongoing']);
 assert.equal(stories.length,3);
});

test('the inbox filters all retained alerts and exposes later pages and removed watchlists', () => {
  const db = database();
  const intel = createIntelligence(db);
  try {
    const watch = intel.addRule({name:'Archive watch',terms:['vendor'],includeExisting:false});
    const events = Array.from({length:161},(_,index)=>report('record-'+index,{
      title:index ? 'Vendor detail '+index : 'Vendor Ålesund report',
      ts:new Date(Date.now()-(161-index)*60_000).toISOString()
    }));
    intel.evaluate(events);
    const older = intel.inbox(new URLSearchParams({q:'ålesund'}));
    assert.equal(older.total,1);
    assert.equal(older.alerts[0].event_id,'record-0');
    assert.equal(intel.state().alerts.length,150,'the live snapshot remains bounded');
    const last = intel.inbox(new URLSearchParams({offset:'160'}));
    assert.equal(last.total,161);
    assert.equal(last.alerts[0].event_id,'record-0');
    intel.markRead(older.alerts[0].id);
    intel.removeRule(watch.id);
    const archived = intel.inbox(new URLSearchParams({rule:watch.id,unread:'1'}));
    assert.equal(archived.total,160);
    assert.deepEqual(archived.watchlists,[{id:watch.id,name:watch.name}]);
    assert.equal(intel.inbox(new URLSearchParams({age:'backfill'})).total,0);
  } finally { db.close(); }
});

test('watchlists can opt into source revision alerts without replaying reports on repeat polls', () => {
  const db = database(), intel = createIntelligence(db);
  try {
    const normal = intel.addRule({name:'Default',terms:['vendor'],includeExisting:false});
    const revisions = intel.addRule({name:'Revisions',terms:['vendor'],notifyRevisions:true,includeExisting:false});
    const original = report('tracked',{title:'Vendor report'});
    const updated = {...original,title:'Vendor report with revised guidance'};
    intel.evaluate([original]);
    intel.evaluate([updated],{revisions:new Map([[updated.id,'revision-1']])});
    intel.evaluate([updated],{revisions:new Map([[updated.id,'revision-1']])});
    intel.evaluate([updated]);
    assert.equal(intel.inbox(new URLSearchParams({rule:normal.id})).total,1);
    assert.equal(intel.inbox(new URLSearchParams({rule:revisions.id})).total,2);
    const matches = intel.inbox(new URLSearchParams({age:'revision'}));
    assert.equal(matches.total,1);
    assert.equal(matches.alerts[0].source_revision,'revision-1');
    assert.equal(matches.alerts[0].title,updated.title);
    assert.equal(intel.inbox(new URLSearchParams({age:'new'})).total,2);
  } finally { db.close(); }
});

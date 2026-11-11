import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { matchingTerms,validateRule,validateLocation,buildStories,createIntelligence } from '../lib/intelligence.mjs';
const report=(id,patch={})=>({id,title:'A substantial headline about a particular event',summary:'Vendor recommends patching',source:'Source '+id,url:'https://example.org/'+id,category:'cyber',ts:'2026-10-23T10:00:00.000Z',score:55,cves:[],lat:null,lon:null,place:'Location not established',place_basis:'unlocated',...patch});
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
test('groups one shared CVE with transparent evidence counts and no change in confidence',()=>{
 const a=report('a',{url:'https://www.cisa.gov/a',title:'Official exploited vulnerability',score:85,cves:['CVE-2026-12345'],confidence:'Official catalog'}),b=report('b',{title:'A social claim about the same CVE',url:'https://t.me/channel/1',platform:'telegram',source_id:'channel',score:40,cves:['CVE-2026-12345'],confidence:'Unverified post'}),c=report('c',{url:'https://cisa.gov/another',title:'Related CISA advisory',cves:['CVE-2026-12345']});
 const stories=buildStories([a,b,c]);assert.equal(stories.length,1);assert.equal(stories[0].report_count,3);assert.equal(stories[0].source_count,2);assert.equal(stories[0].confidence,'Official catalog');assert.ok(stories[0].group_basis.includes('Shared CVE'));
 assert.equal(stories[0].id,buildStories([a])[0].id);
});
test('does not join multi-CVE roundups or generic home URLs, and separates headline matches by day',()=>{
 const a=report('a',{title:'One specific story about product A',url:'https://example.org/',cves:['CVE-2026-10001','CVE-2026-10002']}),b=report('b',{title:'A different specific story about product B',url:'https://example.org/',cves:['CVE-2026-10001']});assert.equal(buildStories([a,b]).length,2);
 const old=report('old',{ts:'2026-10-22T10:00:00.000Z'});assert.equal(buildStories([report('today'),old]).length,2);
 assert.equal(buildStories([report('a'),report('b')]).length,1);
});
test('canonical link grouping strips tracking while preserving identifying query parameters',()=>{
 const a=report('a',{title:'First title',url:'https://example.org/story?id=1&utm_source=mail'}),b=report('b',{title:'Updated title',url:'https://www.example.org/story?utm_source=other&id=1'}),c=report('c',{title:'Different story',url:'https://example.org/story?id=2'});assert.equal(buildStories([a,b,c]).length,2);
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

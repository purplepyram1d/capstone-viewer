import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, feedConfig, normalizeBluesky, normalizeMastodon, collectSocial } from '../lib/social.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');

test('Bluesky and Mastodon targets canonicalize and refuse non-public hosts',()=>{
 for(const value of ['@Krebs.bsky.social','krebs.bsky.social','https://bsky.app/profile/krebs.bsky.social','krebs'])assert.equal(parseTarget('bluesky',value).target,'krebs.bsky.social');
 assert.equal(parseTarget('bluesky','@unit42.paloaltonetworks.com').url,'https://bsky.app/profile/unit42.paloaltonetworks.com');
 for(const value of ['https://evil.example/profile/a','https://bsky.app/search','bad handle'])assert.throws(()=>parseTarget('bluesky',value));
 for(const value of ['@briankrebs@infosec.exchange','briankrebs@infosec.exchange','https://infosec.exchange/@briankrebs'])assert.equal(parseTarget('mastodon',value).target,'briankrebs@infosec.exchange');
 for(const value of ['@a@127.0.0.1','@a@localhost','@a@intranet.corp','@a@[::1]','https://10.0.0.5/@a','@a','@bad-name!@infosec.exchange'])assert.throws(()=>parseTarget('mastodon',value),value);
 const feed=feedConfig({platform:'mastodon',input:'@briankrebs@infosec.exchange'});assert.equal(feed.enabled,true);assert.equal(feed.intervalMinutes,5);assert.match(feed.name,/^Mastodon · /);
});

test('Bluesky keeps own posts with canonical links and drops reposts',()=>{
 const feed=feedConfig({platform:'bluesky',input:'@krebs.bsky.social',category:'cyber'});
 const post=(rkey,text,extra={})=>({post:{uri:`at://did:plc:abc/app.bsky.feed.post/${rkey}`,author:{handle:'krebs.bsky.social'},record:{text,createdAt:'2026-10-23T10:00:00Z'},indexedAt:'2026-10-23T10:00:01Z'},...extra});
 const events=normalizeBluesky({feed:[post('3abcdefgh12','New CVE-2026-1234 being exploited\nmore'),post('3zzzzzzzz99','Reposted',{reason:{$type:'app.bsky.feed.defs#reasonRepost'}})]},feed,now);
 assert.equal(events.length,1);assert.equal(events[0].url,'https://bsky.app/profile/krebs.bsky.social/post/3abcdefgh12');assert.equal(events[0].platform,'bluesky');assert.deepEqual(events[0].cves,['CVE-2026-1234']);assert.equal(events[0].title,'New CVE-2026-1234 being exploited');
});

test('Mastodon strips HTML, keeps content warnings visible, and skips boosts',()=>{
 const feed=feedConfig({platform:'mastodon',input:'@briankrebs@infosec.exchange'});
 const events=normalizeMastodon([{id:'1',uri:'https://infosec.exchange/users/briankrebs/statuses/1',url:'https://infosec.exchange/@briankrebs/1',created_at:'2026-10-23T09:00:00Z',content:'<p>Line one<br>line <script>x</script>two</p>',spoiler_text:''},
  {id:'2',url:'https://infosec.exchange/@briankrebs/2',created_at:'2026-10-23T09:00:00Z',content:'<p>Graphic</p>',spoiler_text:'violence'},{id:'3',reblog:{},content:'<p>boost</p>',created_at:'2026-10-23T09:00:00Z'}],feed,now);
 assert.equal(events.length,2);assert.equal(events[0].title,'Line one');assert.doesNotMatch(events[0].summary,/</);assert.equal(events[1].title,'CW: violence');
});

test('Mastodon collection refuses private DNS answers and uses cursors after the first poll',async()=>{
 const feed=feedConfig({platform:'mastodon',input:'@briankrebs@infosec.exchange'}),urls=[];
 await assert.rejects(collectSocial(feed,{},'',async()=>{throw new Error('must not fetch');},async()=>[{address:'10.1.2.3',family:4}]),/private or local/);
 const request=async url=>{urls.push(url);return {ok:true,text:async()=>url.includes('lookup')?JSON.stringify({id:'109'}):JSON.stringify([{id:'200',url:'https://infosec.exchange/@briankrebs/200',created_at:'2026-10-23T09:00:00Z',content:'<p>Hi</p>'}])};};
 const first=await collectSocial(feed,{},'',request,async()=>[{address:'93.184.216.34',family:4}]);
 assert.deepEqual(first.runtime,{accountId:'109',sinceId:'200'});assert.equal(first.events.length,1);
 urls.length=0;await collectSocial(feed,first.runtime,'',request,async()=>[{address:'93.184.216.34',family:4}]);
 assert.equal(urls.length,1,'account ID is cached');assert.match(urls[0],/since_id=200/);
});

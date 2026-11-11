import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseTarget, feedConfig, parseTelegram, normalizeX, collectSocial } from '../lib/social.mjs';
import { createSocialManager } from '../lib/social-manager.mjs';
import { createCredentials } from '../lib/credentials.mjs';
const now=Date.parse('2026-10-23T12:00:00Z');
const tg=feedConfig({platform:'telegram',input:'@TestChannel',category:'geo'});
test('canonicalizes Telegram handles, previews, and post links without allowing arbitrary hosts',()=>{
 for(const value of ['@TestChannel','https://t.me/TestChannel','https://t.me/s/TestChannel','https://t.me/TestChannel/123'])assert.equal(parseTarget('telegram',value).target,'testchannel');
 for(const value of ['https://evil.example/a','https://t.me/+invitation','https://t.me/c/123/4','https://t.me/joinchat/secret','../../etc'])assert.throws(()=>parseTarget('telegram',value));
});
test('accepts X accounts and numeric public Lists; X starts paused and respects cost controls',()=>{
 assert.equal(parseTarget('x','https://twitter.com/TestUser/status/123').target,'testuser');
 assert.equal(parseTarget('x','https://x.com/i/lists/123456').kind,'list');
 assert.equal(feedConfig({platform:'x',input:'@TestUser'}).enabled,false);
 assert.throws(()=>feedConfig({platform:'x',input:'@TestUser',intervalMinutes:1}));
 assert.throws(()=>feedConfig({platform:'x',input:'@TestUser',maxPosts:100}));
 assert.throws(()=>parseTarget('x','https://x.com/i/lists/not-a-number'));
 assert.equal(feedConfig({platform:'telegram',input:'https://t.me/TESTCHANNEL'}).id,tg.id);
});
test('Telegram reads dated text only and never loads attachments or executes message HTML',()=>{
 const html=`<div class="tgme_widget_message" data-post="testchannel/123"><div class="tgme_widget_message_text">Breaking CVE-2026-12345<br>Patch &amp; verify <a href="javascript:alert(1)">details</a></div><time datetime="2026-10-23T10:00:00Z"></time><img src="https://example.org/leaked-data"></div><div class="tgme_widget_message" data-post="otherchannel/99"><div class="tgme_widget_message_text">Ignore forwarded markup</div><time datetime="2026-10-23T10:00:00Z"></time></div>`;
 const result=parseTelegram(html,tg,now);assert.equal(result.events.length,1);assert.equal(result.events[0].url,'https://t.me/testchannel/123');assert.equal(result.events[0].lat,null);assert.match(result.events[0].summary,/Patch & verify details/);assert.deepEqual(result.events[0].cves,['CVE-2026-12345']);assert.match(result.events[0].confidence,/Unverified/);
 assert.throws(()=>parseTelegram('<html>Please log in</html>',tg));
 assert.equal(parseTelegram(html.replace('2026-10-23','2020-01-01'),tg,now).events.length,0);
});
test('X normalization keeps creation timestamps, canonical links, and stable post IDs',()=>{
 const feed=feedConfig({platform:'x',input:'https://x.com/i/lists/123456'});
 const result=normalizeX({data:[{id:'987654321',text:'A report CVE-2026-12345',created_at:'2026-10-23T10:00:00Z',author_id:'456'}],includes:{users:[{id:'456',username:'Reporter'}]}},feed,now);
 assert.equal(result[0].url,'https://x.com/Reporter/status/987654321');assert.equal(result[0].platform,'x');assert.equal(result[0].place_basis,'unlocated');assert.match(result[0].source,/@Reporter/);
});
test('X requests use a bearer header, cached user IDs, incremental account cursors, and capped reads',async()=>{
 const feed=feedConfig({platform:'x',input:'@testuser',enabled:true});const calls=[];
 const request=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('/by/username/')?{data:{id:'456'}}:{data:[{id:'999',text:'Current post',created_at:new Date().toISOString(),author_id:'456'}],meta:{newest_id:'999'}}),{status:200});};
 const result=await collectSocial(feed,{},'fake-test-token',request);assert.equal(calls.length,2);assert.equal(calls[0].options.headers.Authorization,'Bearer fake-test-token');assert.equal(new URL(calls[1].url).searchParams.get('max_results'),'5');assert.equal(new URL(calls[1].url).searchParams.get('post.fields'),'created_at');assert.equal(result.runtime.sinceId,'999');
 calls.length=0;await collectSocial(feed,result.runtime,'fake-test-token',request);assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).searchParams.get('since_id'),'999');
 calls.length=0;const list=feedConfig({platform:'x',input:'https://x.com/i/lists/123'});await collectSocial(list,{sinceId:'999'},'fake-test-token',request);assert.equal(new URL(calls[0].url).searchParams.has('since_id'),false);
});
test('missing X credentials make no request, and 429 errors provide backoff without leaking API bodies',async()=>{
 let calls=0;const request=async()=>{calls++;return new Response('secret body must never be displayed',{status:429,headers:{'x-rate-limit-reset':String(Math.floor(Date.now()/1000)+3600)}});};
 const feed=feedConfig({platform:'x',input:'@testuser'});await assert.rejects(collectSocial(feed,{},'',request),/Connect an X/);assert.equal(calls,0);
 await assert.rejects(collectSocial(feed,{userId:'456'},'test',request),error=>error.retryAt>Date.now()+800000&&!error.message.includes('secret'));
});
test('social feed settings survive manager recreation, paused feeds do not poll, and cooldown survives restart',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE feeds (id TEXT PRIMARY KEY,data TEXT NOT NULL)');let calls=0;const entries=[];
 const creds={get:()=>'',status:()=>({configured:false})};const collect=async()=>{calls++;return {events:[],observed:2,runtime:{},usedUrl:'https://t.me/s/testchannel'};};
 let manager=createSocialManager(db,creds,()=>{},events=>entries.push(...events),collect);
 const feed=manager.add({platform:'telegram',input:'@testchannel',enabled:false});await manager.tick();assert.equal(calls,0);
 manager.update(feed.id,{enabled:true});await manager.tick();assert.equal(calls,1);assert.equal(manager.list()[0].state,'ok');
 manager=createSocialManager(db,creds,()=>{},()=>{},collect);await manager.tick();assert.equal(calls,1);assert.equal(manager.list().length,1);
 manager.remove(feed.id);assert.equal(manager.list().length,0);db.close();
});
test('removing a feed during an in-flight poll prevents posts from being reinserted',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE feeds (id TEXT PRIMARY KEY,data TEXT NOT NULL)');let finish,writes=0;
 const manager=createSocialManager(db,{get:()=>'',status:()=>({})},()=>{},()=>writes++,()=>new Promise(resolve=>finish=resolve));
 const feed=manager.add({platform:'telegram',input:'@testchannel'});const poll=manager.poll(feed.id);manager.remove(feed.id);finish({events:[],runtime:{}});await poll;assert.equal(writes,0);assert.equal(manager.list().length,0);db.close();
});
test('session credential status never returns the bearer token',async()=>{
 const savedEnv=process.env.X_BEARER_TOKEN;delete process.env.X_BEARER_TOKEN;
 try{const credentials=await createCredentials();await credentials.set('test-only-not-a-real-key');assert.equal(credentials.get(),'test-only-not-a-real-key');assert.equal(JSON.stringify(credentials.status()).includes('test-only-not-a-real-key'),false);await credentials.set('');assert.equal(credentials.status().configured,false);await assert.rejects(credentials.set('bad\nheader'));}finally{if(savedEnv!==undefined)process.env.X_BEARER_TOKEN=savedEnv;}
});

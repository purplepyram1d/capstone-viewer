import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLiveWriter } from '../lib/live-writer.mjs';
import { outageFreshness } from '../lib/outage-state.mjs';
import { computeStatus } from '../lib/status.mjs';
import { situation, buildDigest } from '../lib/digest.mjs';
import { topHeadlines } from '../lib/headlines.mjs';

const now = Date.parse('2026-11-22T12:00:00Z');
const ago = minutes => new Date(now - minutes * 60_000).toISOString();

test('a stale outage is neither current nor recovered', () => {
  const report = { id:'old', kind:'outage', ongoing:true, country:'US', score:85, ts:ago(30) };
  const current = outageFreshness(report, ago(4), now);
  const stale = outageFreshness(report, ago(21), now);
  assert.equal(current.outage_state,'current');
  assert.equal(stale.ongoing,true,'retained source state');
  assert.equal(stale.outage_state,'stale');
  assert.equal(outageFreshness(report,null,now).outage_state,'stale');
  assert.equal(computeStatus({reports:[stale],now})[0].alertLevel,'green');
  assert.equal(computeStatus({reports:[stale],now})[0].inputs.at(-1).value,1);
  const then = situation({events:[current]},now-60_000);
  const digest = buildDigest({ since:ago(1), then, current:situation({events:[stale]},now), now });
  assert.deepEqual(digest.outages.ended,[]);
  assert.deepEqual(digest.outages.stale,[{code:'US',name:'US'}]);
  assert.equal(digest.quiet,false);
  assert.equal(topHeadlines([stale],{now}).rows.length,0);
});

test('accounts sharing a citation do not inflate CVE mention groups or alarms',()=>{
  const mention = (source, url) => ({ source, kind:'social', platform:'bluesky', ts:ago(5), cves:['CVE-2026-9999'], citation_urls:[url] });
  const posts = [
    mention('A','https://example.org/disclosure?utm_source=copy#summary'),
    mention('B','https://example.org/disclosure'),
    mention('C','https://secondary.example/report'),
    mention('C','https://example.org/disclosure')
  ];
  const tiles = computeStatus({reports:posts,now});
  assert.equal(tiles.at(-1).level,'green');
  assert.equal(tiles.at(-1).alertLevel,'green');
  const withAnotherSource = computeStatus({reports:[...posts,mention('D','https://primary.example/update')],now});
  assert.equal(withAnotherSource.at(-1).level,'amber');
  assert.equal(withAnotherSource.at(-1).alertLevel,'green');
});

test('a slow live client keeps only the latest pending snapshot',()=>{
  const response = new EventEmitter(), frames = [];
  response.write = frame => { frames.push(frame); response.writableNeedDrain = frames.length === 1; return !response.writableNeedDrain; };
  const send = createLiveWriter(response);
  send('initial',true);
  send('obsolete',true);
  send('heartbeat');
  send('current',true);
  assert.deepEqual(frames,['initial']);
  response.writableNeedDrain = false;
  response.emit('drain');
  assert.deepEqual(frames,['initial','current']);
  response.emit('close');
});

test('the collector stops oversized downloads and decodes split UTF-8 safely', async () => {
  const { fetchText } = await import('../lib/collectors.mjs');
  let cancelled = false;
  const huge = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(12_000_001)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(fetchText('https://example.org/feed',{request:async()=>new Response(huge)}), /size limit/);
  assert.equal(cancelled,true);
  const bytes = new TextEncoder().encode('Québec');
  const small = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0,2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    }
  });
  assert.equal(await fetchText('https://example.org/feed',{request:async()=>new Response(small)}),'Québec');
});

test('a malformed primary payload can fall back to the official collector mirror', async () => {
  const { collect, feeds } = await import('../lib/collectors.mjs');
  const feed = feeds.find(item => item.id === 'kev');
  const now = new Date().toISOString().slice(0, 10);
  const valid = JSON.stringify({ vulnerabilities: [{ vendorProject: 'Fixture', cveID: 'CVE-2026-12345',
    vulnerabilityName: 'Fixture advisory', dateAdded: now }] });
  const urls = [];
  const result = await collect(feed, '', { request: async url => {
    urls.push(url);
    return new Response(url === feed.url ? '{"vulnerabilities":{}}' : valid);
  } });
  assert.deepEqual(urls, [feed.url, feed.fallback]);
  assert.equal(result.usedUrl, feed.fallback);
  assert.equal(result.events.length, 1);
});

test('malformed USGS features do not discard other measurements in the same collection', async () => {
  const { collect, feeds } = await import('../lib/collectors.mjs');
  const feed = feeds.find(item => item.id === 'usgs');
  const data = { features: [
    { properties: { title: 'M 5.0 test', time: Date.now(), mag: 5, url: 'https://example.org/usgs', place: 'Offshore' },
      geometry: { coordinates: [34, -18, 10] } },
    { properties: { time: null, mag: 4.6 }, geometry: { coordinates: [-120, 40] } },
    { properties: { time: Date.now(), mag: 4.8 }, geometry: null }
  ] };
  const { events } = await collect(feed, '', { request: async () => new Response(JSON.stringify(data)) });
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].lon, events[0].lat], [34, -18]);
});

test('CERT-EU advisory timestamps respect Central European standard and summer offsets', async () => {
  const { collect, feeds } = await import('../lib/collectors.mjs');
  const feed = feeds.find(item => item.id === 'cert-eu');
  const sourceClock = new Date(Date.now() - 12 * 3600000);
  const dates = ['CET', 'CEST'];
  const rss = '<rss><channel>' + dates.map((zone, index) =>
    '<item><title>Fixture advisory</title><link>https://example.org/advisory-' + index +
    '</link><pubDate>' + sourceClock.toUTCString().replace('GMT', zone) + '</pubDate></item>').join('') + '</channel></rss>';
  const { events } = await collect(feed, '', { request: async () => new Response(rss) });
  const rounded = Math.floor(sourceClock.getTime() / 1000) * 1000;
  assert.deepEqual(events.map(event => [event.kind, event.confidence, Date.parse(event.ts)]), [
    ['advisory','Official advisory',rounded - 3600000],
    ['advisory','Official advisory',rounded - 2 * 3600000]
  ]);
});

test('Canadian Cyber Centre bulletins keep the publisher update date and original reference',async()=>{
  const {collect,feeds} = await import('../lib/collectors.mjs');
  const feed = feeds.find(item=>item.id==='cccs');
  const updated = new Date(Date.now()-3600_000).toISOString();
  const entry = (host, title) => `<entry><link rel="alternate" href="https://${host}/en/alerts-advisories/advisory-fixture"/><title>${title}</title><updated>${updated}</updated><content>Full body omitted</content></entry>`;
  const xml = '<feed xmlns="http://www.w3.org/2005/Atom">'+entry('cyber.gc.ca','Official bulletin AV26-0001')+entry('other.example','Unverified link')+'</feed>';
  const {events} = await collect(feed,'',{request:async()=>new Response(xml)});
  assert.equal(events.length,1);
  const [bulletin] = events;
  assert.equal(bulletin.kind,'advisory');
  assert.equal(bulletin.category,'cyber');
  assert.equal(bulletin.confidence,'Official advisory');
  assert.equal(bulletin.lat,null);
  assert.equal(bulletin.summary,'');
  assert.equal(bulletin.ts,updated);
  assert.equal(bulletin.source_date_basis,'updated');
  assert.equal(bulletin.url,'https://cyber.gc.ca/en/alerts-advisories/advisory-fixture');
});

test('vendor advisories retain canonical publisher links and source timestamps',async()=>{
  const {collect,feeds} = await import('../lib/collectors.mjs');
  const published = new Date(Date.now()-90*60_000).toISOString();
  const ciscoLink = 'https://sec.cloudapps.cisco.com/security/center/content/CiscoSecurityAdvisory/cisco-sa-example-123';
  const row = (link,date) => '<item><title>Vendor bulletin fixture</title><link>'+link+'</link><pubDate>'+date+
    '</pubDate><description>References CVE-2026-44444 and full detail.</description></item>';
  const fixture = rows => async()=>new Response('<rss><channel>'+rows+'</channel></rss>');
  const cisco = feeds.find(feed=>feed.id==='cisco-psirt');
  const timed = published.replace('T',' ').replace('Z','');
  const {events:[advisory]} = await collect(cisco,'',{request:fixture(row(ciscoLink+'?ref=rss',timed))});
  assert.equal(advisory.ts,published);
  assert.equal(advisory.url,ciscoLink);
  assert.equal(advisory.source,'Cisco Systems, Inc.');
  assert.equal(advisory.source_date_basis,'updated');
  assert.equal(advisory.summary,'');
  assert.deepEqual(advisory.cves,['CVE-2026-44444']);
  const aws = feeds.find(feed=>feed.id==='aws-bulletins');
  const awsLink = 'https://aws.amazon.com/security/security-bulletins/rss/2026-197-aws/';
  const {events} = await collect(aws,'',{request:fixture(row(awsLink,published)+row('https://elsewhere.example/security/security-bulletins/rss/2026-197-aws/',published))});
  assert.deepEqual(events.map(item=>[item.kind,item.confidence,item.url]),[['advisory','Official vendor advisory',awsLink]]);
});

test('built-in polls use start time, source cadence, and provider backoff', async () => {
  const { fetchText, nextCollectorPoll } = await import('../lib/collectors.mjs');
  const lastAttempt = new Date(now - 15 * 60_000).toISOString();
  const status = { lastAttempt, lastSuccess:new Date(now - 15 * 60_000 + 2500).toISOString() };
  assert.equal(nextCollectorPoll({intervalMs:15 * 60_000},status,now), now);
  assert.equal(nextCollectorPoll({}, {lastAttempt:new Date(now).toISOString()},now), now + 5 * 60_000);
  assert.equal(nextCollectorPoll({}, {retryAfter:new Date(now + 900_000).toISOString()},now), now + 900_000);
  const before = Date.now();
  await assert.rejects(fetchText('https://example.org/feed',{request:async()=>new Response('',{status:429,headers:{'Retry-After':'120'}})}), error =>
    error.message === 'HTTP 429' && error.retryAt >= before + 120_000);
  await assert.rejects(fetchText('https://example.org/feed',{request:async()=>new Response('',{status:503,headers:{'Retry-After':'unknown'}})}), error =>
    error.message === 'HTTP 503' && error.retryAt === undefined);
});

test('RSS research coverage preserves a source date with day precision', async () => {
  const {feeds,collect} = await import('../lib/collectors.mjs');
  const feed = feeds.find(item=>item.id==='cmu-robotics');
  const day = new Date().toISOString().slice(0,10);
  const rss = '<rss><channel><item><title>Robotics research fixture</title><link>https://example.org/robotics</link><pubDate>' + day + '</pubDate></item></channel></rss>';
  const {events:[event]} = await collect(feed,'',{request:async()=>new Response(rss)});
  assert.equal(event.source,'CMU Robotics Institute');
  assert.equal(event.date_precision,'day');
  assert.equal(event.category,'ai');
});

test('conditional publisher responses confirm a successful poll without processing repeat reports', async () => {
  const {collect,feeds} = await import('../lib/collectors.mjs');
  const feed = feeds.find(item=>item.id==='ieee-robotics');
  const rss = '<rss><channel><item><title>Robotics report</title><link>https://example.org/article</link><pubDate>' +
    new Date().toUTCString() + '</pubDate></item></channel></rss>';
  const first = await collect(feed,'',{request:async()=>new Response(rss,{headers:{etag:'"fixture"'}})});
  assert.equal(first.events.length,1);
  assert.equal(first.unchanged,false);
  const repeated = await collect(feed,'',{
    validators:first.validators,
    request:async (url,options)=>{
      assert.equal(url,feed.url);
      assert.equal(options.headers['If-None-Match'],'"fixture"');
      return new Response(null,{status:304});
    }
  });
  assert.equal(repeated.unchanged,true);
  assert.deepEqual(repeated.events,[]);
  assert.deepEqual(repeated.validators,first.validators);
  await assert.rejects(collect({...feed,url:'https://example.org/changed-feed'},'',{
    validators:first.validators,request:async(url,options)=>{
      assert.equal(options.headers['If-None-Match'],undefined);
      return new Response(null,{status:304});
    }
  }),/HTTP 304/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { currentBroadcast, createStreamResolver } from '../lib/streams.mjs';

const videoId = 'abc-def1234';
const html = player => '<html><script>var ytInitialPlayerResponse = '+JSON.stringify(player)+';</script></html>';
const active = (id = videoId) => ({
  playabilityStatus:{status:'OK'},videoDetails:{videoId:id,isLiveContent:true},
  microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{isLiveNow:true}}}
});

test('wall lookup uses the selected live player data and rejects archives, upcoming videos and sign-in pages', () => {
  assert.deepEqual(currentBroadcast(html(active())),{videoId});
  const archived = active();
  archived.microformat.playerMicroformatRenderer.liveBroadcastDetails = {endTimestamp:'2026-11-23T10:00:00Z'};
  assert.equal(currentBroadcast(html(archived)+'"isLiveNow":true').videoId,undefined);
  const upcoming = active();
  upcoming.videoDetails.isUpcoming = true;
  assert.equal(currentBroadcast(html(upcoming)).videoId,undefined);
  const gated = active();
  gated.playabilityStatus.status = 'LOGIN_REQUIRED';
  assert.equal(currentBroadcast(html(gated)).retryable,false);
  assert.equal(currentBroadcast('<p>Use cookies to continue</p>').videoId,undefined);
});

test('wall lookup reads only the player JSON when YouTube appends script statements', () => {
  const player = active();
  player.videoDetails.title = 'Live {test} with quote " and a backslash \\';
  const withScript = html(player).replace('</script>', 'var meta = document.createElement("meta");</script>');
  assert.deepEqual(currentBroadcast(withScript), {videoId});

  player.playabilityStatus.playableInEmbed = false;
  assert.match(currentBroadcast(html(player)).error, /blocks embedded playback/);
  assert.equal(currentBroadcast('<script>ytInitialPlayerResponse = {"unclosed": {;</script>').videoId, undefined);
});

test('concurrent windows share channel lookups and manual retry respects a short refresh boundary', async () => {
  const requested = [];
  let now = 10_000, broadcaster = videoId;
  const resolve = createStreamResolver(async url=>{
    requested.push(url);
    await Promise.resolve();
    return html(active(broadcaster));
  },()=>now);
  const result = await Promise.all([resolve('@Channel'),resolve('@channel',true)]);
  assert.equal(requested.length,1);
  assert.deepEqual(result.map(item=>item.data.videoId),[videoId,videoId]);
  broadcaster = 'another1234';
  now += 10_000;
  assert.equal((await resolve('@Channel',true)).data.videoId,videoId);
  assert.equal(requested.length,1);
  now += 5001;
  assert.equal((await resolve('@Channel',true)).data.videoId,broadcaster);
  assert.equal(requested.length,2);
  assert.match(requested[0],/^https:\/\/www\.youtube\.com\/@Channel\/live$/);
});

test('wall retries honor a provider retry time on manual as well as automatic checks', async () => {
  let time = 10_000, attempts = 0;
  const resolve = createStreamResolver(async()=>{
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('HTTP 429'),{retryAt:100_000});
    return html(active());
  },()=>time);
  assert.equal((await resolve('@Channel')).code,502);
  time = 99_000;
  assert.equal((await resolve('@Channel',true)).code,502);
  assert.equal(attempts,1);
  time = 100_000;
  assert.equal((await resolve('@Channel',true)).data.videoId,videoId);
  assert.equal(attempts,2);
});

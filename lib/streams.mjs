const playerStart = /<script\b[^>]*>\s*(?:(?:var|let|const)\s+)?ytInitialPlayerResponse\s*=\s*/i;
const videoIdFormat = /^[\w-]{11}$/;

// YouTube may append executable statements after the JSON assignment.
function assignedObject(script) {
  if (script[0] !== '{') return '';
  let depth = 0, quoted = false;
  for (let i = 0; i < script.length; i++) {
    const char = script[i];
    if (quoted) {
      if (char === '\\') i++;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && --depth === 0) {
      return script.slice(0, i + 1);
    }
  }
  return '';
}

export function currentBroadcast(html) {
  const marker = playerStart.exec(html);
  if (!marker) return {error:'YouTube did not provide details for a current broadcast.'};
  const start = marker.index + marker[0].length;
  const end = html.indexOf('</script',start);
  if (end < 0) return {error:'YouTube returned incomplete broadcast details.'};
  let player;
  try { player = JSON.parse(assignedObject(html.slice(start,end))); }
  catch { return {error:'YouTube returned unreadable broadcast details.'}; }

  const status = player?.playabilityStatus?.status;
  const details = player?.videoDetails;
  const broadcast = player?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
  if (status === 'LOGIN_REQUIRED') return {error:'YouTube requires sign-in for this broadcast.',retryable:false};
  if (status === 'LIVE_STREAM_OFFLINE' || details?.isUpcoming || broadcast?.endTimestamp) {
    return {error:'This channel has no active broadcast.',retryable:true};
  }
  if (status !== 'OK' || !videoIdFormat.test(details?.videoId || '') ||
      !(broadcast?.isLiveNow === true || details.isLive === true)) {
    return {error:'No active broadcast was confirmed for this channel.',retryable:true};
  }
  if (player.playabilityStatus.playableInEmbed === false) {
    return {error:'This broadcaster blocks embedded playback.',retryable:true};
  }
  return {videoId:details.videoId};
}

export function createStreamResolver(fetchPage, now = () => Date.now()) {
  const cache = new Map(), pending = new Map();
  return async function resolveStream(channel, refresh = false) {
    const id = channel.startsWith('@') ? channel.toLowerCase() : channel;
    if (pending.has(id)) return pending.get(id);
    const cached = cache.get(id);
    if (cached?.until > now() && (!refresh || now() < cached.refreshAt)) return cached.result;
    const segment = channel.startsWith('@') ? channel : 'channel/' + channel;
    const request = (async () => {
      let data, retryAt = 0;
      try { data = currentBroadcast(await fetchPage('https://www.youtube.com/' + segment + '/live')); }
      catch (error) {
        data = {error:'Could not check YouTube. ' + error.message,retryable:true};
        retryAt = error.retryAt || 0;
      }
      const result = {code:data.videoId ? 200 : 502,data};
      const checked = now();
      cache.delete(id);
      cache.set(id,{result,refreshAt:Math.max(retryAt,checked + 15_000),
        until:Math.max(retryAt,checked + (data.videoId ? 300_000 : 60_000))});
      if (cache.size > 128) cache.delete(cache.keys().next().value);
      return result;
    })();
    pending.set(id,request);
    try { return await request; }
    finally { pending.delete(id); }
  };
}

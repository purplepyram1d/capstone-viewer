// Feed health: which collectors have been failing for over an hour, or have gone quiet without an error,
// and which status tiles that leaves short of inputs. A tile with a data gap can look calmer than it is.
const MINUTE = 60000;
const coreTiles = { ioda: 'internet', 'radar-outages': 'internet', 'radar-hijacks': 'internet', 'ris-pulse': 'internet',
  kev: 'cyber', cisa: 'cyber', nvd: 'cyber', threatfox: 'cyber', urlhaus: 'cyber', ransomware: 'cyber', bbc: 'conflict', 'guardian-world': 'conflict', 'un-news': 'conflict', 'uk-ncsc': 'cyber', 'cert-fr': 'cyber', 'cert-eu': 'cyber', cccs: 'cyber', 'aws-bulletins':'cyber', 'cisco-psirt':'cyber', jvn: 'cyber', jpcert: 'cyber' };
// Social feeds land where their reports land: claim relays feed Cyber, world-desk channels feed Conflict,
// everything else feeds Researcher chatter.
const earthInputs = new Set(['usgs','geonet-earthquakes','ga-earthquakes','jma-earthquakes','nws-alerts','eccc-weather','ea-floods','nwps-observed','nws-storm-reports','nhc-cyclones']);
export function tileOf(feed) {
  if (coreTiles[feed.id]) return coreTiles[feed.id];
  if (earthInputs.has(feed.id) || /^meteo-/.test(feed.id || '')) return 'earth';
  if (!feed.platform) return null;
  if (feed.claims) return 'cyber';
  return feed.category === 'geo' ? 'conflict' : feed.category === 'cyber' ? 'social' : null;
}

// `startedAt` is when this server started: time the app was not running is not a stall, so a feed only counts
// as quiet from the later of its last success and the start.
export function feedHealth(feeds, { pulse = null, now = Date.now(), startedAt = 0 } = {}) {
  const problems = [];
  for (const f of feeds) {
    if (f.enabled === false || ['paused', 'needs-key', 'waiting', 'collecting'].includes(f.state)) continue;
    const failingFor = f.state === 'error' && f.failingSince ? now - Math.max(Date.parse(f.failingSince), startedAt) : 0;
    const quietFor = f.state === 'ok' && f.lastSuccess ? now - Math.max(Date.parse(f.lastSuccess), startedAt) : 0;
    const quietLimit = Math.max(60, 3 * (f.intervalMinutes || 5)) * MINUTE;
    if (failingFor >= 60 * MINUTE) problems.push({ id: f.id, name: f.name, kind: 'failing', since: f.failingSince, detail: f.error || 'Collection is failing.', tile: tileOf(f) });
    else if (quietFor > quietLimit) problems.push({ id: f.id, name: f.name, kind: 'stalled', since: f.lastSuccess, detail: 'No successful poll within the expected interval.', tile: tileOf(f) });
  }
  // The routing pulse is a live stream, not a poll: it is failing once no message has arrived for an hour.
  if (pulse && pulse.lastMessage && now - Date.parse(pulse.lastMessage) >= 60 * MINUTE)
    problems.push({ id: 'ris-pulse', name: 'RIPE RIS routing pulse', kind: 'failing', since: pulse.lastMessage, detail: pulse.error || 'No BGP updates received.', tile: 'internet' });
  return problems;
}

export function pollCoverageState(feed, { enabled = true, now = Date.now() } = {}) {
  if (!enabled || feed.enabled === false || feed.state === 'paused') return 'paused';
  if (feed.state === 'needs-key' || feed.state === 'error') return feed.state;
  const lastSuccess = Date.parse(feed.lastSuccess);
  if (feed.state === 'ok' && Number.isFinite(lastSuccess)) {
    const freshness = Math.max(15, 3 * (feed.intervalMinutes || 5)) * MINUTE;
    return lastSuccess >= now - freshness ? 'current' : 'overdue';
  }
  return feed.polling || feed.state === 'collecting' ? 'collecting' : feed.queued ? 'queued' : 'waiting';
}

export function withGaps(status, problems, feeds = [], { enabled = true, pulse = null, now = Date.now() } = {}) {
  return status.map(tile => {
    const candidates = feeds.filter(feed => tileOf(feed) === tile.id);
    const paused = candidates.filter(feed => feed.enabled === false || feed.state === 'paused').map(feed=>feed.name);
    const inputs = candidates.filter(feed => feed.enabled !== false && !['needs-key', 'paused'].includes(feed.state));
    const missing = inputs.filter(feed => pollCoverageState(feed,{now}) !== 'current').map(feed => feed.name);
    let expected = inputs.length;
    if (tile.id === 'internet' && enabled) {
      expected++;
      if (!(Date.parse(pulse?.lastMessage) >= now - 15 * MINUTE)) missing.push('RIPE RIS Live');
    }
    const label = !enabled ? 'Collection paused' : !expected ? 'No active inputs' : `${expected - missing.length}/${expected} inputs current`;
    return {
      ...tile,
      gaps: problems.filter(problem => problem.tile === tile.id).map(problem => problem.name),
      coverage: { label, current: enabled ? expected - missing.length : 0, expected: enabled ? expected : 0, missing: enabled ? missing : [], paused:enabled ? paused : [] }
    };
  });
}

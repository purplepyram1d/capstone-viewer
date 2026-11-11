// Feed health: which collectors have been failing for over an hour, or have gone quiet without an error,
// and which status tiles that leaves short of inputs. A tile with a data gap can look calmer than it is.
const MINUTE = 60000;
const coreTiles = { ioda: 'internet', 'radar-outages': 'internet', 'radar-hijacks': 'internet', 'ris-pulse': 'internet',
  kev: 'cyber', cisa: 'cyber', nvd: 'cyber', threatfox: 'cyber', urlhaus: 'cyber', ransomware: 'cyber', bbc: 'conflict', gdelt: 'conflict' };
// Social feeds land where their reports land: claim relays feed Cyber, world-desk channels feed Conflict,
// everything else feeds Researcher chatter.
export function tileOf(feed) {
  if (coreTiles[feed.id]) return coreTiles[feed.id];
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
    const failingFor = f.state === 'error' && f.failingSince ? now - Date.parse(f.failingSince) : 0;
    const quietFor = f.state === 'ok' && f.lastSuccess ? now - Math.max(Date.parse(f.lastSuccess), startedAt) : 0;
    const quietLimit = Math.max(60, 3 * (f.platform ? f.intervalMinutes || 5 : 5)) * MINUTE;
    if (failingFor >= 60 * MINUTE) problems.push({ id: f.id, name: f.name, kind: 'failing', since: f.failingSince, detail: f.error || 'Collection is failing.', tile: tileOf(f) });
    else if (quietFor > quietLimit) problems.push({ id: f.id, name: f.name, kind: 'stalled', since: f.lastSuccess, detail: 'No successful collection and no error reported; the poller may be stuck.', tile: tileOf(f) });
  }
  // The routing pulse is a live stream, not a poll: it is failing once no message has arrived for an hour.
  if (pulse && pulse.lastMessage && now - Date.parse(pulse.lastMessage) >= 60 * MINUTE)
    problems.push({ id: 'ris-pulse', name: 'RIPE RIS routing pulse', kind: 'failing', since: pulse.lastMessage, detail: pulse.error || 'No BGP updates received.', tile: 'internet' });
  return problems;
}

export const withGaps = (status, problems) => status.map(t => ({ ...t, gaps: problems.filter(p => p.tile === t.id).map(p => p.name) }));

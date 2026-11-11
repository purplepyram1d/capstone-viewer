// Plain-language description of a collection gap found at startup, for the Operations banner and the
// startup notification. `previous` comes from the desktop's lifecycle log (how the last run ended).
export const duration = minutes => { const d = Math.floor(minutes / 1440), h = Math.floor(minutes % 1440 / 60), m = minutes % 60; return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function describeOffline(gap) {
  const p = gap.previous;
  let cause;
  if (!p || !p.known) cause = 'How the previous session ended is not recorded (the lifecycle log started with this version).';
  else if (p.clean) cause = `The previous session was quit normally${p.lastEventAt ? ` (${when(p.lastEventAt)})` : ''}.`;
  else cause = `The previous session ended without a clean exit: its last logged event was "${p.lastEvent}"${p.lastEventAt ? ` at ${when(p.lastEventAt)}` : ''}${p.lastAlive ? `, and its last heartbeat was ${when(p.lastAlive)}` : ''}. That usually means it was killed, crashed, or Windows restarted.`;
  return { title: `Capstone was offline for ${duration(gap.minutes)}`, body: `Not collecting from ${when(gap.from)} to ${when(gap.to)}. Reports from that gap may be missing or arrive late.`, cause };
}

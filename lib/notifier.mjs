import { text } from './events.mjs';
// Desktop notifications: the server decides what is worth a Windows toast and hands it to the desktop
// process. Nothing leaves the machine. The first check after start sets the baseline, so restarting the
// app never replays old alerts.
const rank = { green: 0, amber: 1, red: 2 }, levelNames = { green: 'Normal', amber: 'Elevated', red: 'Severe' };
export const notificationDefaults = { enabled: true, severe: true, elevated: false, watch: true, feeds: true, stories: true, quietStart: '', quietEnd: '' };
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateNotificationSettings(input, previous = notificationDefaults) {
  const next = { ...previous };
  for (const key of ['enabled', 'severe', 'elevated', 'watch', 'feeds', 'stories']) if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw new Error(`${key} must be true or false.`); next[key] = input[key]; }
  for (const key of ['quietStart', 'quietEnd']) if (input[key] !== undefined) { if (input[key] !== '' && !time.test(input[key])) throw new Error('Quiet hours use HH:MM, or leave them blank.'); next[key] = input[key]; }
  return next;
}
export function inQuietHours(settings, date = new Date()) {
  const { quietStart: a, quietEnd: b } = settings; if (!a || !b || a === b) return false;
  const now = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

export function createNotifier(db, send, { now = () => Date.now(), clock = () => new Date() } = {}) {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const settings = () => ({ ...notificationDefaults, ...JSON.parse(db.prepare("SELECT data FROM settings WHERE key='notifications'").get()?.data || '{}') });
  let levels = null, seenAlerts = null, failing = null; const lastTile = new Map();
  let storyCursor=null,storyDue=0;const pendingStories=new Map(),lastStory=new Map();
  function deliver(message) { const s = settings(); if (!s.enabled || inQuietHours(s, clock())) return false; send(message); return true; }
  function flushStories(){
    const s=settings();if(!s.enabled||!s.stories||inQuietHours(s,clock())){pendingStories.clear();storyDue=0;return [];}
    if(!storyDue||now()<storyDue)return [];
    const rows=[...pendingStories.values()];pendingStories.clear();storyDue=0;if(!rows.length)return [];
    const first=rows[0],message=rows.length===1?{title:first.escalation?'Followed story: renewed disruption':first.recovery?'Followed story: source reports recovery':'Followed story updated',body:`${text(first.title).slice(0,120)}\n${text(first.changes[0]?.reason).slice(0,100)}`,path:first.path}:{title:`${rows.length} followed stories updated`,body:rows.slice(0,3).map(a=>text(a.title).slice(0,65)).join('\n'),path:'/developing?alerts=1'};
    if(deliver(message)){for(const row of rows)lastStory.set(row.thread_id,now());return [message];}return [];
  }
  return {
    settings,
    baselineStories(alerts){storyCursor=Math.max(0,...alerts.map(a=>a.id));},
    flushStories,
    update(input) { const next = validateNotificationSettings(input, settings()); db.prepare("INSERT INTO settings VALUES ('notifications', ?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(next)); return next; },
    // One-off notices (such as the startup offline warning) obey the master switch and quiet hours.
    notice(message) { return deliver(message); },
    test() { send({ title: 'Capstone Viewer', body: 'Desktop notifications are working. Severe tiles and new watchlist matches will appear here.', path: '/ops' }); },
    check({ status = [], watch = { alerts: [] }, feedHealth = [], storyAlerts = [] }) {
      const sent = [], s = settings();
      const freshStories=storyCursor===null?[]:storyAlerts.filter(a=>a.id>storyCursor&&!a.read_at);
      storyCursor=Math.max(storyCursor||0,...storyAlerts.map(a=>a.id));
      const active=new Set(storyAlerts.filter(a=>!a.read_at).map(a=>a.id));for(const [id,a] of pendingStories)if(!active.has(a.id))pendingStories.delete(id);
      for(const alert of freshStories){if(!s.enabled||!s.stories||inQuietHours(s,clock()))continue;if(!alert.recovery&&!alert.escalation&&now()-(lastStory.get(alert.thread_id)??-Infinity)<10*60000)continue;
        const old=pendingStories.get(alert.thread_id);pendingStories.set(alert.thread_id,{...alert,recovery:alert.recovery||old?.recovery,escalation:alert.escalation||old?.escalation});if(!storyDue)storyDue=now()+30000;}
      sent.push(...flushStories());
      // A feed notifies once when it crosses into failing; it can notify again only after it recovers.
      const newlyFailing = failing ? feedHealth.filter(p => !failing.has(p.id)) : [];
      failing = new Set(feedHealth.map(p => p.id));
      if (newlyFailing.length && s.feeds) {
        const first = newlyFailing[0], since = new Date(first.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const message = newlyFailing.length === 1
          ? { title: `Feed ${first.kind === 'stalled' ? 'stalled' : 'failing'}: ${text(first.name).slice(0, 80)}`, body: `${first.kind === 'stalled' ? 'Last success' : 'Failing since'} ${since}. ${text(first.detail).slice(0, 140)}`, path: '/ops' }
          : { title: `${newlyFailing.length} feeds failing`, body: newlyFailing.slice(0, 4).map(p => text(p.name).slice(0, 50)).join(', '), path: '/ops' };
        if (deliver(message)) sent.push(message);
      }
      if (levels) for (const t of status) {
        const before = levels[t.id] || 'green';
        if (rank[t.level] <= rank[before]) continue;
        if (!(t.level === 'red' ? s.severe : s.elevated)) continue;
        // One toast per tile per 30 minutes, so a flapping threshold does not spam.
        if (now() - (lastTile.get(t.id) || 0) < 30 * 60000) continue;
        const message = { title: `${t.label}: ${levelNames[t.level]}`, body: text(t.headline).slice(0, 180), path: '/ops' };
        if (deliver(message)) { lastTile.set(t.id, now()); sent.push(message); }
      }
      levels = Object.fromEntries(status.map(t => [t.id, t.level]));
      const fresh = seenAlerts ? watch.alerts.filter(a => !seenAlerts.has(a.id) && !a.backfill && !a.read_at) : [];
      seenAlerts = new Set(watch.alerts.map(a => a.id));
      if (fresh.length && s.watch) {
        const first = fresh[0], message = fresh.length === 1
          ? { title: `Watchlist: ${text(first.rule_name).slice(0, 80)}`, body: text(first.title).slice(0, 180), path: `/ops?event=${encodeURIComponent(first.event_id)}&period=720` }
          : { title: `${fresh.length} new watchlist matches`, body: fresh.slice(0, 3).map(a => `${text(a.rule_name).slice(0, 40)}: ${text(a.title).slice(0, 60)}`).join('\n'), path: '/watch' };
        if (deliver(message)) sent.push(message);
      }
      return sent;
    }
  };
}

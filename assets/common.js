window.Capstone = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('capstone-viewer') : null;
  function sourceTime(report) {
    const at = Date.parse(report.ts);
    if (!Number.isFinite(at)) return 'Time unknown';
    const iso = new Date(at).toISOString();
    const date = iso.slice(0, 10);
    if (report.date_precision === 'day') return date + ' · Day only';
    const time = iso.slice(11, 16) + ' UTC';
    return date === new Date().toISOString().slice(0, 10) ? time : date + ' ' + time;
  }
  function clock() { const el = document.getElementById('zulu'); if (el) el.textContent = new Date().toISOString().slice(11,19) + ' Z'; }
  clock(); setInterval(clock, 1000);
  document.getElementById('fullscreen')?.addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { document.getElementById('fullscreen').textContent = 'Use browser fullscreen'; } });
  const subscribers=new Set(),connections=new Set();let latest=null,connected=false,seenAlerts=null,alertBaseline=null;
  let watchToastOptions = null;
  const setWatchToastOptions = options => { watchToastOptions = options; };
  // Only the map pages (Operations, kiosk) need every story; other pages ask for a light snapshot.
  const livePath = document.body?.dataset.live === 'full' ? '/api/live' : '/api/live?light=1';
  let live, lastMessage = 0;
  function setConnection(ok) {
    if (ok === connected) return;
    connected = ok;
    for (const callback of connections) callback(ok, latest?.now);
  }
  function connectDirect() {
    live = new EventSource(livePath);
    live.onerror = () => setConnection(false);
    live.addEventListener('snapshot', receiveSnapshot);
    live.addEventListener('pulse', receivePulse);
    live.addEventListener('heartbeat', () => { lastMessage = Date.now(); });
    lastMessage = Date.now();
  }
  function connect() {
    if (typeof SharedWorker !== 'function') return connectDirect();
    const full = document.body?.dataset.live === 'full';
    let worker;
    try {
      worker = new SharedWorker('/assets/live-worker.js' + (full ? '' : '?light=1'), {
        name: full ? 'capstone-full' : 'capstone-light'
      });
    } catch {
      return connectDirect();
    }
    let readyTimer;
    const shared = {
      close() {
        clearTimeout(readyTimer);
        worker.port.postMessage('leave');
        worker.port.close();
      }
    };
    live = shared;
    function fallback() {
      if (live !== shared) return;
      shared.close();
      setConnection(false);
      connectDirect();
    }
    readyTimer = setTimeout(fallback, 4000);
    worker.onerror = fallback;
    worker.port.onmessage = ({ data: message }) => {
      if (live !== shared) return;
      if (message.type === 'ready') clearTimeout(readyTimer);
      if (message.type === 'snapshot') receiveSnapshot(message);
      if (message.type === 'pulse') receivePulse(message);
      if (message.type === 'offline') setConnection(false);
    };
  }
  function receiveSnapshot(message) {
    try{
      latest=JSON.parse(message.data);lastMessage=Date.now();setConnection(true);const watch=latest.watch;
      const storyBadge=document.getElementById('story-alert-badge');if(storyBadge){storyBadge.hidden=!latest.storyAlertUnread;storyBadge.textContent=latest.storyAlertUnread>99?'99+':latest.storyAlertUnread||0;}
      if(watch){const badge=document.getElementById('alert-badge');if(badge){badge.textContent=watch.unread>99?'99+':watch.unread;badge.hidden=!watch.unread;}
        if(alertBaseline===null)alertBaseline=Date.parse(latest.now);
      }
      for(const callback of subscribers){try{callback(latest);}catch(error){console.error('Could not update view',error);}}
      if (watch) {
        const fresh = seenAlerts ? watch.alerts.filter(alert=>!seenAlerts.has(alert.id) && !alert.backfill &&
          !alert.read_at && Date.parse(alert.created)>=alertBaseline && (!watchToastOptions || watchToastOptions.accepts(alert))) : [];
        seenAlerts = new Set(watch.alerts.map(alert=>alert.id));
        if (fresh.length) showWatchToast(fresh);
      }
    }catch(error){console.error('Invalid live snapshot',error);}
  }
  function showWatchToast(matches) {
    let toast = document.getElementById('watch-toast');
    if (!toast) {
      toast = document.createElement('aside');
      toast.id = 'watch-toast';
      toast.className = 'watch-toast';
      toast.setAttribute('role','status');
      document.body.append(toast);
    }
    const alert = matches[0];
    const heading = matches.length===1 ? alert.rule_name : matches.length+' watchlist matches';
    toast.innerHTML = `<button type="button" aria-label="Dismiss alert">✕</button><strong>${esc(heading)}</strong>
      <p>${esc(alert.title)}</p>${watchToastOptions?.open ? '<button type="button" data-watch-report>Report details</button> ' : ''}
      <a href="/watch">Open alerts ↗</a>`;
    toast.querySelector('button').onclick = () => toast.remove();
    const open = toast.querySelector('[data-watch-report]');
    if (open) open.onclick = () => watchToastOptions.open(alert);
  }
  const pulseSubscribers=new Set();
  function receivePulse(message) {
    try {
      const pulse=JSON.parse(message.data);
      if(latest)latest.pulse=pulse;
      for(const callback of pulseSubscribers)callback(pulse);
    }catch(error){console.error('Invalid pulse update',error);}
  }
  connect();
  // Reopen a stream that is technically open but has stopped delivering heartbeats.
  setInterval(() => {
    if (!live || typeof live.readyState !== 'number') return;
    const closed = live.readyState === EventSource.CLOSED;
    const silent = live.readyState === EventSource.OPEN && Date.now() - lastMessage >= 65_000;
    if (!closed && !silent) return;
    live.close();
    setConnection(false);
    connect();
  }, 10_000);
  window.addEventListener('pagehide',()=>{live?.close();live=null;setConnection(false);});
  window.addEventListener('pageshow',()=>{if(!live)connect();});
  const subscribe=callback=>{subscribers.add(callback);if(latest)callback(latest);return()=>subscribers.delete(callback);};
  const onPulse=callback=>{pulseSubscribers.add(callback);return()=>pulseSubscribers.delete(callback);};
  const onConnection=callback=>{connections.add(callback);callback(connected,latest?.now);return()=>connections.delete(callback);};
  const api=async(path,method='GET',body)=>{const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'The app could not save this change.'),{status:response.status});return result;};
  const dismissCollectionGap = gap => api('/api/offline/dismiss?to='+encodeURIComponent(gap.to),'POST',{});
  function collectionGapNotice(host,gap,onReview,onDismiss) {
    host.hidden = !gap;
    if (!gap) { delete host.dataset.gap; return; }
    const key = [gap.from,gap.to,gap.title].join('|');
    if (host.dataset.gap===key) return;
    host.dataset.gap = key;
    host.innerHTML = `<div><strong>${esc(gap.title)}</strong><p>${esc(gap.body)}</p><small>${esc(gap.cause || '')}</small></div>
      <div class="collection-gap-actions"><button type="button" data-gap-review>Show first receipts</button>
      <button type="button" data-gap-dismiss>Dismiss</button></div><small data-gap-status role="status"></small>`;
    host.querySelector('[data-gap-review]').onclick = onReview;
    const dismiss = host.querySelector('[data-gap-dismiss]');
    dismiss.onclick = async () => {
      dismiss.disabled = true;
      try {
        await dismissCollectionGap(gap);
        if (host.dataset.gap===key) {
          host.hidden = true;
          onDismiss?.();
        }
      } catch (error) { if (host.dataset.gap===key) host.querySelector('[data-gap-status]').textContent = error.message; }
      finally { dismiss.disabled = false; }
    };
  }
  // Night side of the planet from the sun's position (low-precision almanac, good to a fraction of a degree).
  function nightGeo(date=new Date()){
    const d=date/86400000-10957.5,rad=Math.PI/180,g=(357.529+0.98560028*d)*rad,L=(280.459+0.98564736*d+1.915*Math.sin(g)+0.020*Math.sin(2*g))*rad,ob=(23.439-0.00000036*d)*rad;
    const ra=Math.atan2(Math.cos(ob)*Math.sin(L),Math.cos(L))/rad,dec=Math.asin(Math.sin(ob)*Math.sin(L)),tilt=Math.abs(dec)<1e-4?1e-4:dec;
    const sunLon=((ra-((18.697374558+24.06570982441908*d)%24)*15)%360+540)%360-180,line=[];
    for(let lon=-180;lon<=180;lon+=2)line.push([lon,Math.atan(-Math.cos((lon-sunLon)*rad)/Math.tan(tilt))/rad]);
    const pole=tilt>0?-90:90;
    return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[...line,[180,pole],[-180,pole],line[0]]]}};
  }
  const collectorGroups = Object.freeze({weather:'Weather',hazards:'Earth hazards & response',transport:'Transportation',geo:'World reporting',
    cyber:'Cybersecurity',internet:'Internet & routing',ai:'AI & robotics',trackers:'Topic trackers',social:'Tracked feeds'});
  function collectorGroup(feed) {
    if (feed.platform) return 'social';
    if (feed.tracker) return 'trackers';
    return [feed.group,feed.desk].find(key=>Object.hasOwn(collectorGroups,key)) || 'cyber';
  }
  return { esc, read, save, collectorGroups, collectorGroup, sourceTime, channel, setWatchToastOptions, subscribe, onConnection, onPulse, api, collectionGapNotice, dismissCollectionGap, nightGeo, onTheme: window.CapstoneTheme.onChange };
})();
window.CapstoneReading = (() => {
  const fold = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
  let sources = new Set(), subjects = [];
  Capstone.subscribe(data => {
    if (!data.reading) return;
    sources = new Set(data.reading.sources.map(source=>source.key));
    subjects = data.reading.subjects.map(fold);
  });
  return {
    muted(report) {
      if (sources.has(report.source_key || report.source_id || report.source || 'Unknown source')) return true;
      if (!subjects.length) return false;
      const text = fold([report.title,report.summary,...(report.display_tags || report.tags || []).map(tag=>tag.label)].join(' '));
      return subjects.some(subject=>text.includes(subject));
    }
  };
})();

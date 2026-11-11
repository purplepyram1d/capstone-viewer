window.Capstone = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('capstone-viewer') : null;
  function clock() { const el = document.getElementById('zulu'); if (el) el.textContent = new Date().toISOString().slice(11,19) + ' Z'; }
  clock(); setInterval(clock, 1000);
  document.getElementById('fullscreen')?.addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { document.getElementById('fullscreen').textContent = 'Use browser fullscreen'; } });
  const subscribers=new Set(),connections=new Set();let latest=null,connected=false,seenAlerts=null,alertBaseline=null;
  // Only the map pages (Operations, kiosk) need every story; other pages ask for a light snapshot.
  const live=new EventSource(document.body?.dataset.live==='full'?'/api/live':'/api/live?light=1');
  live.onopen=()=>{connected=true;for(const callback of connections)callback(true);};live.onerror=()=>{connected=false;for(const callback of connections)callback(false);};
  live.addEventListener('snapshot',message=>{
    try{
      latest=JSON.parse(message.data);const watch=latest.watch;
      const storyBadge=document.getElementById('story-alert-badge');if(storyBadge){storyBadge.hidden=!latest.storyAlertUnread;storyBadge.textContent=latest.storyAlertUnread>99?'99+':latest.storyAlertUnread||0;}
      if(watch){const badge=document.getElementById('alert-badge');if(badge){badge.textContent=watch.unread>99?'99+':watch.unread;badge.hidden=!watch.unread;}
        if(alertBaseline===null)alertBaseline=Date.parse(latest.now);
        const fresh=seenAlerts?watch.alerts.filter(alert=>!seenAlerts.has(alert.id)&&!alert.backfill&&!alert.read_at&&Date.parse(alert.created)>=alertBaseline):[];
        seenAlerts=new Set(watch.alerts.map(a=>a.id));
        if(fresh.length){let toast=document.getElementById('watch-toast');if(!toast){toast=document.createElement('aside');toast.id='watch-toast';toast.className='watch-toast';toast.setAttribute('role','status');document.body.append(toast);}toast.innerHTML=`<button type="button" aria-label="Dismiss alert">✕</button><strong>${fresh.length===1?esc(fresh[0].rule_name):fresh.length+' watchlist matches'}</strong><p>${esc(fresh[0].title)}</p><a href="/watch">Open alerts ↗</a>`;toast.querySelector('button').onclick=()=>toast.remove();}
      }
      for(const callback of subscribers){try{callback(latest);}catch(error){console.error('Could not update view',error);}}
    }catch(error){console.error('Invalid live snapshot',error);}
  });
  const pulseSubscribers=new Set();
  live.addEventListener('pulse',message=>{try{const pulse=JSON.parse(message.data);if(latest)latest.pulse=pulse;for(const callback of pulseSubscribers)callback(pulse);}catch(error){console.error('Invalid pulse update',error);}});
  window.addEventListener('pagehide',()=>live.close());
  const subscribe=callback=>{subscribers.add(callback);if(latest)callback(latest);return()=>subscribers.delete(callback);};
  const onPulse=callback=>{pulseSubscribers.add(callback);return()=>pulseSubscribers.delete(callback);};
  const onConnection=callback=>{connections.add(callback);callback(connected);return()=>connections.delete(callback);};
  const api=async(path,method='GET',body)=>{const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||'The app could not save this change.');return result;};
  // Night side of the planet from the sun's position (low-precision almanac, good to a fraction of a degree).
  function nightGeo(date=new Date()){
    const d=date/86400000-10957.5,rad=Math.PI/180,g=(357.529+0.98560028*d)*rad,L=(280.459+0.98564736*d+1.915*Math.sin(g)+0.020*Math.sin(2*g))*rad,ob=(23.439-0.00000036*d)*rad;
    const ra=Math.atan2(Math.cos(ob)*Math.sin(L),Math.cos(L))/rad,dec=Math.asin(Math.sin(ob)*Math.sin(L)),tilt=Math.abs(dec)<1e-4?1e-4:dec;
    const sunLon=((ra-((18.697374558+24.06570982441908*d)%24)*15)%360+540)%360-180,line=[];
    for(let lon=-180;lon<=180;lon+=2)line.push([lon,Math.atan(-Math.cos((lon-sunLon)*rad)/Math.tan(tilt))/rad]);
    const pole=tilt>0?-90:90;
    return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[...line,[180,pole],[-180,pole],line[0]]]}};
  }
  // Themes: Capstone Night plus Corpus Magnus's five. The button cycles them like the Corpus reader's: its icon
  // hints at the next theme and its tooltip names the current one. Saved per device; every open window follows.
  const THEMES=[['dark','Capstone Night','☼'],['parchment','Parchment','☾'],['candle','Candlelight','✿'],['rosepine','Rosé Pine','☀'],['rosedawn','Rosé Pine Dawn','✦'],['rosegold','Rose Gold','◭']];
  const themeListeners=new Set();let themeButton=null;
  const currentTheme=()=>THEMES.some(t=>t[0]===document.documentElement.dataset.theme)?document.documentElement.dataset.theme:'dark';
  function applyTheme(name,persist){
    const i=Math.max(0,THEMES.findIndex(t=>t[0]===name)),theme=THEMES[i],next=THEMES[(i+1)%THEMES.length];
    document.documentElement.dataset.theme=theme[0];if(persist)save('capstone-theme',theme[0]);
    if(themeButton){themeButton.textContent=theme[2];themeButton.title=`Theme: ${theme[1]} (click for ${next[1]})`;themeButton.setAttribute('aria-label',themeButton.title);}
    // Maps read colors when they draw, so they repaint after the new tokens apply.
    requestAnimationFrame(()=>{for(const callback of themeListeners){try{callback(theme[0]);}catch(error){console.error('Could not apply theme',error);}}});
  }
  const fullscreenButton=document.getElementById('fullscreen');
  if(fullscreenButton){themeButton=document.createElement('button');themeButton.type='button';themeButton.className='theme-button';fullscreenButton.before(themeButton);themeButton.onclick=()=>{const i=THEMES.findIndex(t=>t[0]===currentTheme());applyTheme(THEMES[(i+1)%THEMES.length][0],true);};}
  applyTheme(currentTheme(),false);
  window.addEventListener('storage',event=>{if(event.key==='capstone-theme')applyTheme(read('capstone-theme','dark'),false);});
  const onTheme=callback=>{themeListeners.add(callback);return()=>themeListeners.delete(callback);};
  return { esc, read, save, channel, subscribe, onConnection, onPulse, api, nightGeo, onTheme, themes: THEMES };
})();
window.CapstoneReading=(()=>{let state={sources:[],subjects:[]};Capstone.subscribe(data=>{if(data.reading)state=data.reading;});const fold=v=>String(v||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();return {muted(r){return state.sources.some(s=>s.key===(r.source_key||r.source_id||r.source||'Unknown source'))||state.subjects.some(s=>fold([r.title,r.summary,...(r.display_tags||r.tags||[]).map(t=>t.label)].join(' ')).includes(fold(s)));}};})();

globalThis.CapstoneMapOutlook = (() => {
  const stamp = value => new Intl.DateTimeFormat('en-GB', {
    day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'
  }).format(new Date(value))+' UTC';

  function attach(select, caption, changed) {
    const title = caption.querySelector('strong');
    const dates = caption.querySelector('span');
    const source = caption.querySelector('a');
    const showTitle = value => { if (title.textContent!==value) title.textContent = value; };
    let mode = '', outlook = null, failure = false, controller, timer;
    const usable = () => outlook && (!outlook.ends || Date.parse(outlook.ends)>Date.now()) ? outlook : null;

    async function load() {
      const requested = mode;
      if (!requested) return;
      const signal = new AbortController();
      controller = signal;
      try {
        const result = await fetch('/api/weather/outlook?day='+requested,{
          signal:AbortSignal.any([signal.signal,AbortSignal.timeout(22_000)])
        });
        if (!result.ok) throw new Error('Could not load the NOAA outlook');
        const data = await result.json();
        if (controller!==signal) return;
        outlook = data;
        failure = Boolean(data.error);
      } catch {
        if (controller!==signal) return;
        failure = true;
      }
      if (controller===signal) {
        clearTimeout(timer);
        timer = setTimeout(load,(failure || outlook?.stale ? 2 : 15)*60_000);
        changed();
      }
    }

    function view(replay) {
      const requested = replay ? '' : select.value;
      if (requested!==mode) {
        mode = requested;
        clearTimeout(timer);
        controller?.abort();
        controller = null;
        outlook = null;
        failure = false;
        if (mode) void load();
      }
      caption.hidden = !mode;
      if (!mode) return null;
      const data = usable();
      if (!data || failure && !data.issued) {
        showTitle(failure ? 'NOAA outlook unavailable' : outlook ? 'Waiting for a valid outlook' : 'Checking NOAA outlook…');
      } else if (data.disabled) {
        showTitle('NOAA outlook paused');
      } else if (!data.issued) {
        showTitle('No outlook date published');
      } else {
        const risks = data.risks.map(risk=>risk.name).join(', ');
        showTitle('Day '+mode+' forecast · '+(risks || 'No severe-risk areas')+(data.stale || failure ? ' · Last retrieved' : ''));
      }
      dates.textContent = data?.issued ? 'Issued '+stamp(data.issued)+' · Valid '+stamp(data.starts)+' to '+stamp(data.ends) : '';
      source.hidden = !data?.source || data.disabled;
      if (!source.hidden) source.href = data.source;
      return data?.areas?.features?.length ? data : null;
    }

    window.addEventListener('pagehide',()=>{clearTimeout(timer);controller?.abort();controller=null;mode='';});
    window.addEventListener('pageshow',event=>{if(event.persisted)changed();});
    return {view};
  }
  return {attach};
})();

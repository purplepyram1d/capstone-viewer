(() => {
 const nav=document.querySelector('nav[aria-label="Main navigation"]');if(!nav)return;
 const current=document.body.classList.contains('sources-page')?'/sources':location.pathname.replace(/\/$/,'')||'/ops';
 const groups=[['Monitor',[['/ops','Operations'],['/timeline','Full timeline'],['/developing','Developing stories'],['/watch','Watchlists & alerts'],['/kiosk','Kiosk wall']]],['Live wall',[['/wall','Live wall']]],['Trackers',[['/musk','Elon tracker'],['/putin','Putin tracker']]],['Sources',[['/feeds','Feeds & connections'],['/sources','Source directory']]]];
 nav.classList.add('app-nav');
 const link=([url,label])=>`<a href="${url}"${current===url?' aria-current="page"':''}${url==='/watch'?' id="watch-nav"':''}>${label}${url==='/watch'?' <span id="alert-badge" hidden></span>':url==='/developing'?' <span id="story-alert-badge" hidden></span>':''}</a>`;
 nav.innerHTML=groups.map(([label,items])=>items.length===1?`<div class="nav-direct${items.some(([u])=>u===current)?' nav-active':''}">${link([items[0][0],label])}</div>`:`<details class="nav-group${items.some(([u])=>u===current)?' nav-active':''}"><summary>${label}<span aria-hidden="true">⌄</span></summary><div class="nav-menu">${items.map(link).join('')}</div></details>`).join('');
 const main = document.querySelector('main');
 if(main){
  if(!main.id)main.id='main-content';
  main.tabIndex=-1;
  const skip=document.createElement('a');skip.className='skip-content';skip.href='#'+main.id;skip.textContent='Skip to content';
  document.body.prepend(skip);
 }
 const details=[...nav.querySelectorAll('details')];
 for(const d of details)d.addEventListener('toggle',()=>{if(d.open)for(const other of details)if(other!==d)other.open=false;});
 document.addEventListener('click',e=>{if(!nav.contains(e.target))for(const d of details)d.open=false;});
 nav.addEventListener('keydown',e=>{if(e.key==='Escape'){const d=e.target.closest('details');if(d){d.open=false;d.querySelector('summary').focus();}}});

 const controls = document.querySelector('.top-actions');
 if (controls) {
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'jump-button';
  jump.setAttribute('aria-haspopup', 'dialog');
  jump.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  jump.textContent = 'Open view';
  jump.title = 'Open view (Ctrl+K)';
  controls.prepend(jump);
  const dialog = document.createElement('dialog');
  dialog.className = 'jump-dialog';
  dialog.setAttribute('aria-labelledby', 'jump-title');
  dialog.innerHTML = '<div class="dialog-heading"><h2 id="jump-title">Open view</h2><button type="button" aria-label="Close view picker">✕</button></div><form><label for="jump-search">View name or report search</label><input id="jump-search" type="search" autocomplete="off" placeholder="Timeline, feeds, CVE…"><div class="jump-results" aria-label="Matching views"></div></form>';
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  const results = dialog.querySelector('.jump-results');
  const routes = groups.flatMap(([,items]) => items).concat([
    ['/ops#ops-situation', 'Network diagnostics'],
    ['/ops#feed-health-panel', 'Collector health'],
    ['/feeds?status=attention', 'Sources needing attention'],
    ['/feeds#feed-connections', 'API connections'],
    ['/feeds#local-backups', 'Local backups'],
    ['/timeline?review=needs-review', 'Reports needing re-review'],
    ['/timeline?scope=saved', 'Saved reports'],
    ['/developing?alerts=1', 'Followed-story alerts']
  ]);
  function renderLinks() {
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    for (const [url,label] of routes) {
      if (query && !label.toLowerCase().includes(query)) continue;
      const a = document.createElement('a');
      a.href = url;
      a.textContent = label;
      a.onclick = () => dialog.close();
      results.append(a);
    }
    if (query) {
      const a = document.createElement('a');
      a.href = '/timeline?q=' + encodeURIComponent(input.value.trim());
      a.textContent = 'Search timeline for “' + input.value.trim() + '”';
      results.append(a);
    }
  }
  function openJump() {
    if (document.querySelector('dialog[open]')) return;
    input.value = '';
    renderLinks();
    dialog.showModal();
    input.focus();
  }
  jump.onclick = openJump;
  dialog.querySelector('button').onclick = () => dialog.close();
  input.oninput = renderLinks;
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    results.querySelector('a')?.click();
  };
  dialog.addEventListener('keydown', event => {
    if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
    const links = [...results.querySelectorAll('a')];
    if (!links.length) return;
    event.preventDefault();
    const selected = links.indexOf(document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const index = selected < 0 ? (step === 1 ? 0 : links.length - 1) : (selected + step + links.length) % links.length;
    links[index].focus();
  });
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    openJump();
  });
 }

})();

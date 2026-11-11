(() => {
 const nav=document.querySelector('nav[aria-label="Main navigation"]');if(!nav)return;
 const current=location.pathname.replace(/\/$/,'')||'/ops';
 const groups=[['Monitor',[['/ops','Operations'],['/developing','Developing stories'],['/timeline','Full timeline'],['/kiosk','Kiosk wall']]],['Streams',[['/wall','Live wall']]],['Trackers',[['/musk','Elon tracker'],['/putin','Putin tracker'],['/watch','Watchlists & alerts']]],['Settings',[['/feeds','Feeds & connections'],['/sources','Source directory']]]];
 nav.classList.add('app-nav');
 const link=([url,label])=>`<a href="${url}"${current===url?' aria-current="page"':''}${url==='/watch'?' id="watch-nav"':''}>${label}${url==='/watch'?' <span id="alert-badge" hidden></span>':url==='/developing'?' <span id="story-alert-badge" hidden></span>':''}</a>`;
 nav.innerHTML=groups.map(([label,items])=>items.length===1?`<div class="nav-direct${items.some(([u])=>u===current)?' nav-active':''}">${link([items[0][0],label])}</div>`:`<details class="nav-group${items.some(([u])=>u===current)?' nav-active':''}"><summary>${label}<span aria-hidden="true">⌄</span></summary><div class="nav-menu">${items.map(link).join('')}</div></details>`).join('');
 const details=[...nav.querySelectorAll('details')];
 for(const d of details)d.addEventListener('toggle',()=>{if(d.open)for(const other of details)if(other!==d)other.open=false;});
 document.addEventListener('click',e=>{if(!nav.contains(e.target))for(const d of details)d.open=false;});
 nav.addEventListener('keydown',e=>{if(e.key==='Escape'){const d=e.target.closest('details');if(d){d.open=false;d.querySelector('summary').focus();}}});
})();

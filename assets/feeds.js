(() => {
  const {esc}=Capstone,$=id=>document.getElementById(id);
  const desks={cyber:'Cyber',geo:'World',ai:'AI & robotics'};
  const states={ok:'Collecting',paused:'Paused','needs-key':'Needs X connection',collecting:'Polling…',waiting:'Waiting',error:'Needs attention'};
  let feeds=[],editing=null;
  async function api(path,method='GET',body){const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not update your feeds.');return result;}
  function time(ts){return ts?new Date(ts).toLocaleString('en-GB',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+'Z':'Not yet';}
  function renderList(){
    $('social-count').textContent=feeds.length;
    $('social-feeds').innerHTML=feeds.length?feeds.map(feed=>`<article class="managed-feed" data-feed="${esc(feed.id)}"><div class="managed-feed-top"><div><span class="feed-platform-badge">${feed.platform==='x'?(feed.kind==='list'?'X LIST':'X'):esc(feed.platform.toUpperCase())}${feed.claims?' · CLAIMS':''}</span><h3>${esc(feed.name)}</h3><a href="${esc(feed.url)}" target="_blank" rel="noopener noreferrer">${esc(feed.platform==='x'&&feed.kind==='list'?'List '+feed.target:'@'+feed.target)} ↗</a></div><span class="feed-state ${esc(feed.state)}">${states[feed.state]||esc(feed.state)}</span></div><p class="subtle feed-settings">${desks[feed.category]} · every ${feed.intervalMinutes} min${feed.platform==='x'?` · up to ${feed.maxPosts} posts/poll`:''}</p><p class="subtle">Last success: ${esc(time(feed.lastSuccess))}${feed.count!==undefined?` · ${feed.count} posts collected on last poll`:''}</p>${feed.error&&feed.enabled?`<p class="feed-error">${esc(feed.error)}</p>`:''}${feed.note?`<p class="feed-error">${esc(feed.note)}</p>`:''}<div class="managed-feed-actions"><button data-action="toggle">${feed.enabled?'Pause':'Enable'}</button><button data-action="poll" ${!feed.enabled||feed.state==='collecting'||feed.state==='needs-key'||(feed.nextPoll&&Date.parse(feed.nextPoll)>Date.now())?'disabled':''}>Poll now</button><button data-action="edit">Edit</button><button data-action="remove">Remove</button><small>${feed.enabled&&feed.nextPoll?'Next poll: '+esc(time(feed.nextPoll)):''}</small></div></article>`).join(''):'<div class="empty-state">No social feeds yet.<br>Add a public Telegram channel, Bluesky or Mastodon account, or an X account to build your watchlist.</div>';
    document.querySelectorAll('.managed-feed').forEach(row=>{const link=document.createElement('a');link.href='/ops?source='+encodeURIComponent(row.dataset.feed)+'&period=168';link.textContent='View posts';row.querySelector('.managed-feed-actions').prepend(link);});
  }
  function renderConnection(connection){
    $('x-state').textContent=connection.configured?'Token saved':'Not connected';
    $('credential-storage').textContent={ 'encrypted-desktop':'Your token is encrypted on this Windows account. It is never displayed after saving.', 'session-memory':'Browser/server mode keeps the token in memory only. Reconnect after a server restart, or set X_BEARER_TOKEN on the server.', environment:'X access is configured by the server environment. Manage that token on the server.' }[connection.storage];
    $('x-token').disabled=connection.storage==='environment';$('save-token').disabled=connection.storage==='environment';$('disconnect-x').disabled=!connection.configured||connection.storage==='environment';
    if(connection.error)$('x-message').textContent=connection.error;
  }
  async function load(){try{const data=await api('/api/social/feeds');feeds=data.feeds;renderList();renderConnection(data.connection);}catch(error){$('feed-form-status').textContent=error.message;}}
  const platformHelp={
    telegram:['https://t.me/channelname or @channelname','Reads text from the channel’s public web preview. No login needed. Private or restricted channels are not supported.'],
    x:['@account or https://x.com/i/lists/123…','Public accounts and Lists use the X API connection below. Enabling polling can incur API charges. Lists re-read their latest capped window on each poll.'],
    bluesky:['@name.bsky.social or https://bsky.app/profile/…','Reads the account’s own public posts (no reposts or replies) through Bluesky’s public API. Free, no login.'],
    mastodon:['@name@infosec.exchange or https://server/@name','Reads the account’s own public posts through its server’s public API. Free, no login. Some accounts hide posts from logged-out readers.']};
  function platformDefaults(reset=true){const platform=$('feed-platform').value,isX=platform==='x';$('feed-input').placeholder=platformHelp[platform][0];$('platform-help').textContent=platformHelp[platform][1];$('feed-interval').min=isX?'15':'2';$('x-post-cap').hidden=!isX;$('feed-enabled-label').textContent=isX?'Enable X polling (API charges may apply)':'Start collecting this channel';if(reset){$('feed-interval').value=isX?'15':'5';$('feed-enabled').checked=!isX;}}
  function resetForm(){editing=null;$('feed-form').reset();$('feed-platform').disabled=false;$('feed-input').disabled=false;$('cancel-edit').hidden=true;$('feed-form-title').textContent='Add a feed';$('save-feed').textContent='Add feed';platformDefaults();}
  $('feed-platform').onchange=()=>platformDefaults();$('cancel-edit').onclick=()=>{resetForm();$('feed-form-status').textContent='';};
  $('feed-form').onsubmit=async event=>{
    event.preventDefault();const button=$('save-feed');button.disabled=true;
    const body={platform:$('feed-platform').value,input:$('feed-input').value.trim(),category:$('feed-category').value,intervalMinutes:Number($('feed-interval').value),maxPosts:Number($('feed-max-posts').value),enabled:$('feed-enabled').checked,claims:$('feed-claims').checked};if($('feed-name').value.trim())body.name=$('feed-name').value.trim();
    try{await api('/api/social/feeds'+(editing?'/'+editing:''),editing?'PATCH':'POST',body);$('feed-form-status').textContent=editing?'Feed updated.':body.enabled?'Feed added. Collection will begin shortly.':'Feed added and paused.';resetForm();await load();}catch(error){$('feed-form-status').textContent=error.message;}finally{button.disabled=false;}
  };
  $('social-feeds').onclick=async event=>{
    const button=event.target.closest('[data-action]'),row=button?.closest('[data-feed]');if(!row)return;const feed=feeds.find(f=>f.id===row.dataset.feed);if(!feed)return;
    if(button.dataset.action==='edit'){editing=feed.id;$('feed-platform').value=feed.platform;platformDefaults(false);$('feed-platform').disabled=true;$('feed-input').value=feed.url;$('feed-input').disabled=true;$('feed-name').value=feed.name;$('feed-category').value=feed.category;$('feed-interval').value=feed.intervalMinutes;$('feed-max-posts').value=feed.maxPosts;$('feed-enabled').checked=feed.enabled;$('feed-claims').checked=!!feed.claims;$('cancel-edit').hidden=false;$('feed-form-title').textContent='Edit feed';$('save-feed').textContent='Save changes';$('feed-form-status').textContent='';$('feed-form-title').scrollIntoView({block:'nearest'});return;}
    button.disabled=true;
    try{const path='/api/social/feeds/'+feed.id;if(button.dataset.action==='toggle')await api(path,'PATCH',{enabled:!feed.enabled});if(button.dataset.action==='poll')await api(path+'/refresh','POST');if(button.dataset.action==='remove'){await api(path,'DELETE');if(editing===feed.id)resetForm();}$('feed-form-status').textContent=button.dataset.action==='remove'?'Feed removed. Already collected posts remain in the timeline.':'Feed updated.';await load();}catch(error){$('feed-form-status').textContent=error.message;button.disabled=false;}
  };
  $('x-form').onsubmit=async event=>{event.preventDefault();$('save-token').disabled=true;try{const result=await api('/api/social/credentials','PUT',{bearerToken:$('x-token').value.trim()});$('x-token').value='';renderConnection(result);$('x-message').textContent='Connection saved. Enable your X feeds when you are ready to poll.';await load();}catch(error){$('x-message').textContent=error.message;}finally{$('save-token').disabled=false;}};
  $('disconnect-x').onclick=async()=>{try{renderConnection(await api('/api/social/credentials','DELETE'));$('x-token').value='';$('x-message').textContent='X connection removed. X feeds will wait for a new token.';await load();}catch(error){$('x-message').textContent=error.message;}};
  // Keyed providers (Cloudflare Radar, abuse.ch) share one panel pattern: #<id>-form, -token, -state, -storage, -message, save-<id>, disconnect-<id>.
  function provider(id,label,envVar){
    const path=`/api/providers/${id}/credentials`;
    function render(connection){
      $(id+'-state').textContent=connection.configured?'Token saved':'Not connected';
      $(id+'-storage').textContent={ 'encrypted-desktop':'Your token is encrypted on this Windows account. It is never displayed after saving.', 'session-memory':`Browser/server mode keeps the token in memory only. Reconnect after a server restart, or set ${envVar} on the server.`, environment:`${label} access is configured by the server environment. Manage that token on the server.` }[connection.storage];
      $(id+'-token').disabled=connection.storage==='environment';$('save-'+id).disabled=connection.storage==='environment';$('disconnect-'+id).disabled=!connection.configured||connection.storage==='environment';
      if(connection.error)$(id+'-message').textContent=connection.error;
    }
    $(id+'-form').onsubmit=async event=>{event.preventDefault();$('save-'+id).disabled=true;try{render(await api(path,'PUT',{token:$(id+'-token').value.trim()}));$(id+'-token').value='';$(id+'-message').textContent=`Connection saved. ${label} collection starts now; check Collector health on Operations.`;}catch(error){$(id+'-message').textContent=error.message;}finally{$('save-'+id).disabled=false;}};
    $('disconnect-'+id).onclick=async()=>{try{render(await api(path,'DELETE'));$(id+'-message').textContent=`${label} connection removed. Collected reports stay in the timeline.`;}catch(error){$(id+'-message').textContent=error.message;}};
    api(path).then(render).catch(error=>{$(id+'-message').textContent=error.message;});
  }
  provider('radar','Cloudflare Radar','CLOUDFLARE_RADAR_TOKEN');provider('abusech','abuse.ch','ABUSECH_AUTH_KEY');
  $('reload-feeds').onclick=load;
  Capstone.subscribe(data=>{feeds=data.feeds.filter(f=>f.platform);renderList();});
  setInterval(renderList,30000);platformDefaults();void load();
})();

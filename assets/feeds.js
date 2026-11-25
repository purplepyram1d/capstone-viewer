(() => {
  const {esc,sourceTime,collectorGroups:groups,collectorGroup}=Capstone,$=id=>document.getElementById(id);
  const desks={cyber:'Cyber',geo:'World',ai:'AI & robotics'};
  const groupPicker = $('feed-group');
  for (const [key,label] of Object.entries(groups)) groupPicker.add(new Option(label,key));
  const states = { ok: 'Last poll succeeded', paused: 'Paused', 'needs-key': 'Needs connection',
    collecting: 'Polling…', waiting: 'Awaiting first poll', error: 'Last poll failed', stalled: 'Overdue' };
  const priority = { error: 0, stalled: 1, 'needs-key': 2 };
  const utc = new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const changing = new Set(), expanded = new Map(), filteredExpanded = new Map();
  let feeds = [], builtin = [], editing = null, collectionEnabled = true, problems = new Map();
  let loadedTracked = false, loadedInventory = false, inventoryMarkup = '', listMarkup = '';
  async function api(path,method='GET',body){const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not update your feeds.');return result;}
  function time(timestamp) {
    const date = new Date(timestamp || '');
    return Number.isNaN(date.getTime()) ? 'Not yet' : utc.format(date) + ' UTC';
  }

  function sourceOutput(feed) {
    if (feed.newestReport===undefined) return '';
    if (feed.newestReport===null) return 'No matching reports in the last successful poll';
    return 'Newest source date in collected reports · '+sourceTime(feed.newestReport);
  }

  function stateOf(feed) {
    if (feed.state === 'needs-key') return 'needs-key';
    if (!collectionEnabled || feed.enabled === false) return 'paused';
    if (problems.get(feed.id)?.kind === 'stalled') return 'stalled';
    return feed.state || 'waiting';
  }

  function matches(feed) {
    const group = collectorGroup(feed);
    if (groupPicker.value && groupPicker.value!==group) return false;
    const terms = [feed.name,feed.platform,feed.target,groups[group],desks[feed.category],feed.tracker,
      feed.profile?.evidence,feed.profile?.description].join(' ').toLowerCase();
    if (!terms.includes($('feed-search').value.trim().toLowerCase())) return false;
    const mode = $('feed-visibility').value;
    const state = stateOf(feed);
    if (mode === 'attention') return ['error', 'stalled', 'needs-key'].includes(state);
    if (mode === 'ready') return state === 'ok' || state === 'collecting';
    return mode === 'all' || mode === state;
  }

  function pollable(feed) {
    return collectionEnabled && feed.enabled && feed.state !== 'collecting' && feed.state !== 'needs-key' &&
      !(Date.parse(feed.nextPoll) > Date.now()) && !changing.has(feed.id);
  }

  function renderList() {
    if (!loadedTracked) return;
    const visible = feeds.filter(matches).sort((a, b) => (priority[stateOf(a)] ?? 3) - (priority[stateOf(b)] ?? 3) || a.name.localeCompare(b.name));
    const markup = visible.map(feed => {
      const state = stateOf(feed);
      const status = states[state] || state;
      const pending = changing.has(feed.id) ? 'disabled' : '';
      const target = feed.platform === 'x' && feed.kind === 'list' ? 'List ' + feed.target : '@' + feed.target;
      const platform = feed.platform === 'x' && feed.kind === 'list' ? 'X LIST' : feed.platform.toUpperCase();
      const last = feed.lastSuccess ? 'Last success ' + time(feed.lastSuccess) : 'No successful poll yet';
      const output = sourceOutput(feed);
      const detail = state === 'stalled' ? problems.get(feed.id)?.detail : ['error', 'needs-key'].includes(state) ? feed.error : '';
      const evidence = `/ops?source=${encodeURIComponent(feed.id)}&amp;period=168`;
      return `<article class="managed-feed" data-feed="${esc(feed.id)}">
        <div class="managed-feed-top">
          <div><span class="feed-platform-badge">${esc(platform)}${feed.claims ? ' · CLAIMS' : ''}</span><h3>${esc(feed.name)}</h3>
            <a href="${esc(feed.url)}" target="_blank" rel="noopener noreferrer">${esc(target)} ↗</a>
          </div><span class="feed-state ${esc(state)}">${esc(status)}</span>
        </div>
        <p class="subtle feed-settings">${esc(desks[feed.category] || feed.category)} · Every ${esc(feed.intervalMinutes)} min${feed.platform === 'x' ? ` · Up to ${esc(feed.maxPosts)} posts per poll` : ''}</p>
        <p class="subtle">${esc(last)}${feed.lastSuccess && feed.count !== undefined ? ` · ${esc(feed.count)} posts collected on last poll` : ''}</p>
        ${output ? `<p class="subtle feed-latest-source">${esc(output)}</p>` : ''}
        ${detail ? `<p class="feed-error">${esc(detail)}</p>` : ''}${feed.note ? `<p class="feed-error">${esc(feed.note)}</p>` : ''}
        <div class="managed-feed-actions">
          <a href="${evidence}">View posts</a>
          <button data-action="toggle" ${pending}>${feed.enabled ? 'Pause' : 'Enable'}</button>
          <button data-action="poll" ${pollable(feed) ? '' : 'disabled'}>Poll now</button>
          <button data-action="edit" ${pending}>Edit</button><button data-action="remove" ${pending}>Remove</button><button type="button" data-poll-history="${esc(feed.id)}" aria-label="Poll history for ${esc(feed.name)}">History</button>
          <small>${collectionEnabled && feed.enabled && feed.nextPoll ? 'Next poll ' + esc(time(feed.nextPoll)) : ''}</small>
        </div>
      </article>`;
    }).join('') || (feeds.length ? '<div class="empty-state">No tracked feeds match these filters.</div>' :
      '<div class="empty-state">Add a public Telegram channel, Bluesky or Mastodon account, or an X account.</div>');
    const panel = $('social-feeds');
    if (panel.contains(document.activeElement)) return;
    $('social-count').textContent = visible.length;
    if (listMarkup === markup) return;
    listMarkup = markup;
    panel.innerHTML = markup;
  }


  function renderConnection(connection){
    $('x-state').textContent=connection.configured?'Token saved':'Not connected';
    $('credential-storage').textContent={ 'encrypted-desktop':'Your token is encrypted on this Windows account. It is never displayed after saving.', 'session-memory':'Browser/server mode keeps the token in memory only. Reconnect after a server restart, or set X_BEARER_TOKEN on the server.', environment:'X access is configured by the server environment. Manage that token on the server.' }[connection.storage];
    $('x-token').disabled=connection.storage==='environment';$('save-token').disabled=connection.storage==='environment';$('disconnect-x').disabled=!connection.configured||connection.storage==='environment';
    if(connection.error)$('x-message').textContent=connection.error;
  }
  async function load() {
    try {
      const data = await api('/api/social/feeds');
      feeds = data.feeds;
      loadedTracked = true;
      renderConnection(data.connection);
      render();
    } catch (error) {
      $('feed-form-status').textContent = error.message;
    }
  }
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
    if(button.dataset.action==='edit'){editing=feed.id;$('feed-platform').value=feed.platform;platformDefaults(false);$('feed-platform').disabled=true;$('feed-input').value=feed.url;$('feed-input').disabled=true;$('feed-name').value=feed.name;$('feed-category').value=feed.category;$('feed-interval').value=feed.intervalMinutes;$('feed-max-posts').value=feed.maxPosts;$('feed-enabled').checked=feed.enabled;$('feed-claims').checked=!!feed.claims;$('cancel-edit').hidden=false;$('feed-form-title').textContent='Edit feed';$('save-feed').textContent='Save changes';$('feed-form-status').textContent='';$('feed-name').focus();return;}
    const action = button.dataset.action;
    if (changing.has(feed.id) || (action === 'poll' && !pollable(feed))) return;
    changing.add(feed.id);
    button.disabled = true;
    try {
      const path = '/api/social/feeds/' + feed.id;
      if (action === 'toggle') await api(path, 'PATCH', { enabled: !feed.enabled });
      if (action === 'poll') await api(path + '/refresh', 'POST');
      if (action === 'remove') {
        await api(path, 'DELETE');
        if (editing === feed.id) resetForm();
      }
      $('feed-form-status').textContent = {
        remove: 'Feed removed. Collected posts stay in the timeline.',
        toggle: feed.enabled ? 'Feed paused.' : 'Feed enabled.',
        poll: 'Poll requested.'
      }[action];
      await load();
    } catch (error) {
      $('feed-form-status').textContent = error.message;
    } finally {
      changing.delete(feed.id);
      render();
      if (document.activeElement === document.body) {
        const next = [...$('social-feeds').querySelectorAll('[data-feed]')].find(item => item.dataset.feed === feed.id);
        (next?.querySelector(`[data-action="${action}"]:enabled`) ?? next?.querySelector('[data-action="edit"]') ?? $('feed-search')).focus();
      }
    }
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

  function renderInventory(force = false) {
    const panel = $('built-in-feeds');
    const all = [...builtin, ...feeds];
    const count = state => all.filter(feed => stateOf(feed) === state).length;
    const summary = `${all.filter(matches).length} of ${all.length} sources shown · ${count('error')} poll errors · ${count('stalled')} overdue · ${count('needs-key')} need a connection${collectionEnabled ? (count('paused') ? ' · ' + count('paused') + ' paused' : '') : ' · collection paused'}`;
    if ($('feed-inventory-summary').textContent !== summary) $('feed-inventory-summary').textContent = summary;
    if (!loadedInventory || (!force && panel.contains(document.activeElement))) return;

    const filtered = inventoryFiltered();
    const expansion = filtered ? filteredExpanded : expanded;
    const itemsByDesk = new Map();
    for (const feed of builtin.filter(matches)) {
      const desk = collectorGroup(feed);
      if (!itemsByDesk.has(desk)) itemsByDesk.set(desk, []);
      itemsByDesk.get(desk).push(feed);
    }
    const markup = Object.entries(groups).map(([desk, label]) => {
      const items = itemsByDesk.get(desk);
      if (!items?.length) return '';
      items.sort((a,b)=>(priority[stateOf(a)] ?? 3)-(priority[stateOf(b)] ?? 3) || a.name.localeCompare(b.name));
      const needsAttention = items.filter(feed=>Object.hasOwn(priority,stateOf(feed))).length;
      return `<details data-desk="${desk}" ${(expansion.get(desk) ?? (filtered || !['trackers','transport'].includes(desk))) ? 'open' : ''}>
        <summary>${esc(label)} · ${items.length}${needsAttention ? ' <small>'+needsAttention+' need attention</small>' : ''}</summary>
        <ul>${items.map(feed => {
          const state = stateOf(feed);
          const success = feed.lastSuccess ? `Last success ${time(feed.lastSuccess)}` : 'No successful poll yet';
          const output = sourceOutput(feed);
          const detail = state === 'stalled' ? problems.get(feed.id)?.detail : ['error', 'needs-key'].includes(state) ? feed.error : '';
          const schedule = !collectionEnabled || ['needs-key', 'paused'].includes(state) ? '' :
            feed.polling ? 'Polling now' : feed.queued ? 'Queued' : Date.parse(feed.nextPoll) <= Date.now() + 2000 ? 'Poll due' :
            feed.nextPoll ? 'Next poll ' + time(feed.nextPoll) : '';
          return `<li><a href="/timeline?feed=${encodeURIComponent(feed.id)}&amp;collector=${encodeURIComponent(feed.name)}">${esc(feed.name)} ↗</a><span class="builtin-feed-actions"><button class="poll-history-button" type="button" data-poll-history="${esc(feed.id)}" aria-label="Poll history for ${esc(feed.name)}">History</button>
            <button type="button" data-collector-toggle="${esc(feed.id)}" data-enable="${feed.enabled === false}" aria-label="${feed.enabled === false ? 'Resume' : 'Pause'} ${esc(feed.name)}">${feed.enabled === false ? 'Resume' : 'Pause'}</button></span>
            <small><span class="feed-indicator ${esc(state)}">${esc(states[state] || state)}</span> · ${esc(success)}${schedule ? ' · ' + esc(schedule) : ''}${feed.unchanged ? ' · Source unchanged' : ''}${detail ? ' · ' + esc(detail) : ''}</small>${output ? `<small class="feed-latest-source">${esc(output)}</small>` : ''}</li>`;
        }).join('')}</ul>
      </details>`;
    }).join('') || '<p class="subtle">No built-in collectors match these filters.</p>';
    if (inventoryMarkup === markup) return;
    inventoryMarkup = markup;
    panel.innerHTML = markup;
  }

  $('built-in-feeds').addEventListener('click', async event => {
    const section = event.target.closest('summary')?.parentElement;
    if (section?.dataset.desk) {
      (inventoryFiltered() ? filteredExpanded : expanded).set(section.dataset.desk,!section.open);
      inventoryMarkup = '';
      return;
    }
    const button = event.target.closest('[data-collector-toggle]');
    if (!button || button.disabled) return;
    const id = button.dataset.collectorToggle;
    const feed = builtin.find(item => item.id === id);
    if (!feed) return;
    const enabled = button.dataset.enable === 'true';
    const feedback = $('builtin-action-status');
    feedback.textContent = '';
    button.disabled = true;
    try {
      const state = await api('/api/collectors/' + encodeURIComponent(id), 'PATCH', {enabled});
      builtin = builtin.map(item => item.id === id ? {...item,...state} : item);
      feedback.textContent = feed.name + (enabled ? ' resumed.' : ' paused.');
      const restoreFocus = document.activeElement === button || document.activeElement === document.body;
      renderInventory(true);
      const target = $('built-in-feeds').querySelector('[data-collector-toggle="' + CSS.escape(id) + '"]') || $('feed-visibility');
      if (restoreFocus) target.focus({preventScroll:true});
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const historyDialog = $('poll-history');
  function renderPollProfile(feed) {
    $('poll-watch-feed').href = '/watch?feed='+encodeURIComponent(feed.id)+'#rule-title';
    const profile = feed.profile;
    $('poll-profile-description').textContent = profile?.description ||
      (feed.platform ? 'Public posts collected from this account.' : '');
    $('poll-profile-evidence').textContent = profile?.evidence || (feed.claims ? 'Relayed claims' : 'Public posts');
    $('poll-profile-interval').textContent = Number.isFinite(feed.intervalMinutes) ?
      'Target interval ' + feed.intervalMinutes + ' min' : '';
    $('poll-profile-mirror').hidden = !feed.officialMirror;
    const link = $('poll-profile-link');
    link.hidden = true;
    link.removeAttribute('href');
    try {
      const url = new URL(profile?.url || feed.url);
      if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
        link.href = url.href;
        link.hidden = false;
      }
    } catch {}
  }
  let historyFeed = null, historyRequest = 0;
  async function loadHistory() {
    const feed = historyFeed;
    if (!feed) return;
    const request = ++historyRequest;
    const status = $('poll-history-status');
    const table = $('poll-history-table');
    status.textContent = 'Reading recorded polls…';
    table.hidden = true;
    $('poll-reload').disabled = true;
    try {
      const parameters = new URLSearchParams({ feed: feed.id, hours: $('poll-hours').value });
      const data = await api('/api/health/polls?' + parameters);
      if (request !== historyRequest) return;
      status.textContent = data.attempts ?
        `${data.succeeded.toLocaleString()} succeeded · ${data.failed.toLocaleString()} failed · ${data.attempts.toLocaleString()} total` :
        'No polls recorded for this collector in the selected period.';
      $('poll-history-rows').innerHTML = data.recent.map(poll => {
        const duration = poll.duration_ms < 1000 ? poll.duration_ms + ' ms' : (poll.duration_ms / 1000).toFixed(1) + ' s';
        const changes = poll.unchanged ? 'Source unchanged' : poll.success ? poll.added !== null || poll.revised !== null ?
          (poll.added ?? 0) + ' added · ' + (poll.revised ?? 0) + ' revised' : '—' : poll.error || '—';
        return `<tr><td><time datetime="${esc(poll.completed)}">${esc(time(poll.completed).replace(/ UTC$/, ''))}</time></td>
          <td class="${poll.success ? 'poll-ok' : 'poll-failed'}">${poll.success ? 'Succeeded' : 'Failed'}</td>
          <td>${duration}</td><td>${poll.reports === null ? '—' : poll.reports.toLocaleString()}</td><td>${esc(changes)}</td></tr>`;
      }).join('');
      table.hidden = !data.recent.length;
    } catch (error) {
      if (request === historyRequest) status.textContent = error.message;
    } finally {
      if (request === historyRequest) $('poll-reload').disabled = false;
    }
  }
  function openPollHistory(id) {
    if (historyDialog.open) return;
    historyFeed = [...builtin,...feeds].find(feed=>feed.id===id);
    if (!historyFeed) return;
    $('poll-history-title').textContent = historyFeed.name;
    renderPollProfile(historyFeed);
    historyDialog.showModal();
    void loadHistory();
  }
  document.querySelector('.feeds-shell').addEventListener('click', event => {
    const button = event.target.closest('[data-poll-history]');
    if (button) openPollHistory(button.dataset.pollHistory);
  });
  let linkedCollector = new URLSearchParams(location.search).get('collector');
  $('poll-history-close').onclick = () => historyDialog.close();
  $('poll-hours').onchange = $('poll-reload').onclick = () => void loadHistory();
  historyDialog.addEventListener('close', () => { historyRequest++; historyFeed = null; });

  function render() {
    renderInventory();
    renderList();
  }

  function updateInventory(data) {
    builtin = data.feeds.filter(feed => !feed.platform);
    feeds = data.feeds.filter(feed => feed.platform);
    collectionEnabled = data.collecting;
    problems = new Map((data.feedHealth || []).map(issue => [issue.id, issue]));
    loadedInventory = loadedTracked = true;
    if (linkedCollector) {
      const id = linkedCollector;
      linkedCollector = null;
      openPollHistory(id);
    }
    render();
  }

  async function refreshStatus(manual = false) {
    const button = $('reload-feeds');
    const status = $('feed-refresh-status');
    if (manual) {
      button.disabled = true;
      status.textContent = 'Checking collector status…';
    }
    try {
      updateInventory(await api('/api/health'));
      if (manual) status.textContent = `Status updated at ${time(Date.now())}`;
    } catch (error) {
      if (manual || !loadedInventory) status.textContent = `Could not refresh status. ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  $('reload-feeds').onclick = () => void refreshStatus(true);
  const params = new URLSearchParams(location.search);
  const visibility = $('feed-visibility'), search = $('feed-search');
  const requestedMode = params.get('status'), requestedGroup = params.get('group');
  if ([...visibility.options].some(option=>option.value===requestedMode)) visibility.value = requestedMode;
  if (Object.hasOwn(groups,requestedGroup)) groupPicker.value = requestedGroup;
  search.value = (params.get('q') || '').slice(0,120);
  const inventoryFiltered = () => Boolean(groupPicker.value || search.value.trim() || visibility.value!=='all');
  function updateFilters() {
    filteredExpanded.clear();
    const url = new URL(location.href);
    for (const [key,value] of [['group',groupPicker.value],['status',visibility.value==='all'?'':visibility.value],['q',search.value.trim()]]) {
      if (value) url.searchParams.set(key,value);
      else url.searchParams.delete(key);
    }
    if (url.href!==location.href) history.replaceState(null,'',url);
    render();
  }
  search.oninput = visibility.onchange = groupPicker.onchange = updateFilters;
  for (const panel of [$('built-in-feeds'), $('social-feeds')]) panel.addEventListener('focusout', () => setTimeout(render, 0));
  const backupPanel = $('local-backups');
  function renderBackups(data) {
    const label = (item,count) => item ? time(item.created) + ' · ' + count + (count === 1 ? ' copy' : ' copies') : 'None yet';
    $('backup-summary').hidden = false;
    $('backup-daily').textContent = label(data.latestDaily,data.dailyCount);
    $('backup-manual').textContent = label(data.latestManual,data.manualCount);
    $('backup-folder').value = data.folder;
    $('backup-folder-label').hidden = false;
    $('backup-copy-folder').disabled = !data.latestDaily && !data.latestManual;
  }
  let backupRequest = 0;
  async function loadBackups() {
    const request = ++backupRequest;
    const feedback = $('backup-feedback');
    feedback.textContent = 'Checking local backups…';
    try {
      const info = await api('/api/backups');
      if (request !== backupRequest) return;
      renderBackups(info);
      feedback.textContent = '';
    } catch (error) {
      if (request === backupRequest) feedback.textContent = error.message;
    }
  }
  backupPanel.ontoggle = () => {
    if (backupPanel.open && !$('backup-create').disabled) void loadBackups();
  };
  $('backup-create').onclick = async () => {
    backupRequest++;
    const button = $('backup-create'), feedback = $('backup-feedback');
    button.disabled = true;
    feedback.textContent = 'Creating a local database copy…';
    try {
      const result = await api('/api/backups','POST',{});
      renderBackups(result);
      feedback.textContent = 'Created ' + result.backup.name;
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  $('backup-copy-folder').onclick = async () => {
    const folder = $('backup-folder'), feedback = $('backup-feedback');
    try {
      await navigator.clipboard.writeText(folder.value);
      feedback.textContent = 'Backup folder copied.';
    } catch {
      folder.focus();
      folder.select();
      feedback.textContent = 'Folder path selected. Use your copy shortcut.';
    }
  };
  const openConnections = () => {
    if (location.hash === '#feed-connections') $('feed-connections').open = true;
    if (location.hash === '#local-backups') backupPanel.open = true;
  };
  window.addEventListener('hashchange', openConnections);
  openConnections();
  Capstone.subscribe(updateInventory);
  void refreshStatus();
  setInterval(render, 30000);
  platformDefaults();
  void load();
})();

(() => {
  const {api,read,save,subscribe} = Capstone;
  const $ = id => document.getElementById(id);
  const section = $('personal-accounts');
  const form = $('x-account-form');
  const client = $('x-account-client');
  const openX = $('x-account-authorize');
  const xFeedback = $('x-account-message');
  let linked = null, waiting = null, updating = 0;
  let feeds = [];
  client.value = read('capstone-x-client-id','') || '';
  const reveal = () => { if (location.hash==='#personal-accounts') section.open = true; };
  $('personal-accounts-jump').onclick = () => { section.open = true; };
  window.addEventListener('hashchange',reveal);
  reveal();

  function showStatus(state) {
    linked = state.profile;
    const hasFeed = linked && feeds.some(feed=>feed.kind==='following' && feed.target===linked.id);
    $('x-account-ready').hidden = !linked;
    $('x-add-following').disabled = Boolean(hasFeed);
    $('x-add-following').textContent = hasFeed ? 'Following feed added' : 'Add Following feed';
    form.hidden = Boolean(linked);
    $('x-account-callback').value = state.callback || $('x-account-callback').value;
    const title = linked ? 'Connected as @'+linked.handle+(state.storage==='session-memory' ? ' · this server session' : '') :
      state.authorizing ? 'Waiting for approval from X' : 'X account disconnected';
    $('x-account-status').textContent = title;
    if (state.error) xFeedback.textContent = state.error;
    if (linked || !state.authorizing) {
      clearInterval(waiting);
      waiting = null;
      openX.hidden = true;
      openX.removeAttribute('href');
      $('x-account-cancel').hidden = true;
    }
  }
  async function refresh() {
    const sequence = ++updating;
    try {
      const state = await api('/api/social/x-account');
      if (sequence===updating) showStatus(state);
    } catch (error) {
      if (sequence===updating) $('x-account-status').textContent = error.message;
    }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const button = $('x-account-start');
    button.disabled = true; xFeedback.textContent = '';
    try {
      const clientId = client.value.trim();
      const result = await api('/api/social/x-account','POST',{clientId});
      save('capstone-x-client-id',clientId);
      openX.href = result.authorize;
      openX.hidden = false;
      $('x-account-cancel').hidden = false;
      $('x-account-status').textContent = 'Open X to approve the connection';
      openX.focus();
      clearInterval(waiting);
      waiting = setInterval(refresh,3000);
    } catch (error) { xFeedback.textContent = error.message; }
    finally { button.disabled = false; }
  };
  async function disconnect() {
    try {
      await api('/api/social/x-account','DELETE');
      xFeedback.textContent = '';
      await refresh();
    } catch (error) { xFeedback.textContent = error.message; }
  }
  $('x-account-cancel').onclick = disconnect;
  $('x-unlink-account').onclick = disconnect;
  $('x-add-following').onclick = async () => {
    const button = $('x-add-following');
    button.disabled = true; xFeedback.textContent = '';
    try {
      const feed = await api('/api/social/x-account/following','POST',{});
      feeds = [...feeds,feed];
      button.textContent = 'Following feed added';
      xFeedback.textContent = 'Added paused. Enable it under Tracked feeds when you are ready.';
    } catch (error) { xFeedback.textContent = error.message; button.disabled = false; }
  };
  subscribe(data => {
    if (!Array.isArray(data.feeds)) return;
    const previous = feeds.some(feed=>feed.kind==='following' && feed.target===linked?.id);
    feeds = data.feeds;
    const current = feeds.some(feed=>feed.kind==='following' && feed.target===linked?.id);
    if (previous!==current) void refresh();
  });
  document.addEventListener('visibilitychange',()=>{
    if (!document.hidden && section.open) void refresh();
  });
  void refresh();
})();

(() => {
  const {api,esc,subscribe} = Capstone;
  const $ = id => document.getElementById(id);
  const endpoint = '/api/social/telegram-account';
  const form = $('telegram-account-form');
  const passwordForm = $('telegram-password-form');
  const qr = $('telegram-account-qr');
  const image = qr.querySelector('img');
  const importForm = $('telegram-import-form');
  const list = $('telegram-channel-list');
  const search = $('telegram-channel-search'), submit = $('telegram-import-selected');
  let tracked = new Set(), importing = false;
  const feedback = $('telegram-account-message');
  let timer, sequence = 0;
  const phaseLabel = {
    starting:'Contacting Telegram',
    scan:'Scan and approve in Telegram',
    password:'Telegram needs two-step verification',
    verifying:'Verifying with Telegram',
    saving:'Saving the Telegram connection',
    disconnected:'Telegram account disconnected'
  };

  function showStatus(state) {
    const busy = !['connected','disconnected'].includes(state.phase);
    form.hidden = busy || Boolean(state.profile);
    passwordForm.hidden = state.phase!=='password';
    $('telegram-account-ready').hidden = !state.profile;
    $('telegram-account-waiting').hidden = !busy || state.phase==='saving';
    $('telegram-account-status').textContent = state.profile ?
      'Connected as '+state.profile.label+(state.storage==='session-memory'?' · this server session':'') :
      phaseLabel[state.phase] || 'Waiting for Telegram';
    if (state.error) feedback.textContent = state.error;
    qr.hidden = state.phase!=='scan' || !state.qr?.image;
    if (qr.hidden) image.removeAttribute('src');
    else if (image.getAttribute('src')!==state.qr.image) image.src = state.qr.image;
    if (!state.profile) importForm.hidden = true;
    if (busy) timer = setTimeout(refresh,1500);
  }
  async function refresh() {
    clearTimeout(timer);
    const request = ++sequence;
    try {
      const state = await api(endpoint);
      if (request===sequence) showStatus(state);
    } catch (error) {
      if (request===sequence) feedback.textContent = error.message;
    }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const button = $('telegram-account-start'), hash = $('telegram-account-hash');
    const apiHash = hash.value.trim();
    hash.value = '';
    button.disabled = true; feedback.textContent = '';
    try {
      const state = await api(endpoint,'POST',{apiId:$('telegram-account-id').value.trim(),apiHash});
      clearTimeout(timer);
      sequence++;
      showStatus(state);
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  };
  passwordForm.onsubmit = async event => {
    event.preventDefault();
    const field = $('telegram-account-password');
    const password = field.value;
    field.value = '';
    try {
      await api(endpoint+'/password','POST',{password});
      await refresh();
    } catch (error) { feedback.textContent = error.message; }
  };
  async function disconnect() {
    clearTimeout(timer);
    sequence++;
    feedback.textContent = '';
    try {
      showStatus(await api(endpoint,'DELETE'));
      list.replaceChildren();
    } catch (error) { feedback.textContent = error.message; void refresh(); }
  }
  $('telegram-cancel-account').onclick = disconnect;
  $('telegram-unlink-account').onclick = disconnect;
  function updateChannelPicker() {
    const query = search.value.trim().normalize('NFKC').toLocaleLowerCase();
    let shown = 0, selected = 0;
    for (const row of list.children) {
      const field = row.querySelector('input');
      const exists = tracked.has(field.value.toLowerCase());
      field.disabled = exists;
      if (exists) field.checked = false;
      row.querySelector('.telegram-channel-tracked').hidden = !exists;
      row.hidden = Boolean(query && !row.dataset.search.includes(query));
      if (!row.hidden) shown++;
      if (field.checked) selected++;
    }
    const summary = selected+' selected · '+shown+' shown';
    const status = $('telegram-selection-summary');
    if (status.textContent!==summary) status.textContent = summary;
    submit.disabled = importing || !selected;
  }
  list.onchange = search.oninput = updateChannelPicker;
  subscribe(snapshot=>{
    if (!Array.isArray(snapshot.feeds)) return;
    tracked = new Set(snapshot.feeds.filter(feed=>feed.platform==='telegram')
      .map(feed=>String(feed.target).toLowerCase()));
    if (!importForm.hidden) updateChannelPicker();
  });
  $('telegram-load-channels').onclick = async () => {
    const button = $('telegram-load-channels');
    button.disabled = true; feedback.textContent = '';
    try {
      const result = await api(endpoint+'/channels','POST',{});
      $('telegram-channel-summary').textContent = result.channels.length+' public channel'+(result.channels.length===1?'':'s')+
        (result.limited ? ' · Checked the '+result.scanned+' most recent conversations' : '');
      search.value = '';
      list.innerHTML = result.channels.map(channel=>'<label data-search="'+esc((channel.name+' '+channel.handle+' @'+channel.handle).normalize('NFKC').toLocaleLowerCase())+'"><input type="checkbox" value="'+esc(channel.handle)+'"><span><strong>'+
        esc(channel.name)+'</strong><small>@'+esc(channel.handle)+'</small><small class="telegram-channel-tracked" hidden>Already tracked</small></span></label>').join('');
      importForm.hidden = false;
      updateChannelPicker();
      search.focus();
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  };
  importForm.onsubmit = async event => {
    event.preventDefault();
    const selected = [...list.querySelectorAll('input:checked:enabled')];
    if (!selected.length || importing) return;
    importing = true;
    updateChannelPicker();
    feedback.textContent = '';
    try {
      const result = await api(endpoint+'/import','POST',{handles:selected.map(field=>field.value),category:$('telegram-import-category').value});
      feedback.textContent = result.added+' added to Tracked feeds'+(result.alreadyTracked?' · '+result.alreadyTracked+' already tracked':'');
      for (const field of selected) tracked.add(field.value.toLowerCase());
    } catch (error) { feedback.textContent = error.message; }
    finally { importing = false; updateChannelPicker(); }
  };
  void refresh();
})();

(() => {
  const { esc, read, save, channel, sourceTime } = Capstone;
  const { defaultStreams: defaults, parseStream } = CapstoneDeskModel;
  const desk = CapstoneDesks.initial('wall');
  const $ = id => document.getElementById(id);
  const grid = $('wall');
  const columns = $('wall-columns');
  const sidebars = $('wall-sidebars');
  const headlineDesk = $('wall-headlines-desk'), headlineEvidence = $('wall-headlines-evidence'), headlineWatch = $('wall-headlines-watch');
  const headlineBasis = $('wall-headlines-basis');
  const fields = $('stream-fields');
  const dialog = $('stream-dialog');
  const healthDialog = $('wall-stream-health');
  const healthList = $('wall-stream-health-list');
  const retryUnavailable = $('wall-retry-unavailable');
  const offlineTiles = () => tiles.filter(tile=>['Waiting to retry','Unavailable'].includes(tile.health));
  const fullscreenControls = $('wall-controls-toggle');
  const wallActions = $('wall-actions');
  function showFullscreenControls(open) {
    document.body.classList.toggle('wall-controls-open',open);
    fullscreenControls.setAttribute('aria-expanded',String(open));
  }
  fullscreenControls.onclick = () => {
    const open = !document.body.classList.contains('wall-controls-open');
    showFullscreenControls(open);
    if (open) $('stream-count').focus({preventScroll:true});
  };
  $('wall-exit-fullscreen').onclick = () => $('fullscreen').click();
  document.addEventListener('fullscreenchange',() => {
    if (document.fullscreenElement) return;
    const hadFocus = wallActions.contains(document.activeElement) || document.activeElement===fullscreenControls;
    showFullscreenControls(false);
    if (hadFocus) $('fullscreen').focus({preventScroll:true});
  });
  document.addEventListener('pointerdown',event=>{
    if (!document.body.classList.contains('wall-controls-open') || document.querySelector('dialog[open]')) return;
    if (!wallActions.contains(event.target) && event.target!==fullscreenControls) showFullscreenControls(false);
  });
  wallActions.addEventListener('keydown',event=>{
    if (event.key!=='Escape' || !document.body.classList.contains('wall-controls-open')) return;
    event.preventDefault();
    showFullscreenControls(false);
    fullscreenControls.focus({preventScroll:true});
  });

  // Upgrade the original four-channel default without replacing customized walls.
  const saved = desk?.streams || read('capstone-streams', defaults);
  const original = '@France24_en|@aljazeeraenglish|@SkyNews|@dwnews';
  let streams = !validStreams(saved) || (!saved.some(stream=>stream.backup) && saved.map(stream => stream.input).join('|') === original) ? defaults : saved;
  let tiles = [];
  let listening = null;
  let focused = null;

  const usNewsBackups = [
    {name:'CBS News 24/7', input:'@CBSNews', channelId:'UC8p1vwvWtl6T73JiExfWs1g'},
    {name:'LiveNOW from FOX', input:'@livenowfox', channelId:'UCJg9wBPyKMNA5sRDnvzmkdg'},
    {name:'NBC News · US', input:'@NBCNews', channelId:'UCeY0bbntWzzVIaj2z3QigXg'}
  ];
  function channelKey({channel} = {}) {
    return channel?.startsWith('@') ? channel.toLowerCase() : channel;
  }
  const abcChannel = new Set(['@abcnews','UCBi2mrWuNuyYy4gbM6fU18Q']);
  function sameStreamKeys(stream) {
    const parsed = parseStream(stream?.input);
    if (!parsed) return [];
    return parsed.videoId ? ['video:'+parsed.videoId] : [channelKey(parsed),stream.channelId].filter(Boolean);
  }
  function availableBackups(tile) {
    const reserved = new Set(sameStreamKeys(tile.stream));
    for (const other of tiles) {
      if (other===tile) continue;
      for (const key of [...sameStreamKeys(other.stream),...sameStreamKeys(other.activeStream)]) reserved.add(key);
    }
    const candidates = [tile.stream.backup,...(abcChannel.has(channelKey(tile.parsed)) ? usNewsBackups : [])];
    return candidates.filter(stream=>{
      if (!stream?.name?.trim()) return false;
      const keys = sameStreamKeys(stream);
      if (!keys.length || keys.some(key=>reserved.has(key))) return false;
      for (const key of keys) reserved.add(key);
      return true;
    });
  }

  function validStreams(list) {
    return Array.isArray(list) && list.every(stream =>
      stream && typeof stream.name === 'string' && stream.name.trim() &&
      typeof stream.input === 'string' && parseStream(stream.input)
    );
  }

  let apiAttempt;
  function loadPlayerApi() {
    if (typeof window.YT?.Player === 'function') return Promise.resolve(true);
    if (apiAttempt) return apiAttempt;
    const pending = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      const timer = setTimeout(() => finish(false), 10000);
      const ready = () => finish(typeof window.YT?.Player === 'function');
      function finish(ok) {
        clearTimeout(timer);
        script.onerror = null;
        if (window.onYouTubeIframeAPIReady === ready) delete window.onYouTubeIframeAPIReady;
        if (!ok) script.remove();
        resolve(ok);
      }
      window.onYouTubeIframeAPIReady = ready;
      script.onerror = () => finish(false);
      document.head.append(script);
    });
    apiAttempt = pending;
    void pending.finally(() => { if (apiAttempt === pending) apiAttempt = null; });
    return pending;
  }

  function updateAudio() {
    for (const tile of tiles) {
      const active = tile === listening;
      tile.element.classList.toggle('listening', active);
      tile.audio.textContent = active ? 'Mute' : 'Listen';
      tile.audio.setAttribute('aria-pressed', String(active));
      tile.audio.disabled = !tile.ready;
    }
    $('audio-status').textContent = listening ? `Listening to ${listening.activeStream.name}` : 'All streams muted';
    $('mute-all').disabled = !tiles.length;
  }

  function muteAll(announce = false) {
    try { listening?.player?.mute(); } catch {}
    listening = null;
    updateAudio();
    if (announce) channel?.postMessage({ type: 'wall-audio' });
  }

  function listen(tile) {
    if (!tile.ready) return;
    const wasListening = listening === tile;
    muteAll();
    if (!wasListening) {
      try {
        tile.player.setVolume(75);
        tile.player.unMute();
        listening = tile;
        tile.player.playVideo();
      } catch {
        muteAll();
      }
    }
    updateAudio();
    channel?.postMessage({ type: 'wall-audio' });
  }

  function clearPlayer(tile) {
    clearTimeout(tile.timeout);
    clearTimeout(tile.bufferTimer);
    clearTimeout(tile.retryTimer);
    tile.bufferTimer = null;
    tile.retryAt = null;
    tile.retryTimer = null;
    tile.request?.abort();
    if (tile === listening) muteAll();
    try { tile.player?.destroy(); } catch {}
    tile.player = null;
    tile.ready = false;
    tile.playing = false;
  }

  function showStream(tile, stream, videoId) {
    tile.activeStream = stream;
    tile.title.textContent = stream.name;
    const url = parseStream(videoId || stream.input).url;
    tile.link.href = url;
    tile.link.setAttribute('aria-label', `Open ${stream.name} on YouTube`);
    if (focused !== tile) tile.expand.setAttribute('aria-label', `Enlarge ${stream.name}`);
  }

  function setStatus(tile, message) {
    tile.health = message;
    const backup = tile.activeStream!==tile.stream;
    const status = message + (backup ? ` · backup for ${tile.stream.name}` : '');
    tile.element.dataset.playback = message==='Playing' ? (backup?'backup':'playing') :
      ['Waiting to retry','Unavailable'].includes(message) ? 'unavailable' : message==='Buffering' ? 'buffering' : 'waiting';
    tile.status.textContent = tile.status.title = status;
    renderVideoHealth();
  }

  let healthMarkup = '';
  function renderVideoHealth() {
    const playing = tiles.filter(tile=>tile.playing);
    const usingBackup = playing.filter(tile=>tile.stream!==tile.activeStream).length;
    const unavailable = new Set(offlineTiles());
    const failed = unavailable.size;
    const label = tiles.length ? playing.length+'/'+tiles.length+' playing' : '0 screens';
    const button = $('stream-count');
    if (button.textContent!==label) button.textContent = label;
    button.dataset.playback = failed ? 'unavailable' : usingBackup ? 'backup' :
      tiles.length && playing.length===tiles.length ? 'playing' : 'waiting';
    if (!healthDialog.open) return;
    const summary = [label,usingBackup ? usingBackup+' on backup' : '',failed ? failed+' unavailable' : ''].filter(Boolean).join(' · ');
    if ($('wall-stream-health-summary').textContent!==summary) $('wall-stream-health-summary').textContent = summary;
    retryUnavailable.disabled = !failed;
    const markup = tiles.length ? tiles.map(tile=>{
      const health = tile.health || 'Connecting…';
      const backup = tile.stream!==tile.activeStream ? tile.activeStream.name : '';
      const timing = tile.retryAt ? (tile.playing?'Primary recheck ':'Next retry ')+sourceTime({ts:tile.retryAt}) : '';
      const problem = tile.primaryIssue && (backup || unavailable.has(tile)) ? tile.primaryIssue : '';
      return `<li data-broadcast-tile="${tile.title.id}"><div><strong>${esc(tile.stream.name)}</strong><span>${esc(health)}${backup ? ' · '+esc(backup) : ''}</span>
        ${problem ? '<small>'+esc(problem)+'</small>' : ''}${timing ? '<small>'+esc(timing)+'</small>' : ''}</div>
        <div class="wall-broadcast-actions">${unavailable.has(tile) ? '<button type="button" data-broadcast-action="retry" aria-label="Retry '+esc(tile.stream.name)+'">Retry</button>' : ''}
        <button type="button" data-broadcast-action="focus" aria-label="Focus ${esc(tile.stream.name)}">Focus tile</button></div></li>`;
    }).join('') : '<li class="subtle">No broadcasts configured.</li>';
    if (healthMarkup===markup) return;
    healthMarkup = markup;
    const active = document.activeElement;
    const row = active?.closest('[data-broadcast-tile]')?.dataset.broadcastTile;
    healthList.innerHTML = markup;
    if (row) {
      const actions = healthList.querySelector(`[data-broadcast-tile="${row}"] .wall-broadcast-actions`);
      const next = actions?.querySelector(`[data-broadcast-action="${active.dataset.broadcastAction}"]`) || actions?.lastElementChild;
      (next || $('wall-stream-health-close')).focus({preventScroll:true});
    }
  }
  $('stream-count').onclick = () => { healthDialog.showModal(); renderVideoHealth(); };
  $('wall-stream-health-close').onclick = () => healthDialog.close();
  healthList.addEventListener('click',event=>{
    const action = event.target.closest('[data-broadcast-action]');
    const tileId = action?.closest('[data-broadcast-tile]')?.dataset.broadcastTile;
    const tile = tiles.find(item=>item.title.id===tileId);
    if (!tile) return;
    if (action.dataset.broadcastAction==='retry') {
      if (offlineTiles().includes(tile)) void mount(tile,true);
      return;
    }
    healthDialog.close();
    setFocus(tile);
  });
  retryUnavailable.onclick = () => {
    const unavailable = offlineTiles();
    if (unavailable.length) $('wall-stream-health-close').focus();
    for (const tile of unavailable) void mount(tile,true);
  };

  function scheduleRetry(tile, delay, action, keepPlayback = false) {
    const attempt = tile.attempt;
    const retry = () => {
      if (attempt !== tile.attempt || !tile.element.isConnected) return;
      if (document.hidden || !navigator.onLine || tile.element.hidden || tile.stage.contains(document.activeElement) ||
          (keepPlayback && (!tile.playing || tile === listening || tile === focused))) {
        setRetry(60_000);
        return;
      }
      tile.retryAt = null;
      renderVideoHealth();
      void action();
    };
    function setRetry(after) {
      tile.retryAt = new Date(Date.now()+after).toISOString();
      tile.retryTimer = setTimeout(retry,after);
      renderVideoHealth();
    }
    setRetry(delay);
  }

  function unavailable(tile, message, retryable) {
    tile.attempt++;
    clearPlayer(tile);
    showStream(tile, tile.stream);
    tile.primaryIssue ||= message;
    const automatic = retryable;
    tile.stage.innerHTML = `<div class="video-placeholder"><span>${esc(message)}</span>
      ${automatic ? '<small>This tile will retry automatically.</small>' : ''}
      <button type="button" data-retry>Retry stream</button></div>`;
    setStatus(tile, automatic ? 'Waiting to retry' : 'Unavailable');
    if (automatic) {
      tile.retryDelay = Math.min(5 * 60_000, tile.retryDelay ? tile.retryDelay * 2 : 45_000);
      scheduleRetry(tile, tile.retryDelay, () => mount(tile, true));
    }
    updateAudio();
  }

  async function lookupBroadcast(tile, handle, refresh) {
    tile.request = new AbortController();
    const response = await fetch('/api/stream?channel=' + encodeURIComponent(handle) + (refresh ? '&refresh=1' : ''), {
      signal: AbortSignal.any([tile.request.signal, AbortSignal.timeout(20000)])
    });
    const result = await response.json();
    if (response.ok && /^[\w-]{11}$/.test(result.videoId || '')) return result.videoId;
    const error = new Error(result.error || 'Could not find a live broadcast.');
    error.retryable = result.retryable !== false;
    throw error;
  }

  function checkPrimary(tile) {
    const attempt = tile.attempt;
    scheduleRetry(tile, 5 * 60_000, async () => {
      const videoId = await lookupBroadcast(tile, tile.parsed.channel, true).catch(() => null);
      if (attempt !== tile.attempt) return;
      if (videoId && videoId !== tile.failedPrimary && tile.playing && tile !== listening && tile !== focused &&
          !tile.element.hidden && !document.hidden && !tile.stage.contains(document.activeElement)) {
        void mount(tile, true, undefined, videoId);
      } else {
        checkPrimary(tile);
      }
    }, true);
  }

  window.addEventListener('online', () => {
    if (document.hidden) return;
    for (const tile of tiles) {
      if (tile.health==='Waiting to retry' && !tile.element.hidden && !tile.stage.contains(document.activeElement)) void mount(tile,true);
    }
  });

  async function mount(tile, refresh = false, candidates = [tile.stream, ...availableBackups(tile)], confirmedVideoId, priorRetryable = false) {
    const attempt = ++tile.attempt;
    const [stream, ...remaining] = candidates;
    const parsed = parseStream(stream.input);
    clearPlayer(tile);
    showStream(tile, stream);
    setStatus(tile, 'Connecting…');
    tile.stage.innerHTML = `<div class="video-mount"><div class="video-placeholder">Connecting to ${esc(stream.name)}…</div></div>`;
    updateAudio();
    const current = () => tile.attempt === attempt;
    let videoId = confirmedVideoId || parsed.videoId;
    const fail = (message, retryable) => {
      if (!current()) return;
      if (stream === tile.stream) {
        tile.primaryIssue = message;
        if (videoId) tile.failedPrimary = videoId;
      }
      const available = availableBackups(tile);
      const viable = remaining.filter(backup=>available.includes(backup));
      const canRetry = priorRetryable || retryable;
      if (viable.length) {
        void mount(tile, refresh, viable, undefined, canRetry);
      } else {
        const allUnavailable = stream !== tile.stream;
        unavailable(tile, allUnavailable ? tile.stream.name+' and its backup broadcasts are unavailable.' : message,canRetry);
      }
    };
    try {
      const playerAvailable = await loadPlayerApi();
      if (!current()) return;
      if (!playerAvailable) {
        unavailable(tile, 'The YouTube player did not load.', true);
        return;
      }
      if (!videoId) videoId = await lookupBroadcast(tile, parsed.channel, refresh);
      if (!current()) return;
      showStream(tile, stream, videoId);
      tile.timeout = setTimeout(() => fail('The player took too long to start.', true), 20000);
      tile.player = new YT.Player(tile.stage.firstElementChild, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, enablejsapi: 1, origin: location.origin, rel: 0 },
        events: {
          onReady(event) {
            if (!current()) return;
            tile.ready = true;
            event.target.getIframe()?.setAttribute('title', `${stream.name} video player`);
            event.target.mute();
            setStatus(tile, 'Waiting for playback');
            event.target.playVideo();
            updateAudio();
          },
          onStateChange(event) {
            if (!current()) return;
            if (event.data === YT.PlayerState.PLAYING) {
              clearTimeout(tile.bufferTimer);
              tile.bufferTimer = null;
              tile.playing = true;
              clearTimeout(tile.timeout);
              tile.retryDelay = 0;
              if (stream === tile.stream) {
                tile.failedPrimary = null;
                tile.primaryIssue = null;
              }
              setStatus(tile, 'Playing');
              if (stream !== tile.stream && tile.parsed.channel && !tile.retryTimer) checkPrimary(tile);
            }
            if (event.data === YT.PlayerState.BUFFERING) {
              tile.playing = false;
              setStatus(tile,'Buffering');
              tile.bufferTimer ||= setTimeout(()=>fail('The broadcast stalled while buffering.',true),45_000);
            }
            if (event.data === YT.PlayerState.PAUSED) {
              clearTimeout(tile.bufferTimer);
              tile.bufferTimer = null;
              tile.playing = false;
              clearTimeout(tile.timeout);
              setStatus(tile, 'Paused');
            }
            if (event.data === YT.PlayerState.ENDED) fail('The broadcaster ended this stream.', Boolean(parsed.channel));
          },
          onAutoplayBlocked() {
            if (!current()) return;
            clearTimeout(tile.timeout);
            setStatus(tile, 'Press Play in the player');
          },
          onError(event) {
            if (!current()) return;
            const status = {
              100:'This broadcast is no longer available.',
              101:'This broadcaster blocks embedded playback.',
              150:'This broadcaster blocks embedded playback.',
              153:'YouTube rejected this embedded player.'
            };
            fail(status[event.data] || `YouTube could not play this stream (code ${event.data}).`,
              event.data===5 || (Boolean(parsed.channel) && [100,101,150].includes(event.data)));
          }
        }
      });
    } catch (error) {
      fail(error.name === 'TimeoutError' ? 'The broadcaster lookup timed out.' : error.message,
        error.retryable === true || ['TimeoutError','TypeError'].includes(error.name));
    }
  }

  function setFocus(tile, moveFocus = true) {
    const previous = focused;
    focused = tile;
    if (tile && listening && listening !== tile) muteAll();
    grid.classList.toggle('wall-single', Boolean(tile));
    columns.disabled = Boolean(tile);
    for (const item of tiles) {
      item.element.hidden = Boolean(tile && item !== tile);
      item.expand.textContent = item === tile ? 'Back to wall' : 'Enlarge';
      item.expand.setAttribute('aria-label', item === tile ? 'Back to all streams' : `Enlarge ${item.activeStream.name}`);
    }
    layout();
    if (moveFocus) (tile ?? previous)?.expand.focus();
  }

  let tileSequence = 0;
  function createTile(stream) {
    const node = document.createElement('section');
    const titleId = 'stream-title-'+ ++tileSequence;
    const parsed = parseStream(stream.input);
    node.className = 'stream-tile';
    node.setAttribute('aria-labelledby',titleId);
    node.innerHTML = `
      <div class="video-stage"></div>
      <div class="stream-info">
        <div class="stream-label">
          <h2 id="${titleId}">${esc(stream.name)}</h2>
          <small class="stream-status">Connecting…</small>
        </div>
        <div class="stream-controls">
          <button type="button" data-listen disabled aria-pressed="false">Listen</button>
          <button type="button" data-enlarge>Enlarge</button>
          <a href="${esc(parsed.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(stream.name)} on YouTube">YouTube ↗</a>
        </div>
      </div>`;
    return {
      element:node, stream, activeStream:stream, parsed, attempt:0, ready:false,
      title:node.querySelector('h2'),
      link:node.querySelector('.stream-controls a'),
      stage:node.querySelector('.video-stage'),
      status:node.querySelector('.stream-status'),
      audio:node.querySelector('[data-listen]'),
      expand:node.querySelector('[data-enlarge]')
    };
  }

  function streamSettingsKey(stream) {
    return JSON.stringify([stream.name,stream.input,stream.backup?.name,stream.backup?.input]);
  }

  function render() {
    const previous = new Map();
    for (const tile of tiles) {
      const key = streamSettingsKey(tile.stream);
      if (!previous.has(key)) previous.set(key,[]);
      previous.get(key).push(tile);
    }
    const mountAfterLayout = new Set();
    const ordered = streams.map(stream => {
      const key = streamSettingsKey(stream);
      const tile = previous.get(key)?.shift();
      if (tile) return tile;
      const added = createTile(stream);
      mountAfterLayout.add(added);
      return added;
    });
    for (const removed of previous.values()) for (const tile of removed) {
      tile.attempt++;
      clearPlayer(tile);
      tile.element.remove();
    }
    tiles = ordered;
    grid.querySelector('.empty-wall')?.remove();
    if (!tiles.length) {
      grid.innerHTML = '<div class="empty-wall"><h2>Your wall is empty</h2><p>Add a YouTube stream to start watching.</p><button data-add-stream>Add stream</button></div>';
    }
    for (const [index,tile] of tiles.entries()) {
      const at = grid.children[index] || null;
      if (at===tile.element) continue;
      const sameParent = tile.element.parentNode===grid;
      if (sameParent && typeof grid.moveBefore==='function') {
        grid.moveBefore(tile.element,at);
      } else {
        grid.insertBefore(tile.element,at);
        if (sameParent) mountAfterLayout.add(tile);
      }
    }
    renderVideoHealth();
    setFocus(tiles.includes(focused) ? focused : null,false);
    for (const tile of mountAfterLayout) void mount(tile);
    updateAudio();
  }

  grid.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('[data-add-stream]')) {
      openEditor(true);
      return;
    }
    const tile = tiles.find(item => item.element === button.closest('.stream-tile'));
    if (!tile) return;
    if (button.matches('[data-enlarge]')) setFocus(focused === tile ? null : tile);
    if (button.matches('[data-listen]')) listen(tile);
    if (button.matches('[data-retry]')) {
      tile.expand.focus();
      mount(tile, true);
    }
  });
  $('mute-all').onclick = () => muteAll(true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && focused && !document.querySelector('dialog[open]') && !document.fullscreenElement) setFocus(null);
  });

  function editRows(list) {
    fields.innerHTML = list.map((stream, i) => `
      <fieldset class="stream-editor-row">
        <legend>Screen ${i + 1}</legend>
        <div class="stream-field">
          <label>Name<input data-name value="${esc(stream.name)}" maxlength="80" required></label>
          <label>YouTube link or handle<input data-input value="${esc(stream.input)}" maxlength="250" required spellcheck="false"></label>
        </div>
        <details class="stream-backup"${stream.backup ? ' open' : ''}>
          <summary>Backup broadcast</summary>
          <label class="stream-backup-preset">Choose backup broadcaster<select data-backup-preset aria-label="Backup broadcaster for screen ${i + 1}"></select></label>
          <div class="stream-field">
            <label>Backup name<input data-backup-name value="${esc(stream.backup?.name || '')}" maxlength="80"></label>
            <label>Backup YouTube link or handle<input data-backup-input value="${esc(stream.backup?.input || '')}" maxlength="250" spellcheck="false"></label>
          </div>
          <button type="button" class="stream-clear-backup" data-clear-backup>Clear backup</button>
        </details>
        <div class="row-actions">
          <button type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move screen ${i + 1} up">↑ Move up</button>
          <button type="button" data-move="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move screen ${i + 1} down">↓ Move down</button>
          <button type="button" data-remove aria-label="Remove screen ${i + 1}">Remove</button>
        </div>
      </fieldset>`).join('');
    renderBackupPresets();
  }

  function draftRows() {
    return [...fields.children].map(row => {
      const name = row.querySelector('[data-name]').value.trim();
      const input = row.querySelector('[data-input]').value.trim();
      const backupName = row.querySelector('[data-backup-name]').value.trim();
      const backupInput = row.querySelector('[data-backup-input]').value.trim();
      return {name,input,...(backupName || backupInput ? {backup:{name:backupName || 'Backup broadcast',input:backupInput}} : {})};
    });
  }

  function addRow() {
    editRows([...draftRows(), { name: '', input: '' }]);
    fields.lastElementChild.querySelector('[data-name]').focus();
  }

  function openEditor(add = false) {
    $('stream-error').textContent = '';
    editRows(streams);
    dialog.showModal();
    if (add) addRow();
  }

  $('edit-streams').onclick = () => openEditor();
  $('add-stream').onclick = () => openEditor(true);
  $('add-stream-row').onclick = addRow;
  $('close-dialog').onclick = () => dialog.close();
  $('reset-streams').onclick = () => { editRows(defaults); $('stream-error').textContent = ''; };

  let presets = defaults;
  const presetSelect = $('stream-preset');
  function renderBackupPresets() {
    const reserved = new Set(draftRows().flatMap(sameStreamKeys));
    const markup = '<option value="">Choose a broadcaster</option>' + presets.map((stream,index)=>
      sameStreamKeys(stream).some(key=>reserved.has(key)) ? '' : `<option value="${index}">${esc(stream.name)}</option>`).join('');
    for (const select of fields.querySelectorAll('[data-backup-preset]')) select.innerHTML = markup;
  }
  function renderPresets(list) {
    presets = list.filter(stream => validStreams([stream]));
    presetSelect.innerHTML = '<option value="">Choose a broadcaster</option>' +
      presets.map((stream, index) => `<option value="${index}">${esc(stream.name)}</option>`).join('');
    renderBackupPresets();
  }
  renderPresets(defaults);
  fetch('/assets/stream-presets.json')
    .then(response => response.ok ? response.json() : defaults)
    .then(list => { if (Array.isArray(list)) renderPresets(list); })
    .catch(() => {});
  presetSelect.onchange = () => {
    if (presetSelect.value === '') return;
    const preset = presets[Number(presetSelect.value)];
    presetSelect.value = '';
    if (!preset) return;
    const list = draftRows();
    const blank = list.findIndex(stream => !stream.name && !stream.input && !stream.backup);
    const index = blank < 0 ? list.length : blank;
    list[index] = { ...preset };
    editRows(list);
    fields.children[index]?.querySelector('[data-name]').focus();
  };
  fields.addEventListener('change',event=>{
    const picker = event.target;
    if (picker.matches('[data-input]')) renderBackupPresets();
    if (!picker.matches('[data-backup-preset]') || picker.value==='') return;
    const preset = presets[Number(picker.value)];
    if (preset) fillBackup(picker.closest('fieldset'),preset);
    picker.value = '';
  });
  function fillBackup(row,{name='',input=''}={}) {
    row.querySelector('[data-backup-name]').value = name;
    row.querySelector('[data-backup-input]').value = input;
  }
  fields.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-clear-backup')) {
      fillBackup(button.closest('fieldset'));
      return;
    }
    const index = [...fields.children].indexOf(button.closest('fieldset'));
    const list = draftRows();
    if (button.hasAttribute('data-remove')) {
      list.splice(index, 1);
      editRows(list);
      (fields.children[Math.min(index, list.length - 1)]?.querySelector('[data-remove]') ?? $('add-stream-row')).focus();
    } else if (button.dataset.move) {
      const target = index + Number(button.dataset.move);
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      editRows(list);
      (fields.children[target].querySelector(`[data-move="${button.dataset.move}"]:enabled`) ??
        fields.children[target].querySelector('[data-move]:enabled')).focus();
    }
  };
  $('stream-form').onsubmit = event => {
    event.preventDefault();
    const next = draftRows();
    if (!validStreams(next)) {
      $('stream-error').textContent = 'Each screen needs a name and a valid YouTube video or channel.';
      const index = next.findIndex(stream => !stream.name || !parseStream(stream.input));
      fields.children[index]?.querySelector(next[index].name ? '[data-input]' : '[data-name]').focus();
      return;
    }
    const badBackup = next.findIndex(stream=>stream.backup && (!parseStream(stream.backup.input) ||
      sameStreamKeys(stream.backup).some(key=>sameStreamKeys(stream).includes(key))));
    if (badBackup>=0) {
      $('stream-error').textContent = 'Choose a different YouTube link or channel for the backup, or leave both backup fields empty.';
      const row = fields.children[badBackup];
      row.querySelector('.stream-backup').open = true;
      row.querySelector('[data-backup-input]').focus();
      return;
    }
    streams = next;
    const stored = CapstoneDesks.active() ? CapstoneDesks.update('streams') : save('capstone-streams', streams);
    dialog.close();
    $('wall-message').textContent = stored ? 'Stream wall saved.' : 'Stream wall changed for this session.';
    render();
    if (!CapstoneDesks.active()) channel?.postMessage({ type: 'streams-updated' });
  };

  const savedColumns = String(desk?.columns || read('capstone-wall-columns', 'auto'));
  columns.value = ['auto', '1', '2', '3', '4', '5', '6'].includes(savedColumns) ? savedColumns : 'auto';

  function layout() {
    const count = focused ? 1 : tiles.length;
    grid.style.gridTemplateColumns = '';
    grid.classList.remove('wall-scroll');
    if (!count || matchMedia('(max-width:760px)').matches) return;

    const gap = parseFloat(getComputedStyle(grid).columnGap) || 10;
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    const minWidth = 228;
    const maxColumns = Math.min(count, Math.max(1, Math.floor((width + gap) / (minWidth + gap))));
    const fit = cols => {
      const rows = Math.ceil(count / cols);
      return Math.floor(Math.min((width - gap * (cols - 1)) / cols, ((height - gap * (rows - 1)) / rows - 72) * 16 / 9));
    };
    let cols = focused || columns.value === 'auto' ? 1 : Math.min(Number(columns.value), maxColumns);
    if (!focused && columns.value === 'auto') {
      for (let candidate = 2; candidate <= maxColumns; candidate++) {
        if (fit(candidate) > fit(cols)) cols = candidate;
      }
    }
    const fitted = fit(cols);
    if (fitted < minWidth) {
      if (columns.value === 'auto' && !focused) cols = maxColumns;
      grid.classList.add('wall-scroll');
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    } else {
      grid.style.gridTemplateColumns = `repeat(${cols}, ${fitted}px)`;
    }
  }
  columns.onchange = () => {
    if (CapstoneDesks.active()) CapstoneDesks.update('columns');
    else save('capstone-wall-columns', columns.value);
    layout();
  };
  new ResizeObserver(layout).observe(grid);
  channel?.addEventListener('message', event => {
    if (event.data?.type === 'wall-audio') muteAll();
    if (event.data?.type === 'streams-updated' && !CapstoneDesks.active()) {
      const next = read('capstone-streams', defaults);
      if (validStreams(next)) { streams = next; render(); }
    }
  });
  const layoutOptions = CapstoneDeskModel.wall(desk || {
    sidebars:read('capstone-wall-sidebars','both'),
    headlineDesk:read('capstone-wall-headlines-desk','all'),
    headlineEvidence:read('capstone-wall-headlines-evidence','all'),
    headlineWatchOnly:read('capstone-wall-headlines-watch',false),
    headlineBasis:read('capstone-wall-headlines-basis','source')
  });
  sidebars.value = layoutOptions.sidebars;
  headlineDesk.value = layoutOptions.headlineDesk;
  headlineEvidence.value = layoutOptions.headlineEvidence;
  headlineWatch.checked = layoutOptions.headlineWatchOnly;
  headlineBasis.value = layoutOptions.headlineBasis;
  headlineWatch.addEventListener('change',()=>{
    if (CapstoneDesks.active()) CapstoneDesks.update('headlineWatchOnly');
    else save('capstone-wall-headlines-watch',headlineWatch.checked);
  });
  for (const [picker,setting,key] of [[headlineDesk,'headlineDesk','capstone-wall-headlines-desk'],[headlineEvidence,'headlineEvidence','capstone-wall-headlines-evidence'],[headlineBasis,'headlineBasis','capstone-wall-headlines-basis']]) {
    picker.addEventListener('change',()=>{
      if (CapstoneDesks.active()) CapstoneDesks.update(setting);
      else save(key,picker.value);
    });
  }
  grid.parentElement.dataset.sidebars = sidebars.value;
  sidebars.onchange = () => {
    grid.parentElement.dataset.sidebars = sidebars.value;
    if (CapstoneDesks.active()) CapstoneDesks.update('sidebars');
    else save('capstone-wall-sidebars',sidebars.value);
  };
  CapstoneDesks.register('wall', () => ({
    streams: streams.map(stream => ({ ...stream })), columns: columns.value, sidebars: sidebars.value,
    headlineDesk:headlineDesk.value, headlineEvidence:headlineEvidence.value, headlineWatchOnly:headlineWatch.checked, headlineBasis:headlineBasis.value
  }));
  window.addEventListener('pagehide',()=>muteAll());
  render();
})();

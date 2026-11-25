(() => {
  const {esc,api,subscribe}=Capstone,$=id=>document.getElementById(id);let state={rules:[],alerts:[],unread:0},editing=null;
  function reset(){clearPreview();editing=null;$('rule-form').reset();$('rule-title').textContent='Create a watchlist';$('save-rule').textContent='Create watchlist';$('cancel-rule').hidden=true;}
  let previewReports = [];
  let inbox, offset = 0, inboxSequence = 0, filterTimer, inboxVersion = '';
  const alertList = $('alert-list');
  const watchVersion = watch => JSON.stringify([watch.unread,watch.rules.map(rule=>rule.id+rule.name),watch.alerts.map(alert=>[alert.id,alert.read_at])]);
  async function loadInbox() {
    const sequence = ++inboxSequence;
    const query = new URLSearchParams({
      q:$('alert-search').value, rule:$('alert-watchlist').value, age:$('alert-age').value,
      unread:$('unread-only').checked ? '1' : '0', offset
    });
    alertList.setAttribute('aria-busy','true');
    try {
      const result = await api('/api/watch/inbox?' + query);
      if (sequence !== inboxSequence) return;
      inbox = result;
      state = {...state,unread:result.unread};
      offset = result.offset;
      render();
    } catch (error) {
      if (sequence === inboxSequence) $('alert-filter-summary').textContent = error.message;
    } finally {
      if (sequence === inboxSequence) alertList.setAttribute('aria-busy','false');
    }
  }
  function changeInbox(delay = 0) {
    offset = 0;
    inboxSequence++;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { filterTimer = null; void loadInbox(); },delay);
  }
  let previewSequence = 0, alertMarkup = '', ruleMarkup = '', watchlistOptions = '';
  $('rule-evidence').append(...CapstoneTypes.EVIDENCE_FILTERS.map(value=>new Option(CapstoneTypes.evidenceFilterLabel(value),value)));
  CapstoneTypes.addReportTypeOptions($('rule-report-type'));
  const geographyNames = new Map();
  const sourcePicker = $('rule-platform');
  const platformOptions = new Set([...sourcePicker.options].map(option=>option.value));
  const sourceNames = new Map();
  function setRuleSource(platform, collector) {
    const value = collector || platform || 'all';
    if (collector && ![...sourcePicker.options].some(option=>option.value===collector)) {
      sourcePicker.add(new Option(sourceNames.get(collector) || collector,collector));
    }
    sourcePicker.value = value;
  }
  function suggestRuleName() {
    if ($('rule-name').value || editing) return;
    const name = geographyNames.get('province:'+$('rule-province').value) || geographyNames.get('state:'+$('rule-state').value) ||
      geographyNames.get('country:'+$('rule-country').value) || sourceNames.get(sourcePicker.value);
    if (name) $('rule-name').value = name + ' alerts';
  }
  async function loadCollectors() {
    try {
      const {feeds} = await api('/api/health');
      const groups = new Map();
      for (const feed of feeds.sort((a,b)=>a.name.localeCompare(b.name))) {
        sourceNames.set(feed.id,feed.name);
        const group = Capstone.collectorGroup(feed);
        if (!groups.has(group)) groups.set(group,[]);
        groups.get(group).push(feed);
      }
      const current = sourcePicker.value;
      for (const option of [...sourcePicker.options]) if (!platformOptions.has(option.value)) option.remove();
      for (const [key,label] of Object.entries(Capstone.collectorGroups)) {
        if (!groups.has(key)) continue;
        const options = document.createElement('optgroup');
        options.label = label;
        options.append(...groups.get(key).map(feed=>new Option(feed.name,feed.id)));
        sourcePicker.append(options);
      }
      setRuleSource(platformOptions.has(current) ? current : 'all',platformOptions.has(current) ? '' : current);
      suggestRuleName();
      render();
    } catch { /* Platform filters and existing collector rules remain usable. */ }
  }
  function setRuleLocation(key,value) {
    const picker=$('rule-'+key);
    if (value && ![...picker.options].some(option=>option.value===value)) picker.add(new Option(value,value));
    picker.value=value || '';
  }
  function setGeography() {
    return api('/api/geography').then(geography=>{
      for (const [key,values] of [['state',geography.states],['country',geography.countries],['province',geography.provinces]]) {
        const picker = $('rule-'+key);
        const current = picker.value;
        const fallback = key==='state' ? [new Option('Any state',''),new Option('All U.S. states and territories','US')] : [new Option(key==='province'?'Any province':'Any country','')];
        picker.replaceChildren(...fallback);
        for (const {code,name} of values) {
          picker.append(new Option(name,code));
          geographyNames.set(key+':'+code,name);
        }
        setRuleLocation(key,current);
      }
      geographyNames.set('state:US','U.S. states and territories');
      suggestRuleName();
      render();
    }).catch(()=>{});
  }
  function clearPreview() {
    previewSequence++;
    previewReports = [];
    $('preview-rule').disabled = false;
    $('rule-preview').hidden = true;
  }
  function draft() {
    const source = sourcePicker.value;
    const platform = platformOptions.has(source) ? source : 'all';
    return { name: $('rule-name').value,
      terms: $('rule-terms').value.split(/[,\n]/).map(term => term.trim()).filter(Boolean),
      mode: $('rule-mode').value, category: $('rule-category').value, platform, collector: platformOptions.has(source) ? '' : source, evidence: $('rule-evidence').value, reportType:$('rule-report-type').value,state:$('rule-state').value,country:$('rule-country').value,province:$('rule-province').value,
      enabled: $('rule-enabled').checked, notifyRevisions:$('rule-revisions').checked, includeExisting: $('rule-existing').checked };
  }
  $('rule-form').addEventListener('input', clearPreview);
  $('preview-rule').onclick = async () => {
    if (!$('rule-form').reportValidity()) return;
    const sequence = ++previewSequence;
    const status = $('rule-preview-status');
    const list = $('rule-preview-list');
    $('preview-rule').disabled = true;
    $('rule-preview').hidden = false;
    list.replaceChildren();
    status.textContent = 'Checking collected reports…';
    try {
      const data = await api('/api/watch/preview', 'POST', draft());
      if (sequence !== previewSequence) return;
      status.textContent = `${data.matches.toLocaleString()} ${data.matches === 1 ? 'match' : 'matches'} in ${data.limited ? 'the latest ' : ''}${data.scanned.toLocaleString()} collected reports${data.matches > data.previews.length ? ' · Showing six most recent' : ''}`;
      previewReports = data.previews;
      list.innerHTML = previewReports.map(report => `<li><button type="button" class="report-text-button" data-preview-report="${esc(report.id)}">${esc(report.title)}</button><span>${esc(report.source)} · ${esc(report.terms.join(', '))}</span></li>`).join('');
    } catch (error) {
      if (sequence === previewSequence) status.textContent = error.message;
    } finally {
      if (sequence === previewSequence) $('preview-rule').disabled = false;
    }
  };
  $('rule-preview-list').onclick = event => {
    const id = event.target.closest('[data-preview-report]')?.dataset.previewReport;
    const report = previewReports.find(row => row.id === id);
    if (report) void CapstoneReports.open(report);
  };
  function alertTime(stamp, precision) {
    if (!Number.isFinite(Date.parse(stamp))) return 'Unknown';
    const iso = new Date(stamp).toISOString();
    return precision === 'day' ? iso.slice(0,10) + ' · day only' : iso.slice(0,19).replace('T',' ') + ' UTC';
  }
  function render(){
    $('rule-count').textContent=state.rules.length;$('unread-count').textContent=state.unread+' unread';$('read-all').disabled=!state.unread;
    const ruleList = $('rule-list');
    const rules = state.rules.length?state.rules.map(rule=>`<article class="managed-feed" data-rule="${esc(rule.id)}"><div class="managed-feed-top"><h3>${esc(rule.name)}</h3><span class="feed-state ${rule.enabled?'ok':'paused'}">${rule.enabled?'Active':'Paused'}</span></div>${rule.terms.length ? '<p class="watch-terms">'+rule.terms.map(term=>`<span>${esc(term)}</span>`).join('')+'</p>' : ''}<p class="subtle">${rule.terms.length ? (rule.mode==='all'?'Every':'Any')+' keyword · ' : ''} ${esc(rule.category)} desk · ${esc(rule.collector ? sourceNames.get(rule.collector) || rule.collector : rule.platform + ' feeds')}${rule.evidence ? ' · ' + esc(CapstoneTypes.evidenceFilterLabel(rule.evidence)) : ''}${rule.reportType ? ' · ' + esc(CapstoneTypes.label(rule.reportType)) : ''}${rule.country ? ' · ' + esc(geographyNames.get('country:'+rule.country) || rule.country) : ''}${rule.state ? ' · ' + esc(geographyNames.get('state:'+rule.state) || rule.state) : ''}${rule.province ? ' · ' + esc(geographyNames.get('province:'+rule.province) || rule.province) : ''}</p><div class="managed-feed-actions"><button data-rule-action="toggle">${rule.enabled?'Pause':'Enable'}</button><button data-rule-action="edit">Edit</button><button data-rule-action="remove">Remove</button></div></article>`).join(''):'<div class="empty-state">No watchlists yet. Add the subjects you want to follow.</div>';
    if (ruleMarkup !== rules && !ruleList.contains(document.activeElement)) {
      ruleMarkup = rules;
      ruleList.innerHTML = rules;
    }
    const ruleSelect = $('alert-watchlist');
    const selectedRule = ruleSelect.value;
    const options = new Map(inbox?.watchlists.map(rule=>[rule.id,rule.name]) || []);
    for(const rule of state.rules)options.set(rule.id,rule.name);
    const menu = [...options].sort((a, b) => a[1].localeCompare(b[1]));
    const key = JSON.stringify(menu);
    if (key !== watchlistOptions && document.activeElement !== ruleSelect) {
      watchlistOptions = key;
      ruleSelect.replaceChildren(new Option('All watchlists', ''), ...menu.map(([id, name]) => new Option(name, id)));
      if (options.has(selectedRule)) ruleSelect.value = selectedRule;
    }
    if (!inbox || CapstoneReports.isOpen) return;
    const { alerts, total, pageSize } = inbox;
    const pages = Math.max(1,Math.ceil(total / pageSize));
    $('alert-paging').hidden = pages === 1;
    $('alert-prev').disabled = offset === 0;
    $('alert-next').disabled = offset + pageSize >= total;
    $('alert-page').textContent = 'Page ' + (Math.floor(offset / pageSize) + 1) + ' of ' + pages;
    const summary = total ? (offset + 1) + '–' + (offset + alerts.length) + ' of ' + total + ' matching alerts' : '0 matching alerts';
    if ($('alert-filter-summary').textContent !== summary) $('alert-filter-summary').textContent = summary;
    const markup = alerts.length?alerts.map(alert=>`<article class="alert-item${alert.read_at?' read':''}" data-alert="${esc(alert.id)}"><p class="eyebrow">${esc(alert.rule_name)}${alert.read_at?' · READ':' · UNREAD'}</p><h3>${esc(alert.title)}</h3><p class="subtle">${esc(alert.source)} · matched ${esc(alert.terms.join(', '))}${alert.source_revision?' · source revision':alert.backfill?' · existing report':''}</p><p class="subtle">${alert.source_date_basis === 'updated' ? 'Source update' : 'Source date'} ${esc(alertTime(alert.ts,alert.date_precision))} · Match recorded ${esc(alertTime(alert.created))}</p><div class="managed-feed-actions"><button data-alert-action="open" data-event="${esc(alert.event_id)}">Review report</button><a href="/ops?event=${encodeURIComponent(alert.event_id)}&amp;period=720">Show in Operations</a>${/^https?:\/\//i.test(alert.url||'')?`<a href="${esc(alert.url)}" target="_blank" rel="noopener noreferrer">Read source ↗</a>`:''}${!alert.read_at?'<button data-alert-action="read">Mark read</button>':''}</div></article>`).join(''):'<div class="empty-state">No matching alerts in this view. Your enabled watchlists will check new reports as they arrive.</div>';
    if (alertMarkup !== markup) {
      const focus = document.activeElement?.closest('#alert-list button');
      const focusedAlert = focus?.closest('[data-alert]')?.dataset.alert;
      alertMarkup = markup;
      alertList.innerHTML = markup;
      if (focusedAlert) {
        const element = alertList.querySelector('[data-alert="' + CSS.escape(focusedAlert) + '"] button[data-alert-action="' + CSS.escape(focus.dataset.alertAction) + '"]');
        (element || $('alert-search')).focus({preventScroll:true});
      }
    }
  }
  for (const id of ['alert-list', 'rule-list', 'alert-watchlist']) $(id).addEventListener('focusout', () => setTimeout(render, 0));
  async function load() {
    try {
      state = await api('/api/watch');
      inboxVersion = watchVersion(state);
      render();
      await loadInbox();
    } catch (error) { $('rule-message').textContent = error.message; }
  }
  $('rule-form').onsubmit=async event=>{event.preventDefault();$('save-rule').disabled=true;try{const body=draft();await api('/api/watch/rules'+(editing?'/'+editing:''),editing?'PATCH':'POST',body);reset();$('rule-message').textContent='Watchlist saved. Matching reports appear in your inbox.';await load();}catch(error){$('rule-message').textContent=error.message;}finally{$('save-rule').disabled=false;}};
  $('cancel-rule').onclick=reset;
  $('alert-search').oninput = () => changeInbox(250);
  for (const id of ['unread-only','alert-watchlist','alert-age']) $(id).onchange = () => changeInbox();
  $('alert-prev').onclick = () => { offset = Math.max(0,offset - inbox.pageSize); alertList.scrollTop=0; void loadInbox(); };
  $('alert-next').onclick = () => { offset += inbox.pageSize; alertList.scrollTop=0; void loadInbox(); };
  document.addEventListener('report-drawer-close',render);
  const notificationPanel=$('watch-notifications');
  if(location.hash==='#watch-notifications')notificationPanel.open=true;
  $('watch-notification-link').onclick=()=>{notificationPanel.open=true;};
  $('rule-list').onclick=async event=>{const button=event.target.closest('[data-rule-action]'),row=button?.closest('[data-rule]'),rule=state.rules.find(r=>r.id===row?.dataset.rule);if(!rule)return;
    if(button.dataset.ruleAction==='edit'){clearPreview();editing=rule.id;$('rule-name').value=rule.name;$('rule-terms').value=rule.terms.join('\n');$('rule-mode').value=rule.mode;$('rule-category').value=rule.category;setRuleSource(rule.platform,rule.collector);$('rule-evidence').value=rule.evidence||'';$('rule-report-type').value=rule.reportType||'';setRuleLocation('state',rule.state);setRuleLocation('country',rule.country);setRuleLocation('province',rule.province);$('rule-enabled').checked=rule.enabled;$('rule-revisions').checked=Boolean(rule.notifyRevisions);$('rule-existing').checked=false;$('cancel-rule').hidden=false;$('rule-title').textContent='Edit watchlist';$('save-rule').textContent='Save watchlist';$('rule-name').focus();return;}
    button.disabled = true;
    try{if(button.dataset.ruleAction==='toggle')await api('/api/watch/rules/'+rule.id,'PATCH',{enabled:!rule.enabled});else{await api('/api/watch/rules/'+rule.id,'DELETE');if(editing===rule.id)reset();}$('rule-message').textContent=button.dataset.ruleAction==='remove'?'Watchlist removed. Its alert history is retained.':'Watchlist updated.';await load();}catch(error){$('rule-message').textContent=error.message;}
    finally { button.disabled = false; render(); }
  };
  $('alert-list').onclick=async event=>{
    const button=event.target.closest('[data-alert-action]'),row=button?.closest('[data-alert]');
    if(!row)return;
    const alert=inbox?.alerts.find(candidate=>candidate.id===row.dataset.alert);
    if(!alert)return;
    button.disabled=true;
    try {
      if(button.dataset.alertAction==='open'){
        const exists = await CapstoneReports.open({id:alert.event_id,title:alert.title,source:alert.source,ts:alert.ts,date_precision:alert.date_precision,url:alert.url,alertRevision:alert.source_revision});
        if(!exists)return;
      }
      await api('/api/watch/alerts/'+encodeURIComponent(alert.id),'PATCH',{});
      await load();
    }catch(error){$('alert-filter-summary').textContent=error.message;}
    finally{button.disabled=false;}
  };
  $('read-all').onclick=async()=>{try{await api('/api/watch/read-all','POST',{});await load();}catch(error){$('rule-message').textContent=error.message;}};
  function renderNotify(s){
    $('notify-state').textContent=!s.available?'Desktop app only':s.enabled?'On':'Off';
    $('notify-enabled').checked=s.enabled;$('notify-severe').checked=s.severe;$('notify-elevated').checked=s.elevated;$('notify-watch').checked=s.watch;$('notify-stories').checked=s.stories;$('notify-feeds').checked=s.feeds;$('notify-quiet-start').value=s.quietStart;$('notify-quiet-end').value=s.quietEnd;
    $('notify-test').disabled=!s.available;if(!s.available)$('notify-message').textContent='Windows notifications appear when you run the Capstone Viewer desktop app. Settings saved here apply there too.';
  }
  $('notify-form').onsubmit=async event=>{event.preventDefault();$('notify-save').disabled=true;try{renderNotify(await api('/api/notifications','PUT',{enabled:$('notify-enabled').checked,severe:$('notify-severe').checked,elevated:$('notify-elevated').checked,watch:$('notify-watch').checked,stories:$('notify-stories').checked,feeds:$('notify-feeds').checked,quietStart:$('notify-quiet-start').value,quietEnd:$('notify-quiet-end').value}));$('notify-message').textContent='Notification settings saved.';}catch(error){$('notify-message').textContent=error.message;}finally{$('notify-save').disabled=false;}};
  $('notify-test').onclick=async()=>{try{await api('/api/notifications/test','POST',{});$('notify-message').textContent='Test sent. If nothing appeared, check Windows Settings › System › Notifications for Capstone Viewer and Focus assist.';}catch(error){$('notify-message').textContent=error.message;}};
  api('/api/notifications').then(renderNotify).catch(error=>{$('notify-message').textContent=error.message;});
  subscribe(data => {
    if (!data.watch) return;
    state = data.watch;
    const version = watchVersion(state);
    render();
    if (version === inboxVersion) return;
    inboxVersion = version;
    if (!filterTimer) void loadInbox();
  });
  const suggested = new URLSearchParams(location.search);
  for (const key of ['state','country','province']) {
    const code = suggested.get(key);
    if (/^[A-Z]{2}$/.test(code || '')) setRuleLocation(key,code);
  }
  $('rule-province').onchange=()=>{
    if (!$('rule-province').value) return;
    setRuleLocation('country','CA');
    setRuleLocation('state','');
  };
  $('rule-state').onchange=()=>{if ($('rule-state').value && $('rule-province').value) {
    setRuleLocation('country',''); setRuleLocation('province','');
  }};
  $('rule-country').onchange=()=>{if ($('rule-country').value!=='CA') setRuleLocation('province','');};
  const collector = suggested.get('feed');
  const platform = suggested.get('platform');
  if (/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(collector || '') && !platformOptions.has(collector)) setRuleSource('all',collector);
  else if (platformOptions.has(platform)) setRuleSource(platform);
  const reportType = suggested.get('reportType');
  if (CapstoneTypes.ORDER.includes(reportType)) $('rule-report-type').value=reportType;
  const evidence = suggested.get('evidence');
  if (CapstoneTypes.EVIDENCE_FILTERS.includes(evidence)) $('rule-evidence').value=evidence;
  if (['cyber','geo','ai'].includes(suggested.get('category'))) $('rule-category').value=suggested.get('category');
  void setGeography();
  void loadCollectors();
  void load();
})();

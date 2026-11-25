(() => {
 const {esc,api,subscribe,onConnection,read,save,channel}=Capstone,$=id=>document.getElementById(id),fields=['search','category','source','days','tag','order','cve','basis','from','through'];let offset=0,result=null,request=0,editing=null,filterTimer,updateTimer,resultKey='';
 const initialUrl = new URLSearchParams(location.search);
 let savedOnly = initialUrl.get('scope') === 'saved';
 let feedId = /^[a-z0-9_-]{1,80}$/i.test(initialUrl.get('feed') || '') ? initialUrl.get('feed') : '';
 let collector = (initialUrl.get('collector') || '').slice(0,100);
 function external(url){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
 $('history-filters').insertAdjacentHTML('beforeend','<label>Source role<select id="history-role"><option value="">All roles</option>'+['publisher','researcher','vendor','relay','official','measurement','unknown'].map(r=>`<option value="${r}">${r}</option>`).join('')+'</select></label><label>Coverage<select id="history-view"><option value="grouped">Group repeated coverage</option><option value="reports">Every report</option></select></label><label><input type="checkbox" id="history-muted"> Include muted</label>');
 $('history-filters').insertAdjacentHTML('beforeend', '<label>Evidence type<select id="history-evidence"><option value="">All evidence types</option>' + CapstoneTypes.EVIDENCE_FILTERS.map(value => `<option value="${esc(value)}">${esc(CapstoneTypes.evidenceFilterLabel(value))}</option>`).join('') + '</select></label>');
 $('history-filters').insertAdjacentHTML('beforeend', '<label>Report type<select id="history-type"><option value="">All report types</option></select></label>');
 CapstoneTypes.addReportTypeOptions($('history-type'));
 $('history-filters').insertAdjacentHTML('beforeend', '<label>Exact CVE<input id="history-cve" type="search" placeholder="CVE-2026-12345" maxlength="32" pattern="[Cc][Vv][Ee]-[0-9]{4}-[0-9]{4,}" title="Use a complete CVE identifier"></label>');
 $('history-filters').insertAdjacentHTML('beforeend', '<label>Timeline date<select id="history-basis"><option value="source">Source date</option><option value="received">First received</option></select></label>');
 $('history-filters').insertAdjacentHTML('beforeend', '<label>Feed type<select id="history-platform"><option value="">All feed types</option><option value="core">Core feeds</option><option value="telegram">Telegram</option><option value="x">X</option><option value="bluesky">Bluesky</option><option value="mastodon">Mastodon</option></select></label>');
 $('history-filters').insertAdjacentHTML('beforeend','<label>U.S. state or territory<select id="history-state"><option value="">Anywhere</option><option value="US">All U.S. states and territories</option></select></label>');
 $('history-filters').insertAdjacentHTML('beforeend','<label>Country or territory<select id="history-country"><option value="">Anywhere</option></select></label><label>Canadian province or territory<select id="history-province"><option value="">Any province</option></select></label>');
 const reviewLabels = {pending:'Awaiting review', 'needs-review':'Needs re-review', confirmed:'Confirmed by analyst', contradicted:'Contradicted by analyst', unverified:'Reviewed as unverified'};
 $('history-filters').insertAdjacentHTML('beforeend', '<label>Analyst review<select id="history-review"><option value="">Any review status</option>' + Object.entries(reviewLabels).map(([id,label]) => `<option value="${id}">${label}</option>`).join('') + '</select></label>');
 $('history-filters').append($('history-clear'));fields.push('role','view','evidence','review','type','platform','state','country','province');let readingDirty=false;

 const filters = $('history-filters');
 const briefDialog = $('history-brief-dialog');
 const briefSelected = new Set();
 const briefLimit = 20;
 let briefRequest = 0, briefReports = [], briefCreated, briefUnavailable;
 function updateBriefControls(message = '') {
   $('history-brief-actions').hidden = !savedOnly;
   $('history-build-brief').disabled = briefSelected.size === 0;
   $('history-clear-brief').hidden = briefSelected.size === 0;
   const count = $('history-brief-count');
   const summary = message || (briefSelected.size ?
     briefSelected.size + ' of ' + briefLimit + ' selected' :
     'Select reports to include in a briefing.');
   if (count.textContent !== summary) count.textContent = summary;
 }
 function briefingCheckbox(report) {
   if (!savedOnly) return '';
   return `<label class="history-brief-select"><input type="checkbox" data-brief-report="${esc(report.id)}"
     aria-label="Select for briefing · ${esc(report.title)}"${briefSelected.has(report.id) ? ' checked' : ''}> Include in briefing</label>`;
 }
 function previewBriefing() {
   const preview = $('history-brief-preview');
   preview.value = CapstoneEvidenceBrief.format(briefReports, {
     created:briefCreated,
     assessments:$('brief-include-assessments').checked,
     notes:$('brief-include-notes').checked
   });
   $('history-brief-status').textContent = briefUnavailable ?
     briefUnavailable + (briefUnavailable === 1 ? ' selected report is unavailable.' : ' selected reports are unavailable.') : '';
 }
 $('history-list').addEventListener('change', event => {
   const input = event.target.closest('[data-brief-report]');
   if (!input) return;
   if (input.checked && briefSelected.size >= briefLimit) {
     input.checked = false;
     updateBriefControls('The briefing limit is ' + briefLimit + ' reports.');
     return;
   }
   if (input.checked) briefSelected.add(input.dataset.briefReport);
   else briefSelected.delete(input.dataset.briefReport);
   updateBriefControls();
 });
 $('history-clear-brief').onclick = () => {
   briefSelected.clear();
   for (const input of $('history-list').querySelectorAll('[data-brief-report]:checked')) input.checked = false;
   updateBriefControls();
   $('history-saved').focus();
 };
 $('history-build-brief').onclick = async () => {
   const request = ++briefRequest;
   const options = $('history-brief-options');
   const status = $('history-brief-status');
   options.hidden = true;
   $('history-copy-brief').disabled = true;
   $('brief-include-assessments').checked = $('brief-include-notes').checked = false;
   status.textContent = 'Loading selected reports…';
   briefDialog.showModal();
   const selected = [...briefSelected];
   const results = await Promise.allSettled(selected.map(id => api('/api/reports/' + encodeURIComponent(id))));
   if (request !== briefRequest || !briefDialog.open) return;
   briefReports = results.flatMap(result => result.status === 'fulfilled' && result.value.saved_at ? [result.value] : []);
   briefReports.sort((a,b) => b.ts.localeCompare(a.ts) || a.id.localeCompare(b.id));
   briefUnavailable = selected.length - briefReports.length;
   if (!briefReports.length) {
     status.textContent = 'The selected reports are unavailable. Close this window and try again.';
     return;
   }
   briefCreated = new Date();
   options.hidden = false;
   $('history-copy-brief').disabled = false;
   previewBriefing();
 };
 $('brief-include-assessments').onchange = $('brief-include-notes').onchange = previewBriefing;
 $('history-close-brief').onclick = () => briefDialog.close();
 briefDialog.addEventListener('close', () => {
   briefRequest++;
   briefReports = [];
   $('history-brief-preview').value = '';
 });
 $('history-copy-brief').onclick = async () => {
   const preview = $('history-brief-preview');
   const request = briefRequest;
   try {
     await navigator.clipboard.writeText(preview.value);
     if (request === briefRequest && briefDialog.open) $('history-brief-status').textContent = 'Briefing copied.';
   } catch {
     if (request !== briefRequest || !briefDialog.open) return;
     preview.focus();
     preview.select();
     $('history-brief-status').textContent = 'Briefing selected. Use your copy shortcut.';
   }
 };
 function updateScope() {
   updateBriefControls();
   $('history-recent').setAttribute('aria-pressed', String(!savedOnly));
   $('history-saved').setAttribute('aria-pressed', String(savedOnly));
   $('history-days').options[0].textContent = savedOnly ? 'Any date' : 'Last 30 days';
   $('history-muted').disabled = savedOnly;
   $('history-muted').closest('label').hidden = savedOnly;
 }
 let compact = read('capstone-timeline-compact',false) === true;
 function setDensity() {
   $('history-list').classList.toggle('history-compact',compact);
   $('history-density').setAttribute('aria-pressed',String(compact));
 }
 $('history-density').onclick = () => { compact = !compact; save('capstone-timeline-compact',compact); setDensity(); };
 setDensity();
 const primary = document.createElement('div');
 primary.className = 'history-primary';
 const advanced = document.createElement('details');
 advanced.className = 'history-more';
 advanced.innerHTML = '<summary>More filters <span id="history-extra-count" class="count" hidden></span></summary><div class="history-extra"></div>';
 for (const key of ['search', 'category', 'days', 'evidence', 'review']) primary.append($('history-'+key).closest('label'));
 for (const key of ['country', 'state', 'basis', 'cve', 'source', 'platform', 'tag', 'type', 'role', 'order', 'view', 'muted']) advanced.lastElementChild.append($('history-'+key).closest('label'));
 const rangeFields = document.createElement('div');
 rangeFields.className = 'history-range';
 rangeFields.setAttribute('role','group');
 rangeFields.setAttribute('aria-label','UTC date range');
 rangeFields.innerHTML = '<label>From (UTC)<input type="date" id="history-from" max="9999-12-31" aria-describedby="history-range-help"></label><label>Through (UTC)<input type="date" id="history-through" max="9999-12-31" aria-describedby="history-range-help"></label><p id="history-range-help" class="subtle">Dates are inclusive. Enter one date to leave the other end open.</p>';
 const controls = document.createElement('div');
 controls.className = 'history-filter-actions';
 controls.append(advanced,$('history-clear'),$('history-copy-view'),$('history-map-view'));
 const activeFilters = document.createElement('div');
 activeFilters.className = 'history-active-filters';
 activeFilters.setAttribute('role', 'group');
 activeFilters.setAttribute('aria-label', 'Active filters');
 activeFilters.hidden = true;
 filters.append(primary, rangeFields, controls, activeFilters, $('history-copy-status'));

 const presets = [
   { label: 'Official sources', field: 'evidence', value: 'Official' },
   { label: 'Source measurements', field: 'evidence', value: 'Measured' },
   { label: 'Needs re-review', field: 'review', value: 'needs-review' }
 ];
 const shortcuts = document.createElement('div');
 shortcuts.className = 'history-shortcuts';
 shortcuts.setAttribute('role', 'group');
 shortcuts.setAttribute('aria-label','Quick filters');
 for (const preset of presets) {
   const button = document.createElement('button');
   button.type = 'button';
   button.textContent = preset.label;
   button.setAttribute('aria-pressed', 'false');
   button.onclick = () => {
     const select = $('history-'+preset.field);
     select.value = select.value === preset.value ? '' : preset.value;
     select.dispatchEvent(new Event('change', { bubbles:true }));
   };
   preset.control = button;
   shortcuts.append(button);
 }
 filters.prepend(shortcuts);
 function rangeProblem() {
   if ($('history-days').value !== 'range') return '';
   const from = $('history-from');
   const through = $('history-through');
   if (!from.validity.valid || !through.validity.valid) return 'Enter valid UTC dates.';
   if (!from.value && !through.value) return 'Enter a start or end date.';
   if (from.value && through.value && from.value > through.value) return 'Choose an end date on or after the start.';
   return '';
 }
 function syncRange() {
   rangeFields.hidden = $('history-days').value !== 'range';
   const problem = rangeProblem();
   $('history-copy-view').disabled = Boolean(problem);
   $('history-save-view').disabled = Boolean(problem);
   return problem;
 }
 function updateFilterSummary() {
   $('history-description').textContent = $('history-days').value === 'active' ?
     'Weather and transportation notices still present in recent successful polls. Dates and times are in UTC.' : savedOnly ?
       'Reports you keep on this device, including their notes and collection history. Dates and times are in UTC.' :
       'Search reports from the last 30 days. Dates and times are in UTC.';
   updateScope();
   for (const preset of presets) preset.control.setAttribute('aria-pressed',String($('history-'+preset.field).value===preset.value));
   renderSavedViews();
   const parameters = viewUrl().searchParams;
   const mapLink = $('history-map-view');
   const region = ['province','state','country'].find(key=>parameters.has(key));
   mapLink.hidden = !region;
   if (region) {
     const period = {active:'active',today:'today','1h':'1','6h':'6','1':'24','7':'168','30':'720'}[parameters.get('days') || '30'] || '168';
     const mapView = new URLSearchParams({[region]:parameters.get(region),period});
     for (const key of ['category','evidence','type','q','basis','includeMuted']) {
       if (parameters.has(key)) mapView.set(key,parameters.get(key));
     }
     const source = parameters.get('feed') || parameters.get('platform');
     if (source) mapView.set('source',source);
     mapLink.href='/ops?'+mapView;
   }
   const extra = ['country','state','province','basis','cve','source','platform','tag','role','type','order','view','includeMuted'].filter(key=>parameters.has(key)).length;
   const badge = $('history-extra-count');
   badge.hidden = extra === 0;
   badge.textContent = extra + ' active';
   const chips = [...parameters.entries()].filter(([key]) => !['scope','collector','from','through'].includes(key)).map(([key,value]) => {
     const selected = $('history-' + key)?.selectedOptions?.[0]?.textContent;
     const start = parameters.get('from');
     const end = parameters.get('through');
     const range = [start ? 'From ' + start : '',end ? 'Through ' + end : ''].filter(Boolean).join(' · ');
     const text = key === 'feed' ? collector || value : key === 'includeMuted' ? 'Include muted' :
       key === 'days' && value === 'range' ? range || 'Date range' : selected || value;
     return `<button type="button" data-clear-filter="${esc(key)}" aria-label="Remove filter ${esc(text)}">${esc(text)} <span aria-hidden="true">×</span></button>`;
   }).join('');
   if (activeFilters.innerHTML !== chips) activeFilters.innerHTML = chips;
   activeFilters.hidden = !chips;
 }

 $('history-filters').insertAdjacentHTML('beforebegin','<details class="panel reading-panel"><summary>Noise controls and source context</summary><div class="dev-detail-body"><p class="subtle">Roles describe the source, not the truth of its posts. Mutes hide matching reports from Operations and this timeline. Collection, status calculations and alerts continue. Include muted to inspect hidden reports.</p><div id="reading-sources"></div><form id="reading-form"><label for="reading-subjects">Muted subjects, one literal phrase per line</label><textarea id="reading-subjects" rows="3" maxlength="10000" placeholder="Example: product giveaway"></textarea><p class="subtle">Case-insensitive substring matches in title, summary or tags. Up to 100 phrases. Remove a line to unmute it.</p><button type="submit">Save subject mutes</button></form><p id="reading-message" role="status"></p></div></details>');
 $('reading-subjects').oninput=()=>readingDirty=true;
 const allReports=()=>result?.events.flatMap(e=>[e,...(e.coverage_reports||[])])||[];
 async function changeMutes(fn){try{const current=await api('/api/reading');await api('/api/reading','PUT',fn(current));readingDirty=false;$('reading-message').textContent='Noise controls saved. Collection and alerts continue.';offset=0;await load();}catch(error){$('reading-message').textContent=error.message;}}
 $('reading-form').onsubmit=e=>{e.preventDefault();void changeMutes(s=>({...s,subjects:$('reading-subjects').value.split('\n').map(v=>v.trim()).filter(Boolean)}));};
 $('reading-sources').onclick=e=>{const b=e.target.closest('[data-unmute-source]');if(b)void changeMutes(s=>({...s,sources:s.sources.filter(r=>r.key!==b.dataset.unmuteSource)}));};
 function reportDate(report) {
   const source = report.date_precision === 'day' ? report.ts.slice(0,10) + ' · day only' :
     report.ts.slice(0,19).replace('T',' ') + ' UTC';
   const sourceLabel = report.source_date_basis === 'updated' ? 'Source update' :
     report.source_date_basis === 'activation' ? 'Mapping activation' :
     report.source_date_basis === 'catalog_observation' ? 'Catalog observation' :
     report.source_date_basis === 'catalog_created' ? 'Catalog entry created' : 'Source date';
   if (!report.first_received) return '<time title="' + sourceLabel + '">' + esc(source) + '</time>';
   const received = report.first_received.slice(0,19).replace('T',' ') + ' UTC';
   return '<span class="history-date-pair"><time datetime="' + esc(report.first_received) + '">Received ' +
     esc(received) + '</time><small>' + sourceLabel + ' · ' + esc(source) + '</small></span>';
 }
 function stateLinks(report) {
   const codes = report.state_codes || [];
   if (!codes.length && !report.country_code && !report.province_code) return '';
   const region = report.province_code ? 'province' : codes.length ? 'state' : 'country';
   const visibleCodes = report.province_code ? [report.province_code] : codes.length ? codes : [report.country_code];
   const choices = [...$('history-'+region).options];
   const links = visibleCodes.map(code=>{
     const url = viewUrl();
     if (region==='province') {
       url.searchParams.delete('state');
       url.searchParams.set('country','CA');
     } else if (region==='state' || code!=='CA') url.searchParams.delete('province');
     url.searchParams.set(region,code);
     const name = choices.find(option=>option.value===code)?.textContent || code;
     return '<a href="' + esc(url.pathname+url.search) + '">' + esc(name) + '</a>';
   });
   const basis = report.province_basis || report.state_basis || report.country_basis;
   const label = {source_coverage:'Areas named by source',source_origin:'Origin named by source',source_location:'Location named by source',airport_reference:'Airport reference point',
     country_reference:'Approximate country context',catalog_point:'Source catalog location',source_country:'Country named by source',reported_point:'Reported point'}[basis];
   return '<p class="history-state-links subtle">' + label +
     ' · ' + links.join(' · ') + '</p>';
 }
 function card(e){const url=external(e.url),d=CapstoneTypes.describe(e),reference=CapstoneTypes.sourceReference(e);return `<article class="panel history-event sev-${d.severity}${d.chatter?' chatter':''}" data-timeline-row="${esc(e.id)}"><div class="history-meta"><span><span class="etype" style="--tone:var(--${d.tone});--tone-text:var(--${d.tone}-text,var(--${d.tone}))"><b aria-hidden="true">${d.glyph}</b> ${esc(d.label)}</span><span class="evidence ev-${esc(d.evidence.toLowerCase().replace(/[^a-z]+/g,'-'))}">${esc(d.evidence)}</span> · ${esc(e.category==='geo'?'WORLD':e.category==='ai'?'AI & ROBOTICS':'CYBER')} · ${esc(e.source)} · ${esc(e.source_context?.role||'unknown')}${e.muted?' · MUTED':''}${e.saved_at?'<span class="history-saved-marker">Saved</span>':''}${e.review&&e.review!=='pending'?` <span class="evidence">${esc(reviewLabels[e.review])}</span>`:''}</span>${reportDate(e)}</div>${stateLinks(e)}<h2>${reference?`<button class="report-text-button" data-open-report="${esc(e.id)}" type="button">${esc(e.title)}</button>`:url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)} ↗</a>`:esc(e.title)}</h2>${e.outage_state==='stale'?'<p class="status-gap-note">Last received as ongoing. Current state unknown.</p>':''}<p class="history-excerpt">${esc(e.summary||'')}</p><p class="subtle history-source-context">${esc(e.confidence||'')} · ${esc(e.source_context?.basis||'')}</p>${e.coverage_basis?`<p class="coverage-note">${e.coverage_count} report${e.coverage_count===1?'':'s'} · ${esc(e.coverage_basis)}. Repetition does not establish independent evidence.</p>`:''}<div class="event-tags">${e.tags.map(t=>`<button type="button" data-tag="${esc(t.type+':'+t.label)}">${esc(t.type)}: ${esc(t.label)}</button>`).join('')}<button data-edit-tags="${esc(e.id)}">Edit tags</button></div><div class="history-links">${briefingCheckbox(e)}<button data-open-report="${esc(e.id)}">View details</button><button data-mute-source="${esc(e.id)}">${result.reading.sources.some(s=>s.key===e.source_key)?'Unmute source':'Mute source'}</button>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(reference?'Open '+reference:'Original source')} ↗</a>`:''}${Number.isFinite(e.lat)&&Math.abs(e.lat)<=90&&Number.isFinite(e.lon)&&Math.abs(e.lon)<=180 ? `<a href="/ops?event=${encodeURIComponent(e.id)}&period=720&show=map">View on map</a>` : e.saved_at && Date.parse(e.ts) < Date.now()-30*86400000 ? '' : `<a href="/ops?event=${encodeURIComponent(e.id)}&period=720">View in Operations</a>`}</div>${e.coverage_reports?.length?`<details data-timeline-coverage="${esc(e.id)}"><summary>Inspect all ${e.coverage_count} reports</summary>${e.coverage_reports.map(r=>`<div class="coverage-member"><strong>${esc(r.source)} · ${esc(r.source_context.role)}</strong><p>${esc(r.title)}</p><p>${esc(r.summary||'')}</p><button data-open-report="${esc(r.id)}">Report details & notes</button> ${external(r.url)?`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Original post ↗</a>`:''}</div>`).join('')}</details>`:''}</article>`;}
 function options(id,items,value){const el=$(id),selected=el.value;el.innerHTML=`<option value="">${id==='history-source'?'All sources':'All tags'}</option>`+items.map(item=>`<option value="${esc(value(item))}">${esc(typeof item==='string'?item:item.type+': '+item.label)}</option>`).join('');if(selected&&![...el.options].some(option=>option.value===selected))el.add(new Option(selected,selected));el.value=selected;}
 let pendingReload = false;
 async function load({ automatic = false } = {}) {
   if (CapstoneReports.isOpen || $('tags-dialog').open || (automatic && shouldHold())) {
     if (!automatic) pendingReload = true;
     queued = true;
     updateLiveControls();
     return;
   }
   clearTimeout(updateTimer);
   updateTimer = null;
   pendingReload = false;
   queued = false;
   updateFilterSummary();
   updateLiveControls();
   const seq = ++request;
   const rangeIssue = syncRange();
   if (rangeIssue) {
     result = null;
     $('history-status').textContent = rangeIssue;
     $('history-page').textContent = '';
     for (const key of ['prev','next','csv']) $('history-'+key).disabled = true;
     const list = $('history-list');
     list.replaceChildren();
     list.setAttribute('aria-busy','false');
     return;
   }
   const params = viewUrl().searchParams;
   params.set('offset', offset);
   params.set('view', $('history-view').value);
   const key = params.toString();
   const list = $('history-list');
   list.setAttribute('aria-busy', 'true');
   $('history-csv').disabled = true;
   try {
     const data = await api('/api/timeline?' + key);
     if (seq !== request) return;
     if (automatic && shouldHold()) {
       queued = true;
       updateLiveControls();
       return;
     }
     result = data;
     resultKey = key;
     offset = data.offset;
     const stateControl = $('history-state');
     const selectedState = stateControl.value;
     if (data.states && stateControl.options.length !== data.states.length+2) {
       stateControl.replaceChildren(new Option('Anywhere',''),new Option('All U.S. states and territories','US'),
         ...data.states.map(state=>new Option(state.name,state.code)));
       stateControl.value = selectedState;
       updateFilterSummary();
     }
     const countryControl = $('history-country');
     const selectedCountry = countryControl.value;
     if (data.countries && countryControl.options.length !== data.countries.length+1) {
       countryControl.replaceChildren(new Option('Anywhere',''),
         ...[...data.countries].sort((a,b)=>a.name.localeCompare(b.name)).map(country=>new Option(country.name,country.code)));
       countryControl.value = selectedCountry;
       updateFilterSummary();
     }
     const provinceControl = $('history-province');
     if (data.provinces && provinceControl.options.length!==data.provinces.length+1) {
       const selectedProvince = provinceControl.value;
       provinceControl.replaceChildren(new Option('Any province',''),...data.provinces.map(place=>new Option(place.name,place.code)));
       provinceControl.value=selectedProvince;
       updateFilterSummary();
     }
     options('history-source', data.sources, source => source);
     options('history-tag', data.tags, tag => tag.type + ':' + tag.label);
     const scope = feedId ? (collector || feedId) + ' · ' : '';
     const count = data.total + (data.grouped ?
       (data.total === 1 ? ' coverage group' : ' coverage groups') :
       (data.total === 1 ? ' report' : ' reports'));
     $('history-status').textContent = scope + count +
       (data.grouped ? ' · ' + data.reportTotal + (data.reportTotal === 1 ? ' report' : ' reports') : '') +
       (data.hidden ? ' · ' + data.hidden + ' muted' : '') + (data.basis === 'received' ? ' · By first receipt' : '');
     $('history-page').textContent = 'Page ' + (Math.floor(offset / data.pageSize) + 1) + ' of ' + Math.max(1, Math.ceil(data.total / data.pageSize));
     $('history-prev').disabled = offset === 0;
     $('history-next').disabled = offset + data.pageSize >= data.total;
     const opened = new Set([...list.querySelectorAll('[data-timeline-coverage][open]')].map(item => item.dataset.timelineCoverage));
     const empty = savedOnly && ![...viewUrl().searchParams.keys()].some(key => !['scope','view','order'].includes(key)) ?
       'No saved reports yet. Open any report and choose Save report to keep it here.' :
       data.basis === 'received' ?
         'No matching reports have a recorded first receipt in this period.' :
         params.get('days')==='active' ? 'No current weather or transportation listings match this view. Check collection status in Feeds.' :
         'No reports match. Adjust the filters to see more reports.';
     list.innerHTML = data.events.length ? data.events.map(card).join('') : '<div class="empty-state">' + empty + '</div>';
     for (const detail of list.querySelectorAll('[data-timeline-coverage]')) detail.open = opened.has(detail.dataset.timelineCoverage);
     $('reading-sources').innerHTML = '<p>Muted sources: ' + data.reading.sources.length + '</p>' +
       data.reading.sources.map(source => '<button data-unmute-source="' + esc(source.key) + '">Unmute ' + esc(source.label) + '</button>').join(' ');
     if (!readingDirty) $('reading-subjects').value = data.reading.subjects.join('\n');
   } catch (error) {
     if (seq === request) $('history-status').textContent = 'Could not load timeline. ' + error.message;
   } finally {
     if (seq === request) {
       list.setAttribute('aria-busy', 'false');
       $('history-csv').disabled = !result?.events.length || resultKey !== key;
     }
   }
 }
 activeFilters.addEventListener('click', event => {
   const button = event.target.closest('[data-clear-filter]');
   if (!button) return;
   $('history-search').focus();
   const parameters = viewUrl().searchParams;
   parameters.delete(button.dataset.clearFilter);
   if (button.dataset.clearFilter === 'feed') parameters.delete('collector');
   if (button.dataset.clearFilter === 'days') {
     parameters.delete('from');
     parameters.delete('through');
   }
   loadView(parameters.toString());
 });
 const cvePattern = /^CVE-\d{4}-\d{4,}$/i;
 function applyInitialFilters(params) {
   $('history-search').value = (params.get('q') || params.get('search') || '').slice(0,250);
   for (const field of fields) {
     if (field === 'search') continue;
     const value = (params.get(field) || '').slice(0,220);
     const control = $('history-'+field);
     if (!value) continue;
     if (field === 'from' || field === 'through') {
       if (params.get('days') === 'range' && /^\d{4}-\d{2}-\d{2}$/.test(value)) control.value = value;
       continue;
     }
     if (field === 'cve') {
       if (cvePattern.test(value)) control.value = value.toUpperCase();
       continue;
     }
     if ((['tag','source'].includes(field) || (['state','country','province'].includes(field) && /^[A-Z]{2}$/.test(value))) && ![...control.options].some(option=>option.value===value)) {
       control.add(new Option(value,value));
     }
     if ([...control.options].some(option=>option.value===value)) control.value = value;
   }
   $('history-muted').checked = !savedOnly && params.get('includeMuted') === '1';
   if (savedOnly && !params.has('view')) $('history-view').value = 'reports';
   syncRange();
   advanced.open = ['country','state','province','basis','cve','source','platform','tag','role','type','order','view','includeMuted'].some(field=>params.has(field));
 }
 function viewUrl() {
   const url = new URL('/timeline',location.origin);
   for (const field of fields) {
     if ((field === 'from' || field === 'through') && $('history-days').value !== 'range') continue;
     const control = $('history-'+field);
     const value = control.value.trim();
     const defaultValue = savedOnly && field === 'view' ? 'reports' : control.options?.[0]?.value;
     if (!value || value === defaultValue || (field === 'cve' && !cvePattern.test(value))) continue;
     url.searchParams.set(field==='search'?'q':field,field==='cve'?value.toUpperCase():value);
   }
   if (savedOnly) url.searchParams.set('scope', 'saved');
   if (!savedOnly && $('history-muted').checked) url.searchParams.set('includeMuted','1');
   if (feedId) url.searchParams.set('feed',feedId);
   if (feedId && collector) url.searchParams.set('collector',collector);
   return url;
 }
 $('history-copy-view').onclick = async () => {
   const url = viewUrl();
   try {
     await navigator.clipboard.writeText(url.href);
     $('history-copy-status').textContent = 'View link copied';
   } catch {
     const field = document.createElement('input');
     field.value = url.href;
     field.readOnly = true;
     field.setAttribute('aria-label', 'Timeline view link');
     $('history-copy-status').replaceChildren(field);
     field.select();
   }
 };
 const savedKey = 'capstone-timeline-views';
 const savedMenu = $('history-saved-view');
 const savedDialog = $('history-save-dialog');
 let savedViews = [];
 let savedOptions = '';
 function readViews() {
   const stored = read(savedKey, savedViews);
   return Array.isArray(stored) ? stored.filter(view => view && typeof view.id === 'string' &&
     typeof view.name === 'string' && view.name.length <= 80 &&
     typeof view.query === 'string' && view.query.length <= 8192).slice(0, 30) : [];
 }
 savedViews = readViews();

 function renderSavedViews() {
   const query = viewUrl().search;
   const selected = savedViews.find(view => view.query === query);
   const markup = '<option value="">Choose a saved view</option>' + savedViews.map(view =>
     `<option value="${esc(view.id)}">${esc(view.name)}</option>`).join('');
   if (markup !== savedOptions) {
     savedOptions = markup;
     savedMenu.innerHTML = markup;
   }
   savedMenu.value = selected?.id || '';
   $('history-remove-view').hidden = !selected;
 }

 function loadView(query) {
   clearTimeout(filterTimer);
   filterTimer = null;
   const params = new URLSearchParams(query);
   savedOnly = params.get('scope') === 'saved';
   const feed = params.get('feed') || '';
   feedId = /^[a-z0-9_-]{1,80}$/i.test(feed) ? feed : '';
   collector = (params.get('collector') || '').slice(0, 100);
   filters.reset();
   applyInitialFilters(params);
   offset = 0;
   try { window.history.replaceState(null, '', viewUrl()); } catch {}
   void load();
 }

 savedMenu.onchange = () => {
   const selected = savedViews.find(view => view.id === savedMenu.value);
   if (!selected) return;
   loadView(selected.query);
   $('history-saved-status').textContent = 'Opened ' + selected.name;
 };
 $('history-save-view').onclick = () => {
   $('history-save-form').reset();
   $('history-save-feedback').textContent = '';
   savedDialog.showModal();
   $('history-save-name').focus();
 };
 $('history-save-close').onclick = () => savedDialog.close();
 $('history-save-form').onsubmit = event => {
   event.preventDefault();
   const feedback = $('history-save-feedback');
   const name = $('history-save-name').value.trim();
   const query = viewUrl().search;
   savedViews = readViews();
   if (!name) { feedback.textContent = 'Enter a name for the view.'; return; }
   if (savedViews.length >= 30) { feedback.textContent = 'Remove a view to save another. The limit is 30.'; return; }
   const duplicate = savedViews.find(view => view.name.toLowerCase() === name.toLowerCase() || view.query === query);
   if (duplicate) { feedback.textContent = 'This name or set of filters is already saved as ' + duplicate.name; return; }
   savedViews = [...savedViews, { id: crypto.randomUUID(), name, query }];
   const stored = save(savedKey, savedViews);
   savedDialog.close();
   $('history-saved-status').textContent = stored ? 'Saved ' + name : 'Saved for this session';
   renderSavedViews();
 };
 $('history-remove-view').onclick = () => {
   const id = savedMenu.value;
   savedViews = readViews().filter(view => view.id !== id);
   const stored = save(savedKey, savedViews);
   $('history-saved-status').textContent = stored ? 'Saved view removed' : 'View removed for this session';
   renderSavedViews();
   savedMenu.focus();
 };
 window.addEventListener('storage', event => {
   if (event.key === savedKey || event.key === null) {
     savedViews = read(savedKey, []) || [];
     savedViews = readViews();
     renderSavedViews();
   }
 });

 function csvCell(value) {
   const raw = String(value ?? '');
   const safe = /^[\p{White_Space}\p{Cf}]*[=+\-@]/u.test(raw) || /^[\t\r\n]/.test(raw) ? "'" + raw : raw;
   return '"' + safe.replaceAll('"', '""') + '"';
 }
 $('history-csv').onclick = () => {
   if (!result?.events.length) return;
   const columns = ['Report ID', 'Source date UTC', 'Date basis', 'First published UTC', 'Date precision', 'Title', 'Source', 'Collector',
     'Report type', 'Evidence type', 'Source confidence', 'Analyst assessment', 'Place',
     'Placement basis', 'Original URL', 'Coverage reports','Country or territory','U.S. states or territories','Canadian province or territory','Geography basis'];
   const rows = result.events.map(report => {
     const type = CapstoneTypes.describe(report);
     return [report.id, report.date_precision === 'day' ? report.ts.slice(0, 10) : report.ts, report.source_date_basis || 'reported', report.source_published_at, report.date_precision,
       report.title, report.source, report.feed_id, type.label, type.evidence, report.confidence,
       reviewLabels[report.review], report.place, CapstoneTypes.placement(report), external(report.url),
       report.coverage_count ?? 1,report.country_code,(report.state_codes || []).join(' '),report.province_code,
       report.province_basis || report.state_basis || report.country_basis];
   });
   if (result.basis === 'received') {
     columns.push('First received UTC');
     rows.forEach((row,index)=>row.push(result.events[index].first_received));
   }
   const csv = [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
   const link = document.createElement('a');
   const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
   link.href = url;
   link.download = 'capstone-timeline-' + new Date().toISOString().slice(0, 10) + '-page-' + (Math.floor(result.offset / result.pageSize) + 1) + '.csv';
   document.body.append(link);
   link.click();
   link.remove();
   setTimeout(() => URL.revokeObjectURL(url), 1000);
 };
 applyInitialFilters(initialUrl);

 function scheduleFilter(delay = 0) {
   syncRange();
   offset = 0;
   request++;
   $('history-csv').disabled = true;
   clearTimeout(filterTimer);
   clearTimeout(updateTimer);
   updateTimer = null;
   filterTimer = setTimeout(() => { filterTimer = null; void load(); }, delay);
 }
 $('history-filters').onsubmit = event => { event.preventDefault(); scheduleFilter(); };
 for (const key of fields) $('history-' + key).addEventListener(key === 'search' ? 'input' : 'change', ({target}) => {
   if (key === 'province' && target.value) {
     $('history-country').value = 'CA';
     $('history-state').value = '';
   }
   if (key === 'state' && target.value) {
     $('history-country').value = 'US';
     $('history-province').value = '';
   }
   if (key === 'country') {
     if (target.value !== 'CA') $('history-province').value = '';
     if (target.value !== 'US') $('history-state').value = '';
   }
   scheduleFilter(key === 'search' ? 250 : 0);
 });
 $('history-recent').onclick = () => { if (savedOnly) loadView(''); };
 $('history-saved').onclick = () => { if (!savedOnly) loadView('scope=saved'); };
 $('history-clear').onclick=()=>loadView(savedOnly ? 'scope=saved' : '');$('history-prev').onclick=()=>{offset=Math.max(0,offset-100);void load();};$('history-next').onclick=()=>{offset+=100;void load();};
 $('history-muted').onchange=()=>scheduleFilter();
 $('history-list').addEventListener('click',e=>{const b=e.target.closest('[data-mute-source]');if(!b)return;const r=allReports().find(r=>r.id===b.dataset.muteSource);if(r)void changeMutes(s=>({...s,sources:s.sources.some(v=>v.key===r.source_key)?s.sources.filter(v=>v.key!==r.source_key):[...s.sources,{key:r.source_key,label:r.source}]}));});
 $('history-list').onclick=e=>{const detail=e.target.closest('[data-open-report]');if(detail){const report=allReports().find(r=>r.id===detail.dataset.openReport);if(report){const group=result?.events.find(row=>row.id===report.id||row.coverage_reports?.some(member=>member.id===report.id));void CapstoneReports.open(report,group?.coverage_reports?.length?group.coverage_reports:[report]);}return;}const tag=e.target.closest('[data-tag]');if(tag){$('history-tag').value=tag.dataset.tag;offset=0;void load();return;}const edit=e.target.closest('[data-edit-tags]');if(!edit)return;editing=allReports().find(row=>row.id===edit.dataset.editTags);$('tags-title').textContent=editing.title;$('tags-input').value=editing.tags.map(t=>t.type+': '+t.label).join('\n');$('tags-error').textContent='';$('tags-dialog').showModal();};
 $('tags-close').onclick=()=>$('tags-dialog').close();$('tags-form').onsubmit=async e=>{e.preventDefault();const tags=$('tags-input').value.split('\n').map(s=>s.trim()).filter(Boolean).map(line=>{const match=line.match(/^(country|subject|person|custom)\s*:\s*(.*)$/i);return match?{type:match[1].toLowerCase(),label:match[2]}:{type:'custom',label:line};});try{await api('/api/timeline/'+encodeURIComponent(editing.id)+'/tags','PUT',{tags});$('tags-dialog').close();void load();}catch(error){$('tags-error').textContent=error.message;}};
 document.addEventListener('report-drawer-close',()=>{if(pendingReload)void load();});
 document.addEventListener('report-save-updated', () => { void load(); });
 channel?.addEventListener('message', ({data}) => {
   if (data?.type === 'report-save-updated') void load({automatic: true});
 });

 let first = true;
 let held = false;
 let queued = false;
 function updateLiveControls() {
   const hold = $('history-hold');
   hold.textContent = held ? 'Resume live list' : 'Hold live list';
   hold.setAttribute('aria-pressed', String(held));
   $('history-apply').hidden = !queued;
 }
 $('history-hold').onclick = () => {
   held = !held;
   if (!held && queued) void load();
   updateLiveControls();
 };
 $('history-apply').onclick = () => { void load(); };
 function shouldHold() {
   const list = $('history-list');
   return held || offset > 0 || CapstoneReports.isOpen || $('tags-dialog').open || $('history-save-dialog').open || briefDialog.open ||
     filters.contains(document.activeElement) || list.contains(document.activeElement) || list.querySelector('details[open]');
 }
 subscribe(() => {
   if (first) { first = false; return; }
   if (filterTimer) return;
   if (shouldHold()) { queued = true; updateLiveControls(); return; }
   if (!updateTimer) updateTimer = setTimeout(() => { updateTimer = null; void load({ automatic: true }); }, 500);
 });
 onConnection((ok,last) => {
   $('timeline-connection').textContent = ok ? 'Live updates connected' : last ? 'Reconnecting · last snapshot ' + last.slice(11,16) + ' UTC' : 'Waiting for live updates';
 });
 void load();

})();

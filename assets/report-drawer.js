(() => {
 const {esc,api,channel}=Capstone;let seq=0;
 const dialog=document.createElement('dialog');dialog.className='report-drawer';dialog.setAttribute('aria-labelledby','drawer-title');document.body.append(dialog);
 const safe=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};

 const reviewLabels = { unverified: 'Unverified', confirmed: 'Confirmed', contradicted: 'Contradicted' };
 const utc = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Unknown';
 function versionTime(version) {
   return version.observed ? utc(version.observed) : 'Receipt time unknown';
 }
 function sourceDate(version) {
   const basis = version.source_date_basis === 'updated' ? ' · Source update' :
     version.source_date_basis === 'activation' ? ' · Mapping activation' :
     version.source_date_basis === 'catalog_observation' ? ' · Catalog observation' :
     version.source_date_basis === 'catalog_created' ? ' · Catalog entry created' : '';
   if (version.date_precision === 'day' && version.ts) return version.ts.slice(0, 10) + ' · Day only' + basis;
   return utc(version.ts) + basis;
 }
 function citation(report, version = null) {
   const record = version || report;
   const link = safe(record.url);
   const fingerprint = record.revision || (!version && report.history?.revision);
   return [
     record.title || 'Untitled report',
     (report.source || 'Unknown source') + ' · ' + sourceDate(record),
     link,
     version ? 'Version received · ' + utc(version.observed) :
       report.history ? 'First received · ' + utc(report.history.first_seen) : '',
     fingerprint ? 'Capstone record SHA-256 · ' + fingerprint : ''
   ].filter(Boolean).join('\n');
 }
 async function copyCitation(text, feedback) {
   try {
     await navigator.clipboard.writeText(text);
     if (feedback.isConnected) feedback.textContent = 'Citation copied';
   } catch {
     if (!feedback.isConnected) return;
     const input = document.createElement('textarea');
     input.readOnly = true;
     input.value = text;
     input.rows = 4;
     input.setAttribute('aria-label','Report citation');
     feedback.replaceChildren(input);
     input.focus();
     input.select();
   }
 }
 function compareVersionOptions(history, alertRevision) {
   if (history.versions.length < 2) return '';
   const earlierReview = history.assessment?.needs_review ? history.versions.findIndex((version, index) =>
     index > 0 && version.revision === history.assessment.revision) : -1;
   const matched = alertRevision ? history.versions.findIndex(version=>version.revision===alertRevision) : -1;
   const first = matched > 0 ? matched : earlierReview > 0 ? earlierReview : 1;
   const option = (version, index, selected) => `<option value="${index}" ${selected === index ? 'selected' : ''}>${esc(versionTime(version))} · Version ${history.version_count - index}${index === earlierReview ? ' · Last assessed version' : ''}${index === matched ? ' · Matched alert' : ''}</option>`;
   return `<section class="drawer-version-compare" aria-label="Compare source versions">
     <div class="drawer-version-fields">
       <label>Earlier receipt<select id="drawer-version-earlier">${history.versions.map((version, index) => option(version, index, first)).join('')}</select></label>
       <label>Later receipt<select id="drawer-version-later">${history.versions.map((version, index) => option(version, index, 0)).join('')}</select></label>
     </div>
     <div class="drawer-version-actions">
       <button type="button" id="drawer-copy-earlier">Copy earlier citation</button>
       <button type="button" id="drawer-copy-later">Copy later citation</button>
       <span id="drawer-version-copy-status" class="subtle" role="status"></span>
     </div>
     <div id="drawer-version-diff"></div>
   </section>`;
 }
 function drawerTags(tags) {
   return tags.map(tag => {
     const label = esc(tag.type === 'cve' ? tag.label : tag.type + ': ' + tag.label);
     if (tag.type === 'cve' && /^CVE-\d{4}-\d{4,}$/i.test(tag.label)) {
       return '<a href="/timeline?cve=' + encodeURIComponent(tag.label) + '" target="_blank" rel="noopener" title="Find Timeline reports for this CVE">' + label + ' ↗</a>';
     }
     return '<span>' + label + '</span>';
   }).join('') || '<span>No tags assigned</span>';
 }

 function wireVersionComparison(report) {
   const versions = report.history?.versions || [];
   const earlier = dialog.querySelector('#drawer-version-earlier');
   const later = dialog.querySelector('#drawer-version-later');
   if (!earlier || !later) return;
   const output = dialog.querySelector('#drawer-version-diff');
   const feedback = dialog.querySelector('#drawer-version-copy-status');
   for (const [key,select] of [['earlier',earlier],['later',later]]) {
     dialog.querySelector('#drawer-copy-'+key).onclick = () => {
       const version = versions.at(Number(select.value));
       if (version) void copyCitation(citation(report,version),feedback);
     };
   }
   const state = version => version.ongoing === true ? 'Ongoing in source' : version.ongoing === false ? 'Ended in source' : '';
   const location = version => version.place && version.place_basis && version.place_basis !== 'unlocated' ?
     `${version.place} · ${CapstoneTypes.placement(version)}` : '';
   const fields = [
     ['Title', version => version.title], ['Source excerpt', version => version.summary], ['Source date', sourceDate],
     ['First published by source', version => version.source_published_at ? utc(version.source_published_at) : ''],
     ['Source confidence', version => version.confidence], ['Original URL', version => version.url],
     ['Location context', location], ['Source state', state]
   ];
   function compare() {
     feedback.replaceChildren();
     const previous = Number(earlier.value), current = Number(later.value);
     if (previous <= current) {
       output.innerHTML = '<p class="subtle" role="status">Choose an earlier receipt and a later receipt.</p>';
       return;
     }
     const differences = fields.flatMap(([label, value]) => {
       const before = value(versions[previous]) || '', after = value(versions[current]) || '';
       return before === after ? [] : [[label, before || 'Unavailable', after || 'Unavailable']];
     });
     output.innerHTML = differences.length ? differences.map(([label, before, after]) => `
       <article class="drawer-version-field">
         <h4>${esc(label)}</h4>
         <div class="drawer-version-values"><div><span>Earlier</span><p>${esc(before)}</p></div>
          <div><span>Later</span><p>${esc(after)}</p></div></div>
       </article>`).join('') : '<p class="subtle" role="status">The displayed source fields match across these receipts.</p>';
   }
   earlier.onchange = later.onchange = compare;
   compare();
 }
 function renderEvidence(history, alertRevision) {
   if (!history) return '';
   const review = history.assessment;
   const reference = safe(review?.evidence_url);
   const matched = alertRevision && history.versions.some(version=>version.revision===alertRevision);
   return `<section class="drawer-evidence">
     <h3>Collection history</h3>
     <dl>
       <div><dt>First received</dt><dd>${esc(utc(history.first_seen))}</dd></div>
       <div><dt>Last received</dt><dd>${esc(utc(history.last_seen))}</dd></div>
     </dl>
     ${history.version_count ? `<details ${review?.needs_review || alertRevision ? 'open' : ''}><summary>Source versions (${history.version_count}${history.version_count > 10 ? ', latest 10 shown' : ''})</summary>
       ${alertRevision ? `<p class="subtle">${matched ? 'The version marked Matched alert triggered this watchlist.' : 'The alert matched an earlier version outside the receipts shown here.'}</p>` : ''}
       ${compareVersionOptions(history,alertRevision)}
       ${history.versions.length > 1 ? '<details><summary>Read retained versions</summary>' : ''}<ol>${history.versions.map(version => {
         const link = safe(version.url);
         return `<li><strong>${esc(version.title)}</strong><p class="subtle">Received ${esc(utc(version.observed))} · ${esc(version.confidence || 'Source report')}</p>
           ${version.summary ? `<p>${esc(version.summary)}</p>` : ''}
           ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Source version link ↗</a>` : ''}</li>`;
       }).join('')}</ol>${history.versions.length > 1 ? '</details>' : ''}</details>` : '<p class="subtle">Collection history starts when Capstone receives the report again.</p>'}
     <details ${review ? 'open' : ''}><summary>Analyst assessment</summary>
       <p id="drawer-review-current" class="subtle">${review ? `${esc(reviewLabels[review.decision])} · ${esc(utc(review.reviewed))}${review.needs_review ? ' · Source changed after review' : ''}` : 'Awaiting analyst review'}</p>
       ${reference ? `<p><a id="drawer-review-reference" href="${esc(reference)}" target="_blank" rel="noopener noreferrer">Review evidence ↗</a></p>` : '<p><a id="drawer-review-reference" target="_blank" rel="noopener noreferrer" hidden>Review evidence ↗</a></p>'}
       <form id="drawer-review-form">
         <label>Decision <select name="decision">${Object.entries(reviewLabels).map(([id, label]) => `<option value="${id}"${id === review?.decision && !review.needs_review ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
         <label>Primary-source URL <input name="evidence_url" type="url" maxlength="2000" required value="${esc(reference || '')}"></label>
         <label>Rationale <textarea name="rationale" rows="3" maxlength="2000" required>${esc(review?.rationale || '')}</textarea></label>
         <div class="drawer-note-actions"><span id="drawer-review-status" role="status"></span><button type="submit">Save assessment</button></div>
         <details id="drawer-review-conflict" class="drawer-note-conflict" hidden>
           <summary>Compare with the newer saved assessment</summary>
           <label>Newer saved assessment<textarea rows="5" readonly></textarea></label>
           <button type="button" id="drawer-replace-assessment">Replace the saved assessment with this draft</button>
         </details>
       </form>
     </details>
   </section>`;
 }

 function wireAssessment(report) {
   const form = dialog.querySelector('#drawer-review-form');
   if (!form) return;
   trackDraft(form);
   const endpoint = '/api/reports/' + encodeURIComponent(report.id);
   const button = form.querySelector('button[type="submit"]');
   const feedback = form.querySelector('#drawer-review-status');
   const conflict = form.querySelector('#drawer-review-conflict');
   const replace = form.querySelector('#drawer-replace-assessment');
   let expected = report.history.assessment?.version ?? null;
   let compared;
   replace.onclick = () => {
     expected = compared;
     conflict.hidden = true;
     button.disabled = false;
     form.requestSubmit();
   };
   form.onsubmit = async event => {
     event.preventDefault();
     if (button.disabled) return;
     const values = Object.fromEntries(new FormData(form));
     const submitted = draftValue(form);
     button.disabled = true;
     try {
       const review = await api(endpoint + '/assessment','PUT',{...values,
         revision:report.history.revision,expected_version:expected});
       if (!form.isConnected) return;
       expected = review.version;
       conflict.hidden = true;
       dialog.querySelector('#drawer-review-current').textContent = reviewLabels[review.decision] + ' · ' + utc(review.reviewed);
       const reference = dialog.querySelector('#drawer-review-reference');
       reference.href = review.evidence_url;
       reference.hidden = false;
       drafts.set(form,submitted);
       feedback.textContent = draftValue(form) === submitted ? 'Assessment saved' : 'New assessment edits are unsaved';
     } catch (error) {
       if (!form.isConnected) return;
       feedback.textContent = error.message;
       if (error.status !== 409) return;
       try {
         const latest = await api(endpoint);
         if (!form.isConnected || !latest.history?.assessment) return;
         const assessment = latest.history.assessment;
         compared = assessment.version;
         conflict.querySelector('textarea').value = [
           reviewLabels[assessment.decision] + ' · ' + utc(assessment.reviewed),
           assessment.evidence_url,assessment.rationale
         ].join('\n');
         conflict.hidden = false;
         conflict.open = true;
         replace.disabled = latest.history.revision !== report.history.revision;
         feedback.textContent = replace.disabled ?
           'A newer source version arrived. Reopen the report to review it. Your current draft is still here.' :
           'A newer assessment was saved. Review it below. Your draft is still here.';
       } catch (error) {
         if (form.isConnected) feedback.textContent = 'Could not retrieve the newer assessment. Your draft is still here.';
       }
     } finally {
       button.disabled = !conflict.hidden;
     }
   };
 }
 function wireSavedReport(report) {
   const button = dialog.querySelector('#drawer-save-report');
   const status = dialog.querySelector('#drawer-save-status');
   function setSaved(savedAt) {
     report.saved_at = savedAt;
     button.setAttribute('aria-pressed', String(Boolean(savedAt)));
     status.textContent = savedAt ? 'Saved on this device. Select again to remove.' : '';
   }
   setSaved(report.saved_at);
   button.onclick = async () => {
     button.disabled = true;
     try {
       const {saved_at} = await api('/api/reports/' + encodeURIComponent(report.id) + '/saved', 'PUT', {saved: !report.saved_at});
       if (button.isConnected) {
         setSaved(saved_at);
         if (!saved_at) status.textContent = 'Removed from Saved reports';
       }
       document.dispatchEvent(new Event('report-save-updated'));
       channel?.postMessage({type: 'report-save-updated', id: report.id, saved_at});
     } catch (error) {
       status.textContent = error.message;
     } finally {
       button.disabled = false;
     }
   };
   channel?.addEventListener('message', ({data}) => {
     if (button.isConnected && !button.disabled && data?.type === 'report-save-updated' && data.id === report.id) {
       setSaved(data.saved_at);
     }
   }, {signal: drawerListeners.signal});
 }
 let drawerListeners;
 const drafts = new Map();
 const draftValue = form => JSON.stringify([...new FormData(form)]);
 function trackDraft(form, message) {
   const original = draftValue(form);
   drafts.set(form, original);
   if (message) form.addEventListener('input', () => {
     form.querySelector('[role="status"]').textContent = draftValue(form) !== drafts.get(form) ? message : '';
   });
 }
 function hasDraft() {
   return [...drafts].some(([form, saved]) => draftValue(form) !== saved);
 }
 function tryClose() {
   if (!hasDraft()) {
     dialog.close();
     return;
   }
   const discard = dialog.querySelector('.drawer-discard');
   discard.hidden = false;
   discard.querySelector('[data-drawer-keep]').focus();
 }
 function laterWarnings(report) {
   const replacements = (report.weather_replacements || []).filter(item=>safe(item.url));
   if (!replacements.length) return '';
   const title = report.weather_status ? 'Later flood area notice' : 'Replacement NWS bulletins';
   return '<section class="drawer-related"><h3>'+title+'</h3><p class="subtle">Superseded '+esc(utc(report.weather_replaced_at))+'</p>'+
     replacements.map(item=>'<p><a href="'+esc(item.source_url_scope ? '/ops?event='+encodeURIComponent(item.id)+'&period=720' : safe(item.url))+'" target="_blank" rel="noopener noreferrer">'+esc(item.title)+' ↗</a>'+
       (item.place ? ' · '+esc(item.place) : '')+'</p>').join('')+'</section>';
 }
 function operationsLink(report) {
   if (!['/wall','/kiosk'].includes(location.pathname) || !report.id) return '';
   const href = '/ops?event='+encodeURIComponent(report.id);
   return '<a class="drawer-operations-link" href="'+esc(href)+'" target="_blank" rel="noopener">Open in Operations ↗</a>';
 }
 function seismicDetails(report) {
   const facts = CapstoneTypes.seismicFacts(report);
   return facts.length ? '<dl class="kiosk-facts report-seismic">'+facts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')+'</dl>' : '';
 }
 function sampledArticles(report) {
   if (!CapstoneTypes.isNewsCodingAggregate(report) || !Array.isArray(report.citation_urls)) return '';
   const links = [...new Set(report.citation_urls.map(safe).filter(url=>url && url!==safe(report.url)))];
   return links.length ? `<details class="drawer-evidence"><summary>More sampled articles (${links.length})</summary><ul>${links.map(url=>
     `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(url).hostname)} ↗</a></li>`).join('')}</ul></details>` : '';
 }
 function render(report,related,loaded){drawerListeners?.abort();drawerListeners=new AbortController();drafts.clear();const url=safe(report.url);const reference=CapstoneTypes.sourceReference(report);const sourceLabel=reference?'Open '+reference:report.tracker?'Read coverage via Google News':'Open original report';dialog.innerHTML=`<header class="drawer-heading"><p class="eyebrow">REPORT DETAILS</p><button type="button" data-drawer-close aria-label="Close report details">✕</button><div class="drawer-discard" hidden><p role="status">You have unsaved edits in this report.</p><button type="button" data-drawer-keep>Keep editing</button><button type="button" data-drawer-discard>Discard and close</button></div></header><div class="drawer-content"><p class="history-meta">${esc(report.source)} · ${esc(sourceDate(report))}</p>${report.source_published_at ? `<p class="subtle">First published ${esc(utc(report.source_published_at))}</p>` : ''}<h2 id="drawer-title">${esc(report.title)}</h2><p>${esc(report.summary||'No excerpt supplied by this source.')}</p>${seismicDetails(report)}${sampledArticles(report)}<p class="subtle">${esc(report.confidence||'Source report')}</p>${report.outage_state==='stale'?'<p class="status-gap-note">Last received as ongoing. Current state unknown.</p>':''}${report.place_basis&&report.place_basis!=='unlocated'?`<p class="subtle">Location context: ${esc(report.place)} (${esc(CapstoneTypes.placement(report))})</p>`:''}${report.province_code ? `<p class="subtle">${report.province_basis==='source_coverage'?'Province or territory named by source':'Province or territory of reported point'} · <a href="/timeline?province=${encodeURIComponent(report.province_code)}">${esc(report.province_code)} ↗</a></p>` : ''}${report.state_codes?.length ? `<p class="subtle">${report.state_basis==='source_coverage'?'States or territories named by source':report.state_basis==='source_origin'?'Origin named by source':report.state_basis==='airport_reference'?'State or territory of airport reference point':'State or territory of reported point'} · ${report.state_codes.map(code=>`<a href="/timeline?state=${encodeURIComponent(code)}">${esc(code)} ↗</a>`).join(' · ')}</p>` : ''}<div class="drawer-tags">${drawerTags(report.display_tags||report.tags||[])}</div>${url?`<div class="drawer-source-actions"><a class="drawer-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${sourceLabel} ↗</a><button type="button" id="drawer-copy-citation">Copy citation</button>${operationsLink(report)}<small id="drawer-copy-status" role="status"></small></div>`:''}${loaded && report.saved_at !== undefined ? '<div class="drawer-save-actions"><button type="button" id="drawer-save-report" aria-pressed="false">Save report</button><a href="/timeline?scope=saved" target="_blank" rel="noopener">Saved reports ↗</a><span id="drawer-save-status" class="subtle" role="status"></span></div>' : ''}${related.length>1?`<section class="drawer-related"><h3>Related coverage (${related.length})</h3><p class="subtle">Grouped by similar headlines. Multiple reports do not establish independent corroboration.</p>${related.map(r=>`<p>${safe(r.url)?`<a href="${esc(safe(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.source)}: ${esc(r.title)} ↗</a>`:esc(r.title)}</p>`).join('')}</section>`:''}${laterWarnings(report)}${renderEvidence(report.history,report.alertRevision)}<details class="drawer-tag-editor"><summary>Edit tags</summary><form id="drawer-tags-form"><label for="drawer-tags-input">Tags, one per line</label><textarea id="drawer-tags-input" name="tags" rows="5" maxlength="3600" placeholder="country: Netherlands&#10;subject: Ransomware&#10;person: Name&#10;custom: Follow up">${esc((report.tags||[]).map(t=>t.type+': '+t.label).join('\n'))}</textarea><p class="subtle">Your labels are editable here. Source-context tags stay separate. Use country, subject, person or custom, followed by a colon. Up to 40 labels.</p><div class="drawer-note-actions"><span id="drawer-tag-status" role="status"></span><button type="submit">Save tags</button></div></form></details><form id="drawer-notes-form"><label for="drawer-notes">Your private notes</label><textarea id="drawer-notes" name="note" maxlength="8000" rows="7" placeholder="What matters, questions to follow up, context…">${esc(report.notes?.note||'')}</textarea><div class="drawer-note-actions"><span id="drawer-note-status" role="status">${report.notes?.updated?'Saved on this device':'Stored locally on this device'}</span><button type="submit" class="primary">Save note</button></div><details class="drawer-note-conflict" hidden><summary>Compare with the newer saved note</summary><label>Newer saved note<textarea id="drawer-newer-note" rows="5" readonly></textarea></label><button type="button" id="drawer-replace-note">Replace the saved note with this draft</button></details></form></div>`;
 const copy = dialog.querySelector('#drawer-copy-citation');
 if(copy) copy.onclick = () => void copyCitation(citation(report),dialog.querySelector('#drawer-copy-status'));
 dialog.querySelector('[data-drawer-close]').onclick = tryClose;
 dialog.querySelector('[data-drawer-discard]').onclick = () => dialog.close();
 dialog.querySelector('[data-drawer-keep]').onclick = event => {
   event.target.closest('.drawer-discard').hidden = true;
   const edited = [...drafts].find(([form,saved]) => draftValue(form) !== saved)?.[0];
   if (edited) {
     const section = edited.closest('details');
     if (section) section.open = true;
     edited.querySelector('textarea, input, select')?.focus();
   }
 };
 if (!loaded) {
   dialog.querySelector('.drawer-tag-editor').remove();
   dialog.querySelector('#drawer-notes-form').outerHTML = '<p id="drawer-note-status" class="subtle" role="status">Loading collection history and private notes…</p>';
   return;
 }
 if (report.saved_at !== undefined) wireSavedReport(report);
 wireVersionComparison(report);
 wireAssessment(report);
 const tagsForm = dialog.querySelector('#drawer-tags-form');
 trackDraft(tagsForm, 'Unsaved tag changes');
 tagsForm.onsubmit = async event => {
   event.preventDefault();
   const submitted = draftValue(tagsForm);
   const tags = tagsForm.elements.tags.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
     const match = line.match(/^(country|subject|person|custom)\s*:\s*(.*)$/i);
     return match ? {type:match[1].toLowerCase(),label:match[2]} : {type:'custom',label:line};
   });
   const status = tagsForm.querySelector('[role="status"]');
   const button = tagsForm.querySelector('button');
   button.disabled = true;
   try {
     await api('/api/timeline/' + encodeURIComponent(report.id) + '/tags','PUT',{tags});
     if (!tagsForm.isConnected) return;
     drafts.set(tagsForm, submitted);
     status.textContent = draftValue(tagsForm) === submitted ? 'Tags saved' : 'New tag changes are unsaved';
     const current = await api('/api/reports/' + encodeURIComponent(report.id));
     if (!tagsForm.isConnected) return;
     report.tags = current.tags;
     report.display_tags = current.display_tags;
     dialog.querySelector('.drawer-tags').innerHTML = drawerTags(current.display_tags || current.tags);
     document.dispatchEvent(new CustomEvent('report-tags-updated',{detail:{id:report.id,tags:current.tags}}));
   } catch (error) {
     status.textContent = error.message;
   } finally {
     button.disabled = false;
   }
 };
 const notesForm = dialog.querySelector('#drawer-notes-form');
 trackDraft(notesForm, 'Unsaved note changes');
 let noteRevision = report.notes?.revision ?? null;
 let newerRevision = null;
 const conflict = notesForm.querySelector('.drawer-note-conflict');
 const saveNote = notesForm.querySelector('[type=submit]');
 const replaceNote = notesForm.querySelector('#drawer-replace-note');
 const noteFeedback = notesForm.querySelector('[role="status"]');
 const reportUrl = '/api/reports/' + encodeURIComponent(report.id);
 async function submitNote(expected) {
   const submitted = draftValue(notesForm);
   const note = notesForm.elements.note.value;
   saveNote.disabled = replaceNote.disabled = true;
   try {
     const saved = await api(reportUrl+'/notes','PUT',{note,expected_revision:expected});
     if (!notesForm.isConnected) return;
     noteRevision = saved.revision;
     drafts.set(notesForm,submitted);
     conflict.hidden = true;
     conflict.open = false;
     noteFeedback.textContent = draftValue(notesForm) === submitted ? 'Note saved' : 'New note changes are unsaved';
   } catch (error) {
     if (!notesForm.isConnected) return;
     noteFeedback.textContent = error.message;
     if (error.status === 409) {
       conflict.hidden = true;
       try {
         const newer = await api(reportUrl);
         if (!notesForm.isConnected) return;
         newerRevision = newer.notes.revision;
         conflict.querySelector('textarea').value = newer.notes.note;
         conflict.hidden = false;
         conflict.open = true;
       } catch (loadError) {
         noteFeedback.textContent = 'Could not open the newer note. ' + loadError.message;
       }
     }
   } finally {
     saveNote.disabled = replaceNote.disabled = false;
   }
 }
 notesForm.onsubmit = event => {event.preventDefault();void submitNote(noteRevision);};
 replaceNote.onclick = () => void submitNote(newerRevision);
 }

 dialog.addEventListener('cancel', event => { event.preventDefault(); tryClose(); });
 dialog.addEventListener('close', () => {
   drawerListeners?.abort();
   seq++;
   drafts.clear();
   document.dispatchEvent(new CustomEvent('report-drawer-close'));
 });
 window.addEventListener('beforeunload', event => {
   if (!dialog.open || !hasDraft()) return;
   event.preventDefault();
   event.returnValue = '';
 });

 function showReport(report, related, loaded = true) {
   const id = ++seq;
   render(report, related, loaded);
   if (!dialog.open) dialog.showModal();
   return id;
 }
 window.CapstoneReports={get isOpen(){return dialog.open;},showLoaded(report){showReport(report,[report]);},async open(report,related=[report]){const id=showReport(report,related,false);try{const full=await api('/api/reports/'+encodeURIComponent(report.id));if(id===seq&&dialog.open)render({...full,alertRevision:report.alertRevision,...(['state_media','official_statement'].includes(report.source_type)?{source_type:report.source_type,confidence:report.confidence}:{})},related,true);return id===seq&&dialog.open;}catch(error){if(id===seq)dialog.querySelector('#drawer-note-status').textContent=error.message;return false;}}};
})();

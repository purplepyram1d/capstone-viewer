globalThis.CapstoneStatusDetail = (() => {
  const {esc} = Capstone;
  const statusSources = {
    internet: [['outage', 'Outage reports'], ['routing', 'Routing reports']],
    cyber: [['kev', 'CISA KEV additions'], ['advisory', 'Security advisories']],
    conflict: [['conflict', 'GDELT news coding'], ['news', 'World news']],
    earth: [['weather','Weather bulletins'],['quake','Earthquakes'],['river','Observed flood stages'],['storm','Local storm reports']],
    social: [['post', 'Social posts']]
  };
  function statusEvidence(tileId,openInNewWindow) {
    const links = statusSources[tileId] || [];
    return links.length ? '<div class="status-evidence-links" role="group" aria-label="Review related reports">' +
      links.map(([type, label]) => `<a href="/timeline?type=${type}&amp;days=7"${openInNewWindow ? ' target="_blank" rel="noopener"' : ''}>${label} ↗</a>`).join('') + '</div>' : '';
  }
  function markup(tile,{openInNewWindow=false}={}) {
    const {assessment,coverage,gaps,inputs,rule} = tile;
    const missing = coverage?.missing;
    const paused = coverage?.paused;
    const rows = (inputs || []).map(input=>`<div><dt>${esc(input.label)}</dt><dd>${esc(input.value)}${input.note?`<small>${esc(input.note)}</small>`:''}</dd></div>`).join('');
    return `<p class="status-assessment">${esc(assessment || 'Assessment unavailable')}</p>` +
      (missing?.length ? `<p class="subtle">Inputs awaiting fresh data: ${esc(missing.join(', '))}</p>` : '') +
      (paused?.length ? `<p class="subtle">Paused inputs: ${esc(paused.join(', '))}</p>` : '') +
      (gaps?.length ? `<p class="status-gap-note">Data gap: ${esc(gaps.join(', '))}. Coverage may understate activity.</p>` : '') +
      `<dl class="status-inputs">${rows}</dl><p class="subtle status-rule">${esc(rule)}</p>` + statusEvidence(tile.id,openInNewWindow);
  }
  return {markup};
})();

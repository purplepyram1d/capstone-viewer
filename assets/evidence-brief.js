globalThis.CapstoneEvidenceBrief = (() => {
  function utc(value) {
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0,19).replace('T',' ') + ' UTC' : 'Unknown';
  }
  function link(value) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {}
    return '';
  }
  function reportLines(report, {assessments, notes}) {
    const sourceDate = report.date_precision === 'day' && report.ts ? report.ts.slice(0,10) + ' · Day only' : utc(report.ts);
    const history = report.history;
    const original = link(report.url);
    const reference = CapstoneTypes.sourceReference(report);
    const sourceLabel = reference ? reference[0].toUpperCase()+reference.slice(1) : 'Source URL';
    const evidence = CapstoneTypes.evidence(report);
    const lines = [
      report.title || 'Untitled report',
      'Source · ' + (report.source || 'Unknown'),
      (report.source_date_basis === 'updated' ? 'Source update · ' : 'Source date · ') + sourceDate,
      report.source_published_at ? 'First published · ' + utc(report.source_published_at) : '',
      'Evidence · ' + evidence,
      report.confidence,
      original ? sourceLabel + ' · ' + original : '',
      'First received · ' + utc(history?.first_seen),
      'Last received · ' + utc(history?.last_seen),
      report.outage_state === 'stale' ? 'Last received as ongoing. Current state unknown.' : '',
      report.summary
    ].filter(Boolean);
    const review = history?.assessment;
    if (assessments && review) {
      const label = {confirmed:'Confirmed',contradicted:'Contradicted',unverified:'Unverified'}[review.decision] || 'Recorded';
      lines.push('', 'Analyst assessment · ' + label + ' · ' + utc(review.reviewed));
      if (review.needs_review) lines.push('Needs re-review · The source changed after this assessment.');
      const reference = link(review.evidence_url);
      if (reference) lines.push('Analyst evidence · ' + reference);
      if (review.rationale) lines.push(review.rationale);
    }
    if (notes && report.notes?.note?.trim()) lines.push('', 'Private notes', report.notes.note.trim());
    return lines.join('\n');
  }
  function format(reports, {created = new Date(), assessments = false, notes = false} = {}) {
    const heading = ['CAPSTONE VIEWER EVIDENCE BRIEFING', 'Prepared · ' + utc(created),
      reports.length + (reports.length === 1 ? ' selected report' : ' selected reports')].join('\n');
    return heading + '\n\n' + reports.map(report => reportLines(report,{assessments,notes})).join('\n\n---\n\n') + '\n';
  }
  return { format };
})();

globalThis.CapstoneRegionBrief = (() => {
  const line = value => String(value ?? '').replace(/\s+/g,' ').trim();
  function utc(value, precision) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return 'unknown';
    const iso = new Date(time).toISOString();
    return precision==='day' ? iso.slice(0,10)+' (day only)' : iso.slice(0,16).replace('T',' ')+' UTC';
  }
  function publicUrl(value) {
    try {
      const url = new URL(value);
      return ['http:','https:'].includes(url.protocol) && !url.username && !url.password && !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? url.href : '';
    } catch { return ''; }
  }
  function format({location,period,basis,filters=[],snapshot,connected,collecting,feeds=[],stories,reports=[],now=Date.now()}) {
    const countLabel = (value,noun) => value+' '+noun+(value===1?'':'s');
    const lines = [
      line(location)+' | Capstone area briefing',
      'Prepared '+utc(now),
      'Period: '+line(period)+' | Time basis: '+(basis==='received'?'First received':'Source date'),
      ...(filters.length ? ['Filters: '+filters.map(line).join(' · ')] : []),
      countLabel(reports.length,'matching report')+' across '+stories+' '+(stories===1?'story':'stories')+'.',
      '',
      'Regional feed checks'+(snapshot ? ' as of '+utc(snapshot) : '')
    ];
    if (collecting===false) lines.push('Collection paused.');
    else if (!connected) lines.push('Last known checks. Live connection unavailable.');
    if (!feeds.length) lines.push('No dedicated feed checks are listed for this area.');
    for (const feed of feeds) {
      lines.push('- '+line(feed.name)+' | '+line(feed.label)+
        (feed.lastSuccess ? ' | Last success '+utc(feed.lastSuccess) : ' | No successful poll recorded')+
        ' | '+countLabel(feed.matches,'matching report'));
    }
    lines.push('','Matching reports');
    if (!reports.length) lines.push('No reports match this view.');
    const recent = [...reports].sort((a,b)=>{
      const date = report => basis==='received' ? report.first_received || '' : report.ts;
      return date(b).localeCompare(date(a)) || Number(b.score||0)-Number(a.score||0) || String(a.id).localeCompare(String(b.id));
    });
    for (const report of recent.slice(0,12)) {
      const type = CapstoneTypes.describe(report);
      const reference = CapstoneTypes.sourceReference(report);
      const url = publicUrl(report.url);
      lines.push('- '+line(report.title)+' | '+line(report.source)+' | '+type.evidence,
        '  Source date '+utc(report.ts,report.date_precision)+
          (report.first_received ? ' | First received '+utc(report.first_received) : '')+
          (report.place && report.place_basis!=='unlocated' ? ' | '+line(report.place)+' ('+CapstoneTypes.placement(report)+')' : ''));
      if (url) lines.push('  '+(reference ? 'Source reference' : 'Source')+' '+url);
    }
    if (recent.length>12) lines.push('','Showing 12 of '+recent.length+' matching reports.');
    return lines.join('\n');
  }
  return {format};
})();

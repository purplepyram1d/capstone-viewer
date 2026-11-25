import '../assets/event-types.js';
import '../assets/headline-model.js';

const {sourceReference, matchesEvidence} = globalThis.CapstoneTypes;
const {rank,projectMatchingReports} = globalThis.CapstoneHeadlines;

export function topHeadlinesByDesk(stories, options) {
  const desks = {cyber:[],geo:[],ai:[]};
  for (const story of stories) {
    if (Object.hasOwn(desks,story.category)) desks[story.category].push(story);
  }
  return Object.fromEntries(Object.entries(desks).map(([desk,rows])=>[desk,topHeadlines(rows,options)]));
}

function headlineSet(stories,primary,options) {
  return {
    headlines:topHeadlines(stories,options),
    headlinesByDesk:topHeadlinesByDesk(stories,options),
    primaryHeadlines:{all:topHeadlines(primary,options),...topHeadlinesByDesk(primary,options)}
  };
}

export function headlineViews(stories,{now=Date.now(),includeReport,received=false}={}) {
  const isPrimary = report=>matchesEvidence(report,'primary');
  const isWatched = report=>Boolean(report.watch_matches?.length);
  const readable = includeReport ? stories.map(story=>projectMatchingReports(story,includeReport)).filter(Boolean) : stories;
  const primary = readable.map(story=>projectMatchingReports(story,isPrimary)).filter(Boolean);
  const watched = readable.map(story=>projectMatchingReports(story,isWatched)).filter(Boolean);
  const primaryWatched = watched.map(story=>projectMatchingReports(story,isPrimary)).filter(Boolean);
  const options = {now,received};
  return {
    ...headlineSet(readable,primary,options),
    watchHeadlines:watched.length ? headlineSet(watched,primaryWatched,options) : null
  };
}

export function topHeadlines(stories, options) {
  const {window,selected} = rank(stories,options);
  const rows = selected.map(({ story, classification }) => {
    const report = story.reports?.find(member=>member.id===story.representative_id) || story;
    return {
    representative_id: report.id,
    id: story.id, title: story.title, source: story.source, source_key: story.source_key, category: story.category,
    url: story.url, ts: story.ts, date_precision: story.date_precision, first_ts: story.first_ts || story.ts, score: story.score ?? null,
    report_count: story.report_count || 1, kind: story.kind || null, platform:report.platform, evidence: classification,
    report_ts:report.ts, report_date_precision:report.date_precision, report_source_date_basis:report.source_date_basis,
    first_received:report.first_received,
    ...(options?.received ? {latest_received:story.latest_received || story.first_received} : {}),
    ...(report.watch_matches?.length ? {watch_matches:report.watch_matches} : {}),
    ...(Number.isFinite(story.lat) && Number.isFinite(story.lon) ? {place:story.place,place_basis:story.place_basis} : {}),
    ...(sourceReference(story) || !story.url ? {
      report_id: story.representative_id || story.id, source_url_scope: story.url ? story.source_url_scope || 'archive' : null,
      summary: story.summary, confidence: story.confidence
    } : {})
    };
  });
  return { window_hours: window, rows };
}

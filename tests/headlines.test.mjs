import test from 'node:test';
import assert from 'node:assert/strict';
import { topHeadlines, topHeadlinesByDesk, headlineViews } from '../lib/headlines.mjs';
const now = Date.parse('2026-11-04T15:00:00Z'), ago = minutes => new Date(now - minutes * 60000).toISOString();
const story = (id, minutes, score, patch = {}) => ({ id, title: 'Story ' + id, source: 'Test', category: 'geo', url: 'https://example.org/' + id, ts: ago(minutes), first_ts: ago(minutes), score, ...patch });

test('the past hour is used when it has enough stories, ranked by score', () => {
  const stories = [...Array.from({ length: 9 }, (_, i) => story('h' + i, 10 + i, 50 + i)), story('old', 90, 99)];
  const h = topHeadlines(stories, { now });
  assert.equal(h.window_hours, 1);
  assert.equal(h.rows[0].id, 'h8', 'highest score first');
  assert.ok(!h.rows.some(r => r.id === 'old'), 'older than the window stays out');
  assert.equal(h.rows[0].url, 'https://example.org/h8');
});

test('each kiosk desk ranks its own stories even when mixed headlines are full', () => {
  const geo = Array.from({length:15},(_,i)=>story('world-'+i,i+2,85));
  const cyber = story('only-cyber',180,45,{category:'cyber'});
  const stories = [...geo,cyber];
  assert.ok(!topHeadlines(stories,{now}).rows.some(row=>row.id===cyber.id));
  const desks = topHeadlinesByDesk(stories,{now});
  assert.deepEqual(desks.cyber.rows.map(row=>row.id),[cyber.id]);
  assert.ok(desks.geo.rows.every(row=>row.category==='geo'));
  assert.deepEqual(desks.ai.rows,[]);
});

test('primary-only headline rankings select official and measured reports before applying desk limits',()=>{
  const claims = Array.from({length:15},(_,i)=>story('claim-'+i,i+2,91,{category:'cyber',kind:'claim'}));
  const official = story('official',95,54,{category:'cyber',confidence:'Official advisory'});
  const measured = story('measured',7,45,{kind:'earthquake'});
  const views = headlineViews([...claims,official,measured],{now});
  assert.deepEqual(views.primaryHeadlines.cyber.rows.map(row=>row.id),['official']);
  assert.deepEqual(views.primaryHeadlines.geo.rows.map(row=>row.id),['measured']);
  assert.ok(views.headlinesByDesk.cyber.rows.some(row=>row.id.startsWith('claim-')));
});

test('watched headlines use only matching source reports and preserve primary evidence selection',()=>{
  const outside = Array.from({length:15},(_,i)=>story('unwatched-'+i,i+1,99));
  const lead = story('lead',8,92,{category:'cyber',kind:'advisory',confidence:'Official advisory'});
  const claim = story('claim-watched',9,45,{category:'cyber',kind:'claim',watch_matches:['Example vendor']});
  const primary = story('primary-watched',10,43,{category:'cyber',kind:'advisory',confidence:'Official advisory',watch_matches:['Example vendor']});
  const grouped = {...lead,id:'group',representative_id:lead.id,reports:[lead,claim,primary],watch_matches:['Example vendor']};
  const views = headlineViews([...outside,grouped],{now});
  assert.deepEqual(views.watchHeadlines.headlines.rows.map(row=>row.id),['group']);
  assert.equal(views.watchHeadlines.headlinesByDesk.cyber.rows[0].representative_id,claim.id);
  const trusted = views.watchHeadlines.primaryHeadlines.cyber.rows[0];
  assert.equal(trusted.representative_id,primary.id);
  assert.equal(trusted.url,primary.url);
  assert.deepEqual(trusted.watch_matches,['Example vendor']);
  const muted = headlineViews([grouped],{now,includeReport:report=>report.id!==primary.id});
  assert.deepEqual(muted.watchHeadlines.primaryHeadlines.cyber.rows,[]);
});

test('first-receipt headlines keep the eligible source in a grouped story',()=>{
  const lead = story('unverified-lead',5,90,{category:'cyber',kind:'claim',first_received:ago(5)});
  const source = story('source',72*60,60,{category:'cyber',kind:'advisory',confidence:'Official advisory',first_received:ago(8)});
  const group = {...lead,id:'group',representative_id:lead.id,reports:[lead,source],latest_received:lead.first_received};
  const bySource = headlineViews([group],{now});
  assert.deepEqual(bySource.primaryHeadlines.cyber.rows,[]);
  const byReceipt = headlineViews([group],{now,received:true,includeReport:report=>report.id!==lead.id});
  const [selected] = byReceipt.primaryHeadlines.cyber.rows;
  assert.equal(selected.representative_id,source.id);
  assert.equal(selected.id,group.id);
  assert.equal(selected.report_ts,source.ts);
  assert.equal(selected.first_received,source.first_received);
  assert.equal(selected.latest_received,source.first_received);
});

test('the wall can open the retained report for old routing alerts with generic source links', () => {
  const routing = story('grouped', 5, 90, {
    representative_id:'report-rrc00', source:'RIPE RIS Live', kind:'routing',
    url:'https://ris-live.ripe.net/', summary:'3,000 withdrawals in 5 minutes', confidence:'Measured anomaly'
  });
  const { rows } = topHeadlines([routing, story('direct', 10, 50)], { now });
  assert.equal(rows[0].report_id, 'report-rrc00');
  assert.equal(rows[0].source_url_scope, 'archive');
  assert.equal(rows[0].summary, routing.summary);
  assert.equal(rows[1].report_id, undefined);
  assert.equal(rows[1].url, 'https://example.org/direct');
});

test('a quiet hour widens the window until there are enough stories', () => {
  const stories = [story('a', 20, 40), story('b', 150, 60), ...Array.from({ length: 7 }, (_, i) => story('c' + i, 300 + i, 30))];
  const h = topHeadlines(stories, { now });
  assert.equal(h.window_hours, 6);
  assert.deepEqual(h.rows.slice(0, 2).map(r => r.id), ['b', 'a']);
  assert.equal(topHeadlines([story('x', 20, 40)], { now }).window_hours, 24, 'falls back to a day and returns what there is');
});

test('outages: at most two, and an ongoing outage that began before the window is not news in it', () => {
  const outage = (id, minutes, first) => story(id, minutes, 95, { kind: 'outage', ongoing: true, first_ts: ago(first) });
  const stories = [outage('o1', 5, 30), outage('o2', 6, 40), outage('o3', 7, 50), outage('old-start', 8, 600), ...Array.from({ length: 8 }, (_, i) => story('s' + i, 10 + i, 40))];
  const h = topHeadlines(stories, { now });
  assert.equal(h.window_hours, 1);
  assert.deepEqual(h.rows.filter(r => r.kind === 'outage').map(r => r.id), ['o1', 'o2']);
  assert.ok(!h.rows.some(r => r.id === 'old-start'));
});

test('limit, future timestamps and missing first_ts', () => {
  const stories = [...Array.from({ length: 30 }, (_, i) => story('s' + i, i + 1, 50)), story('future', -60, 99), { ...story('nofirst', 5, 70), first_ts: undefined }];
  const h = topHeadlines(stories, { now, limit: 15 });
  assert.equal(h.rows.length, 15);
  assert.ok(!h.rows.some(r => r.id === 'future'), 'a report dated an hour ahead is ignored');
  assert.equal(h.rows[0].id, 'nofirst'); assert.equal(h.rows[0].first_ts, h.rows[0].ts);
});

test('a second publisher appears even when one source has more high-ranked reports', () => {
  const crowded = Array.from({ length: 15 }, (_, i) => story('first-' + i, i + 1, 90 - i, { source_key:'first' }));
  const different = story('different', 10, 48, { source_key:'second' });
  const ranked = topHeadlines([...crowded, different], { now, min:5, limit:5 });
  assert.equal(ranked.window_hours, 1);
  assert.deepEqual(ranked.rows.map(item => item.id), ['first-0','first-1','first-2','first-3','different']);
});

test('the window widens based on eligible headlines after the cap on unverified reports', () => {
  const claims = Array.from({ length: 10 }, (_, i) => story('claim-' + i, i + 1, 92, { kind:'claim' }));
  const advisory = story('official', 120, 50, { confidence:'Official advisory' });
  const ranked = topHeadlines([...claims, advisory], { now, min:4 });
  assert.equal(ranked.window_hours, 3);
  assert.equal(ranked.rows.filter(item => item.evidence === 'Claim').length, 3);
  assert.equal(ranked.rows.at(-1).evidence, 'Official');
});

test('day-only source records keep their precision and wait for the daily window', () => {
  const dated = story('day-only', 20, 90, { date_precision:'day' });
  const timed = story('timestamp', 15, 60, { date_precision:'timestamp' });
  const hour = topHeadlines([dated, timed], { now, min:1 });
  assert.equal(hour.window_hours, 1);
  assert.deepEqual(hour.rows.map(row => row.id), ['timestamp']);
  const day = topHeadlines([dated, timed], { now, min:2 });
  assert.equal(day.window_hours, 24);
  assert.equal(day.rows.find(row => row.id === 'day-only').date_precision, 'day');
});

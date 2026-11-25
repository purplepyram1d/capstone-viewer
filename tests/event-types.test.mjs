import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
const T = globalThis.CapstoneTypes;

test('each source kind gets its own type, shape and evidence', () => {
  const d = e => { const r = T.describe(e); return [r.id, r.label, r.shape, r.evidence]; };
  assert.deepEqual(d({ kind: 'exploitation', source: 'CISA KEV', feed_id: 'kev', confidence: 'Official catalog · exploitation confirmed', score: 95 }), ['kev', 'KEV · EXPLOITED', 'diamond', 'Official']);
  assert.deepEqual(d({ kind: 'vulnerability', confidence: 'Official vulnerability record · NVD' }), ['cve', 'CRITICAL CVE', 'diamond', 'Official']);
  assert.deepEqual(d({ kind: 'ransomware', confidence: 'Unconfirmed actor claim' }), ['ransomware', 'RANSOMWARE CLAIM', 'triangle', 'Claim']);
  assert.deepEqual(d({ kind: 'claim', claim_type: 'hacktivist', platform: 'bluesky', confidence: 'Unverified actor claim' }), ['claim', 'HACKTIVIST CLAIM', 'triangle', 'Claim']);
  assert.deepEqual(d({ kind: 'outage', confidence: 'Measured anomaly · IODA automated detection' }), ['outage', 'OUTAGE', 'square', 'Measured']);
  assert.deepEqual(d({ kind: 'outage', confidence: 'Operator annotation · Cloudflare Radar' }), ['outage','OUTAGE','square','Provider annotation']);
  assert.deepEqual(d({ kind: 'routing', confidence: 'Automated detection · Cloudflare Radar' }), ['routing','BGP / ROUTING','square','Automated detection']);
  assert.deepEqual(d({ kind: 'conflict', feed_id: 'gdelt', confidence: 'Machine-coded from news (GDELT)' }), ['conflict', 'GDELT NEWS CODING', 'ring', 'Machine-coded']);
  assert.deepEqual(d({ kind: 'report', source: 'CISA advisories', category: 'cyber', confidence: 'Official advisory' }), ['advisory', 'ADVISORY', 'diamond', 'Official']);
  assert.deepEqual(d({ kind: 'report', source: 'BBC World', category: 'geo', confidence: 'Single source report' }), ['news', 'NEWS', 'dot', 'Reported']);
  assert.deepEqual(d({ kind: 'infrastructure', confidence: 'Community threat intelligence · abuse.ch' }), ['malware', 'MALWARE INFRA', 'diamond', 'Community intel']);
});

test('social posts name their platform, and posts with nothing to anchor them are chatter', () => {
  const post = { kind: 'social', platform: 'bluesky', category: 'cyber', confidence: 'Unverified public Bluesky post', cves: [] };
  const r = T.describe(post);
  assert.equal(r.label, 'BLUESKY POST'); assert.equal(r.evidence, 'Unverified'); assert.equal(r.chatter, true);
  assert.equal(T.describe({ ...post, cves: ['CVE-2026-1234'] }).chatter, false);
  assert.equal(T.describe({ ...post, citation_urls: ['https://example.org/a'] }).chatter, false);
  assert.equal(T.describe({ ...post, watch_matches: ['Fortinet'] }).chatter, false);
  assert.equal(T.describe({ kind: 'report', source: 'BBC World', category: 'geo' }).chatter, false, 'news is never chatter');
});

test('only source tags that restate the type are hidden on cards', () => {
  assert.equal(T.restates({ type: 'subject', label: 'Social post', origin: 'source' }), true);
  assert.equal(T.restates({ type: 'subject', label: 'Cyber', origin: 'source' }), true);
  assert.equal(T.restates({ type: 'subject', label: 'hacktivist claim', origin: 'source' }), true);
  assert.equal(T.restates({ type: 'subject', label: 'Cyber', origin: 'manual' }), false, 'your own tags always show');
  assert.equal(T.restates({ type: 'country', label: 'Ukraine', origin: 'source' }), false);
  assert.equal(T.restates({ type: 'cve', label: 'CVE-2026-1234', origin: 'source' }), false);
});

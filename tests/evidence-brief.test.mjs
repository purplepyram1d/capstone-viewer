import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/event-types.js';
import '../assets/evidence-brief.js';

const stamp = '2026-11-23T10:20:30Z';
const report = {
  id:'demo', title:'Fixture official advisory', source:'Fixture agency', ts:stamp,
  date_precision:'day', confidence:'Official advisory', url:'https://example.org/original',
  summary:'Fixture source description.',
  history:{
    first_seen:null, last_seen:stamp,
    assessment:{decision:'unverified',reviewed:stamp,evidence_url:'https://example.org/evidence',rationale:'Analyst only',needs_review:true}
  },
  notes:{note:'Private only'}
};

test('evidence briefing includes source provenance and keeps analyst material out by default', () => {
  const brief = globalThis.CapstoneEvidenceBrief.format([report],{created:stamp});
  assert.match(brief,/CAPSTONE VIEWER EVIDENCE BRIEFING/);
  assert.match(brief,/Prepared · 2026-11-23 10:20:30 UTC/);
  assert.match(brief,/Source date · 2026-11-23 · Day only/);
  assert.match(brief,/Evidence · Official/);
  assert.match(brief,/Source URL · https:\/\/example\.org\/original/);
  assert.match(brief,/First received · Unknown/);
  assert.doesNotMatch(brief,/Analyst only|Private only|example\.org\/evidence/);
});

test('briefing can include notes and stale assessments and labels source updates separately', () => {
  const updated = {...report, date_precision:'timestamp', source_date_basis:'updated',
    source_published_at:'2026-11-20T13:30:00Z', source_url_scope:'archive'};
  const brief = globalThis.CapstoneEvidenceBrief.format([updated],{created:stamp,assessments:true,notes:true});
  assert.match(brief,/Source update · 2026-11-23 10:20:30 UTC/);
  assert.match(brief,/First published · 2026-11-20 13:30:00 UTC/);
  assert.match(brief,/Source archive · https:\/\//);
  assert.match(brief,/Needs re-review/);
  assert.match(brief,/Analyst only/);
  assert.match(brief,/Private only/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { caProvinces, reportProvince } from '../lib/ca-geography.mjs';
import { withReportLocation } from '../lib/geography.mjs';
import { createTimeline } from '../lib/timeline.mjs';
import { matchingTerms, validateRule } from '../lib/intelligence.mjs';

const now = new Date().toISOString();
const base={ts:now,source:'Fixture',title:'A regional report',url:'https://example.org/reference',category:'geo'};
const alert={...base,id:'ontario',country:'CA',province:'ON',kind:'weather_alert',place_basis:'international_weather_area'};
const point={...base,id:'toronto',lat:43.65,lon:-79.38,place_basis:'event_location'};
const national={...base,id:'canada',country:'CA',lat:56,lon:-106,place_basis:'country_centroid'};

test('Canadian geography preserves named coverage and applies boundaries only to eligible coordinates',()=>{
  assert.equal(Object.keys(caProvinces).length,13);
  assert.deepEqual(reportProvince(alert),{code:'ON',basis:'source_coverage'});
  assert.deepEqual(reportProvince(point),{code:'ON',basis:'reported_point'});
  assert.equal(reportProvince({...point,place_basis:'vendor_hq'}),null);
  assert.equal(reportProvince(national),null);
  const location = withReportLocation(point);
  assert.equal(location.country_code,'CA');
  assert.equal(location.province_code,'ON');
  assert.equal(location.state_codes,undefined);
});
test('Timeline and watchlists distinguish provincial, national, and unrelated reporting',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE events(id TEXT PRIMARY KEY, ts TEXT NOT NULL, data TEXT NOT NULL)');
  const insert=db.prepare('INSERT INTO events VALUES (?,?,?)');
  for(const record of [alert,point,national,{...alert,id:'newfoundland',province:'NL'}]) {
    insert.run(record.id,record.ts,JSON.stringify(record));
  }
  const timeline=createTimeline(db);
  const scoped=timeline.list(new URLSearchParams({country:'CA',province:'on'})).events.map(event=>event.id).sort();
  assert.deepEqual(scoped,['ontario','toronto']);
  const rule=validateRule({name:'Ontario warning',province:'ON',reportType:'weather'});
  assert.deepEqual(matchingTerms(rule,alert),['Ontario']);
  assert.deepEqual(matchingTerms(rule,{...alert,province:'BC'}),[]);
  assert.deepEqual(matchingTerms(rule,{...national,kind:'weather_alert'}),[]);
  assert.throws(()=>validateRule({name:'Incompatible places',state:'WA',province:'ON',reportType:'weather'}),/requires a Canada location/);
  db.close();
});
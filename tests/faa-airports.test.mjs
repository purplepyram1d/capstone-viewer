import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFaaAirports, faaAirportReference} from '../lib/faa-airports.mjs';
import {sourceListingUntil} from '../lib/weather-visibility.mjs';
import {withReportLocation} from '../lib/geography.mjs';
import {topHeadlines} from '../lib/headlines.mjs';

const now = Date.parse('2026-11-24T11:36:00Z');
const mi = {airportId:'MBS',airportLongName:'MBS International',latitude:'43.5385',longitude:'-84.0820'};
const from = '2026-11-24T11:08:00Z', revised = '2026-11-24T11:09:38Z', until = '2026-11-25T07:59:59Z';

test('FAA deicing retains precise airport placement and separates start from later source update', () => {
  const deicing = {id:'fixture-1',airportId:'MBS',createdAt:'2026-10-17T12:44:31Z',eventTime:from,updatedAt:revised,expTime:until};
  const [report] = normalizeFaaAirports([{...mi,deicing}],now).map(withReportLocation);
  assert.equal(report.title,'Deicing reported at MBS');
  assert.equal(report.ts,'2026-11-24T11:09:38.000Z');
  assert.equal(report.source_date_basis,'updated');
  assert.equal(report.airport_started_at,'2026-11-24T11:08:00.000Z');
  assert.equal(report.airport_valid_until,'2026-11-25T07:59:59.000Z');
  assert.deepEqual(report.state_codes,['MI']);
  assert.equal(report.state_basis,'airport_reference');
  assert.equal(report.country_code,'US');
  assert.equal(report.place_basis,'airport_reference');
  assert.equal(report.source_url_scope,'live_listing');
  const later = {...deicing, updatedAt:'2026-11-24T11:10:38Z'};
  assert.equal(normalizeFaaAirports([{...mi,deicing:later}],now)[0].id,report.id);
  const nextWindow = {...later, eventTime:'2026-11-24T11:30:00Z',updatedAt:'2026-11-24T11:31:00Z'};
  assert.notEqual(normalizeFaaAirports([{...mi,deicing:nextWindow}],now)[0].id,report.id);
  const rows = topHeadlines([{...report,id:'story-aaa',representative_id:report.id}],{now}).rows;
  assert.equal(rows[0].report_id,report.id);
  assert.equal(rows[0].source_url_scope,'live_listing');
});

test('FAA normalizer distinguishes limited closures, direct advisories and high-impact delays', () => {
  const advisory = 'https://www.fly.faa.gov/adv/adv_otherdis.jsp?advn=001&adv_date=11242026';
  const scope = 'Only unscheduled general aviation arrivals';
  const [scoped, stop, delay] = normalizeFaaAirports([
    {...mi, airportClosure:{airportId:'MBS',id:'closure-1',text:scope,startTime:from,endTime:until}},
    {...mi, groundStop:{airportId:'MBS',id:'stop-1',impactingCondition:'weather',startTime:from,endTime:until,advisoryUrl:advisory}},
    {...mi, arrivalDelay:{airportId:'MBS',id:'delay-1',averageDelay:'45',trend:'increasing',updateTime:revised,advisoryUrl:'https://example.net/adv/adv_otherdis.jsp'}},
    {...mi, departureDelay:{airportId:'MBS',id:'low-delay',averageDelay:15,updateTime:revised}}
  ],now);
  assert.equal(scoped.title,'Airport closure with exceptions at MBS');
  assert.match(scoped.summary,/Only unscheduled general aviation arrivals/);
  assert.equal(scoped.url,faaAirportReference);
  assert.equal(stop.url,advisory);
  assert.equal(stop.source_url_scope,undefined);
  assert.equal(delay.url,faaAirportReference);
  assert.match(delay.summary,/45 min \(increasing\)/);
  assert.equal(delay.airport_valid_until,null);
});

test('FAA normalizer excludes expired and future programs and validates the source envelope', () => {
  const row = {...mi, groundDelay:{startTime:from,endTime:'2026-11-24T11:15:00Z'},
    groundStop:{startTime:'2026-11-24T12:00:00Z',endTime:until},
    airportClosure:{startTime:'2026-10-01T00:00:00Z',endTime:until},
    freeForm:{airportId:'PIT',startTime:from,endTime:until,text:'Mismatched airport'}};
  assert.deepEqual(normalizeFaaAirports([row],now),[]);
  assert.deepEqual(normalizeFaaAirports([],now),[]);
  assert.throws(()=>normalizeFaaAirports([{foo:'bar'}],now),/fields were missing/);
});

test('a report can appear live only when present in a recent successful full poll', () => {
  const feed = {state:'ok', intervalMinutes:5,lastBodyStarted:'2026-11-24T11:30:00Z',lastSuccess:'2026-11-24T11:30:02Z'};
  assert.equal(sourceListingUntil('2026-11-24T11:30:01Z',feed,null,now),'2026-11-24T11:45:02.000Z');
  assert.equal(sourceListingUntil('2026-11-24T11:08:01Z',feed,null,now),null);
  assert.equal(sourceListingUntil('2026-11-24T11:30:01Z',{...feed,state:'error'},null,now),null);
  assert.equal(sourceListingUntil('2026-11-24T11:30:01Z',feed,'2026-11-24T11:33:00Z',now),null);
  assert.equal(sourceListingUntil('2026-11-24T11:30:01Z',feed,null,now+20*60_000),null);
});

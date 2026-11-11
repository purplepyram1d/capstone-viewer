import test from 'node:test';
import assert from 'node:assert/strict';
import { describeOffline, duration } from '../lib/offline.mjs';
const gap=previous=>({from:'2026-10-24T15:00:27Z',to:'2026-10-28T12:22:28Z',minutes:5602,previous});

test('durations read naturally',()=>{
 assert.equal(duration(5602),'3 d 21 h');assert.equal(duration(130),'2 h 10 min');assert.equal(duration(50),'50 min');
});

test('the notice explains the gap and how the previous session ended',()=>{
 const unclean=describeOffline(gap({known:true,clean:false,lastEvent:'tray',lastEventAt:'2026-10-24T14:54:57Z',lastAlive:'2026-10-24T15:00:10Z'}));
 assert.equal(unclean.title,'Capstone was offline for 3 d 21 h');assert.match(unclean.body,/^Not collecting from Oct 24, .* to Oct 28, .*may be missing or arrive late\.$/);
 assert.match(unclean.cause,/without a clean exit: its last logged event was "tray".*last heartbeat was Oct 24.*killed, crashed, or Windows restarted/);
 assert.match(describeOffline(gap({known:true,clean:true,lastEvent:'exit-clean',lastEventAt:'2026-10-24T15:00:00Z'})).cause,/^The previous session was quit normally \(Oct 24/);
 assert.match(describeOffline(gap(null)).cause,/not recorded/);
});

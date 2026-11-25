import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {createCollectorQueue} from '../lib/collector-queue.mjs';

const task = (id,host='one.example')=>({id,host});

test('a slow source cannot block another host, and queued work keeps the refresh active',async()=>{
  const start=[], release=new Map();
  const queue=createCollectorQueue({limit:3,perHost:2,run:({id})=>{
    start.push(id);
    return new Promise(resolve=>release.set(id,resolve));
  }});
  queue.add([task('a'),task('b'),task('c'),task('d','two.example'),task('a')]);
  await flush();
  assert.deepEqual(start,['a','b','d']);
  assert.equal(queue.polling('a'),true);
  assert.equal(queue.queued('c'),true);
  assert.equal(queue.busy,true);
  release.get('a')();
  await flush();
  assert.deepEqual(start,['a','b','d','c']);
  assert.equal(queue.has('a'),false);
  for (const id of ['b','c','d']) release.get(id)();
  await flush();
  assert.equal(queue.busy,false);
});

test('paused queued collectors do not start, and a failed request frees its slot',async()=>{
  const calls=[], errors=[];
  let reject;
  const queue=createCollectorQueue({limit:1,perHost:1,onError:({id},error)=>errors.push([id,error.message]),
    run:({id})=>{
      calls.push(id);
      if(id==='a') return new Promise((_,fail)=>{reject=fail;});
    }});
  queue.add([task('a'),task('b'),task('c')]);
  queue.remove('b');
  await flush();
  reject(Error('Feed failed'));
  await flush();
  assert.deepEqual(calls,['a','c']);
  assert.deepEqual(errors,[['a','Feed failed']]);
  assert.equal(queue.busy,false);
  queue.add([task('d'),task('e')]);
  queue.stop();
  await flush();
  assert.equal(queue.queued('e'),false);
  assert.ok(!calls.includes('e'));
});

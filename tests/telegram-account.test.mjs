import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createTelegramAccount } from '../lib/telegram-account.mjs';

const apiHash = '0123456789abcdef0123456789abcdef';
const session = '1' + 'a'.repeat(120);
const credentials = () => {
  let value = '';
  return {get:()=>value,set:async next=>{value=next;},status:()=>({storage:'encrypted-desktop'})};
};
async function until(get) {
  for (let i=0;i<60;i++) {
    const value = get();
    if (value) return value;
    await delay(10);
  }
  throw Error('Fixture did not reach the expected sign-in phase.');
}

test('Telegram QR sign-in, optional password, targeted channel import, and revocation',async()=>{
  let advance, invoked = 0, ended = 0, revoked = 0;
  const scan = new Promise(resolve=>{advance=resolve;});
  const store = credentials();
  const storeSet = store.set;
  let finishClear;
  const allowClear = new Promise(resolve=>{finishClear=resolve;});
  store.set = async value=>{
    if (!value) await allowClear;
    return storeSet(value);
  };
  const now = 60_000;
  const login = createTelegramAccount(store,{clock:()=>now,device:async (id,hash,saved)=>{
    assert.deepEqual([id,hash],[12345,apiHash]);
    return {
      connect:async()=>{invoked++;},
      approve:async({qrCode,password})=>{
        await qrCode({token:Buffer.from('login-fixture'),expires:120});
        await scan;
        assert.equal(await password(),'demo password');
        return {username:'fixture_user'};
      },
      image:async token=>'data:image/png;base64,'+token.toString('base64'),
      session:()=>session,
      dialogs:async()=>{
        assert.equal(saved,session);
        return [
          {entity:{className:'Channel',broadcast:true,username:'publicnews',title:'Public news'}},
          {entity:{className:'Channel',broadcast:false,megagroup:true,username:'group_name',title:'Group'}},
          {entity:{className:'Channel',broadcast:true,title:'Private channel'}},
          {entity:{className:'User',username:'private_user'}},
          {entity:{className:'Channel',broadcast:true,username:'other_news',title:'Another public channel'}}
        ];
      },
      logout:async()=>{assert.equal(saved,session); revoked++;},
      stop:async()=>{ended++;}
    };
  }});
  assert.throws(()=>login.begin(0,apiHash),/API ID/);
  assert.equal(login.begin(12345,apiHash).phase,'starting');
  const qr = await until(()=>login.status().qr);
  assert.match(qr.image,/^data:image\/png/);
  assert.equal(qr.expires,120_000);
  advance();
  await until(()=>login.status().phase==='password');
  assert.equal(login.status().qr,null);
  login.supplyPassword('demo password');
  await until(()=>login.status().profile);
  assert.deepEqual(login.status().profile,{label:'@fixture_user'});
  assert.doesNotMatch(JSON.stringify(login.status()),new RegExp(apiHash));
  assert.notEqual(store.get(),'');
  assert.throws(()=>login.selected(['publicnews']),/loaded/);
  const result = await login.channels();
  assert.deepEqual(result.channels,[
    {handle:'other_news',name:'Another public channel'},
    {handle:'publicnews',name:'Public news'}
  ]);
  assert.deepEqual(login.selected(['publicnews','publicnews']),[{handle:'publicnews',name:'Public news'}]);
  assert.throws(()=>login.selected(['private_user']),/loaded/);
  assert.deepEqual(createTelegramAccount(store).status().profile,{label:'@fixture_user'});
  const disconnect = login.disconnect();
  await assert.rejects(login.channels(),/Connect your Telegram account/);
  assert.throws(()=>login.selected(['publicnews']),/loaded/);
  assert.throws(()=>login.begin(12345,apiHash),/Finish or disconnect/);
  finishClear();
  assert.equal((await disconnect).phase,'disconnected');
  assert.equal(store.get(),'');
  assert.equal(invoked,3);
  assert.equal(ended,3);
  assert.equal(revoked,1);
});

test('canceling Telegram sign-in removes the QR and leaves no stored session',async()=>{
  let finish;
  const store = credentials();
  const login = createTelegramAccount(store,{clock:()=>0,device:async()=>({
    connect:async()=>{},
    approve:async ({qrCode})=>{
      await qrCode({token:Buffer.from('exception-test'),expires:30});
      return new Promise(resolve=>{finish=resolve;});
    },
    image:async()=>'data:image/png;base64,',
    stop:async()=>finish?.(null)
  })});
  login.begin(12345,apiHash);
  await until(()=>login.status().qr);
  await login.disconnect();
  assert.equal(login.status().qr,null);
  assert.equal(login.status().phase,'disconnected');
  assert.equal(store.get(),'');
});

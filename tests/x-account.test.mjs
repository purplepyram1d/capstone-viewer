import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createXAccount } from '../lib/x-account.mjs';
import { collectSocial } from '../lib/social.mjs';

const clientId = 'CapstoneNativeAppFixture';
const callback = 'http://127.0.0.1:48179/api/social/x-account/callback';
const issued = {token_type:'bearer',access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:7200};

test('X sign-in validates state, exchanges once with PKCE, refreshes and disconnects',async()=>{
  let stored = '', now = 100_000, refreshes = 0, finishClear;
  const allowClear = new Promise(resolve=>{finishClear=resolve;});
  const calls = [];
  const credentials = {get:()=>stored,set:async value=>{if (!value) await allowClear; stored=value;},status:()=>({storage:'encrypted-desktop'})};
  const request = async (url,options)=>{
    calls.push({url,options});
    if (url.endsWith('/users/me')) {
      assert.equal(options.headers.Authorization,'Bearer fixture-access');
      return Response.json({data:{id:'98765',username:'fixture_user'}});
    }
    if (url.endsWith('/revoke')) return Response.json({revoked:true});
    assert.equal(url,'https://api.x.com/2/oauth2/token');
    if (options.body.get('grant_type')==='refresh_token') {
      refreshes++;
      return Response.json({...issued,access_token:'refreshed-access'});
    }
    return Response.json(issued);
  };
  const account = createXAccount(credentials,{request,clock:()=>now});
  assert.throws(()=>account.start(clientId,'https://example.org/api/social/x-account/callback'),/loopback/);
  const signIn = new URL(account.start(clientId,callback));
  assert.equal(signIn.origin,'https://x.com');
  assert.equal(signIn.searchParams.get('redirect_uri'),callback);
  assert.equal(signIn.searchParams.get('code_challenge_method'),'S256');
  assert.equal(await account.finish({state:'wrong',code:'fixture-code'}),false);
  assert.equal(calls.length,0);
  const state = signIn.searchParams.get('state');
  assert.equal(await account.finish({state,code:'fixture-code'}),true);
  assert.equal(await account.finish({state,code:'fixture-code'}),false);
  assert.equal(calls.length,2);
  const proof = calls[0].options.body.get('code_verifier');
  assert.equal(createHash('sha256').update(proof).digest('base64url'),signIn.searchParams.get('code_challenge'));
  assert.deepEqual(account.status().profile,{id:'98765',handle:'fixture_user'});
  assert.doesNotMatch(JSON.stringify(account.status()),/fixture-access|fixture-refresh/);
  assert.equal(await account.accessFor('98765'),'fixture-access');
  await assert.rejects(account.accessFor('other'),/this X account/);
  now += 7200*1000;
  assert.deepEqual(await Promise.all([account.accessFor('98765'),account.accessFor('98765')]),['refreshed-access','refreshed-access']);
  assert.equal(refreshes,1);
  assert.equal(createXAccount(credentials).status().profile.handle,'fixture_user');
  now += 7200*1000;
  const disconnect = account.disconnect();
  assert.equal(account.status().profile,null);
  await assert.rejects(account.accessFor('98765'),/Connect this X account/);
  assert.throws(()=>account.start(clientId,callback),/Finish or disconnect/);
  finishClear();
  assert.equal((await disconnect).linked,false);
  assert.equal(refreshes,1,'a collector cannot refresh credentials after disconnect starts');
  assert.equal(stored,'');
  assert.match(calls.at(-1).url,/revoke$/);
});

test('the authenticated X Following feed keeps only confirmed public authors',async()=>{
  const created = new Date().toISOString();
  const feed={id:'x-home',platform:'x',kind:'following',target:'98765',name:'My Following',
    intervalMinutes:30,maxPosts:5,category:'cyber'};
  const result = await collectSocial(feed,{},'fixture-access',async (url,options)=>{
    const request = new URL(url);
    assert.equal(request.pathname,'/2/users/98765/timelines/reverse_chronological');
    assert.equal(request.searchParams.get('max_results'),'5');
    assert.equal(request.searchParams.get('user.fields'),'username,protected');
    assert.equal(options.headers.Authorization,'Bearer fixture-access');
    return Response.json({meta:{newest_id:'200004'},data:[
      {id:'200002',author_id:'30',created_at:created,text:'Public notice'},
      {id:'200003',author_id:'40',created_at:created,text:'Protected notice'},
      {id:'200004',author_id:'50',created_at:created,text:'Author visibility not established'}
    ],includes:{users:[{id:'30',username:'public_account',protected:false},
      {id:'40',username:'protected_account',protected:true}]}});
  });
  assert.deepEqual(result.events.map(row=>row.title),['Public notice']);
  assert.equal(result.events[0].url,'https://x.com/public_account/status/200002');
  assert.equal(result.runtime.sinceId,'200004');
});

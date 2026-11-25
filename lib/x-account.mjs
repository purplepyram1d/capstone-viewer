import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const authorizeUrl = 'https://x.com/i/oauth2/authorize';
const tokenUrl = 'https://api.x.com/2/oauth2/token';
const revokeUrl = 'https://api.x.com/2/oauth2/revoke';
const meUrl = 'https://api.x.com/2/users/me';
const scopes = 'tweet.read users.read offline.access';
const validText = value => typeof value==='string' && /^[A-Za-z0-9._~+/=-]+$/.test(value) && value.length<=1024;
const validClient = value => typeof value==='string' && /^[A-Za-z0-9_-]{12,150}$/.test(value);
const validId = value => typeof value==='string' && /^\d{1,25}$/.test(value);
const validHandle = value => typeof value==='string' && /^[A-Za-z0-9_]{1,15}$/.test(value);
const liveFor = 8*60_000;

function unpack(value) {
  try {
    const saved = JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if (validClient(saved.clientId) && validId(saved.profile?.id) && validHandle(saved.profile?.handle) &&
        validText(saved.accessToken) && validText(saved.refreshToken) && Number.isFinite(saved.expires)) return saved;
  } catch {}
  return null;
}
function sameState(a,b) {
  if (typeof b!=='string' || a.length!==b.length) return false;
  const supplied = Buffer.from(b,'utf8'), expected = Buffer.from(a,'utf8');
  return supplied.length===expected.length && timingSafeEqual(expected,supplied);
}

export function createXAccount(credentials, {request=fetch, clock=Date.now} = {}) {
  let account = unpack(credentials.get());
  let pending = null, finishing = false, disconnecting = false, refreshing = null, lastError = null;
  async function post(url, fields) {
    return request(url,{method:'POST',body:new URLSearchParams(fields),redirect:'error',signal:AbortSignal.timeout(12_000),
      headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'}});
  }
  async function tokens(fields, previous = null) {
    const response = await post(tokenUrl,fields);
    if (!response.ok) {
      const error = new Error(response.status===400 || response.status===401 ?
        'X declined this connection. Check the Client ID and callback URL, or reconnect.' : 'X token exchange failed (HTTP '+response.status+').');
      error.invalid = response.status===400 || response.status===401;
      throw error;
    }
    const body = await response.json();
    const expiresIn = Number(body.expires_in);
    const refreshToken = body.refresh_token || previous?.refreshToken;
    if (!validText(body.access_token) || !validText(refreshToken) ||
        !Number.isFinite(expiresIn) || expiresIn<1 || expiresIn>86400 ||
        String(body.token_type).toLowerCase()!=='bearer') throw Error('X returned an incomplete account session.');
    return {accessToken:body.access_token,refreshToken,expires:clock()+expiresIn*1000};
  }
  async function revoke({refreshToken,clientId}) {
    const response = await post(revokeUrl,{token:refreshToken,client_id:clientId,token_type_hint:'refresh_token'});
    if (!response.ok) throw Error('X did not confirm revocation.');
  }
  async function save(next) {
    await credentials.set(next ? Buffer.from(JSON.stringify(next),'utf8').toString('base64url') : '');
    account = next;
  }
  const status = () => ({linked:Boolean(account)&&!disconnecting,profile:disconnecting ? null : account?.profile || null,authorizing:finishing || Boolean(pending?.expires>clock()),
    storage:credentials.status().storage,error:lastError || credentials.status().error || null});
  function start(clientId, callback) {
    if (!validClient(clientId)) throw Error('Enter the Client ID for an X Native App.');
    if (finishing || disconnecting || account) throw Error('Finish or disconnect the current X connection first.');
    const redirect = new URL(callback);
    if (redirect.hostname!=='127.0.0.1' || redirect.protocol!=='http:' || !redirect.port ||
        redirect.pathname!=='/api/social/x-account/callback' || redirect.search || redirect.hash) throw Error('X authorization requires Capstone’s loopback callback.');
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    pending = {clientId,callback,state,verifier,expires:clock()+liveFor};
    lastError = null;
    const query = new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',scope:scopes,state,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return authorizeUrl+'?'+query;
  }
  async function finish({state,code,error}) {
    const login = pending;
    if (!login || login.expires<=clock() || !sameState(login.state,state)) return false;
    pending = null;
    if (error || !validText(code)) {
      lastError = 'X sign-in was canceled or expired. Start a new sign-in to try again.';
      return false;
    }
    finishing = true;
    let token;
    try {
      token = await tokens({grant_type:'authorization_code',client_id:login.clientId,code,
        redirect_uri:login.callback,code_verifier:login.verifier});
      const response = await request(meUrl,{headers:{Authorization:'Bearer '+token.accessToken,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(12_000)});
      if (!response.ok) throw Error('X could not verify the account (HTTP '+response.status+'). Check developer access and credits.');
      const user = (await response.json()).data;
      if (!validId(user?.id) || !validHandle(user?.username)) throw Error('X returned an invalid profile.');
      await save({...token,clientId:login.clientId,profile:{id:user.id,handle:user.username}});
      lastError = null;
      return true;
    } catch (error) {
      if (token) await revoke({...token,clientId:login.clientId}).catch(()=>{});
      lastError = error.message;
      return false;
    } finally {
      finishing = false;
    }
  }
  async function accessFor(userId) {
    if (disconnecting || account?.profile.id!==userId) throw Error('Connect this X account to continue collecting its feed.');
    if (account.expires>clock()+60_000) return account.accessToken;
    if (!refreshing) {
      const previous = account;
      refreshing = (async()=>{
        try {
          const token = await tokens({grant_type:'refresh_token',client_id:previous.clientId,refresh_token:previous.refreshToken},previous);
          await save({...previous,...token});
          lastError = null;
          return token.accessToken;
        } catch (error) {
          if (error.invalid) {
            await save(null);
            lastError = 'X authorization expired. Sign in again to resume this feed.';
          }
          throw error;
        }
      })().finally(()=>{refreshing=null;});
    }
    return refreshing;
  }
  async function disconnect() {
    if (finishing) throw Error('Wait for X sign-in to finish before disconnecting.');
    if (disconnecting) throw Error('X is already disconnecting.');
    disconnecting = true;
    try {
      pending = null;
      if (refreshing) await refreshing.catch(()=>{});
      const previous = account;
      await save(null);
      lastError = null;
      if (!previous) return status();
      try {
        await revoke(previous);
      } catch {
        lastError = 'Disconnected from Capstone. Manage the authorization in your X connected apps.';
      }
      return status();
    } finally {
      disconnecting = false;
    }
  }
  return {status,start,finish,accessFor,disconnect};
}

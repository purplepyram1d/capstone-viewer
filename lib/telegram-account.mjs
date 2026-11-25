const signupWindow = 5*60_000;
const maxDialogs = 250;
const validHash = value => typeof value==='string' && /^[a-f0-9]{32}$/i.test(value);
const validApiId = value => Number.isSafeInteger(value) && value>0 && value<=2147483647;
const publicHandle = value => typeof value==='string' && /^[a-z][a-z0-9_]{3,31}$/i.test(value);
const validSession = value => typeof value==='string' && /^1[A-Za-z0-9+/=_-]{50,1800}$/.test(value);

function readAccount(value) {
  try {
    const record = JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if (validSession(record.session) && validApiId(record.apiId) && validHash(record.apiHash) && typeof record.profile?.label==='string') return record;
  } catch {}
  return null;
}
function label(user) {
  if (publicHandle(user?.username)) return '@'+user.username;
  return typeof user?.firstName==='string' && user.firstName.trim() ? user.firstName.trim().slice(0,60) : 'Telegram account';
}
function problem(error) {
  const reason = String(error?.errorMessage || '');
  if (reason==='API_ID_INVALID') return 'Telegram rejected the app credentials. Check the API ID and API hash.';
  if (reason==='PASSWORD_HASH_INVALID') return 'Telegram rejected that two-step verification password. Start a new sign-in to try again.';
  if (reason==='SESSION_REVOKED' || reason==='AUTH_KEY_UNREGISTERED') return 'Telegram ended this session. Disconnect it and sign in again.';
  return 'Telegram could not complete the request. Check the connection and try again.';
}
async function nativeDevice(apiId,apiHash,saved) {
  const [{Api,TelegramClient},{StringSession},{default:qr}] = await Promise.all([
    import('teleproto'),import('teleproto/sessions'),import('qrcode')
  ]);
  const credentials = {apiId,apiHash};
  const client = new TelegramClient(new StringSession(saved || ''),apiId,apiHash,{
    connectionRetries:1,requestRetries:1,autoReconnect:false,deviceModel:'Capstone Viewer',appVersion:'0.1.0'
  });
  client.setLogLevel('none');
  return {
    connect:()=>client.connect(),
    approve:callbacks=>client.signInUserWithQrCode(credentials,callbacks),
    image:token=>qr.toDataURL('tg://login?token='+token.toString('base64url'),{type:'image/png',width:246,margin:2}),
    session:()=>client.session.save(),
    dialogs:()=>client.getDialogs({limit:maxDialogs}),
    logout:()=>client.invoke(new Api.auth.LogOut()),
    stop:()=>client.destroy()
  };
}

export function createTelegramAccount(credentials,{device=nativeDevice,clock=Date.now,loginMs=signupWindow} = {}) {
  let account = readAccount(credentials.get());
  let login = null, lastError = null, channelRequest = null, disconnecting = false;
  let loadedChannels = new Map();
  const stop = native => Promise.resolve().then(()=>native?.stop()).catch(()=>{});
  const revoke = native => Promise.resolve().then(()=>native?.logout()).catch(()=>{});

  async function save(value) {
    await credentials.set(value ? Buffer.from(JSON.stringify(value),'utf8').toString('base64url') : '');
    account = value;
    loadedChannels = new Map();
  }
  function status() {
    const qr = login?.qr?.expires>clock() ? login.qr : null;
    return {profile:account?.profile || null,phase:login?.phase || (account ? 'connected' : 'disconnected'),qr,
      storage:credentials.status().storage,error:lastError || credentials.status().error || null};
  }
  function end(job,error=null) {
    if (login!==job) return;
    login = null;
    lastError = error;
    clearTimeout(job.timeout);
    job.password?.reject(Error('Telegram sign-in ended.'));
  }
  async function authorize(job) {
    let approved = false;
    try {
      job.native = await device(job.apiId,job.apiHash,'');
      if (login!==job) return;
      await job.native.connect();
      if (login!==job) return;
      const user = await job.native.approve({
        qrCode:async ({token,expires})=>{
          if (login!==job) throw Error('Telegram sign-in ended.');
          const image = await job.native.image(token);
          if (login!==job) return;
          job.phase = 'scan';
          job.qr = {image,expires:Number(expires)*1000};
        },
        password:()=>new Promise((resolve,reject)=>{
          if (login!==job) return reject(Error('Telegram sign-in ended.'));
          job.qr = null;
          job.phase = 'password';
          job.password = {resolve,reject};
        }),
        onError:async error=>{job.error=error; return true;}
      });
      approved = Boolean(user);
      if (login!==job) return;
      if (!user || job.error) throw job.error || Error('Telegram did not confirm sign-in.');
      const session = job.native.session();
      if (!validSession(session)) throw Error('Telegram returned an incomplete session.');
      job.phase = 'saving';
      clearTimeout(job.timeout);
      await save({apiId:job.apiId,apiHash:job.apiHash,session,profile:{label:label(user)}});
      approved = false;
      end(job);
    } catch(error) {
      if (login===job) end(job,problem(error));
    } finally {
      if (approved) await revoke(job.native);
      await stop(job.native);
    }
  }
  function begin(apiId,apiHash) {
    if (!validApiId(apiId) || !validHash(apiHash)) throw Error('Enter the Telegram API ID and 32-character API hash.');
    if (login || account || disconnecting) throw Error('Finish or disconnect the current Telegram session first.');
    lastError = null;
    const job = {apiId,apiHash,phase:'starting',qr:null,password:null,native:null};
    login = job;
    job.timeout = setTimeout(()=>{
      end(job,'Telegram sign-in expired. Request a new QR code.');
      void stop(job.native);
    },loginMs);
    job.timeout.unref?.();
    void authorize(job);
    return status();
  }
  function supplyPassword(value) {
    if (login?.phase!=='password' || !login.password) throw Error('Telegram is not waiting for a password.');
    if (typeof value!=='string' || !value.length || value.length>512) throw Error('Enter your Telegram two-step verification password.');
    const prompt = login.password;
    login.password = null;
    login.phase = 'verifying';
    prompt.resolve(value);
    return status();
  }
  async function channels() {
    if (disconnecting || !account) throw Error('Connect your Telegram account first.');
    if (!channelRequest) {
      const saved = account;
      channelRequest = (async()=>{
        const native = await device(saved.apiId,saved.apiHash,saved.session);
        try {
          await native.connect();
          const rows = await native.dialogs();
          if (account!==saved) throw Error('Telegram disconnected.');
          const matches = new Map();
          for (const dialog of rows) {
            const channel = dialog.entity;
            if (channel?.className!=='Channel' || channel.broadcast!==true || channel.megagroup || !publicHandle(channel.username)) continue;
            const handle = channel.username.toLowerCase();
            const name = typeof channel.title==='string' ? channel.title.trim().slice(0,100) : '';
            matches.set(handle,{handle,name:name || '@'+handle});
          }
          loadedChannels = matches;
          return {channels:[...matches.values()].sort((a,b)=>a.name.localeCompare(b.name)),scanned:rows.length,
            limited:rows.length>=maxDialogs && (!Number.isFinite(rows.total) || rows.total>maxDialogs)};
        } catch (error) {
          throw Error(problem(error));
        } finally { await stop(native); }
      })().finally(()=>{channelRequest=null;});
    }
    return channelRequest;
  }
  function selected(handles) {
    if (disconnecting || !account || !Array.isArray(handles) || !handles.length || handles.length>60 ||
        handles.some(handle=>typeof handle!=='string' || !loadedChannels.has(handle))) {
      throw Error('Choose public channels from the loaded Telegram list.');
    }
    return [...new Set(handles)].map(handle=>loadedChannels.get(handle));
  }
  async function disconnect() {
    if (login?.phase==='saving') throw Error('Wait for Telegram sign-in to finish before disconnecting.');
    if (disconnecting) throw Error('Telegram is already disconnecting.');
    disconnecting = true;
    try {
      if (login) {
        const job = login;
        end(job);
        await stop(job.native);
        return status();
      }
      if (channelRequest) throw Error('Wait for the Telegram channel list to finish loading.');
      const previous = account;
      await save(null);
      lastError = null;
      if (!previous) return status();
      let native;
      try {
        native = await device(previous.apiId,previous.apiHash,previous.session);
        await native.connect();
        await native.logout();
      } catch {
        lastError = 'Disconnected from Capstone. You can remove the session under Telegram Settings → Devices.';
      } finally { await stop(native); }
      return status();
    } finally {
      disconnecting = false;
    }
  }
  function shutdown() {
    if (!login) return;
    const job = login;
    end(job);
    void stop(job.native);
  }
  return {status,begin,supplyPassword,channels,selected,disconnect,shutdown};
}

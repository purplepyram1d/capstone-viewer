import { randomUUID } from 'node:crypto';
// One encrypted desktop credential per provider name; 'x' keeps its original file and environment variable.
export async function createCredentials(name='x',envVar='X_BEARER_TOKEN') {
  const desktop=process.env.CAPSTONE_DESKTOP==='1'&&process.connected;
  let token=process.env[envVar]||'',loadError=null;
  const pending=new Map();
  if(desktop)process.on('message',message=>{if(message.type!=='credential-response')return;const request=pending.get(message.requestId);if(!request)return;clearTimeout(request.timer);pending.delete(message.requestId);message.error?request.reject(new Error(message.error)):request.resolve(message.value);});
  function rpc(action,value){return new Promise((resolve,reject)=>{const requestId=randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Desktop credential storage did not respond.'));},5000);pending.set(requestId,{resolve,reject,timer});process.send({type:'credential-request',requestId,action,value,name});});}
  if(desktop&&!token){try{token=await rpc('get')||'';}catch(error){loadError=error.message;}}
  return {
    get:()=>token,
    status:()=>({configured:!!token,storage:process.env[envVar]?'environment':desktop?'encrypted-desktop':'session-memory',error:loadError}),
    async set(value){
      if(process.env[envVar])throw new Error(`This server uses ${envVar}. Update its environment to change or disconnect that token.`);
      if(typeof value!=='string'||value.length>4096||/[\r\n\s]/.test(value))throw new Error('Paste the token without spaces or line breaks.');
      if(desktop)await rpc(value?'set':'clear',value);
      token=value;loadError=null;return this.status();
    }
  };
}

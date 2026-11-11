import {readFileSync} from 'node:fs';
import {feedConfig} from '../lib/social.mjs';
const base=process.env.CAPSTONE_URL||'http://127.0.0.1:48179';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw Error('Use the local Capstone server.');
const lineup=JSON.parse(readFileSync(new URL('../config/telegram-starter.json',import.meta.url)));
async function api(route,body){const response=await fetch(base+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Feed request failed.');return data;}
const {feeds}=await api('/api/social/feeds'),existing=new Set(feeds.map(f=>f.id));
// Never modify an existing feed's name, pause state, interval or claims setting.
for(const entry of lineup.feeds){const config=feedConfig({platform:'telegram',input:entry.input,name:entry.name,category:entry.category,intervalMinutes:entry.intervalMinutes,enabled:true,claims:false});if(existing.has(config.id)){console.log(JSON.stringify({target:config.target,result:'already present; unchanged'}));continue;}const added=await api('/api/social/feeds',{...config,input:entry.input});existing.add(added.id);console.log(JSON.stringify({target:added.target,id:added.id,result:'added',intervalMinutes:added.intervalMinutes}));}

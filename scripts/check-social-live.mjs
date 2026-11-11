import { feedConfig,collectSocial } from '../lib/social.mjs';
const feed=feedConfig({platform:'telegram',input:'@telegram',name:'Telegram official'});
const result=await collectSocial(feed);
console.log(JSON.stringify({platform:feed.platform,observed:result.observed,recentTextPosts:result.events.length,firstPost:result.events[0]?{url:result.events[0].url,ts:result.events[0].ts,title:result.events[0].title}:null}));
const base=process.env.CAPSTONE_URL||'http://127.0.0.1:8080';
for(const route of ['/feeds','/assets/feeds.js','/api/social/feeds','/api/social/credentials']){const response=await fetch(base+route,{signal:AbortSignal.timeout(8000)});console.log(route,response.status);await response.body?.cancel();}
const status=await(await fetch(base+'/api/social/credentials')).json();console.log(JSON.stringify({credentialStorage:status.storage,credentialStoreError:status.error}));

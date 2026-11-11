const base=process.env.CAPSTONE_URL||'http://127.0.0.1:8080';
for(const route of ['/ops','/wall','/sources','/sources/','/assets/world.json','/assets/vendor/maplibre-gl.js','/runtime/events.sqlite','/server.mjs']){
  const r=await fetch(base+route,{signal:AbortSignal.timeout(8000)});console.log(route,r.status);await r.body?.cancel();
}
const data=await(await fetch(base+'/api/events')).json();
console.log('Events',data.events.length,'categories',Object.fromEntries(['cyber','geo','ai'].map(c=>[c,data.events.filter(e=>e.category===c).length])));
console.log('Located weekly cyber',data.events.filter(e=>e.category==='cyber'&&e.lat!==null&&Date.parse(e.ts)>Date.now()-7*86400000).length);
console.log('Health',JSON.stringify(data.feeds.map(f=>({name:f.name,state:f.state,count:f.count,error:f.error}))));
for(const channel of ['@France24_en','@aljazeeraenglish','@SkyNews','@dwnews','@ABCNews','@NBCNews','@channelnewsasia','@euronews','@NHKWORLDJAPAN']){const r=await fetch(base+'/api/stream?channel='+encodeURIComponent(channel),{signal:AbortSignal.timeout(20000)});console.log(channel,r.status,await r.text());}

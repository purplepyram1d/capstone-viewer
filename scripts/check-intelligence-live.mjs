const base=process.env.CAPSTONE_URL||'http://127.0.0.1:48179';
for(const route of ['/ops','/watch','/assets/watch.js','/api/watch']){const response=await fetch(base+route,{signal:AbortSignal.timeout(8000)});console.log(route,response.status);await response.body?.cancel();}
const data=await(await fetch(base+'/api/events')).json();
console.log(JSON.stringify({reports:data.events.length,stories:data.stories?.length,groupedStories:data.stories?.filter(s=>s.report_count>1).length,watchlists:data.watch?.rules.length,unread:data.watch?.unread,manualLocations:data.events.filter(e=>e.manual_location).length}));

import {feeds,collect} from '../lib/collectors.mjs';
for(const feed of feeds.filter(f=>f.tracker==='musk')){try{const {events}=await collect(feed);console.log(feed.id,events.length,events[0]?.title);if(!events.length)process.exitCode=1;}catch(error){console.log(feed.id,error.message);process.exitCode=1;}}

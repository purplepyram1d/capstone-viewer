import {readFileSync} from 'node:fs';
const base=process.env.CAPSTONE_URL||'http://127.0.0.1:8080';
const presets=JSON.parse(readFileSync(new URL('../assets/stream-presets.json',import.meta.url)));
await Promise.all(presets.map(async preset=>{const r=await fetch(base+'/api/stream?channel='+encodeURIComponent(preset.input),{signal:AbortSignal.timeout(25000)});const result=await r.json();console.log(preset.name,r.status,result.videoId||result.error);if(!r.ok)process.exitCode=1;}));

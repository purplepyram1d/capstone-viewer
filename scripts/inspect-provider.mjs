for(const url of ['https://www.ransomware.live/rss.xml']){
 const r=await fetch(url,{signal:AbortSignal.timeout(15000)});const body=await r.text();console.log(url,r.status);
 if(url.endsWith('.json')){try{const schema=JSON.parse(body);console.log(JSON.stringify({security:schema.components?.securitySchemes,paths:Object.keys(schema.paths||{}).filter(p=>/victim/.test(p)),recent:schema.paths?.['/victims/recent']}));}catch{console.log(body.slice(0,300));}}
 else console.log(body.slice(0,5500));
}

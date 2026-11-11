import { collectSocial, feedConfig } from './social.mjs';

export function createSocialManager(db, credentials, broadcast, storeEvents, collector=collectSocial) {
  db.exec('CREATE TABLE IF NOT EXISTS social_feeds (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const running=new Set();
  const get=id=>{const row=db.prepare('SELECT data FROM social_feeds WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
  const status=id=>JSON.parse(db.prepare('SELECT data FROM feeds WHERE id=?').get(id)?.data||'{}');
  const put=(id,data)=>db.prepare('INSERT INTO feeds VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(data));
  function list(){return db.prepare('SELECT data FROM social_feeds ORDER BY id').all().map(row=>{const feed=JSON.parse(row.data),s=status(feed.id);const {runtime,...publicStatus}=s;return {...feed,...publicStatus,
    state:!feed.enabled?'paused':feed.platform==='x'&&!credentials.get()?'needs-key':running.has(feed.id)?'collecting':s.state||'waiting',
    error:feed.platform==='x'&&!credentials.get()?'Connect X API access to read this feed.':s.error||null};});}
  async function poll(id){
    const feed=get(id);if(!feed||!feed.enabled||running.has(id)||running.size>=3)return false;
    if(feed.platform==='x'&&!credentials.get())return false;
    const previous=status(id),now=Date.now();if(previous.nextPoll&&Date.parse(previous.nextPoll)>now)return false;
    running.add(id);const version=JSON.stringify(feed),lastAttempt=new Date().toISOString();
    put(id,{...previous,lastAttempt,nextPoll:new Date(now+feed.intervalMinutes*60000).toISOString()});broadcast();
    try {
      const result=await collector(feed,previous.runtime,credentials.get());
      if(JSON.stringify(get(id))!==version)return false;
      storeEvents(result.events);
      put(id,{state:'ok',count:result.events.length,observed:result.observed,firstSuccess:previous.firstSuccess||new Date().toISOString(),lastSuccess:new Date().toISOString(),lastAttempt,
        nextPoll:new Date(Date.now()+feed.intervalMinutes*60000).toISOString(),usedUrl:result.usedUrl,note:result.note||null,error:null,runtime:result.runtime});
    }catch(error){
      if(JSON.stringify(get(id))===version)put(id,{...previous,state:'error',lastAttempt,error:String(error.message).slice(0,200),failingSince:previous.state==='error'&&previous.failingSince?previous.failingSince:lastAttempt,nextPoll:new Date(error.retryAt||Date.now()+feed.intervalMinutes*60000).toISOString()});
    }finally{running.delete(id);broadcast();}
    return true;
  }
  return {
    list,get,status,poll,
    connection:()=>credentials.status(),
    async setToken(value){const result=await credentials.set(value);broadcast();return result;},
    add(input){
      const feed=feedConfig(input);if(get(feed.id))throw new Error('This channel/account is already in your feeds.');
      if(list().length>=60)throw new Error('You can track up to 60 social feeds.');
      db.prepare('INSERT INTO social_feeds VALUES (?,?)').run(feed.id,JSON.stringify(feed));broadcast();return feed;
    },
    update(id,input){
      const before=get(id);if(!before)throw new Error('Feed not found.');
      const feed=feedConfig({...input,platform:before.platform,input:before.url},before);
      db.prepare('UPDATE social_feeds SET data=? WHERE id=?').run(JSON.stringify(feed),id);broadcast();return feed;
    },
    remove(id){db.prepare('DELETE FROM social_feeds WHERE id=?').run(id);db.prepare('DELETE FROM feeds WHERE id=?').run(id);broadcast();},
    async tick(){await Promise.allSettled(list().filter(feed=>feed.enabled).map(feed=>poll(feed.id)));}
  };
}

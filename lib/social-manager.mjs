import { collectSocial, feedConfig } from './social.mjs';
import { newestSourceReport } from './events.mjs';

export function createSocialManager(db, credentials, broadcast, storeEvents, collector=collectSocial, recordPoll=()=>{}, xAccount=null) {
  db.exec('CREATE TABLE IF NOT EXISTS social_feeds (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const running=new Set();
  const get=id=>{const row=db.prepare('SELECT data FROM social_feeds WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
  const status=id=>JSON.parse(db.prepare('SELECT data FROM feeds WHERE id=?').get(id)?.data||'{}');
  const put=(id,data)=>db.prepare('INSERT INTO feeds VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(data));
  const canCollect = feed => feed.kind==='following' ? xAccount?.status().profile?.id===feed.target : feed.platform!=='x'||Boolean(credentials.get());
  function list(){return db.prepare('SELECT data FROM social_feeds ORDER BY id').all().map(row=>{const feed=JSON.parse(row.data),s=status(feed.id);const {runtime,...publicStatus}=s;return {...feed,...publicStatus,
    state:!feed.enabled?'paused':!canCollect(feed)?'needs-key':running.has(feed.id)?'collecting':s.state||'waiting',
    error:!canCollect(feed)?(feed.kind==='following'?'Link this X account again to resume its Following feed.':'Connect an X developer token to read this feed.'):s.error||null};});}
  async function poll(id){
    const feed=get(id);if(!feed||!feed.enabled||running.has(id)||running.size>=3)return false;
    if(!canCollect(feed))return false;
    const previous=status(id),now=Date.now();if(previous.nextPoll&&Date.parse(previous.nextPoll)>now)return false;
    running.add(id);const version=JSON.stringify(feed),lastAttempt=new Date().toISOString();
    put(id,{...previous,lastAttempt,nextPoll:new Date(now+feed.intervalMinutes*60000).toISOString()});broadcast();
    try {
      const token = feed.kind==='following' ? await xAccount.accessFor(feed.target) : credentials.get();
      const result=await collector(feed,previous.runtime,token);
      if(JSON.stringify(get(id))!==version || !canCollect(feed))return false;
      const changes = storeEvents(result.events);
      put(id,{state:'ok',count:result.events.length,newestReport:newestSourceReport(result.events),...changes,observed:result.observed,firstSuccess:previous.firstSuccess||new Date().toISOString(),lastSuccess:new Date().toISOString(),lastAttempt,
        nextPoll:new Date(Date.now()+feed.intervalMinutes*60000).toISOString(),usedUrl:result.usedUrl,note:result.note||null,error:null,runtime:result.runtime});
      recordPoll(id, now, true, result.events.length, changes);
    }catch(error){
      if (JSON.stringify(get(id)) === version) {
        const detail = String(error.message).slice(0,200);
        put(id,{...previous,state:'error',lastAttempt,error:detail,failingSince:previous.state==='error'&&previous.failingSince?previous.failingSince:lastAttempt,nextPoll:new Date(error.retryAt||Date.now()+feed.intervalMinutes*60000).toISOString()});
        recordPoll(id, now, false, null, {error:detail});
      }
    }finally{running.delete(id);broadcast();}
    return true;
  }
  return {
    list,get,status,poll,canCollect,
    connection:()=>credentials.status(),
    async setToken(value){const result=await credentials.set(value);broadcast();return result;},
    addFollowing(profile) {
      const feed = feedConfig({}, {platform:'x',kind:'following',target:profile.id,url:'https://x.com/home',
        name:'X Following · @'+profile.handle,enabled:false,intervalMinutes:30,maxPosts:5});
      return add(feed);
    },
    add(input){ return add(feedConfig(input)); },
    addTelegramChannels(channels,category) {
      const requested = channels.map(channel=>feedConfig({platform:'telegram',input:channel.handle,name:channel.name,category}));
      const added = requested.filter(feed=>!get(feed.id));
      if (list().length+added.length>60) throw Error('You can track up to 60 social feeds.');
      if (added.length) {
        const insert = db.prepare('INSERT INTO social_feeds VALUES (?,?)');
        db.exec('BEGIN');
        try {
          for (const feed of added) insert.run(feed.id,JSON.stringify(feed));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        broadcast();
      }
      return {added:added.length,alreadyTracked:requested.length-added.length};
    },
    update(id,input){
      const before=get(id);if(!before)throw new Error('Feed not found.');
      const feed=feedConfig({...input,platform:before.platform,input:before.url},before);
      db.prepare('UPDATE social_feeds SET data=? WHERE id=?').run(JSON.stringify(feed),id);broadcast();return feed;
    },
    remove(id){db.prepare('DELETE FROM social_feeds WHERE id=?').run(id);db.prepare('DELETE FROM feeds WHERE id=?').run(id);broadcast();},
    async tick(){await Promise.allSettled(list().filter(feed=>feed.enabled).map(feed=>poll(feed.id)));}
  };
  function add(feed) {    if(get(feed.id))throw new Error('This channel or account is already in your feeds.');
    if(list().length>=60)throw new Error('You can track up to 60 social feeds.');
    db.prepare('INSERT INTO social_feeds VALUES (?,?)').run(feed.id,JSON.stringify(feed));broadcast();return feed;
  }
}

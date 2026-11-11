import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { event, text, safeUrl } from './events.mjs';
import { parseClaim } from './claims.mjs';
const countries=JSON.parse(readFileSync(new URL('../assets/countries.json',import.meta.url)));
// Feeds marked as claim relays turn flag-led incident posts into country-placed claims; other posts stay social.
const claimFields=(feed,body)=>feed.claims?parseClaim(body,countries)||{}:{};

export const platformNames={telegram:'Telegram',x:'X',bluesky:'Bluesky',mastodon:'Mastodon'};
const blueskyHandle=/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
// Mastodon instances are user-chosen hosts, so refuse anything that is not a public DNS name.
export function publicHost(value){
  const host=String(value||'').toLowerCase().replace(/\.$/,'');
  if(isIP(host)||!blueskyHandle.test(host)||/\.(?:local|localhost|internal|lan|home|corp|test|invalid|arpa)$/.test(host))throw new Error('Use a public Mastodon server name, such as infosec.exchange.');
  return host;
}
const privateAddress=ip=>/^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(?:10|127|192\.168|169\.254)\.)/i.test(ip);

export function parseTarget(platform, input) {
  if (!platformNames[platform] || typeof input !== 'string') throw new Error('Choose a platform and enter a public channel/account.');
  let target = input.trim(), kind = 'account';
  if (/^https?:\/\//i.test(target)) {
    let url; try { url = new URL(target); } catch { throw new Error('Invalid channel URL.'); }
    if(url.username || url.password)throw new Error('Use a public channel or profile URL.');
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    const parts=url.pathname.split('/').filter(Boolean);
    if(platform==='bluesky') {
      if(host!=='bsky.app'||parts[0]!=='profile'||!parts[1])throw new Error('Use a bsky.app/profile/… link or a Bluesky handle.');
      target=parts[1];
    } else if(platform==='mastodon') {
      if(!parts[0]?.startsWith('@'))throw new Error('Use a Mastodon profile link such as https://infosec.exchange/@name.');
      target=`${parts[0].slice(1)}@${host}`;
    } else if(platform==='telegram') {
      if(!['t.me','telegram.me'].includes(host))throw new Error('Use a t.me channel link or @username.');
      target=parts[0]==='s'?parts[1]:parts[0];
      if(parts[0]==='joinchat'||parts[0]==='c'||parts[0]?.startsWith('+'))throw new Error('This collector supports public Telegram channels with a username. Invite links and private chats are not supported.');
    } else {
      if(!['x.com','twitter.com','mobile.twitter.com'].includes(host))throw new Error('Use an x.com account or public List URL.');
      if(parts[0]==='i'&&parts[1]==='lists'){target=parts[2];kind='list';}
      else if(parts[1]==='lists'){target=parts[2];kind='list';}
      else target=parts[0];
    }
  }
  target=String(target||'').replace(/^@/,'');
  if(platform==='bluesky') {
    let handle=target.toLowerCase();if(!handle.includes('.')&&!handle.startsWith('did:'))handle+='.bsky.social';
    if(!blueskyHandle.test(handle)&&!/^did:plc:[a-z2-7]{24}$/.test(handle))throw new Error('Use a Bluesky handle, such as @name.bsky.social.');
    return {platform,kind:'account',target:handle,url:`https://bsky.app/profile/${handle}`};
  }
  if(platform==='mastodon') {
    const [user,host]=target.split('@');
    if(!/^[A-Za-z0-9_]{1,30}$/.test(user||'')||!host)throw new Error('Use a Mastodon account as @name@server, such as @briankrebs@infosec.exchange.');
    const server=publicHost(host);
    return {platform,kind:'account',target:`${user.toLowerCase()}@${server}`,url:`https://${server}/@${user}`};
  }
  if(platform==='telegram') {
    if(!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(target))throw new Error('Use a public Telegram username, such as @channelname.');
    return {platform,kind:'channel',target:target.toLowerCase(),url:`https://t.me/${target.toLowerCase()}`};
  }
  if(kind==='list') {
    if(!/^\d{1,25}$/.test(target))throw new Error('Use the numeric List ID from an x.com/i/lists/… link.');
    return {platform,kind,target,url:`https://x.com/i/lists/${target}`};
  }
  if(!/^[a-zA-Z0-9_]{1,15}$/.test(target)||['home','explore','i','intent','search','settings','messages'].includes(target.toLowerCase()))throw new Error('Use an X @username or public List URL.');
  return {platform,kind,target:target.toLowerCase(),url:`https://x.com/${target.toLowerCase()}`};
}

export function feedConfig(input, previous) {
  const parsed=parseTarget(input.platform??previous?.platform,input.input??previous?.url);
  const category=input.category??previous?.category??'cyber';
  if(!['cyber','geo','ai'].includes(category))throw new Error('Choose a valid desk.');
  const intervalMinutes=Number(input.intervalMinutes??previous?.intervalMinutes??(parsed.platform==='x'?15:5));
  if(!Number.isInteger(intervalMinutes)||intervalMinutes<(parsed.platform==='x'?15:2)||intervalMinutes>1440)throw new Error(`Polling must be ${parsed.platform==='x'?15:2}–1440 minutes.`);
  const name=text(input.name??previous?.name??`${platformNames[parsed.platform]} · ${parsed.target}`).slice(0,100);
  if(!name)throw new Error('Give the feed a name.');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new Error('Enabled must be true or false.');
  const enabled=input.enabled??previous?.enabled??(parsed.platform!=='x');
  const maxPosts=Number(input.maxPosts??previous?.maxPosts??5);
  if(![5,10,20].includes(maxPosts))throw new Error('Choose 5, 10 or 20 posts per poll.');
  if(input.claims!==undefined&&typeof input.claims!=='boolean')throw new Error('Claims mode must be true or false.');
  const claims=input.claims??previous?.claims??false;
  const id=previous?.id||'social-'+createHash('sha256').update(`${parsed.platform}:${parsed.kind}:${parsed.target}`).digest('hex').slice(0,20);
  return {...parsed,id,name,category,intervalMinutes,maxPosts,enabled,claims,created:previous?.created||new Date().toISOString()};
}

export function parseTelegram(html, feed, now=Date.now()) {
  const $=load(html), messages=$('.tgme_widget_message[data-post]');
  if(!messages.length)throw new Error('Public preview unavailable. Check the channel username; private, restricted and login-only channels cannot be read here.');
  const events=[];
  messages.each((_,element)=>{
    const message=$(element),post=message.attr('data-post')||'';
    if(!new RegExp(`^${feed.target}/\\d+$`,'i').test(post))return;
    const content=message.find('.tgme_widget_message_text').first();
    content.find('br').replaceWith('\n');
    const body=content.text().trim(),ts=message.find('time[datetime]').first().attr('datetime');
    if(!body||!ts)return;
    const entry=event({key:`telegram:${post.toLowerCase()}`,ts,title:body.split('\n').find(line=>line.trim())?.slice(0,220),summary:body.slice(0,500),
      url:`https://t.me/${post}`,source:feed.name,source_id:feed.id,platform:'telegram',category:feed.category,kind:'social',confidence:'Unverified public Telegram post',score:40,citation_urls:[...new Set(content.find('a[href]').map((_,a)=>safeUrl($(a).attr('href'))).get().filter(u=>u&&!new URL(u).hostname.endsWith('t.me')))],...claimFields(feed,body)},now);
    if(entry)events.push(entry);
  });
  return {events,observed:messages.length};
}

export function normalizeX(data, feed, now=Date.now()) {
  if(data.data!==undefined&&!Array.isArray(data.data))throw new Error('Unexpected X timeline response.');
  if(data.errors?.length&&!data.data?.length)throw new Error('X could not return this timeline. Check account visibility and API access.');
  const users=new Map((data.includes?.users||[]).map(user=>[user.id,user.username]));
  return (data.data||[]).map(post=>{
    if(!/^\d+$/.test(String(post.id)))return null;
    const username=users.get(post.author_id)||(feed.kind==='account'?feed.target:null);
    return event({key:`x:${post.id}`,ts:post.created_at,title:String(post.text||'').split('\n').find(line=>line.trim())?.slice(0,220),summary:post.text,
      url:username?`https://x.com/${encodeURIComponent(username)}/status/${post.id}`:`https://x.com/i/web/status/${post.id}`,
      source:username&&feed.kind==='list'?`${feed.name} · @${username}`:feed.name,source_id:feed.id,platform:'x',category:feed.category,kind:'social',confidence:'Unverified public X post',score:40},now);
  }).filter(Boolean);
}

const firstLine=body=>body.split('\n').find(line=>line.trim())?.slice(0,220);

export function normalizeBluesky(data, feed, now=Date.now()) {
  if(!Array.isArray(data?.feed))throw new Error('Unexpected Bluesky feed response.');
  // Reposts carry a reason; only the account's own posts are collected.
  return data.feed.filter(item=>!item.reason&&item.post?.record?.text).map(({post})=>{
    const body=String(post.record.text),rkey=String(post.uri||'').split('/').pop(),handle=post.author?.handle||feed.target;
    if(!/^[a-z0-9]{8,20}$/i.test(rkey))return null;
    return event({key:`bluesky:${post.uri}`,ts:post.record.createdAt||post.indexedAt,title:firstLine(body),summary:body.slice(0,500),
      url:`https://bsky.app/profile/${encodeURIComponent(handle)}/post/${rkey}`,source:feed.name,source_id:feed.id,platform:'bluesky',category:feed.category,kind:'social',confidence:'Unverified public Bluesky post',score:40,...claimFields(feed,body)},now);
  }).filter(Boolean);
}

export function normalizeMastodon(statuses, feed, now=Date.now()) {
  if(!Array.isArray(statuses))throw new Error('Unexpected Mastodon response.');
  return statuses.filter(s=>!s.reblog&&s.visibility!=='direct').map(s=>{
    const $=load(String(s.content||''));$('br').replaceWith('\n');$('p').append('\n');
    const body=$.root().text().trim(),warning=text(s.spoiler_text);
    if(!body&&!warning)return null;
    return event({key:`mastodon:${s.uri||s.url}`,ts:s.created_at,title:warning?`CW: ${warning}`:firstLine(body),summary:(warning?`Content warning: ${warning}. `:'')+body.slice(0,500),
      url:s.url||s.uri,source:feed.name,source_id:feed.id,platform:'mastodon',category:feed.category,kind:'social',confidence:'Unverified public Mastodon post',score:40,...claimFields(feed,warning?`CW: ${warning}\n${body}`:body)},now);
  }).filter(Boolean);
}

async function getJSON(url,request,label){
  const response=await request(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{'User-Agent':'CapstoneViewer/0.2 public post reader',Accept:'application/json'}});
  if(!response.ok)throw new Error(response.status===404?`${label} account not found.`:response.status===429?`${label} rate limit reached. Polling will retry later.`:`${label} returned HTTP ${response.status}.`);
  const body=await response.text();if(body.length>4_000_000)throw new Error(`${label} response exceeds size limit.`);
  return JSON.parse(body);
}

export async function collectSocial(feed, runtime={}, token='', request=fetch, resolve=lookup) {
  if(feed.platform==='bluesky') {
    const url=`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(feed.target)}&limit=30&filter=posts_no_replies`;
    const data=await getJSON(url,request,'Bluesky');
    return {events:normalizeBluesky(data,feed),observed:data.feed.length,runtime:{},usedUrl:url.split('?')[0]};
  }
  if(feed.platform==='mastodon') {
    const [user,host]=feed.target.split('@');publicHost(host);
    const addresses=await resolve(host,{all:true});
    if(!addresses.length||addresses.some(a=>privateAddress(a.address)))throw new Error('This Mastodon server resolves to a private or local address and will not be contacted.');
    let accountId=runtime.accountId;
    if(!accountId){accountId=(await getJSON(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`,request,'Mastodon')).id;if(!/^\d{1,25}$/.test(String(accountId)))throw new Error('Mastodon lookup did not return an account ID.');}
    const url=new URL(`https://${host}/api/v1/accounts/${accountId}/statuses`);
    url.searchParams.set('limit','20');url.searchParams.set('exclude_replies','true');url.searchParams.set('exclude_reblogs','true');
    if(runtime.sinceId)url.searchParams.set('since_id',runtime.sinceId);
    const statuses=await getJSON(url.href,request,'Mastodon');
    const newest=Array.isArray(statuses)?statuses.reduce((max,s)=>/^\d+$/.test(String(s.id))&&(!max||BigInt(s.id)>BigInt(max))?String(s.id):max,runtime.sinceId):runtime.sinceId;
    return {events:normalizeMastodon(statuses,feed),observed:statuses.length,runtime:{accountId:String(accountId),sinceId:newest||null},usedUrl:url.origin+url.pathname,
      note:!statuses.length&&!runtime.sinceId?'No public posts returned. Some accounts hide their posts from logged-out readers.':null};
  }
  return collectTelegramOrX(feed,runtime,token,request);
}

async function collectTelegramOrX(feed, runtime={}, token='', request=fetch) {
  if(feed.platform==='telegram') {
    const response=await request(`https://t.me/s/${feed.target}`,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'CapstoneViewer/0.2 public channel reader'}});
    if(!response.ok)throw new Error(`Telegram returned HTTP ${response.status}.`);
    const html=await response.text();if(html.length>4_000_000)throw new Error('Telegram preview exceeds size limit.');
    const result=parseTelegram(html,feed);return {...result,runtime:{},usedUrl:`https://t.me/s/${feed.target}`};
  }
  if(!token)throw new Error('Connect an X API bearer token in Feeds to collect posts.');
  async function xGet(url){
    const response=await request(url,{signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok){
      const error=new Error(({401:'X rejected this token. Reconnect a valid bearer token.',402:'X API credits or billing access required.',403:'X denied access. Check API permissions and account/List visibility.',404:'X account or List was not found.',429:'X rate limit reached. Polling will back off.'})[response.status]||`X API returned HTTP ${response.status}.`);
      const reset=Number(response.headers.get('x-rate-limit-reset'))*1000;
      error.retryAt=response.status===429?Math.max(Date.now()+15*60000,Number.isFinite(reset)?reset:0):Date.now()+feed.intervalMinutes*60000;
      throw error;
    }
    return response.json();
  }
  let userId=runtime.userId;
  if(feed.kind==='account'&&!userId){const result=await xGet(`https://api.x.com/2/users/by/username/${feed.target}`);userId=result.data?.id;if(!/^\d+$/.test(String(userId)))throw new Error('X user lookup did not return an account ID.');}
  const url=new URL(feed.kind==='list'?`https://api.x.com/2/lists/${feed.target}/tweets`:`https://api.x.com/2/users/${userId}/tweets`);
  url.searchParams.set('max_results',String(feed.maxPosts));url.searchParams.set('post.fields','created_at');
  url.searchParams.set('expansions','author_id');url.searchParams.set('user.fields','username');
  if(runtime.sinceId&&feed.kind==='account')url.searchParams.set('since_id',runtime.sinceId);
  const data=await xGet(url.href),events=normalizeX(data,feed);
  // Newest-first capped polls intentionally bound reads; a busy feed can have gaps.
  const newest=data.meta?.newest_id || data.data?.reduce((max,p)=>/^\d+$/.test(String(p.id))&&(!max||BigInt(p.id)>BigInt(max))?String(p.id):max,runtime.sinceId);
  return {events,observed:data.data?.length||0,runtime:{userId,sinceId:newest||runtime.sinceId},usedUrl:url.origin+url.pathname,
    note:data.meta?.next_token?'Post cap reached. Older posts may be skipped; raise the cap or poll more often.':null};
}

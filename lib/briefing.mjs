// Ranked observations, never a claim that an unobserved interval was quiet.
export function buildBriefing({digest,then,between=[],events=[],threads=[],gaps=[],now=Date.now()}){
 const since=Date.parse(digest.since), stamps=[then?.ts,...between.map(c=>c.ts)].filter(Boolean).map(Date.parse).filter(t=>t<=now).sort((a,b)=>a-b);
 const coverage=[];
 if(digest.partial)coverage.push('History does not cover the whole comparison window.');
 if(!stamps.length||now-stamps.at(-1)>45*60000||stamps[0]>since+20*60000||since-stamps[0]>45*60000||stamps.some((t,i)=>i&&t-stamps[i-1]>45*60000))coverage.push('Checkpoint gaps limit what the app can compare.');
 if(gaps.length)coverage.push(`${gaps.length} collector inputs are unavailable or stalled. Open collector health for details.`);
 const cards=[],byId=new Map(events.map(e=>[e.id,e]));
 const links=reports=>[...new Map(reports.filter(r=>r?.url&&/^https?:\/\//i.test(r.url)).map(r=>[r.url,{url:r.url,label:r.source||'Source'}])).values()].slice(0,3);
 for(const thread of threads){
  // Baseline imports and follow toggles are not fresh developments.
  const changes=thread.changes.filter(c=>Date.parse(c.observed)>since&&Date.parse(c.observed)<=now&&Date.parse(c.observed)>Date.parse(thread.created)&&(c.kind==='report_added'||c.kind==='analyst_status'||(c.kind==='report_updated'&&c.changed_fields?.some(f=>['title','summary','confidence','kind','ongoing','cves','country'].includes(f)))));
  if(!changes.length)continue;
  const evidence=changes.filter(c=>c.report_id),reports=thread.reports.filter(r=>evidence.some(c=>c.report_id===r.id));
  const ended=reports.some(r=>r.kind==='outage'&&r.ongoing===false&&evidence.some(c=>c.report_id===r.id&&c.changed_fields?.includes('ongoing')));
  cards.push({key:thread.id,rank:90+(thread.followed?20:0)+(ended?10:0),title:thread.title,label:ended?'Source reports recovery':evidence.length?'Evidence updated':'Your assessment changed',text:evidence.length?`${evidence.length} report observations since this comparison began. ${thread.source_condition}.`:'An analyst status changed. This is your assessment, not source confirmation.',observed:changes[0].observed,href:'/developing?id='+encodeURIComponent(thread.id),links:links(reports),report_ids:reports.map(r=>r.id)});
 }
 const used=new Set(cards.flatMap(c=>c.report_ids));
 for(const k of digest.kev.filter(k=>!used.has(k.id)).slice(0,2)){const report=byId.get(k.id);cards.push({key:k.id,rank:85,title:k.title,label:'CISA KEV addition',text:'Published in this window. CISA lists evidence of exploitation; exposure in your environment is unknown.',href:'/timeline?search='+encodeURIComponent(k.title),links:links([report]),report_ids:[k.id]});}
 const critical=digest.critical.filter(c=>!used.has(c.id)&&!digest.kev.some(k=>k.id===c.id));
 if(critical.length)cards.push({key:'critical',rank:72,title:`${critical.length} critical vulnerability report${critical.length===1?"":"s"}`,label:'Published in this window',text:'High severity advisories warrant checking affected products. Local exposure and exploitation are not established by severity alone.',href:'/timeline',links:links(critical.map(c=>byId.get(c.id)))});
 for(const t of digest.tiles.filter(t=>t.changed||t.peaked))cards.push({key:'status-'+t.id,rank:t.now==='red'?100:70,title:t.label+' status changed',label:'Rule-based status',text:`${t.then||'Unknown'} to ${t.now}${t.peaked?`; reached ${t.peak} between checkpoints`:''}. A signal threshold changed, not a prediction.`,status:t.id,links:[]});
 if(digest.outages.started.length)cards.push({key:'outages',rank:80,title:'New ongoing outage listings',label:'Source measurements',text:digest.outages.started.map(o=>o.name).join(', ')+'. Newly present versus the baseline; the incident may have begun earlier.',href:'/timeline',links:links(events.filter(e=>e.kind==='outage'&&e.ongoing&&digest.outages.started.some(o=>o.code===e.country)))});
 if(digest.outages.ended.length)cards.push({key:'outages-absent',rank:60,title:'Outages no longer listed as ongoing',label:'Recovery unconfirmed',text:digest.outages.ended.map(o=>o.name).join(', ')+'. Disappearance from the working set alone does not establish recovery.',href:'/timeline',links:[]});
 for(const m of digest.epss_movers.slice(0,1))cards.push({key:m.cve,rank:75,title:m.cve+' exploitation estimate rose',label:'Probability estimate',text:`EPSS ${Math.round(m.then*100)}% to ${Math.round(m.now*100)}%. A model estimate, not an exploitation sighting.`,href:'/timeline',links:links(events.filter(e=>e.epss?.cve===m.cve))});
 if(digest.hotspots.added.length)cards.push({key:'hotspots',rank:65,title:'Signals overlap in new places',label:'Correlation, not causation',text:digest.hotspots.added.map(h=>h.name).join(', ')+'. Reports may be unrelated; inspect their sources.',href:'/ops',links:[]});
 if(digest.hotspots.cleared.length)cards.push({key:'hotspots-cleared',rank:45,title:'Hot spot signals fell below the threshold',label:'Resolution unconfirmed',text:digest.hotspots.cleared.map(h=>h.name).join(', ')+'. Fewer overlapping signals do not establish that incidents ended.',href:'/ops',links:[]});
 const ranked=cards.sort((a,b)=>b.rank-a.rank||a.key.localeCompare(b.key));
 return {cards:ranked.slice(0,5),remaining:Math.max(0,ranked.length-5),coverage,quiet:!coverage.length&&!ranked.length};
}

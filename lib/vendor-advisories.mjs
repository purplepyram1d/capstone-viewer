import {event,extractCves,parseRSS} from './events.mjs';

const publishers = [
  {
    id:'aws-bulletins',name:'Amazon Web Services',reference:'https://aws.amazon.com/security/security-bulletins/',
    url:'https://aws.amazon.com/security/security-bulletins/rss/feed/',
    host:'aws.amazon.com',path:/^\/security\/security-bulletins\/(?:rss\/)?(?:aws-)?\d{4}-\d+-[a-z0-9-]+\/?$/i
  },
  {
    id:'cisco-psirt',name:'Cisco Systems, Inc.',reference:'https://sec.cloudapps.cisco.com/security/center/rss.x',
    url:'https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml',
    host:'sec.cloudapps.cisco.com',path:/^\/security\/center\/content\/CiscoSecurityAdvisory\/cisco-sa-[a-z0-9-]+\/?$/i,
    dateBasis:'updated'
  }
];

function normalizeVendor(xml,publisher,now=Date.now()) {
  return parseRSS(xml).flatMap(row=>{
    let link;
    try { link = new URL(row.url); } catch { return []; }
    if (link.protocol!=='https:' || link.hostname!==publisher.host || !publisher.path.test(link.pathname) ||
        link.username || link.password || link.port) return [];
    // Cisco's feed update times use GMT, as shown by the corresponding advisory's Last Updated field.
    const ciscoClock = publisher.id==='cisco-psirt' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(row.ts);
    const ts = ciscoClock ? row.ts.replace(' ','T')+'Z' : row.ts;
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(ts);
    if (!dayOnly && !/Z$|(?:GMT|UTC)$|[+-]\d{2}:?\d{2}$/i.test(ts)) return [];
    const report = event({key:publisher.id+':'+link.pathname.toLowerCase().replace(/\/$/,''),
      title:row.title,ts,url:link.origin+link.pathname,category:'cyber',kind:'advisory',
      source:publisher.name,confidence:'Official vendor advisory',score:65,
      date_precision:dayOnly?'day':'timestamp',source_date_basis:publisher.dateBasis},now);
    return report ? [{...report,cves:extractCves(row.title+' '+row.summary)}] : [];
  });
}

export const vendorAdvisoryFeeds = publishers.map(publisher=>({
  id:publisher.id,name:publisher.name+' advisories',url:publisher.url,desk:'cyber',conditional:true,intervalMs:1800_000,
  parse:xml=>normalizeVendor(xml,publisher),
  profile:{evidence:'Official vendor advisory',description:publisher.dateBasis ?
    'Public advisories for Cisco products, dated by the publisher’s latest update.':'Public AWS security bulletins with publisher dates and direct advisory links.',
    url:publisher.reference}
}));

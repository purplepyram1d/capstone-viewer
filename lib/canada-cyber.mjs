import { event, parseRSS } from './events.mjs';

export const canadaCyberSource = 'Canadian Centre for Cyber Security';
export const canadaCyberUrl = 'https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en';
export const canadaCyberReference = 'https://www.cyber.gc.ca/en/alerts-advisories';

export function normalizeCanadaCyber(xml, now = Date.now()) {
  return parseRSS(xml).flatMap(row=>{
    let link;
    try { link = new URL(row.url); } catch { return []; }
    if (link.protocol!=='https:' || !['cyber.gc.ca','www.cyber.gc.ca'].includes(link.hostname) ||
        !link.pathname.startsWith('/en/alerts-advisories/') || link.username || link.password || link.port) return [];
    const report = event({
      key:'cccs:'+link.pathname,ts:row.ts,title:row.title,url:link.origin+link.pathname,
      source:canadaCyberSource,category:'cyber',kind:'advisory',confidence:'Official advisory',
      score:65,source_date_basis:'updated',date_precision:/^\d{4}-\d{2}-\d{2}$/.test(row.ts)?'day':'timestamp'
    },now);
    return report ? [report] : [];
  });
}

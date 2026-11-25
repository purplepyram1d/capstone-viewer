import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { event, text } from './events.mjs';

export const weeklyVolcanoSource = 'Smithsonian / USGS weekly volcano activity';
export const weeklyVolcanoUrl = 'https://volcano.si.edu/news/WeeklyVolcanoRSS.xml';
export const weeklyVolcanoReference = 'https://volcano.si.edu/reports_weekly.cfm?vtab=report';
const parser = new XMLParser({ignoreAttributes:false,processEntities:false,removeNSPrefix:true,parseTagValue:false});
const months = 'January February March April May June July August September October November December'.split(' ');

function archiveWeek(period) {
  const dates = /^(\d{1,2}) ([A-Za-z]+)(?: (\d{4}))?\s*[-–]\s*(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(period);
  if (!dates) return '';
  const startMonth = months.indexOf(dates[2]), endMonth = months.indexOf(dates[5]);
  if (startMonth<0 || endMonth<0) return '';
  const year = dates[3] ? Number(dates[3]) : Number(dates[6])-Number(startMonth>endMonth);
  const start = new Date(Date.UTC(year,startMonth,Number(dates[1])));
  const end = new Date(Date.UTC(Number(dates[6]),endMonth,Number(dates[4])));
  if (start.getUTCDate()!==Number(dates[1]) || end.getUTCDate()!==Number(dates[4]) ||
      end-start!==6*86_400_000) return '';
  return start.toISOString().slice(0,10).replaceAll('-','');
}

export function normalizeWeeklyVolcanoes(xml, now = Date.now()) {
  if (XMLValidator.validate(xml)!==true) throw Error('Expected the Smithsonian / USGS weekly volcano RSS feed');
  const items = parser.parse(xml).rss?.channel?.item;
  if (!items) throw Error('Weekly volcano feed has no report items');
  const reports = new Map();
  for (const item of Array.isArray(items) ? items : [items]) {
    const heading = /^(.+?) - Report for (.+?) - (.+)$/.exec(text(item.title));
    const guid = typeof item.guid==='string' ? item.guid : item.guid?.['#text'];
    const volcano = /^https:\/\/volcano\.si\.edu\/reports_weekly\.cfm#vn_(\d{6})$/.exec(guid || '')?.[1];
    const week = heading && archiveWeek(heading[2]);
    if (!volcano || !week) continue;
    const coordinates = text(item.point).split(/\s+/).filter(Boolean);
    const [lat,lon] = coordinates.map(Number);
    const placed = coordinates.length===2 && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180;
    const archive = 'GVP.WVAR'+week+'-'+volcano;
    const status = heading[3];
    const report = event({
      key:'gvp-weekly:'+archive,ts:item.pubDate,
      title:heading[1]+' · '+status,
      summary:'Preliminary Weekly Volcanic Activity Report for '+heading[2]+
        '. The original report lists the contributing observatories and monitoring agencies.',
      source:weeklyVolcanoSource,url:'https://volcano.si.edu/showreport.cfm?gvpvar='+archive,
      confidence:'Official weekly synthesis',category:'geo',kind:'volcano_weekly',score:status.startsWith('New ') ? 64 : 45,
      ...(placed ? {lon,lat,place:heading[1],place_basis:'catalog_point',
        location_note:'Volcano location from the Global Volcanism Program.'} : {})
    },now);
    if (report) reports.set(report.id,report);
  }
  return [...reports.values()];
}

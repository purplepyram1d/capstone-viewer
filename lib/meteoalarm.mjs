import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { event, safeUrl, text } from './events.mjs';
import { countries } from './geography.mjs';
import { alertArea } from './weather-alerts.mjs';

const provider = 'https://feeds.meteoalarm.org';
export const meteoAlarmDirectory = provider + '/';
export const meteoRegions = [
  ['FR','france'],['DE','germany'],['IT','italy'],['PL','poland'],['ES','spain'],['GB','united-kingdom'],
  ['AT','austria'],['BE','belgium'],['CZ','czechia'],['DK','denmark'],['FI','finland'],['GR','greece'],
  ['IS','iceland'],['IE','ireland'],['NL','netherlands'],['NO','norway'],['PT','portugal'],['SE','sweden']
].map(([country,slug])=>({country,slug,label:'MeteoAlarm · '+countries[country].name}));
export const meteoAlarmUrl = region => provider + '/feeds/meteoalarm-legacy-atom-' + region.slug;

const parser = new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:false,parseTagValue:false});
const list = value => Array.isArray(value) ? value : value == null ? [] : [value];
const string = value => typeof value === 'string' ? value : value?.['#text'];
const utc = stamp => new Date(stamp).toISOString().replace('T',' ').slice(0,16) + ' UTC';

const sourceTime = value => {
  const stamp = string(value) || '';
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ? Date.parse(stamp) : NaN;
};

function sourceNotice(row,region) {
  const cap = list(row.link).find(link=>link?.['@_type']==='application/cap+xml');
  const href = safeUrl(cap?.['@_href']);
  if (!href) return null;
  const url = new URL(href);
  const prefix = '/api/v1/warnings/feeds-' + region.slug + '/';
  if (url.origin!==provider || !url.pathname.startsWith(prefix)) return null;
  const id = url.pathname.slice(prefix.length);
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? provider+prefix+id.toLowerCase() : null;
}

function rings(value) {
  return list(value).map(string).filter(value=>typeof value==='string').flatMap(value=>{
    const ring = value.trim().split(/\s+/).map(token=>{
      const parts = token.split(',');
      return parts.length === 2 && parts.every(part=>/^-?\d+(?:\.\d+)?$/.test(part)) ? [Number(parts[1]),Number(parts[0])] : null;
    });
    if (ring.length<4 || ring.some(point=>!point)) return [];
    return [ring];
  });
}

export function normalizeMeteoAlarm(xml,region,now=Date.now()) {
  if (XMLValidator.validate(xml)!==true) throw Error('Expected MeteoAlarm Atom XML');
  const feed = parser.parse(xml).feed;
  if (!/^MeteoAlarm\b/i.test(string(feed?.title) || '')) throw Error('Expected a MeteoAlarm feed');
  const notices = new Map();
  for (const row of list(feed.entry)) {
    if (row?.scope!=='Public' || row.status!=='Actual' || !['Alert','Update'].includes(row.message_type) ||
      !['Severe','Extreme'].includes(row.severity)) continue;
    const expires=sourceTime(row.expires), sent=sourceTime(row.sent || row.published);
    const href=sourceNotice(row,region);
    const eventName=text(string(row.event));
    if (!href || !eventName || !Number.isFinite(expires) || expires<=now || !Number.isFinite(sent)) continue;
    const prior=notices.get(href);
    const area=text(string(row.areaDesc));
    if (!prior) {
      notices.set(href,{href,sent,expires,onset:sourceTime(row.onset || row.effective),
        name:eventName,severity:row.severity,update:row.message_type==='Update',
        areas:new Set(area?[area]:[]),polygons:rings(row.polygon)});
    } else {
      if (area) prior.areas.add(area);
      if (prior.polygons.length < 32) prior.polygons.push(...rings(row.polygon));
      prior.expires=Math.max(prior.expires,expires);
      if (row.severity==='Extreme') prior.severity='Extreme';
    }
  }
  const country = countries[region.country];
  return [...notices.values()].flatMap(notice=>{
    const geometry = {type:'MultiPolygon',coordinates:notice.polygons.map(ring=>[ring])};
    const area = alertArea(geometry);
    const areas = [...notice.areas].join('; ');
    const summary = [
      'Severity at issue: '+notice.severity+'.',
      Number.isFinite(notice.onset) ? 'Source onset '+utc(notice.onset)+'.' : '',
      'Latest bulletin expiration '+utc(notice.expires)+'.',
      areas ? 'Areas named by source: '+areas.slice(0,185)+(areas.length>185?'…':'.') : '',
      'EUMETNET member data via MeteoAlarm.'
    ].filter(Boolean).join(' ');
    const report = event({
      key:'meteoalarm:'+notice.href,ts:new Date(notice.sent).toISOString(),
      source:region.label,title:notice.name+(notice.update?' update':'')+' · '+country.name,summary,
      url:notice.href,category:'geo',kind:'weather_alert',confidence:'Official weather bulletin',
      score:notice.severity==='Extreme'?82:58,country:region.country,weather_valid_until:new Date(notice.expires).toISOString(),
      ...(area ? {...area,place:areas.slice(0,140)||country.name,place_basis:'international_weather_area',
        location_note:'Point within the publisher’s alert area.'} :
        {lon:country.lon,lat:country.lat,place:country.name,place_basis:'country_centroid',
          location_note:'Approximate country reference point. See the original for the areas named.'})
    },now);
    return report ? [report] : [];
  });
}
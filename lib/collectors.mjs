import {putinEntities,putinNewsUrl,normalizePutinNews} from './putin.mjs';
import { muskEntities, muskNewsUrl, normalizeMuskNews } from './musk.mjs';
import { readFileSync } from 'node:fs';
import { DAY, event, normalizeKEV, normalizeVictims, parseRSS, headlinePlace } from './events.mjs';
import { iodaUrl, normalizeIODA, iodaStateUrl, normalizeIodaStates, normalizeRadarOutages, normalizeRadarHijacks } from './internet.mjs';
import { nvdUrl, normalizeNVD, normalizeThreatFox, normalizeURLhaus } from './threats.mjs';
import { createGdelt, gdeltBase } from './gdelt.mjs';
import { gdacsUrl, normalizeGDACS } from './gdacs.mjs';
import { swpcUrl, normalizeSWPC } from './space-weather.mjs';
import { weatherSource, weatherAlertsUrl, normalizeWeatherAlerts } from './weather-alerts.mjs';
import { canadaWeatherSource, canadaWeatherUrl, normalizeCanadaWeather } from './canada-weather.mjs';
import { mappingName, mappingUrl, normalizeRapidMapping } from './rapid-mapping.mjs';
import { usgsVolcanoName, usgsVolcanoUrl, geonetVolcanoName, geonetVolcanoUrl, normalizeUSGSVolcanoes, normalizeGeoNetVolcanoes } from './volcano-bulletins.mjs';
import { normalizeTsunami, tsunamiCenters, tsunamiUrl } from './tsunami.mjs';
import { vendorAdvisoryFeeds } from './vendor-advisories.mjs';
import { canadaCyberSource, canadaCyberUrl, normalizeCanadaCyber } from './canada-cyber.mjs';
import { jpcertSource, jpcertUrl, jvnSource, jvnUrl, normalizeJPCERT, normalizeJVN } from './japan-advisories.mjs';
import { stateForPoint } from './us-geography.mjs';
import { reportProvince } from './ca-geography.mjs';
import { normalizeWildfires, wildfireSource, wildfireUrl } from './wildfires.mjs';
import { bcWildfireSource, bcWildfireUrl, normalizeBcWildfires } from './bc-wildfires.mjs';
import { riverGaugeSource, riverGaugeUrl, normalizeRiverGauges } from './river-gauges.mjs';
import { stormReportSource, stormReportUrl, normalizeStormReports } from './local-storm-reports.mjs';
import { geoNetQuakeSource, geoNetQuakeUrl, normalizeGeoNetQuakes } from './geonet-quakes.mjs';
import { meteoAlarmDirectory, meteoRegions, meteoAlarmUrl, normalizeMeteoAlarm } from './meteoalarm.mjs';
import { eonetName, eonetUrl, normalizeEonet } from './eonet.mjs';
import { nhcSource, nhcUrl, normalizeNHC } from './nhc.mjs';
import { femaSource, femaUrl, normalizeFemaDeclarations } from './fema-declarations.mjs';
import { ifrcSource, ifrcUrl, normalizeIfrcEmergencies } from './ifrc-emergencies.mjs';
import { weeklyVolcanoSource, weeklyVolcanoUrl, normalizeWeeklyVolcanoes } from './weekly-volcanoes.mjs';
import { jmaQuakeSource, jmaQuakeUrl, normalizeJmaQuakes } from './jma-earthquakes.mjs';
import { emscSource, emscUrl, normalizeEmscQuakes } from './emsc-earthquakes.mjs';
import { gaQuakeSource, gaQuakeUrl, normalizeGaQuakes } from './ga-earthquakes.mjs';
import { faaAirportSource, faaAirportUrl, normalizeFaaAirports } from './faa-airports.mjs';
import { createEaFloodCollector, eaFloodSource, eaFloodUrl } from './ea-floods.mjs';
import { workZoneClosureFeeds } from './wzdx-closures.mjs';
import { caltransClosureFeeds } from './caltrans-closures.mjs';
import { createDriveBcCollector, driveBcSource, driveBcUrl } from './drivebc-closures.mjs';
import { countries, resolveCountry } from './geography.mjs';
const root = new URL('../', import.meta.url);
const hqs = JSON.parse(readFileSync(new URL('config/headquarters.json', root)));
const gdelt = createGdelt({resolve:resolveCountry,countries});
const collectEaFloods = createEaFloodCollector(async url=>JSON.parse(await fetchText(url,{timeout:20_000,headers:{Accept:'application/json'}})));
const collectDriveBc = createDriveBcCollector(async url=>JSON.parse(await fetchText(url,{timeout:20_000,headers:{Accept:'application/json'}})));
export const feeds = [
  ...putinEntities.map(entity=>({id:'putin-'+entity.id,name:'Putin tracker: '+entity.name,url:putinNewsUrl(entity),tracker:'putin',intervalMs:900000,collect:async()=>normalizePutinNews(await fetchText(putinNewsUrl(entity)))})),
  ...muskEntities.map(entity=>({id:'musk-'+entity.id,name:'Elon tracker: '+entity.name,url:muskNewsUrl(entity),tracker:'musk',intervalMs:900000,collect:async()=>normalizeMuskNews(await fetchText(muskNewsUrl(entity)))})),
  { id: 'kev', name: 'CISA KEV', url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    fallback: 'https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json', format: 'json', parse: data => normalizeKEV(data, hqs) },
  { id: 'ransomware', name: 'ransomware.live', url: 'https://www.ransomware.live/rss.xml', category: 'cyber', score: 65 },
  { id: 'cisa', name: 'CISA advisories', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', category: 'cyber', score: 70 },
  { id: 'bbc', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'geo', score: 55 },
  { id: 'guardian-world', conditional: true, name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss', category: 'geo', score: 50, intervalMs: 900000 },
  { id: 'un-news', name: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', category: 'geo', score: 50, intervalMs: 900000 },
  { id: 'cert-fr', conditional: true, name: 'CERT-FR advisories', url: 'https://www.cert.ssi.gouv.fr/avis/feed/', category: 'cyber', score: 60, intervalMs: 900000, confidence: 'Official advisory' },
  { id: 'cert-eu', name: 'CERT-EU advisories', url: 'https://cert.europa.eu/publications/security-advisories-rss', category: 'cyber', kind: 'advisory', score: 65, intervalMs: 900000, confidence: 'Official advisory',
    date: value => String(value || '').replace(/\s+(CET|CEST)$/i, (_, zone) => zone.toUpperCase() === 'CEST' ? ' +0200' : ' +0100') },
  ...vendorAdvisoryFeeds,
  { id: 'cccs', conditional:true, desk:'cyber', name:canadaCyberSource, url:canadaCyberUrl, intervalMs:900000, parse:normalizeCanadaCyber },
  { id: 'jvn', conditional: true, desk:'cyber', name:jvnSource, url:jvnUrl, intervalMs:900000, parse:normalizeJVN },
  { id: 'jpcert', conditional: true, desk:'cyber', name:jpcertSource, url:jpcertUrl, intervalMs:900000, parse:normalizeJPCERT },
  { id: 'uk-ncsc', name: 'UK NCSC publications', url: 'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml', category: 'cyber', score: 60, intervalMs: 900000, confidence: 'Official agency publication' },
  { id: 'deepmind', conditional: true, name:'Google DeepMind', url:'https://deepmind.google/blog/rss.xml', category:'ai',
    intervalMs:900000, score:53, confidence:'Company announcement' },
  { id: 'cmu-robotics', conditional: true, name:'CMU Robotics Institute', url:'https://www.ri.cmu.edu/feed/', category:'ai',
    intervalMs:1800000, score:48, confidence:'University statement · robotics research' },
  { id: 'ieee-robotics', conditional: true, name:'IEEE Spectrum Robotics', url:'https://spectrum.ieee.org/feeds/topic/robotics.rss', category:'ai',
    intervalMs:900000, score:50, confidence:'Publisher reporting' },
  { id: 'openai', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', category: 'ai', score: 55,
    placement: { lat: 37.7749, lon: -122.4194, place: 'San Francisco · OpenAI HQ city', place_basis: 'company_hq' } },
  { id:'emsc-earthquakes', desk:'geo', group:'hazards', name:emscSource, url:emscUrl(), urlFn:emscUrl, format:'json',
    timeout:25000, intervalMs:900000, allowNoContent:true, parse:normalizeEmscQuakes },
  { id:'ga-earthquakes', desk:'geo', group:'hazards', name:gaQuakeSource, url:gaQuakeUrl, format:'json',
    intervalMs:600000, conditional:true, parse:normalizeGaQuakes },
  { id:'jma-earthquakes', desk:'geo', group:'hazards', name:jmaQuakeSource, url:jmaQuakeUrl, format:'json',
    intervalMs:600000, conditional:true, parse:normalizeJmaQuakes },
  { id: 'usgs', desk: 'geo', group:'hazards', name: 'USGS earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson', format: 'json', parse: data => {
    if (!Array.isArray(data.features)) throw new Error('Invalid USGS feed');
    return data.features.flatMap(feature => {
      const record = feature?.properties;
      const point = feature?.geometry?.coordinates;
      if (!Number.isFinite(record?.time) || !Number.isFinite(record.mag) || !Array.isArray(point)) return [];
      const [lon, lat, depth] = point;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90 || Math.abs(record.time) > 8.64e15 ||
          (record.type && record.type!=='earthquake')) return [];
      if (record.mag < 2.5 || (record.mag < 4.5 && !stateForPoint(lon,lat) && !reportProvince({lon,lat,place_basis:'seismic_origin'}))) return [];
      const status = record.status==='reviewed' ? ' · reviewed by source' : record.status==='automatic' ? ' · automatic solution' : '';
      const reportedDepth = Number.isFinite(depth) ? ` Reported depth ${depth} km.` : '';
      const impact = ['green','yellow','orange','red'].includes(record.alert) ? record.alert : '';
      const impactNote = impact ? ` PAGER ${impact.toUpperCase()} is a USGS model estimate of impact.` : '';
      const impactPriority = {green:0,yellow:70,orange:92,red:97};
      const intensity = value => Number.isFinite(value) && value>=1 && value<=12;
      const seismic = {
        ...(intensity(record.mmi) ? {shakemap:record.mmi} : {}),
        ...(Number.isSafeInteger(record.felt) && record.felt>0 ? {felt:record.felt} : {}),
        ...(intensity(record.cdi) ? {reported:record.cdi} : {})
      };
      const report = event({ ts: new Date(record.time).toISOString(), title: record.title,
        summary: `Magnitude ${record.mag} earthquake.${reportedDepth} Epicenter from USGS.${impactNote}`,
        url: record.url, category: 'geo', kind: 'earthquake', magnitude:record.mag,
        ...(Object.keys(seismic).length ? {seismic} : {}),source: 'USGS earthquakes', confidence: 'Official measurement' + status,
        score: Math.max(record.mag >= 6 ? 90 : 40,impactPriority[impact] || 0),lon,lat,place:record.place,place_basis:'seismic_origin' });
      return report ? [report] : [];
    });
  } },
  ...tsunamiCenters.map(center=>({
    id:center.id, desk:'geo', group:'hazards', name:center.label, url:tsunamiUrl(center), parse:xml=>normalizeTsunami(xml,center)
  })),
  { id: 'gdacs', desk: 'geo', group:'hazards', name: 'GDACS hazard alerts', url: gdacsUrl, intervalMs: 900000, parse: normalizeGDACS },
  { id: 'nifc-wildfire', desk:'geo', group:'hazards', name:wildfireSource, url:wildfireUrl, format:'json', intervalMs:900000, parse:normalizeWildfires },
  { id:'bc-wildfire', desk:'geo', group:'hazards', name:bcWildfireSource, url:bcWildfireUrl(), urlFn:bcWildfireUrl, format:'json', intervalMs:900000, parse:normalizeBcWildfires },
  ...meteoRegions.map(region=>({id:'meteo-'+region.country.toLowerCase(),desk:'geo',group:'weather',name:region.label,
    url:meteoAlarmUrl(region),intervalMs:900000,timeout:20000,conditional:true,currentListings:true,parse:data=>normalizeMeteoAlarm(data,region),
    profile:{evidence:'Official weather bulletin',description:'Severe and extreme warnings for '+countries[region.country].name+' from national weather services via MeteoAlarm (CC BY 4.0).',url:meteoAlarmDirectory}})),
  { id:'nwps-observed', desk:'geo', group:'hazards', name:riverGaugeSource, url:riverGaugeUrl, format:'json', intervalMs:1800000, parse:normalizeRiverGauges },
  { id:'nws-storm-reports', desk:'geo', group:'hazards', name:stormReportSource, url:stormReportUrl, format:'json', intervalMs:900000, parse:normalizeStormReports },
  { id: 'nws-alerts', desk:'geo', group:'weather', name:weatherSource, url:weatherAlertsUrl, currentListings:true, format:'json', parse:normalizeWeatherAlerts },
  { id: 'eccc-weather', desk:'geo', group:'weather', name:canadaWeatherSource, url:canadaWeatherUrl, currentListings:true, format:'json', parse:normalizeCanadaWeather },
  { id: 'usgs-volcano', desk:'geo', group:'hazards', name:usgsVolcanoName, url:usgsVolcanoUrl, intervalMs:1800000, format:'json', parse:normalizeUSGSVolcanoes },
  { id:'gvp-volcano-weekly', desk:'geo', group:'hazards', name:weeklyVolcanoSource, url:weeklyVolcanoUrl, intervalMs:3600000,
    conditional:true,encoding:'iso-8859-1',parse:normalizeWeeklyVolcanoes },
  { id:'geonet-earthquakes', desk:'geo', group:'hazards', name:geoNetQuakeSource, url:geoNetQuakeUrl, format:'json', conditional:true, parse:normalizeGeoNetQuakes },
  { id: 'geonet-volcano', desk:'geo', group:'hazards', name:geonetVolcanoName, url:geonetVolcanoUrl, intervalMs:1800000, format:'json', parse:normalizeGeoNetVolcanoes },
  { id:'eonet',desk:'geo',group:'hazards',name:eonetName,url:eonetUrl,intervalMs:1800000,format:'json',parse:normalizeEonet },
  { id:'nhc-cyclones',desk:'geo',group:'weather',name:nhcSource,url:nhcUrl,intervalMs:600000,format:'json',conditional:true,parse:normalizeNHC },
  { id:'fema-declarations',desk:'geo',group:'hazards',name:femaSource,url:femaUrl(),urlFn:femaUrl,intervalMs:3600000,format:'json',parse:normalizeFemaDeclarations },
  { id:'ifrc-emergencies', desk:'geo', group:'hazards', name:ifrcSource, url:ifrcUrl(), urlFn:ifrcUrl, format:'json', intervalMs:3600000, parse:normalizeIfrcEmergencies },
  { id: 'copernicus-mapping', desk:'geo', group:'hazards', name:mappingName, url:mappingUrl, intervalMs:1800000, format:'json', parse:normalizeRapidMapping },
  { id: 'swpc', desk: 'geo', group:'weather', name: 'NOAA geomagnetic storm bulletins', url: swpcUrl, intervalMs: 900000, format: 'json', parse: normalizeSWPC },
  { id:'ea-floods', desk:'geo', group:'weather', name:eaFloodSource, url:eaFloodUrl, currentListings:true, collect:collectEaFloods },
  ...caltransClosureFeeds,
  ...workZoneClosureFeeds,
  {id:'drivebc-closures',desk:'geo',group:'transport',name:driveBcSource,url:driveBcUrl,currentListings:true,collect:collectDriveBc},
  { id:'faa-airports', desk:'geo', group:'transport', name:faaAirportSource, url:faaAirportUrl, currentListings:true, format:'json', parse:normalizeFaaAirports },
  { id: 'ioda', desk: 'internet', name: 'IODA internet outages', currentListings:true, url: iodaUrl(), urlFn: iodaUrl, format: 'json', timeout: 45000, parse: data => normalizeIODA(data, countries) },
  { id:'ioda-us-states',desk:'internet',name:'IODA U.S. state disruption signals',currentListings:true,url:iodaStateUrl(),urlFn:iodaStateUrl,format:'json',intervalMs:600000,timeout:30000,
    parse:normalizeIodaStates,profile:{evidence:'Automated connectivity measurement',description:'Reported state-level signal drops lasting at least 15 minutes. State reference points show the measurement region; the source does not assign cause or local impact.',url:'https://api.ioda.inetintel.cc.gatech.edu/v2/docs'} },
  // Cloudflare Radar needs the user's free API token (Feeds page); without it these feeds wait as needs-key.
  { id: 'radar-outages', desk: 'internet', name: 'Cloudflare Radar outages', currentListings:true, url: 'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=7d&limit=100&format=json', requires: 'radar', format: 'json', parse: data => normalizeRadarOutages(data, countries) },
  { id: 'radar-hijacks', desk: 'internet', name: 'Cloudflare Radar BGP hijacks', url: 'https://api.cloudflare.com/client/v4/radar/bgp/hijacks/events?dateRange=7d&minConfidence=8&per_page=100&sortBy=TIME&sortOrder=DESC&format=json', requires: 'radar', format: 'json', parse: data => normalizeRadarHijacks(data, countries) },
  { id: 'nvd', name: 'NVD critical CVEs', url: nvdUrl(), urlFn: nvdUrl, format: 'json', timeout: 45000, parse: data => normalizeNVD(data) },
  // abuse.ch retired its keyless exports in 2025; both APIs need the user's free Auth-Key.
  { id: 'threatfox', name: 'ThreatFox (abuse.ch)', url: 'https://threatfox-api.abuse.ch/api/v1/', method: 'POST', body: JSON.stringify({ query: 'get_iocs', days: 1 }), requires: 'abusech', format: 'json', timeout: 45000, parse: data => normalizeThreatFox(data) },
  // GDELT keeps its own per-file state, so it supplies a collect function instead of one URL.
  { id: 'gdelt', desk: 'geo', name: 'GDELT conflict events', url: gdeltBase, collect: () => gdelt.collect() },
  { id: 'urlhaus', name: 'URLhaus (abuse.ch)', url: 'https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1000/', requires: 'abusech', format: 'json', timeout: 45000, parse: data => normalizeURLhaus(data) }
];
// How each keyed provider expects its token.
const authHeaders = { radar: token => ({ Authorization: `Bearer ${token}` }), abusech: token => ({ 'Auth-Key': token }) };

const MAX_FEED_BYTES = 12_000_000;
export const DEFAULT_POLL_MS = 300_000;

export function nextCollectorPoll(feed, previous, now) {
  const lastStarted = Date.parse(previous.lastAttempt);
  const due = Number.isFinite(lastStarted) ? lastStarted + (feed.intervalMs || DEFAULT_POLL_MS) : now;
  const retry = Date.parse(previous.retryAfter);
  return Math.max(now, due, Number.isFinite(retry) ? retry : now);
}

const conditionalVersion = 1;
const validator = value => typeof value === 'string' && /^[\x20-\x7e]{1,512}$/.test(value) ? value : null;

async function fetchPayload(url, {headers = {}, timeout = 15000, method = 'GET', body, request = fetch, conditional = false, previous, encoding='utf-8'} = {}) {
  const etag = conditional && previous?.url === url && previous.version === conditionalVersion ? validator(previous.etag) : null;
  const modified = conditional && previous?.url === url && previous.version === conditionalVersion ? validator(previous.modified) : null;
  const response = await request(url, {method,body,signal:AbortSignal.timeout(timeout),headers:{
    'User-Agent':'CapstoneViewer/0.1 (+local OSINT dashboard)',
    Accept:'application/json, application/rss+xml, application/xml, text/xml, */*',
    ...(body ? {'Content-Type':'application/json'} : {}),
    ...(etag ? {'If-None-Match':etag} : {}),
    ...(modified ? {'If-Modified-Since':modified} : {}),
    ...headers
  }});
  if (response.status === 304 && (etag || modified)) return {unchanged:true,validators:previous};
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`HTTP ${response.status}`);
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter && [429, 503].includes(response.status)) {
      const retryAt = /^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
      if (Number.isFinite(retryAt) && retryAt > Date.now() && retryAt <= 8.64e15) error.retryAt = retryAt;
    }
    throw error;
  }
  if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES) {
    await response.body?.cancel();
    throw new Error('Feed exceeds size limit');
  }
  const responseEtag = conditional ? validator(response.headers.get('etag')) : null;
  const responseModified = conditional ? validator(response.headers.get('last-modified')) : null;
  const validators = responseEtag || responseModified ?
    {url,version:conditionalVersion,etag:responseEtag,modified:responseModified} : null;
  if (!response.body) return {body:'',validators,noContent:response.status===204};
  let bytes = 0;
  const parts = [];
  const decoder = new TextDecoder(encoding);
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_FEED_BYTES) throw new Error('Feed exceeds size limit');
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  parts.push(decoder.decode());
  return {body:parts.join(''),validators};
}

export async function fetchText(url, options) {
  return (await fetchPayload(url,options)).body;
}

function parseFeed(feed, body) {
  if (feed.format === 'json') return feed.parse(JSON.parse(body));
  if (feed.parse) return feed.parse(body);
  return parseRSS(body).map(row => {
    if (feed.id === 'ransomware') {
      const country = countries[String(row.country || '').toUpperCase()];
      return event({ ...row, title: `Claim: ${String(row.title).replace(/^🏴‍☠️\s*/, '')}`, summary: 'Unconfirmed ransomware leak-site claim, tracked by ransomware.live. No victim confirmation has been established by this app.',
        source: feed.name, category:'cyber', kind:'ransomware', score:65, confidence:'Unconfirmed actor claim',
        ...(country ? { lat:country.lat,lon:country.lon,place:country.name,place_basis:'country_centroid' } : {}) });
    }
    const ts = (feed.date ? feed.date(row.ts) : row.ts);
    const datePrecision = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? 'day' : 'timestamp';
    return event({ ...row, ts, date_precision:datePrecision, source: feed.name, category: feed.category, kind: feed.kind || 'report',
      score: feed.score, confidence: feed.confidence || (feed.id === 'cisa' ? 'Official advisory' : feed.id === 'openai' ? 'Company announcement' : 'Single source report'),
      ...(feed.placement || (feed.id === 'bbc' ? headlinePlace(String(row.title), countries) : {})) });
  }).filter(Boolean);
}

export async function collect(feed, token = '', {request = fetch, validators} = {}) {
  if (feed.collect) return { events: await feed.collect(), usedUrl: feed.url };
  const primary = feed.urlFn ? feed.urlFn() : feed.url;
  const options = { request, timeout: feed.timeout, method: feed.method, body: feed.body, encoding:feed.encoding,
    headers: feed.requires && token ? authHeaders[feed.requires](token) : {} };
  const collectFrom = async usedUrl => {
    const result = await fetchPayload(usedUrl,{...options,conditional:feed.conditional,previous:validators});
    const events = result.unchanged || (feed.allowNoContent && result.noContent) ? [] :
      parseFeed(feed,result.body).filter(event=>Date.parse(event.ts)>=Date.now()-30*DAY);
    return {events,usedUrl,unchanged:Boolean(result.unchanged),validators:result.validators};
  };
  try {
    return await collectFrom(primary);
  } catch (error) {
    if (!feed.fallback) throw error;
    try {
      return await collectFrom(feed.fallback);
    } catch (mirrorError) {
      const failure = new Error(`Primary ${String(error.message).slice(0, 110)} · Mirror ${String(mirrorError.message).slice(0, 110)}`, { cause: mirrorError });
      failure.retryAt = Math.max(error.retryAt || 0, mirrorError.retryAt || 0);
      throw failure;
    }
  }
}

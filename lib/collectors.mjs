import {putinEntities,putinNewsUrl,normalizePutinNews} from './putin.mjs';
import { muskEntities, muskNewsUrl, normalizeMuskNews } from './musk.mjs';
import { readFileSync } from 'node:fs';
import { DAY, event, normalizeKEV, normalizeVictims, parseRSS, headlinePlace } from './events.mjs';
import { iodaUrl, normalizeIODA, normalizeRadarOutages, normalizeRadarHijacks } from './internet.mjs';
import { nvdUrl, normalizeNVD, normalizeThreatFox, normalizeURLhaus } from './threats.mjs';
import { createGdelt } from './gdelt.mjs';
import { createCountryResolver } from './hotspots.mjs';
const root = new URL('../', import.meta.url);
const hqs = JSON.parse(readFileSync(new URL('config/headquarters.json', root)));
const countries = JSON.parse(readFileSync(new URL('assets/countries.json', root)));
const gdelt = createGdelt({ resolve: createCountryResolver(JSON.parse(readFileSync(new URL('assets/world.json', root))), countries), countries });
export const feeds = [
  ...putinEntities.map(entity=>({id:'putin-'+entity.id,name:'Putin tracker: '+entity.name,url:putinNewsUrl(entity),tracker:'putin',intervalMs:900000,collect:async()=>normalizePutinNews(await fetchText(putinNewsUrl(entity)))})),
  ...muskEntities.map(entity=>({id:'musk-'+entity.id,name:'Elon tracker: '+entity.name,url:muskNewsUrl(entity),tracker:'musk',intervalMs:900000,collect:async()=>normalizeMuskNews(await fetchText(muskNewsUrl(entity)))})),
  { id: 'kev', name: 'CISA KEV', url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    fallback: 'https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json', format: 'json', parse: data => normalizeKEV(data, hqs) },
  { id: 'ransomware', name: 'ransomware.live', url: 'https://www.ransomware.live/rss.xml', category: 'cyber', score: 65 },
  { id: 'cisa', name: 'CISA advisories', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', category: 'cyber', score: 70 },
  { id: 'bbc', name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'geo', score: 55 },
  { id: 'openai', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', category: 'ai', score: 55,
    placement: { lat: 37.7749, lon: -122.4194, place: 'San Francisco · OpenAI HQ city', place_basis: 'company_hq' } },
  { id: 'usgs', name: 'USGS earthquakes', url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', format: 'json', parse: data => {
    if (!Array.isArray(data.features)) throw new Error('Invalid USGS feed');
    return data.features.map(f => event({ ts: new Date(f.properties.time).toISOString(), title: f.properties.title, summary: `Magnitude ${f.properties.mag} earthquake. Coordinates supplied by USGS.`,
      url: f.properties.url, category: 'geo', kind: 'earthquake', source: 'USGS earthquakes', confidence: 'Official measurement',
      score: f.properties.mag >= 6 ? 90 : 40, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], place: f.properties.place, place_basis: 'event_location' })).filter(Boolean);
  } },
  { id: 'ioda', name: 'IODA internet outages', url: iodaUrl(), urlFn: iodaUrl, format: 'json', timeout: 45000, parse: data => normalizeIODA(data, countries) },
  // Cloudflare Radar needs the user's free API token (Feeds page); without it these feeds wait as needs-key.
  { id: 'radar-outages', name: 'Cloudflare Radar outages', url: 'https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=7d&limit=100&format=json', requires: 'radar', format: 'json', parse: data => normalizeRadarOutages(data, countries) },
  { id: 'radar-hijacks', name: 'Cloudflare Radar BGP hijacks', url: 'https://api.cloudflare.com/client/v4/radar/bgp/hijacks/events?dateRange=7d&minConfidence=8&per_page=100&sortBy=TIME&sortOrder=DESC&format=json', requires: 'radar', format: 'json', parse: data => normalizeRadarHijacks(data, countries) },
  { id: 'nvd', name: 'NVD critical CVEs', url: nvdUrl(), urlFn: nvdUrl, format: 'json', timeout: 45000, parse: data => normalizeNVD(data) },
  // abuse.ch retired its keyless exports in 2025; both APIs need the user's free Auth-Key.
  { id: 'threatfox', name: 'ThreatFox (abuse.ch)', url: 'https://threatfox-api.abuse.ch/api/v1/', method: 'POST', body: JSON.stringify({ query: 'get_iocs', days: 1 }), requires: 'abusech', format: 'json', timeout: 45000, parse: data => normalizeThreatFox(data) },
  // GDELT keeps its own per-file state, so it supplies a collect function instead of one URL.
  { id: 'gdelt', name: 'GDELT conflict events', url: 'http://data.gdeltproject.org/gdeltv2/', collect: () => gdelt.collect() },
  { id: 'urlhaus', name: 'URLhaus (abuse.ch)', url: 'https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1000/', requires: 'abusech', format: 'json', timeout: 45000, parse: data => normalizeURLhaus(data) }
];
// How each keyed provider expects its token.
const authHeaders = { radar: token => ({ Authorization: `Bearer ${token}` }), abusech: token => ({ 'Auth-Key': token }) };

export async function fetchText(url, { headers = {}, timeout = 15000, method = 'GET', body } = {}) {
  const response = await fetch(url, { method, body, signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'CapstoneViewer/0.1 (+local OSINT dashboard)', Accept: 'application/json, application/rss+xml, application/xml, text/xml, */*', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const content = await response.text();
  if (content.length > 12_000_000) throw new Error('Feed exceeds size limit');
  return content;
}

export async function collect(feed, token = '') {
  if (feed.collect) return { events: await feed.collect(), usedUrl: feed.url };
  let body, usedUrl = feed.urlFn ? feed.urlFn() : feed.url;
  const options = { timeout: feed.timeout, method: feed.method, body: feed.body, headers: feed.requires && token ? authHeaders[feed.requires](token) : {} };
  try { body = await fetchText(usedUrl, options); }
  catch (error) { if (!feed.fallback) throw error; body = await fetchText(feed.fallback, options); usedUrl = feed.fallback; }
  let events;
  if (feed.format === 'json') events = feed.parse(JSON.parse(body));
  else events = parseRSS(body).map(row => {
    if (feed.id === 'ransomware') {
      const country = countries[String(row.country || '').toUpperCase()];
      return event({ ...row, title: `Claim: ${String(row.title).replace(/^🏴‍☠️\s*/, '')}`, summary: 'Unconfirmed ransomware leak-site claim, tracked by ransomware.live. No victim confirmation has been established by this app.',
        source: feed.name, category:'cyber', kind:'ransomware', score:65, confidence:'Unconfirmed actor claim',
        ...(country ? { lat:country.lat,lon:country.lon,place:country.name,place_basis:'country_centroid' } : {}) });
    }
    return event({ ...row, source: feed.name, category: feed.category, kind: 'report',
      score: feed.score, confidence: feed.id === 'cisa' ? 'Official advisory' : feed.id === 'openai' ? 'Company announcement' : 'Single source report',
      ...(feed.placement || (feed.id === 'bbc' ? headlinePlace(String(row.title), countries) : {})) });
  }).filter(Boolean);
  return { events: events.filter(e => Date.parse(e.ts) >= Date.now() - 30 * DAY), usedUrl };
}

import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const DAY = 86400000;
export const safeUrl = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
// NFKC turns styled Unicode (𝗯𝗼𝗹𝗱, ｆｕｌｌ-ｗｉｄｔｈ) into plain letters so titles read cleanly and watchlists match.
export const text = value => String(value ?? '').normalize('NFKC').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export function event(input, now = Date.now()) {
  const ts = Date.parse(input.ts), url = safeUrl(input.url);
  if (!url || !text(input.title) || !Number.isFinite(ts) || ts > now + 300000 || ts < now - 30 * DAY) return null;
  const located = typeof input.lat === 'number' && typeof input.lon === 'number' && Math.abs(input.lat) <= 90 && Math.abs(input.lon) <= 180;
  return { ...input, id: createHash('sha256').update(input.key || url).digest('hex').slice(0, 24), ts: new Date(ts).toISOString(),
    title: text(input.title).slice(0, 350), summary: text(input.summary).slice(0, 500), url,
    category: ['cyber', 'geo', 'ai'].includes(input.category) ? input.category : 'cyber',
    lat: located ? input.lat : null, lon: located ? input.lon : null,
    place: located ? text(input.place) : 'Location not established', place_basis: located ? input.place_basis : 'unlocated',
    cves: [...new Set((`${input.title} ${input.summary}`).match(/CVE-\d{4}-\d{4,}/gi) || [])].map(c => c.toUpperCase()),
    score: Math.max(0, Math.min(100, Number(input.score) || 30)), source: text(input.source),
    confidence: input.confidence || 'Source report', date_precision: input.date_precision || 'timestamp' };
}

export function parseRSS(xml) {
  if (XMLValidator.validate(xml) !== true || !/<(?:rss|feed)(?:\s|>)/i.test(xml)) throw new Error('Expected an RSS or Atom feed');
  const doc = new XMLParser({ ignoreAttributes: false, processEntities: false, removeNSPrefix: true }).parse(xml);
  const rows = doc.rss?.channel?.item || doc.feed?.entry || [];
  return (Array.isArray(rows) ? rows : [rows]).map(row => {
    const links = Array.isArray(row.link) ? row.link : [row.link];
    const link = links.find(l => typeof l === 'string' || !l?.['@_rel'] || l['@_rel'] === 'alternate');
    const scalar = v => typeof v === 'object' && v !== null ? v['#text'] || '' : v;
    return { title: scalar(row.title), country: scalar(Array.isArray(row.category) ? row.category[0] : row.category), url: typeof link === 'object' ? link?.['@_href'] : link,
      ts: scalar(row.pubDate || row.published || row.updated), summary: scalar(row.description || row.summary || row.content) };
  });
}

export function normalizeKEV(data, hqs, now) {
  if (!Array.isArray(data.vulnerabilities)) throw new Error('Invalid KEV catalog');
  return data.vulnerabilities.map(v => {
    const vendor = String(v.vendorProject || '').toLowerCase();
    const hq = hqs.find(h => h.aliases.some(a => vendor === a.toLowerCase()));
    return event({ key: `kev:${v.cveID}`, ts: v.dateAdded, date_precision: 'day', source: 'CISA KEV', category: 'cyber', kind: 'exploitation',
      title: `${v.cveID} · ${v.vulnerabilityName}`, summary: `${v.shortDescription} Required action: ${v.requiredAction}`,
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${encodeURIComponent(v.cveID)}`,
      score: v.knownRansomwareCampaignUse === 'Known' ? 95 : 85, confidence: 'Official catalog · exploitation confirmed',
      ...(hq ? { lat: hq.lat, lon: hq.lon, place: hq.place, place_basis: 'vendor_hq' } : {}) }, now);
  }).filter(Boolean);
}

export function normalizeVictims(data, countries, now) {
  if (!Array.isArray(data)) throw new Error('Invalid ransomware victim list');
  return data.map(v => {
    const country = countries[String(v.country || '').toUpperCase()];
    return event({ key: `ransomware:${v.group_name}:${v.post_title}:${v.discovered || v.published}`, ts: v.discovered || v.published,
      title: `Claim: ${v.group_name || 'Unknown group'} lists ${v.post_title || v.victim || 'an organization'}`,
      summary: 'An entry on a ransomware leak site is an unconfirmed actor claim. It is not evidence of a confirmed breach.',
      url: 'https://www.ransomware.live/', source: 'ransomware.live', category: 'cyber', kind: 'ransomware',
      confidence: 'Unconfirmed actor claim', score: 65,
      ...(country ? { lat: country.lat, lon: country.lon, place: country.name, place_basis: 'country_centroid' } : {}) }, now);
  }).filter(Boolean);
}

// Only infer a country if exactly one full country name appears in a headline.
// This is visibly labelled an inferred country, never an exact incident location.
export function headlinePlace(title, countries) {
  const hits = Object.values(countries).filter(c => c.name.length > 3 && new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title));
  return hits.length === 1 ? { lat: hits[0].lat, lon: hits[0].lon, place: hits[0].name, place_basis: 'country_centroid', location_note: 'Country inferred from headline; verify in source.' } : {};
}

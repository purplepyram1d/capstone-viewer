import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { event, text } from './events.mjs';

export const gdacsUrl = 'https://www.gdacs.org/xml/rss.xml';
const source = 'Global Disaster Awareness and Coordination System (GDACS)';
const names = { FL: 'Flood', TC: 'Tropical cyclone', VO: 'Volcanic activity', WF: 'Wildfire' };
const scores = { Green: 50, Orange: 72, Red: 90 };
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const parser = new XMLParser({ processEntities: false, parseTagValue: false, ignoreAttributes: true });

function clean(value) {
  return typeof value === 'string' ? text(value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name])) : '';
}

function approximatePoint(value) {
  const parts = clean(value).split(' ');
  if (parts.length !== 2 || parts.some(part => !/^-?\d+(?:\.\d+)?$/.test(part))) return {};
  const [lat, lon] = parts.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return {};
  return { lat, lon, place_basis: 'regional_reference' };
}

export function normalizeGDACS(xml, now = Date.now()) {
  const content = xml.replace(/^\uFEFF/, '');
  if (XMLValidator.validate(content) !== true) throw new Error('Invalid GDACS XML');
  const channel = parser.parse(content)?.rss?.channel;
  if (!channel || !/^GDACS\b/i.test(clean(channel.title))) throw new Error('Expected the GDACS alert feed');
  const items = channel.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
  const reports = new Map();
  for (const item of items) {
    const type = item['gdacs:eventtype'];
    const id = item['gdacs:eventid'];
    const level = item['gdacs:alertlevel'];
    if (!Object.hasOwn(names, type) || !Object.hasOwn(scores, level) || !/^\d{1,12}$/.test(id || '')) continue;
    if (item['gdacs:temporary'] === 'true' || (type === 'WF' && level === 'Green')) continue;

    const countries = clean(item['gdacs:country']).split(',').map(name => name.trim()).filter(Boolean);
    const location = countries.length > 2 ? countries.slice(0, 2).join(', ') + ` + ${countries.length - 2} more` : countries.join(', ');
    const name = type === 'TC' || type === 'VO' ? clean(item['gdacs:eventname']) : '';
    const headline = [names[type] + (name ? ' ' + name : ''), location].filter(Boolean).join(' in ');
    const point = approximatePoint(item['georss:point']);
    const detail = clean(item.description);
    const report = event({
      key: `gdacs:${type}:${id}`,
      ts: clean(item.pubDate),
      source, category: 'geo', kind: 'hazard', score: scores[level], hazard_type: names[type],
      title: `GDACS ${level.toLowerCase()} alert · ${headline}`,
      summary: `GDACS estimates potential impact. Check local authorities for emergency instructions.${detail ? ' ' + detail : ''}`,
      url: `https://www.gdacs.org/report.aspx?eventtype=${type}&eventid=${id}`,
      confidence: 'Modeled hazard alert',
      ...point,
      place: location || 'GDACS alert area',
      location_note: point.place_basis ? 'Approximate reference point for the alert area.' : undefined
    }, now);
    if (report && (!reports.has(report.id) || report.ts > reports.get(report.id).ts)) reports.set(report.id, report);
  }
  return [...reports.values()];
}

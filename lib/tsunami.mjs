import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { event, safeUrl, text } from './events.mjs';

const homepage = 'https://www.tsunami.gov/';
const parser = new XMLParser({ignoreAttributes:true,processEntities:false,removeNSPrefix:true,parseTagValue:false});
const list = value => Array.isArray(value) ? value : value ? [value] : [];
const bulletinTypes = {Alert:'Bulletin issued',Update:'Bulletin update',Cancel:'Bulletin cancellation'};

export const tsunamiCenters = [
  {id:'ntwc', label:'NOAA National Tsunami Warning Center', code:'PAAQ', senders:['NTWC','WCATWC']},
  {id:'ptwc', label:'NOAA Pacific Tsunami Warning Center', code:'PHEB', senders:['PTWC']}
];

export const tsunamiUrl = center => `${homepage}events/xml/${center.code}CAP.xml`;

function originalLink(value, code) {
  const url = safeUrl(value);
  if (!url) return '';
  const original = new URL(url);
  if (!['www.tsunami.gov','tsunami.gov'].includes(original.hostname) ||
      !original.pathname.startsWith('/events/' + code + '/') || !/\.txt$/i.test(original.pathname)) return '';
  original.protocol = 'https:';
  return original.href;
}

function sourceLocation(parameters) {
  const place = text(parameters.get('EventLocationName')).slice(0,90);
  const values = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:\s|$)/.exec(parameters.get('EventLatLon') || '');
  if (!place || !values) return {place};
  const lat = Number(values[1]), lon = Number(values[2]);
  if (Math.abs(lat)>90 || Math.abs(lon)>180) return {place};
  return {place,lat,lon,place_basis:'seismic_origin'};
}

export function normalizeTsunami(xml, center, now = Date.now()) {
  if (XMLValidator.validate(xml) !== true) throw new Error('Expected a tsunami CAP bulletin');
  const alert = parser.parse(xml).alert;
  if (!alert || typeof alert !== 'object') throw new Error('Expected a tsunami CAP bulletin');
  if (alert.status !== 'Actual' || alert.scope !== 'Public' ||
      !Object.hasOwn(bulletinTypes,alert.msgType) || !center.senders.includes(alert.source)) return [];
  if (typeof alert.identifier !== 'string' || !alert.identifier.startsWith(center.code + '-') ||
      !/^[A-Za-z0-9-]{6,80}$/.test(alert.identifier) ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(alert.sent || '')) return [];

  const information = list(alert.info).filter(info => /^Tsunami(?:\s|$)/i.test(info?.event || ''));
  if (!information.length) return [];
  const parameters = new Map(list(information[0].parameter).map(entry => [entry?.valueName,entry?.value]));
  const {place,...coordinates} = sourceLocation(parameters);
  const url = information.map(info => originalLink(info.web,center.code)).find(Boolean);
  const informational = information.every(info => /^Tsunami Information(?: Statement)?$/i.test(info.event));
  const cancellation = alert.msgType === 'Cancel';
  const label = cancellation ? 'Tsunami bulletin cancellation' : informational ? 'Tsunami information statement' :
    alert.msgType === 'Update' ? 'Tsunami bulletin update' : 'Tsunami bulletin';
  const headline = information.map(info=>text(info.headline)).find(Boolean)?.slice(0,220);
  const scope = information.length > 1 ? 'See the bulletin for the full set of source messages.' : '';
  const detail = coordinates.place_basis ? 'The map point marks the earthquake origin.' : '';
  const summary = [bulletinTypes[alert.msgType] + ' by ' + center.label + '.',
    headline ? 'Source headline at issuance · ' + headline : '', scope, detail,
    'Open the official bulletin and check local authorities for current alerts.'].filter(Boolean).join(' ');

  const report = event({
    key:'noaa-tsunami:'+alert.identifier, ts:alert.sent,
    title:label + (place ? ' · ' + place : ''), url:url || homepage,
    source_url_scope:url ? 'bulletin' : 'archive', source:center.label,
    summary, category:'geo', kind:'tsunami', confidence:'Official bulletin',
    score:informational || cancellation ? 40 : 65,
    place, ...coordinates
  }, now);
  return report ? [report] : [];
}

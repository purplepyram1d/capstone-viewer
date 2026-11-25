import { event, text } from './events.mjs';

export const mappingName = 'Copernicus EMS Rapid Mapping';
export const mappingUrl = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=100';
export const mappingDirectory = 'https://mapping.emergency.copernicus.eu/activations/';
const naturalHazards = new Set(['earthquake','flood','mass movement','storm','volcanic activity','wildfire','tsunami','drought']);

export function normalizeRapidMapping(data, now = Date.now()) {
  if (!Array.isArray(data?.results)) throw new Error('Expected a Copernicus mapping activation list');
  const reports = [];
  for (const row of data.results) {
    if (!/^EMSR\d{3,8}$/.test(row?.code || '') || !naturalHazards.has(text(row.category).toLowerCase())) continue;
    const name = text(row.name);
    const date = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?)?$/.exec(row.activationTime || '');
    if (!name || !date) continue;
    const midnight = Date.parse(date[1]);
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10) !== date[1]) continue;

    // The API can omit a timezone. Preserve the calendar day unless it provides an offset.
    const activationTime = date[2] ? row.activationTime : date[1];
    const countries = Array.isArray(row.countries) ? row.countries.filter(name=>typeof name === 'string').map(text).filter(Boolean).join(', ') : '';
    const point = /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(row.centroid || '');
    const count = Number.isSafeInteger(row.n_products) && row.n_products >= 0 ? row.n_products : null;
    const summary = [
      row.code + ' · ' + text(row.category) + ' mapping activation.',
      row.closed === true ? 'Mapping status: closed.' : row.closed === false ? 'Mapping status: open.' : '',
      count === null ? '' : count + (count === 1 ? ' published mapping product.' : ' published mapping products.'),
      countries ? 'Countries listed: ' + countries.slice(0,150) + '.' : '',
      'Open the activation for maps and the mapped area.'
    ].filter(Boolean).join(' ');
    const report = event({
      key:'copernicus:' + row.code, ts:activationTime, date_precision:date[2] ? 'timestamp' : 'day',
      source_date_basis:'activation', source:mappingName, title:name, summary,
      url:mappingDirectory + row.code + '/', category:'geo', kind:'mapping_activation',
      confidence:'Official mapping activation', score:55,
      ...(point ? {lon:Number(point[1]),lat:Number(point[2]),place:countries || 'Mapped area',place_basis:'mapping_area'} : {})
    },now);
    if (report) reports.push(report);
  }
  return reports;
}
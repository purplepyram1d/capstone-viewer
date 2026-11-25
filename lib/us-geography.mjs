import { readFileSync } from 'node:fs';
import { createCountryResolver } from './hotspots.mjs';

const atlas = JSON.parse(readFileSync(new URL('../assets/us-states.json', import.meta.url)));
export const usStates = Object.fromEntries(atlas.states.map(state=>[state.code,state]));
const codesByFips = new Map(atlas.areas.features.map(area=>[area.id,area.properties.code]));
const resolve = createCountryResolver(atlas.areas,usStates);

export const isUSState = code => Object.hasOwn(usStates,code);
export const stateForPoint = (lon,lat) => resolve({lon,lat,place_basis:'event_location'});

export function nwsStates(geocode) {
  const ugc = Array.isArray(geocode?.UGC) ? geocode.UGC : [];
  const same = Array.isArray(geocode?.SAME) ? geocode.SAME : [];
  const codes = ugc.length ? ugc.map(code=>typeof code === 'string' && /^[A-Z]{2}[CZ]\d{3}$/.test(code) ? code.slice(0,2) : '') :
    same.map(code=>typeof code === 'string' && /^\d{6}$/.test(code) ? codesByFips.get(code.slice(1,3)) : '');
  return [...new Set(codes.filter(isUSState))].sort();
}

export function statesForReport(report) {
  if (Array.isArray(report.state_codes)) return report.state_codes.filter(isUSState);
  if (report.country==='CA' || !['event_location','seismic_origin','fire_origin','catalog_point','cyclone_center','airport_reference'].includes(report.place_basis)) return [];
  const state = stateForPoint(report.lon,report.lat);
  return state ? [state] : [];
}

export function withReportStates(report) {
  const state_codes = statesForReport(report);
  return state_codes.length ? {...report,state_codes,state_basis:report.state_basis || (['catalog_point','airport_reference'].includes(report.place_basis)?report.place_basis:'reported_point')} : report;
}

import { readFileSync } from 'node:fs';
import { createCountryResolver } from './hotspots.mjs';
import { usStates, withReportStates } from './us-geography.mjs';
import { caProvinces, reportProvince } from './ca-geography.mjs';

export const countries = JSON.parse(readFileSync(new URL('../assets/countries.json',import.meta.url)));
const world = JSON.parse(readFileSync(new URL('../assets/world.json',import.meta.url)));
export const resolveCountry = createCountryResolver(world,countries);
export const geographyOptions = {
  states:Object.values(usStates).map(({code,name,lat,lon})=>({code,name,lat,lon})),
  provinces:Object.values(caProvinces).map(({code,name,lat,lon})=>({code,name,lat,lon})),
  countries:Object.entries(countries).map(([code,{name,lat,lon}])=>({code,name,lat,lon})).sort((a,b)=>a.name.localeCompare(b.name))
};
export const isCountryCode = code => /^[A-Z]{2}$/.test(code || '') && Object.hasOwn(countries,code);

export function reportCountry(report) {
  if (['vendor_hq','company_hq','manual'].includes(report.place_basis)) return null;
  const named = String(report.country || '').toUpperCase();
  if (isCountryCode(named)) return {code:named,basis:'source_country'};
  if (report.state_codes?.length && ['source_coverage','source_origin','source_location'].includes(report.state_basis)) {
    return {code:'US',basis:report.state_basis};
  }
  if (!['event_location','seismic_origin','fire_origin','country_centroid','weather_area','catalog_point','cyclone_center','airport_reference'].includes(report.place_basis)) return null;
  const code = resolveCountry(report);
  return code ? {code,basis:report.place_basis==='country_centroid'?'country_reference':['catalog_point','airport_reference'].includes(report.place_basis)?report.place_basis:'reported_point'} : null;
}

export function withReportLocation(raw) {
  const report = withReportStates(raw);
  const region = reportCountry(report);
  const province = !region || region.code==='CA' ? reportProvince(report) : null;
  const country = region || (province ? {code:'CA',basis:province.basis} : null);
  return country ? {...report,country_code:country.code,country_basis:country.basis,
    ...(province ? {province_code:province.code,province_basis:province.basis} : {})} : report;
}

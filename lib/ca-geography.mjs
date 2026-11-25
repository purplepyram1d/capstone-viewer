import { readFileSync } from 'node:fs';
import { createCountryResolver } from './hotspots.mjs';

const atlas = JSON.parse(readFileSync(new URL('../assets/ca-provinces.json',import.meta.url)));
export const caProvinces = Object.fromEntries(atlas.provinces.map(place=>[place.code,place]));
export const isCAProvince = code => Object.hasOwn(caProvinces,code);
const locate = createCountryResolver(atlas.areas,caProvinces);
const pointBases = new Set(['event_location','seismic_origin','fire_origin','catalog_point','cyclone_center']);

export function reportProvince(report) {
  if (report.country==='CA' && isCAProvince(report.province)) {
    return {code:report.province,basis:'source_coverage'};
  }
  if (!pointBases.has(report.place_basis) || report.lat<41 || report.lat>84 || report.lon< -142 || report.lon> -51) return null;
  const code = locate({lat:report.lat,lon:report.lon,place_basis:report.place_basis});
  return code ? {code,basis:report.place_basis==='catalog_point'?'catalog_point':'reported_point'} : null;
}
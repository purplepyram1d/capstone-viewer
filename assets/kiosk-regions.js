globalThis.CapstoneKioskRegions = (() => {
  const queryKeys = ['state','province','country'];
  const normalize = value => /^(state|province|country):[A-Z]{2}$/.test(value || '') ? value : '';
  function fromUrl(params,stored) {
    for (const type of queryKeys) {
      if (params.has(type)) return normalize(type+':'+params.get(type).toUpperCase());
    }
    return params.has('region') ? '' : normalize(stored);
  }
  function toUrl(params,region) {
    for (const type of [...queryKeys,'region']) params.delete(type);
    if (region) {
      const [type,code] = region.split(':');
      params.set(type,code);
    } else {
      params.set('region','world');
    }
  }
  function matches(report,region) {
    if (!region) return true;
    const [type,code] = region.split(':');
    if (type==='state') return report.state_codes?.includes(code) === true;
    if (type==='province') return report.province_code===code;
    return report.country_code===code;
  }
  function project(story,accept,region) {
    const projected = CapstoneHeadlines.projectMatchingReports(story,accept);
    if (!projected) return null;
    const zone = region?.startsWith('state:') && projected.place_basis==='nws_zone_reference' &&
      projected.weather_zone_references?.find(place=>place.state===region.slice(6));
    return zone ? {...projected,lat:zone.lat,lon:zone.lon,place:zone.place} : projected;
  }
  return {fromUrl,toUrl,matches,project};
})();

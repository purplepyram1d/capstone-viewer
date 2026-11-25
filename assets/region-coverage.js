globalThis.CapstoneRegionCoverage = (() => {
  const states = {
    current:['ok','Recent successful poll'], overdue:['stalled','Overdue'], error:['error','Last poll failed'],
    collecting:['collecting','First poll running'], queued:['waiting','First poll queued'], waiting:['waiting','Awaiting first poll'],
    paused:['paused','Paused'], 'needs-key':['needs-key','Needs connection']
  };
  function providers({state,country,province},feedIds) {
    const regular = state || country==='US' ? ['nws-alerts','nws-storm-reports','nwps-observed','nifc-wildfire','usgs','fema-declarations','faa-airports'] :
      country==='CA' ? ['eccc-weather','usgs',...(!province || province==='BC' ? ['bc-wildfire','drivebc-closures'] : [])] :
      country==='NZ' ? ['geonet-earthquakes','geonet-volcano'] : country==='JP' ? ['jma-earthquakes','usgs'] :
      country==='AU' ? ['ga-earthquakes','usgs'] : country==='GB' ? ['meteo-gb','ea-floods'] : country ? ['meteo-'+country.toLowerCase()] : [];
    if (state && state!=='US') regular.push('wzdx-'+state.toLowerCase());
    else if (state==='US' || country==='US') regular.push(...[...feedIds].filter(id=>id.startsWith('wzdx-')));
    const districts = state==='CA' || state==='US' || country==='US' ? [...feedIds].filter(id=>id.startsWith('caltrans-closure-')) : [];
    return {regular,districts};
  }
  return {providers,states};
})();

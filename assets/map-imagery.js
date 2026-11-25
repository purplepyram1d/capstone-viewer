globalThis.CapstoneMapImagery = (() => {
  const service = 'https://nowcoast.noaa.gov/geoserver/observations/';
  const pollEvery = 120_000;
  const sourceId = 'noaa-weather-imagery';
  const radarCoverage = {
    conus:{name:'Contiguous U.S. radar',bounds:[-130,20,-59.99,55]},
    alaska:{name:'Alaska radar',bounds:[-176,49.99,-125.99,72]},
    hawaii:{name:'Hawaii radar',bounds:[-164.01,14.99,-151,26]},
    caribbean:{name:'Caribbean radar',bounds:[-90,9.99,-60,25]},
    guam:{name:'Guam-area radar',bounds:[140,8.99,150.01,18]}
  };
  const states = {AK:'alaska',HI:'hawaii',PR:'caribbean',VI:'caribbean',GU:'guam',MP:'guam'};
  const products = {
    radar:{endpoint:service+'weather_radar/ows',coverage:radarCoverage,layer:region=>region+'_base_reflectivity_mosaic',
      maxAge:12*60_000,maxZoom:7,opacity:.68},
    satellite:{endpoint:service+'satellite/ows',coverage:{global:{name:'Global infrared satellite',bounds:[-180,-85,180,85]}},
      layer:()=> 'global_longwave_imagery_mosaic',maxAge:2*3600_000,maxZoom:5,opacity:.48}
  };
  const capability = product=>product.endpoint+'?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities';
  const tile = (product,region,time) => product.endpoint+'?service=WMS&version=1.1.1&request=GetMap&layers='+product.layer(region)+
    '&styles=&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true&time='+encodeURIComponent(time);

  function scanTimes(xml, product) {
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    const names = new Map(Object.keys(product.coverage).map(region=>[product.layer(region),region]));
    const times = {};
    for (const layer of doc.getElementsByTagNameNS('*','Layer')) {
      const children = [...layer.children];
      const region = names.get(children.find(child=>child.localName==='Name')?.textContent);
      if (!region) continue;
      const time = children.find(child=>child.localName==='Dimension' && child.getAttribute('name')==='time')?.getAttribute('default');
      if (time && /Z$/.test(time) && Number.isFinite(Date.parse(time))) times[region]=time;
    }
    if (!Object.keys(times).length) throw Error('No NOAA imagery times were published');
    return times;
  }

  function attach(map, status) {
    let mode = '', replaying = false, state = '', disposed = false;
    let regionShown, scanShown, failed, loaded = false;
    const scans = Object.fromEntries(Object.keys(products).map(key=>[key,{times:{},lastAttempt:0,pending:false}]));

    function remove() {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      regionShown = scanShown = null;
      failed = loaded = false;
    }

    function regionInView() {
      if (mode==='satellite') return 'global';
      if (map.getZoom()<2) return '';
      const {lng,lat} = map.getCenter();
      const candidates = state ? [states[state] || 'conus'] : ['hawaii','alaska','guam','conus','caribbean'];
      return candidates.find(region=>{
        const [west,south,east,north] = radarCoverage[region].bounds;
        return lng>=west && lng<=east && lat>=south && lat<=north;
      });
    }

    function show(message) {
      if (status.textContent!==message) status.textContent=message;
    }

    function refresh() {
      if (disposed) return;
      const product = products[mode];
      status.hidden = !product;
      if (!product || replaying) {
        remove();
        if (replaying && product) show('Live imagery paused during replay');
        return;
      }
      const region = regionInView();
      if (!region) {
        remove();
        show('Zoom to a covered U.S. radar region');
        return;
      }
      const now = Date.now();
      const cache = scans[mode];
      if (!cache.pending && now-cache.lastAttempt>=pollEvery) {
        cache.pending = true;
        cache.lastAttempt = now;
        fetch(capability(product),{signal:AbortSignal.timeout(8_000),cache:'no-cache'}).then(response=>{
          if (!response.ok) throw Error('NOAA imagery returned HTTP '+response.status);
          return response.text();
        }).then(xml=>{cache.times=scanTimes(xml,product);}).catch(()=>{}).finally(()=>{
          cache.pending = false;
          refresh();
        });
      }
      const time = cache.times[region], age = now-Date.parse(time);
      if (!time || age< -120_000 || age>product.maxAge) {
        remove();
        show(cache.pending ? 'Checking NOAA imagery' : 'Recent NOAA imagery unavailable');
        return;
      }
      const {bounds,name} = product.coverage[region];
      if (regionShown!==region) {
        remove();
        regionShown = region;
        scanShown = time;
        map.addSource(sourceId,{type:'raster',tiles:[tile(product,region,time)],bounds,
          tileSize:256,maxzoom:product.maxZoom,attribution:'<a href="https://nowcoast.noaa.gov/" target="_blank" rel="noopener">NOAA nowCOAST</a>'});
        map.addLayer({id:sourceId,type:'raster',source:sourceId,paint:{
          'raster-opacity':product.opacity,'raster-fade-duration':150
        }},'observation-track-line');
      } else if (scanShown!==time) {
        scanShown = time;
        failed = loaded = false;
        map.getSource(sourceId).setTiles([tile(product,region,time)]);
      }
      show(failed ? 'Some NOAA imagery tiles unavailable' :
        (loaded ? '' : 'Loading ') + name + ' · ' + time.slice(11,16) + 'Z');
    }

    map.on('idle',()=>{
      if (!regionShown || loaded || failed || !map.isSourceLoaded(sourceId)) return;
      loaded = true;
      refresh();
    });
    map.on('error',event=>{
      if (event.sourceId===sourceId && regionShown) {
        failed = true;
        refresh();
      }
    });
    const timer = setInterval(refresh,pollEvery);
    map.once('remove',()=>{
      clearInterval(timer);
      disposed = true;
    });
    return (imageMode,replay,selectedState)=>{
      mode = imageMode;
      replaying = replay;
      state = selectedState;
      refresh();
    };
  }
  return {attach};
})();
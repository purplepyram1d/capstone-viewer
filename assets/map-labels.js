// Country names for the MapLibre maps (kiosk and Operations).
// The app ships no map fonts, so MapLibre cannot draw text labels itself; each name is an HTML marker just below its
// country's centre point (assets/countries.json). Size follows attention: the country of the current focus is drawn
// at twice the base size and pushed below the focus ring, and other names shrink with their distance from the focus
// point, down to about three quarters of the base. Far-side names hide on the globe, and after every move a name that
// would overlap a larger or earlier one is hidden.
window.CapstoneMapLabels = (() => {
  // A hot spot's country, or a whole-word match in a story's place ("Niger" never matches "Nigeria").
  function matcher(focus) {
    const text = (focus?.name || '').toLowerCase();
    return name => !!text && new RegExp(`(^|[^\\p{L}])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(text);
  }
  // getFocus() returns { lon, lat, name } for the current focus, or null (names then size by distance from the centre).
  // `relevant(name)`, when given, limits names to the ones that matter right now (the kiosk: countries with a story or hot
  // spot); the focus country always shows. Without it every name competes for space, as on Operations.
  function hideCrowding(elements,padX,padY) {
    const candidates = elements.filter(element=>element.style.opacity!=='0' && element.parentElement?.style.opacity!=='0');
    const measured = candidates.map(element=>({element,rect:element.getBoundingClientRect()}));
    const placed = [];
    for (const {element,rect:r} of measured) {
      if (!r.width) continue;
      const collision = placed.some(p=>r.left<p.right+padX && r.right>p.left-padX && r.top<p.bottom+padY && r.bottom>p.top-padY);
      element.classList.toggle('crowded',collision);
      if (!collision) placed.push(r);
    }
  }
  function attach(Marker,map,countries,getFocus,{focusOffset=42,relevant=null,clearable=()=>null,onClear}={}) {
    const labels = countries.filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon)).map(location=>{
      const element = document.createElement('span');
      element.className = 'map-country';
      element.textContent = location.name;
      const point = [location.lon,location.lat];
      const marker = new Marker({element,anchor:'top',offset:[0,12],opacityWhenCovered:'0'}).setLngLat(point).addTo(map);
      return {element,point,marker,name:location.name,offset:12};
    });
    const container = map.getContainer();
    if (onClear) {
      const activate = event => {
        if (!event.target.closest('.map-country.clear-focus') || !clearable()) return;
        event.preventDefault();
        event.stopPropagation();
        onClear();
      };
      container.addEventListener('click',activate);
      container.addEventListener('keydown',event=>{
        if (event.key==='Enter' || event.key===' ') activate(event);
      });
    }
    const refresh = () => {
      const f = getFocus(), isFocus = matcher(f), clearName = clearable();
      const box = container.getBoundingClientRect();
      const keep = relevant ? relevant() : null;
      const at = f && Number.isFinite(f.lon) ? map.project([f.lon,f.lat]) : {x:box.width/2,y:box.height/2};
      const visible = [];
      for (const label of labels) {
        const isClear = label.name===clearName;
        const focus = isClear || isFocus(label.name);
        const point = map.project(label.point);
        const inView = point.x>=-30 && point.x<=box.width+30 && point.y>=-30 && point.y<=box.height+12;
        const hideNational = label.name === 'United States' && map.getZoom() >= 3.4;
        const quiet = !inView || (!focus && (hideNational || (keep && !keep(label.name))));
        label.element.classList.toggle('focus',focus);
        label.element.classList.toggle('quiet',quiet);
        const canClear = isClear && !quiet;
        if (Boolean(label.canClear)!==canClear) {
          label.canClear = canClear;
          label.element.classList.toggle('clear-focus',canClear);
          if (canClear) {
            label.element.setAttribute('role','button');
            label.element.setAttribute('aria-label','Clear '+label.name+' focus');
            label.element.tabIndex = 0;
          } else {
            label.element.removeAttribute('role');
            label.element.removeAttribute('aria-label');
            label.element.removeAttribute('tabindex');
          }
        }
        if (quiet) continue;
        const d = Math.hypot(point.x-at.x,point.y-at.y);
        const scale = isClear ? 2.05 : focus ? 2 : 0.72+0.4*Math.max(0,1-d/Math.max(1,box.width*.45));
        const offset = focus ? focusOffset : 12;
        if (label.offset !== offset) {
          label.marker.setOffset([0,offset]);
          label.offset = offset;
        }
        label.element.style.setProperty('--s',scale.toFixed(2));
        visible.push({element:label.element,scale});
      }
      hideCrowding(visible.sort((a,b)=>b.scale-a.scale).map(item=>item.element),10,4);
    };
    map.on('moveend', refresh);
    map.on('projectiontransition', refresh);
    refresh();
    return { refresh };
  }
  function attachRegions(Marker,map,places,{minZoom=3,overview=()=>false,selected=()=>''}={}) {
    const labels = places.map(place=>{
      const element = document.createElement('span');
      element.className = 'map-state';
      element.textContent = place.name;
      element.title = place.name;
      new Marker({element,anchor:'center',opacityWhenCovered:'0'}).setLngLat([place.lon,place.lat]).addTo(map);
      return {element,place};
    });
    const refresh = () => {
      const zoom = map.getZoom(), focus = selected();
      const showRegions = zoom>=minZoom || overview();
      const {clientWidth,clientHeight} = map.getContainer();
      const visible = [];
      for (const {element,place} of labels) {
        const point = showRegions ? map.project([place.lon,place.lat]) : null;
        const show = Boolean(point && point.x>=-10 && point.x<=clientWidth+10 && point.y>=-10 && point.y<=clientHeight+10);
        const active = place.code===focus;
        element.classList.toggle('hidden',!show);
        element.classList.toggle('active',active);
        if (!show) continue;
        const label = zoom < 4.25 && !active && place.code ? place.code : place.name;
        if (element.textContent !== label) element.textContent = label;
        if (active) visible.unshift(element);
        else visible.push(element);
      }
      hideCrowding(visible,6,2);
    };
    map.on('moveend',refresh);
    map.on('projectiontransition',refresh);
    refresh();
    return refresh;
  }

  // US state borders (thin, drawn under the night shade and markers) and state names once zoomed in on North America.
  // Data: assets/us-states.json (scripts/prepare-states.mjs). Names stay hidden below `minZoom` so the world view stays clean.
  async function usStates(Marker, map, { minZoom = 3, before, data, onState, selected } = {}) {
    if (!data) {
      try { const r = await fetch('/assets/us-states.json'); if (!r.ok) return null; data = await r.json(); } catch { return null; }
    }
    const style = getComputedStyle(map.getContainer());
    const line = style.getPropertyValue('--borders').trim() || '#888';
    const beforeLayer = before && map.getLayer(before) ? before : undefined;
    const activity = data.areas && onState;
    const statesLayer = 'us-state-activity';
    const previous = new Map();
    if (activity) {
      map.addSource(statesLayer,{type:'geojson',data:data.areas,promoteId:'code'});
      map.addLayer({id:statesLayer,type:'fill',source:statesLayer,minzoom:2.2,paint:{
        'fill-color':style.getPropertyValue('--signal').trim() || '#8f76d9',
        'fill-opacity':['case', ['boolean',['feature-state','selected'],false],0.42,
          ['interpolate',['linear'],['number',['feature-state','count'],0],0,0,1,0.13,15,0.32]]
      }},beforeLayer);
      map.on('click',statesLayer,event=>{
        const code = event.features?.[0]?.properties?.code;
        if (code) onState(code,event);
      });
      map.on('mouseenter',statesLayer,()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',statesLayer,()=>{map.getCanvas().style.cursor='';});
    }
    map.addSource('us-states', { type: 'geojson', data: data.borders });
    map.addLayer({ id: 'us-states', type: 'line', source: 'us-states', paint: { 'line-color': line, 'line-width': ['interpolate', ['linear'], ['zoom'], 1.5, 0.25, 4, 0.7, 7, 1.1], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1.5, 0.35, 3, 0.85] } }, before && map.getLayer(before) ? before : undefined);
    const refresh = attachRegions(Marker,map,data.states,{minZoom,selected});
    return {
      refresh,
      repaint(color,accent) {
        map.setPaintProperty('us-states','line-color',color);
        if (activity && accent) map.setPaintProperty(statesLayer,'fill-color',accent);
      },
      setActivity(counts,selected) {
        if (!activity) return;
        for (const state of data.states) {
          const count = counts.get(state.code) || 0;
          const active = selected === state.code;
          const key = count + ':' + active;
          if (previous.get(state.code) === key) continue;
          previous.set(state.code,key);
          map.setFeatureState({source:statesLayer,id:state.code},{count,selected:active});
        }
      }
    };
  }
  return { attach, attachRegions, matcher, usStates };
})();

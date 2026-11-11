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
  function attach(map, countries, getFocus, { focusOffset = 42 } = {}) {
    const markers = new Map(), labels = countries.filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon)).map(c => {
      const el = document.createElement('span'); el.className = 'map-country'; el.textContent = c.name;
      markers.set(el, new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 12], opacityWhenCovered: '0' }).setLngLat([c.lon, c.lat]).addTo(map)); return el;
    });
    const refresh = () => {
      const f = getFocus(), isFocus = matcher(f), box = map.getContainer().getBoundingClientRect(), placed = [];
      const at = f && Number.isFinite(f.lon) ? map.project([f.lon, f.lat]) : { x: box.width / 2, y: box.height / 2 };
      for (const el of labels) {
        const focus = isFocus(el.textContent), r = el.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - box.left - at.x, r.top - box.top - at.y);
        el.classList.toggle('focus', focus); el.style.setProperty('--s', focus ? '2' : (0.72 + 0.4 * Math.max(0, 1 - d / (box.width * 0.45))).toFixed(2)); markers.get(el).setOffset([0, focus ? focusOffset : 12]);
      }
      const scale = el => parseFloat(el.style.getPropertyValue('--s')) || 1;
      for (const el of [...labels].sort((a, b) => scale(b) - scale(a))) {
        el.classList.remove('crowded'); if (el.parentElement?.style.opacity === '0' || el.style.opacity === '0') continue;
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        if (placed.some(p => r.left < p.right + 10 && r.right > p.left - 10 && r.top < p.bottom + 4 && r.bottom > p.top - 4)) el.classList.add('crowded'); else placed.push(r);
      }
    };
    map.on('moveend', refresh); refresh();
    return { refresh };
  }
  return { attach, matcher };
})();

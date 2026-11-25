import { readFileSync } from 'node:fs';
import { event, text } from './events.mjs';
import { nwsStates, usStates } from './us-geography.mjs';

// Store only bounded polygon coordinates. The representative point is a cross-section
// inside the source area, including on concave polygons and polygons with holes.
export function alertArea(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > 32) return null;
  let size = 0;
  let best = null;
  let widest = 0;
  const inside = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length || polygon.length > 32) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || (size+=ring.length)>1500 || !ring.every(inside)) return null;
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return null;
      if (ring.some((point,i)=>i>0 && Math.abs(point[0]-ring[i-1][0])>180)) return null;
    }
    const lats = polygon[0].map(point=>point[1]);
    const low = Math.min(...lats), high = Math.max(...lats);
    for (const span of [0.5,0.25,0.75]) {
      const lat = low + (high-low)*span;
      const crossings = [];
      for (const ring of polygon) {
        for (let i=1;i<ring.length;i++) {
          const [x,y] = ring[i-1], [nextX,nextY] = ring[i];
          if ((y>lat) !== (nextY>lat)) crossings.push(x+(lat-y)*(nextX-x)/(nextY-y));
        }
      }
      crossings.sort((a,b)=>a-b);
      for (let i=1;i<crossings.length;i+=2) {
        const width = crossings[i]-crossings[i-1];
        if (width <= widest) continue;
        widest = width;
        best = {lon:(crossings[i]+crossings[i-1])/2,lat};
      }
    }
  }
  return best ? {...best,weather_area:geometry} : null;
}

const forecastZones = JSON.parse(readFileSync(new URL('../assets/nws-forecast-zones.json',import.meta.url))).zones;
const marineZones = JSON.parse(readFileSync(new URL('../assets/nws-marine-zones.json',import.meta.url))).zones;
const forecastZoneUrl = /^https:\/\/api\.weather\.gov\/zones\/forecast\/([A-Z]{2}Z\d{3})$/;

function namedZones(alert) {
  const ugc = Array.isArray(alert.geocode?.UGC) ? new Set(alert.geocode.UGC) : new Set();
  return (Array.isArray(alert.affectedZones) ? alert.affectedZones : []).flatMap(url=>{
    const code = typeof url==='string' && forecastZoneUrl.exec(url)?.[1];
    return code && ugc.has(code) ? [code] : [];
  });
}

function zoneReferences(codes) {
  const references = new Map();
  for (const code of codes) {
    if (!Object.hasOwn(forecastZones,code)) continue;
    const state = code.slice(0,2);
    if (references.has(state)) continue;
    const [name,lat,lon] = forecastZones[code];
    references.set(state,{code,state,lat,lon,place:name+', '+state});
  }
  return [...references.values()];
}

function weatherLocation(feature, alert, area) {
  const states = nwsStates(alert.geocode);
  const point = alertArea(feature.geometry);
  const state = states.length === 1 ? usStates[states[0]] : null;
  const attribution = states.length ? {state_codes:states,state_basis:'source_coverage'} : {};
  if (point) return {...attribution,...point,place:area.slice(0,140) || 'NWS alert area',
    place_basis:'weather_area',location_note:'Point within the NWS alert area.'};
  const codes = namedZones(alert);
  const references = zoneReferences(codes);
  if (references.length) {
    const {lon,lat,place} = references[0];
    return {...attribution,lon,lat,place,place_basis:'nws_zone_reference',weather_zone_references:references,
      location_note:'Approximate point for one public forecast zone named by NWS. Open the bulletin for all affected areas.'};
  }
  const marine = codes.find(code=>Object.hasOwn(marineZones,code));
  if (marine) {
    const [place,lat,lon] = marineZones[marine];
    return {...attribution,lat,lon,place,place_basis:'nws_marine_reference',
      location_note:'Approximate point for one marine zone named by NWS ('+marine+'). Open the bulletin for all affected areas.'};
  }
  if (state) return {...attribution,lon:state.lon,lat:state.lat,place:state.name,place_basis:'state_reference',
    location_note:'Approximate state reference point for zones listed by NWS.'};
  return attribution;
}


const api = 'https://api.weather.gov';
export const weatherSource = 'U.S. National Weather Service';
export const weatherAlertsUrl = api + '/alerts/active?status=actual&severity=Severe,Extreme';
export const weatherReference = 'https://www.weather.gov/documentation/services-web-alerts';
const utc = date => new Date(date).toISOString().replace('T',' ').slice(0,16) + ' UTC';
const capIdentifier = /^urn:oid:[a-z0-9.-]{10,200}$/i;
const alertPrefix = api + '/alerts/';

function sourceReferences(alert) {
  if (alert.messageType!=='Update' || !Array.isArray(alert.references)) return [];
  const sent = Date.parse(alert.sent);
  const known = new Map();
  for (const reference of alert.references) {
    const id = reference?.identifier;
    const previous = Date.parse(reference?.sent);
    if (typeof id!=='string' || !capIdentifier.test(id) || reference['@id']!==alertPrefix+id ||
        id===alert.id || !(previous<sent)) continue;
    if (!known.has(id)) known.set(id,{id,ts:new Date(previous).toISOString()});
    if (known.size>=32) break;
  }
  return [...known.values()];
}

export function nwsReportIdentifier(report) {
  if (report.source!==weatherSource || report.kind!=='weather_alert' || typeof report.url!=='string' ||
      !report.url.startsWith(alertPrefix)) return '';
  const identifier = report.url.slice(alertPrefix.length);
  return capIdentifier.test(identifier) ? identifier : '';
}

export function withNwsReplacements(reports) {
  const messages = new Map();
  for (const report of reports) {
    const identifier = nwsReportIdentifier(report);
    if (identifier) messages.set(identifier,report);
  }
  const replacements = new Map();
  for (const current of messages.values()) {
    for (const reference of Array.isArray(current.nws_references) ? current.nws_references : []) {
      const earlier = messages.get(reference?.id);
      if (!earlier || earlier.ts!==reference.ts || !(earlier.ts<current.ts)) continue;
      if (!replacements.has(earlier.id)) replacements.set(earlier.id,[]);
      replacements.get(earlier.id).push({id:current.id,ts:current.ts,url:current.url,place:current.place,title:current.title});
    }
  }
  if (!replacements.size) return reports;
  return reports.map(report=>{
    const links = replacements.get(report.id);
    if (!links?.length) return report;
    links.sort((a,b)=>a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
    return {...report,weather_listed_until:null,weather_replaced_at:links[0].ts,weather_replacements:links.slice(0,8)};
  });
}

export function normalizeWeatherAlerts(data, now = Date.now()) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Expected a National Weather Service alert collection');
  }
  const reports = [];
  const seen = new Set();
  for (const feature of data.features) {
    const alert = feature?.properties;
    if (feature?.type !== 'Feature' || alert?.status !== 'Actual' ||
        (alert.scope && alert.scope !== 'Public') || !['Alert','Update'].includes(alert.messageType) ||
        !['Severe','Extreme'].includes(alert.severity) ||
        typeof alert.id !== 'string' || !capIdentifier.test(alert.id) ||
        seen.has(alert.id)) continue;

    const name = text(alert.event);
    const expires = Date.parse(alert.expires);
    const ends = Date.parse(alert.ends);
    if (!name || !Number.isFinite(expires) || expires <= now || (Number.isFinite(ends) && ends <= now)) continue;

    const issuer = text(alert.senderName);
    const area = text(alert.areaDesc);
    const update = alert.messageType === 'Update';
    const references = sourceReferences(alert);
    const summary = [
      alert.severity + ' severity.',
      'Bulletin expiration ' + utc(expires) + '.',
      Number.isFinite(ends) ? 'Event end time in bulletin ' + utc(ends) + '.' : '',
      area ? 'Areas named by NWS: ' + area.slice(0,270) + (area.length > 270 ? '…' : '.') : '',
      'Check the source for current instructions.'
    ].filter(Boolean).join(' ');
    const report = event({
      key:'nws:' + alert.id, ts:alert.sent, source:weatherSource,
      title:name + (update ? ' update' : '') + (issuer ? ' · ' + issuer : ''),
      summary, url:api + '/alerts/' + alert.id, category:'geo', kind:'weather_alert',
      confidence:'Official weather bulletin',
      ...(references.length ? {nws_references:references} : {}),
      weather_valid_until:new Date(Number.isFinite(ends) ? Math.min(expires,ends) : expires).toISOString(),
      score:alert.severity === 'Extreme' ? 82 : 58,
      ...weatherLocation(feature,alert,area)
    },now);
    if (!report) continue;
    reports.push(report);
    seen.add(alert.id);
  }
  return reports;
}
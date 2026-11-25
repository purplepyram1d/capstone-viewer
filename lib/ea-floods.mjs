import { event, text } from './events.mjs';
import { alertArea } from './weather-alerts.mjs';

export const eaFloodSource = 'Environment Agency flood notices';
export const eaFloodUrl = 'https://environment.data.gov.uk/flood-monitoring/id/floods';
export const eaFloodReference = 'https://check-for-flooding.service.gov.uk/alerts-and-warnings';
const targetArea = 'https://check-for-flooding.service.gov.uk/target-area/';
const referencePointsUrl = 'https://check-for-flooding.service.gov.uk/api/warnings.geojson';
const areaLayers = 'https://environment.data.gov.uk/arcgis/rest/services/EA/';
const areaCode = /^[A-Z0-9]{4,24}$/;
const levels = {
  1:{title:'Severe flood warning',meaning:'Danger to life from flooding',score:90,layer:'FloodWarningAreas'},
  2:{title:'Flood warning',meaning:'Flooding is expected',score:72,layer:'FloodWarningAreas'},
  3:{title:'Flood alert',meaning:'Flooding is possible',score:52,layer:'FloodAlertAreas'},
  4:{title:'Flood warning removed',meaning:'The warning is no longer in force',score:35}
};
const iso = time => new Date(time).toISOString();
function sourceStamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) return NaN;
  // The matching Check for flooding records attach the UTC offset to these clock fields.
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + 'Z');
}

function itemsOf(data) {
  if (!Array.isArray(data?.items)) throw new Error('Invalid Environment Agency flood notice list');
  const items = data.items.filter(row=>areaCode.test(row?.floodAreaID || '') && Number.isInteger(row.severityLevel) && Object.hasOwn(levels,row.severityLevel));
  if (data.items.length && !items.length) throw new Error('Environment Agency flood notice fields were missing');
  return items;
}

function boundaryUrl(layer, codes) {
  return areaLayers+layer+'/FeatureServer/0/query?'+new URLSearchParams({
    where:'fws_tacode IN ('+codes.map(code=>"'"+code+"'").join(',')+')',
    outFields:'fws_tacode',returnGeometry:'true',outSR:'4326',maxAllowableOffset:'0.001',f:'geojson'
  });
}

export function normalizeEaFloods(data, points = new Map(), now = Date.now()) {
  return itemsOf(data).map(row=>{
    const code = row.floodAreaID, level = levels[row.severityLevel];
    const changed = sourceStamp(row.timeSeverityChanged);
    const message = sourceStamp(row.timeMessageChanged);
    const date = Math.max(changed,Number.isFinite(message) ? message : changed);
    const place = text(row.description);
    if (!place || !Number.isFinite(date)) return null;
    const ended = row.severityLevel===4;
    const boundary = points.get(code);
    const scope = text(row.floodArea?.county);
    const terminal = ended ? 'ended' : 'active';
    return event({
      key:'ea-flood:'+code+':'+row.severityLevel+':'+iso(changed),
      ts:iso(date), source_date_basis:'updated',
      title:level.title+' · '+place,
      summary:[level.meaning+'.',scope ? 'Area includes '+scope+'.' : '',text(row.message)].filter(Boolean).join(' '),
      url:targetArea+code, source_url_scope:'live_listing', source:eaFloodSource, category:'geo', kind:'weather_alert',
      confidence:'Official Environment Agency flood notice', score:level.score, country:'GB',
      ea_flood_area:code, weather_status:terminal, weather_valid_until:ended ? iso(changed) : null,
      ea_severity_changed:iso(changed), ea_severity:row.severityLevel, place,
      ...(boundary ? {...boundary,place_basis:boundary.weather_area ? 'international_weather_area' : 'regional_reference',
        location_note:boundary.weather_area ? 'Point within the generalized Environment Agency flood-area boundary.' : 'Flood-area reference point published on GOV.UK.'} :
        {location_note:'Published flood-area boundary unavailable in Capstone. The GOV.UK area page has the published area.'})
    },now);
  }).filter(Boolean);
}

export function createEaFloodCollector(readJson, now = () => Date.now()) {
  const cached = new Map();
  return async function collectEaFloods() {
    const data = await readJson(eaFloodUrl);
    const items = itemsOf(data);
    const stamp = now();
    const requests = new Map();
    for (const item of items) {
      const code = item.floodAreaID;
      const layer = levels[item.severityLevel].layer;
      if (!layer || cached.get(code)?.until > stamp) continue;
      if (!requests.has(layer)) requests.set(layer,new Set());
      requests.get(layer).add(code);
    }
    await Promise.allSettled([...requests].map(async ([layer,codes])=>{
      const ids = [...codes].slice(0,80);
      const asked = new Set(ids);
      const response = await readJson(boundaryUrl(layer,ids));
      for (const item of response?.features || []) {
        const code = item?.properties?.fws_tacode;
        if (!asked.has(code)) continue;
        const point = alertArea(item.geometry);
        if (point) cached.set(code,{point,until:stamp+86_400_000});
      }
    }));
    const missing = new Set([...requests.values()].flatMap(codes=>[...codes]).filter(code=>!cached.has(code)));
    if (missing.size) {
      try {
        const references = await readJson(referencePointsUrl);
        for (const feature of references?.features || []) {
          const code = feature?.properties?.ta_code;
          const [lon,lat] = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
          if (missing.has(code) && feature?.geometry?.type==='Point' && Number.isFinite(lon) && Number.isFinite(lat) &&
              Math.abs(lon)<=180 && Math.abs(lat)<=90) cached.set(code,{point:{lon,lat},until:stamp+86_400_000});
        }
      } catch {
        // A location lookup can be unavailable while the official notice list still succeeds.
      }
    }
    for (const [code,entry] of cached) if (entry.until + 6*86_400_000 < stamp) cached.delete(code);
    return normalizeEaFloods(data,new Map([...cached].map(([id,entry])=>[id,entry.point])),stamp);
  };
}

export function withEaFloodTransitions(reports) {
  const areas = new Map();
  for (const report of reports) {
    if (report.feed_id !== 'ea-floods' || !report.ea_flood_area || typeof report.ea_severity_changed !== 'string') continue;
    if (!areas.has(report.ea_flood_area)) areas.set(report.ea_flood_area,[]);
    areas.get(report.ea_flood_area).push(report);
  }
  const later = new Map();
  for (const rows of areas.values()) {
    rows.sort((a,b)=>a.ea_severity_changed.localeCompare(b.ea_severity_changed) || a.ts.localeCompare(b.ts));
    for (let i=0;i<rows.length-1;i++) {
      const prior = rows[i], next = rows[i+1];
      later.set(prior.id,{id:next.id,ts:next.ea_severity_changed,url:next.url,place:next.place,title:next.title,source_url_scope:next.source_url_scope});
    }
  }
  return later.size ? reports.map(report=>{
    const update = later.get(report.id);
    return update ? {...report,weather_listed_until:null,weather_replaced_at:update.ts,weather_replacements:[update]} : report;
  }) : reports;
}

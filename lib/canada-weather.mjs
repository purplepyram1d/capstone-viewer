import { event, text } from './events.mjs';
import { countries } from './geography.mjs';
import { alertArea } from './weather-alerts.mjs';

const records = 'https://api.weather.gc.ca/collections/weather-alerts/items';
export const canadaWeatherSource = 'Environment and Climate Change Canada';
export const canadaWeatherUrl = records + '?f=json&limit=1000&filter=properties.alert_type%3Dwarning';
export const canadaWeatherReference = 'https://eccc-msc.github.io/open-data/msc-data/alerts/readme_alerts-geomet_en/';

const activeStatuses = new Set(['issued','continued','changed_from']);
const colours = {red:85,orange:72,yellow:57};
const provinceNames = {
  AB:'Alberta',BC:'British Columbia',MB:'Manitoba',NB:'New Brunswick',NL:'Newfoundland and Labrador',
  NS:'Nova Scotia',NT:'Northwest Territories',NU:'Nunavut',ON:'Ontario',PE:'Prince Edward Island',
  QC:'Quebec',SK:'Saskatchewan',YT:'Yukon'
};
const sourceTime = stamp => typeof stamp==='string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ? Date.parse(stamp) : NaN;
const iso = timestamp => new Date(timestamp).toISOString();
const utc = timestamp => iso(timestamp).slice(0,16).replace('T',' ') + ' UTC';

export function normalizeCanadaWeather(data, now = Date.now()) {
  if (data?.type!=='FeatureCollection' || !Array.isArray(data.features)) {
    throw Error('Expected an Environment and Climate Change Canada alert collection');
  }
  // A partial listing must not appear to withdraw previously observed areas.
  if (data.numberMatched>data.features.length || (Array.isArray(data.links) && data.links.some(link=>link?.rel==='next'))) {
    throw Error('Environment and Climate Change Canada returned a partial warning collection');
  }
  const warnings = new Map();
  for (const feature of data.features) {
    const properties = feature?.properties;
    if (feature?.type!=='Feature' || properties?.alert_type!=='warning' ||
        !activeStatuses.has(properties.status_en) || !Object.hasOwn(colours,properties.risk_colour_en)) continue;
    const id = typeof feature.id==='string' && /^([a-z0-9-]{8,64})(?:_[a-z0-9-]{2,80})?$/i.exec(feature.id);
    const issued = sourceTime(properties.publication_datetime);
    const expires = sourceTime(properties.expiration_datetime);
    const ends = sourceTime(properties.event_end_datetime);
    const validUntil = Number.isFinite(ends) ? Math.min(expires,ends) : expires;
    const name = text(properties.alert_name_en);
    if (!id || !name || !Number.isFinite(issued) || !Number.isFinite(validUntil) || validUntil<=now) continue;
    const province = Object.hasOwn(provinceNames,properties.province) ? properties.province : '';
    const colour = properties.risk_colour_en;
    // GeoMet reuses the notice identifier across its forecast-zone features.
    const key = JSON.stringify([id[1],issued,name,colour,province]);
    if (!warnings.has(key)) warnings.set(key,{issued,validUntil,name,colour,province,features:new Map()});
    const warning = warnings.get(key);
    warning.validUntil = Math.min(warning.validUntil,validUntil);
    warning.features.set(id[0],{geometry:feature.geometry,name:text(properties.feature_name_en)});
  }

  return [...warnings.entries()].flatMap(([key,warning])=>{
    const features = [...warning.features.entries()].sort(([a],[b])=>a.localeCompare(b));
    const areas = [...new Set(features.map(([,feature])=>feature.name).filter(Boolean))];
    const areaName = areas.join('; ');
    const polygons = features.map(([,feature])=>feature.geometry);
    const area = polygons.every(geometry=>['Polygon','MultiPolygon'].includes(geometry?.type)) ? alertArea({
      type:'MultiPolygon',
      coordinates:polygons.flatMap(geometry=>geometry.type==='Polygon' ? [geometry.coordinates] : geometry.coordinates)
    }) : null;
    const country = countries.CA;
    const region = provinceNames[warning.province] || country.name;
    const colour = warning.colour[0].toUpperCase() + warning.colour.slice(1);
    const report = event({
      key:'canada-weather:'+key,ts:iso(warning.issued),
      url:records+'/'+features[0][0]+'?f=html',source:canadaWeatherSource,kind:'weather_alert',category:'geo',
      title:colour+' · '+warning.name+' · '+region,
      summary:[
        'Published warning window ends '+utc(warning.validUntil)+'.',
        areaName ? 'Forecast areas: '+areaName.slice(0,275)+(areaName.length>275?'…':'.') : '',
        'Open the original warning for its full text and instructions.'
      ].filter(Boolean).join(' '),
      confidence:'Official weather bulletin',country:'CA',province:warning.province || undefined,weather_valid_until:iso(warning.validUntil),score:colours[warning.colour],
      ...(area ? {...area,place:region,place_basis:'international_weather_area',
        location_note:'Point within the warning areas published by Environment and Climate Change Canada.'} :
        {lat:country.lat,lon:country.lon,place:country.name,place_basis:'country_centroid',
          location_note:'Approximate country reference point. See the original warning for coverage.'})
    },now);
    return report ? [report] : [];
  });
}
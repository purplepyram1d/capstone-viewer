import { writeFile } from 'node:fs/promises';

const source = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_1_states_provinces.geojson';
const response = await fetch(source,{signal:AbortSignal.timeout(25_000)});
if (!response.ok) throw Error('Could not fetch Natural Earth province data (HTTP '+response.status+')');
const world = await response.json();
const provinces = [], features = [];
const round = ([lon,lat]) => [Number(lon.toFixed(3)),Number(lat.toFixed(3))];
for (const feature of world.features) {
  const row = feature.properties;
  if (row.adm0_a3!=='CAN' || !/^CA-[A-Z]{2}$/.test(row.iso_3166_2 || '')) continue;
  const code = row.iso_3166_2.slice(3), name = row.name;
  const point = {code,name,lat:row.latitude,lon:row.longitude};
  const {type,coordinates} = feature.geometry;
  features.push({type:'Feature',id:code,properties:{code,name},geometry:{
    type,coordinates:type==='Polygon' ? coordinates.map(ring=>ring.map(round)) :
      coordinates.map(polygon=>polygon.map(ring=>ring.map(round)))
  }});
  provinces.push(point);
}
if (new Set(provinces.map(region=>region.code)).size!==13) throw Error('Expected all 13 Canadian provinces and territories');
provinces.sort((a,b)=>a.name.localeCompare(b.name));
await writeFile(new URL('../assets/ca-provinces.json',import.meta.url),JSON.stringify({
  source,provinces,areas:{type:'FeatureCollection',features}
})+'\n');
console.log('Wrote '+provinces.length+' Canadian provinces and territories.');
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoEquirectangular, geoPath } from 'd3-geo';
mkdirSync('assets/vendor', { recursive: true });
for (const name of ['maplibre-gl.js', 'maplibre-gl.css', 'LICENSE.txt']) copyFileSync(`node_modules/maplibre-gl/${name === 'LICENSE.txt' ? 'LICENSE.txt' : `dist/${name}`}`, `assets/vendor/${name}`);
const world = JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json'));
const geojson=feature(world, world.objects.countries);
writeFileSync('assets/world.json', JSON.stringify(geojson));
const projection=geoEquirectangular().translate([360,180]).scale(360/Math.PI).precision(0.3);
writeFileSync('assets/world-paths.json',JSON.stringify(geojson.features.map(geoPath(projection))));
const response = await fetch('https://raw.githubusercontent.com/google/dspl/master/samples/google/canonical/countries.csv');
if (!response.ok) throw new Error(`Country lookup: HTTP ${response.status}`);
const countries = {};
for (const line of (await response.text()).trim().split(/\r?\n/).slice(1)) {
  const [code, lat, lon, ...name] = line.split(',');
  if (code && lat && lon) countries[code] = { lat: +lat, lon: +lon, name: name.join(',').replace(/^"|"$/g, '') };
}
writeFileSync('assets/countries.json', JSON.stringify(countries));
for (const [name,url] of [['NODE-LICENSE.txt',`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`],['DSPL-LICENSE.txt','https://raw.githubusercontent.com/google/dspl/master/LICENSE']]) {
  const r=await fetch(url);if(!r.ok)throw new Error(`License download: ${r.status}`);writeFileSync(`assets/vendor/${name}`,await r.text());
}
console.log(`Prepared local map assets and ${Object.keys(countries).length} country points.`);

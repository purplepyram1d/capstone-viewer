// Builds assets/us-states.json from us-atlas 3.0.1 states-10m.json (ISC, Mike Bostock; US Census Bureau cartographic
// boundaries). Retains interior borders, state polygons, and state label points.
// Usage: node scripts/prepare-states.mjs <path to us-atlas states-10m.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { mesh, feature } from 'topojson-client';
import { geoCentroid } from 'd3-geo';
const source = process.argv[2] || 'node_modules/us-atlas/states-10m.json';
const us = JSON.parse(readFileSync(source, 'utf8'));
const round = c => [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000];
const borders = mesh(us, us.objects.states, (a, b) => a !== b);
borders.coordinates = borders.coordinates.map(line => line.map(round));
// Centroids land badly for a few irregular shapes; these points sit inside the state where the name reads well.
const fixed = { Florida: [-81.6, 28.3], Louisiana: [-92.4, 31.0], Michigan: [-84.7, 43.6], Alaska: [-152.5, 64.2], Hawaii: [-157.0, 20.6], Idaho: [-114.6, 44.3], Maryland: [-76.8, 39.1], 'West Virginia': [-80.6, 38.7], Kentucky: [-85.3, 37.5], Virginia: [-78.6, 37.6] };
// Census state and state-equivalent codes in the source geometry.
const postal = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL',
  '13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME',
  '24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH',
  '34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI',
  '56':'WY','60':'AS','66':'GU','69':'MP','72':'PR','78':'VI'
};
const areas = feature(us, us.objects.states);
for (const state of areas.features) {
  const code = postal[state.id];
  if (!code) throw Error('Unrecognized state code ' + state.id);
  state.properties.code = code;
  const { geometry } = state;
  if (geometry.type === 'Polygon') geometry.coordinates = geometry.coordinates.map(ring=>ring.map(round));
  else geometry.coordinates = geometry.coordinates.map(polygon=>polygon.map(ring=>ring.map(round)));
}
const states = areas.features.map(f => {
  const name = f.properties.name, [lon, lat] = fixed[name] || round(geoCentroid(f));
  return { code:f.properties.code, name, lat, lon };
}).sort((a, b) => a.name.localeCompare(b.name));
writeFileSync('assets/us-states.json', JSON.stringify({ source: 'us-atlas 3.0.1 states-10m (US Census Bureau)', borders: { type: 'Feature', properties: {}, geometry: borders }, states, areas }));
console.log(`Wrote assets/us-states.json: ${states.length} states, ${borders.coordinates.length} border lines.`);

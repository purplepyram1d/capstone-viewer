import { writeFile } from 'node:fs/promises';
import { isUSState } from '../lib/us-geography.mjs';

const source = 'https://www.weather.gov/source/gis/Shapefiles/County/bp16ap26.dbx';
const output = new URL('../assets/nws-forecast-zones.json',import.meta.url);
const response = await fetch(source,{signal:AbortSignal.timeout(25_000)});
if (!response.ok) throw Error('Could not fetch NWS forecast zone data (HTTP '+response.status+')');
const zones = new Map(), ambiguous = new Set();
for (const row of (await response.text()).split(/\r?\n/)) {
  const [state,zone,,name,reference,,,,,latitude,longitude] = row.split('|');
  if (!isUSState(state) || !/^\d{3}$/.test(zone) || reference!==state+zone || !name || !latitude || !longitude) continue;
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) continue;
  const code = state+'Z'+zone;
  const point = [name,lat,lon];
  const prior = zones.get(code);
  if (prior && prior.join('|')!==point.join('|')) ambiguous.add(code);
  zones.set(code,point);
}
for (const code of ambiguous) zones.delete(code);
if (zones.size<3500) throw Error('Unexpectedly small NWS zone data file ('+zones.size+' zones)');
const entries = [...zones].sort(([a],[b])=>a.localeCompare(b)).map(([code,point])=>JSON.stringify(code)+':'+JSON.stringify(point));
await writeFile(output,'{\n  "source":'+JSON.stringify(source)+',\n  "effective":"2026-04-16",\n  "zones":{\n    '+entries.join(',\n    ')+'\n  }\n}\n');
console.log('Wrote '+zones.size+' NWS public forecast zone reference points. '+ambiguous.size+' ambiguous zone codes omitted.');
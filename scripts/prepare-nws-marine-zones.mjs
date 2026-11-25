// Extract reference points from the .dbf attribute table in each NWS coastal/offshore zone archive.
// Usage: node scripts/prepare-nws-marine-zones.mjs <mz16ap26.dbf> <oz16ap26.dbf>
import { readFileSync, writeFileSync } from 'node:fs';

const inputs = process.argv.slice(2);
if (inputs.length!==2) throw Error('Provide the coastal and offshore NWS .dbf files');
const decoder = new TextDecoder('windows-1252');
const zones = new Map();
for (const input of inputs) {
  const bytes = readFileSync(input);
  const rowCount = bytes.readUInt32LE(4);
  const headerLength = bytes.readUInt16LE(8);
  const rowLength = bytes.readUInt16LE(10);
  if (headerLength<65 || rowLength<10 || rowCount<100 || headerLength+rowCount*rowLength>bytes.length) {
    throw Error('Unexpected NWS DBF layout in '+input);
  }
  const fields = new Map();
  let offset = 1;
  for (let byte=32; byte+32<=headerLength && bytes[byte]!==0x0d; byte+=32) {
    const name = decoder.decode(bytes.subarray(byte,byte+11)).replace(/\0.*$/,'').trim().toUpperCase();
    const length = bytes[byte+16];
    fields.set(name,{offset,length});
    offset+=length;
  }
  if (offset!==rowLength || !['ID','NAME','LAT','LON'].every(field=>fields.has(field))) {
    throw Error('Expected ID, NAME, LAT and LON in '+input);
  }
  for (let index=0; index<rowCount; index++) {
    const start = headerLength+index*rowLength;
    if (bytes[start]!==0x20) continue;
    const field = name=>{
      const {offset,length} = fields.get(name);
      return decoder.decode(bytes.subarray(start+offset,start+offset+length)).trim();
    };
    const id = field('ID'), name = field('NAME'), latitude = field('LAT'), longitude = field('LON');
    const lat = Number(latitude), lon = Number(longitude);
    if (!/^[A-Z]{2}Z\d{3}$/.test(id) || !name || !latitude || !longitude ||
        !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) continue;
    const entry = [name,lat,lon];
    const prior = zones.get(id);
    if (prior && prior.join('|')!==entry.join('|')) throw Error('Conflicting NWS marine zone '+id);
    zones.set(id,entry);
  }
}
if (zones.size<600) throw Error('Unexpectedly few usable NWS marine zones');
const entries = [...zones].sort(([a],[b])=>a.localeCompare(b)).map(([id,point])=>JSON.stringify(id)+':'+JSON.stringify(point));
const source = 'https://www.weather.gov/gis/MarineZones';
writeFileSync(new URL('../assets/nws-marine-zones.json',import.meta.url),
  '{\n  "source":'+JSON.stringify(source)+',\n  "effective":"2026-04-16",\n  "zones":{\n    '+entries.join(',\n    ')+'\n  }\n}\n');
console.log('Wrote '+zones.size+' NWS coastal and offshore reference points.');
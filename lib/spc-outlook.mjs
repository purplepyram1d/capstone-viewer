const root = 'https://www.spc.noaa.gov/products/outlook/';
const minute = 60_000;
const allowedDays = [1,2];
const levels = {
  MRGL: {name:'Marginal',color:'#358451',level:1},
  SLGT: {name:'Slight',color:'#ad8a16',level:2},
  ENH: {name:'Enhanced',color:'#d56d25',level:3},
  MDT: {name:'Moderate',color:'#b93744',level:4},
  HIGH: {name:'High',color:'#b646aa',level:5}
};

function publishedGeometry(geometry) {
  const polygons = geometry?.type==='Polygon' ? [geometry.coordinates] :
    geometry?.type==='MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length || polygons.length>150) return null;
  let vertices = 0;
  function ringValid(ring) {
    if (!Array.isArray(ring) || ring.length<4 || (vertices+=ring.length)>50_000) return false;
    if (!ring.every(point=>Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0]>=-150 && point[0]<=-55 && point[1]>=12 && point[1]<=60)) return false;
    return ring[0][0]===ring.at(-1)[0] && ring[0][1]===ring.at(-1)[1];
  }
  return polygons.every(polygon=>Array.isArray(polygon) && polygon.length && polygon.every(ringValid)) ? geometry : null;
}

function times(properties) {
  const issued = Date.parse(properties?.ISSUE_ISO);
  const starts = Date.parse(properties?.VALID_ISO);
  const ends = Date.parse(properties?.EXPIRE_ISO);
  return [issued,starts,ends].every(Number.isFinite) && issued<ends && starts<ends ? {issued,starts,ends} : null;
}
const iso = value => new Date(value).toISOString();
const sourceFor = day => root+'day'+day+'otlk.html';

export function normalizeSpcOutlook(data, day, now = Date.now()) {
  if (!allowedDays.includes(day) || data?.type!=='FeatureCollection' || !Array.isArray(data.features))
    throw new Error('Invalid NOAA severe-weather outlook');
  const source = sourceFor(day);
  const issue = data.features.map(feature=>times(feature?.properties)).filter(Boolean).sort((a,b)=>b.issued-a.issued)[0];
  if (!issue) {
    if (data.features.length) throw new Error('NOAA outlook times were missing');
    return {day,source,issued:null,starts:null,ends:null,risks:[],areas:{type:'FeatureCollection',features:[]}};
  }
  if (issue.issued>now+5*minute || issue.ends<=now) throw new Error('NOAA outlook was outside its valid time window');
  const features = [];
  const found = new Set();
  for (const feature of data.features) {
    const risk = feature?.properties?.LABEL;
    const level = levels[risk];
    const date = times(feature?.properties);
    if (!Object.hasOwn(levels,risk) || !date || date.issued!==issue.issued || date.starts!==issue.starts || date.ends!==issue.ends) continue;
    const geometry = publishedGeometry(feature.geometry);
    if (!geometry) throw new Error('NOAA outlook geometry was unavailable');
    found.add(risk);
    features.push({type:'Feature',geometry,properties:{risk,name:level.name,color:level.color,level:level.level}});
  }
  return {day,source,issued:iso(issue.issued),starts:iso(issue.starts),ends:iso(issue.ends),
    risks:[...found].map(risk=>levels[risk]).sort((a,b)=>a.level-b.level),areas:{type:'FeatureCollection',features}};
}

export function createSpcOutlooks(readJson, now = () => Date.now()) {
  const cache = new Map(), pending = new Map();
  return async function outlook(day) {
    if (!allowedDays.includes(day)) throw new Error('Use outlook day 1 or 2');
    if (pending.has(day)) return pending.get(day);
    const previous = cache.get(day);
    if (previous?.until>now() && (!previous.value.ends || Date.parse(previous.value.ends)>now())) return previous.value;
    const request = (async()=>{
      try {
        const data = await readJson(root+'day'+day+'otlk_cat.nolyr.geojson');
        const value = normalizeSpcOutlook(data,day,now());
        cache.set(day,{value,until:now()+15*minute});
        return value;
      } catch (error) {
        const good = previous?.value?.ends && Date.parse(previous.value.ends)>now();
        const value = good ? {...previous.value,stale:true} :
          {day,source:sourceFor(day),issued:null,starts:null,ends:null,risks:[],areas:{type:'FeatureCollection',features:[]},error:error.message};
        cache.set(day,{value,until:now()+2*minute});
        return value;
      }
    })();
    pending.set(day,request);
    try { return await request; }
    finally { pending.delete(day); }
  };
}

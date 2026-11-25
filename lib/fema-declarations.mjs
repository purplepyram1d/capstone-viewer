import { DAY, event, text } from './events.mjs';
import { usStates, isUSState } from './us-geography.mjs';

export const femaSource = 'FEMA disaster declarations';
const endpoint = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';
export const femaReference = endpoint+'?%24orderby=declarationDate+desc&%24top=5';
const maximum = 1000;
const types = {DR:'Major disaster declaration',EM:'Emergency declaration',FM:'Fire management assistance declaration'};
const sourceDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && /Z$/.test(value) ? Date.parse(value) : NaN;
const dateOnly = value => new Date(value).toISOString().slice(0,10);

function query(parameters) {
  return endpoint+'?'+new URLSearchParams({...parameters,$top:String(maximum)});
}
export function femaUrl(now = Date.now()) {
  return query({$filter:"declarationDate ge '"+new Date(now-30*DAY).toISOString()+"'",$orderby:'declarationDate desc'});
}

export function normalizeFemaDeclarations(data, now = Date.now()) {
  const rows = data?.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) throw Error('Expected OpenFEMA disaster declarations');
  if (rows.length>=maximum) throw Error('OpenFEMA returned a truncated declaration list');
  const declarations = new Map();
  for (const row of rows) {
    const number = row?.disasterNumber;
    const state = row?.state;
    const issued = sourceDate(row?.declarationDate);
    if (!Number.isInteger(number) || number<=0 || number>999_999 || !isUSState(state) ||
        !Object.hasOwn(types,row.declarationType) || !Number.isFinite(issued)) continue;
    const id = number+':'+state;
    if (!declarations.has(id)) declarations.set(id,{row,issued,state,number,areas:new Set()});
    const area = text(row.designatedArea);
    if (area) declarations.get(id).areas.add(area);
  }
  return [...declarations.entries()].flatMap(([key,{row,issued,state,number,areas}])=>{
    const region = usStates[state];
    const start = sourceDate(row.incidentBeginDate), end = sourceDate(row.incidentEndDate);
    const type = types[row.declarationType];
    const designated = [...areas].sort().join('; ');
    const report = event({
      key:'fema:'+key,ts:new Date(issued).toISOString(),date_precision:'day',source_date_basis:'declaration_date',
      source:femaSource,title:type+' · '+region.name+' · '+(text(row.declarationTitle) || 'FEMA '+number),
      summary:[
        'FEMA '+row.declarationType+'-'+number+' declared '+dateOnly(issued)+'.',
        Number.isFinite(start) ? 'Published incident period began '+dateOnly(start)+'.' : '',
        Number.isFinite(end) ? 'Published incident period ended '+dateOnly(end)+'.' : '',
        designated ? 'Designated areas: '+designated.slice(0,235)+(designated.length>235?'…':'.') : ''
      ].filter(Boolean).join(' '),
      url:query({$filter:'disasterNumber eq '+number}),category:'geo',kind:'disaster_declaration',
      confidence:'Official disaster declaration',score:row.declarationType==='DR'?69:61,
      lat:region.lat,lon:region.lon,place:region.name,place_basis:'state_reference',state_codes:[state],state_basis:'source_coverage',
      location_note:'State reference point for the federal declaration. Open the source for the designated areas.'
    },now);
    return report ? [report] : [];
  });
}
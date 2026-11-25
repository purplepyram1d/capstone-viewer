import { event, safeUrl, text } from './events.mjs';

const usgs = 'https://volcanoes.usgs.gov';
const geonet = 'https://www.geonet.org.nz';
export const usgsVolcanoName = 'USGS Volcano Notifications';
export const usgsVolcanoUrl = usgs + '/hans-public/api/notice/getNewestOrRecent';
export const geonetVolcanoName = 'GeoNet Volcano Bulletins';
export const geonetVolcanoUrl = 'https://api.geonet.org.nz/news/geonet';
const type = {category:'geo',kind:'volcano_bulletin',confidence:'Official volcano bulletin'};

export function normalizeUSGSVolcanoes(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error('Expected a USGS volcano notification list');
  const notices = new Map();
  for (const row of rows) {
    const id = row?.noticeIdentifier;
    const volcanoes = text(row?.volcanoes);
    const notice = text(row?.noticeType);
    const seconds = row?.sent_unixtime;
    if (!/^DOI-USGS-[a-z0-9-]{2,30}-\d{4}-\d{2}-\d{2}T[\d:]+(?:Z|[+-]\d{2}:\d{2})$/i.test(id || '') ||
        !volcanoes || !notice || !Number.isSafeInteger(seconds) || Math.abs(seconds) > 8.64e12 || notices.has(id)) continue;
    const issuer = text(row.obsFullname);
    const sections = Array.isArray(row.sections) ? row.sections.filter(section=>section && typeof section === 'object') : [];
    const entries = sections.slice(0,3).map(section => {
      const level = text(section.alertLevel);
      const aviation = text(section.colorCode);
      const name = text(section.volcanoName);
      const details = [level,aviation ? 'Aviation ' + aviation : ''].filter(Boolean).join(' · ');
      return [name,details,text(section.synopsis).slice(0,120)].filter(Boolean).join(' · ');
    }).filter(Boolean);
    const severe = sections.some(section=>section.alertLevel === 'WARNING' || section.colorCode === 'RED');
    const elevated = sections.some(section=>section.alertLevel === 'WATCH' || section.colorCode === 'ORANGE');
    const report = event({
      ...type, key:'usgs-volcano:' + id, source:usgsVolcanoName, ts:new Date(seconds*1000).toISOString(),
      title:notice + ' · ' + volcanoes, summary:[issuer ? 'Issued by ' + issuer + '.' : '', ...entries].join(' '),
      url:usgs + '/hans-public/notice/' + encodeURIComponent(id),
      score:severe ? 80 : elevated ? 61 : 48
    },now);
    if (report) notices.set(id,report);
  }
  return [...notices.values()];
}

export function normalizeGeoNetVolcanoes(data, now = Date.now()) {
  if (!Array.isArray(data?.feed)) throw new Error('Expected a GeoNet bulletin feed');
  const notices = new Map();
  for (const row of data.feed) {
    if (row?.type !== 'vab') continue;
    const link = safeUrl(row.link);
    if (!link) continue;
    const source = new URL(link);
    const id = /^\/vabs\/([a-z0-9]{5,50})\/?$/i.exec(source.pathname)?.[1];
    if (source.origin !== geonet || !id || notices.has(id)) continue;
    const level = Number.isInteger(row.val) && row.val >= 0 && row.val <= 5 ? row.val : null;
    const report = event({
      ...type, key:'geonet-volcano:' + id, source:geonetVolcanoName, ts:row.published,
      title:row.title,
      summary:level === null ? 'Volcanic activity bulletin published by GeoNet.' : 'GeoNet volcano alert level at issue: ' + level + ' of 5.',
      url:geonet + '/vabs/' + id,
      score:level >= 4 ? 80 : level >= 3 ? 64 : 48
    },now);
    if (report) notices.set(id,report);
  }
  return [...notices.values()];
}
import { event } from './events.mjs';

export const swpcUrl = 'https://services.swpc.noaa.gov/products/alerts.json';
export const swpcBulletins = 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings';
const source = 'NOAA Space Weather Prediction Center';
const descriptions = { ALERT: 'alert', WATCH: 'watch', WARNING: 'warning', 'EXTENDED WARNING': 'warning extension' };
const forecast = 'Check the NOAA bulletin for its forecast period and potential effects.';
const observed = 'NOAA reported reaching this geomagnetic threshold. Local effects require separate evidence.';

export function normalizeSWPC(rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error('Invalid NOAA space weather feed');
  const reports = [];
  for (const row of rows) {
    const product = row?.product_id;
    if (!/^K0[5-9][AW]$/.test(product || '') && product !== 'A20F') continue;
    if (typeof row.message !== 'string') continue;
    const bulletin = /^(ALERT|WATCH|WARNING|EXTENDED WARNING):[ \t]+([^\r\n]+)$/mi.exec(row.message);
    const serial = /^Serial Number:[ \t]*(\d+)\s*$/mi.exec(row.message)?.[1];
    const issued = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/.exec(row.issue_datetime || '');
    if (!bulletin || !serial || !issued) continue;

    const type = bulletin[1].toUpperCase();
    const explicit = /\bG([1-5])\b/i.exec(bulletin[2]) || /^NOAA Scale:[ \t]*G([1-5])\b/mi.exec(row.message);
    const level = explicit ? Number(explicit[1]) : product.startsWith('K') ? Number(product[2]) - 4 : 0;
    if (!level) continue;

    const validUntil = /^(?:Now )?Valid Until:[ \t]*([^\r\n]+)$/mi.exec(row.message)?.[1].trim();
    const context = type === 'ALERT' ? observed : forecast;
    const report = event({
      key: `swpc:${product}:${serial}`, source, ts: issued[1] + 'T' + issued[2] + (issued[3] || '') + 'Z',
      title: `NOAA G${level} geomagnetic storm ${descriptions[type]}`,
      summary: `${context}${validUntil && type !== 'ALERT' ? ' NOAA validity ends ' + validUntil + '.' : ''} Bulletin ${product} · Serial ${serial}.`,
      url: swpcBulletins, source_url_scope: 'archive',
      category: 'geo', kind: 'space_weather', score: level >= 4 ? 82 : level === 3 ? 70 : 46,
      confidence: type === 'ALERT' ? 'Official threshold bulletin' : 'Official forecast bulletin'
    }, now);
    if (report) reports.push(report);
  }
  return reports;
}

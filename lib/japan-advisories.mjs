import { event, parseRSS, safeUrl } from './events.mjs';

export const jvnUrl = 'https://jvn.jp/en/rss/jvn.rdf';
export const jpcertUrl = 'https://www.jpcert.or.jp/english/rss/jpcert-en.rdf';
export const jvnSource = 'Japan Vulnerability Notes';
export const jpcertSource = 'JPCERT/CC security alerts';

function utc(value) {
  // Both feeds publish a timestamp with its time zone. A missing zone is ambiguous.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value || '')) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}

function advisory(row, url, source, ts, now, metadata = {}) {
  return event({
    ...metadata, url, title:row.title, summary:row.summary, source, ts,
    category:'cyber', kind:'advisory', score:60, confidence:'Official advisory'
  }, now);
}

export function normalizeJVN(xml, now = Date.now()) {
  return parseRSS(xml).flatMap(row => {
    const href = safeUrl(row.url);
    if (!href) return [];
    const url = new URL(href);
    const id = /^\/en\/(?:jp|vu|ta)\/(JVN[A-Z0-9-]+)(?:\/[^/]*)?\/?$/i.exec(url.pathname)?.[1];
    if (url.hostname !== 'jvn.jp' || !id) return [];

    const published = utc(row.issued);
    const sourceDate = utc(row.modified) || utc(row.ts);
    const updated = published && sourceDate && sourceDate > published;
    const report = advisory(row, href, jvnSource, updated ? sourceDate : published || sourceDate, now, {
      key:'jvn:'+id.toUpperCase(),
      ...(updated ? { source_date_basis:'updated', source_published_at:published } : {})
    });
    return report ? [report] : [];
  });
}

export function normalizeJPCERT(xml, now = Date.now()) {
  return parseRSS(xml).flatMap(row => {
    const href = safeUrl(row.url);
    if (!href) return [];
    const url = new URL(href);
    if (url.hostname !== 'www.jpcert.or.jp' || !/^\/english\/at\/\d{4}\/[a-z\d-]+\.html$/i.test(url.pathname)) return [];
    const report = advisory(row, href, jpcertSource, utc(row.ts), now);
    return report ? [report] : [];
  });
}

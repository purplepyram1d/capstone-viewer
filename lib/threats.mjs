import { event } from './events.mjs';

// abuse.ch feeds publish thousands of indicators a day. One timeline row per indicator would bury everything,
// so they roll up to one report per malware family (ThreatFox) or tag (URLhaus) per UTC day. Indicators are
// never stored or displayed individually; the report links to abuse.ch for the list.
const abuseTime = value => { const t = Date.parse(String(value || '').replace(' UTC', 'Z').replace(' ', 'T')); return Number.isFinite(t) ? t : null; };
const rollupScore = n => n >= 100 ? 70 : n >= 25 ? 60 : 50;

function rollup(rows, keyOf, { minimum = 3, perDay = 12 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const t = abuseTime(row.time), key = keyOf(row); if (!t || !key) continue;
    const day = new Date(t).toISOString().slice(0, 10), id = `${day}|${key}`;
    if (!groups.has(id)) groups.set(id, { day, key, rows: [], latest: 0 });
    const g = groups.get(id); g.rows.push(row); g.latest = Math.max(g.latest, t);
  }
  const byDay = new Map();
  for (const g of groups.values()) { if (g.rows.length < minimum) continue; if (!byDay.has(g.day)) byDay.set(g.day, []); byDay.get(g.day).push(g); }
  return [...byDay.values()].flatMap(list => list.sort((a, b) => b.rows.length - a.rows.length).slice(0, perDay));
}

export function normalizeThreatFox(data, now = Date.now()) {
  if (data?.query_status === 'no_result') return [];
  if (data?.query_status !== 'ok' || !Array.isArray(data.data)) throw new Error(`ThreatFox query failed${data?.query_status ? `: ${data.query_status}` : ''}`);
  return rollup(data.data.map(i => ({ ...i, time: i.first_seen })), i => i.malware_printable && i.malware_printable !== 'Unknown malware' ? i.malware_printable : null).map(g => {
    const types = [...new Set(g.rows.map(i => i.threat_type_desc || i.threat_type).filter(Boolean))].slice(0, 3), sample = g.rows[0];
    return event({ key: `threatfox:${g.day}:${g.key}`, ts: new Date(g.latest).toISOString(), source: 'ThreatFox (abuse.ch)', category: 'cyber', kind: 'infrastructure',
      title: `${g.key}: ${g.rows.length} new indicators on ThreatFox`,
      summary: `${g.rows.length} indicators of compromise for ${g.key} first seen ${g.day} UTC${types.length ? ` (${types.join(', ')})` : ''}. Community-submitted to abuse.ch ThreatFox; confidence varies by reporter. Indicators are not copied into this app.`,
      url: sample.malware && /^[a-z0-9_.-]+$/i.test(sample.malware) ? `https://threatfox.abuse.ch/browse/malware/${sample.malware}/` : 'https://threatfox.abuse.ch/browse/',
      score: rollupScore(g.rows.length), confidence: 'Community threat intelligence · abuse.ch', indicator_count: g.rows.length }, now);
  }).filter(Boolean);
}

export function normalizeURLhaus(data, now = Date.now()) {
  if (data?.query_status === 'no_results') return [];
  if (data?.query_status !== 'ok' || !Array.isArray(data.urls)) throw new Error(`URLhaus query failed${data?.query_status ? `: ${data.query_status}` : ''}`);
  // Tags are reporter labels (family, file type, botnet); the first tag that is not a generic file type names the group.
  const generic = new Set(['exe', 'elf', 'dll', 'zip', 'rar', 'js', 'vbs', 'ps1', 'bat', 'hta', 'doc', 'xls', 'pdf', '32-bit', '64-bit', 'arm', 'mips', 'x86', 'sh', 'opendir', 'ascii', 'encrypted', 'mozi-like']);
  return rollup(data.urls.map(u => ({ ...u, time: u.date_added })), u => (u.tags || []).find(t => typeof t === 'string' && !generic.has(t.toLowerCase())) || null).map(g => {
    const online = g.rows.filter(u => u.url_status === 'online').length;
    return event({ key: `urlhaus:${g.day}:${g.key.toLowerCase()}`, ts: new Date(g.latest).toISOString(), source: 'URLhaus (abuse.ch)', category: 'cyber', kind: 'infrastructure',
      title: `${g.key}: ${g.rows.length} new malware distribution URLs on URLhaus`,
      summary: `${g.rows.length} URLs tagged ${g.key} added ${g.day} UTC; ${online} still online at collection. Community-submitted to abuse.ch URLhaus. URLs are not copied into this app.`,
      url: /^[a-z0-9_.-]+$/i.test(g.key) ? `https://urlhaus.abuse.ch/browse/tag/${encodeURIComponent(g.key)}/` : 'https://urlhaus.abuse.ch/browse/',
      score: rollupScore(g.rows.length), confidence: 'Community threat intelligence · abuse.ch', indicator_count: g.rows.length }, now);
  }).filter(Boolean);
}

export function nvdUrl(now = Date.now()) {
  const iso = t => new Date(t).toISOString().replace('Z', '');
  return `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${iso(now - 3 * 86400000)}&pubEndDate=${iso(now)}&cvssV3Severity=CRITICAL`;
}

// Critical (CVSS 3.x >= 9.0) CVEs published in the last three days. Severity is the publisher's score, not exploitation.
export function normalizeNVD(data, now = Date.now()) {
  if (!Array.isArray(data?.vulnerabilities)) throw new Error('Invalid NVD response');
  return data.vulnerabilities.map(({ cve }) => {
    if (!cve?.id || cve.vulnStatus === 'Rejected') return null;
    const metric = [...(cve.metrics?.cvssMetricV31 || []), ...(cve.metrics?.cvssMetricV30 || [])].sort((a, b) => (a.type === 'Primary' ? -1 : 1) - (b.type === 'Primary' ? -1 : 1))[0];
    const score = metric?.cvssData?.baseScore, description = (cve.descriptions || []).find(d => d.lang === 'en')?.value || '';
    if (!(score >= 9)) return null;
    const published = /[zZ]|[+-]\d\d:?\d\d$/.test(cve.published) ? cve.published : cve.published + 'Z';
    return event({ key: `nvd:${cve.id}`, ts: published, source: 'NVD', category: 'cyber', kind: 'vulnerability',
      title: `${cve.id} · CVSS ${score} · ${description.split(/(?<=\.)\s/)[0].slice(0, 180)}`,
      summary: `${description} Severity from ${metric.source || 'the CNA'}; this is a rating, not evidence of exploitation.`,
      url: `https://nvd.nist.gov/vuln/detail/${cve.id}`, score: 70, confidence: 'Official vulnerability record · NVD', cvss: score }, now);
  }).filter(Boolean);
}

// FIRST EPSS: daily probability that a CVE is exploited in the next 30 days. Cached per CVE for a day.
export function createEpss(db, request = fetch) {
  db.exec('CREATE TABLE IF NOT EXISTS epss (cve TEXT PRIMARY KEY, epss REAL NOT NULL, percentile REAL NOT NULL, date TEXT, fetched TEXT NOT NULL)');
  const put = db.prepare('INSERT INTO epss VALUES (?,?,?,?,?) ON CONFLICT(cve) DO UPDATE SET epss=excluded.epss, percentile=excluded.percentile, date=excluded.date, fetched=excluded.fetched');
  return {
    async refresh(cves, now = Date.now()) {
      const fresh = new Set(db.prepare('SELECT cve FROM epss WHERE fetched >= ?').all(new Date(now - 20 * 3600000).toISOString()).map(r => r.cve));
      const wanted = [...new Set(cves)].filter(c => /^CVE-\d{4}-\d{4,}$/.test(c) && !fresh.has(c)).slice(0, 600);
      for (let i = 0; i < wanted.length; i += 50) {
        const batch = wanted.slice(i, i + 50), response = await request(`https://api.first.org/data/v1/epss?cve=${batch.join(',')}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'CapstoneViewer/0.1 (+local OSINT dashboard)' } });
        if (!response.ok) throw new Error(`EPSS returned HTTP ${response.status}`);
        const data = await response.json(), fetched = new Date(now).toISOString(), seen = new Set();
        for (const row of data.data || []) { const e = Number(row.epss), p = Number(row.percentile); if (!Number.isFinite(e) || !Number.isFinite(p)) continue; put.run(row.cve, e, p, row.date || null, fetched); seen.add(row.cve); }
        // New CVEs have no score until FIRST's next daily run; remember that we asked so they are retried tomorrow.
        for (const cve of batch) if (!seen.has(cve)) db.prepare('INSERT INTO epss VALUES (?,?,?,?,?) ON CONFLICT(cve) DO UPDATE SET fetched=excluded.fetched WHERE epss < 0').run(cve, -1, -1, null, fetched);
      }
      return wanted.length;
    },
    attach(list) {
      const rows = new Map(db.prepare('SELECT cve, epss, percentile, date FROM epss WHERE epss >= 0').all().map(r => [r.cve, r]));
      return list.map(e => { const best = (e.cves || []).map(c => rows.get(c)).filter(Boolean).sort((a, b) => b.epss - a.epss)[0]; return best ? { ...e, epss: best } : e; });
    }
  };
}

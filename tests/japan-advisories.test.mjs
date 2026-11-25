import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJPCERT, normalizeJVN } from '../lib/japan-advisories.mjs';
import { sourceContext } from '../lib/reading.mjs';

const now = Date.parse('2026-11-23T12:00:00Z');
const rdf = items => `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
<channel><title>Fixture advisories</title></channel>${items}</rdf:RDF>`;
const item = (url, dates) => `<item><title>Vendor A &amp; B guidance</title><link>${url}</link>
<description>Mitigate CVE-2026-12345 &#8212; verify the affected product.</description>${dates}</item>`;

test('JVN keeps the first publication and uses the latest explicit source update on the same report', () => {
  const href = 'https://jvn.jp/en/jp/JVN12345678/index.html';
  const issued = '<dcterms:issued>2026-10-12T12:00:00+09:00</dcterms:issued>';
  const current = '<dcterms:modified>2026-11-20T10:00:00+09:00</dcterms:modified>';
  const [report] = normalizeJVN(rdf(item(href, issued + current)), now);
  assert.equal(report.ts, '2026-11-20T01:00:00.000Z');
  assert.equal(report.source_published_at, '2026-10-12T03:00:00.000Z');
  assert.equal(report.source_date_basis, 'updated');
  assert.equal(report.place_basis, 'unlocated');
  assert.equal(report.title, 'Vendor A & B guidance');
  assert.match(report.summary, /— verify/);
  assert.deepEqual(report.cves, ['CVE-2026-12345']);
  assert.equal(sourceContext(report).role,'official');
  const [previous] = normalizeJVN(rdf(item(href, issued + current.replace('20T10','19T10'))), now);
  assert.equal(previous.id, report.id);
  assert.notEqual(previous.ts, report.ts);
  const [fresh] = normalizeJVN(rdf(item(href, issued.replace('10-12','11-12'))), now);
  assert.equal(fresh.source_date_basis, undefined);
});

test('JPCERT limits English RSS intake to dated security alerts on the official site', () => {
  const normal = '<dc:date>2026-11-21T11:21+09:00</dc:date>';
  const undated = '<dc:date>2026-11-21T11:21</dc:date>';
  const output = normalizeJPCERT(rdf(
    item('https://www.jpcert.or.jp/english/at/2026/at260001.html', normal) +
    item('https://www.jpcert.or.jp/english/at/2026/at260002.html', undated) +
    item('https://www.jpcert.or.jp/english/doc/news.html', normal) +
    item('https://example.org/english/at/2026/at260003.html', normal)
  ), now);
  assert.equal(output.length,1);
  assert.equal(output[0].ts,'2026-11-21T02:21:00.000Z');
  assert.equal(output[0].kind,'advisory');
});

test('JVN skips foreign host and unrelated links and retains an explicitly empty feed', () => {
  const current = '<dc:date>2026-11-20T10:00:00+09:00</dc:date>';
  assert.deepEqual(normalizeJVN(rdf(
    item('https://jvn.jp/en/rss/index.html',current) +
    item('https://example.org/en/jp/JVN12345678/index.html',current)
  ),now),[]);
  assert.deepEqual(normalizeJVN(rdf(''),now),[]);
});

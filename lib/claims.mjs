// Attack-claim parsing for feeds that relay cyber incidents (e.g. Hackmanac's "🚨Cyber Alert" posts).
// A post is only treated as an incident when it opens with a country flag; anything else stays an
// ordinary post. Claims are never presented as confirmed: "claims to have" stays a claim.
const flagCode = flag => [...flag].map(c => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65)).join('');
// Some relays use UK where the ISO code is GB.
const codeAliases = { UK: 'GB' };

// Mathematical bold/italic letters (𝗘𝗠𝗔𝗥𝗞𝗘𝗧𝗘𝗥) normalize to plain text under NFKC.
export const plain = value => String(value || '').normalize('NFKC').replace(/[​-‍⁠]/g, '').replace(/[ \t]+/g, ' ').trim();

export function classifyClaim(body) {
  const t = body.toLowerCase();
  if (/\bddos\b|denial[- ]of[- ]service|hacktivis|\bnoname057|#op[a-z]/i.test(body)) return { type: 'hacktivist', label: 'Hacktivist claim', claim: true };
  if (/claims? (to have|responsibility)|allegedly|claimed|threatened to leak/.test(t)) return /ransomware/.test(t) ? { type: 'ransomware', label: 'Ransomware claim', claim: true } : { type: 'breach', label: 'Breach claim', claim: true };
  return { type: 'incident', label: 'Reported incident', claim: false };
}

// Correct retained machine-generated labels without changing source excerpts.
export function repairRelayLabels(db) {
  const tables = [
    ['developing_threads', ['title'], "EXISTS (SELECT 1 FROM developing_reports r WHERE r.thread_id=developing_threads.id AND CASE WHEN json_valid(r.data) THEN json_extract(r.data,'$.title')=json_extract(developing_threads.data,'$.title') AND json_extract(r.data,'$.confidence')='Victim-confirmed incident, relayed by a tracker' ELSE 0 END)"],
    ['developing_changes', ['title'], "EXISTS (SELECT 1 FROM developing_reports r WHERE r.thread_id=developing_changes.thread_id AND CASE WHEN json_valid(r.data) THEN r.report_id=json_extract(developing_changes.data,'$.report_id') AND json_extract(r.data,'$.confidence')='Victim-confirmed incident, relayed by a tracker' ELSE 0 END)"],
    ['developing_reports', ['title', 'confidence']],
    ['events', ['title', 'confidence']]
  ];
  db.exec('BEGIN');
  try {
    for (const [table, fields, linkedRelay] of tables) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      for (const field of fields) {
        const path = '$.' + field;
        const condition = field === 'title' ? 'Confirmed incident:%' : 'Victim-confirmed incident, relayed by a tracker';
        const replacement = field === 'title'
          ? "'Reported incident:' || substr(json_extract(data, ?), length('Confirmed incident:')+1)"
          : "'Unverified incident report from a relay'";
        const args = field === 'title' ? [path, path, path, condition] : [path, path, condition];
        const relayOnly = field === 'title' ? ' AND (' + (linkedRelay || "json_extract(data,'$.confidence')='Victim-confirmed incident, relayed by a tracker'") + ')' : '';
        db.prepare(`UPDATE ${table} SET data=json_set(data, ?, ${replacement}) WHERE CASE WHEN json_valid(data) THEN json_extract(data, ?) LIKE ?${relayOnly} ELSE 0 END`).run(...args);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Returns enrichment for a relayed incident post, or null when the post is not one.
export function parseClaim(text, countries) {
  const body = plain(text), lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const head = lines.find(l => /^\p{Regional_Indicator}{2}/u.test(l));
  if (!head) return null;
  const flag = head.match(/^\p{Regional_Indicator}{2}/u)[0], code = codeAliases[flagCode(flag)] || flagCode(flag), country = countries[code];
  if (!country) return null;
  // "🇺🇸US - EMARKETER" or "🇪🇬Egypt: Telecom Egypt - We academy": the victim follows the first separator.
  const victim = head.slice(flag.length).replace(/^[^-:–]*[-:–]\s*/, '').trim().slice(0, 140);
  const detail = lines.slice(lines.indexOf(head) + 1).join(' ');
  // An explicit "Threat actor:" field wins; otherwise the name before "... group" in the first sentence.
  const group = detail.match(/Threat actor:\s*([^\n/]{2,60}?)(?:\s{2,}|\s*Sector:|$)/i)?.[1]?.trim() || detail.match(/^(?:the\s+)?((?:[^.\n]|\.(?=\d)){2,60}?)\s+(?:ransomware|hacking|hacker|hacktivist)\s+(?:group|gang|crew)/i)?.[1]?.trim() || null;
  // Some alerts put a whole headline where the victim goes; then take the name after "breached".
  const named = victim.length > 70 ? detail.match(/(?:claims? to have|has)\s+(?:breached|compromised|hacked|attacked|hit)\s+(?:the\s+)?([^,.;()]{2,70})/i)?.[1]?.trim() || victim.slice(0, 70) + '…' : victim;
  const kind = classifyClaim(body);
  const title = kind.claim
    ? `${kind.label}: ${group ? `${group} says it hit` : 'attack claimed on'} ${named || country.name} (${country.name})`
    : `Reported incident: ${named || 'organization'} (${country.name})`;
  return { title: title.slice(0, 220), summary: detail.slice(0, 480), country: code, lat: country.lat, lon: country.lon, place: country.name, place_basis: 'country_centroid',
    kind: kind.claim ? 'claim' : 'incident', claim_type: kind.type, claim_group: group, victim: named || null,
    confidence: kind.claim ? 'Unverified actor claim, relayed by a tracker' : 'Unverified incident report from a relay', score: kind.type === 'hacktivist' ? 60 : 55 };
}

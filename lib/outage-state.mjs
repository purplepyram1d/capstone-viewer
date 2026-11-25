export const FRESH_RECEIPT_MS = 20 * 60_000;

// Retain the source's original ongoing flag. Only a recent receipt establishes a current listing.
export function outageFreshness(report, received, now = Date.now()) {
  if (report.kind !== 'outage' || report.ongoing !== true) return report;
  const age = now - Date.parse(received);
  return { ...report, outage_state: age >= 0 && age <= FRESH_RECEIPT_MS ? 'current' : 'stale', outage_received: received ?? null };
}

export const currentOutage = report => report.kind === 'outage' && report.ongoing === true && report.outage_state !== 'stale';
export const staleOutage = report => report.kind === 'outage' && report.ongoing === true && report.outage_state === 'stale';

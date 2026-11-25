const MINUTE = 60_000;

export function sourceListingUntil(lastReceived,feed,validUntil,now = Date.now()) {
  if (feed?.state !== 'ok' || feed.enabled === false) return null;
  const received = Date.parse(lastReceived), body = Date.parse(feed.lastBodyStarted);
  const success = Date.parse(feed.lastSuccess), expires = validUntil == null ? Infinity : Date.parse(validUntil);
  if (![received,body,success].every(Number.isFinite) || Number.isNaN(expires) || received < body) return null;
  const interval = Number(feed.intervalMinutes) || 5;
  const until = Math.min(expires,success + Math.max(15,interval*3)*MINUTE);
  return until>now ? new Date(until).toISOString() : null;
}

export function listedWeatherUntil(report,lastReceived,feed,now = Date.now()) {
  return report.kind==='weather_alert' && report.weather_status!=='ended' && (report.weather_valid_until || report.weather_status==='active') ?
    sourceListingUntil(lastReceived,feed,report.weather_valid_until,now) : null;
}
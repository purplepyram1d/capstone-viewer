// Market board for the live wall: major stock indices from Yahoo Finance's chart endpoint (keyless and unofficial; one
// request per index) and crypto from CoinGecko's simple price endpoint (keyless). Fetched at most every 15 minutes; a
// source that fails keeps its last good values, marked stale, and a round that gets nothing retries after 2 minutes.
export const INDICES = [['^GSPC', 'S&P 500'], ['^DJI', 'Dow Jones'], ['^IXIC', 'Nasdaq'], ['^FTSE', 'FTSE 100'], ['^GDAXI', 'DAX'], ['^N225', 'Nikkei 225']];
export const COINS = [['bitcoin', 'Bitcoin', 'BTC'], ['ethereum', 'Ethereum', 'ETH'], ['solana', 'Solana', 'SOL']];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CapstoneViewer/0.1', TTL = 15 * 60000, RETRY = 2 * 60000;
const iso = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;

export function parseYahoo(json, symbol, label, now = Date.now()) {
  const m = json?.chart?.result?.[0]?.meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error(`No price for ${label}`);
  const prev = Number.isFinite(m.chartPreviousClose) ? m.chartPreviousClose : m.previousClose, regular = m.currentTradingPeriod?.regular;
  const open = regular && Number.isFinite(regular.start) && Number.isFinite(regular.end) ? now / 1000 >= regular.start && now / 1000 < regular.end : null;
  return { id: symbol, label, group: 'index', price: m.regularMarketPrice, change: Number.isFinite(prev) ? m.regularMarketPrice - prev : null,
    changePct: Number.isFinite(prev) && prev ? (m.regularMarketPrice - prev) / prev * 100 : null, currency: m.currency || 'USD', state: open === null ? null : open ? 'open' : 'closed', asOf: iso(m.regularMarketTime) };
}

export function parseCoinGecko(json) {
  return COINS.map(([id, label, symbol]) => {
    const c = json?.[id]; if (!c || !Number.isFinite(c.usd)) return null;
    return { id, label, symbol, group: 'crypto', price: c.usd, change: null, changePct: Number.isFinite(c.usd_24h_change) ? c.usd_24h_change : null, currency: 'USD', state: '24h', asOf: iso(c.last_updated_at) };
  }).filter(Boolean);
}

export function createMarkets({ request = fetch, enabled = true, clock = Date.now } = {}) {
  const good = new Map(), order = [...INDICES.map(i => i[0]), ...COINS.map(c => c[0])];
  let board = { updated: null, items: [], errors: [] }, pending = null, nextAt = 0;
  async function getJson(url) {
    const res = await request(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function refresh() {
    const now = clock(), errors = [], failed = new Set();
    const indices = await Promise.allSettled(INDICES.map(([symbol, label]) => getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`).then(json => parseYahoo(json, symbol, label, now))));
    indices.forEach((r, i) => { if (r.status === 'fulfilled') good.set(r.value.id, r.value); else { failed.add(INDICES[i][0]); errors.push(`${INDICES[i][1]}: ${r.reason?.message || r.reason}`); } });
    try {
      const coins = parseCoinGecko(await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${COINS.map(c => c[0]).join(',')}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`));
      for (const c of coins) good.set(c.id, c);
      for (const [id] of COINS) if (!coins.some(c => c.id === id)) failed.add(id);
    } catch (error) { COINS.forEach(([id]) => failed.add(id)); errors.push(`Crypto: ${error.message}`); }
    const fetchedAny = order.some(id => !failed.has(id));
    board = { updated: fetchedAny ? new Date(now).toISOString() : board.updated, items: order.filter(id => good.has(id)).map(id => ({ ...good.get(id), stale: failed.has(id) })), errors };
    nextAt = now + (fetchedAny ? TTL : RETRY);
    return board;
  }
  return {
    async get() {
      if (!enabled) return { ...board, disabled: true };
      if (clock() < nextAt) return board;
      pending ||= refresh().finally(() => { pending = null; });
      return pending;
    }
  };
}

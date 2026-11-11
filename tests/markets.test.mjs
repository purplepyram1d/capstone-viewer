import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahoo, parseCoinGecko, createMarkets, INDICES } from '../lib/markets.mjs';
const now = Date.parse('2026-11-04T15:00:00Z'), s = ms => Math.floor(ms / 1000);
const yahoo = (price, prev, open = true) => ({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, currency: 'USD', regularMarketTime: s(now - 60000), currentTradingPeriod: { regular: open ? { start: s(now - 3600000), end: s(now + 3600000) } : { start: s(now + 3600000), end: s(now + 7200000) } } } }] } });
const gecko = { bitcoin: { usd: 79395, usd_24h_change: 2.5, last_updated_at: s(now) }, ethereum: { usd: 2376.67, usd_24h_change: -1.2, last_updated_at: s(now) }, solana: { usd: 95.32, usd_24h_change: 0.4, last_updated_at: s(now) } };

test('Yahoo chart metadata becomes price, change against the previous close, and open or closed', () => {
  const q = parseYahoo(yahoo(110, 100), '^GSPC', 'S&P 500', now);
  assert.equal(q.price, 110); assert.equal(q.change, 10); assert.equal(q.changePct, 10); assert.equal(q.state, 'open'); assert.equal(q.group, 'index');
  assert.equal(parseYahoo(yahoo(90, 100, false), '^N225', 'Nikkei 225', now).state, 'closed');
  assert.throws(() => parseYahoo({ chart: { result: [] } }, '^DJI', 'Dow Jones', now), /No price/);
});

test('CoinGecko prices carry the 24-hour change; missing coins are skipped', () => {
  const coins = parseCoinGecko(gecko);
  assert.deepEqual(coins.map(c => c.symbol), ['BTC', 'ETH', 'SOL']); assert.equal(coins[1].changePct, -1.2);
  assert.equal(parseCoinGecko({ bitcoin: { usd: 1 } }).length, 1);
});

function fakeRequest(state) {
  return async url => {
    state.calls++;
    if (url.includes('coingecko')) return state.coinsDown ? { ok: false, status: 429 } : { ok: true, json: async () => gecko };
    const symbol = decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
    if (state.down?.includes(symbol)) return { ok: false, status: 500 };
    return { ok: true, json: async () => yahoo(state.price, 100) };
  };
}

test('the board is cached for 15 minutes and keeps last good values when a source fails', async () => {
  let clock = now; const state = { calls: 0, price: 110 };
  const markets = createMarkets({ request: fakeRequest(state), clock: () => clock });
  const first = await markets.get();
  assert.equal(first.items.length, INDICES.length + 3); assert.equal(state.calls, INDICES.length + 1); assert.equal(first.errors.length, 0);
  clock += 10 * 60000; await markets.get(); assert.equal(state.calls, INDICES.length + 1, 'within 15 minutes nothing is refetched');
  clock += 6 * 60000; state.price = 120; state.down = ['^DJI']; state.coinsDown = true;
  const third = await markets.get();
  assert.equal(third.items.find(i => i.id === '^GSPC').price, 120);
  const dow = third.items.find(i => i.id === '^DJI'); assert.equal(dow.price, 110); assert.equal(dow.stale, true);
  assert.equal(third.items.find(i => i.id === 'bitcoin').stale, true);
  assert.equal(third.errors.length, 2);
});

test('a round that gets nothing retries after two minutes; disabled boards never fetch', async () => {
  let clock = now; const state = { calls: 0, price: 1, down: INDICES.map(i => i[0]), coinsDown: true };
  const markets = createMarkets({ request: fakeRequest(state), clock: () => clock });
  const empty = await markets.get(); assert.equal(empty.items.length, 0); assert.equal(empty.updated, null);
  const calls = state.calls; clock += 3 * 60000; await markets.get(); assert.ok(state.calls > calls);
  const off = createMarkets({ request: () => { throw new Error('should not fetch'); }, enabled: false });
  assert.equal((await off.get()).disabled, true);
});

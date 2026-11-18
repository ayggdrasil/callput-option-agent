import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as marketStatus from '../frontend-v1/market-status.js';

const { normalizeMarketStatus } = marketStatus;

const now = Date.parse('2026-10-09T06:30:00Z');
const base = { slug: 'base', chainId: 8453, testnet: false };
const giwa = { slug: 'giwa', chainId: 91342, testnet: true };

function payload(profile = base) {
  return {
    network: profile.slug,
    chain_id: profile.chainId,
    testnet: profile.testnet,
    checked_at: new Date(now).toISOString(),
    assets: [
      { symbol: 'TSLA', market_type: 'STOCK', spot_price: 400, tradable_options: 6 },
      { symbol: 'NEW', market_type: 'STOCK', spot_price: 100, tradable_options: 2 },
      { symbol: 'ETH', market_type: 'CRYPTO', spot_price: 2000, tradable_options: 0 }
    ]
  };
}

test('discovers registered symbols and retains the verified network identity', () => {
  const status = normalizeMarketStatus(payload(giwa), giwa, now);
  assert.deepEqual(status.assets.map(x => x.symbol), ['TSLA', 'NEW', 'ETH']);
  assert.equal(status.activeCount, 2);
  assert.equal(status.optionCount, 8);
  assert.equal(status.assets[2].count, 0);
  assert.equal(status.checkedAt, new Date(now).toISOString());
  assert.deepEqual(
    { network: status.network, chainId: status.chainId, testnet: status.testnet },
    { network: 'giwa', chainId: 91342, testnet: true }
  );
});

test('rejects malformed, duplicate, stale, or unexpected-network status', () => {
  for (const count of [-1, 1.5, '6', null, Number.NaN]) {
    const value = payload(); value.assets[0].tradable_options = count;
    assert.throws(() => normalizeMarketStatus(value, base, now));
  }
  const duplicate = payload(); duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => normalizeMarketStatus(duplicate, base, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), network: 'giwa' }, base, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), chain_id: 1 }, base, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), testnet: true }, base, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), checked_at: '2026-10-08T00:00:00Z' }, base, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), checked_at: 'invalid' }, base, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), assets: [] }, base, now));
});

test('zero available options and unavailable reference price are not fabricated', () => {
  const value = payload(); value.assets = [{ symbol: 'QQQ', market_type: 'STOCK', spot_price: null, tradable_options: 0 }];
  const status = normalizeMarketStatus(value, base, now);
  assert.equal(status.activeCount, 0);
  assert.equal(status.optionCount, 0);
  assert.equal(status.assets[0].spot, null);
  assert.equal(status.assets[0].type, 'etf');
});

test('network changes abort the prior request and ignore a late stale response', async () => {
  const requests = [];
  const fetchImpl = (url, options) => new Promise((resolve) => requests.push({ url, options, resolve }));
  assert.equal(typeof marketStatus.createMarketStatusLoader, 'function');
  const load = marketStatus.createMarketStatusLoader({ fetchImpl, now: () => now, timeoutMs: 1_000 });

  const first = load(base);
  const second = load(giwa);
  assert.equal(requests[0].url, '/api/bankr/assets?network=base');
  assert.equal(requests[1].url, '/api/bankr/assets?network=giwa');
  assert.equal(requests[0].options.signal.aborted, true);

  requests[1].resolve({ ok: true, json: async () => payload(giwa) });
  assert.equal((await second).network, 'giwa');

  requests[0].resolve({ ok: true, json: async () => payload(base) });
  assert.equal(await first, null);
});

test('feed failures preserve a safe stale-data explanation', async () => {
  const load = marketStatus.createMarketStatusLoader({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Market feed is stale. Quotes and new trade preparation are paused.' })
    }),
    now: () => now
  });

  await assert.rejects(load(base), /Market feed is stale.*paused/);
});

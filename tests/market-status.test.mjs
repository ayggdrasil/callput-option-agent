import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMarketStatus } from '../frontend-v1/market-status.js';

const now = Date.parse('2026-09-26T06:30:00Z');
function payload() {
  return { chain_id: 8453, checked_at: new Date(now).toISOString(), assets: [
    { symbol: 'TSLA', market_type: 'STOCK', spot_price: 400, tradable_options: 6 },
    { symbol: 'NEW', market_type: 'STOCK', spot_price: 100, tradable_options: 2 },
    { symbol: 'ETH', market_type: 'CRYPTO', spot_price: 2000, tradable_options: 0 }
  ] };
}
test('discovers registered symbols from API and counts only available rows', () => {
  const status = normalizeMarketStatus(payload(), now);
  assert.deepEqual(status.assets.map(x => x.symbol), ['TSLA', 'NEW', 'ETH']);
  assert.equal(status.activeCount, 2);
  assert.equal(status.optionCount, 8);
  assert.equal(status.assets[2].count, 0);
  assert.equal(status.checkedAt, new Date(now).toISOString());
});
test('rejects malformed, duplicate, wrong-chain and stale status rather than advertising it as live', () => {
  for (const count of [-1, 1.5, '6', null, Number.NaN]) {
    const value = payload(); value.assets[0].tradable_options = count;
    assert.throws(() => normalizeMarketStatus(value, now));
  }
  const duplicate = payload(); duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => normalizeMarketStatus(duplicate, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), chain_id: 1 }, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), checked_at: '2026-09-25T00:00:00Z' }, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), checked_at: 'invalid' }, now));
  assert.throws(() => normalizeMarketStatus({ ...payload(), assets: [] }, now));
});
test('zero available options and unavailable reference price are not fabricated', () => {
  const value = payload(); value.assets = [{ symbol: 'QQQ', market_type: 'STOCK', spot_price: null, tradable_options: 0 }];
  const status = normalizeMarketStatus(value, now);
  assert.equal(status.activeCount, 0);
  assert.equal(status.optionCount, 0);
  assert.equal(status.assets[0].spot, null);
  assert.equal(status.assets[0].type, 'etf');
});

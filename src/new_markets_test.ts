import assert from "node:assert/strict";
import { CONFIG } from "./config.js";
import { formatExpiry, getMarketSnapshot, getOptionChains, normalizeAsset, scanSpreads } from "./core.js";

const symbols = ["SNDK", "DRAM", "META", "GOOGL", "AAPL", "CRCL", "AMZN", "MSFT", "PLTR"];
const expiry = Math.floor(Date.now() / 1000) + 14 * 86400;
const expiryCode = formatExpiry(expiry);
const market: Record<string, unknown> = {};
for (const [offset, symbol] of symbols.entries()) {
  const index = 12 + offset;
  const row = (strike: number, side: "C" | "P") => ({
    instrument: `${symbol}-${expiryCode}-${strike}-${side}`,
    optionId: `0x${((BigInt(index) << 240n) | (BigInt(expiry) << 200n) | (BigInt(strike) << 152n)).toString(16).padStart(64, "0")}`,
    strikePrice: strike,
    markPrice: side === "C" ? 120 - strike : strike - 90,
    riskPremiumRateForBuy: 0.01,
    riskPremiumRateForSell: 0.01,
    markIv: 0.4,
    isOptionAvailable: true,
    expiry
  });
  market[symbol] = { expiries: [String(expiry)], options: { [expiry]: {
    call: [95, 100, 105, 110].map(strike => row(strike, "C")),
    put: [95, 100, 105, 110].map(strike => row(strike, "P"))
  } } };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  lastUpdatedAt: new Date().toISOString(),
  data: { market, spotIndices: Object.fromEntries(symbols.map(symbol => [symbol, 100])) }
}), { status: 200 });
try {
  for (const [offset, symbol] of symbols.entries()) {
    assert.equal(normalizeAsset(symbol.toLowerCase()), symbol, `${symbol} must be accepted by MCP`);
    const config = (CONFIG.UNDERLYINGS as Record<string, { index: number; decimals: number; optionsToken: string }>)[symbol];
    assert.equal(config.index, offset + 12, `${symbol} must match the encoded public feed index`);
    assert.equal(config.decimals, 18);
    assert.match(config.optionsToken, /^0x[0-9a-fA-F]{40}$/);
  }
  const snapshot = await getMarketSnapshot(true);
  assert.equal(snapshot.options.length, symbols.length * 8);
  for (const symbol of symbols) {
    const chains = await getOptionChains({ underlyingAsset: symbol, optionType: "Call", maxExpiries: 1, maxStrikes: 4 });
    assert.equal(chains.expiries[expiryCode].call.length, 4, `${symbol} chain must be available`);
    const scan = await scanSpreads({ underlyingAsset: symbol, bias: "bullish", maxResults: 1 });
    assert.ok(scan.candidates.length > 0, `${symbol} must produce a read-only spread candidate`);
    assert.equal(scan.asset, symbol);
  }
  console.log("All nine newly registered markets parse, expose chains and scan spreads.");
} finally {
  globalThis.fetch = originalFetch;
}

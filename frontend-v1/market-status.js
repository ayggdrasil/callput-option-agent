export function normalizeMarketStatus(payload, now = Date.now()) {
  const checked = Date.parse(payload?.checked_at);
  if (payload?.chain_id !== 8453 || !Array.isArray(payload.assets) || !payload.assets.length ||
      !Number.isFinite(checked) || now - checked > 300_000 || checked - now > 60_000) {
    throw new Error("Market status is unavailable or stale");
  }
  const symbols = new Set();
  const assets = payload.assets.map((asset) => {
    if (!asset || !/^[A-Z0-9]{1,16}$/.test(asset.symbol) || symbols.has(asset.symbol) ||
        !["CRYPTO", "STOCK", "ETF"].includes(asset.market_type) ||
        !Number.isSafeInteger(asset.tradable_options) || asset.tradable_options < 0) {
      throw new Error("Invalid market status");
    }
    symbols.add(asset.symbol);
    return {
      symbol: asset.symbol,
      type: ["QQQ", "SPY", "EWY"].includes(asset.symbol) ? "etf" : asset.market_type.toLowerCase(),
      count: asset.tradable_options,
      spot: Number.isFinite(asset.spot_price) && asset.spot_price > 0 ? asset.spot_price : null
    };
  });
  return {
    assets,
    checkedAt: new Date(checked).toISOString(),
    activeCount: assets.filter(asset => asset.count > 0).length,
    optionCount: assets.reduce((sum, asset) => sum + asset.count, 0)
  };
}

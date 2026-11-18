export function normalizeMarketStatus(payload, expectedNetwork, now = Date.now()) {
  const checked = Date.parse(payload?.checked_at);
  if (!expectedNetwork || payload?.network !== expectedNetwork.slug ||
      payload?.chain_id !== expectedNetwork.chainId || payload?.testnet !== expectedNetwork.testnet ||
      !Array.isArray(payload.assets) || !payload.assets.length ||
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
    network: payload.network,
    chainId: payload.chain_id,
    testnet: payload.testnet,
    checkedAt: new Date(checked).toISOString(),
    activeCount: assets.filter(asset => asset.count > 0).length,
    optionCount: assets.reduce((sum, asset) => sum + asset.count, 0)
  };
}

export function createMarketStatusLoader({ fetchImpl = fetch, now = Date.now, timeoutMs = 10_000 } = {}) {
  let activeRequest = null;
  let requestId = 0;

  return async function loadMarketStatus(network) {
    const id = ++requestId;
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`/api/bankr/assets?network=${encodeURIComponent(network.slug)}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        let reason = "";
        try {
          const body = await response.json();
          reason = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "";
        } catch {
          // The status code remains sufficient when the response has no JSON error body.
        }
        throw new Error(reason || `assets endpoint returned ${response.status}`);
      }
      const status = normalizeMarketStatus(await response.json(), network, now());
      return id === requestId ? status : null;
    } finally {
      clearTimeout(timeout);
      if (id === requestId) activeRequest = null;
    }
  };
}

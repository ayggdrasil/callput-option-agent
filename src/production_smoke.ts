const origin = (process.env.CALLPUT_PRODUCTION_URL || "https://mcp.callput.app").replace(/\/$/, "");

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body as any;
}

async function main() {
  const health = await json("/api/health");
  if (health.status !== "ok" || health.checks?.rpc?.chain_id !== 8453) throw new Error("production health is not healthy on Base");
  if (health.checks?.rpc?.dedicated_rpc_configured !== true) throw new Error("production RPC_URL is not configured");

  const assets = await json("/api/bankr/assets");
  const configured = Object.keys(CONFIG.UNDERLYINGS);
  if (!Array.isArray(assets.assets) || configured.some(symbol => !assets.assets.some((asset: any) => asset.symbol === symbol))) {
    throw new Error("production asset catalog is incomplete");
  }
  if (!Number.isFinite(Date.parse(assets.checked_at))) throw new Error("production market timestamp missing");
  if (health.version !== CALLPUT_VERSION) throw new Error("production version does not match this release");

  const initialize = await json("/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "production-smoke", version: "1" } } })
  });
  if (initialize.result?.serverInfo?.name !== "callput-lite-agent-mcp") throw new Error("production MCP initialize failed");
  if (initialize.result?.serverInfo?.version !== CALLPUT_VERSION) throw new Error("production MCP version mismatch");

  let requestId = 2;
  for (const symbol of ["SNDK", "DRAM", "META", "GOOGL", "AAPL", "CRCL", "AMZN", "MSFT", "PLTR"]) {
    for (const [name, args] of [
      ["callput_get_option_chains", { underlying_asset: symbol, max_expiries: 1, max_strikes: 2 }],
      ["callput_scan_spreads", { underlying_asset: symbol, bias: "bullish", max_results: 1 }]
    ] as const) {
      const result = await json("/api/mcp", {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: args } })
      });
      if (result.error || result.result?.isError) throw new Error(`${symbol} ${name} failed: ${JSON.stringify(result)}`);
      const payload = JSON.parse(result.result.content[0].text);
      if (payload.asset !== symbol) throw new Error(`${symbol} ${name} returned the wrong asset`);
    }
    console.log(`Read-only chains and spread scan passed: ${symbol}`);
  }

  for (const path of ["/", "/bankr", "/llms.txt"]) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  }
  console.log(`Production smoke passed for ${origin} at block ${health.checks.rpc.block_number}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
import { CONFIG } from "./config.js";
import { CALLPUT_VERSION } from "./version.js";

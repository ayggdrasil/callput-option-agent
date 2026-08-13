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

  const assets = await json("/api/bankr/assets");
  if (!Array.isArray(assets.assets) || assets.assets.length < 11) throw new Error("production asset catalog is incomplete");

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

  for (const path of ["/", "/bankr"]) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  }
  console.log(`Production smoke passed for ${origin} at block ${health.checks.rpc.block_number}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

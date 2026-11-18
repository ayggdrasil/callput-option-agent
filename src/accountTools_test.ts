import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcpHttpRequest } from "./http.js";
import { DEPLOYMENTS } from "./networkDeployments.js";
import { networkInfo, withNetwork } from "./config.js";
test("account workflow tools are discoverable even when durable storage is not configured", async () => {
  const response = await handleMcpHttpRequest(
    new Request("https://mcp.callput.app/api/mcp?network=robinhood", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    }),
  );
  const body: any = await response.json();
  const start = body.result.tools.find((tool: any) => tool.name === "callput_workflow_start");
  assert.ok(start.inputSchema.properties.underlying_asset);
  assert.deepEqual(start.inputSchema.properties.strategy.enum, [
    "BuyCallSpread", "SellCallSpread", "BuyPutSpread", "SellPutSpread",
  ]);
  const names = body.result.tools.map((t: any) => t.name);
  for (const name of [
    "callput_wallet_connect",
    "callput_account_resolve",
    "callput_workflow_start",
    "callput_workflow_status",
    "callput_action_prepare",
    "callput_action_submit",
    "callput_action_status",
    "callput_session_status",
    "callput_session_revoke",
    "callput_workflow_recover",
  ])
    assert.ok(names.includes(name), name);
});
test("sponsored scope matches all configured option underlyings on each account network", () => {
  for (const network of ["robinhood", "giwa"] as const) {
    const info = withNetwork(network, networkInfo);
    assert.deepEqual(
      (info.account_workflow as any).supported_open_underlyings,
      Object.keys(DEPLOYMENTS[network].underlyings),
    );
  }
  assert.equal(withNetwork("base", networkInfo).account_workflow, null);
});
test("wallet handoff API rejects foreign origins before touching storage", async () => {
  const { handleWalletRequest } = await import("./accountTools.js");
  const response = await handleWalletRequest(
    new Request("https://mcp.callput.app/api/wallet", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "read", workflow_id: "a".repeat(64) }),
    }),
  );
  assert.equal(response.status, 403);
});
test("wallet handoff accepts app-origin CORS preflight", async () => {
  const { handleWalletRequest } = await import("./accountTools.js");
  const response = await handleWalletRequest(
    new Request("https://mcp.callput.app/api/wallet", {
      method: "OPTIONS",
      headers: { origin: "https://app.callput.app" },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.callput.app");
});

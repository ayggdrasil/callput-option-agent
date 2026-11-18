import assert from "node:assert/strict";
import { test } from "node:test";
import { handleMcpHttpRequest } from "./http.js";
import { withNetwork } from "./config.js";
import { requireDirectWalletRoute } from "./walletContext.js";

async function call(network: string, name: string, args: Record<string, unknown> = {}) {
  const response = await handleMcpHttpRequest(new Request(`https://mcp.callput.app/api/mcp?network=${network}`, {
    method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  }));
  assert.equal(response.status, 200);
  return (await response.json() as any).result;
}

const address = "0x1111111111111111111111111111111111111111";

test("Base defaults and explicit direct-wallet routes remain available", () => {
  assert.doesNotThrow(() => withNetwork("base", () => requireDirectWalletRoute()));
  for (const network of ["base", "robinhood", "giwa"]) {
    assert.doesNotThrow(() => withNetwork(network, () => requireDirectWalletRoute("direct_wallet")));
  }
});
const writes: Record<string, Record<string, unknown>> = {
  callput_execute_spread: { strategy: "BuyCallSpread", from_address: address, long_leg_id: "1", short_leg_id: "2", size: 0.01 },
  callput_close_position: { underlying_asset: "ETH", from_address: address, option_token_id: "1", size: 0.01, min_amount_out_raw: "1", min_out_when_swap_raw: "1" },
  callput_settle_position: { underlying_asset: "ETH", from_address: address, option_token_id: "1", min_out_when_swap_raw: "1" },
  callput_close_all_positions: { from_address: address, min_amount_out_raw: "1", min_out_when_swap_raw: "1" },
  callput_settle_all_positions: { from_address: address, min_out_when_swap_raw: "1" }
};

test("network discovery distinguishes login owner from account custody", async () => {
  for (const network of ["base", "robinhood", "giwa"]) {
    const result = await call(network, "callput_get_network_info");
    const wallet = result.structuredContent.wallet_connection;
    assert.ok(wallet, "network discovery must describe wallet and account compatibility");
    assert.equal(wallet.app_trading_mode, network === "base" ? "direct_wallet" : "callput_account");
    assert.equal(wallet.mcp_authentication, "none");
    assert.equal(wallet.account_session_execution_supported, false);
    assert.equal(wallet.direct_wallet_route_required, network !== "base");
    assert.deepEqual(wallet.login_methods, ["external_wallet", "email_otp"]);
    assert.equal(wallet.email_wallet_provider, "privy");
    if (network !== "base") {
      assert.equal(wallet.account_url, `https://app.callput.app/account?chain=${network === "giwa" ? "giwa" : "robinhoodchain"}`);
      assert.match(wallet.address_rules, /owner.*account|account.*owner/i);
    }
  }
});

test("all write tools reject account sessions before external I/O", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected external I/O"); };
  try {
    for (const network of ["base", "robinhood", "giwa"]) {
      for (const [tool, args] of Object.entries(writes)) {
        const result = await call(network, tool, { ...args, execution_route: "callput_account" });
        assert.equal(result.isError, true, `${network} ${tool}`);
        assert.match(result.content[0].text, /CallPut Account.*not supported/i);
      }
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("account networks never silently fall back to wallet-funded writes", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected external I/O"); };
  try {
    for (const network of ["robinhood", "giwa"]) {
      for (const [tool, args] of Object.entries(writes)) {
        const result = await call(network, tool, args);
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /execution_route.*direct_wallet/);
      }
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

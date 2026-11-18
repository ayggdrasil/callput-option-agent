import assert from "node:assert/strict";
import { test } from "node:test";
import * as configModule from "./config.js";
import { handleMcpHttpRequest } from "./http.js";
import { getMarketSnapshot } from "./core.js";

const config = configModule as any;
const headers = { accept: "application/json, text/event-stream", "content-type": "application/json" };
async function rpc(network: string, method: string, params: any) {
  const response = await handleMcpHttpRequest(new Request(`https://mcp.callput.app/api/mcp?network=${network}`, {
    method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }));
  return { status: response.status, body: await response.json() as any };
}

test("unknown network is rejected before MCP processing", async () => {
  const result = await rpc("ethereum", "tools/list", {});
  assert.equal(result.status, 400);
});

test("each bound MCP advertises its actual network and discovery tool", async () => {
  for (const network of ["base", "robinhood", "giwa"]) {
    const result = await rpc(network, "tools/call", { name: "callput_get_network_info", arguments: {} });
    assert.equal(result.status, 200);
    assert.equal(result.body.result?.isError, undefined);
    const data = result.body.result?.structuredContent;
    assert.equal(data?.network, network);
    assert.ok(Number.isSafeInteger(data.chain_id));
    assert.equal(data.execution, "unsigned_only");
    assert.ok(data.contracts.position_manager);
  }
});

test("network configuration remains isolated across concurrent async work", async () => {
  assert.equal(typeof config.withNetwork, "function");
  const observations = await Promise.all(["base", "robinhood", "giwa"].map((network, i) =>
    config.withNetwork(network, async () => {
      const before = config.CONFIG.CHAIN_ID;
      await new Promise(resolve => setTimeout(resolve, 15 - i * 5));
      assert.equal(config.CONFIG.NETWORK, network);
      assert.equal(config.CONFIG.CHAIN_ID, before);
      return before;
    })
  ));
  assert.equal(new Set(observations).size, 3);
  assert.equal(config.CONFIG.CHAIN_ID, 8453);
  assert.throws(() => config.withNetwork("wrong", () => null), /network/i);
});

test("concurrent market reads and cached reads never share another chain's feed", async () => {
  assert.equal(typeof config.withNetwork, "function");
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const price = url.includes("giwa") ? 300 : url.includes("robin") ? 200 : 100;
    await new Promise(resolve => setTimeout(resolve, price === 100 ? 20 : 5));
    return Response.json({ lastUpdatedAt: new Date().toISOString(), data: { market: {}, spotIndices: { ETH: price } } });
  };
  try {
    const read = (network: string, force: boolean) => config.withNetwork(network, () => getMarketSnapshot(force));
    const [base, robin, giwa] = await Promise.all([read("base", true), read("robinhood", true), read("giwa", true)]);
    assert.deepEqual([base.spot.ETH, robin.spot.ETH, giwa.spot.ETH], [100, 200, 300]);
    assert.equal(new Set(requested).size, 3);
    const cached = await read("base", false);
    assert.equal(cached.spot.ETH, 100);
    assert.equal(requested.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("network profiles have valid, distinct deployments and ignore Base RPC overrides", () => {
  const seen = new Set<string>();
  for (const network of ["base", "robinhood", "giwa"]) {
    const profile = config.getNetworkConfig(network, { RPC_URL: "https://base-only.invalid", BASE_RPC_URL: "https://base-only.invalid" });
    assert.equal(profile.NETWORK, network);
    for (const address of Object.values(profile.CONTRACTS)) assert.ok(ethers.isAddress(address as string));
    for (const asset of Object.values(profile.UNDERLYINGS) as any[]) assert.ok(ethers.isAddress(asset.optionsToken));
    assert.ok(!seen.has(profile.CONTRACTS.POSITION_MANAGER));
    seen.add(profile.CONTRACTS.POSITION_MANAGER);
    if (network !== "base") assert.notEqual(profile.RPC_URL, "https://base-only.invalid");
  }
  assert.equal(config.getNetworkConfig("giwa").TESTNET, true);
  assert.equal(config.getNetworkConfig("robinhood").CHAIN_ID, 4663);
});

test("REST assets are scoped but non-Base REST trade calls fail closed", async () => {
  const deps = { getMarketSnapshot: async () => ({ spot: { ETH: config.CONFIG.CHAIN_ID }, options: [] }) } as any;
  for (const [network, chainId, count] of [["base", 8453, 20], ["robinhood", 4663, 20], ["giwa", 91342, 13]] as const) {
    const response = await handleBankrApiRequest("assets", new Request(`https://mcp.callput.app/api/bankr/assets?network=${network}`), deps);
    const body = await response.json() as any;
    assert.equal(body.chain_id, chainId);
    assert.equal(body.assets.length, count);
    assert.equal(body.assets.find((asset: any) => asset.symbol === "ETH").spot_price, chainId);
  }
  const response = await handleBankrApiRequest("prepare", new Request("https://mcp.callput.app/api/bankr/prepare?network=giwa", { method: "POST" }));
  assert.equal(response.status, 400);
});

test("unsigned opens and approvals use the selected contracts; cross-chain payloads are rejected", async () => {
  const originalFetch = globalThis.fetch;
  const originalSend = ethers.JsonRpcProvider.prototype.send;
  const expiry = Math.floor(Date.now() / 1000) + 86400;
  const leg = (strike: number) => ((3n << 240n) | (BigInt(expiry) << 200n) | (BigInt(strike) << 152n)).toString();
  globalThis.fetch = async () => Response.json({ lastUpdatedAt: new Date().toISOString(), data: {
    spotIndices: { TSLA: 105 }, market: { TSLA: { expiries: [String(expiry)], options: { [expiry]: {
      call: [100, 110].map(strike => ({ instrument: `TSLA-TEST-${strike}-C`, optionId: leg(strike), strikePrice: strike,
        markPrice: strike === 100 ? 8 : 3, riskPremiumRateForBuy: 0.01, riskPremiumRateForSell: 0.01,
        isOptionAvailable: true, expiry })), put: []
    } } } }
  } });
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const executionSelector = new ethers.Interface(config.POSITION_MANAGER_ABI).getFunction("executionFee")!.selector;
  ethers.JsonRpcProvider.prototype.send = async function(method: string, params: any) {
    if (method === "eth_chainId") return ethers.toBeHex(config.CONFIG.CHAIN_ID);
    if (method === "eth_call") {
      const data = params[0].data;
      if (data.startsWith(executionSelector)) return coder.encode(["uint256"], [60_000_000_000_000n]);
      const allowanceSelector = new ethers.Interface(config.ERC20_ABI).getFunction("allowance")!.selector;
      if (data.startsWith(allowanceSelector)) return coder.encode(["uint256"], [0n]);
    }
    throw new Error(`Unexpected mock RPC method: ${method}`);
  };
  const input = { strategy: "BuyCallSpread" as const, from_address: "0x1111111111111111111111111111111111111111",
    long_leg_id: leg(100), short_leg_id: leg(110), size: 0.01, min_fill_ratio: 0.78 };
  try {
    for (const network of ["base", "robinhood", "giwa"]) {
      await config.withNetwork(network, async () => {
        await getMarketSnapshot(true);
        const result = await executeSpread({ strategy: input.strategy, fromAddress: input.from_address,
          longLegId: input.long_leg_id, shortLegId: input.short_leg_id, size: input.size, minFillRatio: input.min_fill_ratio });
        validatePreparedTransaction(result, input, 100_000_000n);
        assert.equal(result.unsigned_tx.chain_id, config.CONFIG.CHAIN_ID);
        assert.equal(result.unsigned_tx.to, config.CONFIG.CONTRACTS.POSITION_MANAGER);
        const approval = result.usdc_approval.approve_tx!;
        assert.equal(approval.to, config.CONFIG.CONTRACTS.USDC);
        assert.equal(approval.chain_id, config.CONFIG.CHAIN_ID);
        const parsed = new ethers.Interface(config.ERC20_ABI).parseTransaction({ data: approval.data })!;
        assert.equal(String(parsed.args[0]).toLowerCase(), config.CONFIG.CONTRACTS.ROUTER.toLowerCase());
        assert.equal(String(parsed.args[1]), result.usdc_approval.required);
        const other = network === "base" ? "giwa" : "base";
        config.withNetwork(other, () => assert.throws(() => validatePreparedTransaction(result, input), /chain ID/));
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    ethers.JsonRpcProvider.prototype.send = originalSend;
  }
});

import { ethers } from "ethers";
import { handleBankrApiRequest, validatePreparedTransaction } from "./bankrApi.js";
import { executeSpread } from "./core.js";

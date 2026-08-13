import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { ethers } from "ethers";
import { CONFIG, POSITION_MANAGER_ABI, SETTLE_MANAGER_ABI } from "./config.js";
import { calculateSpreadOpenQuote, closePosition, getMarketSnapshot, parseOptionTokenId, planPositionLifecycle, settlePosition, validateSpread } from "./core.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const CONTROLLER = "0x3333333333333333333333333333333333333333";
const NOW_SEC = Math.floor(Date.now() / 1000);

function optionId(assetIndex: number, expirySec: number, strike: number): string {
  return ethers.toBeHex(
    (BigInt(assetIndex) << 240n) |
    (BigInt(expirySec) << 200n) |
    (BigInt(strike) << 152n),
    32
  );
}

function spreadTokenId(assetIndex: number, expirySec: number): string {
  const nakedStrike = 100 * 8 + 4;
  const pairStrike = 110 * 8 + 4;
  return (
    (BigInt(assetIndex) << 240n) |
    (BigInt(expirySec) << 200n) |
    (0x56n << 192n) |
    (BigInt(nakedStrike) << 144n) |
    (BigInt(pairStrike) << 96n)
  ).toString();
}

function marketPayload(overrides: Record<string, unknown> = {}) {
  const expirySec = NOW_SEC + 86_400;
  const timestamp = Date.now();
  return {
    lastUpdatedAt: new Date(timestamp).toISOString(),
    timestamp,
    data: {
      market: {
        TSLA: {
          expiries: [expirySec],
          options: {
            [String(expirySec)]: {
              call: [{
                instrument: "TSLA-TEST-100-C",
                optionId: optionId(3, expirySec, 100),
                strikePrice: 100,
                markPrice: 10,
                riskPremiumRateForBuy: 0.01,
                riskPremiumRateForSell: 0.01,
                isOptionAvailable: true,
                expiry: expirySec,
                markIv: 0.5
              }],
              put: []
            }
          }
        }
      },
      spotIndices: { TSLA: 100 }
    },
    ...overrides
  };
}

let ownedBalanceRaw = 100_000_000n;

async function startRpcServer(): Promise<{ server: http.Server; url: string }> {
  const executionFeeSelector = new ethers.Interface(POSITION_MANAGER_ABI).getFunction("executionFee")!.selector;
  const balanceSelector = new ethers.Interface([
    "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])"
  ]).getFunction("balanceOfBatch")!.selector;
  const controllerSelector = new ethers.Interface([
    "function controller() view returns (address)"
  ]).getFunction("controller")!.selector;
  const operatorApprovalSelector = new ethers.Interface([
    "function isApprovedForAll(address account, address operator) view returns (bool)"
  ]).getFunction("isApprovedForAll")!.selector;
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const incoming = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const requests = Array.isArray(incoming) ? incoming : [incoming];
    const replies = requests.map((rpc: any) => {
      let result: string;
      if (rpc.method === "eth_chainId") {
        result = ethers.toQuantity(CONFIG.CHAIN_ID);
      } else if (rpc.method === "eth_call") {
        const data = String(rpc.params?.[0]?.data ?? "");
        if (data.startsWith(executionFeeSelector)) {
          result = coder.encode(["uint256"], [CONFIG.EXECUTION_FEE_FALLBACK]);
        } else if (data.startsWith(balanceSelector)) {
          result = coder.encode(["uint256[]"], [[ownedBalanceRaw]]);
        } else if (data.startsWith(controllerSelector)) {
          result = coder.encode(["address"], [CONTROLLER]);
        } else if (data.startsWith(operatorApprovalSelector)) {
          result = coder.encode(["bool"], [false]);
        } else {
          throw new Error(`Unexpected eth_call selector: ${data.slice(0, 10)}`);
        }
      } else {
        throw new Error(`Unexpected RPC method: ${rpc.method}`);
      }
      return { jsonrpc: "2.0", id: rpc.id, result };
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(incoming) ? replies : replies[0]));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("RPC test server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("trade core safety gates", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalRpcUrl = CONFIG.RPC_URL;
  const rpc = await startRpcServer();
  (CONFIG as any).RPC_URL = rpc.url;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    (CONFIG as any).RPC_URL = originalRpcUrl;
    await new Promise<void>((resolve, reject) => rpc.server.close((error) => error ? reject(error) : resolve()));
  });

  await t.test("rejects stale market data", async () => {
    const staleAt = Date.now() - 5 * 60_000 - 1;
    globalThis.fetch = async () => new Response(JSON.stringify(marketPayload({
      lastUpdatedAt: new Date(staleAt).toISOString(),
      timestamp: staleAt
    })));
    await assert.rejects(() => getMarketSnapshot(true), /STALE_MARKET_DATA/);
  });

  await t.test("rejects malformed option rows", async () => {
    const payload: any = marketPayload();
    delete payload.data.market.TSLA.options[String(NOW_SEC + 86_400)].call[0].markPrice;
    globalThis.fetch = async () => new Response(JSON.stringify(payload));
    await assert.rejects(() => getMarketSnapshot(true), /MARKET_DATA_SCHEMA/);
  });

  await t.test("accepts non-negative risk premiums and floors a derived negative bid at zero", async () => {
    const payload: any = marketPayload();
    const row = payload.data.market.TSLA.options[String(NOW_SEC + 86_400)].call[0];
    row.riskPremiumRateForBuy = 1.25;
    globalThis.fetch = async () => new Response(JSON.stringify(payload));

    const snapshot = await getMarketSnapshot(true);
    assert.equal(snapshot.options[0].ask, 22.5);

    row.riskPremiumRateForBuy = -0.01;
    await assert.rejects(() => getMarketSnapshot(true), /risk premium rate for buy must be >= 0/);

    row.riskPremiumRateForBuy = 0.01;
    row.riskPremiumRateForSell = 1.8;
    const wideSnapshot = await getMarketSnapshot(true);
    assert.equal(wideSnapshot.options[0].bid, 0);

    row.riskPremiumRateForSell = -0.01;
    await assert.rejects(() => getMarketSnapshot(true), /risk premium rate for sell must be >= 0/);
  });

  await t.test("ignores malformed pricing on explicitly unavailable option rows", async () => {
    const payload: any = marketPayload();
    const row = payload.data.market.TSLA.options[String(NOW_SEC + 86_400)].call[0];
    row.isOptionAvailable = false;
    row.riskPremiumRateForSell = 1.8;
    globalThis.fetch = async () => new Response(JSON.stringify(payload));

    const snapshot = await getMarketSnapshot(true);
    assert.equal(snapshot.options.length, 0);
  });

  await t.test("rejects a non-finite derived ask from finite market inputs", async () => {
    const payload: any = marketPayload();
    const row = payload.data.market.TSLA.options[String(NOW_SEC + 86_400)].call[0];
    row.riskPremiumRateForBuy = Number.MAX_VALUE;
    globalThis.fetch = async () => new Response(JSON.stringify(payload));

    await assert.rejects(() => getMarketSnapshot(true), /derived ask must be finite and >= 0/);
  });

  await t.test("rejects feed rows whose option token encoding disagrees with the row", async () => {
    const payload: any = marketPayload();
    payload.data.market.TSLA.options[String(NOW_SEC + 86_400)].call[0].optionId = optionId(1, NOW_SEC + 86_400, 100);
    globalThis.fetch = async () => new Response(JSON.stringify(payload));
    await assert.rejects(() => getMarketSnapshot(true), /MARKET_DATA_TOKEN_MISMATCH/);
  });

  await t.test("does not infer call or put from a base option ID", () => {
    const expirySec = NOW_SEC + 86_400;
    assert.deepEqual(parseOptionTokenId(optionId(3, expirySec, 100)), {
      underlyingAssetIndex: 3,
      expirySec,
      strikePrice: 100
    });
  });

  await t.test("resolves shared option IDs using the strategy option side", async () => {
    const payload: any = marketPayload();
    const expirySec = NOW_SEC + 86_400;
    const bucket = payload.data.market.TSLA.options[String(expirySec)];
    const lowerId = optionId(3, expirySec, 100);
    const higherId = optionId(3, expirySec, 110);
    bucket.call = [
      { ...bucket.call[0], optionId: lowerId, strikePrice: 100, markPrice: 10, instrument: "TSLA-TEST-100-C" },
      { ...bucket.call[0], optionId: higherId, strikePrice: 110, markPrice: 5, instrument: "TSLA-TEST-110-C" }
    ];
    bucket.put = [
      { ...bucket.call[0], optionId: lowerId, strikePrice: 100, markPrice: 4, instrument: "TSLA-TEST-100-P" },
      { ...bucket.call[0], optionId: higherId, strikePrice: 110, markPrice: 9, instrument: "TSLA-TEST-110-P" }
    ];
    globalThis.fetch = async () => new Response(JSON.stringify(payload));
    await getMarketSnapshot(true);

    const call = await validateSpread("BuyCallSpread", lowerId, higherId);
    assert.equal(call.details.long_leg.mark_price, 10);
    assert.equal(call.details.short_leg.mark_price, 5);

    const put = await validateSpread("BuyPutSpread", higherId, lowerId);
    assert.equal(put.details.option_type, "Put");
    assert.equal(put.details.long_leg.mark_price, 9);
    assert.equal(put.details.short_leg.mark_price, 4);
  });

  await t.test("resolves equivalent decimal and hex option IDs", async () => {
    const payload: any = marketPayload();
    const expirySec = NOW_SEC + 86_400;
    const bucket = payload.data.market.TSLA.options[String(expirySec)];
    const lowerId = optionId(3, expirySec, 100);
    const higherId = optionId(3, expirySec, 110);
    bucket.call.push({
      ...bucket.call[0],
      optionId: higherId,
      strikePrice: 110,
      markPrice: 5,
      instrument: "TSLA-TEST-110-C"
    });
    globalThis.fetch = async () => new Response(JSON.stringify(payload));
    await getMarketSnapshot(true);

    const result = await validateSpread(
      "BuyCallSpread",
      BigInt(lowerId).toString(),
      BigInt(higherId).toString()
    );
    assert.equal(result.details.long_leg.option_id, lowerId);
    assert.equal(result.details.short_leg.option_id, higherId);
  });

  await t.test("quotes buy spread amount-in with execution risk premium and the protocol fee cap", () => {
    const quote = calculateSpreadOpenQuote({
      strategy: "BuyCallSpread",
      size: 0.01,
      spotPrice: 774,
      spreadMarkPrice: 0.5356,
      strikeDiff: 15,
      longRiskPremiumRateForBuy: 0.2,
      longRiskPremiumRateForSell: 0.19,
      shortRiskPremiumRateForBuy: 0.21,
      shortRiskPremiumRateForSell: 0.19
    });

    assert.equal(quote.risk_premium_rate, 0.2, "a spread uses the relevant side's rate, not the sum of both legs");
    assert.equal(quote.estimated_execution_price, 0.64272);
    assert.equal(quote.estimated_open_fee_usdc, 0.0008034, "the 12.5% premium cap is below the notional fee here");
    assert.equal(quote.amount_in_usdc, 0.0072306);
  });

  await t.test("rejects duplicate option IDs within the same side", async () => {
    const payload: any = marketPayload();
    const bucket = payload.data.market.TSLA.options[String(NOW_SEC + 86_400)];
    bucket.call.push({
      ...bucket.call[0],
      instrument: "TSLA-ALT-100-C",
      markPrice: 11
    });
    globalThis.fetch = async () => new Response(JSON.stringify(payload));

    await assert.rejects(
      () => getMarketSnapshot(true),
      /MARKET_DATA_OPTION_ID_COLLISION:.*call/i
    );
  });

  await t.test("rejects an instrument side that conflicts with its feed bucket", async () => {
    const payload: any = marketPayload();
    payload.data.market.TSLA.options[String(NOW_SEC + 86_400)].call[0].instrument = "TSLA-TEST-100-P";
    globalThis.fetch = async () => new Response(JSON.stringify(payload));

    await assert.rejects(
      () => getMarketSnapshot(true),
      /MARKET_DATA_OPTION_SIDE_MISMATCH:.*call/i
    );
  });

  await t.test("close rejects an asset mismatch", async () => {
    await assert.rejects(() => closePosition({
      underlyingAsset: "ETH",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      size: 1,
      minAmountOutRaw: "1",
      minOutWhenSwapRaw: "1"
    } as any), /does not match token asset/);
  });

  await t.test("close rejects expired positions", async () => {
    await assert.rejects(() => closePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC - 1),
      size: 1,
      minAmountOutRaw: "1",
      minOutWhenSwapRaw: "1"
    } as any), /already expired/);
  });

  await t.test("close rejects a wallet that does not own enough position tokens", async () => {
    ownedBalanceRaw = 50_000_000n;
    await assert.rejects(() => closePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      size: 1,
      minAmountOutRaw: "1",
      minOutWhenSwapRaw: "1"
    } as any), /insufficient position balance/);
  });

  await t.test("close requires and encodes positive user-approved floors", async () => {
    ownedBalanceRaw = 100_000_000n;
    await assert.rejects(() => closePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      size: 1
    } as any), /minAmountOutRaw/);

    const result = await closePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      size: 1,
      minAmountOutRaw: "123",
      minOutWhenSwapRaw: "45"
    } as any);
    const parsed = new ethers.Interface(POSITION_MANAGER_ABI).parseTransaction({ data: result.unsigned_tx.data });
    assert.equal(parsed?.args[4], 123n);
    assert.equal(parsed?.args[5], 45n);
  });

  await t.test("close prepares the exact ERC-1155 controller approval when the wallet is not approved", async () => {
    ownedBalanceRaw = 100_000_000n;
    const result = await closePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      size: 1,
      minAmountOutRaw: "1",
      minOutWhenSwapRaw: "1"
    } as any);
    assert.equal(result.position_token_approval.sufficient, false);
    assert.ok(result.position_token_approval.approve_tx);
    assert.equal(result.position_token_approval.token, CONFIG.UNDERLYINGS.BTC.optionsToken);
    assert.equal(result.position_token_approval.operator, ethers.getAddress(CONTROLLER));
    assert.equal(result.position_token_approval.approve_tx!.to, CONFIG.UNDERLYINGS.BTC.optionsToken);
    assert.equal(result.position_token_approval.approve_tx!.value, "0");
    const parsed = new ethers.Interface([
      "function setApprovalForAll(address operator, bool approved)"
    ]).parseTransaction({ data: result.position_token_approval.approve_tx!.data });
    assert.equal(parsed?.args[0], ethers.getAddress(CONTROLLER));
    assert.equal(parsed?.args[1], true);
  });

  await t.test("settle requires a wallet", async () => {
    await assert.rejects(() => settlePosition({
      underlyingAsset: "BTC",
      optionTokenId: spreadTokenId(1, NOW_SEC - 1),
      minOutWhenSwapRaw: "1"
    } as any), /fromAddress is required/);
  });

  await t.test("settle rejects an asset mismatch", async () => {
    await assert.rejects(() => settlePosition({
      underlyingAsset: "ETH",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC - 1),
      minOutWhenSwapRaw: "1"
    } as any), /does not match token asset/);
  });

  await t.test("settle rejects positions that have not expired", async () => {
    await assert.rejects(() => settlePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC + 3_600),
      minOutWhenSwapRaw: "1"
    } as any), /has not expired/);
  });

  await t.test("settle rejects a wallet that does not own the position", async () => {
    ownedBalanceRaw = 0n;
    await assert.rejects(() => settlePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC - 1),
      minOutWhenSwapRaw: "1"
    } as any), /does not own position/);
  });

  await t.test("settle requires and encodes a positive user-approved swap floor", async () => {
    ownedBalanceRaw = 1n;
    await assert.rejects(() => settlePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC - 1),
      minOutWhenSwapRaw: "0"
    } as any), /minOutWhenSwapRaw/);

    const result = await settlePosition({
      underlyingAsset: "BTC",
      fromAddress: ACCOUNT,
      optionTokenId: spreadTokenId(1, NOW_SEC - 1),
      minOutWhenSwapRaw: "77"
    } as any);
    const parsed = new ethers.Interface(SETTLE_MANAGER_ABI).parseTransaction({ data: result.unsigned_tx.data });
    assert.equal(parsed?.args[3], 77n);
    assert.equal(result.unsigned_tx.from, ethers.getAddress(ACCOUNT));
    assert.equal(result.position_token_approval.sufficient, false);
  });

  await t.test("plans close-all and settle-all from exact on-chain expiry state", () => {
    const positions = [
      { underlying: "BTC", token_id: "1", size: 0.001, expiry_sec: NOW_SEC + 60 },
      { underlying: "ETH", token_id: "2", size: -0.01, expiry_sec: NOW_SEC - 1 },
      { underlying: "TSLA", token_id: "3", size: 1, expiry_sec: NOW_SEC }
    ];
    const plan = planPositionLifecycle(positions, NOW_SEC);
    assert.deepEqual(plan.closable.map((position) => position.token_id), ["1"]);
    assert.deepEqual(plan.settleable.map((position) => position.token_id), ["2", "3"]);
    assert.equal(plan.closable[0].size, 0.001);
    assert.equal(plan.settleable[0].size, 0.01, "batch lifecycle sizes must be positive full balances");
  });
});

import assert from "node:assert/strict";
import { ethers } from "ethers";
import { CONFIG, ERC20_ABI, POSITION_MANAGER_ABI } from "./config.js";
import { handleBankrApiRequest, validatePreparedTransaction, type BankrDependencies } from "./bankrApi.js";
import { executeSpreadInputSchema } from "./index.js";

const wallet = "0x1111111111111111111111111111111111111111";
const requestKey = `0x${"ab".repeat(32)}`;
const txHash = `0x${"cd".repeat(32)}`;

function prepared(to: string = CONFIG.CONTRACTS.POSITION_MANAGER) {
  const pm = new ethers.Interface(POSITION_MANAGER_ABI);
  const erc20 = new ethers.Interface(ERC20_ABI);
  return {
    validation: { status: "Valid", details: { asset: "TSLA", spread_cost: 2, strike_diff: 5 } },
    unsigned_tx: {
      to,
      data: pm.encodeFunctionData("createOpenPosition", [
        3, 2, [true, false, false, false], [ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash],
        [true, true, false, false], 78_000n, [CONFIG.CONTRACTS.USDC], 2_000_000n, 0, ethers.ZeroAddress
      ]),
      value: "60000000000000",
      chain_id: 8453,
      from: wallet
    },
    usdc_approval: {
      sufficient: false,
      current_allowance: "0",
      required: "2000000",
      approve_tx: {
        to: CONFIG.CONTRACTS.USDC,
        data: erc20.encodeFunctionData("approve", [CONFIG.CONTRACTS.ROUTER, 4_000_000n]),
        value: "0",
        chain_id: 8453
      }
    },
    quote: {
      strategy: "BuyCallSpread" as const,
      size: 0.001,
      size_raw: "100000",
      min_size_raw: "78000",
      min_fill_ratio: 0.78,
      amount_in_usdc: 2,
      amount_in_raw: "2000000",
      underlying_decimals: 18
    },
    next_steps: []
  };
}

const captured: string[] = [];
let capturedMinFillRatio: number | undefined;
const deps = {
  getMarketSnapshot: async () => ({
    spot: { BTC: 100, ETH: 10, TSLA: 200, QQQ: 300, SPY: 400, EWY: 50, NVDA: 120, COIN: 90, SPCX: 180, MU: 80, SKHY: 70 },
    options: [{ underlying: "TSLA", isAvailable: true }]
  }),
  scanSpreads: async () => ({ asset: "TSLA", strategy: "BuyCallSpread", candidates: [{ rank: 1 }] }),
  executeSpread: async (input: { minFillRatio?: number }) => {
    capturedMinFillRatio = input.minFillRatio;
    return prepared();
  },
  getRequestKeyFromTx: async () => ({ request_key: requestKey, is_open: true }),
  checkRequestStatus: async () => ({ request_key: requestKey, status: "executed" as const, account: wallet }),
  listPositionsByWallet: async () => ({ open_request_keys: [requestKey] }),
  captureTelemetry: async ({ event }: { event: string }) => { captured.push(event); }
} as unknown as BankrDependencies;

async function post(action: "scan" | "prepare" | "reconcile" | "events", body: unknown) {
  return handleBankrApiRequest(action, new Request(`https://mcp.callput.app/api/bankr/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://bankr.bot" },
    body: JSON.stringify(body)
  }), deps);
}

async function main() {
  const mcpDefaults = executeSpreadInputSchema.parse({
    strategy: "BuyCallSpread",
    from_address: wallet,
    long_leg_id: "1",
    short_leg_id: "2",
    size: 0.001
  });
  assert.equal(mcpDefaults.min_fill_ratio, 0.78, "MCP must preserve the safe fill default when omitted");

  validatePreparedTransaction(prepared() as any);
  assert.throws(() => validatePreparedTransaction(prepared(CONFIG.CONTRACTS.ROUTER) as any), /unexpected destination/);
  const mismatchedMinSize = prepared() as any;
  mismatchedMinSize.quote.min_size_raw = "2";
  assert.throws(() => validatePreparedTransaction(mismatchedMinSize), /minimum size/i);
  const mismatchedAmountIn = prepared() as any;
  mismatchedAmountIn.quote.amount_in_raw = "2000001";
  assert.throws(() => validatePreparedTransaction(mismatchedAmountIn), /amount in/i);

  const assets = await handleBankrApiRequest("assets", new Request("https://mcp.callput.app/api/bankr/assets"), deps);
  assert.equal(assets.status, 200);
  assert.equal((await assets.json() as any).assets.find((asset: any) => asset.symbol === "TSLA").tradable_options, 1);

  const scan = await post("scan", { underlying_asset: "TSLA", bias: "bullish", max_results: 1 });
  assert.equal(scan.status, 200);

  const prepareResponse = await post("prepare", {
    strategy: "BuyCallSpread",
    from_address: wallet,
    long_leg_id: "1",
    short_leg_id: "2",
    size: 0.001
  });
  assert.equal(prepareResponse.status, 200);
  const prepareBody = await prepareResponse.json() as any;
  assert.equal(prepareBody.risk_preview.maximum_usdc_at_risk, 2);
  assert.equal(prepareBody.risk_preview.minimum_fill_ratio, 0.78);
  assert.equal(prepareBody.risk_preview.minimum_size_raw, "78000");
  assert.equal(capturedMinFillRatio, 0.78, "Bankr API must preserve the safe fill default when omitted");
  assert.match(prepareBody.intent_fingerprint, /^[0-9a-f]{64}$/);

  const reconcile = await post("reconcile", { wallet_address: wallet, tx_hash: txHash });
  assert.equal(reconcile.status, 200);
  assert.equal((await reconcile.json() as any).status, "executed");
  assert.deepEqual(captured, ["scan_success", "transaction_prepared", "onchain_detected", "keeper_executed"]);

  (deps.listPositionsByWallet as any) = async () => ({ open_request_keys: [requestKey], close_request_keys: [] });
  const recovered = await post("reconcile", { wallet_address: wallet });
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json() as any).request_key, requestKey);

  const badEvent = await post("events", { event: "arbitrary_event", anonymous_id: "12345678" });
  assert.equal(badEvent.status, 400);

  console.log("Bankr API tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

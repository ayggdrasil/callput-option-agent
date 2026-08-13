import assert from "node:assert/strict";
import { ethers } from "ethers";
import { CONFIG, ERC20_ABI, POSITION_MANAGER_ABI } from "./config.js";
import { handleBankrApiRequest, validatePreparedTransaction, type BankrDependencies } from "./bankrApi.js";
import { executeSpreadInputSchema } from "./index.js";

const wallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";
const requestKey = `0x${"ab".repeat(32)}`;
const txHash = `0x${"cd".repeat(32)}`;
const intentFingerprint = "ef".repeat(32);
const UINT256_MAX = (1n << 256n) - 1n;

type PrepareRequest = {
  strategy: "BuyCallSpread" | "SellCallSpread" | "BuyPutSpread" | "SellPutSpread";
  from_address: string;
  long_leg_id: string;
  short_leg_id: string;
  size: number;
  min_fill_ratio: number;
};

const defaultRequest: PrepareRequest = {
  strategy: "BuyCallSpread",
  from_address: wallet,
  long_leg_id: "1",
  short_leg_id: "2",
  size: 0.001,
  min_fill_ratio: 0.78
};

function decimalString(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: decimals });
}

function prepared(
  request: PrepareRequest = defaultRequest,
  amountInRaw = 2_000_000n,
  to: string = CONFIG.CONTRACTS.POSITION_MANAGER
) {
  const pm = new ethers.Interface(POSITION_MANAGER_ABI);
  const erc20 = new ethers.Interface(ERC20_ABI);
  const isBuy = request.strategy.startsWith("Buy");
  const isCall = request.strategy.includes("Call");
  const sizeRaw = ethers.parseUnits(decimalString(request.size, 18), 18);
  const minSize = (sizeRaw * BigInt(Math.floor(request.min_fill_ratio * 10_000))) / 10_000n;
  const amountInUsdc = Number(ethers.formatUnits(amountInRaw, CONFIG.ASSETS.USDC.decimals));
  return {
    validation: {
      status: "Valid",
      details: {
        asset: "TSLA",
        option_type: isCall ? "Call" : "Put",
        long_leg: { option_id: request.long_leg_id },
        short_leg: { option_id: request.short_leg_id },
        spread_cost: isBuy ? amountInUsdc / request.size : 1,
        strike_diff: isBuy ? 5 : amountInUsdc / request.size
      }
    },
    unsigned_tx: {
      to,
      data: pm.encodeFunctionData("createOpenPosition", [
        3,
        2,
        [isBuy, !isBuy, false, false],
        [
          ethers.zeroPadValue(ethers.toBeHex(BigInt(request.long_leg_id)), 32),
          ethers.zeroPadValue(ethers.toBeHex(BigInt(request.short_leg_id)), 32),
          ethers.ZeroHash,
          ethers.ZeroHash
        ],
        [isCall, isCall, false, false],
        minSize,
        [CONFIG.CONTRACTS.USDC],
        amountInRaw,
        0,
        ethers.ZeroAddress
      ]),
      value: "60000000000000",
      chain_id: 8453,
      from: request.from_address
    },
    usdc_approval: {
      sufficient: false,
      current_allowance: "0",
      required: amountInRaw.toString(),
      approve_tx: {
        to: CONFIG.CONTRACTS.USDC,
        data: erc20.encodeFunctionData("approve", [CONFIG.CONTRACTS.ROUTER, amountInRaw]),
        value: "0",
        chain_id: 8453
      }
    },
    quote: {
      strategy: request.strategy,
      size: request.size,
      size_raw: sizeRaw.toString(),
      min_size_raw: minSize.toString(),
      min_fill_ratio: request.min_fill_ratio,
      amount_in_usdc: amountInUsdc,
      amount_in_raw: amountInRaw.toString(),
      underlying_decimals: 18
    },
    next_steps: []
  };
}

function alterCalldata(value: ReturnType<typeof prepared>, index: number, replacement: unknown) {
  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  const parsed = iface.parseTransaction({ data: value.unsigned_tx.data })!;
  const args = Array.from(parsed.args);
  args[index] = replacement;
  value.unsigned_tx.data = iface.encodeFunctionData("createOpenPosition", args);
  return value;
}

function validate(value: ReturnType<typeof prepared>, request: PrepareRequest = defaultRequest) {
  validatePreparedTransaction(value as any, request);
}

const captured: string[] = [];
let capturedMinFillRatio: number | undefined;
let capturedIntentLookup: { address: string; intentFingerprint: string; fromBlock?: number } | undefined;
let portfolioSummaryCalls = 0;
let lightweightPositionCalls = 0;
let preparedFactory = (input: any) => prepared({
  strategy: input.strategy,
  from_address: input.fromAddress,
  long_leg_id: input.longLegId,
  short_leg_id: input.shortLegId,
  size: input.size,
  min_fill_ratio: input.minFillRatio
});
const deps = {
  getMarketSnapshot: async () => ({
    spot: { BTC: 100, ETH: 10, TSLA: 200, QQQ: 300, SPY: 400, EWY: 50, NVDA: 120, COIN: 90, SPCX: 180, MU: 80, SKHY: 70 },
    options: [{ underlying: "TSLA", isAvailable: true }]
  }),
  scanSpreads: async () => ({ asset: "TSLA", strategy: "BuyCallSpread", candidates: [{ rank: 1 }] }),
  executeSpread: async (input: { minFillRatio?: number }) => {
    capturedMinFillRatio = input.minFillRatio;
    return preparedFactory(input);
  },
  getRequestKeyFromTx: async () => ({ request_key: requestKey, is_open: true }),
  findRequestKeyByIntentFingerprint: async (input: { address: string; intentFingerprint: string; fromBlock?: number }) => {
    capturedIntentLookup = input;
    return { request_key: requestKey, is_open: true, tx_hash: txHash, from_block: 98_200, to_block: 100_000 };
  },
  checkRequestStatus: async () => ({ request_key: requestKey, status: "executed" as const, account: wallet }),
  getPortfolioSummary: async () => {
    portfolioSummaryCalls++;
    return ({
    account: wallet,
    total_positions: 2,
    positions: [
      { underlying: "BTC", token_id: "101", size: 0.001, lifecycle: "closable" },
      { underlying: "ETH", token_id: "202", size: 0.01, lifecycle: "settleable" }
    ]
    });
  },
  getPositions: async () => {
    lightweightPositionCalls++;
    return {
      account: wallet,
      total_active_count: 2,
      market_data_warning: null,
      position_data_warning: null,
      positions: [
        { underlying: "BTC", token_id: "101", size: 0.001, strike: 100, pair_strike: 110, lifecycle: "closable" },
        { underlying: "ETH", token_id: "202", size: 0.01, strike: 10, pair_strike: 12, lifecycle: "settleable" }
      ]
    };
  },
  closePosition: async (input: any) => ({
    unsigned_tx: { to: CONFIG.CONTRACTS.POSITION_MANAGER, data: "0x1234", value: "60000000000000", chain_id: 8453, from: input.fromAddress },
    close: { asset: input.underlyingAsset, option_token_id: input.optionTokenId, size: input.size, min_amount_out_raw: input.minAmountOutRaw, min_out_when_swap_raw: input.minOutWhenSwapRaw }
  }),
  settlePosition: async (input: any) => ({
    unsigned_tx: { to: CONFIG.CONTRACTS.SETTLE_MANAGER, data: "0x5678", value: "0", chain_id: 8453, from: input.fromAddress },
    settle: { asset: input.underlyingAsset, option_token_id: input.optionTokenId, min_out_when_swap_raw: input.minOutWhenSwapRaw }
  }),
  closeAllPositions: async (input: any) => ({
    action: "close_all",
    account: input.fromAddress,
    eligible_count: 1,
    skipped_count: 1,
    transactions: [{
      unsigned_tx: { to: CONFIG.CONTRACTS.POSITION_MANAGER, data: "0x1234", value: "60000000000000", chain_id: 8453, from: input.fromAddress },
      close: { asset: "BTC", option_token_id: "101", size: 0.001, min_amount_out_raw: input.minAmountOutRaw, min_out_when_swap_raw: input.minOutWhenSwapRaw }
    }]
  }),
  settleAllPositions: async (input: any) => ({
    action: "settle_all",
    account: input.fromAddress,
    eligible_count: 1,
    skipped_count: 1,
    transactions: [{
      unsigned_tx: { to: CONFIG.CONTRACTS.SETTLE_MANAGER, data: "0x5678", value: "0", chain_id: 8453, from: input.fromAddress },
      settle: { asset: "ETH", option_token_id: "202", min_out_when_swap_raw: input.minOutWhenSwapRaw }
    }]
  }),
  captureTelemetry: async ({ event }: { event: string }) => { captured.push(event); }
} as unknown as BankrDependencies;

type PostAction = "scan" | "prepare" | "reconcile" | "positions" | "close" | "settle" | "close-all" | "settle-all" | "events";

async function post(action: PostAction, body: unknown) {
  return handleBankrApiRequest(action, new Request(`https://mcp.callput.app/api/bankr/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://bankr.bot" },
    body: JSON.stringify(body)
  }), deps);
}

async function postFrom(action: PostAction, body: unknown, clientAddress: string) {
  return handleBankrApiRequest(action, new Request(`https://mcp.callput.app/api/bankr/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://bankr.bot",
      "x-forwarded-for": clientAddress
    },
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
  assert.throws(() => executeSpreadInputSchema.parse({ ...mcpDefaults, from_address: "not-an-address" }), /address/i);
  assert.throws(() => executeSpreadInputSchema.parse({ ...mcpDefaults, long_leg_id: "not-an-option-id" }), /option|leg|uint/i);
  assert.throws(() => executeSpreadInputSchema.parse({ ...mcpDefaults, long_leg_id: "-1" }), /option|leg|uint/i);
  assert.throws(() => executeSpreadInputSchema.parse({ ...mcpDefaults, long_leg_id: (UINT256_MAX + 1n).toString() }), /option|leg|uint/i);
  assert.throws(() => executeSpreadInputSchema.parse({ ...mcpDefaults, size: Number.MAX_VALUE }), /size|less than|number/i);

  validate(prepared());
  assert.throws(() => validate(prepared(defaultRequest, 2_000_000n, CONFIG.CONTRACTS.ROUTER)), /unexpected destination/);

  const transactionChainMismatch = prepared();
  transactionChainMismatch.unsigned_tx.chain_id = 1;
  assert.throws(() => validate(transactionChainMismatch), /chain ID/i);

  const transactionValueMismatch = prepared();
  transactionValueMismatch.unsigned_tx.value = "0";
  assert.throws(() => validate(transactionValueMismatch), /value.*positive/i);

  const senderMismatch = prepared();
  senderMismatch.unsigned_tx.from = otherWallet;
  assert.throws(() => validate(senderMismatch), /sender/i);

  const quoteStrategyMismatch = prepared();
  quoteStrategyMismatch.quote.strategy = "SellCallSpread";
  assert.throws(() => validate(quoteStrategyMismatch), /strategy/i);

  const quoteSizeMismatch = prepared();
  quoteSizeMismatch.quote.size = 0.002;
  assert.throws(() => validate(quoteSizeMismatch), /size/i);

  const quoteSizeRawMismatch = prepared();
  quoteSizeRawMismatch.quote.size_raw = "999";
  assert.throws(() => validate(quoteSizeRawMismatch), /size/i);

  const quoteFillMismatch = prepared();
  quoteFillMismatch.quote.min_fill_ratio = 0.77;
  assert.throws(() => validate(quoteFillMismatch), /fill/i);

  const quoteDecimalsMismatch = prepared();
  quoteDecimalsMismatch.quote.underlying_decimals = 8;
  assert.throws(() => validate(quoteDecimalsMismatch), /decimal/i);

  const quoteUsdcMismatch = prepared();
  quoteUsdcMismatch.quote.amount_in_usdc = 3;
  assert.throws(() => validate(quoteUsdcMismatch), /amount|risk/i);

  const validationLegMismatch = prepared();
  validationLegMismatch.validation.details.long_leg.option_id = "3";
  assert.throws(() => validate(validationLegMismatch), /long leg/i);

  const validationAssetMismatch = prepared();
  validationAssetMismatch.validation.details.asset = "ETH";
  assert.throws(() => validate(validationAssetMismatch), /underlying|asset/i);

  const validationOptionTypeMismatch = prepared();
  validationOptionTypeMismatch.validation.details.option_type = "Put";
  assert.throws(() => validate(validationOptionTypeMismatch), /option type/i);

  const validationRiskMismatch = prepared();
  validationRiskMismatch.validation.details.spread_cost = 1;
  assert.throws(() => validate(validationRiskMismatch), /amount|risk/i);

  const calldataMutations: Array<[number, unknown, RegExp]> = [
    [0, 2, /underlying/i],
    [1, 3, /length/i],
    [2, [false, true, false, false], /buy|side|strategy/i],
    [3, [ethers.ZeroHash, ethers.zeroPadValue("0x02", 32), ethers.ZeroHash, ethers.ZeroHash], /option|leg/i],
    [4, [false, false, false, false], /call|put|option type/i],
    [6, [CONFIG.CONTRACTS.WETH], /path|USDC/i],
    [8, 1, /minimum output|minOut/i],
    [9, wallet, /lead trader/i]
  ];
  for (const [index, replacement, message] of calldataMutations) {
    assert.throws(() => validate(alterCalldata(prepared(), index, replacement)), message);
  }

  const mismatchedMinSize = prepared();
  mismatchedMinSize.quote.min_size_raw = "2";
  assert.throws(() => validate(mismatchedMinSize), /minimum size/i);

  const mismatchedAmountIn = prepared();
  mismatchedAmountIn.quote.amount_in_raw = "2000001";
  assert.throws(() => validate(mismatchedAmountIn), /amount in/i);

  const approvalRequiredMismatch = prepared();
  approvalRequiredMismatch.usdc_approval.required = "1";
  assert.throws(() => validate(approvalRequiredMismatch), /approval.*required|required.*approval/i);

  const approvalAmountMismatch = prepared();
  approvalAmountMismatch.usdc_approval.approve_tx.data = new ethers.Interface(ERC20_ABI)
    .encodeFunctionData("approve", [CONFIG.CONTRACTS.ROUTER, 2_000_001n]);
  assert.throws(() => validate(approvalAmountMismatch), /approval amount/i);

  const approvalValueMismatch = prepared();
  approvalValueMismatch.usdc_approval.approve_tx.value = "1";
  assert.throws(() => validate(approvalValueMismatch), /approval.*value/i);

  const approvalChainMismatch = prepared();
  approvalChainMismatch.usdc_approval.approve_tx.chain_id = 1;
  assert.throws(() => validate(approvalChainMismatch), /approval.*chain/i);

  const approvalDestinationMismatch = prepared();
  (approvalDestinationMismatch.usdc_approval.approve_tx as any).to = CONFIG.CONTRACTS.ROUTER;
  assert.throws(() => validate(approvalDestinationMismatch), /approval.*destination/i);

  const approvalSpenderMismatch = prepared();
  approvalSpenderMismatch.usdc_approval.approve_tx.data = new ethers.Interface(ERC20_ABI)
    .encodeFunctionData("approve", [wallet, 4_000_000n]);
  assert.throws(() => validate(approvalSpenderMismatch), /approval spender/i);

  const missingApproval = prepared();
  delete (missingApproval.usdc_approval as any).approve_tx;
  assert.throws(() => validate(missingApproval), /approval.*required|required.*approval/i);

  const inconsistentAllowance = prepared();
  inconsistentAllowance.usdc_approval.current_allowance = "2000000";
  assert.throws(() => validate(inconsistentAllowance), /allowance|sufficient/i);

  const sufficientWithApproval = prepared();
  sufficientWithApproval.usdc_approval.sufficient = true;
  sufficientWithApproval.usdc_approval.current_allowance = "2000000";
  assert.throws(() => validate(sufficientWithApproval), /approval.*sufficient|sufficient.*approval/i);

  const sufficientWithoutApproval = prepared();
  sufficientWithoutApproval.usdc_approval.sufficient = true;
  sufficientWithoutApproval.usdc_approval.current_allowance = "2000000";
  delete (sufficientWithoutApproval.usdc_approval as any).approve_tx;
  validate(sufficientWithoutApproval);

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
  assert.equal(prepareBody.risk_preview.maximum_usdc_at_risk_raw, "2000000");
  assert.equal(prepareBody.risk_preview.maximum_usdc_per_trade, 100);
  assert.equal(prepareBody.risk_preview.minimum_fill_ratio, 0.78);
  assert.equal(prepareBody.risk_preview.minimum_size_raw, "780000000000000");
  assert.equal(capturedMinFillRatio, 0.78, "Bankr API must preserve the safe fill default when omitted");
  assert.match(prepareBody.intent_fingerprint, /^[0-9a-f]{64}$/);

  const priorRiskEnv = process.env.BANKR_MAX_USDC_RISK_PER_TRADE;
  process.env.BANKR_MAX_USDC_RISK_PER_TRADE = "100";
  try {
    for (const strategy of ["BuyCallSpread", "SellPutSpread"] as const) {
      preparedFactory = (input: any) => prepared({
        strategy,
        from_address: input.fromAddress,
        long_leg_id: input.longLegId,
        short_leg_id: input.shortLegId,
        size: input.size,
        min_fill_ratio: input.minFillRatio
      }, 100_000_001n);
      const overCap = await post("prepare", {
        strategy,
        from_address: wallet,
        long_leg_id: "1",
        short_leg_id: "2",
        size: 1
      });
      assert.equal(overCap.status, 400, `${strategy} must reject one atomic USDC unit over the cap`);
      assert.match(String((await overCap.json() as any).error), /maximum.*100 USDC|risk.*cap/i);
    }

    process.env.BANKR_MAX_USDC_RISK_PER_TRADE = "0.000001";
    preparedFactory = (input: any) => prepared({
      strategy: input.strategy,
      from_address: input.fromAddress,
      long_leg_id: input.longLegId,
      short_leg_id: input.shortLegId,
      size: input.size,
      min_fill_ratio: input.minFillRatio
    }, 2n);
    const configuredCap = await post("prepare", {
      strategy: "BuyCallSpread",
      from_address: wallet,
      long_leg_id: "1",
      short_leg_id: "2",
      size: 1
    });
    assert.equal(configuredCap.status, 400, "the configured atomic-USDC cap must be enforced exactly");
  } finally {
    if (priorRiskEnv === undefined) delete process.env.BANKR_MAX_USDC_RISK_PER_TRADE;
    else process.env.BANKR_MAX_USDC_RISK_PER_TRADE = priorRiskEnv;
    preparedFactory = (input: any) => prepared({
      strategy: input.strategy,
      from_address: input.fromAddress,
      long_leg_id: input.longLegId,
      short_leg_id: input.shortLegId,
      size: input.size,
      min_fill_ratio: input.minFillRatio
    });
  }

  const reconcile = await post("reconcile", { wallet_address: wallet, tx_hash: txHash });
  assert.equal(reconcile.status, 200);
  assert.equal((await reconcile.json() as any).status, "executed");
  assert.deepEqual(captured, ["scan_success", "transaction_prepared", "onchain_detected", "keeper_executed"]);

  const unscoped = await post("reconcile", { wallet_address: wallet });
  assert.equal(unscoped.status, 400, "reconciliation must require an exact transaction, request, or intent selector");

  const recovered = await post("reconcile", {
    wallet_address: wallet,
    intent_fingerprint: intentFingerprint,
    from_block: 99_000
  });
  assert.equal(recovered.status, 200);
  const recoveredBody = await recovered.json() as any;
  assert.equal(recoveredBody.request_key, requestKey);
  assert.equal(recoveredBody.tx_hash, txHash);
  assert.deepEqual(capturedIntentLookup, {
    address: wallet,
    intentFingerprint,
    fromBlock: 99_000
  });

  const positions = await post("positions", { wallet_address: wallet });
  assert.equal(positions.status, 200);
  const positionsBody = await positions.json() as any;
  assert.equal(positionsBody.total_positions, 2);
  assert.equal(positionsBody.positions[0].naked_strike, 100);
  assert.equal(lightweightPositionCalls, 1, "Bankr lifecycle reads must use the lightweight on-chain position path");
  assert.equal(portfolioSummaryCalls, 0, "Bankr lifecycle reads must not compute the full P&L portfolio summary");

  const close = await post("close", {
    wallet_address: wallet,
    underlying_asset: "BTC",
    option_token_id: "101",
    size: 0.001,
    min_amount_out_raw: "1",
    min_out_when_swap_raw: "1"
  });
  assert.equal(close.status, 200);
  const closeBody = await close.json() as any;
  assert.equal(closeBody.action, "close");
  assert.match(closeBody.intent_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(closeBody.transaction_preview.destination, CONFIG.CONTRACTS.POSITION_MANAGER);

  const settle = await post("settle", {
    wallet_address: wallet,
    underlying_asset: "ETH",
    option_token_id: "202",
    min_out_when_swap_raw: "1"
  });
  assert.equal(settle.status, 200);
  const settleBody = await settle.json() as any;
  assert.equal(settleBody.action, "settle");
  assert.equal(settleBody.transaction_preview.destination, CONFIG.CONTRACTS.SETTLE_MANAGER);

  const closeAll = await post("close-all", {
    wallet_address: wallet,
    min_amount_out_raw: "1",
    min_out_when_swap_raw: "1"
  });
  assert.equal(closeAll.status, 200);
  const closeAllBody = await closeAll.json() as any;
  assert.equal(closeAllBody.eligible_count, 1);
  assert.equal(closeAllBody.transactions.length, 1);
  assert.match(closeAllBody.transactions[0].intent_fingerprint, /^[0-9a-f]{64}$/);

  const settleAll = await post("settle-all", {
    wallet_address: wallet,
    min_out_when_swap_raw: "1"
  });
  assert.equal(settleAll.status, 200);
  const settleAllBody = await settleAll.json() as any;
  assert.equal(settleAllBody.eligible_count, 1);
  assert.equal(settleAllBody.transactions.length, 1);

  for (const [action, body] of [
    ["close", { wallet_address: wallet, underlying_asset: "BTC", option_token_id: "101", size: 0.001, min_amount_out_raw: "0", min_out_when_swap_raw: "1" }],
    ["settle", { wallet_address: wallet, underlying_asset: "ETH", option_token_id: "202", min_out_when_swap_raw: "0" }],
    ["close-all", { wallet_address: wallet, min_amount_out_raw: "0", min_out_when_swap_raw: "1" }],
    ["settle-all", { wallet_address: wallet, min_out_when_swap_raw: "0" }]
  ] as const) {
    const invalidFloor = await post(action, body);
    assert.equal(invalidFloor.status, 400, `${action} must reject zero minimum output floors`);
  }

  const badEvent = await post("events", { event: "arbitrary_event", anonymous_id: "12345678" });
  assert.equal(badEvent.status, 400);

  const clientEvent = await postFrom("events", { event: "app_view", anonymous_id: "client-12345678" }, "198.51.100.10");
  assert.equal(clientEvent.status, 202);
  for (const event of ["onchain_detected", "keeper_executed"] as const) {
    const internalEvent = await postFrom("events", { event, anonymous_id: "client-12345678" }, `198.51.100.${event.length}`);
    assert.equal(internalEvent.status, 400, `${event} must only be emitted by verified server flows`);
  }

  const priorRateLimit = process.env.CALLPUT_RATE_LIMIT_PER_MINUTE;
  process.env.CALLPUT_RATE_LIMIT_PER_MINUTE = "1";
  try {
    const rateClient = "203.0.113.77";
    const options = await handleBankrApiRequest("assets", new Request("https://mcp.callput.app/api/bankr/assets", {
      method: "OPTIONS",
      headers: { origin: "https://bankr.bot", "x-forwarded-for": rateClient }
    }), deps);
    assert.equal(options.status, 204, "OPTIONS must bypass the request limit");

    const firstAssets = await handleBankrApiRequest("assets", new Request("https://mcp.callput.app/api/bankr/assets", {
      headers: { origin: "https://bankr.bot", "x-forwarded-for": rateClient }
    }), deps);
    assert.equal(firstAssets.status, 200);

    const separateAction = await postFrom("scan", { underlying_asset: "TSLA", bias: "bullish", max_results: 1 }, rateClient);
    assert.equal(separateAction.status, 200, "Bankr rate-limit buckets must be action-specific");

    const limitedAssets = await handleBankrApiRequest("assets", new Request("https://mcp.callput.app/api/bankr/assets", {
      headers: { origin: "https://bankr.bot", "x-forwarded-for": rateClient }
    }), deps);
    assert.equal(limitedAssets.status, 429, "Bankr REST must enforce the shared per-client request ceiling");
    assert.match(limitedAssets.headers.get("Retry-After") ?? "", /^\d+$/);
  } finally {
    if (priorRateLimit === undefined) delete process.env.CALLPUT_RATE_LIMIT_PER_MINUTE;
    else process.env.CALLPUT_RATE_LIMIT_PER_MINUTE = priorRateLimit;
  }

  console.log("Bankr API tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

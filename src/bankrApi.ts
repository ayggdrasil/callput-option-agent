import { ethers } from "ethers";
import { z } from "zod";
import { CONFIG, ERC20_ABI, OPTIONS_TOKEN_ABI, POSITION_MANAGER_ABI } from "./config.js";
import {
  DEFAULT_MIN_FILL_RATIO,
  calculateSpreadOpenQuote,
  checkRequestStatus,
  closeAllPositions,
  closePosition,
  executeSpread,
  findRequestKeyByIntentFingerprint,
  getMarketSnapshot,
  getPositions,
  getPortfolioSummary,
  getRequestKeyFromTx,
  scanSpreads,
  settleAllPositions,
  settlePosition,
  transactionIntentFingerprint
} from "./core.js";
import { anonymousWalletId, captureTelemetry, type TelemetryEvent } from "./telemetry.js";
import { bodyWithinLimit, isAllowedHttpHost, rateLimitRequest } from "./httpSecurity.js";

const MAX_BODY_BYTES = 32 * 1024;
const BANKR_ORIGINS = new Set(["https://bankr.bot", "https://mcp.callput.app"]);
const UINT256_MAX = (1n << 256n) - 1n;
const MAX_SAFE_INPUT_NUMBER = Number.MAX_SAFE_INTEGER;
const USDC_DECIMALS = CONFIG.ASSETS.USDC.decimals;
const CLIENT_TELEMETRY_EVENTS = [
  "app_view",
  "scan_success",
  "transaction_prepared",
  "wallet_confirmed",
  "cancelled"
] as const;

export const BANKR_MAX_USDC_RISK_ENV = "BANKR_MAX_USDC_RISK_PER_TRADE";
export const DEFAULT_BANKR_MAX_USDC_RISK = "100";

const addressSchema = z.string().refine((value) => ethers.isAddress(value), "Invalid address");

const optionIdSchema = z.string()
  .min(1)
  .max(78)
  .refine((value) => /^(0x[0-9a-fA-F]+|\d+)$/.test(value), "Option ID must be a decimal or 0x-prefixed uint256")
  .refine((value) => {
    try {
      const parsed = BigInt(value);
      return parsed > 0n && parsed <= UINT256_MAX;
    } catch {
      return false;
    }
  }, "Option ID must be between 1 and uint256 max");

const sizeSchema = z.number()
  .finite()
  .min(1e-18)
  .max(MAX_SAFE_INPUT_NUMBER);

const scanSchema = z.object({
  underlying_asset: z.string().min(1).max(16),
  bias: z.enum(["bullish", "bearish", "neutral-bearish", "neutral-bullish"]),
  max_results: z.number().int().min(1).max(5).optional()
}).strict();

export const bankrExecuteSpreadMcpInputSchema = z.object({
  strategy: z.enum(["BuyCallSpread", "SellCallSpread", "BuyPutSpread", "SellPutSpread"]),
  from_address: addressSchema,
  long_leg_id: optionIdSchema,
  short_leg_id: optionIdSchema,
  size: sizeSchema,
  min_fill_ratio: z.number().min(0.01).max(1).default(DEFAULT_MIN_FILL_RATIO)
}).strict();

export const bankrExecuteSpreadInputSchema = bankrExecuteSpreadMcpInputSchema.refine((value) => BigInt(value.long_leg_id) !== BigInt(value.short_leg_id), {
  message: "Long and short leg option IDs must differ",
  path: ["short_leg_id"]
});

const prepareSchema = bankrExecuteSpreadInputSchema;

const reconcileSchema = z.object({
  wallet_address: addressSchema,
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  request_key: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  intent_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  is_open: z.boolean().default(true),
  from_block: z.number().int().nonnegative().max(MAX_SAFE_INPUT_NUMBER).optional()
}).strict().refine((value) => value.tx_hash || value.request_key || value.intent_fingerprint, {
  message: "tx_hash, request_key, or intent_fingerprint is required"
});

const positiveRawSchema = z.string().regex(/^[1-9]\d*$/).max(78);
const positionsSchema = z.object({ wallet_address: addressSchema }).strict();
const closeSchema = z.object({
  wallet_address: addressSchema,
  underlying_asset: z.string().min(1).max(16),
  option_token_id: optionIdSchema,
  size: sizeSchema,
  min_amount_out_raw: positiveRawSchema,
  min_out_when_swap_raw: positiveRawSchema
}).strict();
const settleSchema = z.object({
  wallet_address: addressSchema,
  underlying_asset: z.string().min(1).max(16),
  option_token_id: optionIdSchema,
  min_out_when_swap_raw: positiveRawSchema
}).strict();
const closeAllSchema = z.object({
  wallet_address: addressSchema,
  min_amount_out_raw: positiveRawSchema,
  min_out_when_swap_raw: positiveRawSchema,
  plan_only: z.boolean().optional().default(false)
}).strict();
const settleAllSchema = z.object({
  wallet_address: addressSchema,
  min_out_when_swap_raw: positiveRawSchema,
  plan_only: z.boolean().optional().default(false)
}).strict();

const eventSchema = z.object({
  event: z.enum(CLIENT_TELEMETRY_EVENTS),
  wallet_address: z.string().refine((value) => ethers.isAddress(value), "Invalid wallet_address").optional(),
  anonymous_id: z.string().min(8).max(128).optional(),
  intent_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  asset: z.string().max(16).optional(),
  strategy: z.string().max(32).optional(),
  source: z.string().max(32).optional()
}).strict().refine((value) => value.wallet_address || value.anonymous_id, {
  message: "wallet_address or anonymous_id is required"
});

type Prepared = Awaited<ReturnType<typeof executeSpread>>;
export type BankrExecuteSpreadInput = z.infer<typeof bankrExecuteSpreadInputSchema>;

export type BankrDependencies = {
  getMarketSnapshot: typeof getMarketSnapshot;
  scanSpreads: typeof scanSpreads;
  executeSpread: typeof executeSpread;
  getRequestKeyFromTx: typeof getRequestKeyFromTx;
  findRequestKeyByIntentFingerprint: typeof findRequestKeyByIntentFingerprint;
  checkRequestStatus: typeof checkRequestStatus;
  getPortfolioSummary: typeof getPortfolioSummary;
  getPositions: typeof getPositions;
  closePosition: typeof closePosition;
  settlePosition: typeof settlePosition;
  closeAllPositions: typeof closeAllPositions;
  settleAllPositions: typeof settleAllPositions;
  captureTelemetry: typeof captureTelemetry;
};

const defaultDependencies: BankrDependencies = {
  getMarketSnapshot,
  scanSpreads,
  executeSpread,
  getRequestKeyFromTx,
  findRequestKeyByIntentFingerprint,
  checkRequestStatus,
  getPortfolioSummary,
  getPositions,
  closePosition,
  settlePosition,
  closeAllPositions,
  settleAllPositions,
  captureTelemetry
};

function headers(origin: string | null): HeadersInit {
  const result: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };
  if (origin) result["Access-Control-Allow-Origin"] = origin;
  return result;
}

function response(status: number, payload: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(payload), { status, headers: headers(origin) });
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error("Request body is too large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new Error("Request body is too large");
  return raw ? JSON.parse(raw) : {};
}

function intentFingerprint(prepared: Prepared): string {
  const tx = prepared.unsigned_tx;
  return transactionIntentFingerprint({
    chainId: tx.chain_id,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    data: tx.data
  });
}

function lifecycleIntentFingerprint(tx: { chain_id: number; from: string; to: string; value: string; data: string }): string {
  return transactionIntentFingerprint({
    chainId: tx.chain_id,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    data: tx.data
  });
}

function lifecycleTransactionResponse(action: "close" | "settle", built: any) {
  const tx = built.unsigned_tx;
  const approval = built.position_token_approval;
  if (approval) {
    const asset = action === "close" ? built.close?.asset : built.settle?.asset;
    const expectedToken = CONFIG.UNDERLYINGS[asset as keyof typeof CONFIG.UNDERLYINGS]?.optionsToken;
    if (!expectedToken) throw new Error("Position-token approval has an unsupported asset");
    sameAddress(approval.token, expectedToken, "Position-token approval token");
    if (!ethers.isAddress(approval.operator)) throw new Error("Position-token approval operator is invalid");
    const approveTx = approval.approve_tx;
    if (approval.sufficient) {
      if (approveTx) throw new Error("Position-token approval transaction must be absent when approval is sufficient");
    } else {
      if (!approveTx) throw new Error("Position-token approval transaction is required");
      sameAddress(approveTx.to, expectedToken, "Position-token approval destination");
      sameAddress(approveTx.from, tx.from, "Position-token approval sender");
      if (approveTx.chain_id !== CONFIG.CHAIN_ID || parseUint256(approveTx.value, "Position-token approval value") !== 0n) {
        throw new Error("Position-token approval chain or value is invalid");
      }
      const iface = new ethers.Interface(OPTIONS_TOKEN_ABI);
      const parsed = iface.parseTransaction({ data: approveTx.data, value: approveTx.value });
      if (parsed?.name !== "setApprovalForAll" || parsed.args[1] !== true) throw new Error("Position-token approval calldata is invalid");
      sameAddress(String(parsed.args[0]), approval.operator, "Position-token approval operator");
      if (iface.encodeFunctionData("setApprovalForAll", Array.from(parsed.args)).toLowerCase() !== approveTx.data.toLowerCase()) {
        throw new Error("Position-token approval calldata is not canonical");
      }
    }
  }
  return {
    ...built,
    action,
    intent_fingerprint: lifecycleIntentFingerprint(tx),
    transaction_preview: {
      chain: "Base",
      chain_id: tx.chain_id,
      destination: tx.to,
      value_wei: tx.value,
      wallet: tx.from
    }
  };
}

const MAX_BANKR_LIFECYCLE_PLAN_ITEMS = 25;

function lifecycleBatchPlan(
  action: "close" | "settle",
  input: { wallet_address: string; min_amount_out_raw?: string; min_out_when_swap_raw: string },
  positionData: any
) {
  if (positionData.position_data_warning) {
    throw new Error(`INCOMPLETE_POSITION_DATA: ${action} all requires every underlying lookup to succeed; ${positionData.position_data_warning}`);
  }
  const eligibleLifecycle = action === "close" ? "closable" : "settleable";
  const skippedLifecycle = action === "close" ? "settleable" : "closable";
  const eligible = Array.from(positionData.positions || []).filter((position: any) => position.lifecycle === eligibleLifecycle);
  const skipped = Array.from(positionData.positions || []).filter((position: any) => position.lifecycle === skippedLifecycle);
  if (eligible.length > MAX_BANKR_LIFECYCLE_PLAN_ITEMS) {
    throw new Error(`${action} all exceeds maximum ${MAX_BANKR_LIFECYCLE_PLAN_ITEMS} positions; split the request into smaller reviewed batches`);
  }
  const transactions = eligible.map((position: any) => {
    const asset = String(position.underlying || "");
    const optionTokenId = String(position.token_id || "");
    if (!CONFIG.UNDERLYINGS[asset as keyof typeof CONFIG.UNDERLYINGS]) throw new Error(`Unsupported lifecycle asset: ${asset}`);
    if (!/^(0x[0-9a-fA-F]+|[1-9]\d*)$/.test(optionTokenId)) throw new Error("Lifecycle plan contains an invalid option token ID");
    if (action === "settle") {
      return {
        action,
        settle: { asset, option_token_id: optionTokenId, min_out_when_swap_raw: input.min_out_when_swap_raw }
      };
    }
    const size = Math.abs(Number(position.size));
    if (!Number.isFinite(size) || size <= 0) throw new Error("Lifecycle plan contains an invalid close size");
    return {
      action,
      close: {
        asset,
        option_token_id: optionTokenId,
        size,
        min_amount_out_raw: input.min_amount_out_raw,
        min_out_when_swap_raw: input.min_out_when_swap_raw
      }
    };
  });
  return {
    action: `${action}_all`,
    account: ethers.getAddress(input.wallet_address),
    eligible_count: transactions.length,
    skipped_count: skipped.length,
    transactions,
    confirmation_mode: "one_bankr_review_per_transaction",
    plan_only: true
  };
}

function parseUint256(value: unknown, label: string): bigint {
  if (typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") {
    throw new Error(`${label} is not a uint256`);
  }
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error(`${label} is not a canonical uint256`);
  const parsed = BigInt(text);
  if (parsed < 0n || parsed > UINT256_MAX) throw new Error(`${label} is outside uint256 bounds`);
  return parsed;
}

function parseOptionId(value: unknown, label: string): bigint {
  const text = String(value);
  if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(text)) throw new Error(`${label} is not a uint256 option ID`);
  const parsed = BigInt(text);
  if (parsed <= 0n || parsed > UINT256_MAX) throw new Error(`${label} is outside uint256 bounds`);
  return parsed;
}

function unitsFromNumber(value: unknown, decimals: number, label: string): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_SAFE_INPUT_NUMBER) {
    throw new Error(`${label} must be a finite positive number within safe input bounds`);
  }
  const decimal = value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: decimals
  });
  const parsed = ethers.parseUnits(decimal, decimals);
  if (parsed <= 0n || parsed > UINT256_MAX) throw new Error(`${label} is outside uint256 bounds after scaling`);
  return parsed;
}

function sameAddress(actual: unknown, expected: string, label: string): void {
  if (typeof actual !== "string" || !ethers.isAddress(actual) || ethers.getAddress(actual) !== ethers.getAddress(expected)) {
    throw new Error(`${label} does not match the prepared request`);
  }
}

function sameBooleanArray(actual: unknown, expected: readonly boolean[], label: string): void {
  if (!Array.isArray(actual) && !(actual && typeof actual === "object" && "length" in actual)) {
    throw new Error(`${label} is not an array`);
  }
  const values = Array.from(actual as ArrayLike<unknown>);
  if (values.length !== expected.length || values.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} does not match the requested strategy`);
  }
}

export function resolveBankrMaxUsdcRiskRaw(env: NodeJS.ProcessEnv = process.env): bigint {
  const configured = env[BANKR_MAX_USDC_RISK_ENV] ?? DEFAULT_BANKR_MAX_USDC_RISK;
  if (!/^\d+(?:\.\d{1,6})?$/.test(configured)) {
    throw new Error(`${BANKR_MAX_USDC_RISK_ENV} must be a positive USDC amount with at most 6 decimals`);
  }
  const raw = ethers.parseUnits(configured, USDC_DECIMALS);
  const maxSafeRaw = ethers.parseUnits(String(MAX_SAFE_INPUT_NUMBER), USDC_DECIMALS);
  if (raw <= 0n || raw > maxSafeRaw || raw > UINT256_MAX / 2n) {
    throw new Error(`${BANKR_MAX_USDC_RISK_ENV} is outside supported bounds`);
  }
  return raw;
}

export function validatePreparedTransaction(
  prepared: Prepared,
  request: BankrExecuteSpreadInput,
  maxUsdcRiskRaw: bigint = resolveBankrMaxUsdcRiskRaw()
): void {
  if (maxUsdcRiskRaw <= 0n || maxUsdcRiskRaw > UINT256_MAX / 2n) {
    throw new Error("Maximum USDC risk policy is outside supported bounds");
  }

  if (prepared.validation.status !== "Valid") throw new Error("Prepared spread validation is not valid");
  const details = prepared.validation.details as any;
  const asset = String(details.asset ?? "") as keyof typeof CONFIG.UNDERLYINGS;
  const assetConfig = CONFIG.UNDERLYINGS[asset];
  if (!assetConfig) throw new Error("Prepared transaction has an unsupported validation asset");

  const expectedOptionType = request.strategy.includes("Call") ? "Call" : "Put";
  if (details.option_type !== expectedOptionType) {
    throw new Error("Prepared validation option type does not match the requested strategy");
  }
  if (parseOptionId(details.long_leg?.option_id, "Prepared validation long leg") !== BigInt(request.long_leg_id)) {
    throw new Error("Prepared validation long leg does not match the request");
  }
  if (parseOptionId(details.short_leg?.option_id, "Prepared validation short leg") !== BigInt(request.short_leg_id)) {
    throw new Error("Prepared validation short leg does not match the request");
  }

  const quote = prepared.quote;
  if (quote.strategy !== request.strategy) throw new Error("Prepared quote strategy does not match the request");
  if (quote.size !== request.size) throw new Error("Prepared quote size does not match the request");
  if (quote.min_fill_ratio !== request.min_fill_ratio) throw new Error("Prepared quote minimum fill ratio does not match the request");
  if (quote.underlying_decimals !== assetConfig.decimals) {
    throw new Error("Prepared quote underlying decimals do not match the validation asset");
  }

  const sizeRaw = parseUint256(quote.size_raw, "Prepared quote size");
  const expectedSizeRaw = unitsFromNumber(request.size, assetConfig.decimals, "Requested size");
  if (sizeRaw !== expectedSizeRaw) throw new Error("Prepared quote size does not match the scaled request size");

  const minSizeRaw = parseUint256(quote.min_size_raw, "Prepared quote minimum size");
  const expectedMinSize = (sizeRaw * BigInt(Math.floor(request.min_fill_ratio * 10_000))) / 10_000n;
  if (minSizeRaw <= 0n || minSizeRaw !== expectedMinSize) {
    throw new Error("Prepared quote minimum size does not match the requested fill ratio");
  }

  const amountInRaw = parseUint256(quote.amount_in_raw, "Prepared quote amount in");
  if (amountInRaw <= 0n) throw new Error("Prepared quote amount in must be positive");
  if (unitsFromNumber(quote.amount_in_usdc, USDC_DECIMALS, "Prepared quote USDC risk") !== amountInRaw) {
    throw new Error("Prepared quote USDC risk does not match its amount in");
  }
  const expectedOpenQuote = calculateSpreadOpenQuote({
    strategy: request.strategy,
    size: request.size,
    spotPrice: Number(details.spot_price),
    spreadMarkPrice: Number(details.spread_cost),
    strikeDiff: Number(details.strike_diff),
    longRiskPremiumRateForBuy: Number(details.long_leg?.risk_premium_rate_for_buy),
    longRiskPremiumRateForSell: Number(details.long_leg?.risk_premium_rate_for_sell),
    shortRiskPremiumRateForBuy: Number(details.short_leg?.risk_premium_rate_for_buy),
    shortRiskPremiumRateForSell: Number(details.short_leg?.risk_premium_rate_for_sell)
  });
  const expectedAmountIn = unitsFromNumber(expectedOpenQuote.amount_in_usdc, USDC_DECIMALS, "Prepared validation risk");
  if (amountInRaw !== expectedAmountIn) {
    throw new Error("Prepared quote amount in does not match the validated spread risk");
  }
  if (quote.pricing_model !== expectedOpenQuote.pricing_model) {
    throw new Error("Prepared quote pricing model does not match the validated spread risk");
  }
  for (const [label, actual, expected] of [
    ["risk premium rate", quote.risk_premium_rate, expectedOpenQuote.risk_premium_rate],
    ["execution price", quote.estimated_execution_price, expectedOpenQuote.estimated_execution_price],
    ["open fee", quote.estimated_open_fee_usdc, expectedOpenQuote.estimated_open_fee_usdc]
  ] as const) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1e-12, Math.abs(expected) * 1e-12)) {
      throw new Error(`Prepared quote ${label} does not match the validated spread risk`);
    }
  }
  if (amountInRaw > maxUsdcRiskRaw) {
    const configured = ethers.formatUnits(maxUsdcRiskRaw, USDC_DECIMALS).replace(/\.0$/, "");
    throw new Error(`Prepared transaction risk exceeds maximum ${configured} USDC per trade`);
  }

  const tx = prepared.unsigned_tx;
  if (tx.chain_id !== CONFIG.CHAIN_ID) throw new Error("Prepared transaction has an unexpected chain ID");
  if (ethers.getAddress(tx.to) !== ethers.getAddress(CONFIG.CONTRACTS.POSITION_MANAGER)) {
    throw new Error("Prepared transaction has an unexpected destination");
  }
  sameAddress(tx.from, request.from_address, "Prepared transaction sender");
  const txValue = parseUint256(tx.value, "Prepared transaction value");
  if (txValue <= 0n) throw new Error("Prepared transaction value must be positive");

  const positionManager = new ethers.Interface(POSITION_MANAGER_ABI);
  const parsed = positionManager.parseTransaction({ data: tx.data, value: tx.value });
  if (parsed?.name !== "createOpenPosition") throw new Error("Prepared transaction has unexpected calldata");
  const canonicalData = positionManager.encodeFunctionData("createOpenPosition", Array.from(parsed.args));
  if (canonicalData.toLowerCase() !== tx.data.toLowerCase()) {
    throw new Error("Prepared transaction calldata is not canonical");
  }

  if (BigInt(parsed.args[0]) !== BigInt(assetConfig.index)) {
    throw new Error("Prepared transaction underlying does not match the validated asset");
  }
  if (BigInt(parsed.args[1]) !== 2n) throw new Error("Prepared transaction spread length must be 2");

  const isBuy = request.strategy.startsWith("Buy");
  const isCall = request.strategy.includes("Call");
  sameBooleanArray(parsed.args[2], [isBuy, !isBuy, false, false], "Prepared transaction buy sides");

  const optionIds = Array.from(parsed.args[3] as ArrayLike<unknown>);
  const expectedOptionIds = [BigInt(request.long_leg_id), BigInt(request.short_leg_id), 0n, 0n];
  if (optionIds.length !== expectedOptionIds.length || optionIds.some((value, index) => BigInt(String(value)) !== expectedOptionIds[index])) {
    throw new Error("Prepared transaction option legs do not match the request");
  }
  sameBooleanArray(parsed.args[4], [isCall, isCall, false, false], "Prepared transaction call/put flags");

  if (BigInt(parsed.args[5]) !== minSizeRaw) {
    throw new Error("Prepared transaction minimum size does not match its quote");
  }
  const path = Array.from(parsed.args[6] as ArrayLike<unknown>);
  if (path.length !== 1) throw new Error("Prepared transaction path must contain only USDC");
  sameAddress(path[0], CONFIG.CONTRACTS.USDC, "Prepared transaction USDC path");
  if (BigInt(parsed.args[7]) !== amountInRaw) {
    throw new Error("Prepared transaction amount in does not match its quote");
  }
  if (BigInt(parsed.args[8]) !== 0n) throw new Error("Prepared transaction minimum output must be zero for the USDC path");
  sameAddress(String(parsed.args[9]), ethers.ZeroAddress, "Prepared transaction lead trader");

  const approvalInfo = prepared.usdc_approval;
  const currentAllowance = parseUint256(approvalInfo.current_allowance, "Current USDC allowance");
  const requiredApproval = parseUint256(approvalInfo.required, "USDC approval required amount");
  if (requiredApproval !== amountInRaw) throw new Error("USDC approval required amount does not match the quote");
  if (approvalInfo.sufficient !== (currentAllowance >= requiredApproval)) {
    throw new Error("USDC allowance sufficiency does not match the reported allowance");
  }

  const approval = approvalInfo.approve_tx;
  if (approvalInfo.sufficient) {
    if (approval) throw new Error("USDC approval must be absent when allowance is sufficient");
    return;
  }
  if (!approval) throw new Error("USDC approval is required when allowance is insufficient");
  if (approval.chain_id !== CONFIG.CHAIN_ID) throw new Error("Approval has an unexpected chain ID");
  if (ethers.getAddress(approval.to) !== ethers.getAddress(CONFIG.CONTRACTS.USDC)) {
    throw new Error("Approval has an unexpected destination");
  }
  if (parseUint256(approval.value, "USDC approval transaction value") !== 0n) {
    throw new Error("USDC approval transaction value must be zero");
  }
  const erc20 = new ethers.Interface(ERC20_ABI);
  const decoded = erc20.parseTransaction({ data: approval.data, value: approval.value });
  if (decoded?.name !== "approve") throw new Error("Approval has unexpected calldata");
  sameAddress(String(decoded.args[0]), CONFIG.CONTRACTS.ROUTER, "USDC approval spender");
  const approvalAmount = BigInt(decoded.args[1]);
  if (approvalAmount !== amountInRaw || approvalAmount > maxUsdcRiskRaw) {
    throw new Error("USDC approval amount must equal the quoted risk and stay within the risk cap");
  }
  const canonicalApprovalData = erc20.encodeFunctionData("approve", Array.from(decoded.args));
  if (canonicalApprovalData.toLowerCase() !== approval.data.toLowerCase()) {
    throw new Error("USDC approval calldata is not canonical");
  }
}

async function telemetry(deps: BankrDependencies, event: TelemetryEvent, wallet: string | undefined, properties: Record<string, any>) {
  const distinctId = anonymousWalletId(wallet) ?? String(properties.anonymous_id ?? "anonymous");
  await deps.captureTelemetry({ event, distinctId, properties }).catch((error) => {
    console.error("Telemetry error", error instanceof Error ? error.message : error);
  });
}

export async function handleBankrApiRequest(
  action: "assets" | "scan" | "prepare" | "reconcile" | "positions" | "close" | "settle" | "close-all" | "settle-all" | "events",
  request: Request,
  deps: BankrDependencies = defaultDependencies
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!isAllowedHttpHost(request)) return response(421, { error: "Host is not allowed" }, null);
  if (origin && !BANKR_ORIGINS.has(origin)) return response(403, { error: "Origin is not allowed" }, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  const rateLimit = rateLimitRequest(request, `bankr:${action}`);
  if (!rateLimit.allowed) {
    const limited = response(429, { error: "Too many requests" }, origin);
    limited.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return limited;
  }
  if (action === "assets" && request.method !== "GET") return response(405, { error: "Use GET" }, origin);
  if (action !== "assets" && request.method !== "POST") return response(405, { error: "Use POST" }, origin);
  if (!(await bodyWithinLimit(request, MAX_BODY_BYTES))) return response(413, { error: "Request body is too large" }, origin);

  try {
    if (action === "assets") {
      const snapshot = await deps.getMarketSnapshot();
      const assets = Object.entries(CONFIG.UNDERLYINGS).map(([symbol, config]) => ({
        symbol,
        market_type: config.marketType,
        spot_price: snapshot.spot[symbol as keyof typeof snapshot.spot],
        tradable_options: snapshot.options.filter((option) => option.underlying === symbol && option.isAvailable).length
      }));
      return response(200, { chain_id: CONFIG.CHAIN_ID, chain: "base", assets }, origin);
    }

    const raw = await readJson(request);
    if (action === "scan") {
      const input = scanSchema.parse(raw);
      const result = await deps.scanSpreads({
        underlyingAsset: input.underlying_asset,
        bias: input.bias,
        maxResults: input.max_results
      });
      await telemetry(deps, "scan_success", undefined, { anonymous_id: "bankr-readonly", asset: result.asset, strategy: result.strategy });
      return response(200, result, origin);
    }

    if (action === "prepare") {
      const input = prepareSchema.parse(raw);
      const prepared = await deps.executeSpread({
        strategy: input.strategy,
        fromAddress: input.from_address,
        longLegId: input.long_leg_id,
        shortLegId: input.short_leg_id,
        size: input.size,
        minFillRatio: input.min_fill_ratio
      });
      const maxUsdcRiskRaw = resolveBankrMaxUsdcRiskRaw();
      validatePreparedTransaction(prepared, input, maxUsdcRiskRaw);
      const fingerprint = intentFingerprint(prepared);
      await telemetry(deps, "transaction_prepared", input.from_address, {
        intent_fingerprint: fingerprint,
        asset: (prepared.validation.details as any).asset,
        strategy: input.strategy
      });
      return response(200, {
        ...prepared,
        intent_fingerprint: fingerprint,
        risk_preview: {
          chain: "Base",
          chain_id: CONFIG.CHAIN_ID,
          wallet: ethers.getAddress(input.from_address),
          asset: (prepared.validation.details as any).asset,
          strategy: input.strategy,
          size: input.size,
          maximum_usdc_at_risk: prepared.quote.amount_in_usdc,
          maximum_usdc_at_risk_raw: prepared.quote.amount_in_raw,
          maximum_usdc_per_trade: Number(ethers.formatUnits(maxUsdcRiskRaw, USDC_DECIMALS)),
          minimum_fill_ratio: prepared.quote.min_fill_ratio,
          minimum_size_raw: prepared.quote.min_size_raw,
          execution_fee_wei: prepared.unsigned_tx.value,
          approval_required: !prepared.usdc_approval.sufficient
        }
      }, origin);
    }

    if (action === "positions") {
      const input = positionsSchema.parse(raw);
      const positionData = await deps.getPositions(input.wallet_address, { includeMarketData: false, multicallRpc: true });
      return response(200, {
        account: positionData.account,
        total_positions: positionData.total_active_count,
        market_data_warning: positionData.market_data_warning,
        position_data_warning: positionData.position_data_warning,
        positions: positionData.positions.map((position) => ({
          ...position,
          naked_strike: position.strike
        }))
      }, origin);
    }

    if (action === "close") {
      const input = closeSchema.parse(raw);
      const built = await deps.closePosition({
        underlyingAsset: input.underlying_asset,
        fromAddress: input.wallet_address,
        optionTokenId: input.option_token_id,
        size: input.size,
        minAmountOutRaw: input.min_amount_out_raw,
        minOutWhenSwapRaw: input.min_out_when_swap_raw
      });
      const result = lifecycleTransactionResponse("close", built);
      await telemetry(deps, "transaction_prepared", input.wallet_address, { intent_fingerprint: result.intent_fingerprint, action: "close" });
      return response(200, result, origin);
    }

    if (action === "settle") {
      const input = settleSchema.parse(raw);
      const built = await deps.settlePosition({
        underlyingAsset: input.underlying_asset,
        fromAddress: input.wallet_address,
        optionTokenId: input.option_token_id,
        minOutWhenSwapRaw: input.min_out_when_swap_raw
      });
      const result = lifecycleTransactionResponse("settle", built);
      await telemetry(deps, "transaction_prepared", input.wallet_address, { intent_fingerprint: result.intent_fingerprint, action: "settle" });
      return response(200, result, origin);
    }

    if (action === "close-all") {
      const input = closeAllSchema.parse(raw);
      if (input.plan_only) {
        const positionData = await deps.getPositions(input.wallet_address, { includeMarketData: false, multicallRpc: true });
        return response(200, lifecycleBatchPlan("close", input, positionData), origin);
      }
      const batch = await deps.closeAllPositions({
        fromAddress: input.wallet_address,
        minAmountOutRaw: input.min_amount_out_raw,
        minOutWhenSwapRaw: input.min_out_when_swap_raw
      });
      const transactions = batch.transactions.map((built: any) => lifecycleTransactionResponse("close", built));
      return response(200, { ...batch, transactions }, origin);
    }

    if (action === "settle-all") {
      const input = settleAllSchema.parse(raw);
      if (input.plan_only) {
        const positionData = await deps.getPositions(input.wallet_address, { includeMarketData: false, multicallRpc: true });
        return response(200, lifecycleBatchPlan("settle", input, positionData), origin);
      }
      const batch = await deps.settleAllPositions({
        fromAddress: input.wallet_address,
        minOutWhenSwapRaw: input.min_out_when_swap_raw
      });
      const transactions = batch.transactions.map((built: any) => lifecycleTransactionResponse("settle", built));
      return response(200, { ...batch, transactions }, origin);
    }

    if (action === "reconcile") {
      const input = reconcileSchema.parse(raw);
      if (!ethers.isAddress(input.wallet_address)) throw new Error("Invalid wallet_address");
      let requestKey = input.request_key;
      let isOpen = input.is_open;
      let resolvedTxHash = input.tx_hash;
      if (input.tx_hash) {
        const extracted = await deps.getRequestKeyFromTx(input.tx_hash, input.wallet_address);
        if ("error" in extracted) return response(404, extracted, origin);
        requestKey = extracted.request_key;
        isOpen = extracted.is_open;
      }
      if (!requestKey && input.intent_fingerprint) {
        const recovered = await deps.findRequestKeyByIntentFingerprint({
          address: input.wallet_address,
          intentFingerprint: input.intent_fingerprint,
          fromBlock: input.from_block
        });
        if (!recovered) {
          return response(200, {
            status: "not_found",
            wallet: ethers.getAddress(input.wallet_address),
            intent_fingerprint: input.intent_fingerprint
          }, origin);
        }
        requestKey = recovered.request_key;
        isOpen = recovered.is_open;
        resolvedTxHash = recovered.tx_hash;
      }
      const status = await deps.checkRequestStatus(requestKey!, isOpen);
      const account = "account" in status ? String(status.account) : undefined;
      if (account && ethers.getAddress(account) !== ethers.getAddress(input.wallet_address)) {
        return response(409, { error: "Request key belongs to a different wallet" }, origin);
      }
      await telemetry(deps, "onchain_detected", input.wallet_address, { request_key: requestKey, status: status.status });
      if (status.status === "executed") await telemetry(deps, "keeper_executed", input.wallet_address, { request_key: requestKey });
      if (status.status === "cancelled") await telemetry(deps, "cancelled", input.wallet_address, { request_key: requestKey });
      return response(200, { tx_hash: resolvedTxHash, is_open: isOpen, ...status }, origin);
    }

    const input = eventSchema.parse(raw);
    await telemetry(deps, input.event, input.wallet_address, {
      anonymous_id: input.anonymous_id,
      intent_fingerprint: input.intent_fingerprint,
      asset: input.asset,
      strategy: input.strategy,
      source: input.source ?? "bankr_app"
    });
    return response(202, { accepted: true }, origin);
  } catch (error) {
    if (error instanceof z.ZodError) return response(400, { error: "Invalid request", issues: error.issues }, origin);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("too large") ? 413 : 400;
    return response(status, { error: message }, origin);
  }
}

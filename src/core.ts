import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { CONFIG, ERC20_ABI, OPTIONS_TOKEN_ABI, POSITION_MANAGER_ABI, SETTLE_MANAGER_ABI } from "./config.js";

export type UnderlyingAsset = keyof typeof CONFIG.UNDERLYINGS;
const UNDERLYING_ASSETS = Object.keys(CONFIG.UNDERLYINGS) as UnderlyingAsset[];
export type OptionSide = "Call" | "Put";
export type SpreadStrategy = "BuyCallSpread" | "SellCallSpread" | "BuyPutSpread" | "SellPutSpread";
export const DEFAULT_MIN_FILL_RATIO = 0.78;
export const DEFAULT_MAX_MARKET_AGE_MS = 5 * 60_000;
export const DEFAULT_EVENT_LOOKBACK_BLOCKS = 50_000;
export const DEFAULT_MAX_EVENT_LOOKBACK_BLOCKS = 100_000;
export const DEFAULT_MARKET_TIMEOUT_MS = 8_000;
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_PORTFOLIO_REQUEST_KEYS = 50;
export const DEFAULT_PORTFOLIO_REQUEST_CONCURRENCY = 4;
export const DEFAULT_MAX_EXECUTION_FEE_WEI = 300_000_000_000_000n;
export const DEFAULT_INTENT_RECONCILE_LOOKBACK_BLOCKS = 1_800;
export const DEFAULT_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS = 7_200;
export const OPEN_COMBO_POSITION_FEE_RATE = 0.0003;
export const TRADE_FEE_CALCULATION_LIMIT_RATE = 0.125;

const HARD_MAX_EVENT_LOOKBACK_BLOCKS = 500_000;
const HARD_MAX_NETWORK_TIMEOUT_MS = 60_000;
const HARD_MAX_PORTFOLIO_REQUEST_KEYS = 200;
const HARD_MAX_PORTFOLIO_REQUEST_CONCURRENCY = 20;
const HARD_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS = 50_000;

function readIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function getMaxExecutionFeeWei(): bigint {
  const raw = process.env.CALLPUT_MAX_EXECUTION_FEE_WEI;
  if (raw === undefined || raw === "") return DEFAULT_MAX_EXECUTION_FEE_WEI;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error("CALLPUT_MAX_EXECUTION_FEE_WEI must be a positive decimal integer");
  }
  const parsed = BigInt(raw);
  if (parsed > ethers.MaxUint256) throw new Error("CALLPUT_MAX_EXECUTION_FEE_WEI exceeds uint256");
  return parsed;
}

// ─── Type interfaces for contract responses ────────────────────────────────
export interface OpenPositionRequest {
  account: string;
  underlyingAssetIndex: bigint;
  expiry: bigint;
  optionTokenId: bigint;
  minSize: bigint;
  amountIn: bigint;
  minOutWhenSwap: bigint;
  isDepositedInNAT: boolean;
  blockTime: bigint;
  status: bigint;
  sizeOut: bigint;
  executionPrice: bigint;
  processBlockTime: bigint;
  amountOut: bigint;
}

export interface ClosePositionRequest {
  account: string;
  underlyingAssetIndex: bigint;
  expiry: bigint;
  optionTokenId: bigint;
  size: bigint;
  minAmountOut: bigint;
  minOutWhenSwap: bigint;
  withdrawNAT: boolean;
  blockTime: bigint;
  status: bigint;
  amountOut: bigint;
  executionPrice: bigint;
  processBlockTime: bigint;
}

type MarketOption = {
  instrument: string;
  optionId: string;
  strikePrice: number;
  markPrice: number;
  bid: number;
  ask: number;
  riskPremiumRateForBuy: number;
  riskPremiumRateForSell: number;
  underlying: UnderlyingAsset;
  optionType: OptionSide;
  expirySec: number;
  expiryCode: string;
  isAvailable: boolean;
  iv: number | null;
};

type MarketDataPayload = {
  lastUpdatedAt?: string | number;
  timestamp?: number;
  data?: {
    market?: Record<string, {
      expiries?: string[];
      options?: Record<string, { call?: any[]; put?: any[] }>;
    }>;
    spotIndices?: Record<string, number>;
  };
};

type ParsedTokenId = {
  underlyingAssetIndex: number;
  expirySec: number;
  strikePrice: number;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

let marketCache: {
  tsMs: number;
  updatedAtMs: number;
  options: MarketOption[];
  spot: Record<UnderlyingAsset, number>;
} | null = null;
let marketFetchInFlight: Promise<MarketDataPayload> | null = null;

const ASSET_ALIASES: Record<string, UnderlyingAsset> = {
  WBTC: "BTC",
  XBT: "BTC",
  WETH: "ETH",
  SPACEX: "SPCX",
  XSPCX: "SPCX",
  TESLA: "TSLA",
  NVIDIA: "NVDA",
  COINBASE: "COIN",
  NASDAQ100: "QQQ",
  NASDAQ: "QQQ",
  SANDP500: "SPY",
  SP500: "SPY",
  SNP500: "SPY",
  KOREA: "EWY",
  HYNIX: "SKHY",
  SKHYNIX: "SKHY"
};

function isUnderlyingAsset(value: string): value is UnderlyingAsset {
  return Object.prototype.hasOwnProperty.call(CONFIG.UNDERLYINGS, value);
}

export function normalizeAsset(asset: string): UnderlyingAsset | null {
  const upper = asset.trim().toUpperCase();
  const compact = upper.replace(/[\s._&-]+/g, "");
  const aliased = ASSET_ALIASES[upper] ?? ASSET_ALIASES[compact];
  if (aliased) return aliased;
  if (isUnderlyingAsset(upper)) return upper;
  if (isUnderlyingAsset(compact)) return compact;
  return null;
}

function normalizeOptionSide(optionType?: string): OptionSide | null {
  if (!optionType) return null;
  const s = optionType.trim().toLowerCase();
  if (s === "call" || s === "c") return "Call";
  if (s === "put" || s === "p") return "Put";
  return null;
}

export function formatExpiry(expirySec: number): string {
  const dt = new Date(expirySec * 1000);
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const mon = MONTHS[dt.getUTCMonth()];
  const yy = String(dt.getUTCFullYear()).slice(-2);
  return `${day}${mon}${yy}`;
}

export function parseOptionTokenId(optionId: string): ParsedTokenId {
  const id = BigInt(optionId);
  const underlyingAssetIndex = Number((id >> 240n) & 0xffffn);
  const expirySec = Number((id >> 200n) & 0xffffffffffn);
  const strikePrice = Number((id >> 152n) & 0xffffffffffffn);
  return {
    underlyingAssetIndex,
    expirySec,
    strikePrice
  };
}

export function decodeSpreadTokenId(tokenIdInput: string): {
  underlying: UnderlyingAsset | null;
  expirySec: number;
  expiryCode: string;
  isLong: boolean;
  nakedStrike: number;
  pairStrike: number;
  optionType: OptionSide;
} {
  const tokenId = BigInt(tokenIdInput);
  const hex = tokenId.toString(16).padStart(64, "0");
  const assetIndex = Number.parseInt(hex.slice(0, 4), 16);
  const expirySec = Number.parseInt(hex.slice(4, 14), 16);
  const flagByte = Number.parseInt(hex.slice(14, 16), 16);
  const nakedEncoded = Number.parseInt(hex.slice(16, 28), 16);
  const pairEncoded = Number.parseInt(hex.slice(28, 40), 16);
  const isLong = flagByte === 0x56;
  const nakedStrike = Math.floor(nakedEncoded / 8);
  const pairStrike = pairEncoded > 0 ? Math.floor(pairEncoded / 8) : 0;
  const optionType: OptionSide = (nakedEncoded % 8 & 4) !== 0 ? "Call" : "Put";

  const underlying = mapAssetIndexToUnderlying(assetIndex);
  return {
    underlying,
    expirySec,
    expiryCode: formatExpiry(expirySec),
    isLong,
    nakedStrike,
    pairStrike,
    optionType
  };
}

function optionSuffix(optionType: OptionSide): "C" | "P" {
  return optionType === "Call" ? "C" : "P";
}

export function buildInstrument(
  underlying: UnderlyingAsset,
  expiryCode: string,
  strike: number,
  optionType: OptionSide
): string {
  return `${underlying}-${expiryCode.toUpperCase()}-${Math.trunc(strike)}-${optionSuffix(optionType)}`;
}

async function fetchRawMarketData(): Promise<MarketDataPayload> {
  const timeoutMs = readIntegerEnv(
    "CALLPUT_MARKET_TIMEOUT_MS",
    DEFAULT_MARKET_TIMEOUT_MS,
    25,
    HARD_MAX_NETWORK_TIMEOUT_MS
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`MARKET_DATA_TIMEOUT: exceeded ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(CONFIG.MARKET_DATA_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch market data from ${CONFIG.MARKET_DATA_URL}: HTTP ${response.status}`);
    }
    return (await response.json()) as MarketDataPayload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`MARKET_DATA_TIMEOUT: ${CONFIG.MARKET_DATA_URL} exceeded ${timeoutMs}ms`);
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch market data from ${CONFIG.MARKET_DATA_URL}: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRawMarketDataCoalesced(): Promise<MarketDataPayload> {
  if (!marketFetchInFlight) {
    marketFetchInFlight = fetchRawMarketData().finally(() => {
      marketFetchInFlight = null;
    });
  }
  return marketFetchInFlight;
}

function marketSchemaError(message: string): never {
  throw new Error(`MARKET_DATA_SCHEMA: ${message}`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, path: string, options: { positive?: boolean; integer?: boolean } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return marketSchemaError(`${path} must be a finite number`);
  }
  if (options.positive && value <= 0) return marketSchemaError(`${path} must be > 0`);
  if (options.integer && !Number.isSafeInteger(value)) return marketSchemaError(`${path} must be a safe integer`);
  return value;
}

function getMarketUpdatedAtMs(payload: MarketDataPayload): number {
  const isoUpdatedAt = typeof payload.lastUpdatedAt === "string"
    ? Date.parse(payload.lastUpdatedAt)
    : typeof payload.lastUpdatedAt === "number"
      ? payload.lastUpdatedAt
      : Number.NaN;
  const epochUpdatedAt = payload.timestamp;

  if (!Number.isFinite(isoUpdatedAt)) {
    return marketSchemaError("lastUpdatedAt must be an ISO timestamp or epoch milliseconds");
  }
  if (epochUpdatedAt !== undefined) {
    requireFiniteNumber(epochUpdatedAt, "timestamp", { positive: true, integer: true });
    if (Math.abs(epochUpdatedAt - isoUpdatedAt) > 1_000) {
      return marketSchemaError("lastUpdatedAt and timestamp disagree");
    }
  }
  return isoUpdatedAt;
}

function parsePositiveRawAmount(value: string | undefined, name: string): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive decimal integer string`);
  }
  const parsed = BigInt(value);
  if (parsed > ethers.MaxUint256) throw new Error(`${name} exceeds uint256`);
  return parsed;
}

function parsePositiveTokenId(value: string): bigint {
  if (!/^(0x[0-9a-fA-F]+|[1-9]\d*)$/.test(value)) {
    throw new Error(`optionTokenId must be a positive decimal or 0x-prefixed hexadecimal integer: ${value}`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > ethers.MaxUint256) throw new Error("optionTokenId must fit uint256");
  return parsed;
}

export async function getMarketSnapshot(
  force = false,
  maxAgeMs = DEFAULT_MAX_MARKET_AGE_MS
): Promise<{ options: MarketOption[]; spot: Record<UnderlyingAsset, number> }> {
  const now = Date.now();
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("maxAgeMs must be > 0");
  if (
    !force &&
    marketCache &&
    now - marketCache.tsMs < 5_000 &&
    now - marketCache.updatedAtMs <= maxAgeMs
  ) {
    return { options: marketCache.options, spot: marketCache.spot };
  }

  const payload = await fetchRawMarketDataCoalesced();
  if (!isRecord(payload)) marketSchemaError("payload must be an object");
  const updatedAtMs = getMarketUpdatedAtMs(payload);
  const ageMs = now - updatedAtMs;
  if (ageMs > maxAgeMs) {
    throw new Error(`STALE_MARKET_DATA: feed is ${ageMs}ms old; maximum is ${maxAgeMs}ms`);
  }
  if (ageMs < -60_000) marketSchemaError("feed timestamp is more than 60 seconds in the future");

  if (!isRecord(payload.data)) marketSchemaError("data must be an object");
  const market = payload.data?.market;
  if (!isRecord(market)) marketSchemaError("data.market must be an object");
  const spotIndices = payload.data.spotIndices;
  if (!isRecord(spotIndices)) marketSchemaError("data.spotIndices must be an object");

  const options: MarketOption[] = [];
  const seenOptionLegIds = new Map<string, string>();
  const spot = Object.fromEntries(
    UNDERLYING_ASSETS.map((asset) => [
      asset,
      Number(spotIndices[asset] ?? spotIndices[asset.toLowerCase()] ?? 0)
    ])
  ) as Record<UnderlyingAsset, number>;

  for (const asset of UNDERLYING_ASSETS) {
    const assetData = market[asset];
    if (assetData === undefined) continue;
    if (!isRecord(assetData)) marketSchemaError(`data.market.${asset} must be an object`);
    if (!Array.isArray(assetData.expiries)) marketSchemaError(`data.market.${asset}.expiries must be an array`);
    const assetSpot = spotIndices[asset] ?? spotIndices[asset.toLowerCase()];
    spot[asset] = requireFiniteNumber(assetSpot, `data.spotIndices.${asset}`, { positive: true });
    const optionByExpiry = assetData?.options ?? {};
    if (!isRecord(optionByExpiry)) marketSchemaError(`data.market.${asset}.options must be an object`);
    for (const [expirySecStr, byType] of Object.entries(optionByExpiry)) {
      const expirySec = Number(expirySecStr);
      if (!Number.isSafeInteger(expirySec) || expirySec <= 0) {
        marketSchemaError(`data.market.${asset}.options expiry key must be a positive integer`);
      }
      if (!isRecord(byType)) marketSchemaError(`data.market.${asset}.options.${expirySecStr} must be an object`);
      const expiryCode = formatExpiry(expirySec);
      for (const optionType of ["Call", "Put"] as const) {
        const arr = optionType === "Call" ? byType.call : byType.put;
        if (!Array.isArray(arr)) {
          marketSchemaError(`data.market.${asset}.options.${expirySecStr}.${optionType.toLowerCase()} must be an array`);
        }
        for (let rowIndex = 0; rowIndex < arr.length; rowIndex++) {
          const row = arr[rowIndex];
          const rowPath = `data.market.${asset}.options.${expirySecStr}.${optionType.toLowerCase()}[${rowIndex}]`;
          if (!isRecord(row)) marketSchemaError(`${rowPath} must be an object`);
          if (typeof row.isOptionAvailable !== "boolean") {
            marketSchemaError(`${rowPath}.isOptionAvailable must be boolean`);
          }
          const isAvailable = row.isOptionAvailable;
          if (!isAvailable) continue;
          const mark = requireFiniteNumber(row.markPrice, `${rowPath}.markPrice`);
          if (mark < 0) continue;
          const rpBuy = requireFiniteNumber(row.riskPremiumRateForBuy, `${rowPath}.riskPremiumRateForBuy`);
          const rpSell = requireFiniteNumber(row.riskPremiumRateForSell, `${rowPath}.riskPremiumRateForSell`);
          if (rpBuy < 0) marketSchemaError(`${rowPath} risk premium rate for buy must be >= 0`);
          if (rpSell < 0) marketSchemaError(`${rowPath} risk premium rate for sell must be >= 0`);
          const strike = requireFiniteNumber(row.strikePrice, `${rowPath}.strikePrice`, { positive: true, integer: true });
          if (typeof row.optionId !== "string" || !/^(0x[0-9a-fA-F]+|[1-9]\d*)$/.test(row.optionId)) {
            marketSchemaError(`${rowPath}.optionId must be a positive integer string`);
          }
          const optionId = row.optionId;
          if (typeof row.instrument !== "string" || !row.instrument) {
            marketSchemaError(`${rowPath}.instrument must be a non-empty string`);
          }
          const instrument = row.instrument;
          const expectedInstrumentSuffix = `-${optionSuffix(optionType)}`;
          if (!instrument.toUpperCase().endsWith(expectedInstrumentSuffix)) {
            throw new Error(
              `MARKET_DATA_OPTION_SIDE_MISMATCH: ${rowPath}.instrument ${instrument} conflicts with ` +
              `${optionType.toLowerCase()} bucket`
            );
          }
          const rowExpiry = requireFiniteNumber(row.expiry, `${rowPath}.expiry`, { positive: true, integer: true });
          if (rowExpiry !== expirySec) marketSchemaError(`${rowPath}.expiry does not match its expiry bucket`);

          const parsed = parseOptionTokenId(optionId);
          const expectedAssetIndex = CONFIG.UNDERLYINGS[asset].index;
          if (
            parsed.underlyingAssetIndex !== expectedAssetIndex ||
            parsed.expirySec !== expirySec ||
            parsed.strikePrice !== strike
          ) {
            throw new Error(
              `MARKET_DATA_TOKEN_MISMATCH: ${rowPath}.optionId encodes asset/expiry/strike ` +
              `${parsed.underlyingAssetIndex}/${parsed.expirySec}/${parsed.strikePrice}, expected ` +
              `${expectedAssetIndex}/${expirySec}/${strike}`
            );
          }

          const optionLegKey = `${optionType}:${BigInt(optionId).toString()}`;
          const duplicatePath = seenOptionLegIds.get(optionLegKey);
          if (duplicatePath) {
            throw new Error(
              `MARKET_DATA_OPTION_ID_COLLISION: ${rowPath} and ${duplicatePath} reuse ` +
              `${optionType.toLowerCase()} option ID ${optionId}`
            );
          }
          seenOptionLegIds.set(optionLegKey, rowPath);

          const ivRaw = Number(row.impliedVolatility ?? row.iv ?? row.markIv ?? row.markIV ?? row.sigma ?? 0);
          const iv = ivRaw > 0 ? Math.round(ivRaw * 10000) / 100 : null; // store as percentage
          const bid = Math.max(0, mark * (1 - rpSell));
          const ask = mark * (1 + rpBuy);
          if (!Number.isFinite(bid) || bid < 0) {
            marketSchemaError(`${rowPath} derived bid must be finite and >= 0`);
          }
          if (!Number.isFinite(ask) || ask < 0) {
            marketSchemaError(`${rowPath} derived ask must be finite and >= 0`);
          }

          options.push({
            instrument,
            optionId,
            strikePrice: strike,
            markPrice: mark,
            bid,
            ask,
            riskPremiumRateForBuy: rpBuy,
            riskPremiumRateForSell: rpSell,
            underlying: asset,
            optionType,
            expirySec,
            expiryCode,
            isAvailable,
            iv
          });
        }
      }
    }
  }

  marketCache = { tsMs: now, updatedAtMs, options, spot };
  return { options, spot };
}

export async function getOptionChains(params: {
  underlyingAsset: string;
  optionType?: string;
  expiryDate?: string;
  maxExpiries?: number;
  maxStrikes?: number;
}) {
  const underlying = normalizeAsset(params.underlyingAsset);
  if (!underlying) {
    throw new Error(`Unsupported asset: ${params.underlyingAsset}`);
  }
  const optType = normalizeOptionSide(params.optionType);
  const expiryFilter = params.expiryDate?.trim().toUpperCase();
  const maxExpiries = Math.max(1, Math.min(5, params.maxExpiries ?? 1));
  const maxStrikes = Math.max(2, Math.min(30, params.maxStrikes ?? 8));

  const snapshot = await getMarketSnapshot();
  const filtered = snapshot.options.filter((o) =>
    o.underlying === underlying &&
    o.isAvailable &&
    (!optType || o.optionType === optType) &&
    (!expiryFilter || o.expiryCode === expiryFilter)
  );

  const expiryCodes = [...new Set(filtered.map((o) => o.expiryCode))]
    .sort((a, b) => {
      const aSec = filtered.find((o) => o.expiryCode === a)?.expirySec ?? 0;
      const bSec = filtered.find((o) => o.expiryCode === b)?.expirySec ?? 0;
      return aSec - bSec;
    })
    .slice(0, maxExpiries);

  const output: Record<string, { call: any[]; put: any[] }> = {};
  for (const code of expiryCodes) {
    const items = filtered.filter((o) => o.expiryCode === code);
    const calls = items.filter((o) => o.optionType === "Call").sort((a, b) => a.strikePrice - b.strikePrice).slice(0, maxStrikes);
    const puts = items.filter((o) => o.optionType === "Put").sort((a, b) => a.strikePrice - b.strikePrice).slice(0, maxStrikes);
    output[code] = {
      call: calls.map((o) => [o.strikePrice, o.markPrice, o.bid, o.ask, o.optionId, o.instrument, o.iv]),
      put: puts.map((o) => [o.strikePrice, o.markPrice, o.bid, o.ask, o.optionId, o.instrument, o.iv])
    };
  }

  if (expiryFilter && !output[expiryFilter]) {
    const available = [...new Set(filtered.map((o) => o.expiryCode))].sort();
    throw new Error(`Expiry ${expiryFilter} not found. Available: ${available.join(", ")}`);
  }

  return {
    asset: underlying,
    spot_price: snapshot.spot[underlying],
    expiries: output
  };
}

function mapAssetIndexToUnderlying(index: number): UnderlyingAsset | null {
  return UNDERLYING_ASSETS.find((asset) => CONFIG.UNDERLYINGS[asset].index === index) ?? null;
}

function minSpreadValueForAsset(asset: UnderlyingAsset): number {
  if (asset === "BTC") return 60;
  if (asset === "ETH") return 3;
  return 0.01;
}

async function findOptionById(optionId: string, optionType: OptionSide): Promise<MarketOption | null> {
  const snapshot = await getMarketSnapshot();
  const numericOptionId = BigInt(optionId);
  return snapshot.options.find(
    (o) => o.optionType === optionType && BigInt(o.optionId) === numericOptionId
  ) ?? null;
}

export async function validateSpread(strategy: SpreadStrategy, longLegId: string, shortLegId: string) {
  const strategyOptionType: OptionSide = strategy.includes("Call") ? "Call" : "Put";
  const long = await findOptionById(longLegId, strategyOptionType);
  const short = await findOptionById(shortLegId, strategyOptionType);

  if (!long || !short) {
    throw new Error("One or both leg IDs are not found in current market data.");
  }

  if (!long.isAvailable || !short.isAvailable) {
    throw new Error("One or both legs are currently unavailable.");
  }

  const longParsed = parseOptionTokenId(long.optionId);
  const shortParsed = parseOptionTokenId(short.optionId);

  if (longParsed.underlyingAssetIndex !== shortParsed.underlyingAssetIndex) {
    throw new Error("Legs must have the same underlying asset.");
  }
  if (longParsed.expirySec !== shortParsed.expirySec) {
    throw new Error("Legs must have the same expiry.");
  }

  const underlying = mapAssetIndexToUnderlying(longParsed.underlyingAssetIndex);
  if (!underlying) throw new Error("Unsupported underlying asset index.");

  if (long.optionType !== strategyOptionType || short.optionType !== strategyOptionType) {
    throw new Error(`Both legs must be ${strategyOptionType} options for ${strategy}.`);
  }

  if (strategyOptionType === "Call" && long.strikePrice >= short.strikePrice) {
    throw new Error("Call spread requires long strike < short strike.");
  }
  if (strategyOptionType === "Put" && long.strikePrice <= short.strikePrice) {
    throw new Error("Put spread requires long strike > short strike.");
  }

  const spreadCost = long.markPrice - short.markPrice;
  const minSpread = minSpreadValueForAsset(underlying);
  if (spreadCost < minSpread) {
    throw new Error(`Spread cost too low: ${spreadCost.toFixed(2)} < ${minSpread}`);
  }

  return {
    status: "Valid",
    details: {
      asset: underlying,
      option_type: strategyOptionType,
      expiry_code: long.expiryCode,
      long_leg: {
        option_id: long.optionId,
        instrument: long.instrument,
        strike: long.strikePrice,
        mark_price: long.markPrice,
        risk_premium_rate_for_buy: long.riskPremiumRateForBuy,
        risk_premium_rate_for_sell: long.riskPremiumRateForSell
      },
      short_leg: {
        option_id: short.optionId,
        instrument: short.instrument,
        strike: short.strikePrice,
        mark_price: short.markPrice,
        risk_premium_rate_for_buy: short.riskPremiumRateForBuy,
        risk_premium_rate_for_sell: short.riskPremiumRateForSell
      },
      spread_cost: spreadCost,
      strike_diff: Math.abs(long.strikePrice - short.strikePrice),
      spot_price: (await getMarketSnapshot()).spot[underlying]
    }
  };
}

export function calculateSpreadOpenQuote(params: {
  strategy: SpreadStrategy;
  size: number;
  spotPrice: number;
  spreadMarkPrice: number;
  strikeDiff: number;
  longRiskPremiumRateForBuy: number;
  longRiskPremiumRateForSell: number;
  shortRiskPremiumRateForBuy: number;
  shortRiskPremiumRateForSell: number;
}) {
  for (const [name, value] of Object.entries(params)) {
    if (name === "strategy") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a finite non-negative number`);
    }
  }
  if (params.size <= 0) throw new Error("size must be > 0");
  if (params.spotPrice <= 0) throw new Error("spotPrice must be > 0");
  if (params.spreadMarkPrice <= 0) throw new Error("spreadMarkPrice must be > 0");
  if (params.strikeDiff <= 0) throw new Error("strikeDiff must be > 0");

  const isBuy = params.strategy.startsWith("Buy");
  const riskPremiumRate = isBuy
    ? Math.max(params.longRiskPremiumRateForBuy, params.shortRiskPremiumRateForSell)
    : Math.max(params.longRiskPremiumRateForSell, params.shortRiskPremiumRateForBuy);
  const estimatedExecutionPrice = params.spreadMarkPrice * Math.max(0, isBuy ? 1 + riskPremiumRate : 1 - riskPremiumRate);
  const executionPremium = estimatedExecutionPrice * params.size;
  const notionalFee = params.spotPrice * params.size * OPEN_COMBO_POSITION_FEE_RATE;
  const premiumFeeCap = executionPremium * TRADE_FEE_CALCULATION_LIMIT_RATE;
  const estimatedOpenFeeUsdc = Math.min(notionalFee, premiumFeeCap);
  const amountInUsdc = (isBuy ? executionPremium : params.strikeDiff * params.size) + estimatedOpenFeeUsdc;

  return {
    pricing_model: "spread-risk-premium-plus-protocol-fee-v1",
    risk_premium_rate: riskPremiumRate,
    estimated_execution_price: estimatedExecutionPrice,
    estimated_open_fee_usdc: estimatedOpenFeeUsdc,
    amount_in_usdc: amountInUsdc
  };
}

function getProvider(options: { unbatchedRpc?: boolean } = {}) {
  const timeoutMs = readIntegerEnv(
    "CALLPUT_RPC_TIMEOUT_MS",
    DEFAULT_RPC_TIMEOUT_MS,
    25,
    HARD_MAX_NETWORK_TIMEOUT_MS
  );
  const request = new ethers.FetchRequest(CONFIG.RPC_URL);
  request.timeout = timeoutMs;
  return new ethers.JsonRpcProvider(request, CONFIG.CHAIN_ID, {
    staticNetwork: true,
    ...(options.unbatchedRpc ? { batchMaxCount: 1 } : {})
  });
}

const validatedNetworkCache = new Map<string, Promise<void>>();

async function getValidatedProvider(options: { unbatchedRpc?: boolean } = {}): Promise<ethers.JsonRpcProvider> {
  const key = [
    CONFIG.RPC_URL,
    process.env.CALLPUT_RPC_TIMEOUT_MS ?? "",
    options.unbatchedRpc ? "unbatched" : "batched"
  ].join(":");
  const provider = getProvider(options);
  let validation = validatedNetworkCache.get(key);
  if (!validation) {
    validation = (async () => {
      const chainId = BigInt(await provider.send("eth_chainId", []));
      if (chainId !== BigInt(CONFIG.CHAIN_ID)) {
        throw new Error(`RPC provider is on chain ${chainId}, expected Base (${CONFIG.CHAIN_ID})`);
      }
    })().catch((error) => {
      if (validatedNetworkCache.get(key) === validation) validatedNetworkCache.delete(key);
      throw error;
    });
    validatedNetworkCache.set(key, validation);
  }
  if (validatedNetworkCache.size > 8) {
    const oldest = validatedNetworkCache.keys().next().value;
    if (oldest && oldest !== key) validatedNetworkCache.delete(oldest);
  }
  await validation;
  return provider;
}

function statusFromRaw(raw: number): "pending" | "cancelled" | "executed" {
  if (raw === 2) return "executed";
  if (raw === 1) return "cancelled";
  return "pending";
}

async function getExecutionFee(contract: ethers.Contract): Promise<bigint> {
  let executionFee: bigint;
  try {
    executionFee = (await contract.executionFee()) as bigint;
  } catch {
    executionFee = CONFIG.EXECUTION_FEE_FALLBACK;
  }
  const maximum = getMaxExecutionFeeWei();
  if (executionFee > maximum) {
    throw new Error(`EXECUTION_FEE_LIMIT: ${executionFee.toString()} wei exceeds configured maximum ${maximum.toString()} wei`);
  }
  return executionFee;
}

function toDecimalString(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: decimals
  });
}

function toSizeRaw(size: number, asset: UnderlyingAsset): bigint {
  if (!Number.isFinite(size) || size <= 0) throw new Error("size must be > 0");
  const decimals = CONFIG.UNDERLYINGS[asset].decimals;
  const parsed = ethers.parseUnits(toDecimalString(size, decimals), decimals);
  if (parsed <= 0n) throw new Error("size too small after decimal scaling");
  return parsed;
}

function toUsdcRaw(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error("amount_in must be > 0");
  const parsed = ethers.parseUnits(toDecimalString(value, CONFIG.ASSETS.USDC.decimals), CONFIG.ASSETS.USDC.decimals);
  if (parsed <= 0n) throw new Error("USDC amount too small after decimal scaling");
  return parsed;
}

async function checkAllowance(
  fromAddress: string,
  amountIn: bigint
): Promise<{ sufficient: boolean; current_allowance: string; required: string; approve_tx?: { to: string; data: string; value: string; chain_id: number } }> {
  const provider = await getValidatedProvider();
  const usdc = new ethers.Contract(CONFIG.CONTRACTS.USDC, ERC20_ABI, provider);
  const allowance = (await usdc.allowance(fromAddress, CONFIG.CONTRACTS.ROUTER)) as bigint;
  if (allowance >= amountIn) {
    return { sufficient: true, current_allowance: allowance.toString(), required: amountIn.toString() };
  }
  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData("approve", [CONFIG.CONTRACTS.ROUTER, amountIn]);
  return {
    sufficient: false,
    current_allowance: allowance.toString(),
    required: amountIn.toString(),
    approve_tx: { to: CONFIG.CONTRACTS.USDC, data, value: "0", chain_id: CONFIG.CHAIN_ID }
  };
}

export function transactionIntentFingerprint(tx: {
  chainId: string | number | bigint;
  from: string;
  to: string;
  value: string | number | bigint;
  data: string;
}): string {
  return createHash("sha256")
    .update([tx.chainId, tx.from, tx.to, tx.value, tx.data].map(String).join(":").toLowerCase())
    .digest("hex");
}

type RequestKeyResult = { request_key: string; is_open: boolean };

function extractRequestKey(
  receipt: ethers.TransactionReceipt,
  expectedAccount: string,
  expectedKey?: string
): RequestKeyResult | null {
  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  for (const log of receipt.logs) {
    if (ethers.getAddress(log.address) !== ethers.getAddress(CONFIG.CONTRACTS.POSITION_MANAGER)) continue;
    try {
      const parsed = iface.parseLog(log);
      if (
        parsed &&
        parsed.name === "GenerateRequestKey" &&
        ethers.getAddress(String(parsed.args.account)) === ethers.getAddress(expectedAccount) &&
        (expectedKey === undefined || String(parsed.args.key).toLowerCase() === expectedKey.toLowerCase())
      ) {
        return {
          request_key: String(parsed.args.key),
          is_open: Boolean(parsed.args.isOpen)
        };
      }
    } catch {
      // ignore non-matching logs
    }
  }
  return null;
}

async function inspectRequestTransaction(
  provider: ethers.JsonRpcProvider,
  txHash: string,
  expectedAccount?: string,
  expectedKey?: string
): Promise<{ result: RequestKeyResult; transaction: ethers.TransactionResponse } | { error: string }> {
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash)
  ]);
  if (!transaction) return { error: `Transaction not found for ${txHash}` };
  if (!receipt) return { error: `Transaction receipt not found for ${txHash}` };
  if (receipt.status !== 1) return { error: `Transaction ${txHash} did not succeed` };
  if (transaction.chainId !== BigInt(CONFIG.CHAIN_ID)) return { error: `Transaction ${txHash} is on the wrong chain` };
  if (!transaction.to || ethers.getAddress(transaction.to) !== ethers.getAddress(CONFIG.CONTRACTS.POSITION_MANAGER)) {
    return { error: `Transaction ${txHash} was not sent to PositionManager` };
  }
  if (!receipt.to || ethers.getAddress(receipt.to) !== ethers.getAddress(CONFIG.CONTRACTS.POSITION_MANAGER)) {
    return { error: `Transaction receipt ${txHash} is not for PositionManager` };
  }
  if (ethers.getAddress(receipt.from) !== ethers.getAddress(transaction.from)) {
    return { error: `Transaction receipt ${txHash} sender does not match its transaction` };
  }
  if (expectedAccount && ethers.getAddress(transaction.from) !== ethers.getAddress(expectedAccount)) {
    return { error: `Transaction ${txHash} was sent by a different wallet` };
  }
  const result = extractRequestKey(receipt, transaction.from, expectedKey);
  if (!result) return { error: "Verified GenerateRequestKey event not found in transaction logs" };
  return { result, transaction };
}

export async function getRequestKeyFromTx(
  txHash: string,
  expectedAccount?: string
): Promise<RequestKeyResult | { error: string }> {
  const provider = await getValidatedProvider();
  if (expectedAccount && !ethers.isAddress(expectedAccount)) return { error: `Invalid address: ${expectedAccount}` };
  const inspected = await inspectRequestTransaction(provider, txHash, expectedAccount);
  return "error" in inspected ? inspected : inspected.result;
}

function getBoundedIntentReconcileFromBlock(requestedFromBlock: number | undefined, latestBlock: number): number {
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) throw new Error(`Invalid latest block: ${latestBlock}`);
  if (
    requestedFromBlock !== undefined &&
    (!Number.isSafeInteger(requestedFromBlock) || requestedFromBlock < 0 || requestedFromBlock > latestBlock)
  ) {
    throw new Error(`fromBlock must be an integer between 0 and latest block ${latestBlock}`);
  }
  const maxLookback = readIntegerEnv(
    "CALLPUT_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS",
    DEFAULT_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS,
    1,
    HARD_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS
  );
  const defaultFromBlock = Math.max(0, latestBlock - DEFAULT_INTENT_RECONCILE_LOOKBACK_BLOCKS);
  const minimumAllowedFromBlock = Math.max(0, latestBlock - maxLookback);
  return Math.max(requestedFromBlock ?? defaultFromBlock, minimumAllowedFromBlock);
}

export async function findRequestKeyByIntentFingerprint(params: {
  address: string;
  intentFingerprint: string;
  fromBlock?: number;
}): Promise<(RequestKeyResult & { tx_hash: string; from_block: number; to_block: number }) | null> {
  if (!ethers.isAddress(params.address)) throw new Error(`Invalid address: ${params.address}`);
  if (!/^[0-9a-f]{64}$/.test(params.intentFingerprint)) throw new Error("Invalid intent fingerprint");
  const account = ethers.getAddress(params.address);
  const provider = await getValidatedProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = getBoundedIntentReconcileFromBlock(params.fromBlock, latestBlock);
  const pm = new ethers.Contract(CONFIG.CONTRACTS.POSITION_MANAGER, POSITION_MANAGER_ABI, provider);
  const logs = await queryFilterInChunks(pm, pm.filters.GenerateRequestKey(account), fromBlock, latestBlock);

  for (const candidate of [...logs].reverse()) {
    if (ethers.getAddress(candidate.address) !== ethers.getAddress(CONFIG.CONTRACTS.POSITION_MANAGER)) continue;
    const event = candidate as ethers.EventLog;
    const key = String(event.args.key);
    const inspected = await inspectRequestTransaction(provider, event.transactionHash, account, key);
    if ("error" in inspected) continue;
    const transaction = inspected.transaction;
    const fingerprint = transactionIntentFingerprint({
      chainId: transaction.chainId,
      from: transaction.from,
      to: transaction.to!,
      value: transaction.value,
      data: transaction.data
    });
    if (fingerprint === params.intentFingerprint) {
      return {
        ...inspected.result,
        tx_hash: event.transactionHash,
        from_block: fromBlock,
        to_block: latestBlock
      };
    }
  }
  return null;
}

export async function checkRequestStatus(requestKey: string, isOpen: boolean) {
  const provider = await getValidatedProvider();
  const pm = new ethers.Contract(CONFIG.CONTRACTS.POSITION_MANAGER, POSITION_MANAGER_ABI, provider);

  const req: any = isOpen
    ? await pm.openPositionRequests(requestKey)
    : await pm.closePositionRequests(requestKey);

  // Extract account safely from struct response
  const account: string = String(req.account || (Array.isArray(req) && req[0]) || "");
  if (!account || account.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    return {
      status: "not_found",
      request_key: requestKey
    };
  }

  // Extract status safely from struct response
  const statusRaw = Number(req.status || (Array.isArray(req) && req[9]) || 0);
  const status = statusFromRaw(statusRaw);

  const result: Record<string, unknown> = {
    request_key: requestKey,
    status,
    account
  };

  if (isOpen) {
    // OpenPositionRequest: sizeOut at req[10], executionPrice at req[11]
    result.size_out = String(req.sizeOut || (Array.isArray(req) && req[10]) || "0");
    result.execution_price = String(req.executionPrice || (Array.isArray(req) && req[11]) || "0");
  } else {
    // ClosePositionRequest: amountOut at req[10], executionPrice at req[11]
    result.amount_out = String(req.amountOut || (Array.isArray(req) && req[10]) || "0");
    result.execution_price = String(req.executionPrice || (Array.isArray(req) && req[11]) || "0");
  }
  return result;
}

export async function executeSpread(params: {
  strategy: SpreadStrategy;
  fromAddress: string;
  longLegId: string;
  shortLegId: string;
  size: number;
  minFillRatio?: number;
}) {
  if (!ethers.isAddress(params.fromAddress)) throw new Error(`Invalid fromAddress: ${params.fromAddress}`);

  // Validate option IDs are decimal or 0x-prefixed hex strings before converting to BigInt.
  const optionIdPattern = /^(0x[0-9a-fA-F]+|\d+)$/;
  if (!optionIdPattern.test(params.longLegId)) throw new Error(`Invalid option ID format (long leg): ${params.longLegId}`);
  if (!optionIdPattern.test(params.shortLegId)) throw new Error(`Invalid option ID format (short leg): ${params.shortLegId}`);

  const validation = await validateSpread(params.strategy, params.longLegId, params.shortLegId);
  const details: any = validation.details;

  const isBuy = params.strategy.startsWith("Buy");
  const asset = details.asset as UnderlyingAsset;
  const underlyingDecimals = CONFIG.UNDERLYINGS[asset].decimals;

  const spreadCost = Number(details.spread_cost);
  const strikeDiff = Number(details.strike_diff);
  const openQuote = calculateSpreadOpenQuote({
    strategy: params.strategy,
    size: params.size,
    spotPrice: Number(details.spot_price),
    spreadMarkPrice: spreadCost,
    strikeDiff,
    longRiskPremiumRateForBuy: Number(details.long_leg.risk_premium_rate_for_buy),
    longRiskPremiumRateForSell: Number(details.long_leg.risk_premium_rate_for_sell),
    shortRiskPremiumRateForBuy: Number(details.short_leg.risk_premium_rate_for_buy),
    shortRiskPremiumRateForSell: Number(details.short_leg.risk_premium_rate_for_sell)
  });
  const amountInUsdc = openQuote.amount_in_usdc;
  const amountIn = toUsdcRaw(amountInUsdc);

  const sizeRaw = toSizeRaw(params.size, asset);
  const minFillRatio = Math.max(0.01, Math.min(1, params.minFillRatio ?? DEFAULT_MIN_FILL_RATIO));
  const minSize = (sizeRaw * BigInt(Math.floor(minFillRatio * 10_000))) / 10_000n;

  const isCall = params.strategy.includes("Call");
  const isBuys: [boolean, boolean, boolean, boolean] = [isBuy, !isBuy, false, false];
  const isCalls: [boolean, boolean, boolean, boolean] = [isCall, isCall, false, false];
  const optionIds: [string, string, string, string] = [
    ethers.zeroPadValue(ethers.toBeHex(BigInt(params.longLegId)), 32),
    ethers.zeroPadValue(ethers.toBeHex(BigInt(params.shortLegId)), 32),
    ethers.ZeroHash,
    ethers.ZeroHash
  ];

  const underlyingIndex = CONFIG.UNDERLYINGS[asset].index;
  const path = [CONFIG.CONTRACTS.USDC];
  const length = 2;

  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  const data = iface.encodeFunctionData("createOpenPosition", [
    underlyingIndex,
    length,
    isBuys,
    optionIds,
    isCalls,
    minSize,
    path,
    amountIn,
    0,
    ethers.ZeroAddress
  ]);

  const provider = await getValidatedProvider();
  const pmRead = new ethers.Contract(CONFIG.CONTRACTS.POSITION_MANAGER, POSITION_MANAGER_ABI, provider);
  const executionFee = await getExecutionFee(pmRead);
  const allowanceInfo = await checkAllowance(params.fromAddress, amountIn);

  const nextSteps = allowanceInfo.sufficient
    ? ["1. Sign and broadcast unsigned_tx", "2. Call callput_get_request_key_from_tx(tx_hash)", "3. Poll callput_check_request_status(request_key, is_open=true)"]
    : ["1. Sign and broadcast usdc_approval.approve_tx first", "2. Sign and broadcast unsigned_tx", "3. Call callput_get_request_key_from_tx(tx_hash)", "4. Poll callput_check_request_status(request_key, is_open=true)"];

  return {
    validation,
    unsigned_tx: {
      to: CONFIG.CONTRACTS.POSITION_MANAGER,
      data,
      value: executionFee.toString(),
      chain_id: CONFIG.CHAIN_ID,
      from: ethers.getAddress(params.fromAddress)
    },
    usdc_approval: allowanceInfo,
    quote: {
      strategy: params.strategy,
      size: params.size,
      size_raw: sizeRaw.toString(),
      min_fill_ratio: minFillRatio,
      min_size_raw: minSize.toString(),
      amount_in_usdc: amountInUsdc,
      amount_in_raw: amountIn.toString(),
      underlying_decimals: underlyingDecimals,
      pricing_model: openQuote.pricing_model,
      risk_premium_rate: openQuote.risk_premium_rate,
      estimated_execution_price: openQuote.estimated_execution_price,
      estimated_open_fee_usdc: openQuote.estimated_open_fee_usdc
    },
    next_steps: nextSteps
  };
}

export async function closePosition(params: {
  underlyingAsset: string;
  fromAddress: string;
  optionTokenId: string;
  size: number;
  minAmountOutRaw?: string;
  minOutWhenSwapRaw?: string;
}) {
  if (!ethers.isAddress(params.fromAddress)) throw new Error(`Invalid fromAddress: ${params.fromAddress}`);
  const account = ethers.getAddress(params.fromAddress);
  const asset = normalizeAsset(params.underlyingAsset);
  if (!asset) throw new Error(`Unsupported asset: ${params.underlyingAsset}`);

  const tokenId = parsePositiveTokenId(params.optionTokenId);
  const decoded = decodeSpreadTokenId(tokenId.toString());
  if (decoded.underlying !== asset) {
    throw new Error(`Requested asset ${asset} does not match token asset ${decoded.underlying ?? "UNKNOWN"}`);
  }
  if (decoded.expirySec <= Math.floor(Date.now() / 1000)) {
    throw new Error(`Position already expired at ${decoded.expiryCode}; use settlement instead`);
  }

  const minAmountOut = parsePositiveRawAmount(params.minAmountOutRaw, "minAmountOutRaw");
  const minOutWhenSwap = parsePositiveRawAmount(params.minOutWhenSwapRaw, "minOutWhenSwapRaw");
  const sizeRaw = toSizeRaw(params.size, asset);
  const path = [CONFIG.CONTRACTS.USDC];
  const underlyingIndex = CONFIG.UNDERLYINGS[asset].index;

  const provider = await getValidatedProvider();
  const token = new ethers.Contract(CONFIG.UNDERLYINGS[asset].optionsToken, OPTIONS_TOKEN_ABI, provider);
  const pmRead = new ethers.Contract(CONFIG.CONTRACTS.POSITION_MANAGER, POSITION_MANAGER_ABI, provider);
  const controller = ethers.getAddress(await pmRead.controller());
  const [positionBalance, operatorApproved] = await Promise.all([
    token.balanceOfBatch([account], [tokenId]).then((balances: bigint[]) => balances[0] ?? 0n),
    token.isApprovedForAll(account, controller) as Promise<boolean>
  ]);
  if (positionBalance < sizeRaw) {
    throw new Error(`Wallet has insufficient position balance: ${positionBalance.toString()} < ${sizeRaw.toString()}`);
  }

  const iface = new ethers.Interface(POSITION_MANAGER_ABI);
  const data = iface.encodeFunctionData("createClosePosition", [
    underlyingIndex,
    tokenId,
    sizeRaw,
    path,
    minAmountOut,
    minOutWhenSwap,
    false
  ]);

  const executionFee = await getExecutionFee(pmRead);
  const approvalData = new ethers.Interface(OPTIONS_TOKEN_ABI).encodeFunctionData("setApprovalForAll", [controller, true]);

  return {
    unsigned_tx: {
      to: CONFIG.CONTRACTS.POSITION_MANAGER,
      data,
      value: executionFee.toString(),
      chain_id: CONFIG.CHAIN_ID,
      from: account
    },
    position_token_approval: {
      sufficient: operatorApproved,
      token: CONFIG.UNDERLYINGS[asset].optionsToken,
      operator: controller,
      approve_tx: operatorApproved ? null : {
        to: CONFIG.UNDERLYINGS[asset].optionsToken,
        data: approvalData,
        value: "0",
        chain_id: CONFIG.CHAIN_ID,
        from: account
      }
    },
    close: {
      asset,
      option_token_id: params.optionTokenId,
      size: params.size,
      size_raw: sizeRaw.toString(),
      min_amount_out_raw: minAmountOut.toString(),
      min_out_when_swap_raw: minOutWhenSwap.toString()
    },
    next_steps: [
      operatorApproved ? "1. Sign and broadcast unsigned_tx" : "1. Sign and broadcast position_token_approval.approve_tx, then rebuild and verify approval",
      "2. Call callput_get_request_key_from_tx(tx_hash)",
      "3. Poll callput_check_request_status(request_key, is_open=false)"
    ]
  };
}

export async function settlePosition(params: {
  underlyingAsset: string;
  optionTokenId: string;
  fromAddress?: string;
  minOutWhenSwapRaw?: string;
}) {
  if (!params.fromAddress) throw new Error("fromAddress is required to verify position ownership");
  if (!ethers.isAddress(params.fromAddress)) throw new Error(`Invalid fromAddress: ${params.fromAddress}`);
  const account = ethers.getAddress(params.fromAddress);
  const asset = normalizeAsset(params.underlyingAsset);
  if (!asset) throw new Error(`Unsupported asset: ${params.underlyingAsset}`);
  const tokenId = parsePositiveTokenId(params.optionTokenId);
  const decoded = decodeSpreadTokenId(tokenId.toString());
  if (decoded.underlying !== asset) {
    throw new Error(`Requested asset ${asset} does not match token asset ${decoded.underlying ?? "UNKNOWN"}`);
  }
  if (decoded.expirySec > Math.floor(Date.now() / 1000)) {
    throw new Error(`Position has not expired yet (${decoded.expiryCode})`);
  }
  const minOutWhenSwap = parsePositiveRawAmount(params.minOutWhenSwapRaw, "minOutWhenSwapRaw");
  const provider = await getValidatedProvider();
  const token = new ethers.Contract(CONFIG.UNDERLYINGS[asset].optionsToken, OPTIONS_TOKEN_ABI, provider);
  const settleManager = new ethers.Contract(CONFIG.CONTRACTS.SETTLE_MANAGER, ["function controller() view returns (address)"], provider);
  const controller = ethers.getAddress(await settleManager.controller());
  const [[positionBalance], operatorApproved] = await Promise.all([
    token.balanceOfBatch([account], [tokenId]) as Promise<bigint[]>,
    token.isApprovedForAll(account, controller) as Promise<boolean>
  ]);
  if ((positionBalance ?? 0n) <= 0n) throw new Error("Wallet does not own position token");
  const underlyingIndex = CONFIG.UNDERLYINGS[asset].index;
  const path = [CONFIG.CONTRACTS.USDC];

  const iface = new ethers.Interface(SETTLE_MANAGER_ABI);
  const data = iface.encodeFunctionData("settlePosition", [
    path,
    underlyingIndex,
    tokenId,
    minOutWhenSwap,
    false
  ]);
  const approvalData = new ethers.Interface(OPTIONS_TOKEN_ABI).encodeFunctionData("setApprovalForAll", [controller, true]);

  return {
    unsigned_tx: {
      to: CONFIG.CONTRACTS.SETTLE_MANAGER,
      data,
      value: "0",
      chain_id: CONFIG.CHAIN_ID,
      from: account
    },
    position_token_approval: {
      sufficient: operatorApproved,
      token: CONFIG.UNDERLYINGS[asset].optionsToken,
      operator: controller,
      approve_tx: operatorApproved ? null : {
        to: CONFIG.UNDERLYINGS[asset].optionsToken,
        data: approvalData,
        value: "0",
        chain_id: CONFIG.CHAIN_ID,
        from: account
      }
    },
    settle: {
      asset,
      option_token_id: params.optionTokenId,
      min_out_when_swap_raw: minOutWhenSwap.toString()
    },
    next_steps: [
      "1. Sign and broadcast unsigned_tx",
      "2. Verify settlement via callput_portfolio_summary (position should disappear)",
      "3. Check callput_get_settled_pnl for realized payout"
    ]
  };
}

export type LifecyclePosition = {
  underlying: string;
  token_id: string;
  size: number;
  expiry_sec: number;
  [key: string]: unknown;
};

export function planPositionLifecycle<T extends LifecyclePosition>(positions: T[], nowSec = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) throw new Error(`Invalid lifecycle timestamp: ${nowSec}`);
  const normalized = positions.map((position) => ({ ...position, size: Math.abs(position.size) }));
  return {
    closable: normalized.filter((position) => position.expiry_sec > nowSec),
    settleable: normalized.filter((position) => position.expiry_sec <= nowSec)
  };
}

const MAX_LIFECYCLE_BATCH_POSITIONS = 25;
const BASE_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[])"
];

function assertLifecycleBatchSize(action: string, positions: LifecyclePosition[]): void {
  if (positions.length > MAX_LIFECYCLE_BATCH_POSITIONS) {
    throw new Error(`${action} exceeds maximum ${MAX_LIFECYCLE_BATCH_POSITIONS} positions; split the request into smaller reviewed batches`);
  }
}

export async function closeAllPositions(params: {
  fromAddress: string;
  minAmountOutRaw?: string;
  minOutWhenSwapRaw?: string;
}) {
  parsePositiveRawAmount(params.minAmountOutRaw, "minAmountOutRaw");
  parsePositiveRawAmount(params.minOutWhenSwapRaw, "minOutWhenSwapRaw");
  const positionData = await getPositions(params.fromAddress, { includeMarketData: false, multicallRpc: true });
  if (positionData.position_data_warning) {
    throw new Error(`INCOMPLETE_POSITION_DATA: close all requires every underlying lookup to succeed; ${positionData.position_data_warning}`);
  }
  const plan = planPositionLifecycle(positionData.positions as LifecyclePosition[]);
  assertLifecycleBatchSize("close all", plan.closable);
  const transactions = [];
  for (const position of plan.closable) {
    transactions.push(await closePosition({
      underlyingAsset: position.underlying,
      fromAddress: params.fromAddress,
      optionTokenId: position.token_id,
      size: position.size,
      minAmountOutRaw: params.minAmountOutRaw,
      minOutWhenSwapRaw: params.minOutWhenSwapRaw
    }));
  }
  return {
    action: "close_all",
    account: ethers.getAddress(params.fromAddress),
    eligible_count: transactions.length,
    skipped_count: plan.settleable.length,
    transactions,
    confirmation_mode: "one_bankr_review_per_transaction"
  };
}

export async function settleAllPositions(params: {
  fromAddress: string;
  minOutWhenSwapRaw?: string;
}) {
  parsePositiveRawAmount(params.minOutWhenSwapRaw, "minOutWhenSwapRaw");
  const positionData = await getPositions(params.fromAddress, { includeMarketData: false, multicallRpc: true });
  if (positionData.position_data_warning) {
    throw new Error(`INCOMPLETE_POSITION_DATA: settle all requires every underlying lookup to succeed; ${positionData.position_data_warning}`);
  }
  const plan = planPositionLifecycle(positionData.positions as LifecyclePosition[]);
  assertLifecycleBatchSize("settle all", plan.settleable);
  const transactions = [];
  for (const position of plan.settleable) {
    transactions.push(await settlePosition({
      underlyingAsset: position.underlying,
      fromAddress: params.fromAddress,
      optionTokenId: position.token_id,
      minOutWhenSwapRaw: params.minOutWhenSwapRaw
    }));
  }
  return {
    action: "settle_all",
    account: ethers.getAddress(params.fromAddress),
    eligible_count: transactions.length,
    skipped_count: plan.closable.length,
    transactions,
    confirmation_mode: "one_bankr_review_per_transaction"
  };
}

export async function getPositions(
  address: string,
  options: { includeMarketData?: boolean; unbatchedRpc?: boolean; multicallRpc?: boolean } = {}
) {
  const provider = await getValidatedProvider({ unbatchedRpc: options.unbatchedRpc });
  if (!ethers.isAddress(address)) throw new Error(`Invalid address: ${address}`);
  const account = ethers.getAddress(address);

  let snapshot: Awaited<ReturnType<typeof getMarketSnapshot>> | null = null;
  let marketDataWarning: string | null = null;
  if (options.includeMarketData !== false) {
    try {
      snapshot = await getMarketSnapshot();
    } catch (error) {
      marketDataWarning = error instanceof Error ? error.message : String(error);
    }
  }

  const buildAssetPositions = (
    asset: UnderlyingAsset,
    tokenIds: bigint[],
    balances: bigint[]
  ) => {
    const out: any[] = [];
    for (let i = 0; i < tokenIds.length; i++) {
      const bal = balances[i];
      if (bal === 0n) continue;

      const decoded = decodeSpreadTokenId(tokenIds[i].toString());
      const signed = decoded.isLong ? bal : -bal;
      const size = Number(signed) / 10 ** CONFIG.UNDERLYINGS[asset].decimals;
      const matched = snapshot?.options.find((o) =>
        o.underlying === asset &&
        o.expirySec === decoded.expirySec &&
        Math.trunc(o.strikePrice) === Math.trunc(decoded.nakedStrike) &&
        o.optionType === decoded.optionType
      );

      out.push({
        underlying: asset,
        token_id: tokenIds[i].toString(),
        side: decoded.isLong ? "long" : "short",
        size,
        raw_balance: bal.toString(),
        instrument: matched?.instrument ?? null,
        strike: decoded.nakedStrike,
        pair_strike: decoded.pairStrike || null,
        expiry_code: decoded.expiryCode,
        expiry_sec: decoded.expirySec,
        lifecycle: decoded.expirySec <= Math.floor(Date.now() / 1000) ? "settleable" : "closable",
        option_type: decoded.optionType,
        mark_price: matched?.markPrice ?? null
      });
    }
    return out;
  };
  const positionsByAsset: any[][] = [];
  const positionDataWarnings: string[] = [];
  const tokenInterface = new ethers.Interface(OPTIONS_TOKEN_ABI);

  if (options.multicallRpc) {
    const configuredAssets = UNDERLYING_ASSETS.filter((asset) => CONFIG.UNDERLYINGS[asset].optionsToken);
    const multicall = new ethers.Contract(BASE_MULTICALL3, MULTICALL3_ABI, provider);
    const tokenResults = await multicall.aggregate3.staticCall(configuredAssets.map((asset) => ({
      target: CONFIG.UNDERLYINGS[asset].optionsToken,
      allowFailure: true,
      callData: tokenInterface.encodeFunctionData("tokensByAccount", [account])
    })));
    const assetsWithTokens: Array<{ asset: UnderlyingAsset; tokenIds: bigint[] }> = [];
    for (let index = 0; index < configuredAssets.length; index++) {
      const result = tokenResults[index];
      const asset = configuredAssets[index];
      if (!result.success) {
        positionDataWarnings.push(`${asset}: tokensByAccount failed`);
        continue;
      }
      const decoded = tokenInterface.decodeFunctionResult("tokensByAccount", result.returnData)[0];
      const tokenIds = Array.from(decoded, (value) => BigInt(String(value)));
      if (tokenIds.length) assetsWithTokens.push({ asset, tokenIds });
    }
    if (assetsWithTokens.length) {
      const balanceResults = await multicall.aggregate3.staticCall(assetsWithTokens.map(({ asset, tokenIds }) => ({
        target: CONFIG.UNDERLYINGS[asset].optionsToken,
        allowFailure: true,
        callData: tokenInterface.encodeFunctionData("balanceOfBatch", [tokenIds.map(() => account), tokenIds])
      })));
      for (let index = 0; index < assetsWithTokens.length; index++) {
        const { asset, tokenIds } = assetsWithTokens[index];
        const result = balanceResults[index];
        if (!result.success) {
          positionDataWarnings.push(`${asset}: balanceOfBatch failed`);
          continue;
        }
        const decoded = tokenInterface.decodeFunctionResult("balanceOfBatch", result.returnData)[0];
        const balances = Array.from(decoded, (value) => BigInt(String(value)));
        positionsByAsset.push(buildAssetPositions(asset, tokenIds, balances));
      }
    }
  } else {
    const readAssetPositions = async (asset: UnderlyingAsset) => {
      const tokenAddress = CONFIG.UNDERLYINGS[asset].optionsToken;
      if (!tokenAddress) return [];
      const token = new ethers.Contract(tokenAddress, OPTIONS_TOKEN_ABI, provider);
      const tokenIds = Array.from(await token.tokensByAccount(account), (value) => BigInt(String(value)));
      if (!tokenIds.length) return [];
      const balances = Array.from(
        await token.balanceOfBatch(tokenIds.map(() => account), tokenIds),
        (value) => BigInt(String(value))
      );
      return buildAssetPositions(asset, tokenIds, balances);
    };
    const positionLookupBatchSize = 8;
    for (let offset = 0; offset < UNDERLYING_ASSETS.length; offset += positionLookupBatchSize) {
      const assets = UNDERLYING_ASSETS.slice(offset, offset + positionLookupBatchSize);
      const results = await Promise.allSettled(assets.map(readAssetPositions));
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === "fulfilled") positionsByAsset.push(result.value);
        else positionDataWarnings.push(`${assets[index]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    }
  }
  const out = positionsByAsset.flat();

  return {
    account,
    positions: out,
    total_active_count: out.length,
    market_data_warning: marketDataWarning,
    position_data_warning: positionDataWarnings.length ? positionDataWarnings.join("; ") : null
  };
}

// ─── listPositionsByWallet ────────────────────────────────────────────────────
// Recovers all request_keys by querying GenerateRequestKey events on-chain.
// Critical for restoring P&L tracking after session loss.

function getBoundedEventFromBlock(requestedFromBlock: number | undefined, latestBlock: number): number {
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) throw new Error(`Invalid latest block: ${latestBlock}`);
  if (
    requestedFromBlock !== undefined &&
    (!Number.isSafeInteger(requestedFromBlock) || requestedFromBlock < 0 || requestedFromBlock > latestBlock)
  ) {
    throw new Error(`fromBlock must be an integer between 0 and latest block ${latestBlock}`);
  }
  const maxLookback = readIntegerEnv(
    "CALLPUT_MAX_EVENT_LOOKBACK_BLOCKS",
    DEFAULT_MAX_EVENT_LOOKBACK_BLOCKS,
    1,
    HARD_MAX_EVENT_LOOKBACK_BLOCKS
  );
  const defaultFromBlock = Math.max(0, latestBlock - DEFAULT_EVENT_LOOKBACK_BLOCKS);
  const minimumAllowedFromBlock = Math.max(0, latestBlock - maxLookback);
  return Math.max(requestedFromBlock ?? defaultFromBlock, minimumAllowedFromBlock);
}

const MAX_EVENT_QUERY_BLOCKS = 10_000;

async function queryFilterInChunks(
  contract: ethers.Contract,
  filter: any,
  fromBlock: number,
  toBlock: number
): Promise<Array<ethers.EventLog | ethers.Log>> {
  const logs: Array<ethers.EventLog | ethers.Log> = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_EVENT_QUERY_BLOCKS) {
    const end = Math.min(start + MAX_EVENT_QUERY_BLOCKS - 1, toBlock);
    logs.push(...await contract.queryFilter(filter, start, end));
  }
  return logs;
}

export async function listPositionsByWallet(params: {
  address: string;
  fromBlock?: number;
}) {
  const provider = await getValidatedProvider();
  if (!ethers.isAddress(params.address)) throw new Error(`Invalid address: ${params.address}`);
  const account = ethers.getAddress(params.address);

  const pm = new ethers.Contract(CONFIG.CONTRACTS.POSITION_MANAGER, POSITION_MANAGER_ABI, provider);
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = getBoundedEventFromBlock(params.fromBlock, latestBlock);

  const filter = pm.filters.GenerateRequestKey(account);
  const logs = await queryFilterInChunks(pm, filter, fromBlock, latestBlock);

  const openKeys: string[] = [];
  const closeKeys: string[] = [];

  for (const log of logs) {
    const ev = log as ethers.EventLog;
    const key = String(ev.args.key);
    const isOpen = Boolean(ev.args.isOpen);
    if (isOpen) openKeys.push(key);
    else closeKeys.push(key);
  }

  return {
    account,
    from_block: fromBlock,
    to_block: latestBlock,
    open_request_keys: openKeys,
    close_request_keys: closeKeys,
    total_open: openKeys.length,
    total_close: closeKeys.length,
    note: "Pass open_request_keys to callput_portfolio_summary to restore P&L tracking. Event history is limited by CALLPUT_MAX_EVENT_LOOKBACK_BLOCKS."
  };
}

// ─── getSettledPnl ────────────────────────────────────────────────────────────
// Queries SettlePosition events to surface realized payout history.
// amountOut = gross USDC received at settlement (subtract entry_cost for realized P&L).

export async function getSettledPnl(params: {
  address: string;
  fromBlock?: number;
}) {
  const provider = await getValidatedProvider();
  if (!ethers.isAddress(params.address)) throw new Error(`Invalid address: ${params.address}`);
  const account = ethers.getAddress(params.address);

  const settle = new ethers.Contract(CONFIG.CONTRACTS.SETTLE_MANAGER, SETTLE_MANAGER_ABI, provider);
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = getBoundedEventFromBlock(params.fromBlock, latestBlock);

  const filter = settle.filters.SettlePosition(account);
  const logs = await queryFilterInChunks(settle, filter, fromBlock, latestBlock);

  let totalAmountOutUsd = 0;
  const settlements: Record<string, unknown>[] = [];

  for (const log of logs) {
    const ev = log as ethers.EventLog;
    // Extract event args safely
    const underlyingAssetIndex = Number((ev.args as any).underlyingAssetIndex || 0);
    const mappedUnderlying = mapAssetIndexToUnderlying(underlyingAssetIndex);
    const underlying: UnderlyingAsset | string = mappedUnderlying ?? `UNKNOWN(${underlyingAssetIndex})`;
    const expirySec = Number((ev.args as any).expiry || 0);
    const optionTokenId = String((ev.args as any).optionTokenId || "0");
    const assetDecimals = mappedUnderlying ? CONFIG.UNDERLYINGS[mappedUnderlying].decimals : 18;
    const size = Number((ev.args as any).size || 0) / 10 ** assetDecimals;
    const amountOutUsd = Number((ev.args as any).amountOut || 0) / 10 ** CONFIG.ASSETS.USDC.decimals;
    const settlePrice = Number(ethers.formatUnits((ev.args as any).settlePrice || 0, 30));

    totalAmountOutUsd += amountOutUsd;

    settlements.push({
      underlying,
      expiry_code: formatExpiry(expirySec),
      option_token_id: optionTokenId,
      size,
      settle_price: settlePrice,
      amount_out_usd: Math.round(amountOutUsd * 100) / 100,
      block_number: log.blockNumber,
      tx_hash: log.transactionHash
    });
  }

  return {
    account,
    from_block: fromBlock,
    to_block: latestBlock,
    total_settled_positions: settlements.length,
    total_amount_out_usd: Math.round(totalAmountOutUsd * 100) / 100,
    settlements,
    note: "amount_out_usd is gross USDC received at settlement. Subtract entry_cost_usd (from portfolio_summary or open position records) to get realized P&L."
  };
}

// ─── scanSpreads ─────────────────────────────────────────────────────────────
// Returns at most max_results pre-ranked, ready-to-execute spread candidates.
// bias drives option type selection; ATM anchoring eliminates combinatorial explosion.

export async function scanSpreads(params: {
  underlyingAsset: string;
  bias: "bullish" | "bearish" | "neutral-bearish" | "neutral-bullish";
  maxResults?: number;
}) {
  const underlying = normalizeAsset(params.underlyingAsset);
  if (!underlying) throw new Error(`Unsupported asset: ${params.underlyingAsset}`);

  const maxResults = Math.max(1, Math.min(5, params.maxResults ?? 3));
  const snapshot = await getMarketSnapshot();
  const spot = snapshot.spot[underlying];
  const now = Date.now() / 1000;
  const minSpreadValue = minSpreadValueForAsset(underlying);

  // bias → strategy + option type + buy/sell direction
  const isBuy = params.bias === "bullish" || params.bias === "bearish";
  const isCallBased = params.bias === "bullish" || params.bias === "neutral-bearish";
  const optionType: OptionSide = isCallBased ? "Call" : "Put";
  const strategy: SpreadStrategy =
    params.bias === "bullish" ? "BuyCallSpread" :
    params.bias === "bearish" ? "BuyPutSpread" :
    params.bias === "neutral-bearish" ? "SellCallSpread" :
    "SellPutSpread";

  const available = snapshot.options.filter(
    (o) =>
      o.underlying === underlying &&
      o.isAvailable &&
      o.optionType === optionType &&
      o.expirySec > now + 6 * 3600
  );

  if (available.length === 0) throw new Error("No available options with >6h to expiry.");

  const expiryCodes = [...new Set(available.map((o) => o.expiryCode))]
    .sort((a, b) => {
      const aSec = available.find((o) => o.expiryCode === a)!.expirySec;
      const bSec = available.find((o) => o.expiryCode === b)!.expirySec;
      return aSec - bSec;
    })
    .slice(0, 2);

  const candidates: any[] = [];

  for (const expiryCode of expiryCodes) {
    const legs = available
      .filter((o) => o.expiryCode === expiryCode)
      .sort((a, b) => a.strikePrice - b.strikePrice);

    if (legs.length < 2) continue;

    const expirySec = legs[0].expirySec;
    const daysToExpiry = Math.round(((expirySec - now) / 86400) * 10) / 10;

    const atmIdx = legs.reduce(
      (best, o, i) =>
        Math.abs(o.strikePrice - spot) < Math.abs(legs[best].strikePrice - spot) ? i : best,
      0
    );

    // ATM IV exposed for market context
    const atmIv = legs[atmIdx]?.iv ?? null;

    for (let width = 1; width <= 3; width++) {
      let longLeg: MarketOption;
      let shortLeg: MarketOption;

      if (isCallBased) {
        // Call spreads: long ATM (lower strike), short OTM (higher strike)
        // Works for both BuyCallSpread and SellCallSpread — isBuy handled in execute
        const shortIdx = atmIdx + width;
        if (shortIdx >= legs.length) continue;
        longLeg = legs[atmIdx];
        shortLeg = legs[shortIdx];
      } else {
        // Put spreads: long ATM (higher strike), short OTM (lower strike)
        // Works for both BuyPutSpread and SellPutSpread
        const shortIdx = atmIdx - width;
        if (shortIdx < 0) continue;
        longLeg = legs[atmIdx];
        shortLeg = legs[shortIdx];
      }

      const spreadValue = longLeg.markPrice - shortLeg.markPrice;
      const strikeDiff = Math.abs(longLeg.strikePrice - shortLeg.strikePrice);

      if (spreadValue < minSpreadValue || strikeDiff <= 0) continue;

      const openQuote = calculateSpreadOpenQuote({
        strategy,
        size: 1,
        spotPrice: spot,
        spreadMarkPrice: spreadValue,
        strikeDiff,
        longRiskPremiumRateForBuy: longLeg.riskPremiumRateForBuy,
        longRiskPremiumRateForSell: longLeg.riskPremiumRateForSell,
        shortRiskPremiumRateForBuy: shortLeg.riskPremiumRateForBuy,
        shortRiskPremiumRateForSell: shortLeg.riskPremiumRateForSell
      });
      const estimatedAmountInPerUnit = Math.round(openQuote.amount_in_usdc * 1_000_000) / 1_000_000;
      const estimatedExecutionPrice = Math.round(openQuote.estimated_execution_price * 1_000_000) / 1_000_000;
      const estimatedOpenFeePerUnit = Math.round(openQuote.estimated_open_fee_usdc * 1_000_000) / 1_000_000;

      if (isBuy) {
        // Buy spread: pay premium, profit if spread widens
        candidates.push({
          strategy,
          long_leg_id: longLeg.optionId,
          short_leg_id: shortLeg.optionId,
          long_strike: longLeg.strikePrice,
          short_strike: shortLeg.strikePrice,
          spread_cost: Math.round(spreadValue * 100) / 100,
          estimated_execution_price: estimatedExecutionPrice,
          estimated_open_fee_per_unit: estimatedOpenFeePerUnit,
          estimated_amount_in_per_unit: estimatedAmountInPerUnit,
          risk_premium_rate: openQuote.risk_premium_rate,
          pricing_model: openQuote.pricing_model,
          max_payout: strikeDiff,
          cost_pct_of_max: Math.round((openQuote.amount_in_usdc / strikeDiff) * 10000) / 100,
          atm_iv: atmIv,
          expiry_code: expiryCode,
          days_to_expiry: daysToExpiry
        });
      } else {
        // Sell spread: collect premium upfront, post strikeDiff as collateral
        // Profit if spread narrows / expires worthless
        const maxRisk = strikeDiff - spreadValue;
        candidates.push({
          strategy,
          long_leg_id: longLeg.optionId,
          short_leg_id: shortLeg.optionId,
          long_strike: longLeg.strikePrice,
          short_strike: shortLeg.strikePrice,
          spread_credit: Math.round(spreadValue * 100) / 100,
          estimated_execution_price: estimatedExecutionPrice,
          estimated_open_fee_per_unit: estimatedOpenFeePerUnit,
          estimated_amount_in_per_unit: estimatedAmountInPerUnit,
          risk_premium_rate: openQuote.risk_premium_rate,
          pricing_model: openQuote.pricing_model,
          max_risk: Math.round(Math.max(0, maxRisk) * 100) / 100,
          max_payout: strikeDiff,
          credit_pct_of_max: Math.round((spreadValue / strikeDiff) * 10000) / 100,
          risk_reward: maxRisk > 0 ? Math.round((spreadValue / maxRisk) * 100) / 100 : null,
          atm_iv: atmIv,
          expiry_code: expiryCode,
          days_to_expiry: daysToExpiry
        });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error("No valid spread candidates found. Try a different asset or bias.");
  }

  // Buy spreads: rank by cost_pct_of_max ascending (lower cost = better value)
  // Sell spreads: rank by credit_pct_of_max descending (higher credit = more premium)
  const ranked = isBuy
    ? candidates.sort((a, b) => a.cost_pct_of_max - b.cost_pct_of_max)
    : candidates.sort((a, b) => b.credit_pct_of_max - a.credit_pct_of_max);

  const top = ranked.slice(0, maxResults).map((c, i) => ({ rank: i + 1, ...c }));

  const tip = isBuy
    ? "Use rank 1 for best value. cost_pct_of_max < 30 preferred. atm_iv shows current implied volatility — high IV favors sell spreads instead."
    : "Use rank 1 for best premium. credit_pct_of_max > 30 preferred. High IV environments maximize sell spread edge. Collateral = strikeDiff × size.";

  return {
    asset: underlying,
    spot_price: spot,
    bias: params.bias,
    strategy,
    tip,
    candidates: top
  };
}

// ─── getPortfolioSummary ──────────────────────────────────────────────────────
// Returns USDC balance, enriched positions with current spread mark value,
// and optional P&L if request_keys from prior executions are provided.

function normalizePortfolioRequestKeys(requestKeys: string[] | undefined): string[] {
  if (requestKeys === undefined) return [];
  if (!Array.isArray(requestKeys)) throw new Error("requestKeys must be an array");

  const uniqueKeys: string[] = [];
  const seen = new Set<string>();
  for (const key of requestKeys) {
    if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error("Each portfolio request key must be a 0x-prefixed 32-byte hexadecimal string");
    }
    const normalized = key.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueKeys.push(normalized);
  }

  const maximum = readIntegerEnv(
    "CALLPUT_MAX_PORTFOLIO_REQUEST_KEYS",
    DEFAULT_MAX_PORTFOLIO_REQUEST_KEYS,
    1,
    HARD_MAX_PORTFOLIO_REQUEST_KEYS
  );
  if (uniqueKeys.length > maximum) {
    throw new Error(`Portfolio request exceeds maximum request keys: ${uniqueKeys.length} > ${maximum}`);
  }
  return uniqueKeys;
}

async function mapSettledWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      try {
        results[index] = { status: "fulfilled", value: await mapper(values[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function getPortfolioSummary(params: {
  address: string;
  requestKeys?: string[];
}) {
  if (!ethers.isAddress(params.address)) throw new Error(`Invalid address: ${params.address}`);
  const account = ethers.getAddress(params.address);
  const requestKeys = normalizePortfolioRequestKeys(params.requestKeys);
  const provider = await getValidatedProvider();

  const usdc = new ethers.Contract(CONFIG.CONTRACTS.USDC, ERC20_ABI, provider);
  const [marketResult, positionData, usdcBalanceRaw] = await Promise.all([
    getMarketSnapshot()
      .then((snapshot) => ({ snapshot, warning: null as string | null }))
      .catch((error) => ({
        snapshot: null,
        warning: error instanceof Error ? error.message : String(error)
      })),
    getPositions(params.address),
    usdc.balanceOf(account) as Promise<bigint>
  ]);
  const snapshot = marketResult.snapshot;

  const usdcBalance = Number(usdcBalanceRaw) / 10 ** CONFIG.ASSETS.USDC.decimals;
  const now = Date.now() / 1000;

  // Build tokenId → entry cost map from on-chain openPositionRequests.
  // openPositionRequests(key) returns optionTokenId (index [3]) which is the
  // ERC-1155 token the position settled into — this is the bridge between
  // request_key and a live position for per-position P&L.
  const hasRequestKeys = requestKeys.length > 0;
  const tokenIdToEntryUsd = new Map<string, number>();
  let ignoredForeignRequestKeys = 0;

  if (hasRequestKeys) {
    const pm = new ethers.Contract(CONFIG.CONTRACTS.POSITION_MANAGER, POSITION_MANAGER_ABI, provider);
    const concurrency = readIntegerEnv(
      "CALLPUT_PORTFOLIO_REQUEST_CONCURRENCY",
      DEFAULT_PORTFOLIO_REQUEST_CONCURRENCY,
      1,
      HARD_MAX_PORTFOLIO_REQUEST_CONCURRENCY
    );
    const results = await mapSettledWithConcurrency(
      requestKeys,
      concurrency,
      (key) => pm.openPositionRequests(key)
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const req: any = r.value;
      // Extract account safely from struct response
      const acct = String(req.account || (Array.isArray(req) && req[0]) || "");
      if (!acct || acct.toLowerCase() === ethers.ZeroAddress.toLowerCase()) continue;
      if (!ethers.isAddress(acct) || ethers.getAddress(acct) !== account) {
        ignoredForeignRequestKeys++;
        continue;
      }
      // Extract tokenId safely from struct response (index 3)
      const tokenId = String(req.optionTokenId || (Array.isArray(req) && req[3]) || "0");
      // Extract amountIn safely from struct response (index 5)
      const amountIn = Number(req.amountIn || (Array.isArray(req) && req[5]) || 0) / 10 ** CONFIG.ASSETS.USDC.decimals;
      if (tokenId && tokenId !== "0" && amountIn > 0) {
        // accumulate in case the same token was entered in multiple batches
        tokenIdToEntryUsd.set(tokenId, (tokenIdToEntryUsd.get(tokenId) ?? 0) + amountIn);
      }
    }
  }

  // Enrich each position with:
  //   current_spread_mark   — mark-to-market spread value (fair mid)
  //   close_bid_value_usd   — conservative close estimate using bid/ask (tradeable price)
  //   entry_cost_usd        — from on-chain amountIn (requires matching request_key)
  //   unrealized_pnl_*      — mark-based (vs entry cost)
  //   close_pnl_est_*       — bid-based estimate (what you'd actually receive on close)
  let totalMarkValueUsd = 0;
  let totalEntryUsd = 0;
  const enrichedPositions: any[] = [];

  for (const pos of positionData.positions) {
    const asset = pos.underlying as UnderlyingAsset;
    const absSize = Math.abs(pos.size);

    const expiryOpt = snapshot?.options.find(
      (o) => o.expiryCode === pos.expiry_code && o.underlying === asset
    );
    const expirySec = Number(pos.expiry_sec || expiryOpt?.expirySec || 0);
    const secsToExpiry = expirySec > 0 ? expirySec - now : 0;
    const daysToExpiry = expirySec > 0 ? Math.round((secsToExpiry / 86400) * 10) / 10 : null;
    const urgent = expirySec > 0 && secsToExpiry > 0 && secsToExpiry < 86400;

    // Resolve both legs from market snapshot
    const nakedOpt = snapshot?.options.find(
      (o) =>
        o.underlying === asset &&
        o.expirySec === expirySec &&
        Math.trunc(o.strikePrice) === Math.trunc(pos.strike) &&
        o.optionType === pos.option_type
    );
    const pairOpt = (pos.pair_strike && expirySec)
      ? snapshot?.options.find(
          (o) =>
            o.underlying === asset &&
            o.expirySec === expirySec &&
            Math.trunc(o.strikePrice) === Math.trunc(pos.pair_strike) &&
            o.optionType === pos.option_type
        )
      : undefined;

    // ── Mark-to-market spread value (fair mid) ─────────────────────────────
    let currentSpreadMark: number | null = null;
    let currentValueUsd: number | null = null;
    if (nakedOpt && pairOpt) {
      currentSpreadMark = Math.round(Math.abs(nakedOpt.markPrice - pairOpt.markPrice) * 100) / 100;
      currentValueUsd   = Math.round(currentSpreadMark * absSize * 100) / 100;
      totalMarkValueUsd += currentValueUsd;
    }

    // ── Tradeable close price (bid-based, conservative) ────────────────────
    // Long spread  → sell naked at bid, cover pair at ask  → receive bid − ask
    // Short spread → buy naked at ask, sell pair at bid    → pay ask − bid
    // This is what the keeper would realistically fill on a close order.
    let closeBidValueUsd: number | null = null;
    if (nakedOpt && pairOpt) {
      const spreadClose = pos.side === "long"
        ? nakedOpt.bid - pairOpt.ask   // conservative: spread bid side
        : nakedOpt.ask - pairOpt.bid;  // cost to close short spread
      closeBidValueUsd = Math.round(spreadClose * absSize * 100) / 100;
    }

    // ── Per-position P&L via tokenId → entry cost bridge ──────────────────
    const entryUsd = hasRequestKeys ? (tokenIdToEntryUsd.get(pos.token_id) ?? null) : null;
    let unrealizedPnlUsd: number | null = null;
    let unrealizedPnlPct: number | null = null;
    let closePnlEstUsd:   number | null = null;
    let closePnlEstPct:   number | null = null;

    if (entryUsd !== null && entryUsd > 0) {
      totalEntryUsd += entryUsd;
      if (currentValueUsd !== null) {
        unrealizedPnlUsd = Math.round((currentValueUsd - entryUsd) * 100) / 100;
        unrealizedPnlPct = Math.round((unrealizedPnlUsd / entryUsd) * 10000) / 100;
      }
      if (closeBidValueUsd !== null) {
        closePnlEstUsd = Math.round((closeBidValueUsd - entryUsd) * 100) / 100;
        closePnlEstPct = Math.round((closePnlEstUsd / entryUsd) * 10000) / 100;
      }
    }

    enrichedPositions.push({
      underlying: pos.underlying,
      option_type: pos.option_type,
      side: pos.side,
      naked_strike: pos.strike,
      pair_strike: pos.pair_strike,
      expiry_code: pos.expiry_code,
      expiry_sec: pos.expiry_sec,
      lifecycle: pos.lifecycle,
      days_to_expiry: daysToExpiry,
      size: absSize,
      // Mark-to-market (fair mid price)
      current_spread_mark: currentSpreadMark,
      current_value_usd: currentValueUsd,
      // Tradeable close estimate (bid side — conservative)
      close_bid_value_usd: closeBidValueUsd,
      // Per-position P&L (populated when request_keys resolve this token_id)
      entry_cost_usd: entryUsd,
      unrealized_pnl_usd: unrealizedPnlUsd,
      unrealized_pnl_pct: unrealizedPnlPct,
      // Close P&L estimate — what you'd realize if you close right now
      close_pnl_est_usd: closePnlEstUsd,
      close_pnl_est_pct: closePnlEstPct,
      urgent,
      token_id: pos.token_id
    });
  }

  const urgentCount = enrichedPositions.filter((p) => p.urgent).length;
  const totalMarkRounded  = Math.round(totalMarkValueUsd * 100) / 100;
  const totalEntryRounded = Math.round(totalEntryUsd * 100) / 100;

  const result: Record<string, any> = {
    account,
    usdc_balance: Math.round(usdcBalance * 100) / 100,
    total_positions: enrichedPositions.length,
    total_mark_value_usd: totalMarkRounded,
    urgent_count: urgentCount,
    positions: enrichedPositions
  };

  const marketDataWarning = marketResult.warning ?? positionData.market_data_warning;
  if (marketDataWarning) result.market_data_warning = marketDataWarning;
  if (positionData.position_data_warning) result.position_data_warning = positionData.position_data_warning;

  if (hasRequestKeys) {
    const pnlUsd = Math.round((totalMarkValueUsd - totalEntryUsd) * 100) / 100;
    const pnlPct = totalEntryRounded > 0
      ? Math.round((pnlUsd / totalEntryRounded) * 10000) / 100
      : null;

    result.total_entry_cost_usd = totalEntryRounded;
    result.total_pnl_usd        = pnlUsd;
    result.total_pnl_pct        = pnlPct;
    result.tracked_request_keys = requestKeys.length;
    result.ignored_foreign_request_keys = ignoredForeignRequestKeys;
    result.pnl_note = [
      "unrealized_pnl = current mark value vs on-chain amountIn (fair mid, not tradeable).",
      "close_pnl_est  = bid-based spread value vs entry cost (conservative, tradeable estimate).",
      "entry_cost_usd per position requires request_key → optionTokenId match from openPositionRequests."
    ].join(" ");
  }

  return result;
}

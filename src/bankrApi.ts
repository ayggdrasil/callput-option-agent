import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { z } from "zod";
import { CONFIG, ERC20_ABI, POSITION_MANAGER_ABI } from "./config.js";
import {
  DEFAULT_MIN_FILL_RATIO,
  checkRequestStatus,
  executeSpread,
  getMarketSnapshot,
  getRequestKeyFromTx,
  listPositionsByWallet,
  scanSpreads
} from "./core.js";
import { anonymousWalletId, captureTelemetry, TELEMETRY_EVENTS, type TelemetryEvent } from "./telemetry.js";
import { bodyWithinLimit, isAllowedHttpHost } from "./httpSecurity.js";

const MAX_BODY_BYTES = 32 * 1024;
const BANKR_ORIGINS = new Set(["https://bankr.bot", "https://mcp.callput.app"]);

const scanSchema = z.object({
  underlying_asset: z.string().min(1),
  bias: z.enum(["bullish", "bearish", "neutral-bearish", "neutral-bullish"]),
  max_results: z.number().int().min(1).max(5).optional()
}).strict();

const prepareSchema = z.object({
  strategy: z.enum(["BuyCallSpread", "SellCallSpread", "BuyPutSpread", "SellPutSpread"]),
  from_address: z.string(),
  long_leg_id: z.string(),
  short_leg_id: z.string(),
  size: z.number().positive(),
  min_fill_ratio: z.number().min(0.01).max(1).default(DEFAULT_MIN_FILL_RATIO)
}).strict();

const reconcileSchema = z.object({
  wallet_address: z.string(),
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  request_key: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  is_open: z.boolean().default(true),
  from_block: z.number().int().nonnegative().optional()
}).strict();

const eventSchema = z.object({
  event: z.enum(TELEMETRY_EVENTS),
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

export type BankrDependencies = {
  getMarketSnapshot: typeof getMarketSnapshot;
  scanSpreads: typeof scanSpreads;
  executeSpread: typeof executeSpread;
  getRequestKeyFromTx: typeof getRequestKeyFromTx;
  checkRequestStatus: typeof checkRequestStatus;
  listPositionsByWallet: typeof listPositionsByWallet;
  captureTelemetry: typeof captureTelemetry;
};

const defaultDependencies: BankrDependencies = {
  getMarketSnapshot,
  scanSpreads,
  executeSpread,
  getRequestKeyFromTx,
  checkRequestStatus,
  listPositionsByWallet,
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
  return createHash("sha256")
    .update([tx.chain_id, tx.from, tx.to, tx.value, tx.data].join(":" ).toLowerCase())
    .digest("hex");
}

export function validatePreparedTransaction(prepared: Prepared): void {
  const tx = prepared.unsigned_tx;
  if (tx.chain_id !== CONFIG.CHAIN_ID) throw new Error("Prepared transaction has an unexpected chain ID");
  if (ethers.getAddress(tx.to) !== ethers.getAddress(CONFIG.CONTRACTS.POSITION_MANAGER)) {
    throw new Error("Prepared transaction has an unexpected destination");
  }
  if (!ethers.isAddress(tx.from)) throw new Error("Prepared transaction has an invalid sender");
  const parsed = new ethers.Interface(POSITION_MANAGER_ABI).parseTransaction({ data: tx.data, value: tx.value });
  if (parsed?.name !== "createOpenPosition") throw new Error("Prepared transaction has unexpected calldata");
  if (BigInt(parsed.args[5]) !== BigInt(prepared.quote.min_size_raw)) {
    throw new Error("Prepared transaction minimum size does not match its quote");
  }
  if (BigInt(parsed.args[7]) !== BigInt(prepared.quote.amount_in_raw)) {
    throw new Error("Prepared transaction amount in does not match its quote");
  }

  const approval = prepared.usdc_approval.approve_tx;
  if (approval) {
    if (approval.chain_id !== CONFIG.CHAIN_ID) throw new Error("Approval has an unexpected chain ID");
    if (ethers.getAddress(approval.to) !== ethers.getAddress(CONFIG.CONTRACTS.USDC)) {
      throw new Error("Approval has an unexpected destination");
    }
    const decoded = new ethers.Interface(ERC20_ABI).parseTransaction({ data: approval.data });
    if (decoded?.name !== "approve" || ethers.getAddress(String(decoded.args[0])) !== ethers.getAddress(CONFIG.CONTRACTS.ROUTER)) {
      throw new Error("Approval has unexpected calldata");
    }
  }
}

async function telemetry(deps: BankrDependencies, event: TelemetryEvent, wallet: string | undefined, properties: Record<string, any>) {
  const distinctId = anonymousWalletId(wallet) ?? String(properties.anonymous_id ?? "anonymous");
  await deps.captureTelemetry({ event, distinctId, properties }).catch((error) => {
    console.error("Telemetry error", error instanceof Error ? error.message : error);
  });
}

export async function handleBankrApiRequest(
  action: "assets" | "scan" | "prepare" | "reconcile" | "events",
  request: Request,
  deps: BankrDependencies = defaultDependencies
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!isAllowedHttpHost(request)) return response(421, { error: "Host is not allowed" }, null);
  if (origin && !BANKR_ORIGINS.has(origin)) return response(403, { error: "Origin is not allowed" }, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
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
      validatePreparedTransaction(prepared);
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
          minimum_fill_ratio: prepared.quote.min_fill_ratio,
          minimum_size_raw: prepared.quote.min_size_raw,
          execution_fee_wei: prepared.unsigned_tx.value,
          approval_required: !prepared.usdc_approval.sufficient
        }
      }, origin);
    }

    if (action === "reconcile") {
      const input = reconcileSchema.parse(raw);
      if (!ethers.isAddress(input.wallet_address)) throw new Error("Invalid wallet_address");
      let requestKey = input.request_key;
      let isOpen = input.is_open;
      if (input.tx_hash) {
        const extracted = await deps.getRequestKeyFromTx(input.tx_hash);
        if ("error" in extracted) return response(404, extracted, origin);
        requestKey = extracted.request_key;
        isOpen = extracted.is_open;
      }
      if (!requestKey) {
        const recovered = await deps.listPositionsByWallet({
          address: input.wallet_address,
          fromBlock: input.from_block
        });
        requestKey = recovered.open_request_keys.at(-1) ?? recovered.close_request_keys.at(-1);
        isOpen = recovered.open_request_keys.includes(requestKey ?? "");
        if (!requestKey) return response(200, { status: "not_found", wallet: ethers.getAddress(input.wallet_address), recovered }, origin);
      }
      const status = await deps.checkRequestStatus(requestKey!, isOpen);
      const account = "account" in status ? String(status.account) : undefined;
      if (account && ethers.getAddress(account) !== ethers.getAddress(input.wallet_address)) {
        return response(409, { error: "Request key belongs to a different wallet" }, origin);
      }
      await telemetry(deps, "onchain_detected", input.wallet_address, { request_key: requestKey, status: status.status });
      if (status.status === "executed") await telemetry(deps, "keeper_executed", input.wallet_address, { request_key: requestKey });
      if (status.status === "cancelled") await telemetry(deps, "cancelled", input.wallet_address, { request_key: requestKey });
      return response(200, { tx_hash: input.tx_hash, is_open: isOpen, ...status }, origin);
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

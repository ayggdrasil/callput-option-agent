#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CONFIG, collateralInfo, resolveNetwork, withNetwork, networkInfo } from "./config.js";
import { bankrExecuteSpreadInputSchema, bankrExecuteSpreadMcpInputSchema, resolveBankrMaxUsdcRiskRaw, validatePreparedTransaction } from "./bankrApi.js";
import { CALLPUT_SERVER_NAME, CALLPUT_VERSION } from "./version.js";
import { executionRouteSchema, requireDirectWalletRoute, walletConnectionInfo } from "./walletContext.js";
import {registerAccountTools} from './accountTools.js';
import {
  checkRequestStatus,
  closeAllPositions,
  closePosition,
  executeSpread,
  getOptionChains,
  getPortfolioSummary,
  getRequestKeyFromTx,
  getSettledPnl,
  listPositionsByWallet,
  scanSpreads,
  settleAllPositions,
  settlePosition
} from "./core.js";

function ok(payload: Record<string, unknown>) {
  payload = { ...payload, network: CONFIG.NETWORK, chain_id: CONFIG.CHAIN_ID, testnet: CONFIG.TESTNET, collateral: collateralInfo(), wallet_connection: walletConnectionInfo() };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

export const executeSpreadInputSchema = bankrExecuteSpreadInputSchema;

export function createCallputMcpServer(network = resolveNetwork(process.env.CALLPUT_NETWORK)) {
const server = new McpServer({
  name: CALLPUT_SERVER_NAME,
  version: CALLPUT_VERSION
});

server.registerTool("callput_get_network_info", {
  description: "Discover this connection's fixed CallPut network, chain ID, testnet status, collateral symbol/address/decimals, contracts, market feed, supported symbols, wallet_connection login/owner/account rules, and unsigned-only execution boundary. Robinhood Chain collateral is USDG; Base and GIWA use USDC (GIWA is testnet). Legacy usdc field names refer to the selected collateral token. Keep all scans, approvals and lifecycle calls on this same connection.",
  inputSchema: z.object({})
}, async () => withNetwork(network, async () => ok(networkInfo())));

// ─── MCP Tool Registration (13 tools total) ──────────────────────────────────
// 1. callput_scan_spreads          – Market scan with pre-ranked spread candidates
// 2. callput_execute_spread        – Build unsigned spread transaction
// 3. callput_get_request_key_from_tx – Extract request_key from tx receipt
// 4. callput_check_request_status  – Poll keeper status by request_key
// 5. callput_portfolio_summary     – Collateral balance + positions + P&L
// 6. callput_close_position        – Build unsigned close transaction
// 7. callput_settle_position       – Build unsigned settle transaction
// 8. callput_close_all_positions   – Build reviewed close txs for every unexpired position
// 9. callput_settle_all_positions  – Build reviewed settle txs for every expired position
// 10. callput_list_positions_by_wallet – Recover request_keys from events
// 11. callput_get_settled_pnl      – Query realized payout history
// 12. callput_get_option_chains    – Raw tradable options from market feed
//
// Note: validateSpread, getPositions, and bootstrap are core functions but not
// exposed as separate tools—validateSpread is called internally by executeSpread,
// getPositions is wrapped by portfolio_summary, and bootstrap logic is implicit.

// ── 1. callput_scan_spreads ───────────────────────────────────────────────────
server.registerTool(
  "callput_scan_spreads",
  {
    description:
      "Primary market scan for currently tradable Callput underlyings (BTC, ETH, TSLA, QQQ, SPY, EWY, NVDA, COIN, SPCX, MU, SKHY, SNDK, DRAM, META, GOOGL, AAPL, CRCL, AMZN, MSFT, PLTR; Base and Robinhood configure all 20; GIWA supports BTC through DRAM only. Call callput_get_network_info for this connection; availability depends on its fresh feed). Returns up to max_results pre-ranked, ready-to-execute spread candidates. ATM-anchored with narrow/medium/wide widths. Includes ATM implied volatility (atm_iv) for buy-vs-sell strategy decisions. bias: bullish=BuyCallSpread, bearish=BuyPutSpread, neutral-bearish=SellCallSpread (collect premium), neutral-bullish=SellPutSpread (collect premium). High IV favors sell spreads. Pass long_leg_id + short_leg_id directly to execute_spread; leg IDs may be decimal or 0x hex strings.",
    inputSchema: z.object({
      underlying_asset: z.string(),
      bias: z.enum(["bullish", "bearish", "neutral-bearish", "neutral-bullish"]),
      max_results: z.number().int().min(1).max(5).optional()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const result = await scanSpreads({
        underlyingAsset: args.underlying_asset,
        bias: args.bias,
        maxResults: args.max_results
      });
      return ok(result as Record<string, unknown>);
    } catch (e: any) {
      return fail(`scan_spreads failed: ${e.message}`);
    }
  })
);

// ── 2. callput_execute_spread ─────────────────────────────────────────────────
server.registerTool(
  "callput_execute_spread",
  {
    description:
      "Direct-wallet route only: on GIWA/Robinhood explicitly set execution_route=direct_wallet and use a separately funded signer that owns the positions. CallPut Account session execution is unsupported; never substitute the login owner or account address. Build an unsigned spread transaction for crypto or supported stock/ETF options. Enforces the configured per-trade risk cap (100 selected-network collateral units by default) and validates all prepared calldata before returning it. Collateral is USDG on Robinhood Chain and USDC on Base or GIWA testnet; read collateral metadata first. Returns unsigned_tx (to/data/value/chain_id) for the agent to sign and broadcast. The legacy usdc_approval key refers to that collateral token: if sufficient=false, sign and send the bounded approve_tx first. Legacy amount_in_usdc and estimated_open_fee_usdc values are also denominated in the selected collateral token. After broadcast, call callput_get_request_key_from_tx with the tx hash.",
    inputSchema: bankrExecuteSpreadMcpInputSchema.extend({ execution_route: executionRouteSchema })
  },
  async (args) => withNetwork(network, async () => {
    try {
      requireDirectWalletRoute(args.execution_route);
      const { execution_route, ...transactionArgs } = args;
      const input = executeSpreadInputSchema.parse(transactionArgs);
      const result = await executeSpread({
        strategy: input.strategy,
        fromAddress: input.from_address,
        longLegId: input.long_leg_id,
        shortLegId: input.short_leg_id,
        size: input.size,
        minFillRatio: input.min_fill_ratio
      });
      validatePreparedTransaction(result, input, resolveBankrMaxUsdcRiskRaw());
      return ok(result as Record<string, unknown>);
    } catch (e: any) {
      return fail(`execute_spread failed: ${e.message}`);
    }
  })
);

// ── 3. callput_get_request_key_from_tx ───────────────────────────────────────
server.registerTool(
  "callput_get_request_key_from_tx",
  {
    description:
      "Extract request_key from a transaction receipt after broadcasting an execute_spread or close_position tx. Returns request_key and is_open flag. Persist the request_key for P&L tracking via portfolio_summary.",
    inputSchema: z.object({
      tx_hash: z.string()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const result = await getRequestKeyFromTx(args.tx_hash);
      return ok(result as Record<string, unknown>);
    } catch (e: any) {
      return fail(`get_request_key_from_tx failed: ${e.message}`);
    }
  })
);

// ── 4. callput_check_request_status ──────────────────────────────────────────
server.registerTool(
  "callput_check_request_status",
  {
    description: "Poll keeper status by on-chain request_key, never an account relay UUID. Call after broadcasting a tx until status is executed or cancelled.",
    inputSchema: z.object({
      request_key: z.string(),
      is_open: z.boolean()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const status = await checkRequestStatus(args.request_key, args.is_open);
      return ok(status as Record<string, unknown>);
    } catch (e: any) {
      return fail(`check_request_status failed: ${e.message}`);
    }
  })
);

// ── 5. callput_portfolio_summary ──────────────────────────────────────────────
server.registerTool(
  "callput_portfolio_summary",
  {
    description:
      "Read using the actual funds/position-holding address: the CallPut Account contract for account custody, or the wallet for direct custody. Email and Privy IDs are not chain addresses. Returns the selected network's collateral balance, all active positions enriched with current spread mark value, and optional P&L. The legacy usdc_balance field is USDG on Robinhood Chain and USDC on Base or GIWA testnet; inspect collateral metadata. Pass request_keys (saved from prior execute_spread calls) to enable cost-basis lookup from on-chain openPositionRequests and compute actual P&L.",
    inputSchema: z.object({
      address: z.string(),
      request_keys: z.array(z.string()).optional()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const result = await getPortfolioSummary({
        address: args.address,
        requestKeys: args.request_keys
      });
      return ok(result as Record<string, unknown>);
    } catch (e: any) {
      return fail(`portfolio_summary failed: ${e.message}`);
    }
  })
);

// ── 6. callput_close_position ─────────────────────────────────────────────────
server.registerTool(
  "callput_close_position",
  {
    description:
      "Direct-wallet route only: on GIWA/Robinhood explicitly set execution_route=direct_wallet and use a separately funded signer that owns the positions. CallPut Account session execution is unsupported; never substitute the login owner or account address. Build an unsigned close-position transaction for a wallet-owned, unexpired position. Requires explicit positive raw-unit minimum output floors; derive them from the user's approved slippage tolerance. Returns unsigned_tx for external confirmation.",
    inputSchema: z.object({
      execution_route: executionRouteSchema,
      underlying_asset: z.string(),
      from_address: z.string(),
      option_token_id: z.string(),
      size: z.number().positive(),
      min_amount_out_raw: z.string().regex(/^[1-9]\d*$/).max(78),
      min_out_when_swap_raw: z.string().regex(/^[1-9]\d*$/).max(78)
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      requireDirectWalletRoute(args.execution_route);
      const out = await closePosition({
        underlyingAsset: args.underlying_asset,
        fromAddress: args.from_address,
        optionTokenId: args.option_token_id,
        size: args.size,
        minAmountOutRaw: args.min_amount_out_raw,
        minOutWhenSwapRaw: args.min_out_when_swap_raw
      });
      return ok(out as Record<string, unknown>);
    } catch (e: any) {
      return fail(`close_position failed: ${e.message}`);
    }
  })
);

// ── 7. callput_settle_position ────────────────────────────────────────────────
server.registerTool(
  "callput_settle_position",
  {
    description:
      "Direct-wallet route only: on GIWA/Robinhood explicitly set execution_route=direct_wallet and use a separately funded signer that owns the positions. CallPut Account session execution is unsupported; never substitute the login owner or account address. Build an unsigned settle transaction for a wallet-owned expired position. Requires an explicit positive raw-unit minimum swap output floor approved by the user.",
    inputSchema: z.object({
      execution_route: executionRouteSchema,
      underlying_asset: z.string(),
      from_address: z.string(),
      option_token_id: z.string(),
      min_out_when_swap_raw: z.string().regex(/^[1-9]\d*$/).max(78)
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      requireDirectWalletRoute(args.execution_route);
      const out = await settlePosition({
        underlyingAsset: args.underlying_asset,
        fromAddress: args.from_address,
        optionTokenId: args.option_token_id,
        minOutWhenSwapRaw: args.min_out_when_swap_raw
      });
      return ok(out as Record<string, unknown>);
    } catch (e: any) {
      return fail(`settle_position failed: ${e.message}`);
    }
  })
);

// ── 8. callput_close_all_positions ───────────────────────────────────────────
server.registerTool(
  "callput_close_all_positions",
  {
    description:
      "Direct-wallet route only: on GIWA/Robinhood explicitly set execution_route=direct_wallet and use a separately funded signer that owns the positions. CallPut Account session execution is unsupported; never substitute the login owner or account address. Discover every wallet-owned unexpired Callput position and build one unsigned full-close transaction per position. The positive raw minimum floors apply to each transaction, not the aggregate. Every transaction requires a separate external wallet review; nothing is signed or broadcast by MCP.",
    inputSchema: z.object({
      execution_route: executionRouteSchema,
      from_address: z.string(),
      min_amount_out_raw: z.string().regex(/^[1-9]\d*$/).max(78),
      min_out_when_swap_raw: z.string().regex(/^[1-9]\d*$/).max(78)
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      requireDirectWalletRoute(args.execution_route);
      const out = await closeAllPositions({
        fromAddress: args.from_address,
        minAmountOutRaw: args.min_amount_out_raw,
        minOutWhenSwapRaw: args.min_out_when_swap_raw
      });
      return ok(out as Record<string, unknown>);
    } catch (e: any) {
      return fail(`close_all_positions failed: ${e.message}`);
    }
  })
);

// ── 9. callput_settle_all_positions ──────────────────────────────────────────
server.registerTool(
  "callput_settle_all_positions",
  {
    description:
      "Direct-wallet route only: on GIWA/Robinhood explicitly set execution_route=direct_wallet and use a separately funded signer that owns the positions. CallPut Account session execution is unsupported; never substitute the login owner or account address. Discover every wallet-owned expired Callput position and build one unsigned settlement transaction per position. The positive raw swap floor applies to each transaction. Every transaction requires a separate external wallet review; nothing is signed or broadcast by MCP.",
    inputSchema: z.object({
      execution_route: executionRouteSchema,
      from_address: z.string(),
      min_out_when_swap_raw: z.string().regex(/^[1-9]\d*$/).max(78)
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      requireDirectWalletRoute(args.execution_route);
      const out = await settleAllPositions({
        fromAddress: args.from_address,
        minOutWhenSwapRaw: args.min_out_when_swap_raw
      });
      return ok(out as Record<string, unknown>);
    } catch (e: any) {
      return fail(`settle_all_positions failed: ${e.message}`);
    }
  })
);

// ── 10. callput_list_positions_by_wallet ──────────────────────────────────────
server.registerTool(
  "callput_list_positions_by_wallet",
  {
    description:
      "Use the actual funds/position-holding address (CallPut Account address for account custody, connected wallet for direct custody). Recover all request_keys from on-chain GenerateRequestKey events for a wallet. Use after session loss to restore P&L tracking. Returns open_request_keys (pass to portfolio_summary) and close_request_keys. Default lookback: ~50k blocks (duration varies by network). Set from_block lower for older positions.",
    inputSchema: z.object({
      address: z.string(),
      from_block: z.number().int().optional()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const result = await listPositionsByWallet({
        address: args.address,
        fromBlock: args.from_block
      });
      return ok(result as Record<string, unknown>);
    } catch (e: any) {
      return fail(`list_positions_by_wallet failed: ${e.message}`);
    }
  })
);

// ── 11. callput_get_settled_pnl ───────────────────────────────────────────────
server.registerTool(
  "callput_get_settled_pnl",
  {
    description:
      "Query SettlePosition events to retrieve realized payout history. Returns amount_out_usd (gross selected-network collateral received at settlement) per position. Collateral is USDG on Robinhood Chain and USDC on Base or GIWA testnet; inspect collateral metadata. Subtract entry_cost_usd from portfolio_summary to compute realized P&L. Default lookback: ~50k blocks (duration varies by network).",
    inputSchema: z.object({
      address: z.string(),
      from_block: z.number().int().optional()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const result = await getSettledPnl({
        address: args.address,
        fromBlock: args.from_block
      });
      return ok(result as Record<string, unknown>);
    } catch (e: any) {
      return fail(`get_settled_pnl failed: ${e.message}`);
    }
  })
);

// ── 12. callput_get_option_chains ─────────────────────────────────────────────
server.registerTool(
  "callput_get_option_chains",
  {
    description: "Fetch raw tradable crypto and stock/ETF options from the Callput market feed. Prefer callput_scan_spreads for normal use; use this only when you need raw chain data or IV inspection. Use callput_get_network_info for configured-symbol discovery.",
    inputSchema: z.object({
      underlying_asset: z.string(),
      option_type: z.enum(["Call", "Put"]).optional(),
      expiry_date: z.string().optional(),
      max_expiries: z.number().int().min(1).max(5).optional(),
      max_strikes: z.number().int().min(2).max(30).optional()
    })
  },
  async (args) => withNetwork(network, async () => {
    try {
      const chains = await getOptionChains({
        underlyingAsset: args.underlying_asset,
        optionType: args.option_type,
        expiryDate: args.expiry_date,
        maxExpiries: args.max_expiries,
        maxStrikes: args.max_strikes
      });
      return ok(chains as Record<string, unknown>);
    } catch (e: any) {
      return fail(`get_option_chains failed: ${e.message}`);
    }
  })
);

registerAccountTools(server,network);
return server;
}

const invokedAsScript = process.argv[1]?.endsWith("/index.js") || process.argv[1]?.endsWith("/index.ts");
if (invokedAsScript) {
  const server = createCallputMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

---
name: callput-lite-trader
description: Spread-only on-chain options trading skill for Base. MCP builds unsigned transactions; Bankr or another external wallet confirms and broadcasts them. Supports BTC/ETH plus synthetic stock/ETF spreads with full position lifecycle.
version: 1.2.0
homepage: https://callput.app
license: MIT
visibility: public
tags: [options, crypto, stocks, etf, base, trading]
mcp:
  required:
    - name: callput-lite-agent-mcp
      setup: See references/SETUP.md
---

# Callput Lite Trader

Trade Callput crypto and synthetic stock/ETF spreads autonomously on Base using the MCP. The MCP builds unsigned transactions; Bankr agent handles signing and broadcasting.

---

## Integration Pattern (Bankr)

In the Bankr App, the backend passes validated Callput payloads to `bankr.tx.prepare`; the frontend then calls `bankr.confirmTransaction`. The user always sees Bankr's confirmation UI before Bankr broadcasts. Remote MCP clients connect to `https://mcp.callput.app/api/mcp`.

---

## Supported Underlyings

- Crypto: `BTC`, `ETH`
- Currently tradable stock/ETF symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`
- Configured option-token contracts: `BTC`, `ETH`, `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`
- Live tradability is determined by `callput_scan_spreads`; skip a symbol if no candidates are returned.
- Stock options are synthetic on-chain options, not broker-listed options, shares, ETFs, or tokenized stock ownership.

---

## Preferred Flow

```
1. callput_portfolio_summary(address)
   ↓ check positions + USDC balance
2. callput_scan_spreads(asset, bias)
   ↓ get ranked candidates + atm_iv
3. callput_execute_spread(address, strategy)
   ↓ return unsigned_tx + calldata
4. external wallet confirmation → sign and broadcast
6. callput_get_request_key_from_tx(tx_hash)
   ↓ extract request_key from receipt
7. persist request_key for P&L tracking
8. callput_check_request_status(request_key)
   ↓ poll every 30s until executed/cancelled
```

---

## Hard Rules

1. Spread-only. No single-leg execution ever.
2. Always check `callput_portfolio_summary` before opening a new position.
3. Use `callput_scan_spreads` as the primary market entry point for crypto or stock/ETF symbols.
4. Call spread ordering: long lower strike, short higher strike.
5. Put spread ordering: long higher strike, short lower strike.
6. **MCP never holds private keys — Bankr confirmation or the external runtime handles signing.**
7. If `usdc_approval.sufficient == false`, verify that approve_tx grants exactly `usdc_approval.required` raw USDC, then send it before the main tx. Reject any larger approval.
8. **Save every `request_key` from `get_request_key_from_tx`** — required for P&L.
9. If `request_keys` are lost, call `callput_list_positions_by_wallet` to recover them.
10. Check `atm_iv` from scan output: high IV favors sell spreads. Use ETH/BTC thresholds only for ETH/BTC; evaluate stock IV relative to that symbol's regime.

---

## Bias → Strategy Mapping

| Bias             | Strategy        | Option type | Direction          | Rank metric           |
|------------------|-----------------|-------------|--------------------|-----------------------|
| bullish          | BuyCallSpread   | Call        | Pay premium        | cost_pct_of_max ↓     |
| bearish          | BuyPutSpread    | Put         | Pay premium        | cost_pct_of_max ↓     |
| neutral-bearish  | SellCallSpread  | Call        | Collect premium    | credit_pct_of_max ↑   |
| neutral-bullish  | SellPutSpread   | Put         | Collect premium    | credit_pct_of_max ↑   |

Sell spreads post `strikeDiff × size` USDC as collateral. Best used in high-IV environments.

---

## Strike Selection

`callput_scan_spreads` handles this automatically:
- Long leg = ATM strike (nearest to spot price)
- Width variations: 1, 2, 3 strikes apart → narrow / medium / wide
- Ranked by `cost_pct_of_max` ascending (lower % = better value)
- **Prefer rank 1 unless days_to_expiry < 1**

Manual guidance (if using raw chains):
- ETH: target spread width of 100–200 USDC strike range
- BTC: target spread width of 1000–3000 USDC strike range
- Stocks/ETFs: start with scan-ranked adjacent widths; typical strikes are much tighter than BTC/ETH
- Avoid spreads with `cost_pct_of_max > 40%`

---

## When to Skip a Trade

Skip and wait if any of these are true:
- `usdc_balance` < 2× estimated spread cost
- `cost_pct_of_max > 40%` (poor risk/reward)
- `days_to_expiry < 0.25` (< 6 hours)
- `urgent_count > 0` — manage expiring positions first
- `scan_spreads` returns no candidates for the requested stock/ETF symbol

---

## Position Management

- **Poll keeper**: after broadcast, poll `check_request_status` every 30s, max 3 minutes
- **Pre-expiry**: use `callput_close_position` when `days_to_expiry < 1`
- **Post-expiry**: use `callput_settle_position` for expired positions
- **Profit taking**: close when `close_pnl_est_pct > 50` (50% gain)
- **Slippage floors**: before close or settle, show the user the expected USDC output and obtain an explicit minimum. Pass the positive base-unit value in `min_amount_out_raw` / `min_out_when_swap_raw`; never use zero or silently default to `1`.

---

## P&L Tracking Pattern

```javascript
// After broadcast + receipt:
const { request_key } = await callput_get_request_key_from_tx({ tx_hash })
agent_state.request_keys.push(request_key)

// To check P&L at any time:
callput_portfolio_summary({ address, request_keys: agent_state.request_keys })
```

### Per-position P&L fields

| Field | Description |
|---|---|
| `entry_cost_usd` | On-chain cost basis from `openPositionRequests(key).amountIn` |
| `current_value_usd` | Current mark-price spread value (mid fair value) |
| `unrealized_pnl_usd` | `current_value_usd − entry_cost_usd` |
| `unrealized_pnl_pct` | Unrealized P&L as % of entry cost |
| `close_bid_value_usd` | Bid-based close estimate (conservative) |
| `close_pnl_est_usd` | `close_bid_value_usd − entry_cost_usd` |
| `close_pnl_est_pct` | Close P&L as % of entry cost |

**Use `close_pnl_est_usd` for profit-taking decisions.**

---

## Tool Reference

| Tool | Purpose |
|---|---|
| `callput_scan_spreads` | Primary market scan — ranked spread candidates + ATM IV |
| `callput_execute_spread` | Build unsigned open-position tx + USDC allowance check |
| `callput_get_request_key_from_tx` | Parse request_key from tx receipt after broadcast |
| `callput_check_request_status` | Poll keeper until executed/cancelled |
| `callput_portfolio_summary` | USDC balance + positions + P&L (pass request_keys) |
| `callput_close_position` | Build unsigned close-position tx |
| `callput_settle_position` | Build unsigned settle tx for expired positions |
| `callput_close_all_positions` | Build one reviewed full-close tx per unexpired wallet position |
| `callput_settle_all_positions` | Build one reviewed settlement tx per expired wallet position |
| `callput_list_positions_by_wallet` | Recover request_keys from on-chain events |
| `callput_get_settled_pnl` | Realized payout history from SettlePosition events |
| `callput_get_option_chains` | Raw crypto/stock chain data + IV (use scan_spreads first) |

---

## One-Line Command Examples

- `Scan TSLA bullish spreads and build rank 1 via Bankr.`
- `Check portfolio P&L for address 0x... with saved request_keys.`
- `Close all positions expiring within 24 hours.`
- `Settle expired positions and report realized P&L.`
- `Execute a neutral-bearish NVDA or BTC call spread with Bankr signing.`

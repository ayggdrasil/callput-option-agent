---
name: callput-lite-trader
description: Spread-only on-chain options trading skill for Base, Robinhood Chain and GIWA Sepolia testnet. MCP builds unsigned direct-wallet transactions and coordinates separately signed account-session actions on Robinhood and GIWA. The public Bankr App is scan/prepare/reconcile only because Bankr chat execution is currently unavailable.
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

## Existing Web3 wallet and account workflow — source v0.8.4

The source registers 25 tools: 13 existing market/direct-wallet tools plus 12 account workflow tools. On Robinhood/GIWA, use `callput_account_resolve`, `callput_workflow_start`, then follow `next_actions` through owner login, account creation, direct deposit, bounded device Grant and sponsored order. Read `callput://account/workflow` and use the exact prepared requests with your external owner and device signers. No browser page is required. Never pass owner/device private keys. Storage availability and scope are explicit in `callput_get_network_info.account_workflow`; missing encrypted persistent storage blocks execution.

ETH BuyCallSpread is the default. Set one configured underlying and one supported spread strategy (one open and one close per 10-minute Grant). Owner=the device signer is forbidden by the account contract. Deposit amount, trade collateral cap, owner deposit gas and sponsor fees are separate. Direct deposit uses ERC20 transfer without approve. Robinhood fixes transfer nonce/gas/price before approval; GIWA direct deposits are blocked when a hard total fee bound cannot be enforced. Funded GIWA accounts can trade.

Runbook: [Account workflow](https://mcp.callput.app/account-workflow). Deployment configuration, wallet-origin proxy and recovery boundaries: `docs/releases/2026-11-08-account-workflow.md`. Source registration and tests do not prove production rollout or a real fill.

Trade Callput crypto and synthetic stock/ETF spreads through the MCP's direct-wallet route. The MCP prepares unsigned transactions; an authorized external wallet handles signing and broadcasting. For Robinhood/GIWA account custody, follow the separate Account workflow above.

---

## Network connections — verify the deployed version at initialization

Each MCP connection is bound to one deployment for its whole workflow.

| Network | Chain ID | Environment | HTTP endpoint |
| --- | --- | --- | --- |
| Base | 8453 | Mainnet | `https://mcp.callput.app/api/mcp` |
| Robinhood Chain | 4663 | Mainnet | `https://mcp.callput.app/api/mcp?network=robinhood` |
| GIWA Sepolia | 91342 | Testnet | `https://mcp.callput.app/api/mcp?network=giwa` |

Call `callput_get_network_info` first to discover the bound chain, contract destinations, approval spender and configured symbols. Base and Robinhood configure 20 symbols; GIWA configures 13 (BTC through DRAM). Availability depends on fresh, unexpired market data. Stale feeds reject scans and new trade preparation. Testnet balances and results are not mainnet funds.

For local stdio on this version, set `CALLPUT_NETWORK=robinhood` or `CALLPUT_NETWORK=giwa`; omit it for Base. Optional RPC overrides are `CALLPUT_ROBINHOOD_RPC_URL` / `CALLPUT_GIWA_RPC_URL` and corresponding `CALLPUT_ROBINHOOD_TRACKING_RPC_URL` / `CALLPUT_GIWA_TRACKING_RPC_URL`. Base retains `RPC_URL`, `BASE_RPC_URL` and existing tracking overrides. A Base provider override is never reused for another chain.

Keep the selected network with each quote, wallet, transaction and request key. Use the same connection through scan, unsigned preparation, external signing, receipt lookup, closing and settlement. Verify the response `network`, `chain_id` and `testnet` before signing. Owner/device signing remains in the wallet. The account relay broadcasts only explicitly signed account actions; direct-wallet unsigned transactions are broadcast externally. The Bankr REST trading adapter and Bankr public app remain Base-only; `GET /api/bankr/assets?network=...` supports network-specific read-only market status.

## Wallet identity and custody

All three CallPut apps offer `email_otp` via Privy, which connects an embedded EVM owner wallet, or `external_wallet` via wagmi. External wallet rows connect directly without Privy wallet login or a connect-time signature. Email and Privy user IDs are login identities, not signing addresses. Social login is disabled. Base trading uses direct wallet custody; GIWA and Robinhood app modes are deposit-only and may use a separate CallPut Account contract for funds and positions. See [Privy's email OTP documentation](https://docs.privy.io/authentication/user-authentication/login-methods/email) and the current [Base](https://app.callput.app/assets/index-dc9b0e57.js), [GIWA](https://giwa.callput.app/assets/index-d5646322.js), and [Robinhood](https://robin.callput.app/assets/index-74211fbb.js) public app bundles, observed 2026-11-04.

The connected owner wallet may authorize a separate CallPut Account contract that holds collateral and positions. This MCP does not implement CallPut's session relay. In source v0.7.0, `execution_route="callput_account"` is rejected; account-mode order creation, close and settlement stay in the CallPut app. For read-only portfolio/position-history tools, pass the actual address that holds those positions.

For direct-wallet writes, pass `execution_route="direct_wallet"`. Base can omit this field for compatibility; GIWA and Robinhood require it explicitly. The MCP prepares unsigned transactions only; an authorized external signer must review and sign using the connected owner wallet. This is v0.7.0 source guidance, not confirmation that the hosted MCP endpoint has been upgraded. No live OTP, wallet signature or transaction was tested.

## Collateral and compatibility

Call `callput_get_network_info` first. Its `collateral` object identifies the selected token's symbol, address, decimals and testnet status. Successful tool responses and the read-only asset API include the same metadata.

| Network | Collateral | Token address | Decimals |
| --- | --- | --- | --- |
| Base | USDC | `0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913` | 6 |
| Robinhood Chain | USDG (Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| GIWA Sepolia testnet | Test USDC | `0x79AD98fA252D64A9095f83cc6FaF4243E0d01d48` | 6 |

Legacy names such as `contracts.usdc`, `usdc_approval`, `usdc_balance`, `amount_in_usdc`, `estimated_open_fee_usdc` and `BANKR_MAX_USDC_RISK_PER_TRADE` remain for compatibility. On Robinhood they represent USDG collateral amounts and approval, not a separate USDC token. Never infer a token symbol from these keys. Native gas and execution fees use ETH. Bankr REST trading and the public Bankr app remain Base-only.


## Integration Pattern (Bankr)

The public Bankr App uses `bankr.tx.prepare` to scan and inspect validated Callput payloads, but its chat execution controls are disabled after repeated simulator false negatives. Remote MCP clients connect to `https://mcp.callput.app/api/mcp` and hand the returned unsigned transaction to an authorized external signer. Bankr Wallet API/CLI can be used only as an advanced separately configured signer path with a user-managed write key.

---

## Supported Underlyings

- Crypto: `BTC`, `ETH`
- Configured synthetic stock/ETF symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`
- Configured option-token contracts: `BTC`, `ETH`, `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`
- Live tradability is determined by `callput_scan_spreads`; skip a symbol if no candidates are returned.
- Stock options are synthetic on-chain options, not broker-listed options, shares, ETFs, or tokenized stock ownership.

---

## Preferred Flow

```
1. callput_get_network_info                 ← verify network and wallet context
   callput_portfolio_summary(position_holder_address)
   ↓ check positions + collateral balance
2. callput_scan_spreads(asset, bias)
   ↓ get ranked candidates + atm_iv
3. callput_execute_spread(address, strategy, execution_route="direct_wallet")
   ↓ return unsigned_tx + calldata
4. external signer reviews, then signs and broadcasts the direct-wallet transaction
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
6. **MCP never holds private keys — an authorized external runtime handles signing. Do not describe the public Bankr App chat path as production execution.**
7. If `usdc_approval.sufficient == false`, verify that approve_tx grants exactly `usdc_approval.required` raw collateral-token units, then send it before the main tx. Reject any larger approval.
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

Sell spreads post `strikeDiff × size` collateral-token units as collateral. Best used in high-IV environments.

---

## Strike Selection

`callput_scan_spreads` handles this automatically:
- Long leg = ATM strike (nearest to spot price)
- Width variations: 1, 2, 3 strikes apart → narrow / medium / wide
- Ranked by `cost_pct_of_max` ascending (lower % = better value)
- **Prefer rank 1 unless days_to_expiry < 1**

Manual guidance (if using raw chains):
- ETH: target spread width of 100–200 USD strike range
- BTC: target spread width of 1000–3000 USD strike range
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
- **Slippage floors**: before close or settle, show the user the expected collateral-token output and obtain an explicit minimum. Pass the positive base-unit value in `min_amount_out_raw` / `min_out_when_swap_raw`; never use zero or silently default to `1`.

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
| `callput_execute_spread` | Build unsigned open-position tx + collateral allowance check |
| `callput_get_request_key_from_tx` | Parse request_key from tx receipt after broadcast |
| `callput_check_request_status` | Poll keeper until executed/cancelled |
| `callput_portfolio_summary` | Collateral balance + positions + P&L (pass request_keys) |
| `callput_close_position` | Build unsigned close-position tx |
| `callput_settle_position` | Build unsigned settle tx for expired positions |
| `callput_close_all_positions` | Build reviewed direct-wallet closes; CallPut Account route unsupported |
| `callput_settle_all_positions` | Build reviewed direct-wallet settlements; CallPut Account route unsupported |
| `callput_list_positions_by_wallet` | Recover request_keys for the supplied position-holder address |
| `callput_get_settled_pnl` | Realized payout history from SettlePosition events |
| `callput_get_option_chains` | Raw crypto/stock chain data + IV (use scan_spreads first) |

---

## One-Line Command Examples

- `Scan TSLA bullish spreads and build rank 1 as an unsigned transaction.`
- `Check portfolio P&L for address 0x... with saved request_keys.`
- `Close all positions expiring within 24 hours.`
- `Settle expired positions and report realized P&L.`
- `Prepare a neutral-bearish NVDA or BTC call spread for an authorized external signer.`

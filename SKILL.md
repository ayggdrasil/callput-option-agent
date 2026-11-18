---

## Existing Web3 wallet and account workflow — source v0.8.0

The source registers 25 tools: 13 existing market/direct-wallet tools plus 12 account workflow tools. On Robinhood/GIWA, use `callput_account_resolve`, `callput_workflow_start`, then follow `next_actions` through owner login, account creation, direct deposit, bounded device Grant and sponsored order. Open the returned app-origin wallet approval URL or use the exact prepared requests with an external signer. Never pass owner/device private keys. Storage availability and scope are explicit in `callput_get_network_info.account_workflow`; missing encrypted persistent storage blocks execution.

Set `underlying_asset` and `strategy` in `callput_workflow_start` before the owner signs the Grant. All configured option markets on Robinhood and GIWA support `BuyCallSpread`, `SellCallSpread`, `BuyPutSpread`, and `SellPutSpread` when quotes are available. Each 10-minute Grant authorizes one selected underlying and strategy, one open, and one close. Omitting the fields selects ETH and BuyCallSpread. Owner=the device signer is forbidden by the account contract. Deposit amount, trade collateral cap, owner deposit gas and sponsor fees are separate. Direct deposit uses ERC20 transfer without approve. Robinhood fixes transfer nonce/gas/price before approval; GIWA direct deposits are blocked when a hard total fee bound cannot be enforced. Funded GIWA accounts can trade.

Runbook: [Account workflow](https://mcp.callput.app/account-workflow). Deployment configuration, wallet-origin proxy and recovery boundaries: `docs/releases/2026-11-08-account-workflow.md`. Source registration and tests do not prove production rollout or a real fill.

name: callput-lite-trader
description: Spread-only Callput trading skill for external agents on Base, Robinhood Chain and GIWA Sepolia testnet. Supports BTC/ETH plus synthetic stock/ETF options. Unsigned-tx pattern — MCP builds calldata, agent signs and broadcasts with its own key.
license: MIT
---

# Callput Lite Trader Skill

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

All three CallPut apps offer `email_otp` via Privy (which connects an embedded EVM owner wallet) or `external_wallet` through wagmi. External wallet rows connect directly, without Privy wallet login or a connect-time signature. Email and Privy user IDs are not signing addresses; use the connected owner wallet address. Social login providers are not enabled. Base trading uses direct wallet custody; GIWA and Robinhood app modes are deposit-only and may use a separate CallPut Account contract for funds and positions.

The owner wallet is distinct from the CallPut Account holding funds and positions. Use callput_workflow_start for the account route, and follow exact wallet requests and next_actions. The original direct-wallet tools reject execution_route=callput_account. Read-only portfolio/history tools should receive the actual holding account address.

Direct-wallet write preparation accepts `execution_route="direct_wallet"`; Base omission remains direct-wallet compatible, while GIWA and Robinhood require an explicit `direct_wallet`. No write tool signs or broadcasts. The hosted MCP is not claimed to have this source version yet. The current public frontend bundle evidence is [Base](https://app.callput.app/assets/index-dc9b0e57.js), [GIWA](https://giwa.callput.app/assets/index-d5646322.js) and [Robinhood](https://robin.callput.app/assets/index-74211fbb.js), observed 2026-11-04. This verifies app configuration only; no live OTP login, wallet signature, or transaction was tested.

## Collateral and compatibility

Call `callput_get_network_info` first. Its `collateral` object identifies the selected token's symbol, address, decimals and testnet status. Successful tool responses and the read-only asset API include the same metadata.

| Network | Collateral | Token address | Decimals |
| --- | --- | --- | --- |
| Base | USDC | `0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913` | 6 |
| Robinhood Chain | USDG (Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| GIWA Sepolia testnet | Test USDC | `0x79AD98fA252D64A9095f83cc6FaF4243E0d01d48` | 6 |

Legacy names such as `contracts.usdc`, `usdc_approval`, `usdc_balance`, `amount_in_usdc`, `estimated_open_fee_usdc` and `BANKR_MAX_USDC_RISK_PER_TRADE` remain for compatibility. On Robinhood they represent USDG collateral amounts and approval, not a separate USDC token. Never infer a token symbol from these keys. Native gas and execution fees use ETH. Bankr REST trading and the public Bankr app remain Base-only.


## Goal
Trade Callput crypto and synthetic stock/ETF spreads autonomously. MCP builds unsigned transactions; the agent signs and broadcasts using its own wallet.

---

## Supported Underlyings

- Crypto: `BTC`, `ETH`
- Configured synthetic stock/ETF symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`
- Configured option-token contracts: `BTC`, `ETH`, `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`
- Live tradability is determined by `callput_scan_spreads`; skip a symbol if no candidates are returned.
- Stock options are synthetic on-chain options, not broker-listed options, shares, ETFs, or tokenized stock ownership.

---

## Direct-wallet flow (account workflows use the runbook above)

```
1. callput_get_network_info                 ← verify network and wallet-context support
   callput_portfolio_summary(position_holder_address) ← check actual holder's positions + collateral
   [if request_keys lost]
   callput_list_positions_by_wallet(address) ← recover request_keys from on-chain events
2. callput_scan_spreads                     ← pick asset + bias, get ranked candidates + atm_iv
3. callput_execute_spread(from_address, execution_route="direct_wallet") ← unsigned tx + approval check
   [if usdc_approval.sufficient == false]
   → prepare/sign + broadcast the exact approval only after user review
4. external signer reviews and signs the direct-wallet unsigned_tx
5. callput_get_request_key_from_tx(txHash) ← parse GenerateRequestKey from receipt
6. persist request_key                     ← REQUIRED for P&L tracking
7. callput_check_request_status            ← poll every 30s until executed/cancelled
   [after settlement]
   callput_get_settled_pnl                 ← realized payout history
```

---

## Hard rules

1. Spread-only. No single-leg execution ever.
2. Always check `callput_portfolio_summary` before opening a new position.
3. Use `callput_scan_spreads` as the primary market entry point for crypto or stock/ETF symbols.
4. Call spread ordering: long lower strike, short higher strike.
5. Put spread ordering: long higher strike, short lower strike.
6. MCP never holds or requires a private key — agent signs externally.
7. If `usdc_approval.sufficient == false`, verify that approve_tx grants exactly `usdc_approval.required` raw collateral-token units, then send it before the main tx. Reject any larger approval.
8. **Save every `request_key` from `get_request_key_from_tx`** — required for P&L.
9. If `request_keys` are lost, call `callput_list_positions_by_wallet` with the actual position-holder address to recover them.
10. Check `atm_iv` from scan output: high IV favors sell spreads. Use ETH/BTC thresholds only for ETH/BTC; evaluate stock IV relative to that symbol's regime.

---

## Bias → strategy mapping

| Bias             | Strategy        | Option type | Direction          | Rank metric           |
|------------------|-----------------|-------------|--------------------|-----------------------|
| bullish          | BuyCallSpread   | Call        | Pay premium        | cost_pct_of_max ↓     |
| bearish          | BuyPutSpread    | Put         | Pay premium        | cost_pct_of_max ↓     |
| neutral-bearish  | SellCallSpread  | Call        | Collect premium    | credit_pct_of_max ↑   |
| neutral-bullish  | SellPutSpread   | Put         | Collect premium    | credit_pct_of_max ↑   |

Sell spreads post `strikeDiff × size` collateral-token units as collateral. Best used in high-IV environments.

---

## Strike selection (when using scan_spreads)

`callput_scan_spreads` handles this automatically:
- Long leg = ATM strike (nearest to spot price)
- Width variations: 1, 2, 3 strikes apart → narrow / medium / wide
- Ranked by `cost_pct_of_max` ascending (lower % = better value)
- **Prefer rank 1 unless days_to_expiry < 1**

Manual guidance (if using raw chains):
- ETH: target spread width of 100–200 USD strike range
- BTC: target spread width of 1000–3000 USD strike range
- Stocks/ETFs: start with scan-ranked adjacent widths; typical strikes are much tighter than BTC/ETH
- Avoid spreads with `cost_pct_of_max > 40%` (overpaying for max payout)

---

## When to skip a trade

Skip and wait if any of these are true:
- `usdc_balance` (from portfolio_summary) < 2× estimated spread cost
- `cost_pct_of_max > 40%` (poor risk/reward)
- `days_to_expiry < 0.25` (< 6 hours) — too close to expiry
- `urgent_count > 0` — manage expiring positions first
- `scan_spreads` returns no candidates for the requested stock/ETF symbol

---

## Position management

- **Poll keeper**: after every broadcast, poll `check_request_status` every 30s, max 3 minutes
- **Pre-expiry**: use `callput_close_position` when `days_to_expiry < 1`
- **Post-expiry**: use `callput_settle_position` for expired positions
- **Profit taking**: consider closing when `close_pnl_est_pct > 50` (50% gain on tradeable close)

---

## P&L tracking pattern

```
# After broadcast + receipt:
const { request_key } = await callput_get_request_key_from_tx({ tx_hash })
agent_state.request_keys.push(request_key)

# To check P&L at any time:
callput_portfolio_summary({ address, request_keys: agent_state.request_keys })
```

### Per-position P&L fields (returned when `request_keys` are passed)

| Field | Description |
|---|---|
| `entry_cost_usd` | On-chain cost basis from `openPositionRequests(key).amountIn` |
| `current_value_usd` | Current mark-price spread value (mid fair value) |
| `unrealized_pnl_usd` | `current_value_usd − entry_cost_usd` (mark-based, not tradeable) |
| `unrealized_pnl_pct` | Unrealized P&L as % of entry cost |
| `close_bid_value_usd` | Bid-based close estimate: `naked.bid − pair.ask` (conservative) |
| `close_pnl_est_usd` | `close_bid_value_usd − entry_cost_usd` (realistic exit P&L) |
| `close_pnl_est_pct` | Close P&L as % of entry cost |

**Use `close_pnl_est_usd` for profit-taking decisions.**

---

## Tool reference (12 tools)

| Tool | Purpose |
|---|---|
| `callput_scan_spreads` | Primary market scan — ranked spread candidates + ATM IV |
| `callput_execute_spread` | Build unsigned open-position tx + collateral allowance check |
| `callput_get_request_key_from_tx` | Parse request_key from tx receipt after broadcast |
| `callput_check_request_status` | Poll keeper until executed/cancelled |
| `callput_portfolio_summary` | Collateral balance + positions + P&L (pass request_keys) |
| `callput_close_position` | Build unsigned close-position tx |
| `callput_settle_position` | Build unsigned settle tx for expired positions |
| `callput_close_all_positions` | Build one reviewed full-close tx per unexpired wallet position |
| `callput_settle_all_positions` | Build one reviewed settlement tx per expired wallet position |
| `callput_list_positions_by_wallet` | Recover request_keys from on-chain events (after session loss) |
| `callput_get_settled_pnl` | Realized payout history from SettlePosition events |
| `callput_get_option_chains` | Raw crypto/stock chain data + IV (use scan_spreads first) |

---

## One-line command examples

- `Scan TSLA bullish and build the rank 1 spread tx.`
- `Check my portfolio summary and P&L for address 0x...`
- `Close all positions expiring within 24 hours.`
- `Settle all expired ETH/BTC/TSLA/NVDA positions.`

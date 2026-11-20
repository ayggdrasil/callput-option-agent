# MCP Setup (Callput Lite)

## Existing Web3 wallet and account workflow — source v0.8.3

The source registers 25 tools: 13 existing market/direct-wallet tools plus 12 account workflow tools. On Robinhood/GIWA, use `callput_account_resolve`, `callput_workflow_start`, then follow `next_actions` through owner login, account creation, direct deposit, bounded device Grant and sponsored order. Read `callput://account/workflow` and use the exact prepared requests with your external owner and device signers. No browser page is required. Never pass owner/device private keys. Storage availability and scope are explicit in `callput_get_network_info.account_workflow`; missing encrypted persistent storage blocks execution.

Sponsored open preparation accepts a decimal string or a JSON number for `input.size`, a JSON number between 0.5 and 1 for `input.min_fill_ratio`, and a raw collateral integer string for `input.max_amount_in_raw`. If status identifies an invalid unsigned preparation, follow `next_actions` and supply corrected input with the original `action_id`. An expired unused grant must go through finalized recovery before preparing a new grant.

ETH BuyCallSpread is the default. Set one configured underlying and one supported spread strategy (one open and one close per 10-minute Grant). Owner=the device signer is forbidden by the account contract. Deposit amount, trade collateral cap, owner deposit gas and sponsor fees are separate. Direct deposit uses ERC20 transfer without approve. Robinhood fixes transfer nonce/gas/price before approval; GIWA direct deposits are blocked when a hard total fee bound cannot be enforced. Funded GIWA accounts can trade.

Runbook: [Account workflow](https://mcp.callput.app/account-workflow). See the [MCP-only Robinhood lifecycle](docs/robinhood-mcp-lifecycle.md) and the [Robinhood relay recovery runbook](docs/robinhood-relay-recovery.md). Deployment configuration and wallet-origin proxy: `docs/releases/2026-11-08-account-workflow.md`. Source registration and tests do not prove production rollout or a real fill.


This server is for external agents that should trade Callput crypto and synthetic stock/ETF options with minimal setup.

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

## Wallet and CallPut Account context

All three CallPut apps offer `email_otp` through Privy and `external_wallet` connections through wagmi. Email OTP connects a Privy embedded EVM owner wallet; external wallets connect directly without Privy wallet login or a connect-time signature. Social login providers are not enabled. Email and Privy user IDs are login identities, not signing addresses. Base trading uses direct wallet custody; GIWA and Robinhood app modes are deposit-only and may use a separate CallPut Account contract for funds and positions.

The connected owner wallet authorizes a separate CallPut Account holding collateral and positions. Use source v0.8.3 account workflow tools for session-relay execution. `execution_route="callput_account"` remains rejected by the original direct-wallet tools; use `callput_workflow_start` instead. For read-only portfolio or position-history calls, pass the actual address that holds the positions.

The v0.7.0 source accepts `execution_route="direct_wallet"` for writes. Base keeps its direct-wallet default when omitted; GIWA and Robinhood require the explicit route. Prepared transactions remain unsigned and must be reviewed and signed by the connected owner wallet. This source documentation does not mean the hosted MCP endpoint has been upgraded. Public frontend evidence: [Base bundle](https://app.callput.app/assets/index-dc9b0e57.js), [GIWA bundle](https://giwa.callput.app/assets/index-d5646322.js), [Robinhood bundle](https://robin.callput.app/assets/index-74211fbb.js), observed 2026-11-04; no real OTP, signature, or transaction test was performed.

## Collateral and compatibility

Call `callput_get_network_info` first. Its `collateral` object identifies the selected token's symbol, address, decimals and testnet status. Successful tool responses and the read-only asset API include the same metadata.

| Network | Collateral | Token address | Decimals |
| --- | --- | --- | --- |
| Base | USDC | `0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913` | 6 |
| Robinhood Chain | USDG (Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| GIWA Sepolia testnet | Test USDC | `0x79AD98fA252D64A9095f83cc6FaF4243E0d01d48` | 6 |

Legacy names such as `contracts.usdc`, `usdc_approval`, `usdc_balance`, `amount_in_usdc`, `estimated_open_fee_usdc` and `BANKR_MAX_USDC_RISK_PER_TRADE` remain for compatibility. On Robinhood they represent USDG collateral amounts and approval, not a separate USDC token. Never infer a token symbol from these keys. Native gas and execution fees use ETH. Bankr REST trading and the public Bankr app remain Base-only.


## Canonical names

- Source repo to clone: `https://github.com/ayggdrasil/callput-option-agent.git`
- MCP server id in client config: `callput-lite-agent-mcp`
- Package name in `package.json`: `callput-lite-mcp-skill`

## Supported underlyings

Crypto: `BTC`, `ETH`. Configured synthetic stock/ETF symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`. All 20 symbols have deployed option-token contracts; live availability is still feed-driven.

## Build

Use the verified checkout for source-only v0.7.0 wallet-context behavior. The hosted endpoint remains a separate release; do not assume it supports the v0.7.0 `execution_route` contract until that release is independently confirmed.

```bash
git clone https://github.com/ayggdrasil/callput-option-agent.git
cd callput-option-agent
npm install
npm run build
npm run verify
```

## MCP config

```json
{
  "mcpServers": {
    "callput-lite-agent-mcp": {
      "command": "node",
      "args": ["/absolute/path/callput-option-agent/build/src/index.js"],
      "env": {
        "RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

## Remote Streamable HTTP

```json
{
  "mcpServers": {
    "callput-lite-agent-mcp": {
      "url": "https://mcp.callput.app/api/mcp",
      "transport": "streamable-http"
    }
  }
}
```

The public endpoint requires no Callput API key. Signing remains in the client runtime. Current hosted v0.6.1 behavior and source v0.7.0 wallet-context behavior are distinct.

## Verify in client
- Call `callput_get_network_info` first; on v0.7.0 inspect its wallet-connection metadata before selecting an address or write route
- Call `callput_portfolio_summary` with the actual position-holding address
- Call `callput_scan_spreads` with `underlying_asset="ETH"` and `bias="bullish"`
- Call `callput_scan_spreads` with `underlying_asset="TSLA"` and `bias="bullish"` to verify stock-option feed support when available
- Call `callput_get_option_chains` for `ETH`, `TSLA`, `NVDA`, or `COIN` as optional raw chain inspection

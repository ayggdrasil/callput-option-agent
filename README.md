# Callput Lite MCP + Skill

## Existing Web3 wallet and account workflow — source v0.8.1

The source registers 25 tools: 13 existing market/direct-wallet tools plus 12 account workflow tools. On Robinhood/GIWA, use `callput_account_resolve`, `callput_workflow_start`, then follow `next_actions` through owner login, account creation, direct deposit, bounded device Grant and sponsored order. Open the returned app-origin wallet approval URL or use the exact prepared requests with an external signer. Never pass owner/device private keys. Storage availability and scope are explicit in `callput_get_network_info.account_workflow`; missing encrypted persistent storage blocks execution.

Set `underlying_asset` and `strategy` in `callput_workflow_start` before the owner signs the Grant. All configured option markets on Robinhood and GIWA support `BuyCallSpread`, `SellCallSpread`, `BuyPutSpread`, and `SellPutSpread` when quotes are available. Each 10-minute Grant authorizes one selected underlying and strategy, one open, and one close. Omitting the fields selects ETH and BuyCallSpread. Owner=the device signer is forbidden by the account contract. Deposit amount, trade collateral cap, owner deposit gas and sponsor fees are separate. Direct deposit uses ERC20 transfer without approve. Robinhood fixes transfer nonce/gas/price before approval; GIWA direct deposits are blocked when a hard total fee bound cannot be enforced. Funded GIWA accounts can trade.

Runbook: [Account workflow](https://mcp.callput.app/account-workflow). See the [Robinhood relay recovery runbook](docs/robinhood-relay-recovery.md). Deployment configuration and wallet-origin proxy: `docs/releases/2026-11-08-account-workflow.md`. Source registration and tests do not prove production rollout or a real fill.


Minimal documentation package for external agents (OpenClaw, Bankr, others) to trade Callput crypto and synthetic stock/ETF options on Base, Robinhood Chain and GIWA Sepolia.

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

All three CallPut apps currently offer `email_otp` through Privy and `external_wallet` connections through wagmi. Email OTP connects a Privy embedded EVM owner wallet; external wallet rows connect directly, without Privy wallet login or a connect-time signature. Social login providers are not enabled. Email and Privy user IDs are not signing addresses. Base trading uses direct wallet custody. GIWA and Robinhood app modes are deposit-only and can use a separate CallPut Account contract for funds and positions.

The owner wallet authorizes the distinct CallPut Account holding collateral and positions. Source v0.8.1 account workflows prepare and submit owner/device-authorized relay actions. The original unsigned tools still reject execution_route=callput_account; use callput_workflow_start instead. For portfolio/history, use the actual account holding the positions.

The MCP source accepts `execution_route="direct_wallet"` on write tools. Base may omit it for backward compatibility; GIWA and Robinhood require it explicitly. Direct-wallet preparation returns an unsigned transaction for the connected owner wallet to review and sign. It does not sign or broadcast. Inspect hosted initialization and runtime readiness; a source build does not establish a deployed version.

Observed public app bundles (2026-11-04): [Base](https://app.callput.app/assets/index-dc9b0e57.js), [GIWA](https://giwa.callput.app/assets/index-d5646322.js), [Robinhood](https://robin.callput.app/assets/index-74211fbb.js). These establish the shipped frontend configuration, not successful login, signature, or transaction tests.

## Collateral and compatibility

The legacy local sponsored-account adapter in `scripts/sponsored-account-mcp.mjs` is pinned to the pre-consolidation deployment and is not the production Robinhood path. It includes historical tools for account reads, owner authentication and sponsored opens. It does not alter the hosted unsigned MCP. `scripts/run-sponsored-trade.command` imports/unlocks a local encrypted keystore and runs the external-client validation through the two MCP connections. The user must enter secrets locally; no private key is accepted as an MCP argument. Current release status and the remaining live-trade verification are documented in `docs/releases/2026-11-05-sponsored-account-local.md`. This historical adapter was not proven by a live authenticated trade; the supported v0.8.0 installation path is the new account workflow above.

Call `callput_get_network_info` first. Its `collateral` object identifies the selected token's symbol, address, decimals and testnet status. Successful tool responses and the read-only asset API include the same metadata.

| Network | Collateral | Token address | Decimals |
| --- | --- | --- | --- |
| Base | USDC | `0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913` | 6 |
| Robinhood Chain | USDG (Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| GIWA Sepolia testnet | Test USDC | `0x79AD98fA252D64A9095f83cc6FaF4243E0d01d48` | 6 |

Legacy names such as `contracts.usdc`, `usdc_approval`, `usdc_balance`, `amount_in_usdc`, `estimated_open_fee_usdc` and `BANKR_MAX_USDC_RISK_PER_TRADE` remain for compatibility. On Robinhood they represent USDG collateral amounts and approval, not a separate USDC token. Never infer a token symbol from these keys. Native gas and execution fees use ETH. Bankr REST trading and the public Bankr app remain Base-only.


## Canonical Names
- **Source repo to clone:** `https://github.com/ayggdrasil/callput-option-agent.git`
- **MCP server id in agent config:** `callput-lite-agent-mcp`
- **Package name in `package.json`:** `callput-lite-mcp-skill`
- **Public setup page:** `https://mcp.callput.app/`
- **Remote Streamable HTTP MCP:** `https://mcp.callput.app/api/mcp`

Use the GitHub repo URL for `git clone`. Use the MCP server id only inside `mcpServers`.

## Answer Engine Facts
- **What is Callput Lite MCP?** A Model Context Protocol server and external-agent skill package for scanning Callput option spreads and building unsigned transaction payloads on Base, Robinhood Chain and GIWA Sepolia testnet.
- **Which GitHub should agents use?** Clone `https://github.com/ayggdrasil/callput-option-agent.git`; do not treat the MCP server id or package name as separate GitHub repositories.
- **Which MCP server should agents configure?** Use `callput-lite-agent-mcp` in the external runtime `mcpServers` config.
- **Does this MCP sign trades?** The wallet or device signer owns keys and signs. Direct-wallet tools return `unsigned_tx`; account workflow tools submit the exact externally signed action to the relay and track the result. Non-Base write preparation requires `execution_route="direct_wallet"` in the v0.7.0 source.
- **Can it support stock options?** Yes, for Callput synthetic stock/ETF option feed symbols when live contracts are available. These are on-chain synthetic options, not broker-listed equity options or tokenized stock ownership.
- **Which strategies are described?** Buy/sell call spreads, buy/sell put spreads, and composed butterfly or iron condor structures using the same spread workflow.

This package is designed for:
- minimal setup
- minimal context usage
- spread-only safe workflow for crypto and supported stock/ETF underlyings
- no Python SDK dependency on the external agent side

## What You Get
- MCP server over local `stdio` and public stateless Streamable HTTP
- Bankr App source package and validated REST adapter
- Ready-to-use `SKILL.md`
- OpenClaw/Bankr MCP config templates
- First-trade prompt templates
- Unsigned transaction flow by default; signing stays outside MCP
- Frontend V1 guidance console (`frontend-v1/`)
- Public Bankr conversion guide with a wallet-free deterministic demo (`bankr/`)

## Folder Contents
- `src/` : MCP server implementation
- `SKILL.md` : external agent skill policy
- `MCP_SETUP.md` : setup instructions
- `EXTERNAL_AGENT_PROMPT.md` : system prompt block
- `OPENCLAW_MCP_CONFIG.template.json` : OpenClaw config template
- `BANKR_MCP_CONFIG.template.json` : Bankr config template
- `FIRST_TRADE_PROMPTS.md` : copy-paste trading prompts
- `FRONTEND_V1_SPEC.md` : V1 product scope and boundaries
- `MCP_UI_CONTRACT.md` : tool-to-component 1:1 contract
- `ARCHITECTURE_V1.md` : frontend vs agent runtime responsibilities
- `FAQ.md` : operator FAQ
- `frontend-v1/` : static responsive UI for V1 guidance
- `bankr/` : public English Bankr guide, deterministic demo, and social preview asset
- `bankr-app/` : Bankr manifest, frontend, scripts, install prompt, and QA
- `api/` : Vercel Functions for remote MCP and Bankr endpoints
- `api/health` : sanitized Base RPC and live market-feed production health
- `.github/workflows/production-smoke.yml` : daily and manually triggered public production smoke checks

## Supported Underlyings
- Crypto: `BTC`, `ETH`
- Configured synthetic stock/ETF symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`
- Deployed option-token contracts: `BTC`, `ETH`, `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`, `SNDK`, `DRAM`, `META`, `GOOGL`, `AAPL`, `CRCL`, `AMZN`, `MSFT`, `PLTR`
- Live tradability is determined by the market feed. If a symbol has no available contracts, `callput_scan_spreads` returns no candidates.
- Stock options are synthetic on-chain options. They are not broker-listed options, shares, ETFs, or tokenized stock ownership.

## Market and direct-wallet tools (13 of 25 on account networks)
- `callput_get_network_info` — Bound network, contracts, symbols and environment
- `callput_scan_spreads` — Market scan with ranked spread candidates
- `callput_execute_spread` — Build unsigned spread transaction
- `callput_get_request_key_from_tx` — Extract request_key from receipt
- `callput_check_request_status` — Poll keeper status by request_key
- `callput_portfolio_summary` — Collateral balance + positions + P&L
- `callput_close_position` — Build unsigned close transaction
- `callput_settle_position` — Build unsigned settle transaction
- `callput_close_all_positions` — Build one reviewed full-close transaction per unexpired wallet position
- `callput_settle_all_positions` — Build one reviewed settlement transaction per expired wallet position
- `callput_list_positions_by_wallet` — Recover request_keys from events
- `callput_get_settled_pnl` — Realized payout history
- `callput_get_option_chains` — Raw option chains from market feed

## Quick Start

```bash
git clone https://github.com/ayggdrasil/callput-option-agent.git
cd callput-option-agent
npm install
npm run build
npm run verify
npm run verify:mcp
```

## Runtime Environment
- `RPC_URL` (optional)
- `CALLPUT_TRACKING_RPC_URL` (optional; transaction/receipt reconciliation RPC, defaults to `RPC_URL`)
  - default: `https://mainnet.base.org`
- `CALLPUT_PRIVATE_KEY` is not read by this MCP server. Configure private keys only in the external agent/signer runtime if that runtime requires one.
- `CALLPUT_ALLOWED_ORIGINS` (optional comma-separated browser origins)
- `BANKR_MAX_USDC_RISK_PER_TRADE` (legacy name; optional; default `100` selected-network collateral units, maximum six decimals)
- `CALLPUT_RATE_LIMIT_PER_MINUTE` (optional; default `60` per process/client/scope)
- `CALLPUT_MAX_EVENT_LOOKBACK_BLOCKS` (optional; default `100000`, hard maximum `500000`)
- `CALLPUT_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS` (optional; default `7200`, hard maximum `50000`; the normal fingerprint scan starts at `1800` recent Base blocks)
- `CALLPUT_MARKET_TIMEOUT_MS` (optional; default `8000`, allowed `25`–`60000`)
- `CALLPUT_RPC_TIMEOUT_MS` (optional; default `10000`, allowed `25`–`60000`)
- `CALLPUT_MAX_PORTFOLIO_REQUEST_KEYS` (optional; default `50`, hard maximum `200`)
- `CALLPUT_PORTFOLIO_REQUEST_CONCURRENCY` (optional; default `4`, hard maximum `20`)
- `CALLPUT_MAX_EXECUTION_FEE_WEI` (optional; default `300000000000000`, or `0.0003 ETH`)
- `POSTHOG_KEY` and `POSTHOG_HOST` (optional server-side telemetry; redacted logs are used when absent)

## Connect OpenClaw / Bankr
1. Local clients: copy `OPENCLAW_MCP_CONFIG.template.json` and point to `build/src/index.js`.
2. Bankr Skill: install `https://github.com/ayggdrasil/callput-option-agent/tree/v0.5.30/callput`.
3. Bankr MCP: add `https://mcp.callput.app/api/mcp` as HTTP with authentication `None`.
4. Visual Bankr flow: install `bankr-app/` using `bankr-app/INSTALL_PROMPT.md`. The public App supports scan, unsigned preparation, position viewing, and reconciliation; Bankr chat execution is currently disabled.
5. Run the read-only checks in `BANKR_GUIDE.md` before preparing any transaction.

## Frontend V1 (Guidance UI)

Open the static UI:

```bash
cd <repo_root>
python3 -m http.server 4173
```

Then visit `http://localhost:4173` or `http://localhost:4173/frontend-v1/`.
The Bankr guide is available at `http://localhost:4173/bankr/`.

## Production monitoring

- `GET /api/health` reports Base RPC and live market-feed status without returning provider URLs or secrets.
- `npm run smoke:production` checks health, the complete asset catalog, MCP initialization, and both public pages without signing or preparing a transaction.
- `npm run load:bankr` runs 100 production `scan -> prepare -> Base eth_call` cycles at concurrency 5 without signing or broadcasting. Override with `CALLPUT_LOAD_TOTAL`, `CALLPUT_LOAD_CONCURRENCY`, `CALLPUT_LOAD_TIMEOUT_MS`, or `CALLPUT_LOAD_RPC_URL`.
- GitHub Actions runs the smoke suite daily at 02:17 UTC and records failures in the repository Actions history. Repository notification rules should alert operators when the workflow fails.
- Live-trade canaries deliberately do not store a permanent write key. Run them from a capped test wallet under an ephemeral Bankr key, then revoke the key and clear allowance.

V1 flow in UI:
1. Direction setup
2. Option lookup
3. Execute spread
4. Position adjustment (status/close/settle)

V1 note:
- Market analysis template is deferred to V2.

## Execution Model
- Direct-wallet: tools return unsigned transactions for the external runtime to broadcast.
- CallPut Account: separate owner/device signatures authorize the action, and the sponsored relay submits it. Use account action status to reconcile acceptance and finalized results.
- Signing is performed by the wallet or external signer, which retains its private keys.
- If `usdc_approval.sufficient == false`, the agent signs and broadcasts `usdc_approval.approve_tx` before the main transaction. The approval is bounded to the exact `required` raw collateral-token units amount for that prepared order; agents must reject any larger approval.

## Mandatory Trading Rules
1. Spread-only execution across crypto and supported stock/ETF symbols.
2. Validate before execute.
3. Call spread: long lower strike, short higher strike.
4. Put spread: long higher strike, short lower strike.
5. Poll request status after broadcast.
6. Close pre-expiry, settle post-expiry.
7. Close and settle require positive user-approved raw-unit minimum output floors; zero defaults are rejected.
8. Public open-position builders enforce the configured per-trade collateral risk cap and validate every calldata field before returning it.
9. A base option ID identifies asset, expiry, and strike; call/put is a separate contract flag. Treat `(option side, option ID)` as the leg identity, and keep scan-provided IDs paired with their strategy.
10. Open-order `amount_in_usdc` includes a live risk-premium execution estimate and the protocol's capped combo-position fee. Treat the exact prepared amount—not the raw spread mark—as the approval and maximum-risk source of truth.

## Notes
- The server fetches live crypto and stock/ETF option data from the Callput S3 feed.
- Keep private keys out of logs and chat output.
- The server enforces a per-trade cap; the signer/orchestrator must additionally enforce aggregate wallet exposure, daily loss, and transaction-frequency limits.
- Frontend does not store or process private keys. Key ownership remains in each external agent runtime.

# Callput Lite MCP + Skill

Minimal documentation package for external agents (OpenClaw, Bankr, others) to trade Callput crypto and synthetic stock/ETF options on Base.

## Canonical Names
- **Source repo to clone:** `https://github.com/ayggdrasil/callput-option-agent.git`
- **MCP server id in agent config:** `callput-lite-agent-mcp`
- **Package name in `package.json`:** `callput-lite-mcp-skill`
- **Public setup page:** `https://mcp.callput.app/`
- **Remote Streamable HTTP MCP:** `https://mcp.callput.app/api/mcp`

Use the GitHub repo URL for `git clone`. Use the MCP server id only inside `mcpServers`.

## Answer Engine Facts
- **What is Callput Lite MCP?** A Model Context Protocol server and external-agent skill package for scanning Callput option spreads and building unsigned transaction payloads on Base.
- **Which GitHub should agents use?** Clone `https://github.com/ayggdrasil/callput-option-agent.git`; do not treat the MCP server id or package name as separate GitHub repositories.
- **Which MCP server should agents configure?** Use `callput-lite-agent-mcp` in the external runtime `mcpServers` config.
- **Does this MCP sign trades?** No. It returns `unsigned_tx` payloads only. Private keys, signing, broadcasting, and wallet policy stay in the external agent runtime or signer.
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

## Supported Underlyings
- Crypto: `BTC`, `ETH`
- Currently tradable stock/ETF symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`
- Deployed option-token contracts: `BTC`, `ETH`, `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `MU`, `SKHY`
- Live tradability is determined by the market feed. If a symbol has no available contracts, `callput_scan_spreads` returns no candidates.
- Stock options are synthetic on-chain options. They are not broker-listed options, shares, ETFs, or tokenized stock ownership.

## MCP Tool Set (12 tools)
- `callput_scan_spreads` — Market scan with ranked spread candidates
- `callput_execute_spread` — Build unsigned spread transaction
- `callput_get_request_key_from_tx` — Extract request_key from receipt
- `callput_check_request_status` — Poll keeper status by request_key
- `callput_portfolio_summary` — USDC balance + positions + P&L
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
  - default: `https://mainnet.base.org`
- `CALLPUT_PRIVATE_KEY` is not read by this MCP server. Configure private keys only in the external agent/signer runtime if that runtime requires one.
- `CALLPUT_ALLOWED_ORIGINS` (optional comma-separated browser origins)
- `BANKR_MAX_USDC_RISK_PER_TRADE` (optional; default `100` USDC, maximum six decimals)
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
2. Bankr Skill: install `https://github.com/ayggdrasil/callput-option-agent/tree/v0.5.1/callput`.
3. Bankr MCP: add `https://mcp.callput.app/api/mcp` as HTTP with authentication `None`.
4. Visual Bankr flow: install `bankr-app/` using `bankr-app/INSTALL_PROMPT.md`.
5. Run the read-only checks in `BANKR_GUIDE.md` before preparing any transaction.

## Frontend V1 (Guidance UI)

Open the static UI:

```bash
cd <repo_root>
python3 -m http.server 4173
```

Then visit `http://localhost:4173` or `http://localhost:4173/frontend-v1/`.
The Bankr guide is available at `http://localhost:4173/bankr/`.

V1 flow in UI:
1. Direction setup
2. Option lookup
3. Execute spread
4. Position adjustment (status/close/settle)

V1 note:
- Market analysis template is deferred to V2.

## Execution Model
- MCP preview/build mode: tools return unsigned transactions only. Nothing is signed or broadcast by the MCP server.
- Live execution: the external agent runtime signs and broadcasts `unsigned_tx` using its own wallet, HSM, Bankr signer, Ledger, or equivalent signer.
- If `usdc_approval.sufficient == false`, the agent signs and broadcasts `usdc_approval.approve_tx` before the main transaction. The approval is bounded to the exact `required` raw USDC amount for that prepared order; agents must reject any larger approval.

## Mandatory Trading Rules
1. Spread-only execution across crypto and supported stock/ETF symbols.
2. Validate before execute.
3. Call spread: long lower strike, short higher strike.
4. Put spread: long higher strike, short lower strike.
5. Poll request status after broadcast.
6. Close pre-expiry, settle post-expiry.
7. Close and settle require positive user-approved raw-unit minimum output floors; zero defaults are rejected.
8. Public open-position builders enforce the configured per-trade USDC risk cap and validate every calldata field before returning it.
9. A base option ID identifies asset, expiry, and strike; call/put is a separate contract flag. Treat `(option side, option ID)` as the leg identity, and keep scan-provided IDs paired with their strategy.

## Notes
- The server fetches live crypto and stock/ETF option data from the Callput S3 feed.
- Keep private keys out of logs and chat output.
- The server enforces a per-trade cap; the signer/orchestrator must additionally enforce aggregate wallet exposure, daily loss, and transaction-frequency limits.
- Frontend does not store or process private keys. Key ownership remains in each external agent runtime.

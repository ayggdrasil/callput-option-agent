# Callput Lite MCP + Skill

Minimal documentation package for external agents (OpenClaw, Bankr, others) to trade Callput crypto and synthetic stock/ETF options on Base.

## Canonical Names
- **Source repo to clone:** `https://github.com/ayggdrasil/callput-option-agent.git`
- **MCP server id in agent config:** `callput-lite-agent-mcp`
- **Package name in `package.json`:** `callput-lite-mcp-skill`
- **Public setup page:** `https://mcp.callput.app/`

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
- Minimal MCP server (`stdio`) with core tools only
- Ready-to-use `SKILL.md`
- OpenClaw/Bankr MCP config templates
- First-trade prompt templates
- Unsigned transaction flow by default; signing stays outside MCP
- Frontend V1 guidance console (`frontend-v1/`)

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

## Supported Underlyings
- Crypto: `BTC`, `ETH`
- Stock/ETF symbols in the Callput feed: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `CRCL`, `SAMSUNG`, `HYNIX`
- Deployed option-token contracts configured here: `BTC`, `ETH`, `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`
- Live tradability is determined by the market feed. If a symbol has no available contracts, `callput_scan_spreads` returns no candidates.
- Stock options are synthetic on-chain options. They are not broker-listed options, shares, ETFs, or tokenized stock ownership.

## MCP Tool Set (10 tools)
- `callput_scan_spreads` — Market scan with ranked spread candidates
- `callput_execute_spread` — Build unsigned spread transaction
- `callput_get_request_key_from_tx` — Extract request_key from receipt
- `callput_check_request_status` — Poll keeper status by request_key
- `callput_portfolio_summary` — USDC balance + positions + P&L
- `callput_close_position` — Build unsigned close transaction
- `callput_settle_position` — Build unsigned settle transaction
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

## Connect OpenClaw / Bankr
1. Copy template:
   - `OPENCLAW_MCP_CONFIG.template.json` or `BANKR_MCP_CONFIG.template.json`
2. Replace placeholders:
   - `<repo_root>`
   - signer/private-key settings in your external runtime, if that runtime requires them
3. Restart agent runtime.
4. Run first prompts from `FIRST_TRADE_PROMPTS.md`.

## Frontend V1 (Guidance UI)

Open the static UI:

```bash
cd <repo_root>
python3 -m http.server 4173
```

Then visit `http://localhost:4173` or `http://localhost:4173/frontend-v1/`.

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
- If `usdc_approval.sufficient == false`, the agent signs and broadcasts `usdc_approval.approve_tx` before the main transaction.

## Mandatory Trading Rules
1. Spread-only execution across crypto and supported stock/ETF symbols.
2. Validate before execute.
3. Call spread: long lower strike, short higher strike.
4. Put spread: long higher strike, short lower strike.
5. Poll request status after broadcast.
6. Close pre-expiry, settle post-expiry.

## Notes
- The server fetches live crypto and stock/ETF option data from the Callput S3 feed.
- Keep private keys out of logs and chat output.
- For production use, add your own notional/risk limits at orchestrator layer.
- Frontend does not store or process private keys. Key ownership remains in each external agent runtime.

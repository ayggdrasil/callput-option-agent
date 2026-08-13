# Callput × Bankr Guide

Callput can be used in Bankr in two complementary ways:

1. **Callput Bankr App** — the lowest-friction visual trade builder for users.
2. **Remote MCP** — exposes all twelve Callput tools to the Bankr agent.

Both integrations build unsigned Base transactions. Callput never receives a private key and never broadcasts a trade. Bankr displays the final transaction and requires the signed-in user to confirm it.

## Install the Callput Skill

Paste this stable release URL into Bankr:

`https://github.com/ayggdrasil/callput-option-agent/tree/v0.5.11/callput`

The public Skill teaches the agent when and how to call the MCP. Installing the Skill does not automatically add the per-wallet MCP server below.

## Production endpoints

- Bankr App API: `https://mcp.callput.app/api/bankr/*`
- Streamable HTTP MCP: `https://mcp.callput.app/api/mcp`
- Chain: Base mainnet (`8453`)

## Install the remote MCP

In Bankr Terminal, open the MCP/Tools settings and add:

- Name: `callput-lite-agent-mcp`
- URL: `https://mcp.callput.app/api/mcp`
- Transport: HTTP
- Authentication: None

Bankr labels this transport `HTTP`; the endpoint itself implements Streamable HTTP.

Verify with a read-only prompt:

> List the Callput MCP tools, then scan one TSLA bullish spread. Do not prepare, sign, or submit a transaction.

## Install the Bankr App

The source package is in `bankr-app/`. Paste `bankr-app/INSTALL_PROMPT.md` into Bankr Terminal, or create the files under `/apps/callput-options/` using Bankr's file editor.

Required permissions are intentionally minimal: `read:wallet`, `fetch:http`, and `prepare:transaction`. The app uses viewer identity, so each signed-in visitor prepares a transaction for their own Bankr wallet.

## Trade flow

1. Select an underlying and market view.
2. Scan ranked, risk-defined spreads.
3. Select one candidate and enter size.
4. Review wallet, Base network, strategy, and maximum USDC at risk.
5. If needed, open the bounded USDC approval in Bankr chat, send and approve it there, then choose the spread again to refresh the allowance.
6. Open the Callput order review in Bankr chat and explicitly send and approve it there.
7. Return to the app and reconcile the exact prepared intent fingerprint to read its request key and keeper status from Base.

## Position lifecycle

- **Close one position before expiry:** refresh positions, enter explicit positive raw-USDC minimum output floors, choose the unexpired position, and review `callput_close_position` in Bankr chat.
- **Settle one position after expiry:** refresh positions, enter an explicit positive raw swap floor, choose the expired position, and review `callput_settle_position`.
- **Close all open positions:** `callput_close_all_positions` discovers every unexpired Callput token in the signed-in wallet and builds one full-close transaction per position.
- **Settle all expired positions:** `callput_settle_all_positions` discovers every expired Callput token and builds one settlement transaction per position.

Each batch item requires its own Bankr transaction review and explicit approval. The app prepares a queue but never loops through confirmations, signs, broadcasts, or treats a chat handoff as proof of submission. Refresh the portfolio after completing the reviews; close requests can also be reconciled by their exact intent fingerprint.

For buy spreads, `maximum_usdc_at_risk` is the prepared debit including the live risk-premium execution estimate and capped combo-position fee. For sell spreads it is the collateral plus the capped combo-position fee passed into Callput. The native `execution_fee_wei` is shown separately.

## Safety boundaries

- Prepared transactions must target Base and the deployed Callput PositionManager, with calldata decoding to `createOpenPosition`.
- USDC approvals must target Base USDC and the deployed Callput Router.
- Every prepared field is rebound to the validated request, and maximum risk defaults to 100 USDC per trade.
- Market data older than five minutes is rejected.
- Close/settle requests require explicit positive minimum-output floors and verified position ownership/lifecycle.
- The app cannot auto-confirm or broadcast.
- `bankr.confirmTransaction()` is a chat handoff with a `Promise<void>` contract; the app never treats its return as a signature, broadcast, receipt, or transaction hash.
- Stock/ETF products are synthetic on-chain options, not broker-listed contracts or stock ownership.

## Telemetry

Only allowlisted funnel events are accepted. Wallets are hashed before analytics capture. Prompt text, private keys, authorization headers, and raw calldata are never sent. On-chain `GenerateRequestKey` and keeper status are authoritative. Without `POSTHOG_KEY`, redacted structured logs are used and product calls continue.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| MCP initialization fails | Confirm `/api/mcp`, Streamable HTTP, and support for JSON plus event-stream responses. |
| No spread candidates | Try another live symbol/bias; availability comes from the market feed. |
| Approval is shown | Open the bounded approval in Bankr chat, send and approve it there, then return and choose the spread again before opening the order review. |
| Keeper status is pending | Wait for Base confirmation and refresh. |
| Keeper check is `not_found` | A chat handoff alone proves nothing was submitted. If you did send the order in Bankr, retry after the RPC provider indexes the canonical receipt/log. Fingerprint reconciliation scans 1,800 recent Base blocks by default and is capped by `CALLPUT_MAX_INTENT_RECONCILE_LOOKBACK_BLOCKS`. |

## Rollback

Roll Vercel back to the prior deployment and remove/disable the Bankr App listing. Existing on-chain requests remain queryable through Callput contracts.

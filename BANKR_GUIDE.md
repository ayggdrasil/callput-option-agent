# Callput × Bankr Guide

Callput can be used with Bankr in two distinct ways:

1. **Callput Bankr App** — a visual scanner, unsigned transaction builder, position viewer, and transaction reconciler.
2. **Remote MCP** — exposes all twelve Callput tools to an agent runtime and an authorized external signer.

Both integrations build unsigned Base transactions. Callput never receives a private key and never broadcasts a trade. **Bankr chat execution is currently unavailable for production use:** repeated live tests rejected valid Callput calldata during Bankr's simulation step even when the same transaction succeeded through Base RPC simulation and Bankr Wallet API.

The supported production boundary is `Callput MCP → authorized external signer → Base → Callput reconciliation`. Bankr Wallet API/CLI is an advanced separately configured alternative that requires a user-managed write key; it is not the public App chat flow.

## Install the Callput Skill

Paste this stable release URL into Bankr:

`https://github.com/ayggdrasil/callput-option-agent/tree/v0.5.29/callput`

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

Required permissions are intentionally minimal: `read:wallet`, `fetch:http`, and `prepare:transaction`. The app stores no private key, signature, or reviewed trade state. It uses viewer identity, so each signed-in visitor prepares a transaction for their own Bankr wallet.

## Supported trade flow

1. Sign in to the public App to use the viewer wallet for scanning and preparation.
2. Select an underlying, market view, candidate, and size.
3. Review the wallet, Base network, strategy, exact risk, allowance requirement, and native execution fee.
4. Use Callput MCP with an authorized external signer to review and submit any required bounded approval and the freshly prepared order.
5. Advanced Bankr operators may instead configure Bankr Wallet API/CLI with a user-managed write key. Do not create or expose a write key merely to use the public App.
6. Copy the successful Base transaction hash, return to the App, and run the keeper check. The backend verifies the exact PositionManager transaction and wallet before returning its request key and keeper status.

## Position lifecycle

- **Close one position before expiry:** use `callput_close_position` through MCP, enter explicit positive raw-USDC minimum output floors, then submit its unsigned transaction through an authorized external signer.
- **Settle one position after expiry:** use `callput_settle_position` through MCP with an explicit positive raw swap floor, then submit through an authorized external signer.
- **Close all open positions:** `callput_close_all_positions` discovers every unexpired Callput token in the signed-in wallet and builds one full-close transaction per position.
- **Settle all expired positions:** `callput_settle_all_positions` discovers every expired Callput token and builds one settlement transaction per position.

Each batch item requires its own external review and explicit authorization. The MCP never signs, broadcasts, or auto-confirms a queue. Refresh the portfolio after successful submission; close requests can also be reconciled by their exact intent fingerprint.

For buy spreads, `maximum_usdc_at_risk` is the prepared debit including the live risk-premium execution estimate and capped combo-position fee. For sell spreads it is the collateral plus the capped combo-position fee passed into Callput. The native `execution_fee_wei` is shown separately.

## Safety boundaries

- Prepared transactions must target Base and the deployed Callput PositionManager, with calldata decoding to `createOpenPosition`.
- USDC approvals must target Base USDC and the deployed Callput Router.
- Every prepared field is rebound to the validated request, and maximum risk defaults to 100 USDC per trade.
- Market data older than five minutes is rejected.
- Close/settle requests require explicit positive minimum-output floors and verified position ownership/lifecycle.
- The public App cannot auto-confirm or broadcast, and its Bankr chat execution controls are disabled.
- A successful transaction hash and canonical receipt—not preparation, simulation, or a chat handoff—are required before Callput reports submission.
- Stock/ETF products are synthetic on-chain options, not broker-listed contracts or stock ownership.

## Telemetry

Only allowlisted funnel events are accepted. Wallets are hashed before analytics capture. Prompt text, private keys, authorization headers, and raw calldata are never sent. On-chain `GenerateRequestKey` and keeper status are authoritative. Without `POSTHOG_KEY`, redacted structured logs are used and product calls continue.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| MCP initialization fails | Confirm `/api/mcp`, Streamable HTTP, and support for JSON plus event-stream responses. |
| No spread candidates | Try another live symbol/bias; availability comes from the market feed. |
| Bankr chat reports `simulation_reverted` | Do not keep retrying the public App chat path. Verify the unsigned payload against current Base state, then use Callput MCP with an authorized external signer. |
| Approval is required | Review the canonical Base USDC token, Callput Router spender, and bounded amount through the authorized external signer; then prepare a fresh order after the approval is confirmed. |
| Keeper status is pending | Wait for Base confirmation and refresh. |
| Keeper check is `not_found` | Unsigned preparation proves nothing was submitted. Paste the exact successful Base transaction hash and retry after the RPC provider indexes the canonical receipt/log. The backend rejects failed, foreign-wallet, and non-PositionManager transactions. |

## Rollback

Roll Vercel back to the prior deployment and remove/disable the Bankr App listing. Existing on-chain requests remain queryable through Callput contracts.

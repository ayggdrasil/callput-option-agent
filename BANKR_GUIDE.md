# Callput × Bankr Guide

Callput can be used in Bankr in two complementary ways:

1. **Callput Bankr App** — the lowest-friction visual trade builder for users.
2. **Remote MCP** — exposes all ten Callput tools to the Bankr agent.

Both integrations build unsigned Base transactions. Callput never receives a private key and never broadcasts a trade. Bankr displays the final transaction and requires the signed-in user to confirm it.

## Production endpoints

- Bankr App API: `https://mcp.callput.app/api/bankr/*`
- Streamable HTTP MCP: `https://mcp.callput.app/api/mcp`
- Chain: Base mainnet (`8453`)

## Install the remote MCP

In Bankr Terminal, open the MCP/Tools settings and add:

- Name: `callput-lite-agent-mcp`
- URL: `https://mcp.callput.app/api/mcp`
- Transport: Streamable HTTP
- Authentication: none

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
5. If needed, confirm a bounded USDC approval.
6. Confirm the Callput order in Bankr.
7. Check the latest request to read the request key and keeper status from Base.

For buy spreads, `maximum_usdc_at_risk` is the debit. For sell spreads it is the collateral amount passed into Callput. The native `execution_fee_wei` is shown separately.

## Safety boundaries

- Prepared transactions must target Base and the deployed Callput PositionManager, with calldata decoding to `createOpenPosition`.
- USDC approvals must target Base USDC and the deployed Callput Router.
- The app cannot auto-confirm or broadcast.
- Stock/ETF products are synthetic on-chain options, not broker-listed contracts or stock ownership.

## Telemetry

Only allowlisted funnel events are accepted. Wallets are hashed before analytics capture. Prompt text, private keys, authorization headers, and raw calldata are never sent. On-chain `GenerateRequestKey` and keeper status are authoritative. Without `POSTHOG_KEY`, redacted structured logs are used and product calls continue.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| MCP initialization fails | Confirm `/api/mcp`, Streamable HTTP, and support for JSON plus event-stream responses. |
| No spread candidates | Try another live symbol/bias; availability comes from the market feed. |
| Approval is shown | Confirm the bounded approval first, then the order. |
| Keeper status is pending | Wait for Base confirmation and refresh. |
| No recent request found | Use a transaction hash/request key or increase the block lookback. |

## Rollback

Roll Vercel back to the prior deployment and remove/disable the Bankr App listing. Existing on-chain requests remain queryable through Callput contracts.

# Callput Bankr App Integration Design

Date: 2026-08-05  
Status: Approved and implemented
Repository: `ayggdrasil/callput-option-agent`

## 1. Objective

Ship a public Bankr integration that lets a signed-in Bankr user discover a
Callput spread, review its bounded risk, confirm an unsigned Base transaction
through the Bankr wallet, and reconcile the resulting on-chain request.

The integration must also measure the first 50–100 genuine user trade attempts
from discovery through keeper outcome. It must not manufacture volume or place
50–100 project-funded trades.

## 2. Success Criteria

1. `mcp.callput.app` exposes working Vercel Functions for Bankr and a remote MCP
   endpoint without adding an AWS API Gateway.
2. A Bankr App can complete this flow:
   asset selection → spread scan → risk preview → transaction preparation →
   Bankr confirmation → on-chain reconciliation.
3. The existing local `stdio` MCP remains compatible.
4. Server-side telemetry distinguishes product clicks from verified on-chain
   requests and keeper outcomes.
5. Automated tests cover happy paths, invalid inputs, RPC/feed failures,
   unsigned-transaction safety, telemetry redaction, and reconciliation.
6. A no-value production smoke test validates deployed endpoints.
7. One smallest-practical live canary may be submitted only after the user
   confirms the Bankr wallet, asset, exact maximum loss, and transaction preview
   at action time.

## 3. Non-Goals

- Generating artificial volume.
- Custodying private keys or signing inside Callput services.
- Changing Callput contracts or adding an on-chain referral field.
- Building an always-on AWS keeper watcher in this iteration.
- Making Callput a built-in Bankr venue without Bankr team review.
- Claiming Bankr-native distribution before the App is public and observable.

## 4. Current State and Constraints

- `mcp.callput.app` is a Vercel static project. `/mcp` currently returns 404.
- The canonical MCP implementation uses `StdioServerTransport`, so it cannot be
  registered by Bankr as a remote HTTP/SSE server today.
- Core Callput functions already read a public S3 market feed, query Base RPC,
  and build unsigned transactions. They do not require AWS credentials.
- The existing Bankr guide references obsolete `/agent/sign` and
  `/agent/submit` paths. Current Bankr wallet APIs use `/wallet/*`, while Bankr
  Apps use `bankr.tx.prepare` plus `bankr.confirmTransaction`.
- Bankr MCP servers and skills are installed per wallet. A public Bankr App has
  lower activation friction than remote MCP alone.
- The parent workspace is heavily dirty. All implementation will be isolated to
  this canonical nested repository and this task branch.

## 5. Chosen Approach

Build a public Bankr App backed by thin HTTP endpoints on the existing Vercel
project. Reuse the same tool definitions to expose a stateless Streamable HTTP
MCP endpoint. Preserve the current `stdio` entry point.

This combines immediate App distribution, agent compatibility, and measurable
transactions without creating new AWS infrastructure.

## 6. Architecture

```text
Bankr user
  -> Callput Bankr App
     -> mcp.callput.app/api/bankr/assets
     -> mcp.callput.app/api/bankr/scan
     -> mcp.callput.app/api/bankr/prepare
     -> Bankr bankr.tx.prepare / confirmTransaction
     -> Base transaction
     -> mcp.callput.app/api/bankr/reconcile
     -> PostHog-compatible server telemetry

Remote agents
  -> mcp.callput.app/api/mcp (stateless Streamable HTTP)
     -> shared Callput tool registry

Local agents
  -> build/src/index.js (stdio)
     -> shared Callput tool registry
```

### 6.1 Shared Tool Registry

Move MCP server creation and tool registration out of the process-bound
`src/index.ts` entry point into a reusable module. Both transports instantiate
the same tools and call the existing `src/core.ts` functions.

The registry must not read private keys, sign transactions, broadcast
transactions, or persist secrets.

### 6.2 Remote MCP

Add a Vercel Function at `/api/mcp` using stateless Streamable HTTP. Plain JSON
responses are preferred to long-lived SSE because the tools are request/response
operations and Vercel Functions are ephemeral.

Supported methods:

- `POST`: initialize, list tools, and call tools.
- `GET`: protocol-compatible informational response or transport response.
- `DELETE`: protocol-compatible stateless response.
- `OPTIONS`: CORS preflight.

The endpoint will expose the same ten tools as `stdio`.

### 6.3 Bankr REST Adapter

The Bankr App should not need to construct MCP protocol envelopes. It receives a
small, stable JSON surface:

- `GET /api/bankr/assets`
  - Returns live supported assets, current spot, expiries, and feed freshness.
- `POST /api/bankr/scan`
  - Input: `underlying_asset`, `bias`, optional `max_results`.
  - Output: ranked spreads with cost/credit, max profit/loss, IV, and expiry.
- `POST /api/bankr/prepare`
  - Input: wallet, strategy, leg IDs, size, optional minimum fill ratio.
  - Output: normalized risk preview, optional USDC approval transaction, and
    unsigned Callput transaction.
- `POST /api/bankr/reconcile`
  - Input: wallet, expected transaction identity, preparation block/time, and
    optional transaction hash or request key.
  - Output: detected transaction/request key, receipt state, and keeper state.
- `POST /api/bankr/events`
  - Accepts only an allow-listed event schema. It never accepts arbitrary event
    names, private keys, authorization headers, prompts, or raw calldata.

All write-looking endpoints still produce or inspect unsigned/on-chain data.
Only Bankr performs wallet confirmation and submission.

### 6.4 Bankr App Package

Add a source-controlled `bankr-app/` directory containing:

- `manifest.json`
- `index.html`
- server scripts for assets, scan, prepare, reconcile, and telemetry
- an installation/publishing prompt for Bankr
- a manual QA checklist

The App uses viewer identity. Backend scripts call the public Callput HTTP API.
The prepare script converts the returned transaction into a Bankr transaction
button. The frontend calls `confirmTransaction` only after displaying:

- synthetic on-chain product disclosure
- underlying, strategy, expiry, and strikes
- debit or collateral requirement
- maximum loss
- Callput contract destination
- Base chain ID 8453

The App never auto-confirms a transaction.

## 7. Transaction and Attribution Flow

1. App creates a random `flow_id` before the first scan.
2. Each HTTP request carries `flow_id` and `source=bankr_app`.
3. `prepare` returns an `intent_fingerprint` derived from normalized wallet,
   chain ID, contract destination, calldata, value, and preparation block.
4. The Bankr App stores only `flow_id`, `intent_fingerprint`, and minimum
   reconciliation metadata in viewer-scoped App storage.
5. After `confirmTransaction` resolves, the App calls `reconcile`.
6. Reconciliation validates Base receipts/events rather than trusting a client
   claim. If no transaction hash is available from the Bankr SDK, it scans a
   tightly bounded block window for `GenerateRequestKey(account, key, isOpen)`
   and checks the related position request account and transaction destination.
7. Keeper status is polled with bounded retries and may be refreshed manually.

This attribution is application-level. It does not change the Callput contract
and must not be marketed as cryptographically permanent referral attribution.

## 8. Telemetry

Allow-listed events:

- `app_view`
- `scan_success`
- `transaction_prepared`
- `wallet_confirmed`
- `onchain_detected`
- `keeper_executed`
- `cancelled`

Event properties are limited to flow ID, anonymous wallet hash, asset, strategy,
expiry bucket, size/risk bucket, latency, error code, transaction hash when
publicly available, request key, chain ID, and App version.

No prompt text, IP address, email, social handle, private key, API secret, raw
authorization header, or full calldata is sent to analytics.

The authoritative metrics are:

- Activated Bankr trader: first `keeper_executed` per verified wallet.
- Attempted trade: `wallet_confirmed`.
- Submitted/on-chain trade: `onchain_detected`.
- Failed trade: confirmed intent that ends in cancellation, timeout, or a
  categorized reconciliation failure.
- First-100 report: verified on-chain requests grouped by unique wallet, asset,
  strategy, keeper outcome, and failure stage.

When telemetry credentials are absent, the API returns success to product calls
and writes a redacted structured log. Telemetry must never block trading.

## 9. Validation and Error Handling

### Input Validation

- Reject unsupported assets and strategies.
- Validate EVM addresses and Base chain ID.
- Bound `max_results`, size, and minimum fill ratio.
- Verify spread leg order and matching underlying/expiry/type.
- Reject stale market data based on an explicit freshness threshold.

### Transaction Validation

- Destination must be an allow-listed Callput or USDC contract.
- Chain must equal 8453.
- Transaction value must stay within the known execution-fee envelope.
- Calldata selector must match an approved method.
- `from` must match the Bankr viewer wallet.
- Risk preview must be computed server-side from validated legs.

### Failure Categories

- `INVALID_INPUT`
- `UNSUPPORTED_MARKET`
- `STALE_MARKET_DATA`
- `RPC_UNAVAILABLE`
- `INSUFFICIENT_USDC`
- `APPROVAL_REQUIRED`
- `TRANSACTION_REJECTED`
- `TRANSACTION_REVERTED`
- `REQUEST_NOT_FOUND`
- `KEEPER_CANCELLED`
- `RECONCILE_TIMEOUT`
- `INTERNAL_ERROR`

User-facing errors remain short and actionable. Server logs retain redacted
diagnostic context and a correlation ID.

## 10. Security and Abuse Controls

- No signing keys or Bankr API keys in Callput code or Vercel environment.
- Strict CORS allow-list for the Bankr App and documented MCP clients; local
  development origins allowed only outside production.
- Host validation and request content-type checks on remote MCP.
- Per-IP and per-flow rate limits when the deployment tier supports them;
  conservative in-process fallback limits for initial traffic.
- Maximum request body size and bounded RPC/block scans.
- Schema validation on every endpoint.
- No arbitrary RPC URL, contract address, analytics event, or HTTP callback in
  user input.
- Security headers and `no-store` on wallet-specific responses.
- Structured redaction tests for wallet hashes and error logs.

## 11. Testing Strategy

### Unit Tests

- Shared MCP registry returns identical tool names for `stdio` and HTTP.
- Bankr request schemas and error mapping.
- Transaction allow-list and selector validation.
- Risk-preview normalization.
- Telemetry allow-list and redaction.
- Reconciliation matching and bounded-block behavior.

### Integration Tests

- MCP initialize/list/call over stateless Streamable HTTP.
- Bankr assets/scan/prepare API using mocked feed and Base provider.
- Approval-required and approval-sufficient branches.
- Receipt/revert/request/keeper lifecycle fixtures.
- CORS, OPTIONS, unsupported method, and body-limit behavior.

### Existing Regression Tests

- `npm run verify`
- `npm run verify:mcp`
- Existing stock/ETF support tests.

### Deployment Smoke Tests

- Public page remains available.
- `/api/mcp` initializes and lists tools.
- Bankr REST assets and scan endpoints return valid Base data.
- Prepare endpoint builds, but does not submit, an allowed unsigned transaction.
- Reconcile rejects fabricated or out-of-window evidence.

### Live Canary

The live canary is the smallest executable debit spread under a user-approved
maximum loss. Before confirmation, report the wallet, balance requirement,
asset, strikes, expiry, premium, maximum loss, transaction destination, and
execution fee. Stop if the user does not approve or the Bankr wallet is not
funded.

## 12. Deployment and Rollback

1. Deploy a Vercel preview from the task branch.
2. Run automated and preview smoke tests.
3. Merge/push only focused repository changes.
4. Deploy production functions under `mcp.callput.app/api/*` without changing
   the public root page contract.
5. Create the Bankr App while signed in, import/copy the source-controlled App
   files, and keep it unlisted for QA.
6. Run no-value QA and transaction preparation.
7. Publish the App only after QA passes.
8. Run the approved live canary.
9. Monitor verified keeper outcomes and first-100 funnel metrics.

Rollback consists of reverting the Vercel deployment and unlisting the Bankr
App. No contract migration or AWS rollback is required.

## 13. Operational Deliverables

- Source and tests for Vercel REST and remote MCP.
- Updated Vercel routing/build configuration.
- Source-controlled Bankr App package.
- Corrected Bankr and MCP documentation.
- Environment-variable template for telemetry.
- Deployment and rollback runbook.
- First-100 metric definition and PostHog dashboard instructions.
- Preview and production smoke-test evidence.
- Live-canary evidence only after transaction approval.

## 14. Explicit Decisions

- Vercel first; no new AWS API Gateway.
- Public App first; native Bankr venue integration later.
- Remote MCP is additive, not the only distribution path.
- Stateless Streamable HTTP; no long-lived SSE dependency.
- On-chain keeper outcome is the authoritative conversion metric.
- No artificial transaction generation.
- No private-key handling by Callput.

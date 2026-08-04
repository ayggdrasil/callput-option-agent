# Callput × Bankr Implementation Plan

**Goal:** Ship a production Vercel-hosted Streamable HTTP MCP endpoint and a Bankr App package that can scan Callput markets, prepare bounded Base transactions, reconcile on-chain execution, and measure the real conversion funnel.

## 1. Preserve the existing MCP contract

- Extract the ten tool registrations from `src/index.ts` into a reusable server factory.
- Keep `src/index.ts` as the stdio entry point.
- Add an in-process MCP protocol test so both transports expose the same tools.

## 2. Add the public HTTP MCP boundary

- Add a stateless Web Standard Streamable HTTP handler.
- Permit `POST` and preflight `OPTIONS`; reject unsupported methods clearly.
- Enforce bounded request sizes, production host checks, and an explicit origin allowlist.
- Add a Vercel Function at `/api/mcp` and retain all existing static routes.

## 3. Add Bankr-facing REST functions

- `GET /api/bankr/assets`: live supported assets and spot prices.
- `POST /api/bankr/scan`: ranked spreads from the existing market engine.
- `POST /api/bankr/prepare`: validated unsigned Base transaction, approval requirement, maximum loss, and stable intent fingerprint.
- `POST /api/bankr/reconcile`: transaction receipt/request-key/keeper status reconciliation.
- `POST /api/bankr/events`: allowlisted, redacted funnel telemetry.
- Validate all input with Zod and verify chain ID, destination contract, sender, and calldata before returning a transaction.

## 4. Package the Bankr App

- Add a minimal manifest, frontend, and Bankr backend scripts.
- Use `bankr.tx.prepare` on the backend and `bankr.confirmTransaction` in the frontend.
- Persist only non-secret app state and explicit transaction/request identifiers.
- Include installation, publication, QA, and rollback instructions.

## 5. Verify, deploy, and connect

- Run unit/protocol tests, existing offline verification, live feed/RPC smoke tests, and a production build.
- Deploy the linked Vercel project and validate `/api/mcp` plus every read-only Bankr route at `mcp.callput.app`.
- Push the integration branch if repository credentials permit.
- Connect the remote MCP and publish/install the Bankr App after Bankr authentication.
- Run no-value QA first. Before any live canary, show the wallet, chain, exact transaction(s), amount, fees, and maximum loss for explicit approval.

## 6. Measure real adoption

- Record `app_view`, `scan_success`, `transaction_prepared`, `wallet_confirmed`, `onchain_detected`, `keeper_executed`, and `cancelled`.
- Treat on-chain `GenerateRequestKey` and keeper state as authoritative.
- Report the first 50–100 genuine trade funnel; do not manufacture activity.

# Architecture V1 (Frontend Guidance + Agent-Owned Execution)

## Existing Web3 wallet and account workflow — source v0.8.3

The source registers 25 tools: 13 existing market/direct-wallet tools plus 12 account workflow tools. On Robinhood/GIWA, use `callput_account_resolve`, `callput_workflow_start`, then follow `next_actions` through owner login, account creation, direct deposit, bounded device Grant and sponsored order. Open the returned app-origin wallet approval URL or use the exact prepared requests with an external signer. Never pass owner/device private keys. Storage availability and scope are explicit in `callput_get_network_info.account_workflow`; missing encrypted persistent storage blocks execution.

The initial account opening strategy is ETH BuyCallSpread (one open/one close, 10-minute Grant). Owner=the device signer is forbidden by the account contract. Deposit amount, trade collateral cap, owner deposit gas and sponsor fees are separate. Direct deposit uses ERC20 transfer without approve. Robinhood fixes transfer nonce/gas/price before approval; GIWA direct deposits are blocked when a hard total fee bound cannot be enforced. Funded GIWA accounts can trade.

Runbook: [Account workflow](https://mcp.callput.app/account-workflow). Deployment configuration, wallet-origin proxy and recovery boundaries: `docs/releases/2026-11-08-account-workflow.md`. Source registration and tests do not prove production rollout or a real fill.


## Core Principle
The frontend is an operator guidance interface.
Execution authority remains in each external agent runtime.

## Runtime Topology

Hosted account workflows use a dedicated Neon Free Postgres database or persistent no-eviction REST Redis. Postgres stores sealed ciphertext with atomic database-clock row leases and fenced checkpoints; quota exhaustion fails closed. The static schema is `deploy/account-workflow.sql`, with no public grants or record TTL. `CALLPUT_WORKFLOW_DATABASE_URL` and the stable encryption key are production-only secrets. Local SQLite remains available for persistent single-host stdio.
1. Frontend UI
2. Agent runtime (OpenClaw/Bankr or equivalent)
3. Skill + MCP (this repository)
4. Callput contracts on Base, Robinhood Chain, or GIWA Sepolia

## Responsibilities
- Frontend
  - Explain operational sequence
  - Display MCP tool contract and expected output format
  - Provide copyable prompts/config templates
- Agent runtime
  - Own key management
  - Execute tool calls
  - Persist internal data and risk controls
- MCP server
  - Fetch market data
  - Reject stale or malformed market data and mismatched option-token encodings
  - Validate spreads, per-trade risk, transaction calldata, native fee, ownership, lifecycle, and slippage floors
  - Build unsigned requests only; never sign or broadcast
  - Bound public request rate, body size, RPC duration, event lookback, and portfolio fanout

## Out of Scope for V1 Frontend
- Key storage
- Direct transaction signing
- Agent private runtime logs
- Agent-specific data persistence

## Security Statement
- `CALLPUT_PRIVATE_KEY` is never entered in frontend forms.
- Skill and MCP setup references only environment-level key management.
- The Bankr App uses viewer identity and requires Bankr confirmation for every approval and order.
- Public open-position preparation defaults to a maximum risk of 100 selected-network collateral units per trade; aggregate exposure remains the external signer's responsibility.
- Reconciliation accepts only a transaction hash, request key, or a prepared intent fingerprint. It must never select an arbitrary latest wallet request.
- Fingerprint reconciliation verifies the wallet, successful receipt, PositionManager destination, and PositionManager event provenance inside a bounded recent-block window; callers retry when the RPC has not indexed a canonical receipt yet.

## Network isolation

`src/networkDeployments.ts` holds fixed public deployment manifests verified against the reference sites. `src/config.ts` uses AsyncLocalStorage so every MCP callback receives an immutable selection snapshot. The compatibility CONFIG proxy reads that context; no HTTP parameter mutates process environment or global addresses. HTTP query values are allowlisted and fail closed. Stdio selects CALLPUT_NETWORK at startup.

Each tool callback is bound when its server is created, including validation after awaited core calls. Market cache and in-flight fetch entries are chain-specific. RPC validation keys include chain ID and provider URL. Responses carry network, chain_id and testnet. Existing transaction destination, USDC, spender, risk, freshness and lifecycle checks resolve from the same context.

The same 12 lifecycle tools are available through each connection plus callput_get_network_info. No new signing/broadcast authority exists. Bankr REST trade routes remain Base-bound; their non-Base selectors reject explicitly. Asset status is scoped and can be unavailable when upstream feeds are stale.

### Collateral discovery (0.6.1)

Network discovery and successful MCP results expose collateral symbol/address/decimals/testnet metadata. Robinhood uses USDG; Base and GIWA use USDC, with GIWA explicitly testnet. Legacy USDC amount, balance, approval and risk-policy identifiers remain compatible. The transaction address, scaling, spender validation and unsigned-only boundary do not change.

### Wallet and account compatibility

`src/walletContext.ts` owns network-bound login metadata and the direct-wallet execution guard. All five MCP write callbacks check the route before market or RPC I/O. Base omission remains compatible; GIWA and Robinhood require explicit `execution_route="direct_wallet"`. Account session execution is rejected on every network. The MCP does not acquire browser authentication, Privy signing access, account sessions or relay authority.

The selected-network guidance distinguishes an email identity, the connected EVM owner wallet, and a separate CallPut Account holding funds/positions. Read-only tools accept the actual holder address. App account orders, sponsored session operations and relay UUIDs stay outside the direct-wallet unsigned transaction/request-key workflow. Version 0.7.0 is a local source update, with no hosted deployment claim.

### Separate local sponsored-account adapter (5 November source)

`scripts/sponsored-relay.mjs` implements one owner's relay protocol, with fixed GIWA/Robinhood origins and independently verified canonical account/factory/beacon/implementation state. `scripts/sponsored-account-mcp.mjs` exposes eight local tools; it is read-only without an injected local signer. Browser cookies are never copied: the local owner signs a domain/chain-bound SIWE challenge, and the resulting cookies remain only in that adapter process.

`scripts/sponsored-storage.mjs` reserves a single0.1collateral-unit authorization in an exclusive durable budget record before signing and encrypts the device key for recovery. The session permits one ETH buy-call open, no closes or withdrawals, and lasts10minutes. Request ID, nonce and signature survive a dropped response; concurrent changed orders reject. `scripts/run-sponsored-trade.mjs` uses MCP clients for hosted reads and local account operations, then requires successful receipt provenance, executed keeper state and a matching position delta to report success. No user key/password enters MCP tool parameters or the hosted server. Owner authentication and a bounded session grant were observed, but no order or fill is verified; the existing local keystore is now locked; deployment and published tool counts are unchanged.

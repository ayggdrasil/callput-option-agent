# Architecture V1 (Frontend Guidance + Agent-Owned Execution)

## Core Principle
The frontend is an operator guidance interface.
Execution authority remains in each external agent runtime.

## Runtime Topology
1. Frontend UI
2. Agent runtime (OpenClaw/Bankr or equivalent)
3. Skill + MCP (this repository)
4. Callput.app contracts on Base

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
- Public open-position preparation defaults to a 100 USDC maximum risk per trade; aggregate exposure remains the external signer's responsibility.
- Reconciliation accepts only a transaction hash, request key, or a prepared intent fingerprint. It must never select an arbitrary latest wallet request.
- Fingerprint reconciliation verifies the wallet, successful receipt, PositionManager destination, and PositionManager event provenance inside a bounded recent-block window; callers retry when the RPC has not indexed a canonical receipt yet.

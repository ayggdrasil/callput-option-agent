# Robinhood account relay implementation plan

**Goal:** Use the relay's direct-trade nonce space and reconcile a durable account order without creating replacement authorization on uncertainty.

**Architecture:** The MCP journals the immutable EIP-712 order before submitting it under its action UUID. Relay admission and later status observations are distinct. Expiry recovery releases only the same grant and cap after independent finalized evidence. Direct-wallet tools keep their existing behavior.

- [x] In `src/accountFlow_test.ts`, reproduce nonce zero and uint256 exhaustion, 400 followed by 404, loss before/after admission, restart, and unused expiry recovery. Run `npm run build && node --test build/src/accountFlow_test.js` and confirm failures expose existing behavior.
- [x] In `src/accountWorkflow.ts`, allocate decimal uint256 nonces at or above `1n << 128n`; persist before signing; keep admission and observation evidence separate; reuse only the immutable UUID, digest and signature on retry.
- [x] In `src/accountChain.ts`, verify the expired grant's counters and specific nonce bits at the same canonical finalized block. Preserve submitted orders when relay evidence or finalized state is unavailable. Tie fills to the configured PositionManager at finality.
- [x] Update MCP descriptions and publish a runbook covering browser vs MCP, auth ambiguity, signed order reconciliation and archive RPC requirements.
- [x] Run the full automated test suite and MCP smoke, screen the branch for secrets, and confirm the live host version separately.
- [ ] Push the review branch.

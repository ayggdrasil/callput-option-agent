# Robinhood MCP Account lifecycle

**Goal:** Let an external agent with separate owner/device signers discover and complete the supported Robinhood Account lifecycle entirely through MCP.

- Verify new-account login/create/deposit and asynchronous observation with mock chain and relay. Creation is idempotent by UUID and can also be verified from pinned account state.
- Add exact selected spread quote inputs to open, close-only permission with zero opening allowance, and owner-login settlement without a live device grant. Keep the strategy, collateral, position and signature checks.
- Add owner-signed collateral withdrawal with canonical finalized transfer proof and no device authorization. Keep pending actions pinned to the original UUID.
- Expose an ordered signer contract and per-action arguments in the MCP resource. Disclose market, signer and keeper boundaries; no real order or account mutation is used for validation.
- Test fault handling and complete tool-driven fixture, then verify discovery on the hosted release if production authorization applies.

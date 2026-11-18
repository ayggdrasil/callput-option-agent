# Robinhood Account relay and recovery

Use the Robinhood MCP connection for chain **4663**, **USDG (6 decimals)** and the separate CallPut Account that holds the funds. Set one supported asset and spread strategy before preparing a grant. The owner approves the grant and a distinct device signs trades. Base direct wallet activity uses Base/USDC and does not use the Account workflow or this nonce allocator.

## Why nonce zero failed

The browser and hosted MCP use the Robinhood relay at `https://app.callput.app/relay/robinhoodchain`. The production source reference is [CallPut app/relay rollout merge b1a66c65](https://github.com/alanxxzero/callput/commit/b1a66c65); in the relay source see `engine.ts` (`admitTrade`), `wire.ts`, and `reservations.ts`. The browser uses `frontend/src/networks/relayBase.ts` and `frontend/src/utils/sessionKeyStore.ts`.

| Path | Trade nonce |
| --- | --- |
| Direct `POST /v1/trades`, fresh client request UUID | Decimal uint256 string in `[2^128, 2^256-1]` |
| Legacy relay-issued trade reservation | Allocated in `[0, 2^128-1]` and tied to the existing reservation |
| Account contract | Checks the full uint256 nonce bitmap per account/session; no lower-half rejection |

The EIP-712 domain binds chain and account; the intent binds session, epoch, nonce, deadline and trade parameters. Per-session nonce bits are separate from the owner bitmap per epoch and from an EOA transaction nonce. The relay's uniqueness key is chain/account/scope/nonce (`trade:<sessionId>`). For a fresh UUID, a validly signed nonce of zero can pass the account bitmap check but fails relay admission with HTTP 400 `trade_nonce_range_invalid` before the outbox insertion. A subsequent GET can return 404. In 0.8.0 MCP allocated from zero without making a relay trade reservation. The fix allocates from `2^128` without changing any already prepared/signed envelope. The older standalone sponsored adapter had the same nonce error; it uses legacy deployment pins and is not a replacement for the current hosted Account workflow.

## Observe an order

1. Keep the workflow capability and any signature in encrypted storage. Share only necessary public chain evidence with operators; the relay UUID also grants access to the public status projection.
2. Poll `callput_action_status` for the original action. The durable journal links digest, relay request UUID, grant/session, nonce, deadline, transaction hash and PositionManager request key. Admission and poll results are separate. An explicit nonce-range 400 is a pre-admission rejection; a lost/malformed response is ambiguous. Neither a 400 nor a later 404 cancels a signed order.
3. If the submit response was lost, first observe the same UUID. Only an exact retry of that UUID, envelope and signature is eligible after a clean miss, within the original deadline and with no earlier admission/transaction or definite rejection. The relay locks that UUID and deduplicates the same digest. A retry cannot change fees, nonce, trade parameters, or revive an expired authorization.
4. Inclusion checks the canonical receipt, sponsor/account/calldata, signed `SessionRequest` and PositionManager `GenerateRequestKey`. The keeper status must agree with the same key and account at a finalized block. Cancellation of relay transport and keeper cancellation are different. Execution additionally requires the expected position change; if the portfolio was subsequently changed, the operator may need to verify the fill and position events historically.

The browser's IndexedDB shares the relay protocol, not the MCP journal. Its signer and local orders are separate. Opening the app, clearing browser data, or posting a browser trade cannot reconcile an existing MCP order.

## Recover an expired grant

For an unused grant such as the incident's TSLA grant, observe expiry and call `callput_workflow_recover` on the existing workflow. It verifies account/factory/implementation and zero opens, closes, amount and fees at a canonical finalized block after grant expiry. It archives the evidence and restores the opportunity to request a fresh grant with the original policy. Grant preparation still checks the relay's account-wide grant recovery and refuses other pending reservations. A fresh grant requires explicit new owner approval.

A saved signed open or close can use this recovery only when it belongs to that grant, is expired, has no known admission or transaction/request key, the same relay UUID has a fresh 404 `not_found`, and the nonce bit and session counters prove no use at the same finalized block. Its archived reason is `finalized_unused_expired`, distinct from a keeper cancellation. A signed settlement, an observed operation, a used nonce or nonzero counters requires separate reconciliation. Missing historical state preserves the reservation.

For manual reconciliation, use the existing IDs to review the relay outbox and attempt/transaction history, including any retry variants, and the owner-scoped trade recovery route for a known row. A missing row does not replace chain evidence. Use a chain-4663 archive RPC supporting canonical hash-tagged calls (`CALLPUT_ROBINHOOD_TRACKING_RPC_URL`). Verify account/implementation and obtain finalized session counters and `sessionNonceUsed(sessionId, nonce)` after both deadlines. If used, find the matching `SessionRequest(sessionId, nonce, digest)`, confirm the receipt and PositionManager key, then verify finalized keeper execution/cancellation. If a full finalized log scan shows no event, retain the scanned range and block hashes as corroboration; do not override the MCP workflow reservation when its required proof is unavailable. The relay could improve operations with durable no-admission receipts keyed by UUID/digest and archival proofs keyed by grant/session. Do not create a replacement order while reconciling.

If login **preparation** loses its response, repeat the advertised prepare call for the same durable MCP action. The relay API may issue another short-lived SIWE challenge because it has no challenge idempotency key; this does not create an account/order and no lost challenge is signed. If **verification** consumes the challenge but the owner cookie is lost, reconnect the owner explicitly with a fresh challenge. Preserve all existing trading actions. A lost cookie alone cannot be used to recover an authenticated session.

## Incident readback (2026-11-18 KST)

The production host returned 0.8.0 and listed 25 tools. The ETH relay lookup returned HTTP 404 `not_found` without a transaction hash. A scan of finalized Robinhood blocks 116501110–116530000 (timestamps 1794910605–1794913670), covering the ETH grant's validity window, returned zero `SessionRequest` events for the session. Latest state read zero counters for both sessions and `false` for the ETH nonce zero. The public RPC returned “historical state … is not available” for both sessions' counters and for the nonce at finalized block 117207247. These observations corroborate non-use; they do not supply the workflow's required proof. The existing ETH action is unresolved and neither reservation was changed.

## Release verification

Source version is 0.8.1. Before any rollout, configure the archive tracking RPC, keep the existing encrypted workflow storage and key, and package the local signer separately if updating its download (`npm run build && node scripts/export-account-signer.mjs`). After rollout, verify the live `initialize` version, `tools/list`, network/collateral metadata, supported account policy and wallet approval route. A source push, preview, or mock fill is not a production deployment or a live trade.

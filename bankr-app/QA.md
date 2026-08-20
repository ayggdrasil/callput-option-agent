# Callput Bankr App QA

## Read-only gate

- App renders in light and dark themes.
- Anonymous viewers see sign-in and cannot invoke scripts.
- `assets` returns Base chain ID 8453 and live symbols.
- `scan` returns candidates or a clear feed-availability error.
- The frontend makes no direct external `fetch` call.
- Manifest contains only `read:wallet`, `fetch:http`, and `prepare:transaction`.

## Transaction-preparation gate

- Use an operator-approved wallet.
- Display the synthetic/non-ownership disclosure, wallet, asset, strategy, positive size, maximum USDC at risk, and native execution fee in both ETH and wei.
- Destination is `0x83B04701B227B045CBBAF921377137fF595a54af` on Base.
- Approval, if needed, shows Base USDC, spender `0xfc61ba50AE7B9C4260C9f04631Ff28D5A2Fa4EB2`, and its exact USDC amount before confirmation.
- The visible App states `Bankr chat execution unavailable` and does not market the handoff as production-ready.
- Order, close, settle, close-all, and settle-all chat confirmation controls remain disabled.
- Preparation still displays the exact wallet, destination, value, calldata-bound intent fingerprint, allowance, and maximum risk.
- Paste a successful Base transaction hash from an authorized external signer into the App and verify reconciliation rejects malformed, failed, foreign-wallet, and non-PositionManager transactions while resolving the exact valid Callput request.
- Empty scans explain how to recover; invalid or zero size is rejected before preparation; status and errors are announced and errors move focus to the message.
- The frontend contains no reachable `bankr.confirmTransaction()` call while the availability boundary is disabled.
- Run the keeper check without a successful transaction hash. Loading and not-found messages must not imply confirmation, submission, request creation, or eventual indexing.
- Confirm no transaction during no-value QA.

## External-signer canary gate

- Obtain action-time approval for wallet, asset, strategy, size, maximum loss/collateral, approval amount, native value, and transaction previews.
- Confirm only the approved transaction(s) through the explicitly configured external signer.
- Reconcile `GenerateRequestKey` and keeper status from Base.
- Verify telemetry contains no prompts, secrets, or calldata.

## Public listing gate

- Viewer execution uses the viewer wallet, never the app owner's wallet.
- Public description states that products are synthetic on-chain options.
- Verify the scan/prepare/view/reconcile public surface before directory publication. Do not claim public chat execution until Bankr fixes its simulator and a fresh unrelated-account canary passes.

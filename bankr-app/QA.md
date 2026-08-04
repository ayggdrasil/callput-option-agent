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
- Display wallet, asset, strategy, size, maximum USDC at risk, and native execution fee.
- Destination is `0x83B04701B227B045CBBAF921377137fF595a54af` on Base.
- Approval, if needed, targets Base USDC with spender `0xfc61ba50AE7B9C4260C9f04631Ff28D5A2Fa4EB2`.
- Closing the Bankr modal broadcasts nothing and leaves the app usable.
- Confirm no transaction during no-value QA.

## Live canary gate

- Obtain action-time approval for wallet, asset, strategy, size, maximum loss/collateral, approval amount, native value, and transaction previews.
- Confirm only the approved transaction(s).
- Reconcile `GenerateRequestKey` and keeper status from Base.
- Verify telemetry contains no prompts, secrets, or calldata.

## Public listing gate

- Viewer execution uses the viewer wallet, never the app owner's wallet.
- Public description states that products are synthetic on-chain options.
- Complete one approved canary before directory publication.

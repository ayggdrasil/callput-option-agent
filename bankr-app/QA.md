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
- On a new Bankr account, open Chat and accept the Terms of Service before the first transaction handoff. A pre-acceptance request may remain on `working` or `thinking`; start a new chat after accepting the terms.
- When approval is needed, `Open Bankr transaction review` must open only the approval handoff. Send and approve it in Bankr, then use `I approved it — refresh allowance` so the original reviewed order is restored without a moving-price rescan.
- Open the approval in full Bankr chat, return to the App, and verify the exact reviewed transaction is restored from Bankr private app storage for the same wallet. Repeat after an App reload. Another wallet and a session older than 30 minutes must not restore it.
- After the order handoff, open full Bankr chat, return to the App, and verify the exact intent fingerprint remains available to the keeper check.
- Empty scans explain how to recover; invalid or zero size is rejected before preparation; status and errors are announced and errors move focus to the message.
- Opening or closing the Bankr chat handoff broadcasts nothing and leaves the app usable. The app must say that nothing was submitted and must never emit `wallet_confirmed` from `confirmTransaction()`, whose return value only acknowledges the handoff.
- Open and close an order handoff without sending it, then run the keeper check. Loading and not-found messages must not imply confirmation, submission, request creation, or eventual indexing.
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

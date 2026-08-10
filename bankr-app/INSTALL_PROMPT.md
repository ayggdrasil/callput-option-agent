# Bankr installation prompt

Paste into a signed-in Bankr Terminal chat:

> Build and install a Bankr App named **Callput — Stock, ETF & Crypto Options** with slug `callput-options`. Use viewer identity. It must use only `read:wallet`, `fetch:http`, and `prepare:transaction`. Copy the manifest, `index.html`, and five top-level backend scripts exactly from the immutable Callput release directory `bankr-app/`: https://github.com/ayggdrasil/callput-option-agent/tree/v0.4.3/bankr-app . Do not add an agent invocation, secret, schedule, swap, transfer, signature, or automatic execution permission. Run only `assets` and `scan` for owner QA. Do not run `prepare` or `track` during no-value QA. Audit all permissions before publication.

Then ask:

> Open `callput-options`. Run `assets` and `scan` for TSLA bullish with one result. Do not invoke `prepare` and do not request transaction confirmation. Show the script outputs and permission errors.

After owner QA passes:

> Audit the manifest one final time and make `callput-options` public. Confirm the directory listing describes synthetic on-chain crypto, stock, and ETF option spreads and states they are not broker-listed securities or ownership.

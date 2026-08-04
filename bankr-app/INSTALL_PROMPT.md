# Bankr installation prompt

Paste into a signed-in Bankr Terminal chat:

> Build and install a Bankr App named **Callput — 24/7 Stock & ETF Options** with slug `callput-options`. Use viewer identity. It must use only `read:wallet`, `fetch:http`, and `prepare:transaction`. Copy the manifest, `index.html`, and five top-level backend scripts exactly from the public Callput repository directory `bankr-app/`: https://github.com/ayggdrasil/callput-option-agent/tree/codex/bankr-app-integration/bankr-app . Do not add an agent invocation, secret, schedule, swap, transfer, signature, or automatic execution permission. Run each read-only script, audit all permissions, and leave the app private until QA passes.

After the branch is merged, replace the branch segment in the URL with `main`.

Then ask:

> Open `callput-options`. Run `assets` and `scan` for TSLA bullish with one result. Do not invoke `prepare` and do not request transaction confirmation. Show the script outputs and permission errors.

After read-only QA passes:

> Audit the manifest and make the app unlisted for a no-value viewer test. Do not list it publicly yet.

# Account workflow source release — 8 November 2026

This release adds 12 account tools beside the existing 13 direct-wallet/market/lifecycle tools. Source version is 0.8.0. Production deployment, persistent store provisioning, app-origin wallet routes and real execution must be verified separately; do not infer them from a source build.

## Installation and persistent state

Hosted/serverless deployments require a 32-byte hex `CALLPUT_WORKFLOW_ENCRYPTION_KEY` and either dedicated Postgres or REST Redis credentials. Postgres accepts `CALLPUT_WORKFLOW_DATABASE_URL` (or `CALLPUT_WORKFLOW_POSTGRES_URL`); apply `deploy/account-workflow.sql` to that dedicated DB. Neon Free is supported: no paid upgrade or overages, quota exhaustion blocks operations. `scripts/initialize-workflow-postgres.mjs <expected-project-id>` initializes and tests only the explicitly matching dedicated project, with disposable ciphertext records. SQL row claims/checkpoints use database-clock leases; expired writers cannot overwrite or unlock their replacements. No active workflow records have automatic expiry.

Redis accepts `CALLPUT_WORKFLOW_REDIS_URL` / `CALLPUT_WORKFLOW_REDIS_TOKEN`, or Marketplace aliases `CALLPUT_WORKFLOW_KV_REST_API_URL/TOKEN` and `CALLPUT_WORKFLOW_UPSTASH_REDIS_REST_URL/TOKEN`. Use a persistent no-eviction database. Values in both backends are AES-256-GCM encrypted with workflow-specific associated data. Keep the encryption key stable for unresolved workflows. These operator secrets are environment settings, never MCP arguments.

For a single persistent Node host/local stdio, set `CALLPUT_WORKFLOW_DIRECTORY` to an owner-only durable directory and the encryption key. File storage requires Node 22+ and uses SQLite WAL/FULL durability with encrypted values and transactional per-workflow ownership records. A lock is reclaimed only when its recorded process on the same host is provably dead; live, reused-PID and foreign-host locks are not stolen on a timeout. A child-process SIGKILL regression verifies committed submission state survives restart. File mode is disabled on Vercel; do not point a serverless deployment at `/tmp` and call it durable. Missing storage returns a structured blocked state.

Archive-capable historical verification can use `CALLPUT_ROBINHOOD_TRACKING_RPC_URL` / `CALLPUT_GIWA_TRACKING_RPC_URL`. Regular reads use the existing per-network RPC variables. An unavailable historical state keeps receipt/expired-session proofs unverified.

## Wallet approval routes

Export the static page/assets with `node scripts/export-wallet-approval.mjs /absolute/path/to/a/clean/app-public-staging-directory`, then include them in the selected app's normal static release. Robinhood's approval page must run at `https://robin.callput.app/mcp-wallet.html`, GIWA's at `https://giwa.callput.app/mcp-wallet.html`. Keep these .html/asset paths on the static CloudFront origin rather than the private /v1 relay origin. For deployments using a public TLS reverse proxy instead, `deploy/account-wallet.nginx.conf` is an alternative; do not apply that snippet to the private relay listener without the corresponding distribution routing. This preserves the relay SIWE requesting domain. The static approval page and local ethers asset come from the matching MCP release; its API calls use the exact approved app Origin and workflow capability. No third-party analytics or remotely loaded wallet script is used.

The browser discovers existing wallets through EIP-6963 / EIP-1193. It does not import owner keys. Its distinct device key is encrypted in IndexedDB with a non-extractable AES key; owner=grant signer is forbidden by the actual account contract. Wallet changes invalidate further signing. A durable wallet-begin marker precedes the prompt, and encrypted result records survive a lost submission reply.

The workflow ID is a private capability and must not be put in logs, analytics, query strings or shared screenshots. Approval links put it in the URL fragment. Cookies and signed results remain in encrypted server storage and are omitted from public status responses. An external signer runtime may use the exact prepared RPC requests and submit their results without this browser UI; keep device private keys inside that runtime.

## Agent runbook

1. Discover network info and `account_workflow`. Resolve owner/sub-index/account using the pinned manifest.
2. Start with explicit deposit amount and deposit gas cap, and a total collateral cap. Values are decimal raw integers. No deposit occurs merely by starting a workflow.
3. Connect via `callput_wallet_connect` or the returned approval link. External signers provide owner, confirmed chain ID and a separate device **public** signer address.
4. Follow `next_actions` and `callput_action_prepare`: login, create if absent, transfer if needed, register Grant. Read exact summary, signer, domain/types/message/digest or transfer calldata. Default grant permits one ETH buy-call open, one close and no withdrawals, for ten minutes.
5. Before a wallet prompt call `callput_action_begin`. Only `wallet_request_may_execute:true` permits a new prompt. Submit the exact returned signature/hash through `callput_action_submit`. Creation uses an empty result because the relay sponsors it. Interrupted/rejected prompts can explicitly review the same unchanged action through `callput_action_retry_wallet`; transfers retain the original nonce and fee fields.
6. Read `callput_action_status` / `callput_workflow_status`. A transfer needs its exact receipt/Transfer proof. A grant needs independently observed installation. Open/close need exact account calldata, matching account/manager request events, canonical mined-block pins, keeper execution and position delta.
7. Use `callput_session_revoke` to prepare the owner-signed revocation, then submit and observe it. `callput_workflow_recover` releases only a finalized expired zero-use grant with no saved signed order; it preserves the user's original cap.

`callput_action_prepare` supports open input `{size:"0.0001",min_fill_ratio:0.78}`, close input `{option_token_id,size_raw,min_amount_out_raw}`, settle input `{option_token_id}`, and empty input for other steps. JSON input/output schemas and tool descriptions are the runtime contract. A tool error is returned as `state:blocked` with a safe reason; it does not claim that a request was never sent.

## Scope and fee boundaries

Opening support is explicitly ETH BuyCallSpread, one open and one close per grant. Existing direct-wallet tools retain their previous strategy coverage. Do not advertise all account strategies as supported by this workflow. User collateral cap, owner deposit amount, owner native gas cap and sponsor-native Grant caps are separate.

Robinhood deposit transactions fix the token, recipient, amount, chain, nonce, gas limit and gas price before approval. Nitro gas estimation includes parent posting gas units. Receipt validation also enforces unchanged nonce and fee bounds. GIWA OP L1 fees cannot be hard-capped by these EOA fields, so this release blocks direct deposits with `deposit_total_fee_bound_unavailable`. Funded GIWA accounts retain the account trading route. Sponsored deposits require a separately verified token/relay authorization route; a permit alone is not a transfer.

The legacy one-owner keystore scripts are historical validation utilities, not the installation route for this release. Their encrypted owner/session/budget files are not migrated, deleted or decrypted by the new workflow. Reconcile any existing authorization before creating a replacement; no old budget was released by this implementation work.

## Validation record

Final full `npm test` passed with exit 0, including all 19 account tests. Coverage includes signature/keeper/position flow, close token-ID matching, response loss, grant-preparation retries, grant conflict denial, revoked-action priority, login recovery, SQLite SIGKILL recovery, SQLITE_BUSY cleanup and Marketplace environment aliases. Deposit regressions verify canonical JSON-RPC quantities (nonce 0x7 rather than 0x07) and rejection of false-returning ERC20 transfers before wallet approval; both were observed failing before their fixes. The first sandboxed run could not bind its localhost test server; the approved rerun passed. MCP smoke passed 25 registered tools plus real spread/chain reads. Syntax and git diff checks passed.

Independent security reviewer reported no remaining actionable P0/P1/P2 after fixes. Browser QA used a disposable mock owner and wallet/API in ego space11: login and Grant signatures verified, a distinct encrypted browser device was created, and a lost transfer-submission response recovered the saved hash with exactly one wallet send. This is not a real-wallet or chain-transfer test. The space and local static server were closed.

Live read-only resolution passed on both networks, including current factory proxy implementation pins and the existing Robinhood legacy account. Public proof is recorded in account-workflow-live.json. The user keystore and old budget/session files were not changed.

Production project/domain was verified through the existing Vercel CLI: frontend/prj_vbfKIcrdNufonCAQGu5VRUTSvWnf owns mcp.callput.app. The connected Vercel tool returned misleading404s, so its documented same-scope CLI fallback was used. No workflow DB exists; an Upstash installation exists with zero resources, and quoted plans are billable (Pay As You Go $0.20 per100K commands). New billing approval is pending. No database, environment secret or production deployment was created. Default AWS credentials/profiles are absent, so app static upload access is also unresolved. Exported files are ready for the normal app static release.

Automatic approval review rejected DB provisioning because “use Vercel” did not explicitly authorize the recurring paid plan, resource name and production scope. Exact approval for callput-mcp-workflows on the verified project's production environment has been requested. Do not retry through another execution path before approval. No resource was created by the rejected attempt.

The user subsequently approved the paid DB subject to a $1/day limit. Official Upstash budget documentation and its update-budget API specify monthly limits only; Vercel Spend Management excludes Marketplace integrations. The installed product metadata also exposes no budget creation field (additionalProperties:false). Do not treat a $30/month cap as satisfying $1/day or provision without the requested cost control. A stricter $1/month alternative has been offered and awaits a choice; actual Marketplace budget configuration/readback still needs verification before traffic is connected. No provisioning was attempted after this conditional approval.

Budget references: https://upstash.com/docs/common/account/faq, https://upstash.com/docs/devops/developer-api/redis/update_budget, https://vercel.com/docs/spend-management.

2026-11-08 follow-up: the user approved a $1/month cap. Provisioned callput-mcp-workflows with no connected projects, eviction/autoUpgrade/prodPack disabled (store_Y6yZUtFs8kvuuk4D; external ID 0aca77cc-5271-4571-8483-ef90a4795cf8). Actual Upstash Vercel SSO console rejected budget=1 with “Budget must be at least $20”; Update stayed disabled. No $20 budget was applied. The new DB had 0 commands, 0B storage, $0.00 cost, and no project connections. It was removed after exact ID/name/empty-project verification; CLI deletion returned removed:true. No environment secrets or operating deployment were changed. Earlier “zero resources” notes reflected an incomplete CLI result: the installation contains other unrelated DBs, which were not modified. A supported $1 cap remains unavailable; do not claim the DB or hosted account workflow is ready.

Operating rollout and real user wallet signatures/deposit/trade remain unverified. Do not advertise the hosted MCP as v0.8.0 or the account workflow as operational until storage, the app-origin approval pages and hosted tool/readiness smoke are actually deployed.

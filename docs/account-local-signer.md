# Local keystore signer for the account MCP

This optional Node 22+ runtime uses the public Robinhood MCP tools. It supports one selected spread on a funded account with a total cap of 100000 raw (0.1 USDG). Deposits and owner transactions are disabled. It completes after the MCP verifies the receipt, keeper execution and position increase.

Download `https://mcp.callput.app/frontend-v1/downloads/callput-account-signer-0.8.0.tgz` and its `.sha256` file from the same release. Verify the checksum, extract into a private directory, then run `npm ci --omit=dev --ignore-scripts`. The archive contains public runtime code and a pinned dependency lock, never workflow capabilities, passwords, keys or user records.

1. Using the Robinhood MCP connection, call `callput_get_network_info` and `callput_account_resolve`. Pass your selected `underlying_asset` and `strategy` to `callput_workflow_start` along with your owner address, `deposit_amount_raw:"0"`, `max_user_amount_raw:"100000"`, and `max_deposit_gas_wei:"0"`.
2. Create `.account-workflows` inside the extracted runtime with mode 700. Save the full workflow-start JSON to `.account-workflows/robinhood-live-workflow.json` with mode 600. This private capability must never go in shared logs or URLs.
3. Keep your existing encrypted owner keystore at `~/Library/Application Support/CallputSigner/owner.json`, mode 600. The address must match the workflow. Do not send its password, private key or recovery phrase to the MCP or a chat. This runtime does not import a new owner key.
4. Run `node scripts/run-account-workflow.mjs --check`. This checks hosted readiness and the exact workflow without opening the keystore or signing.
5. Run `node scripts/run-account-workflow.mjs` in your own interactive Terminal. Review the printed account and total limit, then enter the existing keystore password into its hidden local prompt. The password never becomes a command argument, environment variable or MCP parameter.

The runtime creates a separate device signer and encrypts it plus original action results with a password-derived key in local SQLite. A per-workflow process lock prevents two runners from signing simultaneously. It persists each result before submission and observes the original action after an unknown result. Never reset the journal or start a second Grant to escape an error. Read the stored progress/error files and use MCP action status.

An existing legacy `robinhood.budget.json` blocks every new Grant/open signing or submission, including a prepared or cached action. Reconcile it with independent finalized proof and explicit authorization before resuming. This runtime does not delete or release that budget. Keep the same password and all journal files while its Grant is unresolved.

The returned app-origin browser approval link is a separate signing option. If that page has not been deployed by the app operator, use this local runtime; do not spoof browser Origin or weaken SIWE domain checks. Native trade fees remain protocol-sponsored. No native transaction is sent by this local runtime.

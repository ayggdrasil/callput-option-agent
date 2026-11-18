# FAQ (Frontend V1)

## Existing Web3 wallet and account workflow — source v0.8.0

The source registers 25 tools: 13 existing market/direct-wallet tools plus 12 account workflow tools. On Robinhood/GIWA, use `callput_account_resolve`, `callput_workflow_start`, then follow `next_actions` through owner login, account creation, direct deposit, bounded device Grant and sponsored order. Open the returned app-origin wallet approval URL or use the exact prepared requests with an external signer. Never pass owner/device private keys. Storage availability and scope are explicit in `callput_get_network_info.account_workflow`; missing encrypted persistent storage blocks execution.

The initial account opening strategy is ETH BuyCallSpread (one open/one close, 10-minute Grant). Owner=the device signer is forbidden by the account contract. Deposit amount, trade collateral cap, owner deposit gas and sponsor fees are separate. Direct deposit uses ERC20 transfer without approve. Robinhood fixes transfer nonce/gas/price before approval; GIWA direct deposits are blocked when a hard total fee bound cannot be enforced. Funded GIWA accounts can trade.

Runbook: [Account workflow](https://mcp.callput.app/account-workflow). Deployment configuration, wallet-origin proxy and recovery boundaries: `docs/releases/2026-11-08-account-workflow.md`. Source registration and tests do not prove production rollout or a real fill.


## 1. Does this frontend trade directly on-chain?
No. The frontend is an operator guidance surface. External agent runtimes execute via Skill + MCP.

## 2. Who manages `CALLPUT_PRIVATE_KEY`?
Each agent owner/runtime manages it independently. This package does not collect or store it in frontend code.

## 3. Why is market analysis template missing?
By V1 scope decision, market analysis template is deferred to V2.

## 4. What is mandatory before execution?
Run spread validation. Do not execute without a successful validation result.

## 5. Can this frontend replace OpenClaw/Bankr logic?
No. It documents and guides workflow. Agent orchestration and risk logic remain in each external platform.

## 6. Is mobile supported?
Yes. `frontend-v1` is responsive for mobile and desktop.

## 7. What data does this frontend persist?
V1 frontend persists no key material and no agent-owned private runtime data.

## 8. What if execution fails?
Use request-status polling, then review open positions and run close/settle operations according to expiry state.

## 9. Which GitHub repository should external agents use?
Use `https://github.com/ayggdrasil/callput-option-agent.git`. The MCP server id is `callput-lite-agent-mcp`, and the package name is `callput-lite-mcp-skill`; those are identifiers inside the same repository, not separate GitHub repositories.

## 10. Does the MCP sign or broadcast trades?
No. The MCP returns unsigned transaction payloads only. Private keys, signing, broadcasting, and wallet policy remain in the external agent runtime or signer.

## 11. Can agents trade stock options through this package?
Agents can scan, validate, and build unsigned transactions for supported Callput synthetic stock/ETF option feed symbols when live contracts are available. These are on-chain synthetic options, not broker-listed equity options or tokenized stock ownership.

## 12. Which spread strategies can be composed?
The base workflow supports `BuyCallSpread`, `BuyPutSpread`, `SellCallSpread`, and `SellPutSpread`. Agents can compose those spreads into butterfly and iron condor structures while keeping each transaction unsigned until the external signer approves it.

## 13. Are stock and RWA options live, including the latest MCP markets?
Base and Robinhood configure 20 synthetic stock/ETF and crypto markets; GIWA Sepolia configures 13. A configured symbol is tradable only when its selected-network feed returns fresh, unexpired, available option rows. Check `/api/bankr/assets?network=base`, `?network=robinhood`, or `?network=giwa` and scan fresh option chains before selecting a spread. These instruments confer no shares, dividends, voting rights or physical asset delivery.

## 14. Does email login identify the wallet that signs or owns a CallPut Account?
No. All three CallPut apps offer `email_otp` through Privy (which connects an embedded EVM owner wallet) or `external_wallet` through wagmi. The connected owner address is the signing identity; email and Privy user IDs are login identities. Base trading uses direct wallet custody. GIWA and Robinhood are deposit-only app modes where a separate CallPut Account contract may custody positions. Source v0.8.0 adds account workflow tools; check configured storage and follow `callput_workflow_start` for existing-wallet deposit and bounded session trading. The original unsigned tools remain direct-wallet-only. For read-only portfolio calls, use the actual position-holding address. Hosted v0.7.0 is not confirmed.

# FAQ (Frontend V1)

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

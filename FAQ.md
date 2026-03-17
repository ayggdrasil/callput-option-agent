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

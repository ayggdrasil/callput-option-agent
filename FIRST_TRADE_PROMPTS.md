# First Trade Prompts (OpenClaw / Bankr)

Use these prompts after MCP connection is active.

## 1) Safe Unsigned-TX Build (recommended first)
`Analyze TSLA or ETH market, choose one spread candidate, validate it, and build the unsigned transaction without signing or broadcasting.`

## 2) Real Execution (small size)
`Analyze ETH or TSLA market, select one valid spread, build unsigned_tx with size 0.01, ask for explicit authorization, then sign/broadcast externally and keep polling request status until terminal state.`

## 3) Position Review
`Show my active Callput positions and summarize risk by asset, expiry, and side.`

## 4) Pre-expiry Risk Reduction
`For open ETH/TSLA/NVDA positions expiring soon, propose one close action and build close_position unsigned_tx only after validation checks.`

## 5) Expired Settlement
`Find expired positions and build settle_position unsigned_tx; sign and broadcast externally only after explicit authorization.`

## Guardrail Prompt Add-on
Append this sentence to any prompt if needed:
`Never execute single-leg options directly; spread-only and always validate before execute.`

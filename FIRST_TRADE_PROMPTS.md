# First Trade Prompts (OpenClaw / Bankr)

Use these prompts after MCP connection is active.

## 1) Safe Dry-Run (recommended first)
`Analyze ETH market, choose one bearish put spread candidate, validate it, and run execute_spread in dry-run mode.`

## 2) Real Execution (small size)
`Analyze ETH market, select one valid BuyPutSpread, execute with size 0.01 and dry_run=false, then keep polling request status until terminal state.`

## 3) Position Review
`Show my active Callput positions and summarize risk by asset, expiry, and side.`

## 4) Pre-expiry Risk Reduction
`For open ETH positions expiring soon, propose one close action and execute close_position only after validation checks.`

## 5) Expired Settlement
`Find expired positions and settle them using settle_position with dry_run=false.`

## Guardrail Prompt Add-on
Append this sentence to any prompt if needed:
`Never execute single-leg options directly; spread-only and always validate before execute.`

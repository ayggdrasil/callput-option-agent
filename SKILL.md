---
name: callput-lite-trader
description: Minimal spread-only Callput trading skill for external agents on Base.
license: MIT
---

# Callput Lite Trader Skill

## Goal
Trade Callput spreads with minimal context and minimal tool calls.

## Mandatory order
1. `callput_bootstrap`
2. `callput_get_option_chains`
3. `callput_validate_spread`
4. `callput_execute_spread`
5. `callput_check_request_status`
6. position management (`callput_get_positions`, `callput_close_position`, `callput_settle_position`)

## Hard rules
1. Spread-only execution. No single-leg direct execution.
2. Validate before execute.
3. Call spread ordering: long lower strike, short higher strike.
4. Put spread ordering: long higher strike, short lower strike.
5. Keep `dry_run=true` unless user explicitly requests real execution.
6. `CALLPUT_PRIVATE_KEY` must never be shown in outputs.

## Minimal strategy template
- Market scan: choose asset + expiry + option side.
- Bias mapping:
  - bullish -> `BuyCallSpread`
  - bearish -> `BuyPutSpread`
- Validate selected legs.
- Execute spread.
- Poll request status until terminal (`executed` or `cancelled`).
- For open positions: close before expiry, settle after expiry.

## One-line external command examples
- `Find one valid ETH bearish put spread and execute it.`
- `Show positions and close pre-expiry risk positions.`
- `Settle expired ETH/BTC option positions.`

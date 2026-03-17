# MCP UI Contract (1:1 Tool Mapping)

This document defines one UI component per MCP tool.

## Mapping Rules
- One tool => one action card.
- UI shows required inputs before run.
- UI renders normalized outputs in a fixed layout.
- No hidden transformations.

## Tool to Component

### 1. `callput_bootstrap`
- Component: `SystemReadinessCard`
- Inputs: none
- Outputs: server/network/market feed readiness summary
- Trigger: page load and manual refresh

### 2. `callput_get_option_chains`
- Component: `OptionLookupCard`
- Inputs: `asset`, optional filters
- Outputs: list of expiries, strikes, leg identifiers, premiums
- Trigger: after direction selection

### 3. `callput_validate_spread`
- Component: `SpreadValidationCard`
- Inputs: strategy side, long leg id, short leg id, size
- Outputs: validation status, violations, normalized leg order
- Trigger: before any execute action

### 4. `callput_execute_spread`
- Component: `ExecutionCard`
- Inputs: validated spread payload, `dry_run`
- Outputs: tx/request payload, request key, submit status
- Trigger: explicit operator run

### 5. `callput_check_request_status`
- Component: `RequestStatusCard`
- Inputs: request key
- Outputs: pending/executed/cancelled, final metadata
- Trigger: post execution polling

### 6. `callput_get_positions`
- Component: `OpenPositionsCard`
- Inputs: optional asset filter
- Outputs: active positions, expiry state, sizing
- Trigger: operator dashboard refresh

### 7. `callput_close_position`
- Component: `PreExpiryCloseCard`
- Inputs: position id, close size, `dry_run`
- Outputs: close request metadata/status
- Trigger: pre-expiry adjustments

### 8. `callput_settle_position`
- Component: `PostExpirySettleCard`
- Inputs: position id, `dry_run`
- Outputs: settlement metadata/status
- Trigger: post-expiry cleanup

## UX Guardrails
- Disable execution buttons until validation passes.
- Always default `dry_run=true` in UI examples.
- Show explicit warning: private key is not handled by this frontend.

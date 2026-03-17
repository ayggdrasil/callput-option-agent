# Architecture V1 (Frontend Guidance + Agent-Owned Execution)

## Core Principle
The frontend is an operator guidance interface.
Execution authority remains in each external agent runtime.

## Runtime Topology
1. Frontend UI
2. Agent runtime (OpenClaw/Bankr or equivalent)
3. Skill + MCP (this repository)
4. Callput.app contracts on Base

## Responsibilities
- Frontend
  - Explain operational sequence
  - Display MCP tool contract and expected output format
  - Provide copyable prompts/config templates
- Agent runtime
  - Own key management
  - Execute tool calls
  - Persist internal data and risk controls
- MCP server
  - Fetch market data
  - Validate spreads
  - Build and execute requests

## Out of Scope for V1 Frontend
- Key storage
- Direct transaction signing
- Agent private runtime logs
- Agent-specific data persistence

## Security Statement
- `CALLPUT_PRIVATE_KEY` is never entered in frontend forms.
- Skill and MCP setup references only environment-level key management.

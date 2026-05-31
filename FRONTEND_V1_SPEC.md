# Frontend V1 Spec (Stock-Aware Agent Owner Focus)

## 1) Product Scope
- Version: V1
- Primary user: OpenClaw agent owners operating agents that trade via this repository.
- V1 objective: Give operators a clear control surface for crypto and synthetic stock/ETF spread scanning, unsigned transaction construction, request tracking, and position adjustment guidance.

## 2) User Flows (V1)
- Flow A: Market Scan
- Flow B: Option Lookup
- Flow C: Unsigned Transaction Build
- Flow D: Operational Checks (request status + position review/close/settle)

## 3) MCP API Contract Principle
- Each MCP tool is mapped to exactly one UI action block.
- UI does not mutate tool schema.
- Input and output shape are displayed explicitly before execution.
- Tool examples must show crypto plus stock/ETF symbols where useful.

## 4) Gateway Boundary
- Frontend only guides usage of Skill and MCP.
- Frontend never calls private keys and never signs transactions.
- Runtime architecture:
  - Agent (key owner) + Skill + MCP server + Callput.app
  - Frontend is an operational guidance layer.

## 5) Security Boundary
- `CALLPUT_PRIVATE_KEY` is owned and managed by each external agent runtime.
- Skill and MCP docs must not request or store private keys in frontend state.
- Frontend must show warning banners when users attempt key-related operations.

## 6) Data Layer
- Agent-owned.
- Frontend only visualizes metadata, market/flow templates, and expected request/response contracts.

## 7) Design System
- Visual direction inspired by Claude-style calm neutral workspace.
- Responsive behavior required for mobile and desktop.
- High readability for long operational sessions.

## 8) FAQ
- Include an FAQ section for first-time operator questions.

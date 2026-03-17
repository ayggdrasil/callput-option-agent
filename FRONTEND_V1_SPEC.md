# Frontend V1 Spec (OpenClaw Agent Owner Focus)

## 1) Product Scope
- Version: V1
- Primary user: OpenClaw agent owners operating agents that trade via this repository.
- V1 objective: Give operators a clear control surface for direction setup, option discovery, and execution/position adjustment guidance.

## 2) User Flows (V1)
- Flow A: Direction Setup
- Flow B: Option Lookup
- Flow C: Execution and Position Adjustment
- Flow D: Operational Checks (request status + position review/close/settle)

Note:
- Market analysis template is intentionally excluded in V1 and deferred to V2.

## 3) MCP API Contract Principle
- Each MCP tool is mapped to exactly one UI action block.
- UI does not mutate tool schema.
- Input and output shape are displayed explicitly before execution.

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
- Frontend only visualizes metadata/templates and expected request/response contracts.

## 7) Design System
- Visual direction inspired by Claude-style calm neutral workspace.
- Responsive behavior required for mobile and desktop.
- High readability for long operational sessions.

## 8) FAQ
- Include an FAQ section for first-time operator questions.

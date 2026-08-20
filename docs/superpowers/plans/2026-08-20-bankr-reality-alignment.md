# Bankr Reality Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop presenting the public Bankr App chat handoff as a reliable Callput execution path while preserving verified scanning, unsigned transaction preparation, position viewing, and transaction reconciliation.

**Architecture:** Keep the existing viewer-mode Bankr App and its read/prepare backend scripts, but put public chat execution behind a disabled availability boundary. Align the public `/bankr` guide, machine-readable FAQ/HowTo data, operator docs, and Callput skill with the verified support matrix: external signers are supported; Bankr Wallet API/CLI is advanced and separately configured; public Bankr chat execution is currently unavailable for production use.

**Tech Stack:** TypeScript assertion tests, static HTML/CSS/JavaScript, Bankr App SDK, Vercel, GitHub releases.

---

### Task 1: Lock the verified support matrix in tests

**Files:**
- Modify: `src/bankrApp_test.ts`
- Modify: `src/bankrGuide_test.ts`

- [ ] **Step 1: Write failing Bankr App assertions**

Require a visible `Bankr chat execution unavailable` disclosure, a false execution-availability constant, disabled open/close/settle confirmation controls, and language directing signed transaction hashes from an external signer to reconciliation.

- [ ] **Step 2: Write failing guide assertions**

Require the same status in visible copy and JSON-LD, require `external signer` and `Bankr Wallet API/CLI` boundaries, and reject the former “directly inside Bankr” and “approve in Bankr chat” claims.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm run build && node build/src/bankrApp_test.js && node build/src/bankrGuide_test.js`

Expected: FAIL because the current public surfaces still advertise chat execution.

### Task 2: Make the public Bankr App honest and view/prepare-only

**Files:**
- Modify: `bankr-app/index.html`
- Modify: `bankr-app/QA.md`
- Modify: `bankr-app/INSTALL_PROMPT.md`

- [ ] **Step 1: Add the execution availability boundary**

Add `const BANKR_CHAT_EXECUTION_AVAILABLE=false`, display the verified simulator limitation, disable order and lifecycle confirmation controls, and preserve scan, prepare, position refresh, and reconciliation.

- [ ] **Step 2: Replace transaction-hash provenance copy**

Accept a Base transaction hash from an authorized external signer, Bankr Wallet API, or Bankr CLI; do not imply that the hash must come from Bankr chat.

- [ ] **Step 3: Align operator QA and installation guidance**

State that production chat execution is unavailable and must not be canary-tested or marketed until Bankr fixes its simulator and a fresh public-account E2E passes.

- [ ] **Step 4: Run the Bankr App test and verify GREEN**

Run: `npm run build && node build/src/bankrApp_test.js`

Expected: `Bankr App package tests passed.`

### Task 3: Align the public `/bankr` page and agent documentation

**Files:**
- Modify: `bankr/index.html`
- Modify: `BANKR_GUIDE.md`
- Modify: `callput/SKILL.md`

- [ ] **Step 1: Replace metadata and hero claims**

Describe the public App as a scanner, risk preview, unsigned transaction builder, position viewer, and reconciliation UI. Mark chat execution unavailable in visible status, OpenGraph/Twitter text, JSON-LD, HowTo steps, and FAQ answers.

- [ ] **Step 2: Publish the supported execution paths**

Document `Callput MCP → authorized external signer → Base → reconcile` as supported. Describe Bankr Wallet API/CLI as an advanced, separately configured path that requires a user-managed write key and must not be mistaken for the public App chat flow.

- [ ] **Step 3: Remove misleading lifecycle claims**

Make close and settle preparation/viewing available while stating that public App chat broadcast is disabled for these actions too.

- [ ] **Step 4: Run the guide test and verify GREEN**

Run: `npm run build && node build/src/bankrGuide_test.js`

Expected: `Bankr guide page tests passed.`

### Task 4: Version, verify, deploy, and republish

**Files:**
- Modify: `package.json`
- Modify: `src/version.ts`
- Modify: `bankr/index.html`
- Modify: `bankr-app/INSTALL_PROMPT.md`

- [ ] **Step 1: Bump the release to 0.5.29**

Synchronize package, server, structured-data, and immutable release references.

- [ ] **Step 2: Run the full verification suite**

Run: `npm run verify`

Expected: all build, safety, abuse, Bankr App, guide, SEO, and smoke tests pass.

- [ ] **Step 3: Commit and push the focused change**

Commit only the files in this plan; preserve user-owned `.superpowers/` and `marketing/` changes.

- [ ] **Step 4: Publish GitHub and Vercel artifacts**

Push the branch, tag `v0.5.29`, create the release, deploy production, and verify `https://mcp.callput.app`, `/bankr`, `/api/health`, and `/api/version` show 0.5.29 and the corrected support matrix.

- [ ] **Step 5: Republish the Bankr App**

Upload the corrected manifest-facing files and publish the next public App version. Verify a signed-in public account sees the execution-unavailable disclosure and disabled transaction CTAs.


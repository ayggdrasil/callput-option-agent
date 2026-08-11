# FAQ SEO/AEO Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish 30 collapsed, visible, machine-matched FAQ answers on each of the Callput MCP and Bankr pages.

**Architecture:** Keep FAQ content server-rendered in the existing static HTML so it remains crawlable without JavaScript. Each page retains one JSON-LD `FAQPage`; a new contract test parses both the visible `<details>` items and JSON-LD to enforce exact normalized parity. Native disclosure widgets provide the interaction, with CSS-only grouping and responsive layout.

**Tech Stack:** Static HTML, CSS, JSON-LD/Schema.org, TypeScript contract tests, Node.js assertions, Vercel.

---

## File map

- Create `src/faqSeo_test.ts`: parse visible FAQ items and JSON-LD, enforce count, collapsed state, grouping, and exact parity.
- Modify `package.json`: include the new compiled contract test in `npm test`.
- Modify `frontend-v1/index.html`: replace the five-item root FAQ with six groups and 30 items; replace its FAQPage `mainEntity` with the same 30 pairs.
- Modify `frontend-v1/styles.css`: style root FAQ groups, group headings, native disclosure focus, and narrow layouts.
- Modify `bankr/index.html`: replace the six-item Bankr FAQ with six groups and 30 items; replace its FAQPage `mainEntity` with the same 30 pairs.
- Modify `bankr/styles.css`: style Bankr FAQ groups while preserving readable DOM order and responsive behavior.
- Modify `src/bankrGuide_test.ts` and `src/stock_support_test.ts`: retain page-specific search-intent and safety assertions without duplicating the parity parser.

## FAQ content contract

Every answer below is the complete source copy. The visible `<p>` and JSON-LD `acceptedAnswer.text` must normalize to the same string.

### Root page: 30 questions

#### Callput and MCP basics

1. **What is Callput Lite MCP?** — Callput Lite MCP is a public Model Context Protocol server and agent skill for scanning and managing defined-risk synthetic option spreads on Base. It provides market data, validation, unsigned transaction preparation, request tracking, position closing, and settlement tools.
2. **What does the Callput MCP server do?** — The server reads the Callput market feed, validates option structures, ranks spread candidates, checks Base transaction constraints, and returns structured results to an agent. It does not hold a private key or sign a transaction.
3. **What is the Callput MCP endpoint?** — Use `https://mcp.callput.app/api/mcp` as a Streamable HTTP MCP endpoint. The public endpoint does not require an API key, although clients must still follow the server's origin, rate-limit, and safety policies.
4. **Which repository, package, and server ID should I use?** — Clone `https://github.com/ayggdrasil/callput-option-agent.git`, use the package name `callput-lite-mcp-skill`, and configure the server ID `callput-lite-agent-mcp`. These identifiers belong to the same integration package.
5. **Is Callput Lite MCP a wallet, broker, or exchange?** — No. It is an MCP server and skill package that prepares data and unsigned transactions for Callput's on-chain protocol. Wallet custody, signing, broadcast, and user authorization stay outside the MCP.

#### Installation and agent compatibility

6. **How does an agent connect to Callput MCP?** — Add `https://mcp.callput.app/api/mcp` as an HTTP MCP server with no authentication, then list the available tools before attempting a scan. Begin with a read-only prompt and do not prepare or submit a transaction until the user explicitly chooses a candidate.
7. **Which AI agents and MCP clients can use Callput?** — Any client that supports Streamable HTTP MCP and the advertised tool schemas can connect. The repository also contains skill instructions for compatible coding agents and agent runtimes.
8. **Do I need a Callput API key?** — No API key is required for the public MCP endpoint. The server still applies request ceilings, input validation, market-data freshness checks, and transaction safety limits.
9. **Can Bankr or OpenClaw use the same Callput tools?** — Yes, when the runtime supports the Callput MCP or installs the Callput skill. Each runtime remains responsible for its own wallet identity, authorization policy, signing, and broadcast.
10. **How can I verify that Callput MCP is installed correctly?** — List the tools, call the market scan for one supported symbol, and confirm that the response includes ranked spread candidates or a clear availability error. A first test should remain read-only and should not call transaction preparation.

#### Supported markets and strategies

11. **Which blockchain does Callput use?** — Callput transaction preparation targets Base mainnet, chain ID `8453`. Wallet funds, token approvals, gas handling, and transaction review must therefore use Base-compatible assets and addresses.
12. **Which assets can Callput currently scan?** — The configured symbols are BTC, ETH, TSLA, QQQ, SPY, EWY, NVDA, COIN, SPCX, MU, and SKHY. Live candidates depend on the current feed, expiry set, direction, and option availability.
13. **Are Callput stock and ETF options broker-listed securities?** — No. TSLA, QQQ, SPY, EWY, NVDA, COIN, SPCX, MU, and SKHY products are synthetic on-chain options. They do not represent broker-listed option contracts, tokenized shares, securities ownership, dividends, or voting rights.
14. **Which option spread strategies are supported?** — Agents can scan and prepare BuyCallSpread, BuyPutSpread, SellCallSpread, and SellPutSpread verticals. Those capped-risk legs can also be composed into structures such as butterflies or iron condors when the agent and user manage every leg explicitly.
15. **Does a configured symbol always have a tradable spread?** — No. A configured symbol can return no candidates when contracts are unavailable, expired, stale, structurally invalid, or outside the selected constraints. Agents should query the live feed instead of assuming availability from the symbol list.

#### Transaction preparation and wallet control

16. **Does Callput MCP automatically execute trades?** — No. The MCP returns unsigned transaction data and cannot sign or broadcast it. A user-controlled wallet or authorized external signer must review and approve every on-chain action.
17. **What is an `unsigned_tx` response?** — It is a transaction payload containing the destination, calldata, native value, and Base chain ID needed for external review. Receiving it does not mean that a transaction was signed, submitted, mined, or executed.
18. **Why can a Callput trade require USDC approval?** — Premium or collateral may require the Base USDC allowance for the exact Callput spender. When allowance is insufficient, the response can include a bounded approval transaction that must be reviewed and confirmed before the option transaction.
19. **How are maximum risk and minimum fill handled?** — Callput enforces a configured per-trade USDC risk ceiling and returns the calculated maximum amount at risk for the requested size. It also encodes a minimum-fill constraint so an execution below the user's accepted threshold can be rejected.
20. **Why does the transaction include a Base ETH value?** — Callput's request flow can require a native execution fee paid in Base ETH. The prepared transaction shows both the exact wei value and its ETH representation so the signer can verify it before approval.

#### Position lifecycle and monitoring

21. **What should an agent do after broadcasting a Callput transaction?** — Wait for a successful receipt, extract the Callput request key, verify the destination and event provenance, and poll the request status. Broadcast success alone does not prove that the keeper executed the option request.
22. **What is a Callput request key?** — A request key is the protocol identifier emitted for an open or close request. Agents should persist it with the wallet, transaction hash, intent, and timestamps so later status checks can reconcile the correct request.
23. **Can an agent close a Callput position before expiry?** — Yes, if the wallet owns the position token and the position has not expired. Closing requires an explicit size and user-approved output floors, and the MCP again returns an unsigned transaction.
24. **How is a Callput position handled after expiry?** — An expired position is settled rather than closed through the pre-expiry path. Settlement validates the asset, wallet ownership, expiry state, and user-approved swap floor before returning unsigned transaction data.
25. **Can Callput MCP show positions and realized PnL?** — Yes. The portfolio and history tools can summarize balances, recover wallet-linked request keys, inspect positions, and retrieve settled results within configured event-lookback limits.

#### Safety, limits, and troubleshooting

26. **Does Callput receive or store private keys?** — No. Callput MCP does not request, receive, or store a seed phrase or private key. Signing policy and key custody remain with Bankr, another external wallet, or the user's authorized agent runtime.
27. **Why did a Callput scan return no candidates?** — The selected symbol, direction, expiry, size, or risk constraint may not match any valid live spread. Retry with another supported symbol or direction after confirming that the market endpoint reports current tradable contracts.
28. **What happens when market data is stale or Base RPC fails?** — The MCP rejects stale or malformed market data and rejects RPC responses from the wrong chain. Agents should surface the error, avoid transaction preparation, and retry only after the upstream feed or Base RPC is healthy.
29. **Why can an externally submitted transaction simulation revert?** — Common causes include insufficient Base USDC, insufficient allowance, insufficient Base ETH for the execution fee, expired calldata, changed market state, or contract-level validation. The agent should recheck balances and rebuild fresh transaction data instead of replaying a stale payload.
30. **What is the safest first Callput workflow?** — Start with a read-only scan, choose a small defined-risk spread, inspect maximum risk and minimum fill, then prepare an unsigned transaction. Sign only after verifying the Base chain, destination, calldata intent, USDC approval, and native execution fee.

### Bankr page: 30 questions

#### Getting started in Bankr

1. **What is the Callput Bankr App?** — The Callput Bankr App is a viewer-specific trade builder that scans Callput markets, shows a defined-risk spread, and prepares a Base transaction for review in Bankr chat. The app does not sign or submit the transaction by itself.
2. **Why does the Callput Bankr App look blank when I open its URL?** — Bankr may redirect an unauthenticated visitor to its home or sign-in flow before rendering a viewer-specific app. Sign in to the intended Bankr account, then reopen `https://bankr.bot/apps/callput-options`.
3. **Do I need Bankr Club or Max Mode to use the app?** — Bankr controls access to Apps and social-agent surfaces under its current account tiers. If a free account cannot open the app or receive an X reply, check the current Bankr Club or Max Mode access requirements in Bankr.
4. **How do I open Callput inside Bankr?** — Sign in to Bankr, open `https://bankr.bot/apps/callput-options`, choose a supported asset, market view, and size, and run a scan. Review the exact maximum risk before opening the Bankr transaction handoff.
5. **What does `public` mean for a Bankr App?** — Public means the app can be discovered or opened by eligible Bankr users under Bankr's app access rules. It does not necessarily mean that an anonymous visitor can render the personalized viewer app without signing in.

#### Markets, strategies, and funding

6. **Which assets are available in the Callput Bankr App?** — The app supports BTC, ETH, TSLA, QQQ, SPY, EWY, NVDA, COIN, SPCX, MU, and SKHY. The page reads current contract counts from the live Callput assets endpoint because a supported symbol can temporarily have no valid candidate.
7. **Which network does the Bankr transaction use?** — Callput transactions use Base mainnet, chain ID `8453`. Make sure the Bankr EVM wallet selected for the app has the required assets on Base rather than on another network.
8. **Which funds do I need for a Callput trade in Bankr?** — The Bankr wallet generally needs Base USDC for premium or collateral and Base ETH for the displayed execution fee. The required amounts depend on the selected spread, size, allowance, and current contract fee.
9. **How do market view choices map to Callput strategies?** — Bullish maps to BuyCallSpread, bearish maps to BuyPutSpread, neutral-bearish maps to SellCallSpread, and neutral-bullish maps to SellPutSpread. The app ranks structurally valid candidates for the selected view.
10. **How should I choose size and risk budget?** — Begin with a small positive size and a maximum-risk amount you can afford to lose. Increasing size scales premium, collateral, and maximum risk, so review the size-adjusted risk rather than only the per-unit spread price.

#### Review, approval, and execution

11. **What does maximum at risk mean in the Bankr review?** — It is the calculated USDC exposure ceiling for the selected spread and requested size under the prepared intent. It should be reviewed alongside strikes, expiry, minimum fill, allowance, and the Base ETH execution fee.
12. **What is the difference between debit and credit spreads?** — A debit spread pays premium upfront and has risk generally bounded by that cost. A credit spread receives premium but requires collateral, with maximum loss bounded by spread width and received credit under the protocol calculation.
13. **Why might Bankr show a USDC approval transaction first?** — The wallet's current Base USDC allowance may be lower than the bounded amount required by the Callput spender. Bankr must present and confirm that approval before the option request can use the USDC.
14. **Does opening Bankr transaction review submit a trade?** — No. It hands prepared transaction details to Bankr chat for explicit review. Nothing is signed, broadcast, mined, or executed until the user sends and approves the transaction there.
15. **What should I verify in Bankr before approving?** — Verify Base chain ID `8453`, the Callput destination, wallet address, strategy, strikes, expiry, size, maximum USDC risk, approval spender and amount, minimum fill, and native execution fee. Reject the action if any field differs from the selected intent.

#### Safety and product boundaries

16. **Does Callput receive my Bankr private key?** — No. Callput receives the viewer wallet address needed to prepare and validate an intent, but signing stays inside Bankr's wallet flow. Callput does not ask for a seed phrase or private key.
17. **Are Callput stock and ETF options real broker-listed options?** — No. They are synthetic on-chain options referencing assets such as TSLA, QQQ, SPY, EWY, NVDA, COIN, SPCX, MU, and SKHY. They do not provide shares, voting rights, dividends, or ownership of a broker-listed contract.
18. **Can the Callput Bankr App trade automatically?** — No. The app has permission to read the viewer wallet, fetch public Callput data, and prepare a transaction for confirmation. It cannot silently sign or broadcast on behalf of the visitor.
19. **How do risk caps and minimum fill protect the order?** — The integration rejects a prepared trade above its configured USDC risk ceiling and includes a minimum-fill constraint in the transaction intent. These controls limit the requested trade but cannot guarantee execution or profit.
20. **Does Callput guarantee liquidity, execution, or returns?** — No. Candidate availability, simulation, keeper execution, settlement value, and market outcomes can change. A prepared transaction is not a promise of fill, profit, price stability, or continuous liquidity.

#### Failures and recovery

21. **Why did the Bankr App find no Callput spread?** — The live feed may have no valid spread for the selected asset, direction, size, expiry, or risk constraints. Try another supported asset or market view and confirm that the live availability counter is nonzero.
22. **Why did Bankr transaction simulation revert?** — A revert can result from insufficient Base USDC, insufficient allowance, insufficient Base ETH, stale prepared data, changed contract state, expired options, or another protocol validation. Recheck the wallet and create a fresh preparation instead of resending old calldata.
23. **How do I fix insufficient balance or allowance?** — Fund the same Bankr EVM wallet with enough Base USDC and Base ETH, then rerun preparation so the latest balances and allowance are checked. If Bankr presents a bounded USDC approval, review its spender and amount before confirming it.
24. **How can I tell whether a Callput request was actually submitted?** — A chat handoff or simulation is not proof of submission. Confirm a successful transaction hash, extract the protocol request key from the receipt, and use reconciliation or request-status checks to verify the matching on-chain request.
25. **What should I do after a failed Callput attempt in Bankr?** — Do not keep repeating the same stale transaction. Record the visible error, verify balances and allowance, rescan the market, prepare fresh data, and submit only when the new review matches the intended trade.

#### Bankr agents, MCP, and social surfaces

26. **Does opening the public Bankr App install Callput tools for every user?** — No. A public app link makes the app available under Bankr's access rules, but it does not automatically install a wallet-specific MCP server or skill for every Bankr agent. Tool installation and app discovery are separate capabilities.
27. **How does a Bankr agent connect directly to Callput MCP?** — Configure `https://mcp.callput.app/api/mcp` as an HTTP MCP server with no authentication and install the public Callput skill where the Bankr agent supports custom tools. Start by listing tools and running a read-only scan.
28. **Can I call Callput through `@bankrbot` on X?** — Bankr accepts actionable requests through `@bankrbot`, but Callput execution is available only if that user's Bankr agent can access the required Callput tools or Bankr provides a native integration. The public app alone does not prove global X intent routing.
29. **Why might `@bankrbot` ignore a Callput request on X?** — Bankr may require Club or Max Mode for X replies, and it ignores greetings or non-actionable prompts. Put a concise actionable request near the start of the post and do not assume Callput tools are installed for that account.
30. **Can another Bankr user trade through the Callput App?** — An eligible signed-in Bankr user can open the public viewer-mode app and prepare an intent for that user's own wallet. The user must still have the required Base funds and explicitly review and approve every transaction in Bankr.

---

### Task 1: Add an exact FAQ parity contract test

**Files:**
- Create: `src/faqSeo_test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing parser and assertions**

Create `src/faqSeo_test.ts` with a small no-dependency parser:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const pages = ["frontend-v1/index.html", "bankr/index.html"];

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleFaqs(html: string) {
  return [...html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
    .map((match) => ({ question: decode(match[1]), answer: decode(match[2]) }));
}

function faqSchema(html: string) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const script of scripts) {
    const value = JSON.parse(script[1]);
    const nodes = value["@graph"] ?? [value];
    const faq = nodes.find((node: any) => node["@type"] === "FAQPage");
    if (faq) return faq.mainEntity.map((entry: any) => ({
      question: entry.name,
      answer: entry.acceptedAnswer.text
    }));
  }
  throw new Error("FAQPage schema not found");
}

for (const page of pages) {
  const html = fs.readFileSync(page, "utf8");
  const visible = visibleFaqs(html);
  const structured = faqSchema(html);
  assert.equal(visible.length, 30, `${page} must contain exactly 30 visible FAQs`);
  assert.equal((html.match(/class="faq-group"/g) ?? []).length, 6, `${page} must contain six FAQ groups`);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/, `${page} FAQs must start collapsed`);
  assert.deepEqual(structured, visible, `${page} FAQPage JSON-LD must match visible FAQ copy exactly`);
}

console.log("FAQ SEO/AEO parity contract passed.");
```

Append the compiled test after `bankrGuide_test.js` in `package.json`:

```json
"test": "npm run build && node build/src/config_test.js && node build/src/http_test.js && node build/src/vercelAdapter_test.js && node build/src/releaseOps_test.js && node build/src/bankrApi_test.js && node build/src/bankrApp_test.js && node build/src/bankrGuide_test.js && node build/src/faqSeo_test.js && node --test build/src/core_safety_test.js build/src/core_abuse_test.js"
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
npm run build && node build/src/faqSeo_test.js
```

Expected: FAIL because both current pages have fewer than 30 `class="faq-item"` disclosure items.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/faqSeo_test.ts package.json
git commit -m "test: require complete FAQ schema parity"
```

### Task 2: Expand the root MCP FAQ and JSON-LD

**Files:**
- Modify: `frontend-v1/index.html`
- Modify: `src/stock_support_test.ts`

- [ ] **Step 1: Add root-specific failing search-intent assertions**

In `src/stock_support_test.ts`, assert that the root page includes all six group headings and critical concepts:

```ts
for (const heading of [
  "Callput and MCP basics",
  "Installation and agent compatibility",
  "Supported markets and strategies",
  "Transaction preparation and wallet control",
  "Position lifecycle and monitoring",
  "Safety, limits, and troubleshooting"
]) assert.match(frontendHtml, new RegExp(heading));

for (const phrase of [
  "Streamable HTTP MCP endpoint",
  "Base mainnet, chain ID <code>8453</code>",
  "request key",
  "settled results",
  "simulation revert"
]) assert.match(frontendHtml, new RegExp(phrase, "i"));
```

- [ ] **Step 2: Run the root test and confirm RED**

Run:

```bash
npm run build && node build/src/stock_support_test.js
```

Expected: FAIL on the first missing group heading.

- [ ] **Step 3: Replace the visible root FAQ**

Replace the current five-item `.faq-list` with:

```html
<div class="faq-groups" aria-label="Callput Lite MCP frequently asked questions">
  <section class="faq-group" aria-labelledby="faq-root-basics">
    <h3 id="faq-root-basics">Callput and MCP basics</h3>
    <p class="faq-group-lede">Definitions and canonical integration identifiers.</p>
    <div class="faq-list">
      <details class="faq-item"><summary>What is Callput Lite MCP?</summary><p>Callput Lite MCP is a public Model Context Protocol server and agent skill for scanning and managing defined-risk synthetic option spreads on Base. It provides market data, validation, unsigned transaction preparation, request tracking, position closing, and settlement tools.</p></details>
    </div>
  </section>
</div>
```

Apply the displayed element shape to all root content-contract items in exact numeric order. Map items 1–5 to `faq-root-basics`, 6–10 to `faq-root-install`, 11–15 to `faq-root-markets`, 16–20 to `faq-root-transactions`, 21–25 to `faq-root-lifecycle`, and 26–30 to `faq-root-safety`. Do not use the `open` attribute, omit any catalog item, or alter catalog wording.

- [ ] **Step 4: Replace the root FAQPage `mainEntity`**

Use this exact shape for each of the 30 root pairs:

```json
{
  "@type": "Question",
  "name": "What is Callput Lite MCP?",
  "acceptedAnswer": {
    "@type": "Answer",
    "text": "Callput Lite MCP is a public Model Context Protocol server and agent skill for scanning and managing defined-risk synthetic option spreads on Base. It provides market data, validation, unsigned transaction preparation, request tracking, position closing, and settlement tools."
  }
}
```

Create one object for every root content-contract item 1–30 in the same order, using the exact catalog question and answer strings.

- [ ] **Step 5: Run root and parity tests**

```bash
npm run build && node build/src/stock_support_test.js && node build/src/faqSeo_test.js
```

Expected: root assertions pass; parity test still fails only for `bankr/index.html`.

- [ ] **Step 6: Commit the root FAQ**

```bash
git add frontend-v1/index.html src/stock_support_test.ts
git commit -m "feat: expand MCP FAQ for search answers"
```

### Task 3: Expand the Bankr FAQ and JSON-LD

**Files:**
- Modify: `bankr/index.html`
- Modify: `src/bankrGuide_test.ts`

- [ ] **Step 1: Add Bankr-specific failing search-intent assertions**

In `src/bankrGuide_test.ts`, assert all six Bankr group headings and key concepts:

```ts
for (const heading of [
  "Getting started in Bankr",
  "Markets, strategies, and funding",
  "Review, approval, and execution",
  "Safety and product boundaries",
  "Failures and recovery",
  "Bankr agents, MCP, and social surfaces"
]) assert.match(html, new RegExp(heading));

for (const phrase of [
  "Bankr Club or Max Mode",
  "Base mainnet, chain ID <code>8453</code>",
  "simulation revert",
  "@bankrbot",
  "does not automatically install"
]) assert.match(html, new RegExp(phrase, "i"));
```

- [ ] **Step 2: Run the Bankr guide test and confirm RED**

```bash
npm run build && node build/src/bankrGuide_test.js
```

Expected: FAIL on the first missing Bankr group heading.

- [ ] **Step 3: Replace the visible Bankr FAQ**

Use the same semantic group structure as Task 2:

```html
<div class="faq-groups" aria-label="Callput for Bankr frequently asked questions">
  <section class="faq-group" aria-labelledby="faq-bankr-start">
    <h3 id="faq-bankr-start">Getting started in Bankr</h3>
    <p class="faq-group-lede">Access, sign-in, and the first scan.</p>
    <div class="faq-list">
      <details class="faq-item"><summary>What is the Callput Bankr App?</summary><p>The Callput Bankr App is a viewer-specific trade builder that scans Callput markets, shows a defined-risk spread, and prepares a Base transaction for review in Bankr chat. The app does not sign or submit the transaction by itself.</p></details>
    </div>
  </section>
</div>
```

Apply the displayed element shape to all Bankr content-contract items in exact numeric order. Map items 1–5 to `faq-bankr-start`, 6–10 to `faq-bankr-markets`, 11–15 to `faq-bankr-review`, 16–20 to `faq-bankr-safety`, 21–25 to `faq-bankr-recovery`, and 26–30 to `faq-bankr-agents`. Keep all items collapsed and preserve the exact catalog wording.

- [ ] **Step 4: Replace the Bankr FAQPage `mainEntity`**

Use the identical 30 question and answer strings in visible order. Preserve the existing `WebPage`, `SoftwareApplication`, and `HowTo` graph nodes.

- [ ] **Step 5: Run the targeted tests**

```bash
npm run build && node build/src/bankrGuide_test.js && node build/src/faqSeo_test.js
```

Expected: both commands pass and print their success messages.

- [ ] **Step 6: Commit the Bankr FAQ**

```bash
git add bankr/index.html src/bankrGuide_test.ts
git commit -m "feat: expand Bankr FAQ for search answers"
```

### Task 4: Style grouped disclosure FAQs

**Files:**
- Modify: `frontend-v1/styles.css`
- Modify: `bankr/styles.css`

- [ ] **Step 1: Add a failing CSS contract**

Extend `src/faqSeo_test.ts`:

```ts
for (const stylesheet of ["frontend-v1/styles.css", "bankr/styles.css"]) {
  const css = fs.readFileSync(stylesheet, "utf8");
  assert.match(css, /\.faq-groups\s*\{/);
  assert.match(css, /\.faq-group\s*\{/);
  assert.match(css, /\.faq-item\s+summary:focus-visible/);
}
```

- [ ] **Step 2: Run the parity test and confirm RED**

```bash
npm run build && node build/src/faqSeo_test.js
```

Expected: FAIL because `.faq-groups` is not defined.

- [ ] **Step 3: Add root FAQ group styles**

Add to `frontend-v1/styles.css`:

```css
.faq-groups {
  display: grid;
  gap: 18px;
  margin-top: 14px;
}

.faq-group {
  min-width: 0;
}

.faq-group > h3 {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.faq-group-lede {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.faq-item summary:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}
```

Keep the existing root `.faq-list` single-column stack.

- [ ] **Step 4: Add Bankr FAQ group styles**

Add to `bankr/styles.css`:

```css
.faq-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  padding: 20px 24px 24px;
}

.faq-group {
  min-width: 0;
}

.faq-group > h3 {
  margin: 0;
  color: var(--ink);
  font-size: 15px;
}

.faq-group-lede {
  margin: 5px 0 10px;
  color: var(--muted);
  font-size: 12px;
}

.faq-group .faq-list {
  grid-template-columns: 1fr;
  padding: 0;
}

.faq-item summary:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 3px;
}
```

Within both existing narrow breakpoints, set `.faq-groups { grid-template-columns: 1fr; }` and preserve current horizontal padding.

- [ ] **Step 5: Run the FAQ and page contract tests**

```bash
npm run build && node build/src/faqSeo_test.js && node build/src/bankrGuide_test.js && node build/src/stock_support_test.js
```

Expected: PASS.

- [ ] **Step 6: Commit styles**

```bash
git add frontend-v1/styles.css bankr/styles.css src/faqSeo_test.ts
git commit -m "style: group searchable FAQ disclosures"
```

### Task 5: Run full regression and browser verification

**Files:**
- No production files unless verification reveals a defect.

- [ ] **Step 1: Run all automated tests**

```bash
npm test
```

Expected: all configuration, HTTP, adapter, release, API, Bankr App, guide, FAQ, core safety, and abuse tests pass. If local socket tests fail with `listen EPERM`, rerun the same command with approved unsandboxed local-port access.

- [ ] **Step 2: Check formatting and repository scope**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only planned FAQ files are modified, plus the known untracked `.superpowers/` directory which must remain untouched.

- [ ] **Step 3: Serve the static pages locally**

```bash
python3 -m http.server 4173
```

Open `/frontend-v1/` and `/bankr/`. A plain static server returns 404 for `/api/bankr/assets`; the existing fallback text is expected and unrelated to FAQ behavior.

- [ ] **Step 4: Verify desktop and mobile rendering**

At desktop and 375px widths, verify:

- 30 `<details>` items and six headings per page
- all items initially collapsed
- summaries open with click, Enter, and Space
- focus indicator is visible
- no horizontal overflow
- answers remain readable and group order is preserved
- no browser console errors from FAQ markup

- [ ] **Step 5: Commit any verification-only corrections**

If corrections were required:

```bash
git add frontend-v1/index.html frontend-v1/styles.css bankr/index.html bankr/styles.css src/faqSeo_test.ts src/bankrGuide_test.ts src/stock_support_test.ts package.json
git commit -m "fix: polish FAQ accessibility and parity"
```

If no corrections were required, do not create an empty commit.

### Task 6: Push, deploy, and verify Production

**Files:**
- No additional source changes expected.

- [ ] **Step 1: Push the current feature branch**

```bash
git push origin codex/bankr-app-integration
```

Expected: origin advances to the final FAQ commit.

- [ ] **Step 2: Deploy Vercel Preview**

```bash
vercel deploy --yes
```

Expected: deployment state `READY`. If team SSO protects direct preview URLs, use the build result as the Preview gate and continue with the already-passing local browser verification.

- [ ] **Step 3: Deploy Production**

```bash
vercel deploy --prod --yes
```

Expected: deployment state `READY`, target `production`.

- [ ] **Step 4: Point the custom domain when necessary**

Inspect `mcp.callput.app`. If it still resolves to the previous deployment, run:

```bash
vercel alias set <new-production-deployment>.vercel.app mcp.callput.app
```

Expected: Vercel reports that `https://mcp.callput.app` points to the new production deployment.

- [ ] **Step 5: Verify production HTML and JSON-LD**

Fetch both URLs with a cache-busting query and verify:

```bash
curl -sS 'https://mcp.callput.app/?verify=<commit>'
curl -sS 'https://mcp.callput.app/bankr?verify=<commit>'
```

For each response confirm:

- canonical URL remains correct
- exactly 30 `class="faq-item"` elements
- exactly six `class="faq-group"` elements
- no FAQ `<details>` contains `open`
- FAQPage contains 30 questions
- visible and structured pairs match through the same normalization used in `faqSeo_test.ts`

- [ ] **Step 6: Final production browser check**

Open both production URLs and verify each reports 30 collapsed FAQ controls, six visible groups, working keyboard toggles, no horizontal overflow, and no console errors.

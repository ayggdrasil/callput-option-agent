# Callput × Bankr Guide Page Design

Date: 2026-08-09
Status: Approved design; implementation not started
Canonical route: `https://mcp.callput.app/bankr`

## 1. Summary

Create a public, English-only Bankr onboarding page at `/bankr` that visually belongs to the existing `mcp.callput.app` operator-console site while prioritizing ordinary Bankr traders over developers.

The page has one primary conversion goal: send a visitor to the public Callput Bankr App through the `Open Callput in Bankr` CTA. It explains the product, demonstrates a bounded sample trade, makes the signing boundary explicit, and places MCP installation in a secondary section below the user onboarding flow.

The page is a static guide and interactive simulation. It never connects a wallet, prepares calldata, signs, broadcasts, or implies that a trade was submitted.

## 2. Confirmed Decisions

- Primary audience: ordinary Bankr traders.
- Secondary audience: Bankr agent operators and builders.
- Language: English only.
- Primary KPI: click on `Open Callput in Bankr`.
- Hero demonstration: interactive, deterministic, and clearly labeled as a simulation.
- Visual direction: Conversion Console.
- Product route: `/bankr`, with a canonical URL ending in `/bankr`.
- Scope boundary: static guide assets, Vercel routing, sitemap metadata, and one `Bankr` link in the existing root navigation. No changes to MCP tools, Bankr APIs, on-chain contracts, or Bankr App transaction logic.

## 3. Goals

1. Let a first-time Bankr user understand the offer within ten seconds.
2. Make the primary app-open CTA visually dominant without hiding safety information.
3. Explain `Scan → Review → Approve` without requiring options expertise.
4. State that Bankr chat handoff is not signature, broadcast, or submission.
5. Demonstrate product value without creating a second transaction surface.
6. Give agents and search systems a stable, semantic, machine-readable description of the integration.
7. Preserve the visual identity and static deployment model of the existing site.

## 4. Non-Goals

- No wallet connection on `/bankr`.
- No live Callput market, RPC, Bankr, or portfolio request from the guide page.
- No transaction preparation, calldata, approval request, signing, or broadcast.
- No account-specific state.
- No second trade UI competing with the public Bankr App.
- No localization in the first release.
- No redesign of the existing root page. Add one `Bankr` link to its top navigation so the guide is discoverable.

## 5. Positioning and Content Principles

### 5.1 Primary promise

Use one direct product statement:

> Defined-risk options, directly inside Bankr.

Supporting text:

> Scan synthetic stock, ETF, and crypto option spreads. See the maximum loss before anything reaches your wallet—then review and approve in Bankr chat.

### 5.2 Required trust statements

The first viewport must contain all three statements as visible HTML text:

- `No private keys` — Callput prepares; the Bankr wallet signs.
- `Not auto-submitted` — the user must send and approve in Bankr chat.
- `Synthetic on-chain` — stock and ETF products are not broker-listed securities, contracts, shares, or ownership.

### 5.3 Canonical terms

Use these terms consistently in visible copy, metadata, structured data, tests, and documentation:

- Product: `Callput × Bankr`
- Bankr App CTA: `Open Callput in Bankr`
- MCP server ID: `callput-lite-agent-mcp`
- MCP URL: `https://mcp.callput.app/api/mcp`
- Transport: `HTTP`
- Authentication: `None`
- Network: `Base mainnet (8453)`
- Skill URL: `https://github.com/ayggdrasil/callput-option-agent/tree/v0.4.3/callput`
- Bankr App URL: `https://bankr.bot/apps/callput-options`

## 6. Visual System

The page inherits the current `frontend-v1` visual language instead of creating a separate Bankr-branded microsite.

### 6.1 Tokens

- Background: `#10110e`
- Primary panel: `#171914`
- Raised panel: `#20241d`
- Primary text: `#f4efe2`
- Secondary text: `#b8ad9b`
- Faint text: `#7f7668`
- Gold accent: `#d8b86d`
- Success green: `#93b878`
- Warning amber: `#d8a34d`
- Error red: `#d8786d`
- Primary border: `rgba(218, 201, 164, 0.18)`
- Strong border: `rgba(214, 178, 102, 0.42)`
- Corner radius: 6–9 px; avoid large pill-shaped cards.

### 6.2 Typography

- Headings and prose: IBM Plex Sans with system fallbacks.
- Identifiers, statuses, metrics, buttons, and code: IBM Plex Mono with monospace fallbacks.
- Large headline: 43–66 px desktop, 38–48 px tablet, 34–40 px mobile.
- Body: 15–17 px with 1.55–1.7 line height.
- Utility labels: 9–12 px uppercase monospace.

### 6.3 Atmosphere

- Retain the existing warm, dark operator-console background.
- Use subtle horizontal grid lines and a restrained radial gold glow behind the product demo.
- Prefer fine borders, strong alignment, and real data fields over decorative illustration.
- Motion is functional: scan progress, result reveal, and copy feedback. Avoid parallax, continuous glow animation, and decorative particle effects.

## 7. Page Architecture

### 7.1 Sticky navigation

Left:

- Callput console mark (`>_`)
- `Callput × Bankr`

Right:

- Live public-app status label
- `How it works`
- `Markets`
- `Safety`
- `For agents`
- `FAQ`
- Compact `Open Bankr` CTA

On mobile, show the brand and a single compact CTA. Section links may collapse into an accessible menu only if the implementation remains small; otherwise omit them.

### 7.2 Hero

Desktop uses a two-column 44/56 split. Mobile uses a single column with copy before demo.

Left column:

1. Eyebrow: `Built for Bankr · Base · 24/7`
2. H1: `Defined-risk options, directly inside Bankr.`
3. Supporting paragraph from section 5.1.
4. Primary CTA: `Open Callput in Bankr ↗`
5. Secondary anchor: `Try the 30-second demo ↓`
6. Three trust statements from section 5.2.

Right column:

- Interactive demo in a bordered application-window frame.
- Header labels: `Interactive trade preview` and `Simulation · no wallet`.
- The simulation must be recognizable as product UI but must not look like a live connected wallet session.

### 7.3 How a Bankr trade works

Use three equal cards on desktop and a vertical sequence on mobile:

1. `Scan` — choose asset, market view, and size; Callput ranks valid spreads.
2. `Review` — inspect strikes, expiry, minimum fill, network fee, and maximum USDC at risk.
3. `Approve` — open the exact transaction in Bankr chat; the user sends and approves there.

Each card includes a state footer:

- `No wallet action`
- `Unsigned tx only`
- `User controlled`

### 7.4 Supported markets

Render every supported symbol as text, grouped by asset type where space permits:

- Crypto: BTC, ETH
- Stocks: TSLA, NVDA, COIN, SPCX, MU, SKHY
- ETFs: QQQ, SPY, EWY

Visible disclosure:

> Synthetic on-chain options. Stock and ETF products are not broker-listed contracts, securities ownership, or shares. Candidate availability depends on the live feed.

Do not show a permanent green `live` badge per symbol because actual candidate availability can change.

### 7.5 Signing boundary

Show a semantic three-node diagram:

`Callput App → Bankr Chat → User Wallet`

- Callput App: scans markets, validates structure, and prepares exact Base calldata.
- Bankr Chat: displays transaction details and waits for explicit user action.
- User Wallet: signs and broadcasts after the user sends and approves.

The diagram must remain understandable as ordered text when CSS is unavailable.

### 7.6 For Bankr agents and builders

This is a secondary conversion block below the consumer flow.

Display a copyable configuration block:

```text
Name: callput-lite-agent-mcp
URL: https://mcp.callput.app/api/mcp
Transport: HTTP
Authentication: None
```

Include the v0.4.3 Skill URL and one copyable read-only verification prompt:

```text
List the Callput MCP tools, then scan one BTC bullish spread.
Do not prepare, sign, or submit a transaction.
```

State that the public MCP exposes ten Callput tools and returns unsigned transactions. Do not imply that adding the MCP gives it signing authority.

### 7.7 FAQ

Show answers inline using native `details` elements or always-visible cards. The following questions are required:

1. Does opening the Bankr review submit a trade?
2. What funds do I need?
3. Does Callput receive or store my private key?
4. Are these broker-listed stock or ETF options?
5. Why might no spread candidate appear?
6. How does a Bankr agent connect to Callput?

Answers must match the visible safety copy and JSON-LD exactly in substance.

### 7.8 Final CTA

Repeat one action only:

> Ready to scan your first spread?

CTA: `Open Callput in Bankr ↗`

Do not place GitHub, MCP, or documentation CTAs beside this final button.

## 8. Interactive Demo

### 8.1 Purpose

The demo proves the interaction model before the visitor leaves the page. It is educational and deterministic, not a live quotation or transaction builder.

### 8.2 Inputs

- Asset: BTC, TSLA, SPY, NVDA, ETH
- Market view: bullish, bearish, neutral-bearish, neutral-bullish
- Risk budget: under 1, 5, 25, or 100 USDC
- Size: a constrained select or stepper with deterministic demo values

All controls use native, keyboard-operable semantics.

### 8.3 State machine

1. `Choose`
   - Initial controls visible.
   - No result is implied.
2. `Scanning`
   - 400–700 ms progress transition.
   - Announce status through an `aria-live="polite"` region.
   - Skip animation when `prefers-reduced-motion: reduce` is active.
3. `Risk preview`
   - Show strategy, strikes, expiry, minimum fill, and maximum risk.
   - Show `Valid structure` rather than `Trade ready`.
4. `Bankr handoff`
   - Explain that the real Bankr App will open.
   - The CTA opens the public app in a new tab with `noopener noreferrer`.

### 8.4 Sample data

Use a clearly labeled deterministic dataset stored in the page script. Example BTC result:

- Strategy: BuyCallSpread
- Strikes: 65,000 / 67,000
- Expiry: 1 day
- Size: 0.001
- Minimum fill: 78%
- Maximum risk: 0.20 USDC

Values are examples, not current quotes. The demo must include `Simulation · no wallet` and must not use terms such as `live price`, `order submitted`, `confirmed`, `transaction hash`, or `position opened`.

## 9. Components and Isolation

Recommended static asset boundaries:

- `bankr/index.html` — semantic content, metadata, structured data, and section composition.
- `bankr/styles.css` — design tokens, responsive layout, focus states, and reduced-motion rules.
- `bankr/app.js` — deterministic demo state, copy buttons, and anonymous funnel events.
- `bankr/og-callput-bankr.png` — dedicated 1200×630 social card.

Component responsibilities:

- `BankrHero` — proposition, trust statements, primary CTA.
- `TradePreviewDemo` — deterministic state machine only.
- `QuickstartSteps` — Scan → Review → Approve explanation.
- `MarketCoverage` — supported symbols and synthetic-product disclosure.
- `SigningBoundary` — ownership and transaction-control explanation.
- `AgentSetup` — MCP and Skill configuration.
- `BankrFaq` — objection handling and schema-aligned answers.
- `FinalCta` — repeated primary conversion action.

These are conceptual boundaries implemented as static HTML sections; do not introduce a component framework.

## 10. Data Flow

### 10.1 Demo flow

`local deterministic input → local sample lookup → local risk-preview render → external Bankr App link`

There is no network dependency in the demo.

### 10.2 Real trade flow explained by the page

`Bankr user → public Callput Bankr App → Callput Bankr API → unsigned Base transaction → Bankr chat → user wallet → Base`

The guide describes this flow but does not participate in it.

### 10.3 Agent setup flow

`Bankr agent configuration → public Streamable HTTP MCP → Callput tools → unsigned transaction → Bankr signer boundary`

## 11. Error and Empty States

### 11.1 No deterministic demo match

- Message: `No matching demo spread for this combination.`
- Suggest another asset or wider risk budget.
- State: `No wallet action occurred.`
- Keep the main app CTA visible.

### 11.2 Bankr link cannot open

- Preserve the public app URL as selectable text.
- Provide `Copy app URL` and `Try again` actions.
- Do not add an inline transaction fallback.

### 11.3 JavaScript unavailable

- Hero, trust statements, quickstart, markets, signing boundary, MCP configuration, FAQ, and CTAs remain visible.
- Replace the interactive result area with a static example and a `Demo requires JavaScript` note.

### 11.4 Clipboard unavailable

- Button feedback changes to `Select text`.
- The underlying MCP configuration and prompt remain selectable.

## 12. AI Readability and Search Contract

### 12.1 Semantic HTML

- Exactly one `h1`.
- Sequential `h2` section hierarchy.
- Native `a`, `button`, `ol`, `ul`, `code`, `pre`, and `details` elements.
- Descriptive link labels; never use bare `Click here`.
- All critical claims are visible text, not canvas content or image-only labels.
- The payoff or product demonstration may use decorative graphics, but every value and conclusion must have a text equivalent.

### 12.2 Metadata

- Title: `Callput for Bankr | 24/7 Defined-Risk On-Chain Options`
- Description: `Open Callput in Bankr to scan synthetic stock, ETF, and crypto option spreads, review maximum risk, and approve Base transactions in Bankr chat.`
- Canonical: `https://mcp.callput.app/bankr`
- Open Graph/Twitter title, description, canonical URL, image, and image alternative.
- Add `/bankr` to `sitemap.xml`.
- Keep the page indexable in `robots.txt`.

### 12.3 Structured data

Use one JSON-LD graph containing:

- `WebPage`
- `SoftwareApplication`
- `HowTo`
- `FAQPage`

Requirements:

- Visible content and JSON-LD must match in substance.
- The `HowTo` describes Scan → Review → Approve.
- The application description states unsigned preparation and external signing.
- Use the current release version rather than stale hard-coded metadata.
- Do not use investment-return, profitability, or guaranteed-liquidity claims.

## 13. Analytics and Privacy

The primary event is `bankr_app_open`.

Allowed events:

- `bankr_guide_view`
- `demo_scan`
- `demo_risk_view`
- `bankr_app_open`
- `mcp_config_copy`
- `skill_link_open`
- `read_only_prompt_copy`

Allowed properties:

- CTA source: hero, demo, sticky navigation, body, or footer.
- Demo asset category and market-view category.
- Viewport class.

Never collect:

- Wallet address or wallet hash.
- Prompt contents.
- Private key or authorization material.
- Calldata, transaction payload, transaction hash, or request key.
- User-entered financial amounts beyond the fixed demo category identifier.

If no analytics provider is configured, the page remains fully functional and emits no client-visible error.

## 14. Accessibility and Responsive Behavior

- Meet WCAG AA contrast for text and controls.
- Minimum interactive target size: 44×44 CSS px on touch layouts.
- Use visible focus rings consistent with the gold accent.
- Preserve a logical keyboard order from hero CTA through demo controls and page sections.
- Announce demo progress and result changes through a polite live region.
- Respect `prefers-reduced-motion`.
- Do not rely on color alone for status or validity.
- At widths below approximately 950 px, stack Hero copy above the demo.
- At widths below approximately 820 px, stack all card grids and transform the signing diagram into an ordered vertical sequence.
- Avoid horizontal scrolling at 320 px viewport width.

## 15. Performance

- Static HTML, CSS, and vanilla JavaScript only.
- No application framework required.
- Reuse the existing Google Fonts connection or provide system fallbacks; the page remains readable if fonts fail.
- Dedicated optimized social image; no large hero photograph.
- Avoid loading live market libraries, wallet SDKs, chart libraries, or Bankr SDK code.
- Target a fast first contentful paint and keep the JavaScript payload small enough that the no-JS document remains the complete guide.

## 16. Routing and Deployment

- Add a static route for both `/bankr` and `/bankr/` to the Bankr guide entry document.
- Preserve all existing API, root, frontend-v1, sitemap, robots, and security-header routes.
- Keep `X-Frame-Options: SAMEORIGIN`, HSTS, referrer policy, permissions policy, and content-type protections unchanged.
- Validate in Vercel Preview before Production.
- Production verification must confirm that `https://mcp.callput.app/bankr` returns HTTP 200 and the existing `/api/version` and `/api/mcp` endpoints remain unchanged.

## 17. Test and Verification Plan

### 17.1 Content tests

Assert:

- Canonical URL and metadata.
- Exact Bankr App, MCP, Skill, and GitHub URLs.
- Supported symbol set.
- Primary CTA label.
- Required safety statements.
- FAQ questions and answers.
- Current release version in structured data and Skill link.

### 17.2 Interaction tests

- Every demo input is keyboard operable.
- Demo progresses through Choose, Scanning, Risk preview, and Handoff states.
- Reduced-motion mode skips nonessential transitions.
- Main CTA opens the correct Bankr App URL safely.
- Copy buttons show success and failure feedback.
- No demo interaction makes a network, wallet, or transaction call.

### 17.3 Accessibility tests

- One H1 and valid heading order.
- Logical tab order and visible focus.
- Live-region announcements.
- Text alternatives for the social image and any informative graphic.
- WCAG AA color contrast.
- No horizontal overflow at 320 px.

### 17.4 Production tests

- `/bankr` and `/bankr/` return 200.
- `/api/version` still returns the deployed release and commit.
- MCP initialization and tool listing remain successful.
- Existing security headers remain present.
- Canonical, Open Graph, Twitter, and JSON-LD metadata validate.
- Desktop and mobile visual regression snapshots match the approved design.

## 18. Acceptance Criteria

The page is complete when:

1. A new user can identify Callput, Bankr, Base, the product category, and the signing boundary in the first viewport.
2. The Hero contains one dominant Bankr App CTA and a subordinate demo CTA.
3. The deterministic demo works without network or wallet access.
4. The user flow is expressed as Scan → Review → Approve.
5. All supported symbols and synthetic-product disclosures are visible text.
6. The public MCP configuration and v0.4.3 Skill link are copyable.
7. No page interaction can prepare, sign, or broadcast a transaction.
8. The page remains useful without JavaScript.
9. Structured data matches visible content.
10. Accessibility, responsive, content, production-route, and existing MCP regression checks pass.
11. The deployed route returns 200 and the primary CTA reaches the public Bankr App.

# Callput FAQ SEO/AEO Expansion Design

Date: 2026-08-10

## Goal

Expand the visible, crawlable FAQ content on `https://mcp.callput.app/` and `https://mcp.callput.app/bankr` so humans, search engines, and answer engines can retrieve direct, accurate answers about Callput, its MCP integration, its Bankr flow, supported markets, transaction boundaries, and operational recovery.

The goal is not to manufacture FAQ volume. Every question must answer a plausible user or agent query, remain consistent with the product, and be useful when read outside the page's surrounding context.

## Search-policy boundary

Google generally limits FAQ rich-result presentation to authoritative government and health sites. FAQ structured data therefore does not guarantee a visible FAQ rich result for Callput. It remains useful as explicit machine-readable context only when it truthfully represents visible page content.

The implementation must follow these boundaries:

- Every structured question and answer is also visible on the page.
- Visible and JSON-LD wording match exactly after HTML text normalization.
- Answers are factual, concise, and people-first rather than keyword lists.
- No unsupported claims about returns, regulation, securities status, liquidity, or guaranteed execution.
- Duplicate high-intent questions may appear on both pages because each URL must be independently understandable.

## Information architecture

### Root MCP operator page

Add exactly 30 native disclosure FAQ items, grouped into six visible topic sections with five questions each:

1. Callput and MCP basics
2. Installation and agent compatibility
3. Supported markets and strategies
4. Transaction preparation and wallet control
5. Position lifecycle and monitoring
6. Safety, limits, and troubleshooting

The questions should cover at least:

- What Callput is
- What the MCP server does
- The MCP endpoint and authentication mode
- Repository and package identifiers
- Compatible MCP clients and external agents
- Supported Base chain and chain ID
- All 11 supported symbols
- Synthetic stock and ETF product boundary
- Buy and sell call/put spreads
- Butterfly and iron-condor composition
- Live feed availability
- ATM implied volatility
- Unsigned transaction output
- USDC approval behavior
- Explicit signing and broadcast boundary
- Request-key extraction and status polling
- Closing before expiry and settling after expiry
- Private-key custody
- Risk caps, minimum fill, and execution fees
- Empty scans, stale data, RPC errors, and failed transactions

### Bankr guide page

Add exactly 30 native disclosure FAQ items, grouped into six visible topic sections with five questions each:

1. Getting started in Bankr
2. Markets, strategies, and funding
3. Review, approval, and execution
4. Safety and product boundaries
5. Failures and recovery
6. Bankr agents, MCP, and social surfaces

The questions should cover at least:

- What the Callput Bankr App is
- Why the public app may require Bankr sign-in
- Bankr Club or Max Mode access expectations
- Supported assets and Base network
- Base USDC and Base ETH requirements
- Selecting direction, size, and risk budget
- Maximum-risk calculation
- Debit versus credit spreads
- Live candidate availability
- USDC balance and allowance
- Transaction preparation versus submission
- Bankr chat confirmation
- Simulation failure and recovery
- Request reconciliation
- Private-key custody
- Synthetic stock and ETF product boundary
- App versus MCP installation
- Bankr agent setup
- X/@bankrbot limitations and prerequisites
- Whether public app discovery automatically installs tools

## Content format

- Use semantic `<section>` containers and visible `<h3>` topic headings.
- Use native `<details>` and `<summary>` for every question.
- Keep every item collapsed initially; users requested a folded presentation.
- Put the direct answer in the first sentence.
- Keep most answers between two and four sentences.
- Use exact identifiers where they resolve ambiguity, including `https://mcp.callput.app/api/mcp`, Base chain ID `8453`, Base USDC, and the supported symbol list.
- Preserve the existing English-only product policy.
- Do not require JavaScript for FAQ visibility or interaction.

## Structured data

Each page keeps one `FAQPage` entity in its JSON-LD graph.

- Its `mainEntity` array contains every visible FAQ on that page.
- Each entry uses `Question` and one `acceptedAnswer` of type `Answer`.
- Question names and answer text match the corresponding visible toggle.
- Existing `WebPage`, `SoftwareApplication`, and `HowTo` entities remain valid.
- The FAQ markup makes no promise that Google will display a rich result.

## Visual treatment

- Preserve the existing dark terminal visual system.
- Topic groups use compact headings and optional one-line descriptions.
- Root page remains a single-column FAQ stack.
- Bankr may retain a two-column layout at desktop only when reading order remains correct; it collapses to one column on narrower screens.
- Summary controls retain visible focus states, pointer affordance, and native keyboard behavior.
- Open answers use existing muted text colors and sufficient spacing.

## Testing

Add or extend tests before implementation so they fail against the current pages.

Required assertions:

- Each page exposes exactly 30 `<details>` FAQ items.
- Every FAQ item has one `<summary>` and one visible answer container.
- Every item is initially collapsed; no FAQ `<details>` has the `open` attribute.
- Each page contains visible topic grouping headings.
- Required entities, endpoints, chain identifiers, supported symbols, transaction boundaries, and troubleshooting concepts appear.
- The parsed FAQPage `mainEntity` count equals the visible FAQ count.
- Each structured question and answer matches visible normalized text.
- Existing route, SEO metadata, responsive layout, analytics, and wallet-safety tests continue to pass.

## Delivery

After implementation:

1. Run targeted FAQ contract tests and the full test suite.
2. Render both pages locally at desktop and mobile widths.
3. Deploy a Vercel Preview and verify the rendered FAQ counts and JSON-LD.
4. Deploy to Production and explicitly map `mcp.callput.app` if Vercel does not update the custom-domain alias automatically.
5. Re-fetch both production URLs and verify the visible FAQ count, collapsed state, JSON-LD count, and canonical URLs.

## Out of scope

- Korean-language page creation
- Separate per-question landing pages
- User-submitted Q&A or `QAPage` markup
- Search Console submission or indexing guarantees
- Claims that FAQ markup guarantees Google rich results
- Changes to MCP tools, Bankr transaction code, contracts, supported assets, or execution policy

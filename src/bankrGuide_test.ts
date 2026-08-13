import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readProjectFile(filePath: string) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

function main() {
  assert.ok(
    fs.existsSync(path.join(process.cwd(), "bankr/index.html")),
    "the public Bankr guide entry document must exist"
  );

  const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as {
    builds?: Array<{ src?: string; use?: string }>;
    routes?: Array<{ src?: string; dest?: string }>;
  };
  assert.ok(
    vercelConfig.builds?.some((build) => build.src === "bankr/**" && build.use === "@vercel/static"),
    "Bankr guide assets must be included in the Vercel build"
  );
  assert.ok(
    vercelConfig.routes?.some((route) => route.src === "/bankr" && route.dest === "/bankr/index.html"),
    "the extensionless /bankr route must serve the guide"
  );
  assert.ok(
    vercelConfig.routes?.some((route) => route.src === "/bankr/" && route.dest === "/bankr/index.html"),
    "the trailing-slash /bankr/ route must serve the guide"
  );

  const html = readProjectFile("bankr/index.html");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Callput for Bankr \| 24\/7 Defined-Risk On-Chain Options<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/mcp\.callput\.app\/bankr"/);
  assert.match(html, /property="og:image" content="https:\/\/mcp\.callput\.app\/bankr\/og-callput-bankr\.png"/);
  assert.match(html, /href="\/bankr\/styles\.css"/);
  assert.match(html, /src="\/bankr\/app\.js"/);
  assert.match(html, /Defined-risk options, directly inside Bankr\./);
  assert.match(html, /Open Callput in Bankr/);
  const publicBankrAppUrl = "https://bankr.bot/u/0x27d94004169adfb965a6bc1adf1606cb6d82dfb4/apps/callput-options";
  assert.match(html, new RegExp(publicBankrAppUrl), "all users must be sent to the public app surface without owner Scripts controls");
  assert.doesNotMatch(html, /https:\/\/bankr\.bot\/apps\/callput-options/, "the guide must not send users to the owner-oriented app route");
  assert.match(
    html,
    /Why does the Callput Bankr App look blank when I open its URL\?[\s\S]{0,600}owner-scoped public link/i,
    "the blank-page FAQ must direct users to the owner-scoped public link"
  );
  for (const address of [
    "0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913",
    "0xfc61ba50AE7B9C4260C9f04631Ff28D5A2Fa4EB2",
    "0x83B04701B227B045CBBAF921377137fF595a54af"
  ]) assert.match(html, new RegExp(`https://basescan.org/address/${address}`, "i"), `guide must link ${address} to BaseScan`);
  assert.match(
    html,
    /Public app view[\s\S]*Bankr host may still display its Scripts drawer[\s\S]*viewer identity/i,
    "the guide must describe the Bankr host UI without weakening viewer-identity guarantees"
  );
  assert.match(html, /No private keys/);
  assert.match(html, /Not auto-submitted/);
  assert.match(html, /Synthetic on-chain/);
  assert.match(html, /Scan[\s\S]*Review[\s\S]*Approve/);
  assert.match(html, /Callput App[\s\S]*Bankr Chat[\s\S]*User Wallet/);
  for (const phrase of [
    "Close one position",
    "Settle one expired position",
    "Close all open positions",
    "Settle all expired positions"
  ]) assert.match(html, new RegExp(phrase, "i"), `the Bankr guide must document ${phrase}`);
  assert.match(html, /Each position requires its own Bankr transaction review/i, "the Bankr guide must explain batch confirmation boundaries");
  for (const symbol of ["BTC", "ETH", "TSLA", "QQQ", "SPY", "EWY", "NVDA", "COIN", "SPCX", "MU", "SKHY"]) {
    assert.match(html, new RegExp(`>${symbol}<`), `the market section must expose ${symbol} as text`);
    assert.match(html, new RegExp(`data-asset="${symbol}"`), `the interactive demo must offer ${symbol}`);
  }
  assert.match(html, /id="liveMarketStatus"[^>]*role="status"/, "the guide must expose live market availability status");
  assert.match(html, /https:\/\/mcp\.callput\.app\/api\/mcp/);
  assert.match(html, /callput-lite-agent-mcp/);
  assert.match(html, /https:\/\/github\.com\/ayggdrasil\/callput-option-agent\/tree\/v0\.5\.5\/callput/);
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
  for (const schemaType of ["WebPage", "SoftwareApplication", "HowTo", "FAQPage"]) {
    assert.match(html, new RegExp(`"@type": "${schemaType}"`), `JSON-LD must include ${schemaType}`);
  }
  assert.equal(fs.existsSync(path.join(process.cwd(), "bankr/ko/index.html")), false, "the product must remain English-only");

  const css = readProjectFile("bankr/styles.css");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /min-width: 320px/);
  assert.match(css, /:focus-visible/);

  const demoScript = readProjectFile("bankr/app.js");
  assert.match(demoScript, /bankr_guide_view/);
  assert.match(demoScript, /demo_scan/);
  assert.match(demoScript, /demo_risk_view/);
  assert.match(html, /data-event="bankr_app_open"/);
  assert.match(demoScript, /callput:analytics/);
  assert.match(demoScript, /fetch\("\/api\/bankr\/assets"/, "the guide must refresh tradable symbols from the public assets endpoint");
  assert.match(demoScript, /tradable_options/, "the guide must show live tradable option counts");
  assert.doesNotMatch(demoScript, /window\.ethereum|bankr\.|privateKey|calldata/i, "the educational demo must not touch wallet or transaction APIs");

  const rootFrontend = readProjectFile("frontend-v1/index.html");
  assert.match(rootFrontend, /href="\/bankr"[^>]*>Bankr<\/a>/, "the root operator console must link to the Bankr guide");
  for (const tool of ["callput_close_position", "callput_settle_position", "callput_close_all_positions", "callput_settle_all_positions"]) {
    assert.match(rootFrontend, new RegExp(tool), `the root MCP page must expose ${tool}`);
  }

  const sitemap = readProjectFile("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/mcp\.callput\.app\/bankr<\/loc>/);
  assert.doesNotMatch(sitemap, /\/bankr\/ko/);

  const packageJson = JSON.parse(readProjectFile("package.json")) as { scripts?: { test?: string } };
  assert.match(packageJson.scripts?.test ?? "", /bankrGuide_test\.js/, "the Bankr guide contract must run in npm test");
  assert.ok(fs.existsSync(path.join(process.cwd(), "bankr/og-callput-bankr.png")), "the dedicated Bankr social image must exist");

  console.log("Bankr guide route contract passed.");
}

main();

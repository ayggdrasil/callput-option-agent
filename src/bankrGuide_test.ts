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
  assert.match(html, /https:\/\/bankr\.bot\/apps\/callput-options/);
  assert.match(html, /No private keys/);
  assert.match(html, /Not auto-submitted/);
  assert.match(html, /Synthetic on-chain/);
  assert.match(html, /Scan[\s\S]*Review[\s\S]*Approve/);
  assert.match(html, /Callput App[\s\S]*Bankr Chat[\s\S]*User Wallet/);
  for (const symbol of ["BTC", "ETH", "TSLA", "QQQ", "SPY", "EWY", "NVDA", "COIN", "SPCX", "MU", "SKHY"]) {
    assert.match(html, new RegExp(`>${symbol}<`), `the market section must expose ${symbol} as text`);
  }
  assert.match(html, /https:\/\/mcp\.callput\.app\/api\/mcp/);
  assert.match(html, /callput-lite-agent-mcp/);
  assert.match(html, /https:\/\/github\.com\/ayggdrasil\/callput-option-agent\/tree\/v0\.4\.3\/callput/);
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
  assert.doesNotMatch(demoScript, /\bfetch\s*\(/, "the educational demo must not make network requests");
  assert.doesNotMatch(demoScript, /window\.ethereum|bankr\.|privateKey|calldata/i, "the educational demo must not touch wallet or transaction APIs");

  const rootFrontend = readProjectFile("frontend-v1/index.html");
  assert.match(rootFrontend, /href="\/bankr"[^>]*>Bankr<\/a>/, "the root operator console must link to the Bankr guide");

  const sitemap = readProjectFile("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/mcp\.callput\.app\/bankr<\/loc>/);
  assert.doesNotMatch(sitemap, /\/bankr\/ko/);

  const packageJson = JSON.parse(readProjectFile("package.json")) as { scripts?: { test?: string } };
  assert.match(packageJson.scripts?.test ?? "", /bankrGuide_test\.js/, "the Bankr guide contract must run in npm test");
  assert.ok(fs.existsSync(path.join(process.cwd(), "bankr/og-callput-bankr.png")), "the dedicated Bankr social image must exist");

  console.log("Bankr guide route contract passed.");
}

main();

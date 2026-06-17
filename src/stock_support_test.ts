import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveRpcUrl } from "./config.js";
import { formatExpiry, getMarketSnapshot, getOptionChains, normalizeAsset, scanSpreads, validateSpread } from "./core.js";

const EXPIRY = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
const EXPIRY_CODE = formatExpiry(EXPIRY);

function optionRow(
  strikePrice: number,
  markPrice: number,
  optionId: string,
  side: "C" | "P",
  symbol = "TSLA",
  markIv = 0.405
) {
  return {
    instrument: `${symbol}-${EXPIRY_CODE}-${strikePrice}-${side}`,
    optionId,
    strikePrice,
    markIv,
    markPrice,
    riskPremiumRateForBuy: 0.01,
    riskPremiumRateForSell: 0.01,
    delta: side === "C" ? 0.5 : -0.5,
    gamma: 0.01,
    vega: 0.2,
    theta: -0.01,
    volume: 0,
    isOptionAvailable: true,
    expiry: EXPIRY
  };
}

const tslaOptionIds = {
  call435: "0x0003006a2300900000000001b300000000000000000000000000000000000000",
  call440: "0x0003006a2300900000000001b800000000000000000000000000000000000000",
  call445: "0x0003006a2300900000000001bd00000000000000000000000000000000000000",
  call450: "0x0003006a2300900000000001c200000000000000000000000000000000000000"
};

const spcxOptionIds = {
  call190: "0x0009006a3424100000000000be00000000000000000000000000000000000000",
  call195: "0x0009006a3424100000000000c300000000000000000000000000000000000000",
  call200: "0x0009006a3424100000000000c800000000000000000000000000000000000000",
  call205: "0x0009006a3424100000000000cd00000000000000000000000000000000000000"
};

type VercelBuild = {
  src?: unknown;
  use?: unknown;
};

type VercelRoute = {
  src?: unknown;
  dest?: unknown;
};

type VercelConfig = {
  builds?: VercelBuild[];
  routes?: VercelRoute[];
};

function readProjectFile(filePath: string) {
  return fs.readFileSync(path.join(process.cwd(), filePath), "utf8");
}

function assertFrontendDeployConfig() {
  const coreSource = readProjectFile("src/core.ts");
  assert.equal(
    coreSource.match(/const provider = getProvider\(\)/g)?.length,
    1,
    "direct getProvider use must stay isolated to getValidatedProvider"
  );
  assert.match(coreSource, /export async function settlePosition[\s\S]*await getValidatedProvider\(\)/);

  const mcpSource = readProjectFile("src/index.ts");
  assert.match(mcpSource, /callput_settle_position[\s\S]*from_address: z\.string\(\)/);

  const rootHtml = readProjectFile("index.html");
  assert.doesNotMatch(rootHtml, /new URL\("\.\/frontend-v1\/", window\.location\.href\)/);

  const frontendHtml = readProjectFile("frontend-v1/index.html");
  assert.match(frontendHtml, /href="\/frontend-v1\/styles\.css"/);
  assert.match(frontendHtml, /src="\/frontend-v1\/app\.js"/);

  const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as VercelConfig;
  assert.ok(
    vercelConfig.builds?.some((build) => build.src === "frontend-v1/**" && build.use === "@vercel/static"),
    "frontend-v1 static files must be included in the Vercel deployment"
  );
  assert.ok(
    vercelConfig.routes?.some((route) => route.src === "/" && route.dest === "/frontend-v1/index.html"),
    "The public root must serve the operator console directly"
  );
  assert.ok(
    !vercelConfig.routes?.some((route) => route.src === "/(.*)" && route.dest === "/index.html"),
    "Vercel must not catch all frontend-v1 requests with the root redirect page"
  );

  const readme = readProjectFile("README.md");
  assert.match(readme, /cd <repo_root>\npython3 -m http\.server 4173/);

  const uiContract = readProjectFile("MCP_UI_CONTRACT.md");
  assert.match(uiContract, /callput_settle_position[\s\S]*`underlying_asset`, `from_address`, `option_token_id`/);

  const toolReference = readProjectFile("callput/references/TOOL_REFERENCE.md");
  assert.doesNotMatch(toolReference, /close_estimate/);
  assert.doesNotMatch(toolReference, /settlement: \{/);
}

(globalThis as any).fetch = async () => ({
  ok: true,
  json: async () => ({
    data: {
      market: {
        TSLA: {
          expiries: [String(EXPIRY)],
          options: {
            [String(EXPIRY)]: {
              call: [
                optionRow(435, 11.62, tslaOptionIds.call435, "C"),
                optionRow(440, 9.17, tslaOptionIds.call440, "C"),
                optionRow(445, 7.15, tslaOptionIds.call445, "C"),
                optionRow(450, 5.57, tslaOptionIds.call450, "C")
              ],
              put: [
                optionRow(435, 6.91, tslaOptionIds.call435, "P"),
                optionRow(440, 9.47, tslaOptionIds.call440, "P"),
                optionRow(445, 12.45, tslaOptionIds.call445, "P"),
                optionRow(450, 15.99, tslaOptionIds.call450, "P")
              ]
            }
          }
        },
        SPCX: {
          expiries: [String(EXPIRY)],
          options: {
            [String(EXPIRY)]: {
              call: [
                optionRow(190, 7.08, spcxOptionIds.call190, "C", "SPCX", 1.586),
                optionRow(195, 4.94, spcxOptionIds.call195, "C", "SPCX", 1.612),
                optionRow(200, 3.38, spcxOptionIds.call200, "C", "SPCX", 1.645),
                optionRow(205, 2.3, spcxOptionIds.call205, "C", "SPCX", 1.692)
              ],
              put: [
                optionRow(190, 5.99, spcxOptionIds.call190, "P", "SPCX", 1.586),
                optionRow(195, 8.85, spcxOptionIds.call195, "P", "SPCX", 1.612),
                optionRow(200, 12.28, spcxOptionIds.call200, "P", "SPCX", 1.645),
                optionRow(205, 16.21, spcxOptionIds.call205, "P", "SPCX", 1.692)
              ]
            }
          }
        }
      },
      spotIndices: { TSLA: 438.8, SPCX: 191.54 }
    }
  })
});

async function main() {
  assert.equal(resolveRpcUrl({ RPC_URL: "https://rpc.example" }), "https://rpc.example");
  assert.equal(resolveRpcUrl({ BASE_RPC_URL: "https://base-rpc.example" }), "https://base-rpc.example");
  assert.equal(resolveRpcUrl({}), "https://mainnet.base.org");
  assertFrontendDeployConfig();

  assert.equal(normalizeAsset("tsla"), "TSLA");
  assert.equal(normalizeAsset("Tesla"), "TSLA");
  assert.equal(normalizeAsset("spcx"), "SPCX");

  const configSource = readProjectFile("src/config.ts");
  assert.match(configSource, /SPCX: \{ index: 9, decimals: 18, marketType: "STOCK"/);

  const frontendApp = readProjectFile("frontend-v1/app.js");
  assert.match(frontendApp, /symbol: "SPCX", type: "stock", live: true/);

  const frontendHtml = readProjectFile("frontend-v1/index.html");
  assert.match(frontendHtml, /TSLA, QQQ, SPY, EWY, NVDA, COIN, SPCX, CRCL, SAMSUNG, and HYNIX/);

  await getMarketSnapshot(true);

  const chains = await getOptionChains({
    underlyingAsset: "TSLA",
    optionType: "Call",
    maxExpiries: 1,
    maxStrikes: 4
  });

  assert.equal(chains.asset, "TSLA");
  assert.equal(chains.spot_price, 438.8);
  assert.equal(chains.expiries[EXPIRY_CODE].call.length, 4);
  assert.equal(chains.expiries[EXPIRY_CODE].call[1][4], tslaOptionIds.call440);
  assert.equal(chains.expiries[EXPIRY_CODE].call[1][6], 40.5);

  const scan = await scanSpreads({
    underlyingAsset: "TSLA",
    bias: "bullish",
    maxResults: 1
  });

  assert.equal(scan.asset, "TSLA");
  assert.equal(scan.candidates[0].long_leg_id, tslaOptionIds.call440);
  assert.equal(scan.candidates[0].short_leg_id, tslaOptionIds.call450);
  assert.equal(scan.candidates[0].atm_iv, 40.5);

  const validation = await validateSpread("BuyCallSpread", tslaOptionIds.call440, tslaOptionIds.call445);
  assert.equal(validation.details.asset, "TSLA");
  assert.equal(validation.details.option_type, "Call");

  const spcxChains = await getOptionChains({
    underlyingAsset: "SPCX",
    optionType: "Call",
    maxExpiries: 1,
    maxStrikes: 4
  });

  assert.equal(spcxChains.asset, "SPCX");
  assert.equal(spcxChains.spot_price, 191.54);
  assert.equal(spcxChains.expiries[EXPIRY_CODE].call[0][4], spcxOptionIds.call190);
  assert.equal(spcxChains.expiries[EXPIRY_CODE].call[0][6], 158.6);

  const spcxScan = await scanSpreads({
    underlyingAsset: "SPCX",
    bias: "bullish",
    maxResults: 1
  });

  assert.equal(spcxScan.asset, "SPCX");
  assert.equal(spcxScan.candidates[0].long_leg_id, spcxOptionIds.call190);
  assert.equal(spcxScan.candidates[0].short_leg_id, spcxOptionIds.call205);

  const spcxValidation = await validateSpread("BuyCallSpread", spcxOptionIds.call190, spcxOptionIds.call200);
  assert.equal(spcxValidation.details.asset, "SPCX");
  assert.equal(spcxValidation.details.option_type, "Call");

  console.log("Stock option support test passed.");
}

main().catch((err) => {
  console.error("Stock option support test failed:", err);
  process.exit(1);
});

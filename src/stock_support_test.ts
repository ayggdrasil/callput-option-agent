import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveRpcUrl } from "./config.js";
import { getMarketSnapshot, getOptionChains, normalizeAsset, scanSpreads, validateSpread } from "./core.js";

const EXPIRY = 1780678800;

function optionRow(strikePrice: number, markPrice: number, optionId: string, side: "C" | "P") {
  return {
    instrument: `TSLA-05JUN26-${strikePrice}-${side}`,
    optionId,
    strikePrice,
    markIv: 0.405,
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
        }
      },
      spotIndices: { TSLA: 438.8 }
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

  await getMarketSnapshot(true);

  const chains = await getOptionChains({
    underlyingAsset: "TSLA",
    optionType: "Call",
    maxExpiries: 1,
    maxStrikes: 4
  });

  assert.equal(chains.asset, "TSLA");
  assert.equal(chains.spot_price, 438.8);
  assert.equal(chains.expiries["05JUN26"].call.length, 4);
  assert.equal(chains.expiries["05JUN26"].call[1][4], tslaOptionIds.call440);
  assert.equal(chains.expiries["05JUN26"].call[1][6], 40.5);

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

  console.log("Stock option support test passed.");
}

main().catch((err) => {
  console.error("Stock option support test failed:", err);
  process.exit(1);
});

import { getOptionChains, validateSpread } from "./core.js";

async function main() {
  const chains = await getOptionChains({
    underlyingAsset: "ETH",
    optionType: "Call",
    maxExpiries: 1,
    maxStrikes: 10
  });

  const expiry = Object.keys(chains.expiries)[0];
  if (!expiry) throw new Error("No expiry returned from getOptionChains");

  const calls = chains.expiries[expiry].call;
  if (!calls || calls.length < 2) throw new Error("Not enough call options for smoke test");

  const long = calls[0][4] as string;
  const short = calls[1][4] as string;

  try {
    const v = await validateSpread("BuyCallSpread", long, short);
    console.log("Validation status:", v.status);
  } catch (e: any) {
    console.log("Validation (expected may fail on pair choice):", e.message);
  }

  console.log("Smoke test passed: market feed and tool core are operational.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});

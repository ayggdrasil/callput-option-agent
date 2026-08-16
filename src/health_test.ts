import assert from "node:assert/strict";
import { buildHealthReport } from "./health.js";

async function main() {
  const healthy = await buildHealthReport({
    now: () => new Date("2026-08-13T06:00:00.000Z"),
    checkRpc: async () => ({ chainId: 8453, blockNumber: 49_900_000 }),
    checkMarket: async () => ({ assets: 11, tradableOptions: 100 })
  });
  assert.equal(healthy.status, "ok");
  assert.equal(healthy.version, "0.5.15");
  assert.equal(healthy.checks.rpc.chain_id, 8453);
  assert.equal(healthy.checks.market.assets, 11);
  assert.equal(healthy.checked_at, "2026-08-13T06:00:00.000Z");

  const degraded = await buildHealthReport({
    now: () => new Date("2026-08-13T06:01:00.000Z"),
    checkRpc: async () => { throw new Error("RPC_URL contains a secret token"); },
    checkMarket: async () => ({ assets: 0, tradableOptions: 0 })
  });
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.checks.rpc.ok, false);
  assert.equal(degraded.checks.rpc.error, "rpc check failed");
  assert.equal(degraded.checks.market.ok, false);
  assert.equal(degraded.checks.market.error, "market has no tradable options");

  console.log("Health checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

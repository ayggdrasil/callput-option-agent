import { ethers } from "ethers";
import { CONFIG } from "./config.js";
import { getMarketSnapshot } from "./core.js";
import { CALLPUT_VERSION } from "./version.js";

type RpcCheck = { chainId: number; blockNumber: number };
type MarketCheck = { assets: number; tradableOptions: number };

export type HealthDependencies = {
  now: () => Date;
  isDedicatedRpcConfigured: () => boolean;
  checkRpc: () => Promise<RpcCheck>;
  checkMarket: () => Promise<MarketCheck>;
};

const defaultDependencies: HealthDependencies = {
  now: () => new Date(),
  isDedicatedRpcConfigured: () => Boolean(process.env.RPC_URL || process.env.BASE_RPC_URL),
  async checkRpc() {
    const request = new ethers.FetchRequest(CONFIG.RPC_URL);
    request.timeout = 5_000;
    const provider = new ethers.JsonRpcProvider(request, CONFIG.CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
    const [chainIdHex, blockNumberHex] = await Promise.all([
      provider.send("eth_chainId", []),
      provider.send("eth_blockNumber", [])
    ]);
    return { chainId: Number(BigInt(chainIdHex)), blockNumber: Number(BigInt(blockNumberHex)) };
  },
  async checkMarket() {
    const snapshot = await getMarketSnapshot(true);
    return {
      assets: Object.values(snapshot.spot).filter((price) => Number.isFinite(price) && price > 0).length,
      tradableOptions: snapshot.options.filter((option) => option.isAvailable).length
    };
  }
};

export async function buildHealthReport(deps: HealthDependencies = defaultDependencies) {
  const checks: any = {};
  try {
    const rpc = await deps.checkRpc();
    if (rpc.chainId !== CONFIG.CHAIN_ID) throw new Error("wrong chain");
    checks.rpc = {
      ok: true,
      chain_id: rpc.chainId,
      block_number: rpc.blockNumber,
      dedicated_rpc_configured: deps.isDedicatedRpcConfigured()
    };
  } catch {
    checks.rpc = { ok: false, error: "rpc check failed" };
  }

  try {
    const market = await deps.checkMarket();
    if (market.assets < 1 || market.tradableOptions < 1) throw new Error("empty market");
    checks.market = { ok: true, assets: market.assets, tradable_options: market.tradableOptions };
  } catch {
    checks.market = { ok: false, error: "market has no tradable options" };
  }

  return {
    status: checks.rpc.ok && checks.market.ok ? "ok" : "degraded",
    version: CALLPUT_VERSION,
    checked_at: deps.now().toISOString(),
    checks
  };
}

import assert from "node:assert/strict";
import { ethers } from "ethers";
import { CONFIG } from "./config.js";

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org", undefined, { batchMaxCount: 1 });
const market = new ethers.Contract("0xBD40a87CcBD20E44C45F19A074E7d67Ee85327c7", [
  "function getUnderlyingAssetByIndex(uint16) view returns (address,uint8)",
  "function getOptionsTokenByIndex(uint16) view returns (address)"
], provider);
try {
  assert.equal((await provider.getNetwork()).chainId, 8453n);
  const blockTag = await provider.getBlockNumber();
  for (const [symbol, config] of Object.entries(CONFIG.UNDERLYINGS)) {
    const [underlying, token] = await Promise.all([
      market.getUnderlyingAssetByIndex(config.index, { blockTag }),
      market.getOptionsTokenByIndex(config.index, { blockTag })
    ]);
    assert.equal(Number(underlying[1]), config.decimals, `${symbol} decimals`);
    assert.equal(token.toLowerCase(), config.optionsToken.toLowerCase(), `${symbol} options token`);
    assert.notEqual(await provider.getCode(token, blockTag), "0x", `${symbol} options token must be deployed`);
    console.log(`${symbol}: index ${config.index}, decimals ${config.decimals}, options token verified at Base block ${blockTag}`);
  }
} finally {
  provider.destroy();
}

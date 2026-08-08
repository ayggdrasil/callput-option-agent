import assert from "node:assert/strict";
import { ethers } from "ethers";
import { CONFIG } from "./config.js";

function main() {
  for (const [name, address] of Object.entries(CONFIG.CONTRACTS)) {
    assert.doesNotThrow(() => ethers.getAddress(address), `invalid contract address ${name}: ${address}`);
  }
  for (const [symbol, underlying] of Object.entries(CONFIG.UNDERLYINGS)) {
    assert.doesNotThrow(() => ethers.getAddress(underlying.optionsToken), `invalid options token ${symbol}: ${underlying.optionsToken}`);
  }
  console.log("Config address tests passed.");
}

main();

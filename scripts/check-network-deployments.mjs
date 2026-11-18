import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { getNetworkConfig } from '../build/src/config.js';

const results = await Promise.all(['base', 'robinhood', 'giwa'].map(async network => {
  const config = getNetworkConfig(network, {});
  const request = new ethers.FetchRequest(config.RPC_URL);
  request.timeout = 15000;
  const rpc = new ethers.JsonRpcProvider(request, config.CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
  const result = { network, expected_chain: config.CHAIN_ID };
  try {
    const chain = Number(BigInt(await rpc.send('eth_chainId', [])));
    assert.equal(chain, config.CHAIN_ID);
    const pm = new ethers.Contract(config.CONTRACTS.POSITION_MANAGER, ['function controller() view returns(address)', 'function executionFee() view returns(uint256)'], rpc);
    const settle = new ethers.Contract(config.CONTRACTS.SETTLE_MANAGER, ['function controller() view returns(address)'], rpc);
    const usdc = new ethers.Contract(config.CONTRACTS.USDC, ['function decimals() view returns(uint8)'], rpc);
    const [controller, settleController, executionFee, decimals, code, multicallCode] = await Promise.all([
      pm.controller(), settle.controller(), pm.executionFee(), usdc.decimals(), rpc.getCode(config.CONTRACTS.POSITION_MANAGER), rpc.getCode("0xcA11bde05977b3631167028862bE2a173976CA11")
    ]);
    assert.equal(controller.toLowerCase(), config.CONTRACTS.ROUTER.toLowerCase());
    assert.equal(settleController.toLowerCase(), config.CONTRACTS.ROUTER.toLowerCase());
    assert.equal(Number(decimals), 6);
    assert.ok(code.length > 2);
    assert.ok(multicallCode.length > 2, "Multicall3 is not deployed");
    result.rpc = { ok: true, chain_id: chain, controller, execution_fee_wei: String(executionFee), usdc_decimals: Number(decimals), multicall3_deployed: true };
  } catch(error) { result.rpc = { ok: false, error: error.shortMessage || error.message }; }
  finally { rpc.destroy(); }
  try {
    const response = await fetch(config.MARKET_DATA_URL, { cache:'no-store', signal:AbortSignal.timeout(15000) });
    const data = await response.json();
    result.feed = { status: response.status, updated_at: data.lastUpdatedAt, age_seconds: Math.round((Date.now() - Date.parse(data.lastUpdatedAt))/1000), symbols: Object.keys(data.data?.market || {}).length };
  } catch(error) { result.feed = { error: error.message }; }
  return result;
}));
console.log(JSON.stringify(results, null, 2));
if(results.some(result => !result.rpc.ok)) process.exitCode = 1;

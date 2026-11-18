import assert from 'node:assert/strict';
import { CALLPUT_VERSION } from '../build/src/version.js';
const origin = (process.env.CALLPUT_PRODUCTION_URL || 'https://mcp.callput.app').replace(/\/$/, '');
let id = 0;
async function call(network, method, params) {
  const response = await fetch(`${origin}/api/mcp?network=${network}`, { method:'POST',
    headers:{ accept:'application/json, text/event-stream', 'content-type':'application/json' },
    body:JSON.stringify({jsonrpc:'2.0', id:++id, method, params}), signal:AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(!body.error, JSON.stringify(body.error));
  return body.result;
}
const results=[];
for(const [network, chainId, testnet] of [['base',8453,false],['robinhood',4663,false],['giwa',91342,true]]) {
  const init=await call(network,'initialize',{ protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{name:'release-check',version:'1'} });
  assert.equal(init.serverInfo.version,CALLPUT_VERSION);
  const list=await call(network,'tools/list',{});
  assert.equal(list.tools.length,13);
  const info=await call(network,'tools/call',{name:'callput_get_network_info',arguments:{}});
  assert.equal(info.structuredContent.chain_id,chainId);
  assert.equal(info.structuredContent.network,network);
  assert.equal(info.structuredContent.testnet,testnet);
  const result={network,chain_id:chainId,testnet,tools:list.tools.length,configured_markets:info.structuredContent.underlyings.length,read_checks:[]};
  for(const name of ['callput_scan_spreads','callput_get_option_chains']) {
    const args=name==='callput_scan_spreads'?{underlying_asset:'ETH',bias:'bullish',max_results:1}:{underlying_asset:'ETH',max_expiries:1,max_strikes:2};
    const read=await call(network,'tools/call',{name,arguments:args});
    if(read.isError) {
      const message=read.content[0].text;
      assert.match(message,/STALE_MARKET_DATA/);
      result.read_checks.push({tool:name,status:'upstream_stale_rejected'});
    } else {
      assert.equal(read.structuredContent.chain_id,chainId);
      assert.equal(read.structuredContent.network,network);
      result.read_checks.push({tool:name,status:'ok'});
    }
  }
  const assets=await fetch(`${origin}/api/bankr/assets?network=${network}`,{signal:AbortSignal.timeout(30000)});
  const data=await assets.json();
  if(assets.ok) {
    assert.equal(data.chain_id,chainId);assert.equal(data.network,network);
    assert.equal(data.assets.length,result.configured_markets);
    result.assets='ok';
  } else { assert.match(data.error,/STALE_MARKET_DATA/);result.assets='upstream_stale_rejected'; }
  results.push(result);
}
const invalid=await fetch(`${origin}/api/mcp?network=invalid`,{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json'},body:'{}'});
assert.equal(invalid.status,400);
const page=await fetch(origin);const html=await page.text();
assert.equal(page.status,200);assert.ok(html.includes('Robinhood'));assert.ok(html.includes('GIWA'));
console.log(JSON.stringify({version:CALLPUT_VERSION,origin,integration:'passed',networks:results},null,2));

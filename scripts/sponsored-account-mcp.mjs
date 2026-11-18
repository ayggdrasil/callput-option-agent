import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {sponsoredStorage} from './sponsored-storage.mjs';
import {SponsoredRelay} from './sponsored-relay.mjs';

export function createSponsoredMcp(relay){
  const server=new McpServer({name:'callput-sponsored-account-local',version:'0.1.0'});
  const tool=(name,description,schema,fn)=>server.registerTool(name,{description,inputSchema:schema},async args=>{
    try{const result=await fn(args);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
    catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
  });
  tool('callput_account_info','Local account identity, signer readiness and fixed user risk cap. No secrets returned.',z.object({}).strict(),async()=>relay.info());
  tool('callput_account_context','Read sponsored account custody and readiness from the pinned relay. An optional public session ID selects an existing device for recovery observation.',z.object({session_id:z.string().regex(/^0x[0-9a-f]{64}$/).optional()}).strict(),async({session_id})=>relay.context(session_id));
  tool('callput_account_login','Authenticate the fixed owner using the locally unlocked signer. Cookies stay in this local process.',z.object({}).strict(),async()=>relay.login());
  tool('callput_account_register_session','Register one 10-minute ETH buy-call-spread session, one open and no closes, max user amount0.1USDG. Requires an unlocked signer and durable budget ledger.',z.object({}).strict(),async()=>relay.registerSession());
  const uint=z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
  tool('callput_account_open','Submit one gas-sponsored ETH buy-call spread within the registered0.1USDG cap. Repeated identical requests reuse the signed order; different orders reject. Never funds an owner-wallet transaction.',z.object({underlyingAssetIndex:z.literal('2'),length:z.literal('2'),isBuys:z.array(z.boolean()).length(4),optionIds:z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).length(4),isCalls:z.array(z.boolean()).length(4),minSize:uint,amountIn:uint}).strict(),async args=>relay.open(args));
  tool('callput_account_verify_receipt','Verify the saved sponsored open intent against canonical receipt, pinned sponsor/account/manager, exact calldata and both matching request events. Keeps direct-wallet receipt validation unchanged.',z.object({hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict(),async({hash})=>relay.receipt(hash));
  tool('callput_account_unused_expiry_proof','Read-only proof that a saved signed grant expired with zero use at a finalized canonical block. Never treats latest or a relay observation as finality.',z.object({}).strict(),async()=>relay.unusedExpiryProof());
  tool('callput_account_order_status','Read the relay request UUID status. An included transaction is not yet proof of keeper execution; reconcile the on-chain request key with Callput MCP.',z.object({id:z.string().uuid()}).strict(),async({id})=>relay.orderStatus(id));
  return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  // Standalone stdio is read-only until a local terminal runner injects the signer.
  const network=process.env.CALLPUT_NETWORK??'robinhood';
  const resumeSession=process.env.CALLPUT_OBSERVE_SAVED_SESSION==='1'?await sponsoredStorage(path.join(os.homedir(),'Library','Application Support','CallputSigner'),network).loadPublic():undefined;
  const relay=new SponsoredRelay({network,resumeSession,owner:process.env.CALLPUT_OWNER_ADDRESS??'0x84B67bB8b023fc6640C37619cAe28447103b61a8'});
  await createSponsoredMcp(relay).connect(new StdioServerTransport());
}

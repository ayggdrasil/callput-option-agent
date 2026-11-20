import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcpHttpRequest } from "./http.js";
import { DEPLOYMENTS } from "./networkDeployments.js";
import { networkInfo, withNetwork } from "./config.js";
test("account workflow tools are discoverable even when durable storage is not configured", async () => {
  const response = await handleMcpHttpRequest(
    new Request("https://mcp.callput.app/api/mcp?network=robinhood", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    }),
  );
  const body: any = await response.json();
  const start = body.result.tools.find((tool: any) => tool.name === "callput_workflow_start");
  assert.ok(start.inputSchema.properties.underlying_asset);
  assert.deepEqual(start.inputSchema.properties.strategy.enum, [
    "BuyCallSpread", "SellCallSpread", "BuyPutSpread", "SellPutSpread",
  ]);
  const names = body.result.tools.map((t: any) => t.name);
  for (const name of [
    "callput_wallet_connect",
    "callput_account_resolve",
    "callput_workflow_start",
    "callput_workflow_status",
    "callput_action_prepare",
    "callput_action_submit",
    "callput_action_status",
    "callput_session_status",
    "callput_session_revoke",
    "callput_workflow_recover",
  ])
    assert.ok(names.includes(name), name);
});
test("sponsored scope matches all configured option underlyings on each account network", () => {
  for (const network of ["robinhood", "giwa"] as const) {
    const info = withNetwork(network, networkInfo);
    assert.deepEqual(
      (info.account_workflow as any).supported_open_underlyings,
      Object.keys(DEPLOYMENTS[network].underlyings),
    );
  }
  assert.equal(withNetwork("base", networkInfo).account_workflow, null);
});
test("wallet handoff API rejects foreign origins before touching storage", async () => {
  const { handleWalletRequest } = await import("./accountTools.js");
  const response = await handleWalletRequest(
    new Request("https://mcp.callput.app/api/wallet", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "read", workflow_id: "a".repeat(64) }),
    }),
  );
  assert.equal(response.status, 403);
});
test("wallet handoff accepts app-origin CORS preflight", async () => {
  const { handleWalletRequest } = await import("./accountTools.js");
  const response = await handleWalletRequest(
    new Request("https://mcp.callput.app/api/wallet", {
      method: "OPTIONS",
      headers: { origin: "https://app.callput.app" },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://app.callput.app");
});

test("external MCP client creates, funds, grants, opens and closes a new account without using the browser app", async (t) => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerAccountTools } = await import("./accountTools.js");
  const { flowFixture } = await import("./accountFlowFixtures.js");
  const { z } = await import("zod");
  const f = await flowFixture();
  t.after(f.cleanup);
  const service = new McpServer({name:"account-lifecycle-fixture",version:"1"});
  const client = new Client({name:"external-agent-fixture",version:"1"});
  const [front, back] = InMemoryTransport.createLinkedPair();
  let created = false, funded = false, creates = 0;
  const rp = f.ports.resolve, rl = f.ports.relay;
  const hash = "0x"+"e".repeat(64);
  f.ports.resolve = async (...args) => ({...await rp(...args), created, balance: funded ? "1000000" : "0"});
  f.ports.relay = async (s,p,b) => {
    if(p==="/v1/accounts") {
      creates++;
      created=true;
      return {id:b.requestId, account:f.account, action:"create", state:"queued"};
    }
    return rl(s,p,b);
  };
  f.ports.depositTransaction = async (s,data)=>({ to:"0x5fc5360d0400a0fd4f2af552add042d716f1d168", from:s.owner,
    data, chainId:"0x1237", gas:"0x5208", gasPrice:"0x1", nonce:"0x0", value:"0x0" });
  f.ports.verifyDeposit=async (_s,_a,tx)=>({confirmed:funded && tx===hash});
  registerAccountTools(service,"robinhood",{workflow:()=>f.engine,resolve:f.ports.resolve});
  service.registerTool("callput_portfolio_summary",{inputSchema:z.object({address:z.string()})},async ({address})=>{
    assert.equal(address,f.account);
    return {content:[],structuredContent:await f.ports.portfolio!({account:address})};
  });
  await service.connect(back);
  await client.connect(front);
  t.after(async()=>{await client.close();await service.close();});
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.callTool({name,arguments:args});
    assert.equal(result.isError,undefined,JSON.stringify(result.content));
    return result.structuredContent as any;
  };
  const resources=await client.listResources();
  assert.equal(resources.resources[0].uri,"callput://account/workflow");
  const guide=await client.readResource({uri:resources.resources[0].uri});
  const handoff = guide.contents[0];
  assert.ok("text" in handoff);
  assert.equal(JSON.parse(handoff.text).signer_handoff.browser_handoff_required,false);
  const resolved=await call("callput_account_resolve",{owner:f.owner.address});
  assert.equal(resolved.created,false);
  const started=await call("callput_workflow_start",{owner:f.owner.address, deposit_amount_raw:"1000000",max_deposit_gas_wei:"500000",max_user_amount_raw:"500000"});
  const bind={workflow_id:started.workflow_id};
  assert.deepEqual(started.next_actions[0].required_external_input,["device_signer"]);
  await call(started.next_actions[0].tool,{...started.next_actions[0].arguments,device_signer:f.device.address});
  async function act(step:string,input:Record<string,unknown>={}){
    const action=await call("callput_action_prepare",{...bind,step,input});
    assert.equal(action.blocked_reason,null,action.blocked_reason);
    let result:Record<string,unknown>={};
    if(action.wallet_request) {
      const begin=await call("callput_action_begin",{...bind,action_id:action.action_id});
      assert.equal(begin.wallet_request_may_execute,true);
      if(action.wallet_request.method==="eth_sendTransaction") {
        assert.equal(action.wallet_request.params[0].from,f.owner.address.toLowerCase());
        funded=true;
        result={transaction_hash:hash};
      } else result=await f.sign(action);
    } else assert.equal(action.submit_result_with.result_kind,"empty_object");
    const submit=await call(action.submit_result_with.tool,{...action.submit_result_with.arguments,result});
    assert.ok(!submit.blocked_reason,submit.blocked_reason);
    return call("callput_action_status",{...bind,action_id:action.action_id});
  }
  assert.equal((await act("login")).action_state,"confirmed");
  assert.equal((await act("create")).action_state,"confirmed");
  assert.equal(creates,1);
  assert.equal((await act("deposit")).action_state,"confirmed");
  assert.equal((await act("register")).action_state,"confirmed");
  const opened=await act("open",{size:0.02,min_fill_ratio:0.78,max_amount_in_raw:"500000"});
  assert.equal(opened.action_state,"executed");
  const portfolio=await call(opened.next_actions[0].tool,opened.next_actions[0].arguments);
  assert.equal(portfolio.positions.length,1);
  const closed=await act("close",{option_token_id:BigInt(portfolio.positions[0].token_id).toString(),size_raw:"1",min_amount_out_raw:"1"});
  assert.equal(closed.action_state,"executed");
});

test("MCP exposes open quantity types and repairs legacy invalid preparation through the same action", async (t) => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { registerAccountTools } = await import("./accountTools.js");
  const { flowFixture } = await import("./accountFlowFixtures.js");
  const f = await flowFixture();
  t.after(f.cleanup);
  const g = await f.engine.prepare(f.token, "register", {});
  await f.engine.submit(f.token, g.action_id, await f.sign(g));
  await f.engine.status(f.token);
  const service = new McpServer({ name: "preparation-fixture", version: "1" });
  const client = new Client({ name: "external-preparation-client", version: "1" });
  registerAccountTools(service, "robinhood", { workflow: () => f.engine });
  const [front, back] = InMemoryTransport.createLinkedPair();
  await service.connect(back);
  await client.connect(front);
  t.after(async () => { await client.close(); await service.close(); });
  const tools = await client.listTools();
  const prepare = tools.tools.find(x => x.name === "callput_action_prepare")!;
  const properties: any = prepare.inputSchema.properties;
  assert.deepEqual(new Set(properties.input.properties.size.type), new Set(["number", "string"]));
  assert.equal(properties.input.properties.min_fill_ratio.minimum, 0.5);
  assert.equal(properties.input.properties.min_fill_ratio.maximum, 1);
  assert.equal(properties.input.additionalProperties, false);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, undefined);
    return response.structuredContent as any;
  };
  const invalid = await call("callput_action_prepare", {
    workflow_id: f.token, step: "open", input: { size: "0.02 ETH" },
  });
  assert.equal(invalid.state, "input_required");
  assert.equal(invalid.input_errors[0].field, "size");
  assert.equal(invalid.action_id, undefined);
  const id = "9499e3db-265f-4e05-9ff7-67d6d5673206";
  await f.store.update(f.token, async (s) => {
    s.policy.max_user_amount_raw = "500000";
    s.grant.maxAmount = s.grant.maxAmountPerOpen = "500000";
    s.actions.push({ id, step: "open", input: { size: "0.02 ETH" },
      state: "preparing", reason: "invalid_open_input", fee_payer: "protocol_sponsor" });
  });
  const legacy = await call("callput_action_prepare", {
    workflow_id: f.token, action_id: id, step: "open", input: { size: "0.02 ETH" },
  });
  assert.equal(legacy.action_id, id);
  assert.equal(legacy.preparation_recovery.safe_to_repair, true);
  assert.equal(legacy.next_actions[0].arguments.action_id, id);
  const recovered = await call("callput_action_prepare", {
    ...legacy.next_actions[0].arguments, input: { size: 0.02, min_fill_ratio: 0.78 },
  });
  assert.equal(recovered.action_id, id);
  assert.equal(recovered.action_state, "prepared");
  assert.equal(recovered.actions.at(-1).trade.nonce, (1n << 128n).toString());
  for (const size of [0.02, "0.02"]) {
    const repeated = await call("callput_action_prepare", {
      ...legacy.next_actions[0].arguments, input: { min_fill_ratio: 0.78, size },
    });
    assert.equal(repeated.action_id, id);
    assert.equal(repeated.digest, recovered.digest);
    assert.deepEqual(repeated.wallet_request, recovered.wallet_request);
    assert.equal(repeated.actions.filter((action: any) => action.step === "open").length, 1);
  }
  assert.equal(f.requests.filter(r => r.path === "/v1/trades").length, 0);
});

test("open preparation schema rejects percent and quoted min_fill_ratio before allocating an action", async () => {
  for (const min_fill_ratio of [78, "0.78"]) {
    const response = await handleMcpHttpRequest(new Request("https://mcp.callput.app/api/mcp?network=robinhood", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "callput_action_prepare", arguments: { workflow_id: "a".repeat(64), step: "open", input: { size: 0.02, min_fill_ratio } },
      } }),
    }));
    const value: any = await response.json();
    assert.equal(value.result.isError, true);
    assert.ok(JSON.stringify(value.result.content).includes("min_fill_ratio"));
  }
});

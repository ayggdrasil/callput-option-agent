import assert from "node:assert/strict";
import { handleMcpHttpRequest } from "./http.js";

async function main() {
  const forbidden = await handleMcpHttpRequest(new Request("https://mcp.callput.app/api/mcp", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: "{}"
  }));
  assert.equal(forbidden.status, 403);

  const options = await handleMcpHttpRequest(new Request("https://mcp.callput.app/api/mcp", {
    method: "OPTIONS",
    headers: { origin: "https://bankr.bot" }
  }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "https://bankr.bot");

  const initialize = await handleMcpHttpRequest(new Request("https://mcp.callput.app/api/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "http-test", version: "1" } }
    })
  }));
  assert.equal(initialize.status, 200);
  const initialized = await initialize.json() as any;
  assert.equal(initialized.result.serverInfo.name, "callput-lite-agent-mcp");
  assert.equal(initialized.result.serverInfo.version, "0.5.22");

  const toolList = await handleMcpHttpRequest(new Request("https://mcp.callput.app/api/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  }));
  assert.equal(toolList.status, 200);
  const tools = ((await toolList.json()) as any).result.tools;
  const executeSpreadSchema = tools.find((tool: any) => tool.name === "callput_execute_spread").inputSchema;
  assert.deepEqual(
    executeSpreadSchema.required,
    ["strategy", "from_address", "long_leg_id", "short_leg_id", "size"],
    "tools/list must advertise every required execute_spread argument"
  );
  for (const field of executeSpreadSchema.required) {
    assert.ok(executeSpreadSchema.properties[field], `tools/list must describe execute_spread.${field}`);
  }
  const closeRequired = tools.find((tool: any) => tool.name === "callput_close_position").inputSchema.required;
  assert.ok(closeRequired.includes("min_amount_out_raw"));
  assert.ok(closeRequired.includes("min_out_when_swap_raw"));
  const settleRequired = tools.find((tool: any) => tool.name === "callput_settle_position").inputSchema.required;
  assert.ok(settleRequired.includes("min_out_when_swap_raw"));
  const closeAll = tools.find((tool: any) => tool.name === "callput_close_all_positions");
  assert.ok(closeAll, "tools/list must advertise close-all position management");
  assert.deepEqual(closeAll.inputSchema.required, ["from_address", "min_amount_out_raw", "min_out_when_swap_raw"]);
  const settleAll = tools.find((tool: any) => tool.name === "callput_settle_all_positions");
  assert.ok(settleAll, "tools/list must advertise settle-all position management");
  assert.deepEqual(settleAll.inputSchema.required, ["from_address", "min_out_when_swap_raw"]);

  let limitedStatus = 0;
  for (let index = 0; index < 61; index += 1) {
    const limited = await handleMcpHttpRequest(new Request("https://mcp.callput.app/api/mcp", {
      method: "GET",
      headers: { "x-forwarded-for": "203.0.113.9" }
    }));
    limitedStatus = limited.status;
  }
  assert.equal(limitedStatus, 429, "public MCP must enforce a per-client request ceiling");

  console.log("HTTP MCP tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

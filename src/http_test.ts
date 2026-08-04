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
  assert.equal(initialized.result.serverInfo.version, "0.3.0");

  console.log("HTTP MCP tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

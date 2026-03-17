import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({ command: "node", args: ["build/index.js"] });
  const client = new Client({ name: "callput-lite-mcp-smoke", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = new Set(tools.tools.map((t) => t.name));

    [
      "callput_bootstrap",
      "callput_get_option_chains",
      "callput_validate_spread",
      "callput_execute_spread",
      "callput_check_request_status",
      "callput_get_positions",
      "callput_close_position",
      "callput_settle_position"
    ].forEach((name) => {
      if (!names.has(name)) {
        throw new Error(`Missing MCP tool: ${name}`);
      }
    });

    const bootstrap = await client.callTool({ name: "callput_bootstrap", arguments: {} });
    if ((bootstrap as any).isError) {
      throw new Error(`callput_bootstrap failed: ${(bootstrap as any).content?.[0]?.text}`);
    }

    const chains = await client.callTool({
      name: "callput_get_option_chains",
      arguments: {
        underlying_asset: "ETH",
        option_type: "Call",
        max_expiries: 1,
        max_strikes: 6
      }
    });

    if ((chains as any).isError) {
      throw new Error(`callput_get_option_chains failed: ${(chains as any).content?.[0]?.text}`);
    }

    console.log("MCP smoke test passed.");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("MCP smoke test failed:", e);
  process.exit(1);
});

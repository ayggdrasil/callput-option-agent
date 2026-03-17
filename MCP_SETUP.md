# MCP Setup (Callput Lite)

This server is for external agents that should trade Callput with minimal setup.

## Build

```bash
cd <repo_root>
npm install
npm run build
npm run verify
```

## MCP config

```json
{
  "mcpServers": {
    "callput_lite": {
      "command": "node",
      "args": ["<repo_root>/build/index.js"],
      "env": {
        "RPC_URL": "https://mainnet.base.org",
        "CALLPUT_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Verify in client
- Call `callput_bootstrap`
- Call `callput_get_option_chains` for ETH
- Call `callput_validate_spread`
- Call `callput_execute_spread` with `dry_run=true`

# MCP Setup (Callput Lite)

This server is for external agents that should trade Callput crypto and synthetic stock/ETF options with minimal setup.

## Canonical names

- Source repo to clone: `https://github.com/ayggdrasil/callput-option-agent.git`
- MCP server id in client config: `callput-lite-agent-mcp`
- Package name in `package.json`: `callput-lite-mcp-skill`

## Supported underlyings

Crypto: `BTC`, `ETH`. Stock/ETF feed symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `SPCX`, `CRCL`, `SAMSUNG`, `HYNIX`. Live availability is feed-driven; no candidates means the symbol is not currently tradable.

## Build

```bash
git clone https://github.com/ayggdrasil/callput-option-agent.git
cd callput-option-agent
npm install
npm run build
npm run verify
```

## MCP config

```json
{
  "mcpServers": {
    "callput-lite-agent-mcp": {
      "command": "node",
      "args": ["/absolute/path/callput-option-agent/build/index.js"],
      "env": {
        "RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

## Verify in client
- Call `callput_portfolio_summary` with your address
- Call `callput_scan_spreads` with `underlying_asset="ETH"` and `bias="bullish"`
- Call `callput_scan_spreads` with `underlying_asset="TSLA"` and `bias="bullish"` to verify stock-option feed support when available
- Call `callput_get_option_chains` for `ETH`, `TSLA`, `NVDA`, or `COIN` as optional raw chain inspection

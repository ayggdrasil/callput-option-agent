# MCP Setup (Callput Lite)

This server is for external agents that should trade Callput crypto and synthetic stock/ETF options with minimal setup.

## Supported underlyings

Crypto: `BTC`, `ETH`. Stock/ETF feed symbols: `TSLA`, `QQQ`, `SPY`, `EWY`, `NVDA`, `COIN`, `CRCL`, `SAMSUNG`, `HYNIX`. Live availability is feed-driven; no candidates means the symbol is not currently tradable.

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

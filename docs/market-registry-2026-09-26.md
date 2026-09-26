# MCP market registry update — 2026-09-26

Version 0.5.30 adds nine feed-backed underlyings. Indices were decoded from current canonical feed option IDs and checked against OptionsMarket `0xBD40a87CcBD20E44C45F19A074E7d67Ee85327c7` on Base. Addresses and decimals were read with `getUnderlyingAssetByIndex(uint16)` and `getOptionsTokenByIndex(uint16)` using read-only eth_call.

| Symbol | Underlying index | Decimals | Deployed underlying address | Deployed options-token address |
| --- | ---: | ---: | --- | --- |
| SNDK | 12 | 18 | `0x9525981e4843049e4c0ca1bc3a8bd21cb0acc7c9` | `0xa504da11dd80311a7288f628d45dfb68e61dd1f4` |
| DRAM | 13 | 18 | `0xfae6b56cb3eade8fc7f64bbfe9c3091c142091c1` | `0xfb5b322f9bac5390a756e9349abbde6922bdbdbe` |
| META | 14 | 18 | `0x24703d4d9ec6f260bd72f19d4df2833f0b5439e5` | `0x9895295b7c9106ff638a8eb3abc7699d2d9aae85` |
| GOOGL | 15 | 18 | `0xf8766bbedaa1c7c17bc96f520367713f2b13b45a` | `0x667caebb1504b05d10a337b7623632b41441ee82` |
| AAPL | 16 | 18 | `0xca327e3b39dad7a06b0f5259065705565f37b9de` | `0xeaec004aa3a97b83bf718e053d15a7e6da417e55` |
| CRCL | 17 | 18 | `0x7dc5e07d8fbde79351d006390777468312ea2a9a` | `0x45a0d59e1af36f29c429394e10272a582553877d` |
| AMZN | 18 | 18 | `0x682692bebb8b084bc4d59e388f0726d55544cfd3` | `0xf89d1500cc8e1fe7c314e12475bc6c6acbf9792e` |
| MSFT | 19 | 18 | `0x63df674d0ae251e6041860fe52ff65189d3f4dd5` | `0xdcd9bae81ae3f528476c7d6170172c8e98f8e5e1` |
| PLTR | 20 | 18 | `0xa40c5b16ce0dc7e1e50593d83bdc283f4539452e` | `0x11e66d4a97ab5709ba1d541d8d01bb5b733d1ec2` |


Availability must still be checked per request; registration does not guarantee a valid spread. The MCP prepares unsigned transactions only. CRCL is an active option market as of this review, superseding the older reference-only description.

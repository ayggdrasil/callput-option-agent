# Network deployment provenance — 2026-10-09

Profiles are static, reviewable configuration in `src/networkDeployments.ts`; the legacy Base addresses live in `src/baseConfig.ts`.

| Profile | Reference bundle | Chain | Markets |
| --- | --- | --- | --- |
| Robinhood | https://robin.callput.app/assets/index-98747557.js | 4663 mainnet | 20 |
| GIWA | https://giwa.callput.app/assets/index-f7d70a67.js | 91342 Sepolia testnet | 13 |

Contract objects and token addresses were extracted directly from each public bundle by locating the deployed POSITION_MANAGER and resolving its same-object address declarations. ROUTER in the MCP is the deployment's CONTROLLER (the USDC allowance spender). Asset indices use the shared BTC=1, ETH=2, TSLA=3 ... PLTR=20 mapping, corroborated by feed option IDs. GIWA stops at DRAM=13.

Public RPC defaults come from the chain documentation, without copying third-party provider credentials embedded in site builds:
- https://docs.robinhood.com/chain/connecting/
- https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa

Run `node scripts/check-network-deployments.mjs` after `npm run build` to verify RPC chain ID, manager bytecode, both managers' controller, execution fee and USDC decimals. It only reads. This validates deployed configuration, not keeper execution or transaction settlement.

The initial feed observations returned HTTP 200 but stale timestamps (Robinhood 2026-10-05T16:28:06.808Z; GIWA 2026-10-05T19:32:24.230Z). Preserve the five-minute freshness ceiling. Never promote stale data as current or bypass the check for deployment. Upstream recovery is separate from the MCP release.

## Release verification

On 2026-10-09 KST, the read-only deployment check passed for all three networks: expected chain IDs, deployed manager code, both manager controller addresses, execution fee `60000000000000` wei, USDC decimals `6`, and deployed Multicall3. Base feed was fresh; both added feeds remained stale. `scripts/smoke-networks.mjs` verifies the deployed MCP version, 13-tool catalog, network discovery, chain-tagged read responses, and explicit stale-feed rejection. Its integration pass does not claim a stale upstream is healthy.

## Collateral clarification — 2026-10-25

Robinhood's configured legacy `USDC` address is USDG (Global Dollar), 6 decimals: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. Read-only token metadata, OptionsMarket.mainStableAsset(), vault and factory stable-token getters were checked in the GitBook v3 publication evidence. Base uses canonical USDC and GIWA uses a test USDC deployment. Version 0.6.1 adds explicit `collateral` metadata and the `contracts.collateral_token` alias while preserving existing addresses, numeric scaling, ABI and response field names. Successful MCP results and read-only market catalogs carry token metadata. A legacy key named USDC is not token-symbol evidence.

Current configured coverage remains Base20, Robinhood20 and GIWA13; the old October9 stale-feed observation is historical. Inspect each fresh API response for availability and checked_at. Current contracts are documented at https://docs.callput.app/developers/contracts-addresses-and-data-sources.

## Wallet/account identity evidence — 2026-11-04

The current public CallPut bundles show `email_otp` through Privy and `external_wallet` through wagmi on Base, GIWA and Robinhood, with social login disabled. Email OTP connects an embedded EVM owner wallet; an email or Privy user ID is not the chain signing address. External wallet connection is direct and does not use Privy wallet login. Base trading uses direct wallet custody. GIWA and Robinhood app modes are deposit-only and can use a separate CallPut Account contract to hold funds and positions.

| App | Observed public bundle |
| --- | --- |
| Base | https://app.callput.app/assets/index-dc9b0e57.js |
| GIWA | https://giwa.callput.app/assets/index-d5646322.js |
| Robinhood | https://robin.callput.app/assets/index-74211fbb.js |

The 2026-11-04 read-only production asset-catalog snapshot (13:25–13:26 UTC) reported healthy feeds: GIWA 13 symbols and 3,060 available option rows; Robinhood 20 symbols and 4,634 available rows. This is an observation at that time, not a guarantee of ongoing availability. Do not infer that an email login was completed from bundle evidence; no OTP, wallet signature, or transaction was tested.

For the MCP source v0.7.0, `callput_get_network_info` publishes wallet-connection metadata. Each of the five write tools accepts optional `execution_route` (`direct_wallet` or `callput_account`): Base omission remains direct-wallet behavior, while GIWA and Robinhood require explicit `direct_wallet`. `callput_account` is rejected on all networks because this MCP has no CallPut session-relay executor. Read-only position APIs must use the actual position-holding address. Bankr REST behavior is unchanged and Base-only. This source-only documentation does not establish a hosted v0.7.0 release.

Official references: [Privy email OTP](https://docs.privy.io/authentication/user-authentication/login-methods/email), [GIWA Sepolia connection](https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa), [Robinhood Chain wallet connection](https://docs.robinhood.com/chain/add-network-to-wallet/).

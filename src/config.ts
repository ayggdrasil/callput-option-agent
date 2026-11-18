import { AsyncLocalStorage } from "node:async_hooks";
import { BASE_CONFIG } from "./baseConfig.js";
import { DEPLOYMENTS } from "./networkDeployments.js";
import { walletConnectionInfo } from "./walletContext.js";
import {accountManifest,workflowAvailability} from './accountManifest.js';

export type Network = "base" | "robinhood" | "giwa";
export type RuntimeConfig = {
  NETWORK: Network;
  NETWORK_NAME: string;
  TESTNET: boolean;
  SITE_URL: string;
  EXPLORER_URL: string;
  RPC_URL: string;
  TRACKING_RPC_URL: string;
  CHAIN_ID: number;
  EXECUTION_FEE_FALLBACK: bigint;
  MARKET_DATA_URL: string;
  CONTRACTS: Record<string, string>;
  UNDERLYINGS: Record<string, { index: number; decimals: number; marketType: string; optionsToken: string }>;
  ASSETS: typeof BASE_CONFIG.ASSETS;
};

export function resolveNetwork(value?: string | null): Network {
  if (value === undefined || value === null) return "base";
  if (value === "base" || value === "robinhood" || value === "giwa") return value;
  throw new Error("Unknown network. Use base, robinhood, or giwa.");
}

export function resolveRpcUrl(env: NodeJS.ProcessEnv = process.env, network: Network = "base"): string {
  if (network === "base") return env.RPC_URL || env.BASE_RPC_URL || BASE_CONFIG.RPC_URL;
  return env[`CALLPUT_${network.toUpperCase()}_RPC_URL`] || DEPLOYMENTS[network].rpcUrl;
}

export function resolveTrackingRpcUrl(env: NodeJS.ProcessEnv = process.env, network: Network = "base"): string {
  if (network === "base") return env.CALLPUT_TRACKING_RPC_URL || env.TRACKING_RPC_URL || resolveRpcUrl(env);
  return env[`CALLPUT_${network.toUpperCase()}_TRACKING_RPC_URL`] || resolveRpcUrl(env, network);
}

export function getNetworkConfig(network: Network, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const profile = DEPLOYMENTS[network];
  const contracts = network === "base" ? BASE_CONFIG.CONTRACTS : profile.contracts;
  const underlyings = network === "base" ? BASE_CONFIG.UNDERLYINGS : profile.underlyings;
  return {
    ...BASE_CONFIG,
    NETWORK: network, NETWORK_NAME: profile.name, TESTNET: profile.testnet,
    SITE_URL: profile.siteUrl, EXPLORER_URL: profile.explorerUrl,
    CHAIN_ID: profile.chainId, MARKET_DATA_URL: profile.marketDataUrl,
    CONTRACTS: contracts, UNDERLYINGS: underlyings,
    RPC_URL: resolveRpcUrl(env, network), TRACKING_RPC_URL: resolveTrackingRpcUrl(env, network)
  };
}

const context = new AsyncLocalStorage<RuntimeConfig>();
export function withNetwork<T>(network: string, fn: () => T): T {
  return context.run(getNetworkConfig(resolveNetwork(network)), fn);
}

// Existing core/validator reads are resolved within the active asynchronous request.
// The proxy never mutates shared chain configuration, even when calls overlap.
export const CONFIG = new Proxy({} as RuntimeConfig, {
  get(_target, key) { return (context.getStore() ?? getNetworkConfig("base"))[key as keyof RuntimeConfig]; }
});

export async function validateChainId(provider: any): Promise<void> {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CONFIG.CHAIN_ID)) {
    throw new Error(`RPC provider is on chain ${network.chainId}, expected ${CONFIG.NETWORK_NAME} (${CONFIG.CHAIN_ID})`);
  }
}

export function collateralInfo() {
  return {
    symbol: CONFIG.NETWORK === "robinhood" ? "USDG" : "USDC",
    address: CONFIG.CONTRACTS.USDC,
    decimals: CONFIG.ASSETS.USDC.decimals,
    testnet: CONFIG.TESTNET,
    legacy_field_note: "USDC/usdc field names are retained for API compatibility. Amounts and approvals refer to this selected network's collateral token; Robinhood Chain uses USDG."
  };
}

export function networkInfo(): Record<string, unknown> {
  return {
    network: CONFIG.NETWORK, name: CONFIG.NETWORK_NAME, chain_id: CONFIG.CHAIN_ID,
    testnet: CONFIG.TESTNET, site_url: CONFIG.SITE_URL, explorer_url: CONFIG.EXPLORER_URL,
    mcp_url: `https://mcp.callput.app/api/mcp${CONFIG.NETWORK === "base" ? "" : `?network=${CONFIG.NETWORK}`}`,
    market_data_url: CONFIG.MARKET_DATA_URL, execution: "unsigned_only",
    collateral: collateralInfo(),
    wallet_connection: walletConnectionInfo(),
    account_workflow: CONFIG.NETWORK==='base'?null:{...workflowAvailability(CONFIG.NETWORK),deployment:accountManifest(CONFIG.NETWORK),first_tool:'callput_workflow_start'},
    contracts: {
      position_manager: CONFIG.CONTRACTS.POSITION_MANAGER, settle_manager: CONFIG.CONTRACTS.SETTLE_MANAGER,
      collateral_token: CONFIG.CONTRACTS.USDC,
      usdc: CONFIG.CONTRACTS.USDC, approval_spender: CONFIG.CONTRACTS.ROUTER
    },
    underlyings: Object.entries(CONFIG.UNDERLYINGS).map(([symbol, asset]) => ({
      symbol, index: asset.index, decimals: asset.decimals, options_token: asset.optionsToken
    })),
    instructions: "Use this same network connection for scans, transaction preparation, receipts and position lifecycle. Never reuse a different network's quote, approval, transaction or request key. Signing and broadcasting remain external."
  };
}

export const POSITION_MANAGER_ABI = [
  "function createOpenPosition(uint16 _underlyingAssetIndex, uint8 _length, bool[4] memory _isBuys, bytes32[4] memory _optionIds, bool[4] memory _isCalls, uint256 _minSize, address[] memory _path, uint256 _amountIn, uint256 _minOutWhenSwap, address _leadTrader) external payable returns (bytes32)",
  "function createClosePosition(uint16 _underlyingAssetIndex, uint256 _optionTokenId, uint256 _size, address[] memory _path, uint256 _minAmountOut, uint256 _minOutWhenSwap, bool _withdrawNAT) external payable returns (bytes32)",
  "function executionFee() view returns (uint256)",
  "function controller() view returns (address)",
  "function openPositionRequests(bytes32 key) view returns (address account, uint16 underlyingAssetIndex, uint40 expiry, uint256 optionTokenId, uint256 minSize, uint256 amountIn, uint256 minOutWhenSwap, bool isDepositedInNAT, uint40 blockTime, uint8 status, uint256 sizeOut, uint256 executionPrice, uint40 processBlockTime, uint256 amountOut)",
  "function closePositionRequests(bytes32 key) view returns (address account, uint16 underlyingAssetIndex, uint40 expiry, uint256 optionTokenId, uint256 size, uint256 minAmountOut, uint256 minOutWhenSwap, bool withdrawNAT, uint40 blockTime, uint8 status, uint256 amountOut, uint256 executionPrice, uint40 processBlockTime)",
  "event GenerateRequestKey(address indexed account, bytes32 indexed key, bool indexed isOpen)"
];

export const SETTLE_MANAGER_ABI = [
  "function settlePosition(address[] memory _path, uint16 _underlyingAssetIndex, uint256 _optionTokenId, uint256 _minOutWhenSwap, bool _withdrawNAT) external payable",
  "event SettlePosition(address indexed account, uint16 indexed underlyingAssetIndex, uint40 indexed expiry, uint256 optionTokenId, uint256 size, address[] path, uint256 amountOut, uint256 settlePrice)"
];

export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)"
];

export const OPTIONS_TOKEN_ABI = [
  "function tokensByAccount(address account) view returns (uint256[] memory)",
  "function balanceOfBatch(address[] memory accounts, uint256[] memory ids) view returns (uint256[] memory)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)"
];

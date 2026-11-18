import { AbiCoder, getCreate2Address, keccak256 } from "ethers";
import { DEPLOYMENTS } from "./networkDeployments.js";
import type { SpreadStrategy } from "./core.js";

// Grant bits are 1 << the on-chain strategy enum. Only two-leg spreads are enabled.
export const accountOpenStrategies = {
  BuyCallSpread: { bit: "32", bias: "bullish" },
  SellCallSpread: { bit: "64", bias: "neutral-bearish" },
  BuyPutSpread: { bit: "128", bias: "bearish" },
  SellPutSpread: { bit: "256", bias: "neutral-bullish" },
} as const satisfies Record<SpreadStrategy, { bit: string; bias: string }>;
export const accountOpenStrategyNames = Object.keys(accountOpenStrategies) as SpreadStrategy[];
export function accountTradeSelection(network: AccountNetwork, policy: {
  underlying_asset?: unknown;
  strategy?: unknown;
}) {
  const underlyings = DEPLOYMENTS[network].underlyings as Record<string, {
    index: number;
    decimals: number;
    optionsToken: string;
  }>;
  const asset = policy.underlying_asset === undefined ? "ETH" : policy.underlying_asset;
  const strategy = policy.strategy === undefined ? "BuyCallSpread" : policy.strategy;
  if (typeof asset !== "string" || !Object.hasOwn(underlyings, asset) || !underlyings[asset].optionsToken)
    throw Error("account_underlying_unsupported");
  if (typeof strategy !== "string" || !Object.hasOwn(accountOpenStrategies, strategy))
    throw Error("account_strategy_unsupported");
  return { asset, strategy: strategy as SpreadStrategy, ...underlyings[asset] };
}

export type AccountNetwork = "robinhood" | "giwa";
export const ACCOUNT_APP_ORIGIN = "https://app.callput.app";
export function accountManifest(network: string) {
  const common = {
    version: "2026-11-08.1",
    origin: ACCOUNT_APP_ORIGIN,
    factoryImplementationHash: null as string | null,
    maxSubAccounts: 10,
    fees: {
      create: "protocol_sponsor",
      deposit: "owner",
      register: "protocol_sponsor",
      open: "protocol_sponsor",
      close: "protocol_sponsor",
      settle: "protocol_sponsor",
      revoke: "protocol_sponsor",
      withdraw: "protocol_sponsor",
    },
    maxFeePerTrade: "1000000000000000",
  };
  if (network === "robinhood")
    return {
      ...common,
      network: "robinhood" as const,
      chainId: 4663,
      relayBase: `${ACCOUNT_APP_ORIGIN}/relay/robinhoodchain`,
      rpc: "https://rpc.mainnet.chain.robinhood.com",
      token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      symbol: "USDG",
      positionManager: "0x426a6b482893557e58cf38de635febb30fd6a3c3",
      sponsors: [
        "0x11404d16d26262c3b6c3fcae7b3ff8a1c655d464",
        "0xc8295c54b6d4a7822a70c9c564bf851eedda1918",
      ],
      factoryImplementationHash:
        "0x5b081bdb8ad49ea9a02ac3ef75b5d8479b0a06a9c35e0feccd72ba1aae307359",
      implementationHash:
        "0xa511788fc23f5c997fa3fa868ad25282ae395a47d94ef1952969478adcce8532",
      origins: [
        {
          factory: "0x23db9f5fdde30853ec8ebd75e0492c09505a6d1d",
          codeHash:
            "0x388dd4f19d643b3636dfba522c04b92aacf3937a5e39b342d00198ad27eb171f",
          initCodeHash:
            "0x18ebcbd529e8b50fe70dc36f2c74e4ff7e5782fc25f8de3d67df4c9f4e1463c5",
        },
        {
          factory: "0xbcac622bb396b2f868b37d7c41f34695c9be1862",
          codeHash:
            "0xa4e7a212190833d7d36ac8d9a7b8a5e3700815cc517c3d733f330bf93af6bfbe",
          initCodeHash:
            "0x8df2f87f4305f451c1199b8b59d2e846f35b0bf0b63bdd6cefcdc9381ad13e68",
        },
      ],
    };
  if (network === "giwa")
    return {
      ...common,
      network: "giwa" as const,
      chainId: 91342,
      relayBase: `${ACCOUNT_APP_ORIGIN}/relay/giwa`,
      rpc: "https://sepolia-rpc.giwa.io",
      token: "0x79ad98fa252d64a9095f83cc6faf4243e0d01d48",
      symbol: "USDC",
      positionManager: "0x8cb54e8df9146220a09caa9a69fc4b303dd66e69",
      sponsors: ["0x9c3285bb4f797e025b9436234ededcaa983d7a5f"],
      implementationHash:
        "0xdf811481871d69a2a754c420d56affa0eb7853a1fa399bbf83d67fe5bbd1cdc6",
      origins: [
        {
          factory: "0xc2675b4e4c7a0535b6215703445b560c0b5bfc5d",
          codeHash:
            "0x38cfe08e398826e5c9a87232d6072dde73647fd25c32995e6b431e4e41775bfc",
          initCodeHash:
            "0x183842465f9da8abe81aa8a3fb73de2def866b4ce935e3e9117a0522738f669c",
        },
      ],
    };
  throw Error("account_network_unsupported");
}
export type AccountManifest = ReturnType<typeof accountManifest>;
export function predictedAccount(
  origin: AccountManifest["origins"][number],
  owner: string,
  index: string,
) {
  return getCreate2Address(
    origin.factory,
    keccak256(
      AbiCoder.defaultAbiCoder().encode(["address", "uint96"], [owner, index]),
    ),
    origin.initCodeHash,
  ).toLowerCase();
}
const fields = (s: string) =>
  s.split(",").map((v) => {
    const [type, name] = v.split(" ");
    return { name, type };
  });
export const accountTypes = {
  Grant: fields(
    "address signer,uint256 nonce,uint256 epoch,uint48 validAfter,uint48 validUntil,uint16[] underlyings,uint16 strategies,uint256 maxAmountPerOpen,uint256 maxAmount,uint32 maxOpens,uint32 maxCloses,uint256 maxFeePerTrade,uint256 maxFees",
  ),
  Open: fields(
    "uint16 underlyingAssetIndex,uint8 length,bool[4] isBuys,bytes32[4] optionIds,bool[4] isCalls,uint256 minSize,uint256 amountIn",
  ),
  Close: fields(
    "uint16 underlyingAssetIndex,uint256 optionTokenId,uint256 size,uint256 minAmountOut",
  ),
  OpenIntent: fields(
    "bytes32 sessionId,uint256 epoch,uint256 nonce,uint48 deadline,uint8 source,Open params",
  ),
  CloseIntent: fields(
    "bytes32 sessionId,uint256 epoch,uint256 nonce,uint48 deadline,uint8 source,Close params",
  ),
  Withdrawal: fields("uint8 kind,address token,uint256 id,uint256 amount,address to,uint256 epoch,uint256 nonce,uint48 deadline"),
  RevokeSession: fields(
    "bytes32 sessionId,uint256 epoch,uint256 nonce,uint48 deadline",
  ),
  SponsoredSettlement: fields(
    "uint256 optionTokenId,string requestId,string retryOf",
  ),
};
export const accountDomain = (chainId: number, account: string) => ({
  name: "CallPut Trading Account",
  version: "1",
  chainId,
  verifyingContract: account,
});
export function workflowAvailability(network?: AccountNetwork) {
  const url =
    process.env.CALLPUT_WORKFLOW_REDIS_URL ??
    process.env.CALLPUT_WORKFLOW_KV_REST_API_URL ??
    process.env.CALLPUT_WORKFLOW_UPSTASH_REDIS_REST_URL;
  const token =
    process.env.CALLPUT_WORKFLOW_REDIS_TOKEN ??
    process.env.CALLPUT_WORKFLOW_KV_REST_API_TOKEN ??
    process.env.CALLPUT_WORKFLOW_UPSTASH_REDIS_REST_TOKEN;
  const configured =
    /^[a-f0-9]{64}$/i.test(process.env.CALLPUT_WORKFLOW_ENCRYPTION_KEY ?? "") &&
    !!(
      /^postgres(?:ql)?:\/\//.test(process.env.CALLPUT_WORKFLOW_DATABASE_URL ?? process.env.CALLPUT_WORKFLOW_POSTGRES_URL ?? "") ||
      (url?.startsWith("https://") && token) ||
      (process.env.CALLPUT_WORKFLOW_DIRECTORY && !process.env.VERCEL)
    );
  return {
    configured,
    execution_route: "callput_account",
    wallet_methods: [
      "personal_sign",
      "eth_signTypedData_v4",
      "eth_sendTransaction",
    ],
    owner_keys_accepted: false,
    device_signer_must_differ_from_owner: true,
    storage: configured ? "encrypted_persistent" : "not_configured",
    blocked_reason: configured ? null : "persistent_workflow_store_required",
    setup_guide: "https://mcp.callput.app/account-workflow",
    mcp_guide_resource: "callput://account/workflow",
    external_signer_required: true,
    browser_approval_available: process.env.CALLPUT_ACCOUNT_WALLET_APPROVAL_ENABLED === "true",
    operations: ["resolve", "create", "deposit", "register", "open", "close", "settle", "withdraw", "revoke", "recover"],
    session_modes: ["open_close", "close_only"],
    manual_order_cancellation_supported: false,
    supported_open_strategies: accountOpenStrategyNames,
    ...(network ? { supported_open_underlyings: Object.keys(DEPLOYMENTS[network].underlyings) } : {}),
    sponsored_deposit_supported: false,
    deposit_gas_payer: "owner",
    trade_native_payer: "protocol_sponsor",
    giwa_deposit_hard_total_fee_cap_supported: false,
  };
}

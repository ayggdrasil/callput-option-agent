import { z } from "zod";
import { CONFIG } from "./config.js";
import {workflowAvailability} from './accountManifest.js';

export const executionRouteSchema = z.enum(["direct_wallet", "callput_account"]).optional()
  .describe("Use direct_wallet only for a separately funded external signer owning the positions. These tools build direct-wallet transactions only. For a CallPut Account, use callput_workflow_start instead. On Base this field is optional.");

export function walletConnectionInfo() {
  const network = CONFIG.NETWORK;
  const accountMode = network !== "base";
  const accountWorkflow = accountMode ? workflowAvailability(network) : null;
  const appUrl = CONFIG.NETWORK === "base" ? "https://app.callput.app" : CONFIG.SITE_URL;
  const accountUrl = new URL(appUrl);
  accountUrl.pathname = "/account";
  return {
    verified_at: "2026-11-04",
    app_url: appUrl,
    account_url: accountUrl.href,
    app_trading_mode: accountMode ? "callput_account" : "direct_wallet",
    login_methods: ["external_wallet", "email_otp"],
    email_wallet_provider: "privy",
    mcp_authentication: "none",
    mcp_execution_route: accountMode ? "account_workflow_or_direct_wallet" : "direct_wallet",
    direct_wallet_route_required: accountMode,
    account_session_execution_supported: accountWorkflow?.configured ?? false,
    account_workflow: accountWorkflow,
    address_rules: "The connected owner wallet signs; a separate CallPut Account can hold funds and positions. Read positions using the actual holding address, not an email or Privy user ID. Direct-wallet unsigned_tx.from must be the external signer and position owner. Never substitute the owner wallet for a CallPut Account.",
    signing_rules: "Email OTP creates/connects an embedded EVM owner wallet in the app; external wallets connect via their wallet connector. Browser login does not grant this MCP signing access or a sponsored session. Account session orders and relay UUIDs are not direct-wallet transactions or on-chain request keys.",
    login_tested: false
  };
}

export function requireDirectWalletRoute(route?: "direct_wallet" | "callput_account"): void {
  if (route === "callput_account") {
    throw new Error(`CallPut Account execution is not supported by this direct-wallet tool. Use callput_workflow_start and the account workflow tools; do not replace the account with its owner wallet or sign account calldata as a wallet transaction.`);
  }
  if (CONFIG.NETWORK !== "base" && route !== "direct_wallet") {
    throw new Error(`${CONFIG.NETWORK_NAME} app uses a CallPut Account. Set execution_route="direct_wallet" only for an explicitly chosen, separately funded external wallet owning these positions. For a CallPut Account, use callput_workflow_start and callput://account/workflow.`);
  }
}

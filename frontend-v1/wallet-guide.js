const profiles = {
  base: { name: "Base", chainId: 8453, app: "https://app.callput.app", account: false },
  robinhood: { name: "Robinhood Chain", chainId: 4663, app: "https://robin.callput.app", account: true },
  giwa: { name: "GIWA Sepolia", chainId: 91342, app: "https://giwa.callput.app", account: true },
};

export function walletGuide(network) {
  const profile = profiles[network];
  if (!Object.hasOwn(profiles, network)) throw new Error("Unknown network");
  return {
    appUrl: profile.app,
    accountUrl: `${profile.app}/account`,
    login: profile.account
      ? "Connect an external wallet, or use email + OTP for a Privy embedded EVM wallet. Social login is not enabled. Complete login inside the selected CallPut app."
      : "Connect an external wallet, or use email + OTP for a Privy embedded EVM wallet in the Base app. Social login is not enabled. MCP access itself requires no wallet login or API key.",
    custody: profile.account
      ? "Your connected wallet is the signing owner. Your separate CallPut Account holds deposited collateral and account positions. For portfolio and history reads, use the actual CallPut Account address shown in the app."
      : "For the direct-wallet route, the connected signing wallet holds collateral and positions. Use that same address for portfolio reads and unsigned_tx.from.",
    execution: profile.account
      ? "Source v0.8.0 adds callput_workflow_start for an existing wallet, account deposit, bounded device permission and sponsored order. Check account_workflow.configured first and follow next_actions through the app-origin approval page. Direct-wallet tools are not supported for account sessions. Deposit gas is separate from sponsored trading; no private key is accepted."
      : "The MCP prepares unsigned transactions for your external signer. Review the Base chain, signer, collateral allowance and ETH fee before signing. The MCP has no account session or signing access.",
    prompt: `Use ${network} (${profile.name}, chain ${profile.chainId}) for a read-only check. Call callput_get_network_info and inspect wallet_connection, collateral and testnet. Scan TSLA spreads only if the feed is fresh. ${profile.account ? "For account positions, request the CallPut Account address shown in the app, separately from the connected owner wallet; read using that account address. Inspect account_workflow capability and the deployment policy; use callput_workflow_start only after the user authorizes deposit and trading limits." : "For wallet positions, request the connected position-holding wallet address."} Do not prepare, sign or broadcast a transaction.`,
    directExample: JSON.stringify({ execution_route: "direct_wallet", from_address: "YOUR_SEPARATELY_FUNDED_SIGNER_ADDRESS" }, null, 2),
  };
}

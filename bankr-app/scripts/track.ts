const me = await bankr.wallet.me();
const result = await http.fetch("https://mcp.callput.app/api/bankr/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    event: String(args.event),
    wallet_address: me.evmAddress,
    intent_fingerprint: args.intent_fingerprint ? String(args.intent_fingerprint) : undefined,
    asset: args.asset ? String(args.asset) : undefined,
    strategy: args.strategy ? String(args.strategy) : undefined,
    source: "bankr_app"
  })
});
return result;

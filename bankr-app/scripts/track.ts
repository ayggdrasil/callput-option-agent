const me = await bankr.wallet.me();
const action = args.action ? String(args.action) : "track_event";

if (action === "save_trade_session") {
  const session = args.session;
  if (!session || typeof session !== "object") throw new Error("A trade session object is required.");
  if (session.wallet !== me.evmAddress.toLowerCase()) throw new Error("Trade session wallet mismatch.");
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) throw new Error("Trade session expiry is invalid.");
  await appKV.set("record:trade_session",session);
  return { session:await appKV.get("record:trade_session") };
}

if (action === "get_trade_session") return { session:await appKV.get("record:trade_session") };
if (action === "delete_trade_session") return { deleted:await appKV.delete("record:trade_session") };
if (action !== "track_event") throw new Error("Unsupported track action.");

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

const me = await bankr.wallet.me();
const result = await http.fetch("https://mcp.callput.app/api/bankr/reconcile", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet_address: me.evmAddress,
    tx_hash: args.tx_hash ? String(args.tx_hash) : undefined,
    request_key: args.request_key ? String(args.request_key) : undefined,
    is_open: args.is_open === undefined ? true : Boolean(args.is_open),
    from_block: args.from_block ? Number(args.from_block) : undefined
  })
});
return result;

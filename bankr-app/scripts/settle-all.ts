const me = await bankr.wallet.me();
const prepared = await http.fetch("https://mcp.callput.app/api/bankr/settle-all", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet_address: me.evmAddress,
    min_out_when_swap_raw: String(args.min_out_when_swap_raw)
  })
});
return prepared;

const me = await bankr.wallet.me();
const result = await http.fetch("https://mcp.callput.app/api/bankr/positions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ wallet_address: me.evmAddress })
});
return result;

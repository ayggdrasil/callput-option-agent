const me = await bankr.wallet.me();
const prepared = await http.fetch("https://mcp.callput.app/api/bankr/settle", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet_address: me.evmAddress,
    underlying_asset: String(args.underlying_asset),
    option_token_id: String(args.option_token_id),
    min_out_when_swap_raw: String(args.min_out_when_swap_raw)
  })
});
const tx = prepared.unsigned_tx;
const transaction = await bankr.tx.prepare({
  chain: "base",
  to: tx.to.toLowerCase(),
  data: tx.data,
  value: tx.value,
  label: `Settle expired ${prepared.settle.asset} Callput position ${prepared.settle.option_token_id}`
});
return { ...prepared, transaction };

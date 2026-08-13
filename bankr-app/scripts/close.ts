const me = await bankr.wallet.me();
const prepared = await http.fetch("https://mcp.callput.app/api/bankr/close", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet_address: me.evmAddress,
    underlying_asset: String(args.underlying_asset),
    option_token_id: String(args.option_token_id),
    size: Number(args.size),
    min_amount_out_raw: String(args.min_amount_out_raw),
    min_out_when_swap_raw: String(args.min_out_when_swap_raw)
  })
});
const tx = prepared.unsigned_tx;
const transaction = await bankr.tx.prepare({
  chain: "base",
  to: tx.to.toLowerCase(),
  data: tx.data,
  value: tx.value,
  label: `Close ${prepared.close.asset} Callput position ${prepared.close.option_token_id}`
});
return { ...prepared, transaction };

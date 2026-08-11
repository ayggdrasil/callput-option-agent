const me = await bankr.wallet.me();
const prepared = await http.fetch("https://mcp.callput.app/api/bankr/settle-all", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    wallet_address: me.evmAddress,
    min_out_when_swap_raw: String(args.min_out_when_swap_raw)
  })
});
const transactions = [];
for (const item of prepared.transactions) {
  const tx = item.unsigned_tx;
  const transaction = await bankr.tx.prepare({
    chain: "base",
    to: tx.to,
    data: tx.data,
    value: tx.value,
    label: `Settle expired ${item.settle.asset} Callput position ${item.settle.option_token_id}`
  });
  transactions.push({ ...item, transaction });
}
return { ...prepared, transactions };

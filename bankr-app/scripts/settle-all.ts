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
  let positionTokenApproval = null;
  const approvalTx = item.position_token_approval && !item.position_token_approval.sufficient ? item.position_token_approval.approve_tx : null;
  if (approvalTx) positionTokenApproval = await bankr.tx.prepare({ chain:"base", to:approvalTx.to.toLowerCase(), data:approvalTx.data, value:approvalTx.value, label:`Allow Callput Controller to settle ${item.settle.asset} positions` });
  const transaction = await bankr.tx.prepare({
    chain: "base",
    to: tx.to.toLowerCase(),
    data: tx.data,
    value: tx.value,
    label: `Settle expired ${item.settle.asset} Callput position ${item.settle.option_token_id}`
  });
  transactions.push({ ...item, position_token_approval: positionTokenApproval ? { ...item.position_token_approval, transaction: positionTokenApproval } : item.position_token_approval, transaction });
}
return { ...prepared, transactions };

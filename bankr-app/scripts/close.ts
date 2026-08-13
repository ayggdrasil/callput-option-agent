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
let positionTokenApproval = null;
const approvalTx = prepared.position_token_approval && !prepared.position_token_approval.sufficient ? prepared.position_token_approval.approve_tx : null;
if (approvalTx) {
  positionTokenApproval = await bankr.tx.prepare({
    chain: "base",
    to: approvalTx.to.toLowerCase(),
    data: approvalTx.data,
    value: approvalTx.value,
    label: `Allow Callput Controller to close ${prepared.close.asset} positions`
  });
}
const transaction = await bankr.tx.prepare({
  chain: "base",
  to: tx.to.toLowerCase(),
  data: tx.data,
  value: tx.value,
  label: `Close ${prepared.close.asset} Callput position ${prepared.close.option_token_id}`
});
return { ...prepared, position_token_approval: positionTokenApproval ? { ...prepared.position_token_approval, transaction: positionTokenApproval } : prepared.position_token_approval, transaction };

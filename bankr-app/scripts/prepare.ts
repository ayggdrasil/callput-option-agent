const DEFAULT_MIN_FILL_RATIO = 0.78;

const me = await bankr.wallet.me();
const prepared = await http.fetch("https://mcp.callput.app/api/bankr/prepare", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    strategy: String(args.strategy),
    from_address: me.evmAddress,
    long_leg_id: String(args.long_leg_id),
    short_leg_id: String(args.short_leg_id),
    size: Number(args.size),
    min_fill_ratio: DEFAULT_MIN_FILL_RATIO
  })
});

let approval = null;
const approvalTx = prepared.usdc_approval && !prepared.usdc_approval.sufficient ? prepared.usdc_approval.approve_tx : null;
if (approvalTx) {
  approval = await bankr.tx.prepare({
    chain: "base",
    to: approvalTx.to,
    data: approvalTx.data,
    value: approvalTx.value,
    label: `Approve bounded USDC allowance for Callput`
  });
}

const tx = prepared.unsigned_tx;
const transaction = await bankr.tx.prepare({
  chain: "base",
  to: tx.to,
  data: tx.data,
  value: tx.value,
  label: `${prepared.risk_preview.strategy} ${prepared.risk_preview.asset} — max ${prepared.risk_preview.maximum_usdc_at_risk} USDC`
});

return {
  approval,
  approval_preview: approval ? { token:"Base USDC", token_address:approvalTx.to, spender:`0x${approvalTx.data.slice(34,74)}`, amount_usdc:Number(prepared.usdc_approval.required)/1e6 } : null,
  transaction,
  transaction_preview: {
    chain: "Base",
    chain_id: tx.chain_id,
    destination: tx.to,
    value_wei: tx.value
  },
  risk_preview: prepared.risk_preview,
  intent_fingerprint: prepared.intent_fingerprint,
  quote: prepared.quote
};

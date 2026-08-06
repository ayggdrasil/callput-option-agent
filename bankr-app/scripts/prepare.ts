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
if (prepared.usdc_approval && !prepared.usdc_approval.sufficient) {
  const tx = prepared.usdc_approval.approve_tx;
  approval = await bankr.tx.prepare({
    chain: "base",
    to: tx.to,
    data: tx.data,
    value: tx.value,
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
  transaction,
  risk_preview: prepared.risk_preview,
  intent_fingerprint: prepared.intent_fingerprint,
  quote: prepared.quote
};

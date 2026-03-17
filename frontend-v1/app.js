const contractItems = [
  {
    tool: "callput_bootstrap",
    component: "SystemReadinessCard",
    io: "Input: none | Output: readiness summary",
    trigger: "On load / manual refresh",
  },
  {
    tool: "callput_get_option_chains",
    component: "OptionLookupCard",
    io: "Input: asset/filter | Output: expiries/strikes/legs",
    trigger: "After direction setup",
  },
  {
    tool: "callput_validate_spread",
    component: "SpreadValidationCard",
    io: "Input: side + long/short legs + size | Output: valid/invalid",
    trigger: "Before execution",
  },
  {
    tool: "callput_execute_spread",
    component: "ExecutionCard",
    io: "Input: validated spread + dry_run | Output: request key/status",
    trigger: "Operator run",
  },
  {
    tool: "callput_check_request_status",
    component: "RequestStatusCard",
    io: "Input: request key | Output: pending/executed/cancelled",
    trigger: "Post execution polling",
  },
  {
    tool: "callput_get_positions",
    component: "OpenPositionsCard",
    io: "Input: optional asset filter | Output: open positions",
    trigger: "Portfolio refresh",
  },
  {
    tool: "callput_close_position",
    component: "PreExpiryCloseCard",
    io: "Input: position id + size + dry_run | Output: close request",
    trigger: "Pre-expiry adjustment",
  },
  {
    tool: "callput_settle_position",
    component: "PostExpirySettleCard",
    io: "Input: position id + dry_run | Output: settlement request",
    trigger: "Post-expiry settlement",
  },
];

const contractList = document.getElementById("contractList");

for (const item of contractItems) {
  const el = document.createElement("article");
  el.className = "contract-item";
  el.innerHTML = `
    <div class="top">
      <span class="tool">${item.tool}</span>
      <span class="comp">${item.component}</span>
    </div>
    <p>${item.io}</p>
    <p><strong>Trigger:</strong> ${item.trigger}</p>
  `;
  contractList.appendChild(el);
}

const markets = [
  { symbol: "BTC", type: "crypto", live: true },
  { symbol: "ETH", type: "crypto", live: true },
  { symbol: "TSLA", type: "stock", live: true },
  { symbol: "QQQ", type: "etf", live: false },
  { symbol: "SPY", type: "etf", live: false },
  { symbol: "EWY", type: "etf", live: true },
  { symbol: "NVDA", type: "stock", live: true },
  { symbol: "COIN", type: "stock", live: true },
  { symbol: "CRCL", type: "stock", live: false },
  { symbol: "SAMSUNG", type: "stock", live: false },
  { symbol: "HYNIX", type: "stock", live: false },
];

const scanRows = [
  { rank: 1, symbol: "TSLA", spread: "440/450 Call Debit", expiry: "05JUN26", metric: "IV 40.5" },
  { rank: 2, symbol: "NVDA", spread: "215/225 Call Debit", expiry: "05JUN26", metric: "IV 38.9" },
  { rank: 3, symbol: "COIN", spread: "185/195 Put Debit", expiry: "05JUN26", metric: "IV 51.2" },
  { rank: 4, symbol: "ETH", spread: "2800/3000 Call Debit", expiry: "05JUN26", metric: "IV 66.1" },
  { rank: 5, symbol: "BTC", spread: "105000/108000 Put Credit", expiry: "05JUN26", metric: "IV 58.4" },
];

const contractItems = [
  {
    tool: "callput_scan_spreads",
    component: "MarketScanCard",
    io: "Input: symbol + bias | Output: ranked spread candidates, ATM IV, costs",
    trigger: "First market action",
  },
  {
    tool: "callput_get_option_chains",
    component: "RawChainCard",
    io: "Input: symbol + filters | Output: expiries, strikes, bid/ask, 0x leg IDs",
    trigger: "Advanced leg inspection",
  },
  {
    tool: "callput_execute_spread",
    component: "ExecutionCard",
    io: "Input: strategy + address + legs + size | Output: unsigned_tx + approval state",
    trigger: "After explicit authorization",
  },
  {
    tool: "callput_get_request_key_from_tx",
    component: "TxReceiptCard",
    io: "Input: tx_hash | Output: request_key + is_open",
    trigger: "After broadcast confirmation",
  },
  {
    tool: "callput_check_request_status",
    component: "RequestStatusCard",
    io: "Input: request_key + is_open | Output: pending/executed/cancelled",
    trigger: "Post-broadcast polling",
  },
  {
    tool: "callput_portfolio_summary",
    component: "PortfolioCard",
    io: "Input: address + optional request_keys | Output: balance, positions, P&L",
    trigger: "Pre-trade and refresh",
  },
  {
    tool: "callput_list_positions_by_wallet",
    component: "RecoveryCard",
    io: "Input: address + optional from_block | Output: recovered request keys",
    trigger: "Session recovery",
  },
  {
    tool: "callput_close_position",
    component: "PreExpiryCloseCard",
    io: "Input: symbol + option_token_id + size | Output: unsigned close tx",
    trigger: "Profit target or near expiry",
  },
  {
    tool: "callput_settle_position",
    component: "PostExpirySettleCard",
    io: "Input: symbol + option_token_id | Output: unsigned settle tx",
    trigger: "After expiry",
  },
  {
    tool: "callput_get_settled_pnl",
    component: "PnLHistoryCard",
    io: "Input: address + optional from_block | Output: realized settlement history",
    trigger: "Post-settlement review",
  },
];

const marketGrid = document.getElementById("marketGrid");
const symbolTabs = document.getElementById("symbolTabs");
const scanTable = document.getElementById("scanTable");
const contractList = document.getElementById("contractList");

for (const market of markets) {
  const card = document.createElement("article");
  card.className = `market-card${market.live ? " live" : ""}`;
  card.innerHTML = `<strong>${market.symbol}</strong><span>${market.live ? "feed live" : market.type}</span>`;
  marketGrid.appendChild(card);

  const tab = document.createElement("button");
  tab.className = `symbol-tab${market.symbol === "TSLA" ? " active" : ""}`;
  tab.type = "button";
  tab.textContent = market.symbol;
  tab.addEventListener("click", () => {
    document.querySelectorAll(".symbol-tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
  });
  symbolTabs.appendChild(tab);
}

scanTable.innerHTML = `
  <div class="scan-row header">
    <span>Rank</span><span>Symbol</span><span>Best spread</span><span>Expiry</span><span>Signal</span>
  </div>
`;

for (const row of scanRows) {
  const item = document.createElement("div");
  item.className = "scan-row";
  item.innerHTML = `
    <span>${row.rank}</span>
    <span>${row.symbol}</span>
    <span>${row.spread}</span>
    <span>${row.expiry}</span>
    <span class="gain">${row.metric}</span>
  `;
  scanTable.appendChild(item);
}

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

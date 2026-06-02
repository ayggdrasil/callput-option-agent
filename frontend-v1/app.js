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
    io: "Input: symbol + address + option_token_id + size | Output: unsigned close tx",
    trigger: "Profit target or near expiry",
  },
  {
    tool: "callput_settle_position",
    component: "PostExpirySettleCard",
    io: "Input: symbol + address + option_token_id | Output: unsigned settle tx",
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
const defaultSymbol = "TSLA";

for (const market of markets) {
  const card = document.createElement("article");
  card.className = `market-card${market.live ? " live" : ""}`;
  card.innerHTML = `<strong>${market.symbol}</strong><span>${market.live ? "feed live" : market.type}</span>`;
  marketGrid.appendChild(card);

  const tab = document.createElement("button");
  tab.className = `symbol-tab${market.symbol === defaultSymbol ? " active" : ""}`;
  tab.type = "button";
  tab.textContent = market.symbol;
  tab.dataset.symbol = market.symbol;
  tab.setAttribute("aria-pressed", String(market.symbol === defaultSymbol));
  tab.addEventListener("click", () => setActiveSymbol(market.symbol));
  symbolTabs.appendChild(tab);
}

function setActiveSymbol(symbol) {
  document.querySelectorAll(".symbol-tab").forEach((item) => {
    const isActive = item.dataset.symbol === symbol;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", String(isActive));
  });
  renderScanTable(symbol);
}

function renderScanTable(symbol) {
  const market = markets.find((item) => item.symbol === symbol);
  const rows = scanRows.filter((row) => row.symbol === symbol);

  scanTable.innerHTML = `
    <div class="scan-row header">
      <span>Rank</span><span>Symbol</span><span>Best spread</span><span>Expiry</span><span>Signal</span>
    </div>
  `;

  if (rows.length === 0) {
    const item = document.createElement("div");
    item.className = "scan-row scan-row-empty";
    item.innerHTML = `
      <span>-</span>
      <span>${symbol}</span>
      <span>${market?.live ? "Feed supported; scan live candidates" : "Configured alias; confirm live feed before trading"}</span>
      <span>${market?.type ?? "feed"}</span>
      <span class="gain">${market?.live ? "Ready" : "Check"}</span>
    `;
    scanTable.appendChild(item);
    return;
  }

  rows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "scan-row";
    item.innerHTML = `
      <span>${index + 1}</span>
      <span>${row.symbol}</span>
      <span>${row.spread}</span>
      <span>${row.expiry}</span>
      <span class="gain">${row.metric}</span>
    `;
    scanTable.appendChild(item);
  });
}

renderScanTable(defaultSymbol);

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

const spotPoints = [30, 35, 40, 45, 50, 55, 60, 65, 70];
const callPayoff = (spot, strike) => Math.max(0, spot - strike);
const putPayoff = (spot, strike) => Math.max(0, strike - spot);
const buyButterfly = spotPoints.map((spot) => callPayoff(spot, 40) - 2 * callPayoff(spot, 50) + callPayoff(spot, 60) - 2);
const sellButterfly = buyButterfly.map((value) => -value);
const sellIronCondor = spotPoints.map((spot) => 4 - putPayoff(spot, 45) + putPayoff(spot, 35) - callPayoff(spot, 55) + callPayoff(spot, 65));
const buyIronCondor = sellIronCondor.map((value) => -value);
const payoffCharts = {
  "chart-bcs": [{ label: "Buy", values: spotPoints.map((spot) => callPayoff(spot, 45) - callPayoff(spot, 55) - 3), color: "#41e77d" }],
  "chart-bps": [{ label: "Buy", values: spotPoints.map((spot) => putPayoff(spot, 55) - putPayoff(spot, 45) - 3), color: "#41e77d" }],
  "chart-scs": [{ label: "Sell", values: spotPoints.map((spot) => 3 - callPayoff(spot, 45) + callPayoff(spot, 55)), color: "#41e77d" }],
  "chart-sps": [{ label: "Sell", values: spotPoints.map((spot) => 3 - putPayoff(spot, 55) + putPayoff(spot, 45)), color: "#41e77d" }],
  "chart-bfly": [
    { label: "Buy", values: buyButterfly, color: "#41e77d" },
    { label: "Sell", values: sellButterfly, color: "#f4b84a", dash: [7, 5] },
  ],
  "chart-icondor": [
    { label: "Buy", values: buyIronCondor, color: "#41e77d" },
    { label: "Sell", values: sellIronCondor, color: "#f4b84a", dash: [7, 5] },
  ],
};

function drawPayoff(id, seriesList) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const isMultiSeries = seriesList.length > 1;
  const sidePad = isMultiSeries ? 42 : 34;
  const topPad = isMultiSeries ? 58 : 34;
  const bottomPad = isMultiSeries ? 46 : 34;
  const plotHeight = h - topPad - bottomPad;
  const zeroY = topPad + plotHeight / 2;
  const allValues = seriesList.flatMap((series) => series.values);
  const maxAbs = Math.max(...allValues.map((value) => Math.abs(value)), 1);
  const scale = (value) => zeroY - (value / maxAbs) * (plotHeight / 2 - 6);

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(130, 210, 235, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = topPad + (i * plotHeight) / 3;
    ctx.beginPath();
    ctx.moveTo(sidePad, y);
    ctx.lineTo(w - sidePad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(155, 176, 187, 0.5)";
  ctx.beginPath();
  ctx.moveTo(sidePad, zeroY);
  ctx.lineTo(w - sidePad, zeroY);
  ctx.stroke();

  seriesList.forEach((series, seriesIndex) => {
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = series.color;
    ctx.setLineDash(series.dash || []);
    ctx.beginPath();
    series.values.forEach((value, index) => {
      const x = sidePad + (index * (w - sidePad * 2)) / (series.values.length - 1);
      const y = scale(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.setLineDash([]);

  if (isMultiSeries) {
    const legendX = w - 128;
    const legendY = 12;
    const legendW = 92;
    const legendH = 38;
    ctx.fillStyle = "rgba(7, 16, 23, 0.9)";
    ctx.fillRect(legendX, legendY, legendW, legendH);
    ctx.strokeStyle = "rgba(130, 210, 235, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendW, legendH);

    seriesList.forEach((series, seriesIndex) => {
      const labelY = legendY + 15 + seriesIndex * 17;
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(series.dash || []);
      ctx.beginPath();
      ctx.moveTo(legendX + 10, labelY - 4);
      ctx.lineTo(legendX + 30, labelY - 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = series.color;
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillText(series.label, legendX + 38, labelY);
    });
  }

  ctx.fillStyle = "#9bafba";
  ctx.font = isMultiSeries ? "11px JetBrains Mono, monospace" : "12px JetBrains Mono, monospace";
  ctx.fillText("Loss", sidePad, h - 14);
  ctx.fillText("Spot ->", w - sidePad - 56, h - 14);
  ctx.fillStyle = "#41e77d";
  ctx.fillText("Profit", sidePad, isMultiSeries ? 25 : 22);
}

Object.entries(payoffCharts).forEach(([id, values]) => drawPayoff(id, values));

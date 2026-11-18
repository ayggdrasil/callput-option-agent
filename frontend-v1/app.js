import { createMarketStatusLoader } from "./market-status.js";
import { walletGuide } from "./wallet-guide.js";

let markets = [];
let activeSymbol = "TSLA";

const networks = {
  base: {
    slug: "base",
    name: "Base",
    chainId: 8453,
    collateralSymbol: "USDC",
    testnet: false,
    rpcUrl: "https://mainnet.base.org",
    rpcEnv: "RPC_URL",
    domain: "mcp.callput.app",
  },
  robinhood: {
    slug: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    collateralSymbol: "USDG",
    testnet: false,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    rpcEnv: "CALLPUT_ROBINHOOD_RPC_URL",
    domain: "robin.callput.app",
  },
  giwa: {
    slug: "giwa",
    name: "GIWA Sepolia",
    chainId: 91342,
    collateralSymbol: "test USDC",
    testnet: true,
    rpcUrl: "https://sepolia-rpc.giwa.io",
    rpcEnv: "CALLPUT_GIWA_RPC_URL",
    domain: "giwa.callput.app",
  },
};

function initialNetworkSlug() {
  const requested = new URLSearchParams(window.location.search).get("network");
  if (requested && networks[requested]) return requested;
  if (window.location.hostname === "robin.callput.app") return "robinhood";
  if (window.location.hostname === "giwa.callput.app") return "giwa";
  return "base";
}

let activeNetwork = networks[initialNetworkSlug()];
const loadMarketStatus = createMarketStatusLoader();

const contractItems = [
  {
    tool: "callput_get_network_info",
    component: "NetworkInfoCard",
    io: "Input: none | Output: selected network, chain ID, testnet status, verified contracts",
    trigger: "Before the first network-bound action",
  },
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
    tool: "callput_close_all_positions",
    component: "CloseAllReviewQueue",
    io: "Input: address + per-position raw output floors | Output: unsigned full-close tx bundle",
    trigger: "Explicit wallet-wide close request",
  },
  {
    tool: "callput_settle_all_positions",
    component: "SettleAllReviewQueue",
    io: "Input: address + per-position raw swap floor | Output: unsigned settlement tx bundle",
    trigger: "Explicit wallet-wide settlement request",
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
const liveAvailabilityStatus = document.getElementById("liveAvailabilityStatus");
const liveSymbolCount = document.getElementById("liveSymbolCount");
const configuredSymbolCount = document.getElementById("configuredSymbolCount");
const networkButtons = document.querySelectorAll("[data-network]");
const selectedNetworkName = document.getElementById("selectedNetworkName");
const selectedNetworkChain = document.getElementById("selectedNetworkChain");
const selectedNetworkMode = document.getElementById("selectedNetworkMode");
const selectedEndpoint = document.getElementById("selectedEndpoint");
const selectedMarketNetwork = document.getElementById("selectedMarketNetwork");
const mcpEndpoint = document.getElementById("mcpEndpoint");
const mcpConfig = document.getElementById("mcpConfig");
const networkExpected = document.getElementById("networkExpected");
const rpcRecovery = document.getElementById("rpcRecovery");
const copyButtons = document.querySelectorAll("[data-copy-target]");

for (const button of copyButtons) {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;

    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      const original = button.textContent;
      button.textContent = "Copied";
      button.classList.add("copied");
      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove("copied");
      }, 1400);
    } catch {
      button.textContent = "Select text";
    }
  });
}

function renderMarkets() {
  marketGrid.replaceChildren();
  symbolTabs.replaceChildren();
  if (!markets.some(market => market.symbol === activeSymbol)) activeSymbol = markets[0]?.symbol ?? "";
  for (const market of markets) {
    const card = document.createElement("article");
    card.className = `market-card${market.count > 0 ? " live" : ""}`;
    card.dataset.marketSymbol = market.symbol;
    const symbol = document.createElement("strong");
    symbol.textContent = market.symbol;
    const count = document.createElement("span");
    count.textContent = market.count > 0 ? `${market.count.toLocaleString()} available option rows` : "no available option rows";
    card.append(symbol, count);
    marketGrid.appendChild(card);
    const tab = document.createElement("button");
    tab.className = `symbol-tab${market.symbol === activeSymbol ? " active" : ""}`;
    tab.type = "button";
    tab.textContent = market.symbol;
    tab.dataset.symbol = market.symbol;
    tab.setAttribute("aria-pressed", String(market.symbol === activeSymbol));
    tab.addEventListener("click", () => setActiveSymbol(market.symbol));
    symbolTabs.appendChild(tab);
  }
  renderScanTable(activeSymbol);
}

function setActiveSymbol(symbol) {
  activeSymbol = symbol;
  document.querySelectorAll(".symbol-tab").forEach((item) => {
    const isActive = item.dataset.symbol === symbol;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", String(isActive));
  });
  renderScanTable(symbol);
}

function renderScanTable(symbol) {
  scanTable.replaceChildren();
  const market = markets.find(item => item.symbol === symbol);
  if (!market) {
    const message = document.createElement("p");
    message.textContent = "Current market status is unavailable. Check the live feed before scanning.";
    scanTable.appendChild(message);
    return;
  }
  const rows = [
    ["Symbol", "Type", "Reference price", "Option rows", "Status"],
    [market.symbol, market.type.toUpperCase(), market.spot === null ? "Unavailable" : `$${market.spot.toLocaleString(undefined, { maximumFractionDigits: 4 })}`,
      market.count.toLocaleString(), market.count > 0 ? "Available" : "Unavailable"]
  ];
  rows.forEach((values, index) => {
    const row = document.createElement("div");
    row.className = `scan-row${index === 0 ? " header" : ""}`;
    for (const value of values) {
      const cell = document.createElement("span");
      cell.textContent = value;
      row.appendChild(cell);
    }
    scanTable.appendChild(row);
  });
}

function connectionConfig(network) {
  return JSON.stringify({
    mcpServers: {
      "callput-lite-agent-mcp": {
        command: "node",
        args: ["/absolute/path/callput-option-agent/build/src/index.js"],
        env: {
          CALLPUT_NETWORK: network.slug,
          [network.rpcEnv]: network.rpcUrl,
        },
      },
    },
  }, null, 2);
}

function endpointFor(network) {
  return `https://mcp.callput.app/api/mcp${network.slug === "base" ? "" : `?network=${network.slug}`}`;
}

function renderSelectedNetwork() {
  const mode = activeNetwork.testnet ? "Testnet" : "Mainnet";
  networkButtons.forEach((button) => {
    const selected = button.dataset.network === activeNetwork.slug;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  selectedNetworkName.textContent = activeNetwork.name;
  selectedNetworkChain.textContent = `Chain ${activeNetwork.chainId}`;
  selectedNetworkMode.textContent = mode;
  document.getElementById("selectedNetworkCollateral").textContent = `Collateral ${activeNetwork.collateralSymbol}`;
  selectedNetworkMode.classList.toggle("testnet", activeNetwork.testnet);
  selectedEndpoint.textContent = endpointFor(activeNetwork);
  selectedMarketNetwork.textContent = `${activeNetwork.name} ${activeNetwork.chainId} · ${mode.toLowerCase()}`;
  mcpEndpoint.textContent = endpointFor(activeNetwork);
  mcpConfig.textContent = connectionConfig(activeNetwork);
  networkExpected.innerHTML = `Expected: runtime lists <code>callput-lite-agent-mcp</code>; RPC is verified as ${activeNetwork.name} ${mode.toLowerCase()}, chain ID <code>${activeNetwork.chainId}</code>.`;
  rpcRecovery.innerHTML = `Set <code>CALLPUT_NETWORK=${activeNetwork.slug}</code> and <code>${activeNetwork.rpcEnv}=${activeNetwork.rpcUrl}</code>, then retry.`;
  const guide = walletGuide(activeNetwork.slug);
  document.getElementById("walletLogin").textContent = guide.login;
  document.getElementById("walletCustody").textContent = guide.custody;
  document.getElementById("walletExecution").textContent = guide.execution;
  document.getElementById("walletAppLink").href = guide.accountUrl;
  document.getElementById("walletAppLink").textContent = `Open ${activeNetwork.name} account ↗`;
  document.getElementById("appLink").href = guide.appUrl;
  document.getElementById("firstPrompt").textContent = guide.prompt;
  document.getElementById("directWalletExample").textContent = guide.directExample;
}

async function selectNetwork(slug) {
  if (!networks[slug]) return;
  activeNetwork = networks[slug];
  const url = new URL(window.location.href);
  if (slug === "base") url.searchParams.delete("network");
  else url.searchParams.set("network", slug);
  window.history.replaceState({}, "", url);
  markets = [];
  renderMarkets();
  liveSymbolCount.textContent = "—";
  configuredSymbolCount.textContent = "—";
  liveAvailabilityStatus.textContent = `Refreshing ${activeNetwork.name} market availability…`;
  renderSelectedNetwork();
  await refreshLiveAvailability();
}

async function refreshLiveAvailability() {
  const requestedNetwork = activeNetwork;
  try {
    const status = await loadMarketStatus(requestedNetwork);
    if (!status || activeNetwork !== requestedNetwork) return;
    markets = status.assets;
    renderMarkets();
    liveSymbolCount.textContent = String(status.activeCount);
    configuredSymbolCount.textContent = String(markets.length);
    const mode = status.testnet ? "testnet" : "mainnet";
    liveAvailabilityStatus.textContent = `${status.activeCount} symbols with available options · ${status.optionCount.toLocaleString()} unexpired available option rows · checked ${new Date(status.checkedAt).toLocaleString()} · ${requestedNetwork.name} ${status.chainId} ${mode}`;
  } catch (error) {
    if (activeNetwork !== requestedNetwork) return;
    markets = [];
    renderMarkets();
    liveSymbolCount.textContent = "—";
    configuredSymbolCount.textContent = "—";
    liveAvailabilityStatus.textContent = /stale/i.test(error instanceof Error ? error.message : "")
      ? `${requestedNetwork.name} market feed is stale. Quotes and new trade preparation are paused until fresh data returns.`
      : `${requestedNetwork.name} availability could not be verified. No current prices or option rows are shown; check the network feed or retry later.`;
  }
}

networkButtons.forEach((button) => button.addEventListener("click", () => void selectNetwork(button.dataset.network)));
renderSelectedNetwork();
void refreshLiveAvailability();
window.setInterval(refreshLiveAvailability, 60_000);

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
  "chart-bcs": [{ label: "Buy", values: spotPoints.map((spot) => callPayoff(spot, 45) - callPayoff(spot, 55) - 3), color: "#71b842" }],
  "chart-bps": [{ label: "Buy", values: spotPoints.map((spot) => putPayoff(spot, 55) - putPayoff(spot, 45) - 3), color: "#71b842" }],
  "chart-scs": [{ label: "Sell", values: spotPoints.map((spot) => 3 - callPayoff(spot, 45) + callPayoff(spot, 55)), color: "#71b842" }],
  "chart-sps": [{ label: "Sell", values: spotPoints.map((spot) => 3 - putPayoff(spot, 55) + putPayoff(spot, 45)), color: "#71b842" }],
  "chart-bfly": [
    { label: "Buy", values: buyButterfly, color: "#71b842" },
    { label: "Sell", values: sellButterfly, color: "#e04a3f", dash: [7, 5] },
  ],
  "chart-icondor": [
    { label: "Buy", values: buyIronCondor, color: "#71b842" },
    { label: "Sell", values: sellIronCondor, color: "#e04a3f", dash: [7, 5] },
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
  ctx.strokeStyle = "#292c33";
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
    ctx.fillStyle = "#181a1f";
    ctx.fillRect(legendX, legendY, legendW, legendH);
    ctx.strokeStyle = "#292c33";
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
      ctx.font = "11px Host Grotesk, sans-serif";
      ctx.fillText(series.label, legendX + 38, labelY);
    });
  }

  ctx.fillStyle = "#8c8c8c";
  ctx.font = isMultiSeries ? "11px Host Grotesk, sans-serif" : "12px Host Grotesk, sans-serif";
  ctx.fillText("Loss", sidePad, h - 14);
  ctx.fillText("Spot ->", w - sidePad - 56, h - 14);
  ctx.fillStyle = "#71b842";
  ctx.fillText("Profit", sidePad, isMultiSeries ? 25 : 22);
}

Object.entries(payoffCharts).forEach(([id, values]) => drawPayoff(id, values));

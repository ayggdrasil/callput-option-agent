const samples = {
  BTC: {
    bullish: { strategy: "BuyCallSpread", strikes: "65K / 67K", expiry: "1 day", fill: "78%", maxRisk: 0.2 },
    bearish: { strategy: "BuyPutSpread", strikes: "64K / 62K", expiry: "1 day", fill: "78%", maxRisk: 0.24 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "67K / 69K", expiry: "5 days", fill: "80%", maxRisk: 1.84 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "62K / 60K", expiry: "5 days", fill: "80%", maxRisk: 1.76 }
  },
  ETH: {
    bullish: { strategy: "BuyCallSpread", strikes: "3.4K / 3.6K", expiry: "5 days", fill: "79%", maxRisk: 0.31 },
    bearish: { strategy: "BuyPutSpread", strikes: "3.3K / 3.1K", expiry: "5 days", fill: "79%", maxRisk: 0.36 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "3.6K / 3.8K", expiry: "12 days", fill: "81%", maxRisk: 2.44 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "3.1K / 2.9K", expiry: "12 days", fill: "81%", maxRisk: 2.38 }
  },
  TSLA: {
    bullish: { strategy: "BuyCallSpread", strikes: "440 / 450", expiry: "5 days", fill: "78%", maxRisk: 0.42 },
    bearish: { strategy: "BuyPutSpread", strikes: "440 / 430", expiry: "5 days", fill: "78%", maxRisk: 0.47 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "450 / 460", expiry: "12 days", fill: "80%", maxRisk: 4.9 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "430 / 420", expiry: "12 days", fill: "80%", maxRisk: 4.72 }
  },
  QQQ: {
    bullish: { strategy: "BuyCallSpread", strikes: "725 / 730", expiry: "5 days", fill: "79%", maxRisk: 0.34 },
    bearish: { strategy: "BuyPutSpread", strikes: "725 / 720", expiry: "5 days", fill: "79%", maxRisk: 0.38 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "730 / 735", expiry: "12 days", fill: "81%", maxRisk: 2.46 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "720 / 715", expiry: "12 days", fill: "81%", maxRisk: 2.39 }
  },
  SPY: {
    bullish: { strategy: "BuyCallSpread", strikes: "650 / 655", expiry: "5 days", fill: "79%", maxRisk: 0.28 },
    bearish: { strategy: "BuyPutSpread", strikes: "650 / 645", expiry: "5 days", fill: "79%", maxRisk: 0.32 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "655 / 660", expiry: "12 days", fill: "82%", maxRisk: 2.6 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "645 / 640", expiry: "12 days", fill: "82%", maxRisk: 2.54 }
  },
  NVDA: {
    bullish: { strategy: "BuyCallSpread", strikes: "215 / 225", expiry: "5 days", fill: "78%", maxRisk: 0.35 },
    bearish: { strategy: "BuyPutSpread", strikes: "215 / 205", expiry: "5 days", fill: "78%", maxRisk: 0.39 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "225 / 235", expiry: "12 days", fill: "80%", maxRisk: 4.62 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "205 / 195", expiry: "12 days", fill: "80%", maxRisk: 4.51 }
  },
  EWY: {
    bullish: { strategy: "BuyCallSpread", strikes: "165 / 170", expiry: "5 days", fill: "78%", maxRisk: 0.29 },
    bearish: { strategy: "BuyPutSpread", strikes: "165 / 160", expiry: "5 days", fill: "78%", maxRisk: 0.33 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "170 / 175", expiry: "12 days", fill: "80%", maxRisk: 2.31 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "160 / 155", expiry: "12 days", fill: "80%", maxRisk: 2.26 }
  },
  COIN: {
    bullish: { strategy: "BuyCallSpread", strikes: "155 / 160", expiry: "5 days", fill: "78%", maxRisk: 0.41 },
    bearish: { strategy: "BuyPutSpread", strikes: "155 / 150", expiry: "5 days", fill: "78%", maxRisk: 0.45 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "160 / 165", expiry: "12 days", fill: "80%", maxRisk: 2.58 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "150 / 145", expiry: "12 days", fill: "80%", maxRisk: 2.49 }
  },
  SPCX: {
    bullish: { strategy: "BuyCallSpread", strikes: "135 / 140", expiry: "5 days", fill: "77%", maxRisk: 0.44 },
    bearish: { strategy: "BuyPutSpread", strikes: "135 / 130", expiry: "5 days", fill: "77%", maxRisk: 0.48 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "140 / 145", expiry: "12 days", fill: "79%", maxRisk: 2.71 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "130 / 125", expiry: "12 days", fill: "79%", maxRisk: 2.63 }
  },
  MU: {
    bullish: { strategy: "BuyCallSpread", strikes: "880 / 890", expiry: "5 days", fill: "78%", maxRisk: 0.52 },
    bearish: { strategy: "BuyPutSpread", strikes: "880 / 870", expiry: "5 days", fill: "78%", maxRisk: 0.57 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "890 / 900", expiry: "12 days", fill: "80%", maxRisk: 4.82 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "870 / 860", expiry: "12 days", fill: "80%", maxRisk: 4.71 }
  },
  SKHY: {
    bullish: { strategy: "BuyCallSpread", strikes: "140 / 145", expiry: "5 days", fill: "78%", maxRisk: 0.39 },
    bearish: { strategy: "BuyPutSpread", strikes: "140 / 135", expiry: "5 days", fill: "78%", maxRisk: 0.43 },
    "neutral-bearish": { strategy: "SellCallSpread", strikes: "145 / 150", expiry: "12 days", fill: "80%", maxRisk: 2.55 },
    "neutral-bullish": { strategy: "SellPutSpread", strikes: "135 / 130", expiry: "12 days", fill: "80%", maxRisk: 2.47 }
  }
};

let selectedAsset = "BTC";
const assetButtons = document.querySelectorAll("[data-asset]");
const biasSelect = document.getElementById("demoBias");
const budgetSelect = document.getElementById("demoBudget");
const sizeSelect = document.getElementById("demoSize");
const scanButton = document.getElementById("demoScan");
const status = document.getElementById("demoStatus");
const result = document.getElementById("demoResult");
const liveMarketStatus = document.getElementById("liveMarketStatus");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function record(event, properties = {}) {
  const detail = { event, ...properties };
  window.dispatchEvent(new CustomEvent("callput:analytics", { detail }));
  if (Array.isArray(window.dataLayer)) window.dataLayer.push(detail);
}

function setAsset(asset) {
  selectedAsset = asset;
  assetButtons.forEach((button) => {
    const active = button.dataset.asset === asset;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  result.hidden = true;
  status.className = "demo-status";
  status.textContent = `${asset} selected. Scan a deterministic example. No wallet is connected.`;
}

function sizeMultiplier() {
  return Number(sizeSelect.value) / 0.001;
}

function showResult() {
  const sample = samples[selectedAsset]?.[biasSelect.value];
  const risk = sample ? sample.maxRisk * sizeMultiplier() : Infinity;
  const budget = Number(budgetSelect.value);
  scanButton.disabled = false;

  if (!sample || risk > budget) {
    result.hidden = true;
    status.className = "demo-status error";
    status.textContent = "No matching demo spread for this combination. Try a smaller size or wider risk budget. No wallet action occurred.";
    return;
  }

  document.getElementById("resultStrategy").textContent = `${selectedAsset} · ${sample.strategy}`;
  document.getElementById("resultStrikes").textContent = sample.strikes;
  document.getElementById("resultExpiry").textContent = sample.expiry;
  document.getElementById("resultFill").textContent = sample.fill;
  document.getElementById("resultRisk").textContent = `${risk.toFixed(2)} USDC`;
  result.hidden = false;
  status.className = "demo-status";
  status.textContent = "Example risk preview ready. This simulation did not prepare or submit a transaction.";
  record("demo_risk_view", { asset_category: ["BTC", "ETH"].includes(selectedAsset) ? "crypto" : "equity_reference" });
}

function scan() {
  result.hidden = true;
  status.className = "demo-status";
  status.textContent = "Scanning deterministic sample spreads…";
  scanButton.disabled = true;
  record("demo_scan", {
    asset_category: ["BTC", "ETH"].includes(selectedAsset) ? "crypto" : "equity_reference",
    market_view: biasSelect.value
  });
  window.setTimeout(showResult, reduceMotion.matches ? 0 : 520);
}

assetButtons.forEach((button) => button.addEventListener("click", () => setAsset(button.dataset.asset)));
scanButton.addEventListener("click", scan);

async function refreshLiveMarkets() {
  try {
    const response = await fetch("/api/bankr/assets", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`assets endpoint returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.assets)) throw new Error("assets endpoint returned an invalid payload");

    const liveAssets = payload.assets.filter((asset) => Number(asset.tradable_options) > 0);
    for (const asset of payload.assets) {
      const ticker = document.querySelector(`[data-market-symbol="${asset.symbol}"]`);
      if (ticker) {
        ticker.textContent = `${asset.symbol} · ${asset.tradable_options}`;
        ticker.title = `${asset.tradable_options} tradable option contracts in the current feed`;
      }
      const demoButton = document.querySelector(`[data-asset="${asset.symbol}"]`);
      if (demoButton) demoButton.title = `${asset.tradable_options} tradable option contracts in the current feed`;
    }

    const optionCount = liveAssets.reduce((sum, asset) => sum + Number(asset.tradable_options), 0);
    liveMarketStatus.textContent = `${liveAssets.length} symbols tradable now · ${optionCount.toLocaleString()} live option contracts · Base 8453`;
  } catch {
    liveMarketStatus.textContent = "11 configured symbols shown · live availability could not be refreshed";
  }
}

void refreshLiveMarkets();

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      button.textContent = "Copied";
      record(button.dataset.event);
      window.setTimeout(() => { button.textContent = original; }, 1400);
    } catch {
      button.textContent = "Select text";
      window.getSelection()?.selectAllChildren(target);
    }
  });
});

document.querySelectorAll("[data-event]").forEach((element) => {
  if (element.hasAttribute("data-copy-target")) return;
  element.addEventListener("click", () => record(element.dataset.event, { source: element.dataset.source || "body" }));
});

record("bankr_guide_view", { viewport: window.innerWidth < 820 ? "compact" : "wide" });

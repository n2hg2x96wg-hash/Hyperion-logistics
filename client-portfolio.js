import { doc, onSnapshot, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function formatCurrency(value, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value || 0);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function setupClientPortfolio({ db, clientId }) {
  const nameEl = document.getElementById("clientName");
  const statusEl = document.getElementById("clientStatus");
  const xrpPriceEl = document.getElementById("clientXrpPrice");
  const tslaPriceEl = document.getElementById("clientTslaPrice");
  const xrpHoldingsEl = document.getElementById("clientXrpHoldings");
  const tslaHoldingsEl = document.getElementById("clientTslaHoldings");
  const totalValueEl = document.getElementById("clientTotalValue");
  const gainLossEl = document.getElementById("clientGainLoss");
  const updatedEl = document.getElementById("clientMarketUpdated");

  let portfolioChart = null;
  let lastProfile = null;
  let activeDays = 7;

  async function readMarketData(days) {
    const marketApi = window.HyperionInvestmentApi;
    if (!marketApi?.getMarketSnapshot || !marketApi?.getMarketHistory) {
      throw new Error("Investment API unavailable");
    }
    const [snapshot, history] = await Promise.all([
      marketApi.getMarketSnapshot(),
      marketApi.getMarketHistory(days)
    ]);
    return { snapshot, history };
  }

  function updateSummary(profile, market) {
    const xrpHoldings = toNumber(profile?.portfolios?.xrp_holdings);
    const tslaHoldings = toNumber(profile?.portfolios?.tsla_holdings);
    const xrpPrice = toNumber(market?.xrp?.price);
    const tslaPrice = toNumber(market?.tsla?.price);

    const xrpValue = xrpHoldings * xrpPrice;
    const tslaValue = tslaHoldings * tslaPrice;
    const total = xrpValue + tslaValue;

    const xrp24h = xrpValue * (toNumber(market?.xrp?.changePct) / 100);
    const tsla24h = tslaValue * (toNumber(market?.tsla?.changePct) / 100);
    const total24h = xrp24h + tsla24h;

    nameEl.textContent = profile?.name || "Client";
    statusEl.textContent = profile?.status || "inactive";
    xrpPriceEl.textContent = formatCurrency(xrpPrice, 4);
    tslaPriceEl.textContent = formatCurrency(tslaPrice, 2);
    xrpHoldingsEl.textContent = xrpHoldings.toFixed(4);
    tslaHoldingsEl.textContent = tslaHoldings.toFixed(4);
    totalValueEl.textContent = formatCurrency(total, 2);
    gainLossEl.textContent = `${formatCurrency(total24h, 2)} (${(toNumber(market?.xrp?.changePct) + toNumber(market?.tsla?.changePct)).toFixed(2)}% blended)`;
    gainLossEl.className = total24h >= 0 ? "stat-value positive" : "stat-value negative";
    updatedEl.textContent = `Updated: ${new Date(market?.updatedAt || Date.now()).toLocaleString()}`;
  }

  async function loadHistory(days = 7) {
    const historyRef = query(collection(db, "portfolio_history", clientId, "history"), orderBy("timestamp", "desc"), limit(30));
    const docs = await getDocs(historyRef);
    if (!docs.empty) {
      const points = docs.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .reverse()
        .map((entry) => ({
          label: entry.id,
          value: toNumber(entry.total_value)
        }));
      return points;
    }

    const marketApi = window.HyperionInvestmentApi;
    const marketHistory = await marketApi.getMarketHistory(days);
    const xrpHoldings = toNumber(lastProfile?.portfolios?.xrp_holdings);
    const tslaHoldings = toNumber(lastProfile?.portfolios?.tsla_holdings);

    return marketHistory.xrp.map((point, index) => {
      const tslaPoint = marketHistory.tsla[index] || marketHistory.tsla[marketHistory.tsla.length - 1];
      const total = (xrpHoldings * toNumber(point.price)) + (tslaHoldings * toNumber(tslaPoint?.price));
      return {
        label: point.date,
        value: Number(total.toFixed(2))
      };
    });
  }

  async function renderChart(days = 7) {
    const points = await loadHistory(days);
    const labels = points.map((point) => point.label.slice(5));
    const values = points.map((point) => point.value);

    if (!portfolioChart) {
      portfolioChart = new Chart(document.getElementById("clientPortfolioChart"), {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Portfolio Value (USD)",
            data: values,
            borderColor: "rgba(59, 130, 246, 1)",
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: "#cbd5e1" } } },
          scales: {
            x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.15)" } },
            y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148, 163, 184, 0.15)" } }
          }
        }
      });
      return;
    }

    portfolioChart.data.labels = labels;
    portfolioChart.data.datasets[0].data = values;
    portfolioChart.update();
  }

  async function refreshDashboard(profile) {
    lastProfile = profile;
    const marketBundle = await readMarketData(30);
    updateSummary(profile, marketBundle.snapshot);
    await renderChart(activeDays);
  }

  const unsubscribeClient = onSnapshot(doc(db, "clients", clientId), async (snapshot) => {
    if (!snapshot.exists()) return;
    const profile = { id: snapshot.id, ...snapshot.data() };
    await refreshDashboard(profile);
  });

  document.querySelectorAll(".period-controls button").forEach((button) => {
    button.addEventListener("click", async () => {
      activeDays = Number(button.dataset.days || 7);
      document.querySelectorAll(".period-controls button").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      await renderChart(activeDays);
    });
  });

  const intervalId = setInterval(async () => {
    if (!lastProfile) return;
    const market = await window.HyperionInvestmentApi.getMarketSnapshot();
    updateSummary(lastProfile, market);
  }, 60000);

  return () => {
    clearInterval(intervalId);
    unsubscribeClient();
  };
}

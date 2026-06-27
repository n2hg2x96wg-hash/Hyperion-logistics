const XRP_QUOTE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_change=true';
const XRP_HISTORY_URL = (days) => `https://api.coingecko.com/api/v3/coins/ripple/market_chart?vs_currency=usd&days=${days}&interval=daily`;
const TSLA_HISTORY_URL = 'https://stooq.com/q/d/l/?s=tsla.us&i=d';

const CRYPTO_REFRESH_MS = 60 * 1000;
const STOCK_REFRESH_MS = 300 * 1000;
const CACHE_TTL_MS = 45 * 1000;
const HISTORY_TTL_MS = 10 * 60 * 1000;

const chartState = {
  period: 7,
  initialized: false,
  tsla: null,
  xrp: null,
  visible: false
};

const dashboardState = {
  xrpPrice: null,
  xrpChangePct: null,
  tslaPrice: null,
  tslaChangePct: null,
  tslaChangeValue: null
};

const CACHE_KEY = 'investment-dashboard-cache-v1';

function nowIso() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showError(message) {
  const errorBanner = document.getElementById('errorBanner');
  if (!errorBanner) return;
  errorBanner.textContent = message;
  errorBanner.classList.add('show');
}

function clearError() {
  const errorBanner = document.getElementById('errorBanner');
  if (!errorBanner) return;
  errorBanner.classList.remove('show');
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage write failures
  }
}

function getStaleCacheData(key) {
  const cache = readCache();
  return cache[key]?.data || null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function animatePrice(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('price-updated');
  void el.offsetWidth;
  el.classList.add('price-updated');
}

function setChangeText(elementId, changeValue, changePct) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const pctSign = changePct >= 0 ? '+' : '';
  const valueSign = changeValue >= 0 ? '+' : '-';
  const className = changePct >= 0 ? 'positive' : 'negative';
  const roundedValue = Number.isFinite(changeValue) ? `${valueSign}$${Math.abs(changeValue).toFixed(2)} • ` : '';
  el.className = `change ${className}`;
  el.textContent = `${roundedValue}${pctSign}${changePct.toFixed(2)}% (24H)`;
}

function formatCurrency(value, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function parseStooqCsvRows(csv) {
  const lines = csv.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const [date, open, high, low, close] = line.split(',');
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close)
    };
  }).filter((row) => Number.isFinite(row.close));
}

async function getCachedOrFetch(key, ttlMs, fetcher) {
  const cache = readCache();
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < ttlMs) {
    return entry.data;
  }

  const data = await fetcher();
  cache[key] = { timestamp: Date.now(), data };
  writeCache(cache);
  return data;
}

function generateFallbackHistory(days, basePrice, volatility = 0.03) {
  const points = [];
  let current = basePrice;
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const drift = (Math.random() - 0.5) * volatility;
    current = Math.max(0.01, current * (1 + drift));
    points.push({ date: date.toISOString().slice(0, 10), price: Number(current.toFixed(4)) });
  }
  return points;
}

async function loadXrpQuote() {
  let data;
  let source = 'CoinGecko';
  try {
    data = await getCachedOrFetch('xrp-quote', CACHE_TTL_MS, async () => {
      const json = await fetchJson(XRP_QUOTE_URL);
      if (!json?.ripple?.usd) {
        throw new Error('Missing XRP quote');
      }
      return {
        price: Number(json.ripple.usd),
        changePct: Number(json.ripple.usd_24h_change || 0)
      };
    });
  } catch {
    data = getStaleCacheData('xrp-quote') || { price: 0.52, changePct: 0 };
    source = 'Fallback';
  }

  dashboardState.xrpPrice = data.price;
  dashboardState.xrpChangePct = data.changePct;
  document.getElementById('xrpPrice').textContent = formatCurrency(data.price, 4);
  setChangeText('xrpChange', (data.price * data.changePct) / 100, data.changePct);
  document.getElementById('xrpUpdated').textContent = `Updated ${nowIso()} • Source: ${source}`;
  animatePrice('xrpPrice');
}

async function loadTslaQuote() {
  let data;
  let source = 'Stooq (TSLA proxy)';
  try {
    data = await getCachedOrFetch('tsla-quote', STOCK_REFRESH_MS - 5000, async () => {
      const csv = await fetchText(TSLA_HISTORY_URL);
      const rows = parseStooqCsvRows(csv);
      if (!rows.length) {
        throw new Error('Missing TSLA quote');
      }

      const latest = rows[rows.length - 1];
      const previous = rows[rows.length - 2]?.close || (latest.close * 0.98);
      return {
        price: latest.close,
        changeValue: latest.close - previous,
        changePct: ((latest.close - previous) / previous) * 100
      };
    });
  } catch {
    data = getStaleCacheData('tsla-quote') || { price: 248, changeValue: 0, changePct: 0 };
    source = 'Fallback';
  }

  dashboardState.tslaPrice = data.price;
  dashboardState.tslaChangePct = data.changePct;
  dashboardState.tslaChangeValue = data.changeValue;
  document.getElementById('tslaPrice').textContent = formatCurrency(data.price);
  setChangeText('tslaChange', data.changeValue, data.changePct);
  document.getElementById('tslaUpdated').textContent = `Updated ${nowIso()} • Source: ${source}`;
  animatePrice('tslaPrice');
}

async function loadXrpHistory(days) {
  try {
    const data = await getCachedOrFetch(`xrp-history-${days}`, HISTORY_TTL_MS, async () => {
      const json = await fetchJson(XRP_HISTORY_URL(days));
      if (!Array.isArray(json?.prices)) {
        throw new Error('Missing XRP history');
      }
      return json.prices.map(([timestamp, price]) => ({
        date: new Date(timestamp).toISOString().slice(0, 10),
        price: Number(price)
      }));
    });

    if (data.length) {
      return data;
    }
  } catch {
    // fallback below
  }
  return generateFallbackHistory(days, dashboardState.xrpPrice || 0.48, 0.05);
}

async function loadTslaHistory(days) {
  try {
    const data = await getCachedOrFetch(`tsla-history-${days}`, HISTORY_TTL_MS, async () => {
      const csv = await fetchText(TSLA_HISTORY_URL);
      const rows = parseStooqCsvRows(csv);
      if (!rows.length) {
        throw new Error('Missing TSLA history');
      }
      return rows.slice(-days).map((row) => ({ date: row.date, price: row.close }));
    });

    if (data.length) {
      return data;
    }
  } catch {
    // fallback below
  }
  return generateFallbackHistory(days, dashboardState.tslaPrice || 248, 0.02);
}

function chartConfig(labels, values, label, color) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: color,
        backgroundColor: color.replace('1)', '0.14)'),
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 600,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: {
          labels: { color: '#cbd5e1' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 7 },
          grid: { color: 'rgba(148, 163, 184, 0.15)' }
        },
        y: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(148, 163, 184, 0.15)' }
        }
      }
    }
  };
}

function updatePeriodButtons(days) {
  document.querySelectorAll('.period-controls button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.days) === days);
  });
}

async function updateCharts(days) {
  if (!chartState.initialized || !chartState.visible) return;
  const [tslaData, xrpData] = await Promise.all([loadTslaHistory(days), loadXrpHistory(days)]);
  const tslaLabels = tslaData.map((item) => item.date.slice(5));
  const xrpLabels = xrpData.map((item) => item.date.slice(5));

  const tslaValues = tslaData.map((item) => item.price);
  const xrpValues = xrpData.map((item) => item.price);

  if (!chartState.tsla) {
    chartState.tsla = new Chart(document.getElementById('tslaChart'), chartConfig(tslaLabels, tslaValues, 'TSLA (USD)', 'rgba(59, 130, 246, 1)'));
  } else {
    chartState.tsla.data.labels = tslaLabels;
    chartState.tsla.data.datasets[0].data = tslaValues;
    chartState.tsla.update();
  }

  if (!chartState.xrp) {
    chartState.xrp = new Chart(document.getElementById('xrpChart'), chartConfig(xrpLabels, xrpValues, 'XRP (USD)', 'rgba(34, 197, 94, 1)'));
  } else {
    chartState.xrp.data.labels = xrpLabels;
    chartState.xrp.data.datasets[0].data = xrpValues;
    chartState.xrp.update();
  }
}

async function initChartsWhenVisible() {
  const section = document.getElementById('chartsSection');
  if (!section) return;

  const observer = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      chartState.visible = true;
      if (!chartState.initialized) {
        chartState.initialized = true;
        await updateCharts(chartState.period);
      }
      observer.disconnect();
    }
  }, { threshold: 0.2 });

  observer.observe(section);
}

function calculatePortfolio() {
  const input = Number(document.getElementById('xrpHoldings').value || 0);
  const out = document.getElementById('portfolioValues');

  if (!dashboardState.xrpPrice) {
    out.innerHTML = '<div>Total Value: --</div><div>24H Gain/Loss: Waiting for live XRP data...</div>';
    return;
  }

  const value = input * dashboardState.xrpPrice;
  const change = (value * (dashboardState.xrpChangePct || 0)) / 100;
  const changeClass = change >= 0 ? 'positive' : 'negative';

  out.innerHTML = `
    <div>Total Value: <strong>${formatCurrency(value, 2)}</strong></div>
    <div class="${changeClass}">24H Gain/Loss: <strong>${formatCurrency(change, 2)} (${(dashboardState.xrpChangePct || 0).toFixed(2)}%)</strong></div>
  `;
}

async function refreshAllQuotes() {
  try {
    await Promise.all([loadTslaQuote(), loadXrpQuote()]);
    clearError();
  } catch (error) {
    showError('Live market data is temporarily unavailable. Showing cached or fallback data where possible.');
    // keep available stale values in UI
  }
  calculatePortfolio();
}

function initPeriods() {
  document.querySelectorAll('.period-controls button').forEach((button) => {
    button.addEventListener('click', async () => {
      const days = Number(button.dataset.days);
      chartState.period = days;
      updatePeriodButtons(days);
      await updateCharts(days);
    });
  });
}

function setupRefresh() {
  setInterval(() => {
    loadXrpQuote()
      .then(() => {
        clearError();
        calculatePortfolio();
      })
      .catch(() => showError('Unable to refresh XRP live data.'));
  }, CRYPTO_REFRESH_MS);

  setInterval(() => {
    loadTslaQuote()
      .then(clearError)
      .catch(() => showError('Unable to refresh TSLA proxy data.'));
  }, STOCK_REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('portfolioButton').addEventListener('click', calculatePortfolio);
  initPeriods();
  await refreshAllQuotes();
  setupRefresh();
  initChartsWhenVisible();
});

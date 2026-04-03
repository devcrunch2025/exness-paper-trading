const ui = {
  candles: document.getElementById("candles"),
  startingBalance: document.getElementById("startingBalance"),
  side: document.getElementById("side"),
  symbolFilter: document.getElementById("symbolFilter"),
  manualSymbol: document.getElementById("manualSymbol"),
  manualSide: document.getElementById("manualSide"),
  manualPrice: document.getElementById("manualPrice"),
  sendSignalBtn: document.getElementById("sendSignalBtn"),
  manualSignalStatus: document.getElementById("manualSignalStatus"),
  outcome: document.getElementById("outcome"),
  minPnl: document.getElementById("minPnl"),
  clearOrdersBtn: document.getElementById("clearOrdersBtn"),
  runBtn: document.getElementById("runBtn"),
  botFeedTrack: document.getElementById("botFeedTrack"),
  watchlistCharts: document.getElementById("watchlistCharts"),
  kpis: document.getElementById("kpis"),
  activeTradeCount: document.getElementById("activeTradeCount"),
  activeSymbolFilter: document.getElementById("activeSymbolFilter"),
  activeTradesBody: document.getElementById("activeTradesTableBody"),
  orderCount: document.getElementById("orderCount"),
  tbody: document.getElementById("ordersTableBody")
};

let latestSimulation = null;
let lastChartsGeneratedAt = null;

function getFloatingPnlTotal(activeTrades) {
  return Number(
    (activeTrades || []).reduce((sum, trade) => sum + Number(trade.floatingPnl || 0), 0).toFixed(2)
  );
}

function getLiveEquity(data) {
  return Number((Number(data.endingBalance || 0) + getFloatingPnlTotal(data.activeTrades || [])).toFixed(2));
}

function fmtMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function fmtPrice(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(5);
  return value.toFixed(6);
}

function fmtDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(new Date(value));
}

function formatStrategySignal(detail) {
  return `${detail.strategy}:${detail.signal} ${Math.round((detail.confidence || 0) * 100)}%`;
}

function renderBotFeed(data) {
  const floatingPnlTotal = getFloatingPnlTotal(data.activeTrades || []);
  const liveEquity = getLiveEquity(data);
  const latestClosedTrade = [...(data.orders || [])].sort((left, right) => {
    const rightTime = new Date(right.endDateTime || right.startDateTime || 0).getTime();
    const leftTime = new Date(left.endDateTime || left.startDateTime || 0).getTime();
    return rightTime - leftTime;
  })[0];

  const activeTrade = (data.activeTrades || [])[0] || null;
  const latestDecision = (activeTrade || latestClosedTrade || {}).decision;
  const decisionSummary = latestDecision
    ? latestDecision.details.map(formatStrategySignal).join(" | ")
    : "No strategy vote available yet";

  const messages = [
    `Bot live at ${fmtDateTime(data.generatedAt)} on watchlist ${(data.symbols || [data.symbol]).join(", ")} ${data.timeframe}`,
    `Wallet fixed at ${fmtMoney(data.startingBalance)} | Per symbol ${fmtMoney(data.capitalPerSymbol || data.startingBalance)} | Ending balance ${fmtMoney(data.endingBalance)} | Net ${fmtMoney(data.netPnl)}`,
    `Win rate ${data.winRate}% with ${data.totalOrders} closed orders and ${data.activeTradesCount || 0} active trades`,
    `Active trades floating ${fmtMoney(floatingPnlTotal)} | Live equity ${fmtMoney(liveEquity)}`
  ];

  if (data.resetAt) {
    messages.push(`Fresh start triggered at ${fmtDateTime(data.resetAt)} with ${fmtMoney(data.startingBalance)} wallet`);
  }

  if (latestClosedTrade) {
    messages.push(
      `Latest closed ${latestClosedTrade.id}: ${latestClosedTrade.symbol} ${latestClosedTrade.side} via ${(latestClosedTrade.strategies || []).join(", ") || "n/a"} | ${latestClosedTrade.triggerType} at ${latestClosedTrade.triggeredAtPrice?.toFixed(5) || "-"} | P/L ${fmtMoney(latestClosedTrade.pnl)}`
    );
  }

  if (activeTrade) {
    messages.push(
      `Active trade ${activeTrade.id}: ${activeTrade.symbol} ${activeTrade.side} entry ${activeTrade.entry.toFixed(5)} | SL ${activeTrade.stopLoss.toFixed(5)} | TP ${activeTrade.takeProfit.toFixed(5)} | Floating ${fmtMoney(activeTrade.floatingPnl)}`
    );
  }

  messages.push(`Strategy votes: ${decisionSummary}`);

  const items = [...messages, ...messages]
    .map((message) => `<span class="ticker-item">${message}</span>`)
    .join("");

  ui.botFeedTrack.innerHTML = items;
}

function renderKpis(data) {
  const floatingPnlTotal = getFloatingPnlTotal(data.activeTrades || []);
  const liveEquity = getLiveEquity(data);
  const metrics = [
    { label: "Watchlist", value: `${(data.symbols || [data.symbol]).join(", ")} (${data.timeframe})` },
    { label: "Starting Balance", value: fmtMoney(data.startingBalance) },
    { label: "Capital / Symbol", value: fmtMoney(data.capitalPerSymbol || data.startingBalance) },
    { label: "Ending Balance", value: fmtMoney(data.endingBalance) },
    { label: "Floating P/L", value: fmtMoney(floatingPnlTotal), className: floatingPnlTotal >= 0 ? "positive" : "negative" },
    { label: "Live Equity", value: fmtMoney(liveEquity), className: liveEquity >= data.startingBalance ? "positive" : "negative" },
    { label: "Net P/L", value: fmtMoney(data.netPnl), className: data.netPnl >= 0 ? "positive" : "negative" },
    { label: "Win Rate", value: `${data.winRate}%` },
    { label: "Max Drawdown", value: `${data.maxDrawdownPct}%` },
    { label: "Total Orders", value: String(data.totalOrders) },
    { label: "Active Trades", value: String(data.activeTradesCount || 0) }
  ];

  ui.kpis.innerHTML = metrics
    .map(
      (m) => `
      <article class="kpi">
        <div class="label">${m.label}</div>
        <div class="value ${m.className || ""}">${m.value}</div>
      </article>
    `
    )
    .join("");
}

function sideBadge(side) {
  const className = side === "BUY" ? "buy" : "sell";
  return `<span class="badge ${className}">${side}</span>`;
}

function outcomeBadge(outcome) {
  const className = outcome === "WIN" ? "win" : "loss";
  return `<span class="badge ${className}">${outcome}</span>`;
}

function triggerBadge(triggerType) {
  if (triggerType === "TAKE_PROFIT") return '<span class="badge win">Take Profit</span>';
  if (triggerType === "STOP_LOSS") return '<span class="badge loss">Stop Loss</span>';
  return '<span class="badge">Open</span>';
}

function buildSparklinePoints(values, width, height, padding) {
  if (!values || values.length < 2) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const xStep = (width - padding * 2) / (values.length - 1 || 1);
  const spread = max - min || 1;

  return values
    .map((value, index) => {
      const x = padding + index * xStep;
      const y = height - padding - ((value - min) / spread) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderWatchlistCharts(payload) {
  const charts = payload?.charts || [];

  if (!charts.length) {
    ui.watchlistCharts.innerHTML = '<article class="watch-card">No watchlist chart data</article>';
    return;
  }

  ui.watchlistCharts.innerHTML = charts
    .map((chart) => {
      const isUp = chart.changePct >= 0;
      const points = buildSparklinePoints(chart.closes || [], 200, 54, 4);
      const color = isUp ? "#0f9d58" : "#c1121f";
      const timeframeLabel = chart.candleMinutes ? `${chart.candleMinutes}m` : chart.timeframe || "-";

      return `
      <article class="watch-card">
        <div class="watch-topline">
          <div class="watch-symbol-wrap">
            <span class="watch-symbol">${chart.symbol}</span>
            <span class="watch-timeframe">${timeframeLabel}</span>
          </div>
          <span class="watch-change ${isUp ? "up" : "down"}">${isUp ? "+" : ""}${chart.changePct}%</span>
        </div>
        <div class="watch-price">${fmtPrice(chart.lastPrice)}</div>
        <svg class="sparkline" viewBox="0 0 200 54" preserveAspectRatio="none" aria-label="${chart.symbol} sparkline">
          <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"></polyline>
        </svg>
      </article>
    `;
    })
    .join("");
}

async function loadWatchlistCharts() {
  try {
    const response = await fetch("/api/watchlist/charts?bars=90");
    if (!response.ok) throw new Error("chart fetch failed");
    const payload = await response.json();
    if (payload?.generatedAt && payload.generatedAt === lastChartsGeneratedAt) return;
    lastChartsGeneratedAt = payload?.generatedAt || null;
    renderWatchlistCharts(payload);
  } catch {
    ui.watchlistCharts.innerHTML = '<article class="watch-card">Watchlist charts unavailable</article>';
  }
}

function applyActiveTimeFilters(activeTrades) {
  const fromInput = null;
  const toInput = null;

  const fromTs = fromInput ? new Date(fromInput).getTime() : null;
  const toTs = toInput ? new Date(toInput).getTime() : null;

  return (activeTrades || []).filter((trade) => {
    const startTs = new Date(trade.startDateTime).getTime();
    if (!Number.isFinite(startTs)) return false;
    if (fromTs !== null && Number.isFinite(fromTs) && startTs < fromTs) return false;
    if (toTs !== null && Number.isFinite(toTs) && startTs > toTs) return false;
    return true;
  });
}

function renderActiveTrades(activeTrades, endingBalance) {
  const sortedTrades = [...(activeTrades || [])].sort((left, right) => {
    const rightTime = new Date(right.startDateTime || 0).getTime();
    const leftTime = new Date(left.startDateTime || 0).getTime();
    return rightTime - leftTime;
  });

  const floatingPnlTotal = getFloatingPnlTotal(sortedTrades);
  const liveEquity = Number((Number(endingBalance || 0) + floatingPnlTotal).toFixed(2));
  const totalOpen = latestSimulation ? (latestSimulation.activeTrades || []).length : sortedTrades.length;

  ui.activeTradeCount.textContent = `${sortedTrades.length} / ${totalOpen} open trades | Floating ${fmtMoney(floatingPnlTotal)} | Live balance ${fmtMoney(liveEquity)}`;

  if (!sortedTrades.length) {
    ui.activeTradesBody.innerHTML = '<tr><td colspan="10">No active trades right now.</td></tr>';
    return;
  }

  ui.activeTradesBody.innerHTML = sortedTrades
    .map(
      (trade) => `
      <tr>
        <td class="mono">${trade.id}</td>
        <td class="mono">${trade.symbol || "-"}</td>
        <td>${sideBadge(trade.side)}</td>
        <td>${(trade.strategies || []).join(", ") || "-"}</td>
        <td class="mono">${fmtDateTime(trade.startDateTime)}</td>
        <td class="mono">${trade.entry.toFixed(5)}</td>
        <td class="mono">${trade.currentPrice.toFixed(5)}</td>
        <td class="mono">${trade.stopLoss.toFixed(5)}</td>
        <td class="mono">${trade.takeProfit.toFixed(5)}</td>
        <td class="${trade.floatingPnl >= 0 ? "positive" : "negative"}">${fmtMoney(trade.floatingPnl)}</td>
      </tr>
    `
    )
    .join("");
}

function renderSymbolFilter(data) {
  const symbols = data?.symbols || [];
  const currentValue = ui.symbolFilter.value || "ALL";
  const options = ["ALL", ...symbols];

  ui.symbolFilter.innerHTML = options
    .map((symbol) => `<option value="${symbol}">${symbol === "ALL" ? "All" : symbol}</option>`)
    .join("");

  ui.symbolFilter.value = options.includes(currentValue) ? currentValue : "ALL";
}

function renderActiveSymbolFilter(data) {
  const symbols = data?.symbols || [];
  const currentValue = ui.activeSymbolFilter.value || "ALL";
  const options = ["ALL", ...symbols];

  ui.activeSymbolFilter.innerHTML = options
    .map((symbol) => `<option value="${symbol}">${symbol === "ALL" ? "All Watchlist" : symbol}</option>`)
    .join("");

  ui.activeSymbolFilter.value = options.includes(currentValue) ? currentValue : "ALL";
}

function renderManualSymbolOptions(data) {
  const symbols = data?.symbols || [];
  const currentValue = ui.manualSymbol.value;

  ui.manualSymbol.innerHTML = symbols.map((symbol) => `<option value="${symbol}">${symbol}</option>`).join("");

  if (!symbols.length) return;
  ui.manualSymbol.value = symbols.includes(currentValue) ? currentValue : symbols[0];
}

function applyOrderFilters(orders) {
  const side = ui.side.value;
  const symbol = ui.symbolFilter.value;
  const outcome = ui.outcome.value;
  const minPnl = ui.minPnl.value === "" ? null : Number(ui.minPnl.value);

  return orders.filter((o) => {
    if (symbol !== "ALL" && o.symbol !== symbol) return false;
    if (side !== "ALL" && o.side !== side) return false;
    if (outcome !== "ALL" && o.outcome !== outcome) return false;
    if (minPnl !== null && Number.isFinite(minPnl) && o.pnl < minPnl) return false;
    return true;
  });
}

function renderOrders(orders) {
  const sortedOrders = [...orders].sort((left, right) => {
    const rightTime = new Date(right.endDateTime || right.startDateTime || 0).getTime();
    const leftTime = new Date(left.endDateTime || left.startDateTime || 0).getTime();
    return rightTime - leftTime;
  });

  const total = latestSimulation ? latestSimulation.orders.length : orders.length;
  ui.orderCount.textContent = `${sortedOrders.length} / ${total} trades`;

  if (!sortedOrders.length) {
    ui.tbody.innerHTML = '<tr><td colspan="17">No orders match the selected filters.</td></tr>';
    return;
  }

  ui.tbody.innerHTML = sortedOrders
    .map(
      (o) => `
      <tr>
        <td class="mono">${o.id}</td>
        <td class="mono">${o.symbol || "-"}</td>
        <td>${sideBadge(o.side)}</td>
        <td>${(o.strategies || []).join(", ") || "-"}</td>
        <td class="mono">${fmtDateTime(o.startDateTime)}</td>
        <td class="mono">${fmtDateTime(o.endDateTime)}</td>
        <td class="mono">${o.duration || "-"}</td>
        <td>${o.lot.toFixed(2)}</td>
        <td class="mono">${o.entry.toFixed(5)}</td>
        <td class="mono">${o.stopLoss.toFixed(5)}</td>
        <td class="mono">${o.takeProfit.toFixed(5)}</td>
        <td>${triggerBadge(o.triggerType)}</td>
        <td class="mono">${o.triggeredAtPrice ? o.triggeredAtPrice.toFixed(5) : "-"}</td>
        <td class="mono">${o.exit.toFixed(5)}</td>
        <td class="${o.pnl >= 0 ? "positive" : "negative"}">${fmtMoney(o.pnl)}</td>
        <td>${outcomeBadge(o.outcome)}</td>
        <td>${fmtMoney(o.balanceAfter)}</td>
      </tr>
    `
    )
    .join("");
}

function applyActiveFilters(activeTrades) {
  const activeSymbol = ui.activeSymbolFilter.value;
  const timeFiltered = applyActiveTimeFilters(activeTrades || []);

  return timeFiltered.filter((trade) => {
    if (activeSymbol !== "ALL" && trade.symbol !== activeSymbol) return false;
    return true;
  });
}

async function loadSimulation() {
  ui.runBtn.disabled = true;
  ui.runBtn.textContent = "Loading...";

  try {
    const response = await fetch("/api/report");
    if (!response.ok) {
      const message = response.status === 404 ? "No live report yet. Start bot with npm run bot." : "Failed to fetch report";
      throw new Error(message);
    }
    const data = await response.json();

    latestSimulation = data;
    renderSymbolFilter(data);
    renderActiveSymbolFilter(data);
    renderManualSymbolOptions(data);
    const filteredOrders = applyOrderFilters(data.orders || []);
    const filteredActiveTrades = applyActiveFilters(data.activeTrades || []);

    renderBotFeed(data);
    renderKpis(data);
    renderActiveTrades(filteredActiveTrades, data.endingBalance);
    renderOrders(filteredOrders);
  } catch (error) {
    ui.botFeedTrack.innerHTML = `<span class="ticker-item">${error.message}</span><span class="ticker-item">Waiting for live bot report...</span>`;
    ui.kpis.innerHTML = `<article class="kpi"><div class="label">Live Report</div><div class="value negative">${error.message}</div></article>`;
    ui.watchlistCharts.innerHTML = '<article class="watch-card">Watchlist charts unavailable</article>';
    ui.activeTradeCount.textContent = "0 open trades | Floating $0.00 | Live balance $0.00";
    ui.activeTradesBody.innerHTML = '<tr><td colspan="10">Live report unavailable.</td></tr>';
    ui.tbody.innerHTML = '<tr><td colspan="17">Live report unavailable.</td></tr>';
  } finally {
    ui.runBtn.disabled = false;
    ui.runBtn.textContent = "Refresh Report";
  }
}

function refreshFilteredTables() {
  if (!latestSimulation) return;
  const filteredOrders = applyOrderFilters(latestSimulation.orders || []);
  const filteredActiveTrades = applyActiveFilters(latestSimulation.activeTrades || []);
  renderActiveTrades(filteredActiveTrades, latestSimulation.endingBalance);
  renderOrders(filteredOrders);
}

async function clearAllOrders() {
  const confirmed = window.confirm("Clear all orders and restart bot tracking from now with a fresh $100 wallet?");
  if (!confirmed) return;

  ui.clearOrdersBtn.disabled = true;
  ui.clearOrdersBtn.textContent = "Clearing...";

  try {
    const response = await fetch("/api/report/reset", { method: "POST" });
    if (!response.ok) {
      throw new Error("Failed to clear orders");
    }

    const payload = await response.json();
    latestSimulation = payload.report;
    renderSymbolFilter(payload.report);
    renderActiveSymbolFilter(payload.report);
    renderManualSymbolOptions(payload.report);
    renderBotFeed(payload.report);
    renderKpis(payload.report);
    renderActiveTrades(applyActiveFilters(payload.report.activeTrades || []), payload.report.endingBalance);
    renderOrders([]);
  } catch (error) {
    window.alert(error.message);
  } finally {
    ui.clearOrdersBtn.disabled = false;
    ui.clearOrdersBtn.textContent = "Clear All Orders";
  }
}

async function sendManualSignal() {
  const symbol = ui.manualSymbol.value;
  const side = ui.manualSide.value;
  const rawPrice = ui.manualPrice.value.trim();
  const parsedPrice = rawPrice === "" ? null : Number(rawPrice);

  if (!symbol) {
    ui.manualSignalStatus.textContent = "Select a symbol first.";
    ui.manualSignalStatus.className = "manual-status error";
    return;
  }

  if (rawPrice !== "" && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
    ui.manualSignalStatus.textContent = "Price must be a positive number.";
    ui.manualSignalStatus.className = "manual-status error";
    return;
  }

  ui.sendSignalBtn.disabled = true;
  ui.sendSignalBtn.textContent = "Sending...";
  ui.manualSignalStatus.textContent = `Submitting ${side} signal for ${symbol}...`;
  ui.manualSignalStatus.className = "manual-status";

  try {
    const response = await fetch("/api/manual-signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, side, price: parsedPrice })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Failed to submit signal");
    }

    latestSimulation = payload.report;
    renderSymbolFilter(payload.report);
    renderActiveSymbolFilter(payload.report);
    renderManualSymbolOptions(payload.report);
    renderBotFeed(payload.report);
    renderKpis(payload.report);
    renderActiveTrades(applyActiveFilters(payload.report.activeTrades || []), payload.report.endingBalance);
    renderOrders(applyOrderFilters(payload.report.orders || []));

    ui.manualPrice.value = "";
    ui.manualSignalStatus.textContent = payload.message;
    ui.manualSignalStatus.className = "manual-status success";
  } catch (error) {
    ui.manualSignalStatus.textContent = error.message;
    ui.manualSignalStatus.className = "manual-status error";
  } finally {
    ui.sendSignalBtn.disabled = false;
    ui.sendSignalBtn.textContent = "Send Signal";
  }
}

ui.runBtn.addEventListener("click", loadSimulation);
ui.clearOrdersBtn.addEventListener("click", clearAllOrders);
ui.symbolFilter.addEventListener("change", refreshFilteredTables);
ui.side.addEventListener("change", refreshFilteredTables);
ui.outcome.addEventListener("change", refreshFilteredTables);
ui.minPnl.addEventListener("input", refreshFilteredTables);
ui.activeSymbolFilter.addEventListener("change", refreshFilteredTables);
ui.sendSignalBtn.addEventListener("click", sendManualSignal);
loadSimulation();
loadWatchlistCharts();
setInterval(loadSimulation, 5000);
setInterval(loadWatchlistCharts, 5000);
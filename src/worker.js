const config = require("./config");
const fs = require("fs");
const path = require("path");
const { runWatchlistSimulation } = require("./engine/watchlistTrader");
const { buildEmptyReport, applyResetToReport } = require("./engine/reportReset");

const LIVE_REPORT_PATH = path.join(__dirname, "data", "live-report.json");
const RESET_STATE_PATH = path.join(__dirname, "data", "reset-state.json");

function saveLiveReport(report) {
  fs.writeFileSync(LIVE_REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
}

function buildChartHistory(report, previousReport) {
  const symbols = report.symbols && report.symbols.length ? report.symbols : [report.symbol];
  const previousHistory = previousReport?.chartHistoryBySymbol || {};
  const lastPriceBySymbol = report.lastPriceBySymbol || {};
  const tickLimit = Math.max(300, Number(config.chartHistoryTicks || 1500));
  const generatedAtMs = new Date(report.generatedAt || Date.now()).getTime();
  const pointTimestamp = Number.isFinite(generatedAtMs) && generatedAtMs > 0 ? generatedAtMs : Date.now();

  const chartHistoryBySymbol = symbols.reduce((acc, symbol) => {
    const baseline = Array.isArray(previousHistory[symbol]) ? [...previousHistory[symbol]] : [];
    const lastKnownPrice = Number(lastPriceBySymbol[symbol]);

    if (Number.isFinite(lastKnownPrice) && lastKnownPrice > 0) {
      baseline.push({
        ts: pointTimestamp,
        price: Number(lastKnownPrice.toFixed(5))
      });
    }

    acc[symbol] = baseline.slice(-tickLimit);
    return acc;
  }, {});

  return {
    ...report,
    chartHistoryBySymbol
  };
}

function readLiveReport() {
  if (!fs.existsSync(LIVE_REPORT_PATH)) return null;

  try {
    return JSON.parse(fs.readFileSync(LIVE_REPORT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function activeTradeTimestamp(trade) {
  const startTs = new Date(trade.startDateTime || 0).getTime();
  if (Number.isFinite(startTs) && startTs > 0) return startTs;

  const openedAt = Number(trade.openedAt || 0);
  if (Number.isFinite(openedAt) && openedAt > 0) return openedAt;

  return 0;
}

function keepSingleActiveTradePerSymbol(trades) {
  const symbolMap = new Map();

  (trades || []).forEach((trade) => {
    const symbol = trade.symbol;
    if (!symbol) return;

    const existing = symbolMap.get(symbol);
    if (!existing) {
      symbolMap.set(symbol, trade);
      return;
    }

    if (activeTradeTimestamp(trade) >= activeTradeTimestamp(existing)) {
      symbolMap.set(symbol, trade);
    }
  });

  return Array.from(symbolMap.values()).sort((left, right) => activeTradeTimestamp(right) - activeTradeTimestamp(left));
}

function normalizeActiveTradesInReport(report, trades) {
  const normalizedTrades = keepSingleActiveTradePerSymbol(trades || []);
  const activeCounts = normalizedTrades.reduce((acc, trade) => {
    acc[trade.symbol] = (acc[trade.symbol] || 0) + 1;
    return acc;
  }, {});

  return {
    ...report,
    activeTrades: normalizedTrades,
    activeTradesCount: normalizedTrades.length,
    symbolReports: (report.symbolReports || []).map((entry) => ({
      ...entry,
      activeTradesCount: activeCounts[entry.symbol] || 0
    }))
  };
}

function mergePersistentActiveTrades(currentReport, previousReport) {
  if (!config.preserveActiveTradesOnRestart) return currentReport;
  if (!previousReport || !Array.isArray(previousReport.activeTrades) || !previousReport.activeTrades.length) {
    return normalizeActiveTradesInReport(currentReport, currentReport.activeTrades || []);
  }

  const tradeKey = (trade) => `${trade.id}|${trade.startDateTime}`;
  const activeMap = new Map();

  previousReport.activeTrades.forEach((trade) => {
    activeMap.set(tradeKey(trade), trade);
  });

  (currentReport.activeTrades || []).forEach((trade) => {
    activeMap.set(tradeKey(trade), trade);
  });

  return normalizeActiveTradesInReport(currentReport, Array.from(activeMap.values()));
}

function readResetState() {
  if (!fs.existsSync(RESET_STATE_PATH)) return null;

  try {
    return JSON.parse(fs.readFileSync(RESET_STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function resetLiveReport(wallet) {
  const resetAt = new Date().toISOString();
  fs.writeFileSync(RESET_STATE_PATH, JSON.stringify({ resetAt }, null, 2), "utf-8");
  const emptyReport = buildEmptyReport({ config, wallet, resetAt });
  saveLiveReport(emptyReport);
  return emptyReport;
}

function runCycle({ candles, wallet }) {
  const previousReport = readLiveReport();

  const result = runWatchlistSimulation({
    config,
    wallet,
    candles,
    symbols: config.safeSymbols
  });

  const resetState = readResetState();
  const filteredReport = resetState?.resetAt ? applyResetToReport(result, resetState.resetAt) : result;
  const finalReport = mergePersistentActiveTrades(filteredReport, previousReport);
  const reportWithCharts = buildChartHistory(finalReport, previousReport);

  saveLiveReport(reportWithCharts);

  console.log(
    `[BOT] ${new Date().toISOString()} | symbols=${reportWithCharts.symbols.join(",")} | wallet=$${wallet.toFixed(2)} | orders=${reportWithCharts.totalOrders} | winRate=${reportWithCharts.winRate}% | netPnl=$${reportWithCharts.netPnl} | ending=$${reportWithCharts.endingBalance}`
  );
}

function startBackgroundBot({ intervalMs, candles, wallet }) {
  console.log("[BOT] Continuous paper bot started");
  console.log(
    `[BOT] Interval: ${intervalMs}ms | Candles: ${candles} | Fixed wallet: $${wallet} | Watchlist: ${config.safeSymbols.join(", ")}`
  );

  runCycle({ candles, wallet });
  const timer = setInterval(() => runCycle({ candles, wallet }), intervalMs);

  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\n[BOT] Stopped by user");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    clearInterval(timer);
    console.log("\n[BOT] Stopped");
    process.exit(0);
  });
}

module.exports = {
  startBackgroundBot,
  resetLiveReport
};
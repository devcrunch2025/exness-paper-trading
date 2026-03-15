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

function readLiveReport() {
  if (!fs.existsSync(LIVE_REPORT_PATH)) return null;

  try {
    return JSON.parse(fs.readFileSync(LIVE_REPORT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function mergePersistentActiveTrades(currentReport, previousReport) {
  if (!config.preserveActiveTradesOnRestart) return currentReport;
  if (!previousReport || !Array.isArray(previousReport.activeTrades) || !previousReport.activeTrades.length) {
    return currentReport;
  }

  const tradeKey = (trade) => `${trade.id}|${trade.startDateTime}`;
  const activeMap = new Map();

  previousReport.activeTrades.forEach((trade) => {
    activeMap.set(tradeKey(trade), trade);
  });

  (currentReport.activeTrades || []).forEach((trade) => {
    activeMap.set(tradeKey(trade), trade);
  });

  const mergedActiveTrades = Array.from(activeMap.values());

  const symbolCounts = mergedActiveTrades.reduce((acc, trade) => {
    acc[trade.symbol] = (acc[trade.symbol] || 0) + 1;
    return acc;
  }, {});

  const mergedSymbolReports = (currentReport.symbolReports || []).map((report) => ({
    ...report,
    activeTradesCount: symbolCounts[report.symbol] || 0
  }));

  return {
    ...currentReport,
    activeTrades: mergedActiveTrades,
    activeTradesCount: mergedActiveTrades.length,
    symbolReports: mergedSymbolReports
  };
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

  saveLiveReport(finalReport);

  console.log(
    `[BOT] ${new Date().toISOString()} | symbols=${finalReport.symbols.join(",")} | wallet=$${wallet.toFixed(2)} | orders=${finalReport.totalOrders} | winRate=${finalReport.winRate}% | netPnl=$${finalReport.netPnl} | ending=$${finalReport.endingBalance}`
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
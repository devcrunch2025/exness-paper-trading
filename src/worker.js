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
  const result = runWatchlistSimulation({
    config,
    wallet,
    candles,
    symbols: config.safeSymbols
  });

  const resetState = readResetState();
  const finalReport = resetState?.resetAt ? applyResetToReport(result, resetState.resetAt) : result;

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
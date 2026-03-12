const config = require("./config");
const { startBackgroundBot } = require("./worker");
const { runWatchlistSimulation } = require("./engine/watchlistTrader");

function parseArg(name, fallback) {
  const flag = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(flag));
  if (!match) return fallback;
  const value = Number(match.split("=")[1]);
  return Number.isFinite(value) ? value : fallback;
}

if (process.argv.includes("--cli")) {
  const candles = parseArg("candles", config.candles);
  const startingBalance = 100;

  const result = runWatchlistSimulation({
    config,
    wallet: startingBalance,
    candles,
    symbols: config.safeSymbols
  });

  console.table(
    result.orders.slice(-10).map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      pnl: o.pnl,
      outcome: o.outcome,
      balanceAfter: o.balanceAfter
    }))
  );

  console.log("Summary:", {
    symbols: result.symbols.join(", "),
    netPnl: result.netPnl,
    winRate: `${result.winRate}%`,
    endingBalance: result.endingBalance,
    totalOrders: result.totalOrders,
    maxDrawdownPct: result.maxDrawdownPct
  });
} else if (process.argv.includes("--bot")) {
  const intervalMs = parseArg("intervalMs", 30000);
  const candles = parseArg("candles", config.candles);
  const wallet = 100;

  startBackgroundBot({
    intervalMs,
    candles,
    wallet
  });
} else {
  require("./server");
}
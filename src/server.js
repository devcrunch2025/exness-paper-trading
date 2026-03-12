const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { runWatchlistSimulation } = require("./engine/watchlistTrader");
const { resetLiveReport } = require("./worker");

const app = express();
const PORT = process.env.PORT || 4000;
const LIVE_REPORT_PATH = path.join(__dirname, "data", "live-report.json");

function parseDateBoundary(dateText, endOfDay) {
  if (!dateText) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const dt = new Date(`${dateText}${suffix}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function matchesOrderFilters(order, filters) {
  if (filters.side !== "ALL" && order.side !== filters.side) return false;
  if (filters.outcome !== "ALL" && order.outcome !== filters.outcome) return false;
  if (filters.minPnl !== null && order.pnl < filters.minPnl) return false;
  if (filters.strategy !== "ALL" && !order.strategies.includes(filters.strategy)) return false;

  const startDt = new Date(order.startDateTime);
  if (filters.fromDate && startDt < filters.fromDate) return false;
  if (filters.toDate && startDt > filters.toDate) return false;

  return true;
}

function matchesActiveFilters(order, filters) {
  if (filters.side !== "ALL" && order.side !== filters.side) return false;
  if (filters.strategy !== "ALL" && !order.strategies.includes(filters.strategy)) return false;

  const startDt = new Date(order.startDateTime);
  if (filters.fromDate && startDt < filters.fromDate) return false;
  if (filters.toDate && startDt > filters.toDate) return false;

  return true;
}

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/report/reset", (req, res) => {
  try {
    const report = resetLiveReport(100);
    return res.json({
      message: "Orders cleared. Bot reset to fresh $100 wallet.",
      report
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to reset live report",
      error: error.message
    });
  }
});

app.get("/api/report", (req, res) => {
  if (!fs.existsSync(LIVE_REPORT_PATH)) {
    return res.status(404).json({
      message: "No live report found. Start the background bot using npm run bot."
    });
  }

  try {
    const report = JSON.parse(fs.readFileSync(LIVE_REPORT_PATH, "utf-8"));
    return res.json(report);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to read live report",
      error: error.message
    });
  }
});

app.get("/api/simulation", (req, res) => {
  const candles = Number(req.query.candles || config.candles);
  const startingBalance = Number(req.query.startingBalance || 100);
  const result = runWatchlistSimulation({
    config,
    wallet: startingBalance,
    candles,
    symbols: config.safeSymbols
  });

  const side = req.query.side || "ALL";
  const minPnl = req.query.minPnl !== undefined ? Number(req.query.minPnl) : null;
  const outcome = req.query.outcome || "ALL";
  const strategy = req.query.strategy || "ALL";
  const fromDate = parseDateBoundary(req.query.fromDate, false);
  const toDate = parseDateBoundary(req.query.toDate, true);

  const filters = {
    side,
    outcome,
    minPnl: Number.isFinite(minPnl) ? minPnl : null,
    strategy,
    fromDate,
    toDate
  };

  const filteredOrders = result.orders.filter((order) => matchesOrderFilters(order, filters));
  const filteredActiveTrades = result.activeTrades.filter((order) => matchesActiveFilters(order, filters));

  res.json({
    ...result,
    filters: {
      side,
      outcome,
      minPnl: filters.minPnl,
      strategy,
      fromDate: req.query.fromDate || null,
      toDate: req.query.toDate || null
    },
    filteredOrders,
    filteredCount: filteredOrders.length,
    filteredActiveTrades,
    filteredActiveTradesCount: filteredActiveTrades.length
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`Paper trading dashboard running at http://localhost:${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. The dashboard server is likely already running.`);
    console.error(`Open http://localhost:${PORT} or stop the existing process before starting a new one.`);
    process.exit(1);
  }

  throw error;
});
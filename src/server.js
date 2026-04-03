const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { runWatchlistSimulation } = require("./engine/watchlistTrader");
const { resetLiveReport } = require("./worker");
const { generateCandles } = require("./data/mockFeed");
const { fromPips } = require("./engine/risk");

const app = express();
const PORT = process.env.PORT || 4000;
const LIVE_REPORT_PATH = path.join(__dirname, "data", "live-report.json");
const DEFAULT_EMA_FAST_PERIOD = 21;
const DEFAULT_EMA_SLOW_PERIOD = 50;
const DEFAULT_EMA_TREND_PERIOD = 200;
const DEFAULT_RSI_LENGTH = 14;
const DEFAULT_RSI_BUY_LEVEL = 55;
const DEFAULT_RSI_SELL_LEVEL = 45;
const DEFAULT_ATR_LENGTH = 14;
const DEFAULT_ATR_MULTIPLIER = 1.5;
const DEFAULT_SIGNAL_LIMIT = 0;

const SYMBOL_START_PRICES = {
  EURUSD: 1.08,
  GBPUSD: 1.27,
  AUDUSD: 0.66,
  USDCHF: 0.89,
  USDJPY: 148.2,
  BTCUSD: 70000
};

function parseDateBoundary(dateText, endOfDay) {
  if (!dateText) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const dt = new Date(`${dateText}${suffix}`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parsePositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getStartPrice(symbol) {
  return SYMBOL_START_PRICES[symbol] || 1.08;
}

function getFallbackEntryPrice(symbol) {
  const candles = generateCandles(config.candles, getStartPrice(symbol), config.timeframe);
  return candles[candles.length - 1].close;
}

function readLiveReportFromDisk() {
  if (!fs.existsSync(LIVE_REPORT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(LIVE_REPORT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function saveLiveReport(report) {
  fs.writeFileSync(LIVE_REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
}

function toLivePoints(history, fallbackTimestamp) {
  return (history || [])
    .map((entry, index) => {
      if (typeof entry === "number") {
        return {
          ts: fallbackTimestamp + index,
          price: entry
        };
      }

      return {
        ts: Number(entry?.ts || 0),
        price: Number(entry?.price)
      };
    })
    .filter((point) => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.ts) && point.ts > 0)
    .sort((left, right) => left.ts - right.ts);
}

function toTickCandleSeries(points, bars) {
  if (!points.length) return [];

  const candles = [];
  let previousClose = null;

  points.forEach((point) => {
    const ts = Number(point.ts);
    const close = Number(point.price);
    if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(close) || close <= 0) return;

    const roundedClose = Number(close.toFixed(5));
    const lastCandle = candles[candles.length - 1];
    if (lastCandle && lastCandle.ts === ts) {
      lastCandle.close = roundedClose;
      lastCandle.high = Number(Math.max(lastCandle.high, roundedClose).toFixed(5));
      lastCandle.low = Number(Math.min(lastCandle.low, roundedClose).toFixed(5));
      previousClose = roundedClose;
      return;
    }

    const open = previousClose === null ? roundedClose : previousClose;
    const high = Number(Math.max(open, roundedClose).toFixed(5));
    const low = Number(Math.min(open, roundedClose).toFixed(5));

    candles.push({
      ts,
      open: Number(open.toFixed(5)),
      high,
      low,
      close: roundedClose
    });

    previousClose = roundedClose;
  });

  return candles.slice(-bars);
}

function buildSyntheticMinuteCandles(count, symbol, endTs) {
  if (count <= 0) return [];

  const safeEndTs = Number.isFinite(endTs) && endTs > 0 ? endTs : Date.now();
  const candles = generateCandles(count, getStartPrice(symbol), "M1");

  return candles.map((candle, index) => ({
    ts: safeEndTs - (count - 1 - index) * 60000,
    open: Number(candle.open.toFixed(5)),
    high: Number(candle.high.toFixed(5)),
    low: Number(candle.low.toFixed(5)),
    close: Number(candle.close.toFixed(5))
  }));
}

function symbolSeed(symbol) {
  return String(symbol || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function applyLiveProjection(candles, symbol, bars) {
  if (!candles.length) return candles;

  const now = Date.now();
  const seed = symbolSeed(symbol);
  const phase = now / 1000 + seed;
  const pulsePct = Math.sin(phase / 11) * 0.00018 + Math.cos(phase / 17) * 0.00008;

  const projected = [...candles];
  const last = projected[projected.length - 1];
  const projectedClose = Math.max(0.0001, last.close * (1 + pulsePct));

  if (now <= last.ts) {
    projected[projected.length - 1] = {
      ...last,
      close: Number(projectedClose.toFixed(5)),
      high: Number(Math.max(last.high, projectedClose).toFixed(5)),
      low: Number(Math.min(last.low, projectedClose).toFixed(5))
    };
  } else {
    projected.push({
      ts: now,
      open: Number(last.close.toFixed(5)),
      high: Number(Math.max(last.close, projectedClose).toFixed(5)),
      low: Number(Math.min(last.close, projectedClose).toFixed(5)),
      close: Number(projectedClose.toFixed(5))
    });
  }

  return projected.slice(-bars);
}

function buildChartCandles({ symbol, bars, history, livePrice, fallbackTimestamp }) {
  const livePoints = toLivePoints(history, fallbackTimestamp);
  let minuteCandles = toTickCandleSeries(livePoints, bars);

  if (!minuteCandles.length) {
    minuteCandles = buildSyntheticMinuteCandles(bars, symbol, fallbackTimestamp);
  } else if (minuteCandles.length < bars) {
    const firstTs = Number(minuteCandles[0]?.ts || fallbackTimestamp);
    const seed = buildSyntheticMinuteCandles(bars - minuteCandles.length, symbol, firstTs - 60000);
    minuteCandles = [...seed, ...minuteCandles];
  }

  const lastLivePrice = Number(livePrice);
  if (Number.isFinite(lastLivePrice) && lastLivePrice > 0 && minuteCandles.length) {
    const last = minuteCandles[minuteCandles.length - 1];
    const close = Number(lastLivePrice.toFixed(5));
    minuteCandles[minuteCandles.length - 1] = {
      ...last,
      close,
      high: Number(Math.max(last.high, close).toFixed(5)),
      low: Number(Math.min(last.low, close).toFixed(5))
    };
  }

  const sliced = minuteCandles.slice(-bars);
  return applyLiveProjection(sliced, symbol, bars);
}

function calculateEmaSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (values.length < period || period <= 0) return result;

  const multiplier = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let previous = seed;

  result[period - 1] = Number(seed.toFixed(5));

  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * multiplier + previous;
    result[index] = Number(previous.toFixed(5));
  }

  return result;
}

function calculateRsiSeries(values, length) {
  const result = Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length <= length || length <= 0) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = Number(values[index]) - Number(values[index - 1]);
    if (!Number.isFinite(change)) return result;
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  let avgGain = gainSum / length;
  let avgLoss = lossSum / length;
  result[length] = Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)).toFixed(4));

  for (let index = length + 1; index < values.length; index += 1) {
    const change = Number(values[index]) - Number(values[index - 1]);
    if (!Number.isFinite(change)) continue;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    result[index] = Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)).toFixed(4));
  }

  return result;
}

function calculateAtrSeries(candles, length) {
  const result = Array(candles.length).fill(null);
  if (!Array.isArray(candles) || candles.length < length || length <= 0) return result;

  const trueRanges = candles.map((candle, index) => {
    const high = Number(candle?.high);
    const low = Number(candle?.low);
    const previousClose = index > 0 ? Number(candles[index - 1]?.close) : Number(candle?.close);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(previousClose)) return null;
    const range = high - low;
    const highClose = Math.abs(high - previousClose);
    const lowClose = Math.abs(low - previousClose);
    return Math.max(range, highClose, lowClose);
  });

  if (trueRanges.slice(0, length).some((value) => !Number.isFinite(value))) return result;
  const seed = trueRanges.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  let previousAtr = seed;
  result[length - 1] = Number(seed.toFixed(5));

  for (let index = length; index < trueRanges.length; index += 1) {
    const tr = Number(trueRanges[index]);
    if (!Number.isFinite(tr)) continue;
    previousAtr = (previousAtr * (length - 1) + tr) / length;
    result[index] = Number(previousAtr.toFixed(5));
  }

  return result;
}

function buildEdgeStrategySignals({
  symbol,
  candles,
  emaFastSeries,
  emaSlowSeries,
  emaTrendSeries,
  rsiSeries,
  atrSeries,
  rsiBuyLevel,
  rsiSellLevel,
  atrMultiplier,
  maxSignals = DEFAULT_SIGNAL_LIMIT
}) {
  if (!Array.isArray(candles) || !candles.length) return [];

  const signals = [];
  const seen = new Set();
  let activePosition = null;
  let activeStop = null;

  const pushSignal = (side, label, ts, price, detail) => {
    const safeTs = Number(ts);
    const safePrice = Number(price);
    if (!Number.isFinite(safeTs) || safeTs <= 0 || !Number.isFinite(safePrice) || safePrice <= 0) return;
    const roundedPrice = Number(safePrice.toFixed(5));
    const key = `${side}|${safeTs}|${roundedPrice}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push({
      id: `EDGE-${symbol}-${side}-${safeTs}-${signals.length}`,
      side,
      label,
      ts: safeTs,
      price: roundedPrice,
      detail
    });
  };

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index] || {};
    const close = Number(candle.close);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const ts = Number(candle.ts);
    const emaFast = Number(emaFastSeries[index]);
    const emaSlow = Number(emaSlowSeries[index]);
    const emaTrend = Number(emaTrendSeries[index]);
    const rsi = Number(rsiSeries[index]);
    const atr = Number(atrSeries[index]);

    if (
      !Number.isFinite(close) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(ts) ||
      !Number.isFinite(emaFast) ||
      !Number.isFinite(emaSlow) ||
      !Number.isFinite(emaTrend) ||
      !Number.isFinite(rsi)
    ) {
      continue;
    }

    const bullTrend = close > emaTrend;
    const bearTrend = close < emaTrend;
    const callBuy = bullTrend && emaFast > emaSlow && rsi > rsiBuyLevel;
    const putBuy = bearTrend && emaFast < emaSlow && rsi < rsiSellLevel;

    if (callBuy) {
      pushSignal("CALL_BUY", "CALL BUY", ts, Number.isFinite(low) ? low : close, "EDGE call condition");
    }
    if (putBuy) {
      pushSignal("PUT_BUY", "PUT BUY", ts, Number.isFinite(high) ? high : close, "EDGE put condition");
    }

    if (activePosition === "LONG") {
      if (Number.isFinite(activeStop) && low <= activeStop) {
        pushSignal("CALL_EXIT", "CALL EXIT", ts, activeStop, "ATR stop loss");
        activePosition = null;
        activeStop = null;
      } else if (putBuy) {
        pushSignal("CALL_EXIT", "CALL EXIT", ts, close, "Opposite signal");
        activePosition = null;
        activeStop = null;
      }
    } else if (activePosition === "SHORT") {
      if (Number.isFinite(activeStop) && high >= activeStop) {
        pushSignal("PUT_EXIT", "PUT EXIT", ts, activeStop, "ATR stop loss");
        activePosition = null;
        activeStop = null;
      } else if (callBuy) {
        pushSignal("PUT_EXIT", "PUT EXIT", ts, close, "Opposite signal");
        activePosition = null;
        activeStop = null;
      }
    }

    if (callBuy) {
      activePosition = "LONG";
      activeStop = Number.isFinite(atr) ? close - atr * atrMultiplier : activeStop;
    } else if (putBuy) {
      activePosition = "SHORT";
      activeStop = Number.isFinite(atr) ? close + atr * atrMultiplier : activeStop;
    }
  }

  const requestedLimit = Number(maxSignals);
  if (Number.isInteger(requestedLimit) && requestedLimit > 0) {
    return signals.slice(-requestedLimit);
  }
  return signals;
}

function getNextManualId(report, symbol) {
  const used = [...(report.orders || []), ...(report.activeTrades || [])]
    .filter((trade) => String(trade.id || "").startsWith(`MANUAL-${symbol}-`))
    .map((trade) => Number(String(trade.id).split("-").pop()))
    .filter((value) => Number.isFinite(value));

  const max = used.length ? Math.max(...used) : 0;
  return `MANUAL-${symbol}-${max + 1}`;
}

function syncSymbolReports(report) {
  const symbols = report.symbols && report.symbols.length ? report.symbols : [report.symbol];
  const activeTrades = report.activeTrades || [];
  const activeCounts = activeTrades.reduce((acc, trade) => {
    const symbol = trade.symbol || report.symbol;
    acc[symbol] = (acc[symbol] || 0) + 1;
    return acc;
  }, {});

  report.symbolReports = symbols.map((symbol) => {
    const existing = (report.symbolReports || []).find((entry) => entry.symbol === symbol) || {};
    return {
      symbol,
      endingBalance: Number(existing.endingBalance || report.capitalPerSymbol || report.startingBalance || 0),
      netPnl: Number(existing.netPnl || 0),
      totalOrders: Number(existing.totalOrders || 0),
      winRate: Number(existing.winRate || 0),
      activeTradesCount: activeCounts[symbol] || 0
    };
  });

  report.activeTradesCount = activeTrades.length;
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
app.use(express.json());

app.post("/api/manual-signal", (req, res) => {
  const signal = String(req.body?.side || "").toUpperCase();
  const symbol = String(req.body?.symbol || "").toUpperCase();
  const requestedPrice = Number(req.body?.price);

  if (!["BUY", "SELL"].includes(signal)) {
    return res.status(400).json({ message: "Invalid side. Use BUY or SELL." });
  }

  if (!config.safeSymbols.includes(symbol)) {
    return res.status(400).json({
      message: `Invalid symbol. Allowed: ${config.safeSymbols.join(", ")}`
    });
  }

  const report = readLiveReportFromDisk();
  if (!report) {
    return res.status(404).json({ message: "No live report found. Start bot with npm run bot first." });
  }

  const filteredActiveTrades = (report.activeTrades || []).filter((trade) => trade.symbol !== symbol);

  const nowIso = new Date().toISOString();
  const spread = fromPips(config.spreadPips + config.slippagePips);
  const market = Number.isFinite(requestedPrice) && requestedPrice > 0 ? requestedPrice : getFallbackEntryPrice(symbol);
  const entry = signal === "BUY" ? market + spread : market - spread;
  const stopLoss =
    signal === "BUY" ? entry - fromPips(config.stopLossPips) : entry + fromPips(config.stopLossPips);
  const takeProfit =
    signal === "BUY"
      ? entry + fromPips(config.stopLossPips * config.takeProfitRMultiple)
      : entry - fromPips(config.stopLossPips * config.takeProfitRMultiple);

  const manualTrade = {
    id: getNextManualId(report, symbol),
    side: signal,
    lot: 0.01,
    openedAt: Date.now(),
    startDateTime: nowIso,
    entry,
    stopLoss,
    takeProfit,
    decision: {
      signal,
      buyScore: signal === "BUY" ? 1 : 0,
      sellScore: signal === "SELL" ? 1 : 0,
      details: [
        {
          strategy: "manualSignal",
          signal,
          confidence: 1,
          weightedScore: 1
        }
      ]
    },
    preTradeContext: {
      mode: "manual",
      signal,
      allowed: true,
      note: "User-entered manual signal"
    },
    strategies: ["manualSignal"],
    currentPrice: Number(market.toFixed(5)),
    triggerType: "OPEN",
    triggeredAtPrice: null,
    floatingPnl: 0,
    symbol
  };

  report.activeTrades = [...filteredActiveTrades, manualTrade];
  report.generatedAt = nowIso;
  syncSymbolReports(report);
  saveLiveReport(report);

  return res.json({
    message: `Manual ${signal} signal added for ${symbol}`,
    trade: manualTrade,
    report
  });
});

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

app.get("/api/watchlist/charts", (req, res) => {
  const bars = Math.max(60, Math.min(5000, Number(req.query.bars || 2880)));
  const requestedFast = parsePositiveInt(req.query.emaFast, DEFAULT_EMA_FAST_PERIOD, { min: 3, max: 120 });
  const requestedSlow = parsePositiveInt(req.query.emaSlow, DEFAULT_EMA_SLOW_PERIOD, { min: 4, max: 180 });
  const requestedTrend = parsePositiveInt(req.query.emaTrend, DEFAULT_EMA_TREND_PERIOD, { min: 20, max: 500 });
  const rsiLength = parsePositiveInt(req.query.rsiLength, DEFAULT_RSI_LENGTH, { min: 2, max: 80 });
  const rsiBuyLevel = parseNumber(req.query.rsiBuy, DEFAULT_RSI_BUY_LEVEL, { min: 1, max: 99 });
  const rsiSellLevel = parseNumber(req.query.rsiSell, DEFAULT_RSI_SELL_LEVEL, { min: 1, max: 99 });
  const atrLength = parsePositiveInt(req.query.atrLength, DEFAULT_ATR_LENGTH, { min: 2, max: 80 });
  const atrMultiplier = parseNumber(req.query.atrMult, DEFAULT_ATR_MULTIPLIER, { min: 0.1, max: 10 });
  const emaFastPeriod = Math.min(requestedFast, requestedSlow - 1);
  const emaSlowPeriod = Math.max(requestedSlow, emaFastPeriod + 1);
  const emaTrendPeriod = Math.max(requestedTrend, emaSlowPeriod + 1);
  const rawSignalLimit = Number(req.query.signalLimit);
  const signalLimit = Number.isInteger(rawSignalLimit) ? Math.max(0, Math.min(4000, rawSignalLimit)) : DEFAULT_SIGNAL_LIMIT;
  const liveReport = readLiveReportFromDisk();
  const symbols =
    liveReport?.symbols && liveReport.symbols.length ? liveReport.symbols : config.safeSymbols || [config.symbol];
  const chartHistoryBySymbol = liveReport?.chartHistoryBySymbol || {};
  const livePriceBySymbol = liveReport?.lastPriceBySymbol || {};
  const fallbackTimestamp = new Date(liveReport?.generatedAt || Date.now()).getTime();

  const charts = symbols.map((symbol) => {
    const history = Array.isArray(chartHistoryBySymbol[symbol]) ? chartHistoryBySymbol[symbol] : [];
    const candles = buildChartCandles({
      symbol,
      bars,
      history,
      livePrice: livePriceBySymbol[symbol],
      fallbackTimestamp
    });
    const points = candles.map((candle) => ({
      ts: candle.ts,
      price: candle.close
    }));
    const closes = candles.map((candle) => candle.close);
    const emaFast = calculateEmaSeries(closes, emaFastPeriod);
    const emaSlow = calculateEmaSeries(closes, emaSlowPeriod);
    const emaTrend = calculateEmaSeries(closes, emaTrendPeriod);
    const rsi = calculateRsiSeries(closes, rsiLength);
    const atr = calculateAtrSeries(candles, atrLength);
    const signalMarkers = buildEdgeStrategySignals({
      symbol,
      candles,
      emaFastSeries: emaFast,
      emaSlowSeries: emaSlow,
      emaTrendSeries: emaTrend,
      rsiSeries: rsi,
      atrSeries: atr,
      rsiBuyLevel,
      rsiSellLevel,
      atrMultiplier,
      maxSignals: signalLimit
    });

    const first = closes[0] || 0;
    const last = closes[closes.length - 1] || 0;
    const changePct = first ? Number((((last - first) / first) * 100).toFixed(3)) : 0;
    const activeTradesCount = (liveReport?.activeTrades || []).filter((trade) => trade.symbol === symbol).length;

    return {
      symbol,
      timeframe: "TICK",
      candleMinutes: 0,
      lastPrice: last,
      changePct,
      candles,
      closes,
      points,
      emaFast,
      emaSlow,
      emaTrend,
      signalMarkers,
      activeTradesCount,
      latestSignal: signalMarkers[signalMarkers.length - 1] || null
    };
  });

  res.json({
    generatedAt: liveReport?.generatedAt || new Date().toISOString(),
    bars,
    emaPeriods: {
      fast: emaFastPeriod,
      slow: emaSlowPeriod,
      trend: emaTrendPeriod
    },
    signalLimit,
    strategy: {
      name: "EDGE ALGO - CALL & PUT Strategy",
      ema: { fast: emaFastPeriod, slow: emaSlowPeriod, trend: emaTrendPeriod },
      rsi: {
        length: rsiLength,
        buyLevel: rsiBuyLevel,
        sellLevel: rsiSellLevel
      },
      atr: {
        length: atrLength,
        multiplier: atrMultiplier
      },
      signals: {
        callBuy: "Bull trend + EMA fast above slow + RSI above buy threshold",
        putBuy: "Bear trend + EMA fast below slow + RSI below sell threshold",
        exits: "ATR stop loss hit or opposite signal"
      }
    },
    charts
  });
});

app.get("/charts", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "charts.html"));
});

app.get("/browser", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "browser.html"));
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

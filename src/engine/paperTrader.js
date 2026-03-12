const { resolveSignal } = require("./strategyManager");
const { fromPips, calculateLotSize, estimatePnL } = require("./risk");

function toDurationText(openTs, closeTs, timeframe) {
  const stepMinutes = timeframe === "H1" ? 60 : timeframe === "H4" ? 240 : timeframe === "D1" ? 1440 : timeframe === "M30" ? 30 : timeframe === "M5" ? 5 : 15;
  const minutes = (closeTs - openTs) * stepMinutes;
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  const days = hours / 24;
  return `${days.toFixed(days % 1 === 0 ? 0 : 1)}d`;
}

function pickStrategies(decision) {
  return decision.details.filter((d) => d.signal !== "HOLD").map((d) => d.strategy);
}

function runPaperSimulation({ candles, config }) {
  let balance = config.startingBalance;
  let equityHigh = balance;
  let maxDrawdownPct = 0;

  const closedOrders = [];
  let openOrder = null;

  for (let i = 60; i < candles.length; i += 1) {
    const history = candles.slice(0, i + 1);
    const candle = history[history.length - 1];

    if (!openOrder) {
      const decision = resolveSignal(history, config.strategyWeights);
      if (decision.signal === "HOLD") continue;

      const lot = calculateLotSize({
        balance,
        riskPerTradePct: config.riskPerTradePct,
        stopLossPips: config.stopLossPips
      });

      const side = decision.signal;
      const spread = fromPips(config.spreadPips + config.slippagePips);
      const entry = side === "BUY" ? candle.close + spread : candle.close - spread;

      openOrder = {
        id: `ORD-${closedOrders.length + 1}`,
        side,
        lot,
        openedAt: candle.timestamp,
        startDateTime: candle.datetime,
        entry,
        stopLoss: side === "BUY" ? entry - fromPips(config.stopLossPips) : entry + fromPips(config.stopLossPips),
        takeProfit:
          side === "BUY"
            ? entry + fromPips(config.stopLossPips * config.takeProfitRMultiple)
            : entry - fromPips(config.stopLossPips * config.takeProfitRMultiple),
        decision,
        strategies: pickStrategies(decision)
      };
      continue;
    }

    const hitTp =
      openOrder.side === "BUY" ? candle.high >= openOrder.takeProfit : candle.low <= openOrder.takeProfit;
    const hitSl =
      openOrder.side === "BUY" ? candle.low <= openOrder.stopLoss : candle.high >= openOrder.stopLoss;

    if (!hitTp && !hitSl) continue;

    const triggerType = hitTp ? "TAKE_PROFIT" : "STOP_LOSS";
    const exitPrice = hitTp ? openOrder.takeProfit : openOrder.stopLoss;
    const pnl = estimatePnL({
      side: openOrder.side,
      entry: openOrder.entry,
      exit: exitPrice,
      lot: openOrder.lot
    });

    balance = Number((balance + pnl).toFixed(2));
    equityHigh = Math.max(equityHigh, balance);
    const dd = ((equityHigh - balance) / equityHigh) * 100;
    maxDrawdownPct = Math.max(maxDrawdownPct, dd);

    closedOrders.push({
      ...openOrder,
      closedAt: candle.timestamp,
      endDateTime: candle.datetime,
      duration: toDurationText(openOrder.openedAt, candle.timestamp, config.timeframe),
      triggerType,
      triggeredAtPrice: Number(exitPrice.toFixed(5)),
      exit: Number(exitPrice.toFixed(5)),
      pnl,
      outcome: pnl >= 0 ? "WIN" : "LOSS",
      balanceAfter: balance
    });

    openOrder = null;
  }

  const wins = closedOrders.filter((o) => o.pnl > 0).length;
  const losses = closedOrders.filter((o) => o.pnl <= 0).length;
  const winRate = closedOrders.length ? (wins / closedOrders.length) * 100 : 0;
  const netPnl = Number((balance - config.startingBalance).toFixed(2));
  const activeTrades = openOrder
    ? [
        {
          ...openOrder,
          currentPrice: Number(candles[candles.length - 1].close.toFixed(5)),
          triggerType: "OPEN",
          triggeredAtPrice: null,
          floatingPnl: estimatePnL({
            side: openOrder.side,
            entry: openOrder.entry,
            exit: candles[candles.length - 1].close,
            lot: openOrder.lot
          })
        }
      ]
    : [];

  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    startingBalance: config.startingBalance,
    endingBalance: balance,
    netPnl,
    winRate: Number(winRate.toFixed(2)),
    wins,
    losses,
    totalOrders: closedOrders.length,
    activeTradesCount: activeTrades.length,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    orders: closedOrders,
    activeTrades,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  runPaperSimulation
};
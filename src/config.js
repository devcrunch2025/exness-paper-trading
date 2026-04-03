module.exports = {
  symbol: "EURUSD",
  safeSymbols: ["EURUSD", "GBPUSD", "AUDUSD", "USDCHF", "USDJPY", "BTCUSD"],
  chartHistoryBars: 120,
  chartHistoryTicks: 4000,
  timeframe: "M1",
  candles: 200,
  startingBalance: 100,
  spreadPips: 1.2,
  slippagePips: 0.5,
  maxOpenPositions: 1,
  preserveActiveTradesOnRestart: true,
  preTradeAnalysisMode: "day_or_week",
  riskPerTradePct: 0.5,
  stopLossPips: 25,
  takeProfitRMultiple: 1.8,
  strategyWeights: {
    smaCross: 0.4,
    rsiReversion: 0.35,
    breakout: 0.25
  }
};

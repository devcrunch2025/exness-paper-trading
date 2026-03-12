module.exports = {
  symbol: "EURUSD",
  safeSymbols: ["EURUSD", "GBPUSD", "AUDUSD", "USDCHF", "USDJPY"],
  timeframe: "M15",
  candles: 500,
  startingBalance: 100,
  spreadPips: 1.2,
  slippagePips: 0.5,
  maxOpenPositions: 1,
  riskPerTradePct: 0.5,
  stopLossPips: 25,
  takeProfitRMultiple: 1.8,
  strategyWeights: {
    smaCross: 0.4,
    rsiReversion: 0.35,
    breakout: 0.25
  }
};
const { rsi } = require("../utils/indicators");

function rsiReversion(candles) {
  const closes = candles.map((c) => c.close);
  const value = rsi(closes, 14);

  if (!value) return { signal: "HOLD", confidence: 0 };
  if (value < 30) return { signal: "BUY", confidence: Math.min(1, (30 - value) / 20) };
  if (value > 70) return { signal: "SELL", confidence: Math.min(1, (value - 70) / 20) };
  return { signal: "HOLD", confidence: 0 };
}

module.exports = rsiReversion;
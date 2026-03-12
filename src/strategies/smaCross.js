const { sma } = require("../utils/indicators");

function smaCross(candles) {
  const closes = candles.map((c) => c.close);
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);

  if (!fast || !slow) return { signal: "HOLD", confidence: 0 };

  const edge = Math.abs((fast - slow) / slow);
  if (fast > slow) return { signal: "BUY", confidence: Math.min(1, edge * 2000) };
  if (fast < slow) return { signal: "SELL", confidence: Math.min(1, edge * 2000) };
  return { signal: "HOLD", confidence: 0 };
}

module.exports = smaCross;
const { highest, lowest } = require("../utils/indicators");

function breakout(candles) {
  if (candles.length < 25) return { signal: "HOLD", confidence: 0 };

  const closes = candles.map((c) => c.close);
  const current = closes[closes.length - 1];
  const recentHigh = highest(closes.slice(0, -1), 20);
  const recentLow = lowest(closes.slice(0, -1), 20);

  if (!recentHigh || !recentLow) return { signal: "HOLD", confidence: 0 };

  if (current > recentHigh) {
    return { signal: "BUY", confidence: Math.min(1, (current - recentHigh) / 0.0015) };
  }

  if (current < recentLow) {
    return { signal: "SELL", confidence: Math.min(1, (recentLow - current) / 0.0015) };
  }

  return { signal: "HOLD", confidence: 0 };
}

module.exports = breakout;
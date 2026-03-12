const smaCross = require("../strategies/smaCross");
const rsiReversion = require("../strategies/rsiReversion");
const breakout = require("../strategies/breakout");

const STRATEGIES = {
  smaCross,
  rsiReversion,
  breakout
};

function resolveSignal(candles, weights) {
  const score = {
    BUY: 0,
    SELL: 0
  };

  const details = [];

  Object.keys(weights).forEach((name) => {
    const strategy = STRATEGIES[name];
    if (!strategy) return;

    const result = strategy(candles);
    const weight = weights[name] || 0;
    const confidence = Number(result.confidence || 0);

    if (result.signal === "BUY") score.BUY += weight * confidence;
    if (result.signal === "SELL") score.SELL += weight * confidence;

    details.push({
      strategy: name,
      signal: result.signal,
      confidence: Number(confidence.toFixed(3)),
      weightedScore: Number((weight * confidence).toFixed(3))
    });
  });

  const threshold = 0.2;
  let finalSignal = "HOLD";

  if (score.BUY > score.SELL && score.BUY >= threshold) finalSignal = "BUY";
  if (score.SELL > score.BUY && score.SELL >= threshold) finalSignal = "SELL";

  return {
    signal: finalSignal,
    buyScore: Number(score.BUY.toFixed(3)),
    sellScore: Number(score.SELL.toFixed(3)),
    details
  };
}

module.exports = {
  resolveSignal
};
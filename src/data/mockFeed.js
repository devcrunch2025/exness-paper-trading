function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function timeframeToMinutes(timeframe) {
  if (timeframe === "M1") return 1;
  if (timeframe === "M5") return 5;
  if (timeframe === "M15") return 15;
  if (timeframe === "M30") return 30;
  if (timeframe === "H1") return 60;
  if (timeframe === "H4") return 240;
  if (timeframe === "D1") return 1440;
  return 15;
}

function generateCandles(count, startPrice = 1.08, timeframe = "M15", options = {}) {
  const candles = [];
  let price = startPrice;
  const stepMinutes = timeframeToMinutes(timeframe);
  const startTime = Date.now() - count * stepMinutes * 60 * 1000;
  const liveSeed = Number(options.seedOffset);
  const seedOffset = Number.isFinite(liveSeed) ? liveSeed : Math.floor(Date.now() / 5000);
  const volatility = Number.isFinite(Number(options.volatility)) ? Number(options.volatility) : 1;

  for (let i = 0; i < count; i += 1) {
    const phase = i + seedOffset;
    // Percent-based movement keeps behavior realistic across low and high priced symbols.
    const driftPct = Math.sin(phase / 50) * 0.00012 * volatility;
    const noisePct = (seededRandom(phase + 1) - 0.5) * 0.0012 * volatility;
    const impulsePct = phase % 120 === 0 ? (seededRandom(phase + 9) - 0.5) * 0.0025 * volatility : 0;

    const open = price;
    const close = Math.max(0.0001, open * (1 + driftPct + noisePct + impulsePct));
    const highWickPct = Math.abs((seededRandom(phase + 2) - 0.5) * 0.0012 * volatility);
    const lowWickPct = Math.abs((seededRandom(phase + 3) - 0.5) * 0.0012 * volatility);
    const high = Math.max(open, close) * (1 + highWickPct);
    const low = Math.max(0.0001, Math.min(open, close) * (1 - lowWickPct));

    candles.push({
      timestamp: i,
      datetime: new Date(startTime + i * stepMinutes * 60 * 1000).toISOString(),
      open,
      high,
      low,
      close
    });

    price = close;
  }

  return candles;
}

module.exports = {
  generateCandles
};

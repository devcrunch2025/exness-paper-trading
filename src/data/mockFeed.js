function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function timeframeToMinutes(timeframe) {
  if (timeframe === "M5") return 5;
  if (timeframe === "M15") return 15;
  if (timeframe === "M30") return 30;
  if (timeframe === "H1") return 60;
  if (timeframe === "H4") return 240;
  if (timeframe === "D1") return 1440;
  return 15;
}

function generateCandles(count, startPrice = 1.08, timeframe = "M15") {
  const candles = [];
  let price = startPrice;
  const stepMinutes = timeframeToMinutes(timeframe);
  const startTime = Date.now() - count * stepMinutes * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const drift = Math.sin(i / 50) * 0.00015;
    const noise = (seededRandom(i + 1) - 0.5) * 0.0015;
    const impulse = i % 120 === 0 ? (seededRandom(i + 9) - 0.5) * 0.003 : 0;

    const open = price;
    const close = Math.max(0.0001, open + drift + noise + impulse);
    const high = Math.max(open, close) + Math.abs((seededRandom(i + 2) - 0.5) * 0.0012);
    const low = Math.min(open, close) - Math.abs((seededRandom(i + 3) - 0.5) * 0.0012);

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
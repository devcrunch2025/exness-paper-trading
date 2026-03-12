function sma(values, period) {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function highest(values, period) {
  if (values.length < period) return null;
  return Math.max(...values.slice(values.length - period));
}

function lowest(values, period) {
  if (values.length < period) return null;
  return Math.min(...values.slice(values.length - period));
}

module.exports = {
  sma,
  rsi,
  highest,
  lowest
};
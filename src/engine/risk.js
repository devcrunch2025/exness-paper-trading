function toPips(priceDelta) {
  return priceDelta / 0.0001;
}

function fromPips(pips) {
  return pips * 0.0001;
}

function calculateLotSize({ balance, riskPerTradePct, stopLossPips }) {
  const riskAmount = balance * (riskPerTradePct / 100);
  const pipValuePerLot = 10;
  const raw = riskAmount / (stopLossPips * pipValuePerLot);
  return Math.max(0.01, Number(raw.toFixed(2)));
}

function estimatePnL({ side, entry, exit, lot }) {
  const priceDiff = side === "BUY" ? exit - entry : entry - exit;
  const pips = toPips(priceDiff);
  const pipValue = lot * 10;
  return Number((pips * pipValue).toFixed(2));
}

module.exports = {
  fromPips,
  calculateLotSize,
  estimatePnL
};
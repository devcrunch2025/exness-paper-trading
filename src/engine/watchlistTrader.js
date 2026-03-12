const { generateCandles } = require("../data/mockFeed");
const { runPaperSimulation } = require("./paperTrader");

const SYMBOL_START_PRICES = {
  EURUSD: 1.08,
  GBPUSD: 1.27,
  AUDUSD: 0.66,
  USDCHF: 0.89,
  USDJPY: 148.2
};

function getStartPrice(symbol) {
  return SYMBOL_START_PRICES[symbol] || 1.08;
}

function toOrderId(symbol, orderId) {
  return `${symbol}-${orderId}`;
}

function runWatchlistSimulation({ config, wallet, candles, symbols }) {
  const safeSymbols = symbols && symbols.length ? symbols : [config.symbol];
  const capitalPerSymbol = Number((wallet / safeSymbols.length).toFixed(2));

  const reports = safeSymbols.map((symbol) => {
    const result = runPaperSimulation({
      candles: generateCandles(candles, getStartPrice(symbol), config.timeframe),
      config: {
        ...config,
        symbol,
        candles,
        startingBalance: capitalPerSymbol
      }
    });

    return {
      ...result,
      orders: result.orders.map((order) => ({
        ...order,
        id: toOrderId(symbol, order.id),
        symbol
      })),
      activeTrades: result.activeTrades.map((trade) => ({
        ...trade,
        id: toOrderId(symbol, trade.id),
        symbol
      }))
    };
  });

  const orders = reports.flatMap((report) => report.orders);
  const activeTrades = reports.flatMap((report) => report.activeTrades);
  const wins = reports.reduce((sum, report) => sum + report.wins, 0);
  const losses = reports.reduce((sum, report) => sum + report.losses, 0);
  const totalOrders = orders.length;
  const endingBalance = Number(reports.reduce((sum, report) => sum + report.endingBalance, 0).toFixed(2));
  const netPnl = Number((endingBalance - wallet).toFixed(2));
  const winRate = totalOrders ? Number(((wins / totalOrders) * 100).toFixed(2)) : 0;
  const maxDrawdownPct = Number(
    Math.max(...reports.map((report) => report.maxDrawdownPct || 0), 0).toFixed(2)
  );

  return {
    symbol: safeSymbols[0],
    symbols: safeSymbols,
    timeframe: config.timeframe,
    startingBalance: wallet,
    capitalPerSymbol,
    endingBalance,
    netPnl,
    winRate,
    wins,
    losses,
    totalOrders,
    activeTradesCount: activeTrades.length,
    maxDrawdownPct,
    orders,
    activeTrades,
    symbolReports: reports.map((report) => ({
      symbol: report.symbol,
      endingBalance: report.endingBalance,
      netPnl: report.netPnl,
      totalOrders: report.totalOrders,
      winRate: report.winRate,
      activeTradesCount: report.activeTradesCount
    })),
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  runWatchlistSimulation
};
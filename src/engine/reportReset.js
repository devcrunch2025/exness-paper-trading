function buildEmptyReport({ config, wallet, resetAt }) {
  const symbols = config.safeSymbols && config.safeSymbols.length ? config.safeSymbols : [config.symbol];
  const capitalPerSymbol = Number((wallet / symbols.length).toFixed(2));

  return {
    symbol: symbols[0],
    symbols,
    timeframe: config.timeframe,
    startingBalance: wallet,
    capitalPerSymbol,
    endingBalance: wallet,
    netPnl: 0,
    winRate: 0,
    wins: 0,
    losses: 0,
    totalOrders: 0,
    activeTradesCount: 0,
    maxDrawdownPct: 0,
    orders: [],
    activeTrades: [],
    symbolReports: symbols.map((symbol) => ({
      symbol,
      endingBalance: capitalPerSymbol,
      netPnl: 0,
      totalOrders: 0,
      winRate: 0,
      activeTradesCount: 0
    })),
    resetAt,
    generatedAt: new Date().toISOString()
  };
}

function applyResetToReport(report, resetAt) {
  if (!resetAt) return report;

  const resetTime = new Date(resetAt).getTime();
  if (Number.isNaN(resetTime)) return report;

  const symbols = report.symbols && report.symbols.length ? report.symbols : [report.symbol];
  const capitalPerSymbol = Number((report.startingBalance / symbols.length).toFixed(2));

  const orders = (report.orders || [])
    .filter((order) => new Date(order.startDateTime).getTime() >= resetTime)
    .sort((left, right) => new Date(left.endDateTime || left.startDateTime).getTime() - new Date(right.endDateTime || right.startDateTime).getTime());

  const activeTrades = (report.activeTrades || [])
    .filter((trade) => new Date(trade.startDateTime).getTime() >= resetTime)
    .sort((left, right) => new Date(left.startDateTime).getTime() - new Date(right.startDateTime).getTime());

  const symbolState = new Map(
    symbols.map((symbol) => [symbol, { balance: capitalPerSymbol, equityHigh: capitalPerSymbol, wins: 0, losses: 0, totalOrders: 0, activeTradesCount: 0, maxDrawdownPct: 0 }])
  );

  const normalizedOrders = orders.map((order) => {
    const state = symbolState.get(order.symbol) || symbolState.get(symbols[0]);
    state.balance = Number((state.balance + Number(order.pnl || 0)).toFixed(2));
    state.totalOrders += 1;
    if (Number(order.pnl || 0) > 0) state.wins += 1;
    else state.losses += 1;
    state.equityHigh = Math.max(state.equityHigh, state.balance);
    const drawdownPct = state.equityHigh ? ((state.equityHigh - state.balance) / state.equityHigh) * 100 : 0;
    state.maxDrawdownPct = Math.max(state.maxDrawdownPct, drawdownPct);

    return {
      ...order,
      balanceAfter: state.balance
    };
  });

  activeTrades.forEach((trade) => {
    const state = symbolState.get(trade.symbol) || symbolState.get(symbols[0]);
    state.activeTradesCount += 1;
  });

  const wins = [...symbolState.values()].reduce((sum, state) => sum + state.wins, 0);
  const losses = [...symbolState.values()].reduce((sum, state) => sum + state.losses, 0);
  const totalOrders = normalizedOrders.length;
  const endingBalance = Number([...symbolState.values()].reduce((sum, state) => sum + state.balance, 0).toFixed(2));
  const netPnl = Number((endingBalance - report.startingBalance).toFixed(2));
  const winRate = totalOrders ? Number(((wins / totalOrders) * 100).toFixed(2)) : 0;
  const maxDrawdownPct = Number(Math.max(...[...symbolState.values()].map((state) => state.maxDrawdownPct), 0).toFixed(2));

  return {
    ...report,
    capitalPerSymbol,
    endingBalance,
    netPnl,
    winRate,
    wins,
    losses,
    totalOrders,
    activeTradesCount: activeTrades.length,
    maxDrawdownPct,
    orders: normalizedOrders,
    activeTrades,
    symbolReports: symbols.map((symbol) => {
      const state = symbolState.get(symbol);
      const symbolNetPnl = Number((state.balance - capitalPerSymbol).toFixed(2));
      const symbolWinRate = state.totalOrders ? Number(((state.wins / state.totalOrders) * 100).toFixed(2)) : 0;

      return {
        symbol,
        endingBalance: state.balance,
        netPnl: symbolNetPnl,
        totalOrders: state.totalOrders,
        winRate: symbolWinRate,
        activeTradesCount: state.activeTradesCount
      };
    }),
    resetAt
  };
}

module.exports = {
  buildEmptyReport,
  applyResetToReport
};
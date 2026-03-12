# exness-paper-trading

Node.js paper trading bot with multiple strategies, risk-managed position sizing, and a colorful dashboard for order-level P/L analysis.

## Features

- Multi-strategy decision engine: SMA Cross, RSI Reversion, Breakout
- Paper execution with stop-loss / take-profit and lot size control
- Dashboard with:
	- Net P/L, win rate, drawdown, total orders
	- Orders table with BUY/SELL and WIN/LOSS badges
	- Filters for side, outcome, minimum P/L, candles, and starting balance
- CLI simulation mode for quick terminal backtests
- Continuous background bot mode with fixed $100 wallet
- Live dashboard report fed by background bot output

## Install

```bash
npm install
```

## Run Dashboard

```bash
npm start
```

Open http://localhost:4000

## Run CLI Simulation

```bash
npm run simulate
```

Longer run example:

```bash
npm run simulate:long
```

## Run Continuous Bot In Background

```bash
npm run bot
```

Fast loop (10s interval):

```bash
npm run bot:fast
```

Notes:

- Bot runs continuously until stopped.
- Wallet is fixed at $100 for every cycle.
- Default interval is 30 seconds.

## API Endpoint

`GET /api/simulation`

`GET /api/report` (recommended for dashboard; reads background bot output)

Supported query params:

- `candles` (number)
- `startingBalance` (number)
- `side` (`ALL`, `BUY`, `SELL`)
- `outcome` (`ALL`, `WIN`, `LOSS`)
- `minPnl` (number)

Example:

```text
/api/simulation?candles=500&startingBalance=100&side=BUY&outcome=WIN&minPnl=1
```

Live report example:

```text
/api/report
```
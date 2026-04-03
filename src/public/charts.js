const ui = {
  chartGrid: document.getElementById("chartGrid")
};

const WATCHLIST_STORAGE_KEY = "watchlistSymbols";
const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
const LIGHTWEIGHT_SCRIPT_SOURCES = [
  "/vendor/lightweight-charts.standalone.production.js",
  "https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js",
  "https://cdn.jsdelivr.net/npm/lightweight-charts/dist/lightweight-charts.standalone.production.js",
  "https://unpkg.com/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js",
  "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.2/dist/lightweight-charts.standalone.production.js"
];

const BAR_INTERVAL = "1m";
const BAR_LIMIT = 300;
const LIVE_STALE_MS = 90000;
const EDGE = Object.freeze({
  emaFast: 21,
  emaSlow: 50,
  emaTrend: 200,
  rsiLength: 14,
  rsiBuy: 55,
  rsiSell: 45,
  spikeMultiplier: 2.1,
  spikeLookback: 18,
  spikeSearchBars: 8,
  minExitScore: 6,
  minStrongScore: 7
});

const chartStates = new Map();
let ws = null;
let lightweightLoadPromise = null;

function injectSplitStyles() {
  if (document.getElementById("trendSplitStyles")) return;
  const style = document.createElement("style");
  style.id = "trendSplitStyles";
  style.textContent = `
    .trend-split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      width: 100%;
    }

    .trend-column {
      display: grid;
      gap: 12px;
      align-content: start;
    }

    .trend-column-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(35, 38, 45, 0.08);
      font-weight: 600;
    }

    .trend-column-grid {
      display: grid;
      gap: 12px;
      align-content: start;
    }

    @media (max-width: 1080px) {
      .trend-split {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function hasLightweightCharts() {
  return Boolean(window.LightweightCharts && typeof window.LightweightCharts.createChart === "function");
}

function loadScriptFromSource(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (hasLightweightCharts()) {
        resolve(src);
        return;
      }
      setTimeout(() => {
        if (hasLightweightCharts()) {
          resolve(src);
          return;
        }
        reject(new Error("library loaded but API unavailable"));
      }, 80);
    };
    script.onerror = () => reject(new Error("network load failed"));
    document.head.appendChild(script);
  });
}

async function ensureLightweightCharts() {
  if (hasLightweightCharts()) return;
  if (lightweightLoadPromise) {
    await lightweightLoadPromise;
    return;
  }

  lightweightLoadPromise = (async () => {
    const failures = [];
    for (const src of LIGHTWEIGHT_SCRIPT_SOURCES) {
      try {
        await loadScriptFromSource(src);
        if (hasLightweightCharts()) return;
        failures.push(`${src} (missing API)`);
      } catch (error) {
        failures.push(`${src} (${error?.message || "failed"})`);
      }
    }
    throw new Error(`Failed to load Lightweight Charts: ${failures.join(" | ")}`);
  })();

  try {
    await lightweightLoadPromise;
  } finally {
    if (!hasLightweightCharts()) {
      lightweightLoadPromise = null;
    }
  }
}

function toEpochSeconds(value) {
  return Math.floor(Number(value) / 1000);
}

function fmtPrice(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function readWatchlist() {
  const raw = window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
  if (!raw) return [...DEFAULT_WATCHLIST];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item) => /^[A-Z0-9]{5,20}$/.test(item));
    }
  } catch {
    // Continue with CSV fallback
  }

  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z0-9]{5,20}$/.test(item));
}

function calculateEmaSeries(values, period) {
  const result = Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length < period || period <= 0) return result;

  const multiplier = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  let previous = seed;

  result[period - 1] = Number(seed.toFixed(5));
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * multiplier + previous;
    result[index] = Number(previous.toFixed(5));
  }

  return result;
}

function calculateRsiSeries(values, length) {
  const result = Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length <= length || length <= 0) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = Number(values[index]) - Number(values[index - 1]);
    if (!Number.isFinite(change)) return result;
    if (change >= 0) gainSum += change;
    else lossSum += Math.abs(change);
  }

  let avgGain = gainSum / length;
  let avgLoss = lossSum / length;
  result[length] = Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)).toFixed(4));

  for (let index = length + 1; index < values.length; index += 1) {
    const change = Number(values[index]) - Number(values[index - 1]);
    if (!Number.isFinite(change)) continue;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    result[index] = Number((avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)).toFixed(4));
  }

  return result;
}

function detectSpikeContextAt(candles, index) {
  for (let offset = 0; offset <= EDGE.spikeSearchBars; offset += 1) {
    const barIndex = index - offset;
    if (barIndex < 0) continue;
    if (barIndex + EDGE.spikeLookback >= candles.length) continue;

    let avgRange = 0;
    for (let look = barIndex + 1; look <= barIndex + EDGE.spikeLookback; look += 1) {
      const high = Number(candles[look]?.high);
      const low = Number(candles[look]?.low);
      if (!Number.isFinite(high) || !Number.isFinite(low)) {
        avgRange = 0;
        break;
      }
      avgRange += Math.abs(high - low);
    }

    avgRange /= EDGE.spikeLookback;
    if (!Number.isFinite(avgRange) || avgRange <= 0) continue;

    const bar = candles[barIndex];
    const open = Number(bar?.open);
    const close = Number(bar?.close);
    const high = Number(bar?.high);
    const low = Number(bar?.low);
    if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) continue;

    const candleRange = high - low;
    if (candleRange < avgRange * EDGE.spikeMultiplier) continue;

    const body = Math.abs(open - close);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;
    let isUp = upperWick > body * 1.5;
    if (!isUp && !(lowerWick > body * 1.5)) isUp = close <= open;
    return isUp ? "AFTER_SPIKE_UP" : "AFTER_SPIKE_DOWN";
  }

  return "NO_SPIKE";
}

function buildMarkers(candles, emaFast, emaSlow, emaTrend, rsiValues) {
  const markers = [];
  let latestExitMarker = null;
  let latestExitTime = -1;
  let buySeqCount = 0;
  let sellSeqCount = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const close = Number(candle.close);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const emaFastValue = Number(emaFast[index]);
    const emaSlowValue = Number(emaSlow[index]);
    const emaTrendValue = Number(emaTrend[index]);
    const rsiValue = Number(rsiValues[index]);

    if (
      !Number.isFinite(close) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(emaFastValue) ||
      !Number.isFinite(emaSlowValue) ||
      !Number.isFinite(emaTrendValue) ||
      !Number.isFinite(rsiValue)
    ) {
      continue;
    }

    const bullTrend = close > emaTrendValue;
    const bearTrend = close < emaTrendValue;
    const emaBull = emaFastValue > emaSlowValue;
    const emaBear = emaFastValue < emaSlowValue;
    const rsiBull = rsiValue > EDGE.rsiBuy;
    const rsiBear = rsiValue < EDGE.rsiSell;

    const priceAboveEmaStack = close > emaFastValue && close > emaSlowValue;
    const priceBelowEmaStack = close < emaFastValue && close < emaSlowValue;
    const preBuy = emaBull && priceAboveEmaStack;
    const preSell = emaBear && priceBelowEmaStack;

    if (preBuy) {
      buySeqCount += 1;
      sellSeqCount = 0;
    } else if (preSell) {
      sellSeqCount += 1;
      buySeqCount = 0;
    } else {
      buySeqCount = 0;
      sellSeqCount = 0;
    }

    const trendBiasBuy = bullTrend || emaBull;
    const trendBiasSell = bearTrend || emaBear;

    const spikeContext = detectSpikeContextAt(candles, index);
    const buySpikeBonus = spikeContext === "AFTER_SPIKE_DOWN" ? 1 : spikeContext === "AFTER_SPIKE_UP" ? -1 : 0;
    const sellSpikeBonus = spikeContext === "AFTER_SPIKE_UP" ? 1 : spikeContext === "AFTER_SPIKE_DOWN" ? -1 : 0;
    const buySeqBonus = buySeqCount === 2 ? 1 : buySeqCount >= 3 ? -1 : 0;
    const sellSeqBonus = sellSeqCount === 2 ? 1 : sellSeqCount >= 3 ? -1 : 0;

    const buyScore = (bullTrend ? 2 : 0) + (emaBull ? 2 : 0) + (rsiBull ? 2 : 0) + buySpikeBonus + buySeqBonus;
    const sellScore = (bearTrend ? 2 : 0) + (emaBear ? 2 : 0) + (rsiBear ? 2 : 0) + sellSpikeBonus + sellSeqBonus;

    const buy = preBuy && trendBiasBuy && rsiBull && buyScore >= EDGE.minExitScore;
    const sell = preSell && trendBiasSell && rsiBear && sellScore >= EDGE.minExitScore;
    const strongBuy = buy && buyScore >= EDGE.minStrongScore && close > emaFastValue && low > emaSlowValue;
    const strongSell = sell && sellScore >= EDGE.minStrongScore && close < emaFastValue && high < emaSlowValue;

    if (preBuy) {
      markers.push({ time: candle.time, position: "aboveBar", color: "#0f9d58", shape: "circle", text: "BUY" });
    }
    if (preSell) {
      markers.push({ time: candle.time, position: "belowBar", color: "#c62828", shape: "circle", text: "SELL" });
    }

    if (buy) {
      latestExitMarker = { time: candle.time, position: "belowBar", color: "#fb8c00", shape: "arrowUp", text: "BUY EXIT" };
      latestExitTime = candle.time;
    }
    if (sell) {
      latestExitMarker = { time: candle.time, position: "aboveBar", color: "#fb8c00", shape: "arrowDown", text: "SELL EXIT" };
      latestExitTime = candle.time;
    }

    if (strongBuy) {
      markers.push({ time: candle.time, position: "belowBar", color: "#065f46", shape: "arrowUp", text: "STRONG" });
    }
    if (strongSell) {
      markers.push({ time: candle.time, position: "aboveBar", color: "#7f1d1d", shape: "arrowDown", text: "STRONG" });
    }
  }

  if (latestExitMarker && latestExitTime > 0) {
    markers.push(latestExitMarker);
  }

  return markers;
}

function addSeriesCompat(chart, seriesType, options) {
  if (seriesType === "candlestick" && typeof chart.addCandlestickSeries === "function") {
    return chart.addCandlestickSeries(options);
  }
  if (seriesType === "line" && typeof chart.addLineSeries === "function") {
    return chart.addLineSeries(options);
  }
  if (typeof chart.addSeries === "function") {
    const map = {
      candlestick: LightweightCharts.CandlestickSeries,
      line: LightweightCharts.LineSeries
    };
    if (map[seriesType]) {
      return chart.addSeries(map[seriesType], options);
    }
  }
  throw new Error(`Unsupported series type: ${seriesType}`);
}

function applyMarkersCompat(state, markers) {
  if (typeof state.candleSeries.setMarkers === "function") {
    state.candleSeries.setMarkers(markers);
    return;
  }

  if (typeof LightweightCharts.createSeriesMarkers === "function") {
    if (!state.markerLayer) {
      state.markerLayer = LightweightCharts.createSeriesMarkers(state.candleSeries, markers);
      return;
    }
    if (typeof state.markerLayer.setMarkers === "function") {
      state.markerLayer.setMarkers(markers);
      return;
    }
    state.markerLayer = LightweightCharts.createSeriesMarkers(state.candleSeries, markers);
  }
}

function buildCardHtml(symbol) {
  return `
      <article class="panel grid-tv-card" id="card-${symbol}">
        <header class="chart-popup-header">
          <div>
            <h2>${symbol}</h2>
            <p class="chart-popup-meta" id="meta-${symbol}">Loading Binance 1m history...</p>
          </div>
          <div class="chart-popup-actions">
            <span class="chart-popup-status" id="price-${symbol}">-</span>
          </div>
        </header>
        <div class="popup-tv-host" id="host-${symbol}"></div>
      </article>
    `;
}

function updateTrendCounts() {
  const upGrid = document.getElementById("upTrendGrid");
  const downGrid = document.getElementById("downTrendGrid");
  const upCountNode = document.getElementById("upTrendCount");
  const downCountNode = document.getElementById("downTrendCount");
  if (upCountNode) upCountNode.textContent = String(upGrid ? upGrid.children.length : 0);
  if (downCountNode) downCountNode.textContent = String(downGrid ? downGrid.children.length : 0);
}

function placeCardByTrend(state) {
  const card = document.getElementById(`card-${state.symbol}`);
  if (!card) return;
  const target = document.getElementById(state.trendDirection === "down" ? "downTrendGrid" : "upTrendGrid");
  if (!target) return;
  if (card.parentElement !== target) {
    target.appendChild(card);
  }
  updateTrendCounts();
}

function renderGridShell(symbols) {
  ui.chartGrid.innerHTML = `
    <section class="trend-split" aria-label="Trend split watchlist">
      <article class="trend-column">
        <header class="trend-column-head">
          <span>Up Direction Trend</span>
          <span id="upTrendCount">0</span>
        </header>
        <div id="upTrendGrid" class="trend-column-grid"></div>
      </article>
      <article class="trend-column">
        <header class="trend-column-head">
          <span>Down Direction Trend</span>
          <span id="downTrendCount">0</span>
        </header>
        <div id="downTrendGrid" class="trend-column-grid"></div>
      </article>
    </section>
  `;

  const upGrid = document.getElementById("upTrendGrid");
  if (!upGrid) return;

  symbols.forEach((symbol) => {
    upGrid.insertAdjacentHTML("beforeend", buildCardHtml(symbol));
  });

  updateTrendCounts();
}

function setCardMeta(symbol, text) {
  const node = document.getElementById(`meta-${symbol}`);
  if (node) node.textContent = text;
}

function getSymbolLiveTone(symbol) {
  const state = chartStates.get(symbol);
  if (!state) return "idle";
  if (!Number.isFinite(state.lastStreamAt) || state.lastStreamAt <= 0) return "idle";
  return Date.now() - state.lastStreamAt <= LIVE_STALE_MS ? "live" : "offline";
}

function setCardPrice(symbol, price) {
  const node = document.getElementById(`price-${symbol}`);
  if (!node) return;
  const tone = getSymbolLiveTone(symbol);
  node.innerHTML = `<span class="live-dot ${tone}" aria-hidden="true"></span><span>${fmtPrice(price)}</span>`;
}

function createChartState(symbol) {
  const host = document.getElementById(`host-${symbol}`);
  if (!host) return null;

  const chart = LightweightCharts.createChart(host, {
    width: Math.max(320, host.clientWidth),
    height: 340,
    layout: {
      background: { color: "#fffdf8" },
      textColor: "#334155",
      fontFamily: "Segoe UI, Tahoma, sans-serif"
    },
    grid: {
      vertLines: { color: "rgba(148, 163, 184, 0.22)" },
      horzLines: { color: "rgba(148, 163, 184, 0.22)" }
    },
    rightPriceScale: {
      borderColor: "rgba(100, 116, 139, 0.32)"
    },
    timeScale: {
      borderColor: "rgba(100, 116, 139, 0.32)",
      timeVisible: true,
      secondsVisible: false
    }
  });

  const candleSeries = addSeriesCompat(chart, "candlestick", {
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderUpColor: "#26a69a",
    borderDownColor: "#ef5350",
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350"
  });

  const emaFastSeries = addSeriesCompat(chart, "line", {
    color: "#1d4ed8",
    lineWidth: 2,
    title: "",
    lastValueVisible: false,
    priceLineVisible: false
  });

  const emaSlowSeries = addSeriesCompat(chart, "line", {
    color: "#7c3aed",
    lineWidth: 2,
    title: "",
    lastValueVisible: false,
    priceLineVisible: false
  });

  const emaTrendSeries = addSeriesCompat(chart, "line", {
    color: "#111827",
    lineWidth: 2,
    title: "",
    lastValueVisible: false,
    priceLineVisible: false
  });

  const state = {
    symbol,
    chart,
    candleSeries,
    emaFastSeries,
    emaSlowSeries,
    emaTrendSeries,
    markerLayer: null,
    candles: [],
    lastStreamAt: 0
  };

  const resize = () => {
    chart.applyOptions({ width: Math.max(320, host.clientWidth), height: 340 });
  };

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    state.resizeObserver = observer;
  } else {
    window.addEventListener("resize", resize);
  }

  return state;
}

function redrawSymbol(state) {
  const closes = state.candles.map((candle) => candle.close);
  const emaFast = calculateEmaSeries(closes, EDGE.emaFast);
  const emaSlow = calculateEmaSeries(closes, EDGE.emaSlow);
  const emaTrend = calculateEmaSeries(closes, EDGE.emaTrend);
  const rsiValues = calculateRsiSeries(closes, EDGE.rsiLength);

  state.candleSeries.setData(state.candles);
  state.emaFastSeries.setData(
    state.candles.map((candle, index) => ({ time: candle.time, value: emaFast[index] })).filter((point) => Number.isFinite(point.value))
  );
  state.emaSlowSeries.setData(
    state.candles.map((candle, index) => ({ time: candle.time, value: emaSlow[index] })).filter((point) => Number.isFinite(point.value))
  );
  state.emaTrendSeries.setData(
    state.candles.map((candle, index) => ({ time: candle.time, value: emaTrend[index] })).filter((point) => Number.isFinite(point.value))
  );

  const lastIndex = state.candles.length - 1;
  const close = Number(state.candles[lastIndex]?.close);
  const fast = Number(emaFast[lastIndex]);
  const slow = Number(emaSlow[lastIndex]);
  const trend = Number(emaTrend[lastIndex]);

  if (Number.isFinite(close) && Number.isFinite(fast) && Number.isFinite(slow) && Number.isFinite(trend)) {
    const strictUp = close >= fast && fast >= slow && close >= trend;
    const strictDown = close <= fast && fast <= slow && close <= trend;
    state.trendDirection = strictUp ? "up" : strictDown ? "down" : fast >= slow ? "up" : "down";
  }

  applyMarkersCompat(state, buildMarkers(state.candles, emaFast, emaSlow, emaTrend, rsiValues));
  setCardPrice(state.symbol, state.candles[state.candles.length - 1]?.close);
  placeCardByTrend(state);
}

async function loadHistory(symbol) {
  const response = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${BAR_INTERVAL}&limit=${BAR_LIMIT}`
  );
  if (!response.ok) throw new Error(`History failed (${response.status})`);
  const payload = await response.json();

  return payload
    .map((entry) => ({
      time: toEpochSeconds(entry[0]),
      open: Number(entry[1]),
      high: Number(entry[2]),
      low: Number(entry[3]),
      close: Number(entry[4])
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    );
}

function connectCombinedKlineStream(symbols) {
  if (ws) {
    try {
      ws.close();
    } catch {}
  }

  const streamPath = symbols.map((symbol) => `${symbol.toLowerCase()}@kline_${BAR_INTERVAL}`).join("/");
  ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamPath}`);

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const stream = String(message?.stream || "");
    const data = message?.data;
    const k = data?.k;
    if (!k) return;

    const symbol = String(k.s || stream.split("@")[0] || "").toUpperCase();
    const state = chartStates.get(symbol);
    if (!state) return;

    const candle = {
      time: toEpochSeconds(k.t),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c)
    };

    if (
      !Number.isFinite(candle.time) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      return;
    }

    if (!state.candles.length) {
      state.candles = [candle];
    } else {
      const lastIndex = state.candles.length - 1;
      const prev = state.candles[lastIndex];
      if (prev.time === candle.time) {
        state.candles[lastIndex] = candle;
      } else if (candle.time > prev.time) {
        state.candles.push(candle);
        state.candles = state.candles.slice(-BAR_LIMIT);
      }
    }

    state.lastStreamAt = Date.now();

    redrawSymbol(state);
  };

  ws.onerror = () => {
    chartStates.forEach((state) => {
      state.lastStreamAt = 0;
      setCardPrice(state.symbol, state.candles[state.candles.length - 1]?.close);
    });
    symbols.forEach((symbol) => setCardMeta(symbol, "WebSocket error. Retrying..."));
  };

  ws.onclose = () => {
    chartStates.forEach((state) => {
      state.lastStreamAt = 0;
      setCardPrice(state.symbol, state.candles[state.candles.length - 1]?.close);
    });
    setTimeout(() => connectCombinedKlineStream(symbols), 2000);
  };
}

function refreshLiveBadges() {
  chartStates.forEach((state) => {
    setCardPrice(state.symbol, state.candles[state.candles.length - 1]?.close);
  });
}

async function boot() {
  injectSplitStyles();

  try {
    await ensureLightweightCharts();
  } catch (error) {
    ui.chartGrid.innerHTML = `<article class="panel empty-panel">${String(error?.message || "Failed to load chart library")}</article>`;
    return;
  }

  const symbols = readWatchlist();
  if (!symbols.length) {
    ui.chartGrid.innerHTML = '<article class="panel empty-panel">No watchlist symbols found. Add JSON array to localStorage key "watchlistSymbols".</article>';
    return;
  }

  renderGridShell(symbols);

  for (const symbol of symbols) {
    const state = createChartState(symbol);
    if (!state) continue;
    chartStates.set(symbol, state);

    try {
      setCardMeta(symbol, "Loading Binance history...");
      state.candles = await loadHistory(symbol);
      redrawSymbol(state);
      state.chart.timeScale().setVisibleRange({
        from: state.candles[state.candles.length - 1].time - 2 * 60 * 60,
        to: state.candles[state.candles.length - 1].time
      });
      setCardMeta(symbol, "Live 1m Binance feed");
    } catch (error) {
      setCardMeta(symbol, String(error?.message || "Failed to load chart"));
    }
  }

  connectCombinedKlineStream(symbols);
  setInterval(refreshLiveBadges, 10000);
}

boot();

/**
 * Backtests the bullish/bearish screening rule against real historical
 * prices, so the rule is evidence-based rather than just a plausible-looking
 * heuristic.
 *
 * Historical daily OHLCV comes from Yahoo Finance's free, keyless chart API
 * (NSE symbols use a ".NS" suffix, BSE uses ".BO"). RSI/EMA are computed
 * locally with standard formulas — Yahoo doesn't provide indicator values,
 * only raw price/volume.
 */

function ymdSuffix(exchange) {
  return exchange === "BSE" ? ".BO" : ".NS";
}

export async function fetchYahooHistory(symbol, exchange, range = "2y") {
  const yahooSymbol = `${symbol}${ymdSuffix(exchange)}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol
  )}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance request failed for ${yahooSymbol}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No historical data for ${yahooSymbol}`);
  const timestamps = result.timestamp || [];
  const quote = result.indicators.quote[0];
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue;
    candles.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i],
    });
  }
  return candles;
}

/** Standard Wilder RSI, returned as an array aligned with `closes` (leading nulls before enough data). */
export function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length <= period) return rsi;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

/** Standard EMA, returned as an array aligned with `closes` (leading nulls before enough data). */
export function computeEMA(closes, period) {
  const ema = new Array(closes.length).fill(null);
  if (closes.length < period) return ema;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i];
  sma /= period;
  ema[period - 1] = sma;
  for (let i = period; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function relativeVolume(volumes, i, window = 10) {
  if (i < window) return null;
  let sum = 0;
  for (let j = i - window; j < i; j++) sum += volumes[j];
  const avg = sum / window;
  return avg === 0 ? null : volumes[i] / avg;
}

/** Wilder ATR (Average True Range) — used to size a realistic stop-loss, same as the live Plan Trade calculator would. */
function computeATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(null);
  const trueRanges = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    return Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close));
  });
  if (candles.length <= period) return atr;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

/**
 * Walks forward from a signal day, bar by bar, checking whether the
 * ATR-based stop-loss or reward:risk target is hit first — instead of
 * blindly measuring "price N days later" regardless of what happened in
 * between. Mirrors the actual rule (stop below entry, min 2:1 target) that
 * the Plan Trade calculator and the equivalent Pine Script strategy use, so
 * the backtest reflects what a disciplined trader following the rule would
 * have actually experienced, not just where price coincidentally landed.
 */
function simulateTrade(candles, i, atr, { atrMult = 1.5, rrRatio = 2, maxHoldDays = 20 } = {}) {
  const entry = candles[i].close;
  const stop = entry - atr[i] * atrMult;
  const riskPerShare = entry - stop;
  if (riskPerShare <= 0) return null;
  const target = entry + riskPerShare * rrRatio;

  for (let j = i + 1; j < Math.min(i + 1 + maxHoldDays, candles.length); j++) {
    const bar = candles[j];
    const hitStop = bar.low <= stop;
    const hitTarget = bar.high >= target;
    if (hitStop && hitTarget) {
      // Ambiguous same-bar outcome (can't tell which came first from daily bars) — assume the worse case.
      return { exitPrice: stop, exitReason: "stop", daysHeld: j - i, returnPct: ((stop - entry) / entry) * 100 };
    }
    if (hitStop) return { exitPrice: stop, exitReason: "stop", daysHeld: j - i, returnPct: ((stop - entry) / entry) * 100 };
    if (hitTarget) return { exitPrice: target, exitReason: "target", daysHeld: j - i, returnPct: ((target - entry) / entry) * 100 };
  }
  const lastIdx = Math.min(i + maxHoldDays, candles.length - 1);
  const exitPrice = candles[lastIdx].close;
  return { exitPrice, exitReason: "time", daysHeld: lastIdx - i, returnPct: ((exitPrice - entry) / entry) * 100 };
}

/**
 * Backtest the screening rule for a single symbol, simulating a real
 * stop-loss/target exit (not just a fixed holding period).
 * @returns {{symbol: string, signals: Array, summary: object}}
 */
export function backtestSymbol(candles, { holdDays = 10 } = {}) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const rsi = computeRSI(closes, 14);
  const ema50 = computeEMA(closes, 50);
  const atr = computeATR(candles, 14);
  const maxHoldDays = Math.max(holdDays, 5);

  const signals = [];
  for (let i = 51; i < closes.length - 1; i++) {
    if (rsi[i] == null || ema50[i] == null || atr[i] == null) continue;
    const change = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    const relVol = relativeVolume(volumes, i);
    const bullish =
      change > 0 && closes[i] > ema50[i] && rsi[i] >= 45 && rsi[i] <= 70 && (relVol == null || relVol >= 1);
    const bearish = closes[i] < ema50[i] && rsi[i] < 45;
    if (!bullish && !bearish) continue;
    if (i + maxHoldDays >= candles.length) continue;

    const trade = simulateTrade(candles, i, atr, { maxHoldDays });
    if (!trade) continue;

    signals.push({
      date: candles[i].date,
      type: bullish ? "bullish" : "bearish",
      priceAtSignal: closes[i],
      exitPrice: trade.exitPrice,
      exitReason: trade.exitReason,
      daysHeld: trade.daysHeld,
      forwardReturnPct: trade.returnPct,
    });
  }

  const bullishSignals = signals.filter((s) => s.type === "bullish");
  const bearishSignals = signals.filter((s) => s.type === "bearish");

  function summarize(sigs) {
    if (sigs.length === 0) return null;
    const returns = sigs.map((s) => s.forwardReturnPct);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const winRate = (returns.filter((r) => r > 0).length / returns.length) * 100;
    const hitTarget = sigs.filter((s) => s.exitReason === "target").length;
    const hitStop = sigs.filter((s) => s.exitReason === "stop").length;
    const timedOut = sigs.filter((s) => s.exitReason === "time").length;
    return {
      count: sigs.length,
      avgReturnPct: avgReturn,
      winRatePct: winRate,
      hitTargetPct: (hitTarget / sigs.length) * 100,
      hitStopPct: (hitStop / sigs.length) * 100,
      timedOutPct: (timedOut / sigs.length) * 100,
    };
  }

  const firstClose = closes.find((c) => c != null);
  const lastClose = closes[closes.length - 1];
  const buyAndHoldPct = ((lastClose - firstClose) / firstClose) * 100;

  return {
    signals,
    summary: {
      bullish: summarize(bullishSignals),
      bearish: summarize(bearishSignals),
      buyAndHoldPct,
      periodStart: candles[0]?.date,
      periodEnd: candles[candles.length - 1]?.date,
      holdDays,
    },
  };
}

/**
 * @param {{symbols: Array<{symbol: string, exchange: string}>, range: string, holdDays: number}} opts
 */
export async function runBacktest({ symbols, range = "2y", holdDays = 10 }) {
  const capped = symbols.slice(0, 40); // keep sequential Yahoo fetches within a reasonable request time
  const results = [];
  for (const { symbol, exchange } of capped) {
    try {
      const candles = await fetchYahooHistory(symbol, exchange, range);
      if (candles.length < 80) {
        results.push({ symbol, exchange, error: "Not enough historical data" });
        continue;
      }
      const { summary } = backtestSymbol(candles, { holdDays });
      results.push({ symbol, exchange, summary });
    } catch (err) {
      results.push({ symbol, exchange, error: err.message });
    }
  }

  const withBullish = results.filter((r) => r.summary?.bullish);
  const aggregate =
    withBullish.length > 0
      ? {
          symbolsWithSignals: withBullish.length,
          avgWinRatePct:
            withBullish.reduce((a, r) => a + r.summary.bullish.winRatePct, 0) / withBullish.length,
          avgReturnPct:
            withBullish.reduce((a, r) => a + r.summary.bullish.avgReturnPct, 0) / withBullish.length,
          totalSignals: withBullish.reduce((a, r) => a + r.summary.bullish.count, 0),
        }
      : null;

  return { results, aggregate, holdDays, range };
}

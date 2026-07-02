/**
 * Shared NSE/BSE technical screener logic — calls TradingView's own public
 * scanner backend directly over HTTPS (free, no API key, no login). Used by
 * both the CLI script (scripts/nse_bse_market_screen.js) and the local
 * web app (webapp/server.js), so they never drift out of sync.
 */

const SCANNER_URL = "https://scanner.tradingview.com/india/scan";

export const COLUMNS = [
  "name",
  "description",
  "close",
  "change",
  "volume",
  "average_volume_10d_calc",
  "relative_volume_10d_calc",
  "RSI",
  "EMA50",
  "EMA200",
  "sector",
  "market_cap_basic",
  // Fundamentals — same free scanner endpoint, just more columns. Lets the
  // screener see whether a technically "bullish" stock is also fundamentally
  // sound, instead of judging on price action alone.
  "price_earnings_ttm",
  "price_book_fq",
  "return_on_equity_fq",
  "debt_to_equity_fq",
  "dividend_yield_recent",
  "earnings_per_share_diluted_yoy_growth_ttm",
  "total_revenue_yoy_growth_ttm",
  "earnings_release_next_date",
];

export async function fetchScan({ exchange, minMarketCap, sortBy, sortOrder, range }) {
  const body = {
    filter: [
      { left: "exchange", operation: "equal", right: exchange },
      { left: "market_cap_basic", operation: "egreater", right: minMarketCap },
      { left: "is_primary", operation: "equal", right: true },
    ],
    columns: COLUMNS,
    sort: { sortBy, sortOrder },
    range,
  };
  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Scanner request failed for ${exchange}: HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    totalCount: json.totalCount,
    rows: json.data.map((d) => Object.fromEntries(COLUMNS.map((c, i) => [c, d.d[i]]))),
  };
}

export function classifyBullish(r) {
  return (
    typeof r.EMA50 === "number" &&
    typeof r.RSI === "number" &&
    r.change > 0 &&
    r.close > r.EMA50 &&
    r.RSI >= 45 &&
    r.RSI <= 70 &&
    (r.relative_volume_10d_calc == null || r.relative_volume_10d_calc >= 1)
  );
}

export function classifyBearish(r) {
  return (
    typeof r.EMA50 === "number" &&
    typeof r.RSI === "number" &&
    r.close < r.EMA50 &&
    r.RSI < 45
  );
}

/**
 * Run a screen for one exchange. `mode` is one of:
 * bullish | bearish | gainers | losers | active
 */
export async function scanExchange(exchange, { minMarketCap, mode, limit, pool }) {
  if (mode === "gainers" || mode === "bullish") {
    const { totalCount, rows } = await fetchScan({
      exchange,
      minMarketCap,
      sortBy: "change",
      sortOrder: "desc",
      range: [0, pool],
    });
    const filtered = mode === "bullish" ? rows.filter(classifyBullish) : rows;
    return { exchange, totalCount, rows: filtered.slice(0, limit) };
  }
  if (mode === "losers" || mode === "bearish") {
    const { totalCount, rows } = await fetchScan({
      exchange,
      minMarketCap,
      sortBy: "change",
      sortOrder: "asc",
      range: [0, pool],
    });
    const filtered = mode === "bearish" ? rows.filter(classifyBearish) : rows;
    return { exchange, totalCount, rows: filtered.slice(0, limit) };
  }
  if (mode === "active") {
    const { totalCount, rows } = await fetchScan({
      exchange,
      minMarketCap,
      sortBy: "relative_volume_10d_calc",
      sortOrder: "desc",
      range: [0, pool],
    });
    return { exchange, totalCount, rows: rows.slice(0, limit) };
  }
  throw new Error(`Unknown mode: ${mode}`);
}

/**
 * Run a screen across one or more exchanges.
 * @param {{exchanges: string[], minMarketCap: number, mode: string, limit: number, pool: number}} opts
 */
export async function runScreen({ exchanges, minMarketCap, mode, limit, pool }) {
  const results = [];
  for (const exchange of exchanges) {
    results.push(await scanExchange(exchange, { minMarketCap, mode, limit, pool }));
  }
  return results;
}

const MTF_COLUMNS = [
  "name",
  "close",
  "RSI",
  "RSI|1W",
  "EMA50",
  "EMA50|1W",
  "RSI|240",
  "EMA50|240",
];

/**
 * Fetch the current price/change for one specific symbol (not a ranked
 * scan) — used to check on previously-shortlisted stocks regardless of
 * where they currently rank in the market.
 */
export async function fetchQuote(exchange, symbol) {
  const body = {
    filter: [
      { left: "exchange", operation: "equal", right: exchange },
      { left: "name", operation: "equal", right: symbol },
    ],
    columns: ["name", "close", "change"],
  };
  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Quote request failed for ${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.data || json.data.length === 0) {
    throw new Error(`No scanner data found for ${exchange}:${symbol}`);
  }
  const [name, close, change] = json.data[0].d;
  return { symbol: name, close, change };
}

/**
 * Fetch daily + weekly + 4H RSI/EMA50 for a single symbol in one request,
 * using TradingView scanner's pipe-suffix multi-timeframe columns
 * (e.g. "RSI|1W" = weekly RSI, "RSI|240" = 4-hour RSI). Used to confirm a
 * daily signal isn't contradicted by the higher/lower timeframe.
 */
export async function fetchMultiTimeframe(exchange, symbol) {
  const body = {
    filter: [
      { left: "exchange", operation: "equal", right: exchange },
      { left: "name", operation: "equal", right: symbol },
    ],
    columns: MTF_COLUMNS,
  };
  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Scanner MTF request failed for ${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.data || json.data.length === 0) {
    throw new Error(`No scanner data found for ${exchange}:${symbol}`);
  }
  const d = json.data[0].d;
  const row = Object.fromEntries(MTF_COLUMNS.map((c, i) => [c, d[i]]));
  const timeframes = {
    "4H": { rsi: row["RSI|240"], ema50: row["EMA50|240"], close: row.close },
    "1D": { rsi: row.RSI, ema50: row.EMA50, close: row.close },
    "1W": { rsi: row["RSI|1W"], ema50: row["EMA50|1W"], close: row.close },
  };
  const verdicts = Object.fromEntries(
    Object.entries(timeframes).map(([tf, v]) => {
      if (v.rsi == null || v.ema50 == null) return [tf, "unknown"];
      const bullish = v.close > v.ema50 && v.rsi >= 45 && v.rsi <= 70;
      const bearish = v.close < v.ema50 && v.rsi < 45;
      return [tf, bullish ? "bullish" : bearish ? "bearish" : "neutral"];
    })
  );
  const values = Object.values(verdicts).filter((v) => v !== "unknown");
  const allBullish = values.length > 0 && values.every((v) => v === "bullish");
  const allBearish = values.length > 0 && values.every((v) => v === "bearish");
  const aligned = allBullish ? "bullish" : allBearish ? "bearish" : "mixed";
  return { symbol, exchange, timeframes, verdicts, aligned };
}

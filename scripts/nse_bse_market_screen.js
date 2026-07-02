#!/usr/bin/env node
/**
 * Free, exhaustive NSE + BSE market screener (CLI).
 *
 * Bypasses the TradingView desktop app entirely (its webview CSP blocks
 * cross-origin fetches to scanner.tradingview.com) and hits TradingView's
 * own public scanner backend directly over plain HTTPS. No API key, no
 * login, no cost. Covers the full NSE (~3300 symbols) and BSE (~4900
 * symbols) universe, not a hand-picked watchlist.
 *
 * Core logic lives in scripts/lib/screener.js (shared with the web app at
 * webapp/server.js) — this file is just the CLI wrapper.
 *
 * Usage:
 *   node scripts/nse_bse_market_screen.js [options]
 *
 * Options:
 *   --exchange=NSE,BSE       Exchanges to scan (default: NSE,BSE)
 *   --min-market-cap=5e9     Minimum market cap in INR (default: 5,000,000,000 = ₹500cr)
 *   --mode=bullish           bullish | bearish | gainers | losers | active (default: bullish)
 *   --limit=20               Rows to print per exchange (default: 20)
 *   --pool=150                How many top movers per exchange to pull before
 *                             applying the bias filter client-side (default: 150)
 *   --json                   Print raw JSON instead of a table
 *
 * "bullish"/"bearish" modes approximate the rules.json bias criteria:
 *   bullish: close > EMA50, RSI in [45,70], relative volume > 1 (rising volume)
 *   bearish: close < EMA50, RSI < 45
 */

import { runScreen } from "./lib/screener.js";

function parseArgs(argv) {
  const args = {
    exchange: "NSE,BSE",
    minMarketCap: 5_000_000_000,
    mode: "bullish",
    limit: 20,
    pool: 150,
    json: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "exchange") args.exchange = value;
    else if (key === "min-market-cap") args.minMarketCap = Number(value);
    else if (key === "mode") args.mode = value;
    else if (key === "limit") args.limit = Number(value);
    else if (key === "pool") args.pool = Number(value);
    else if (key === "json") args.json = true;
  }
  return args;
}

function printTable(exchangeResult) {
  const { exchange, totalCount, rows } = exchangeResult;
  console.log(
    `\n${exchange} — ${rows.length} matches (screened from ${totalCount} listed symbols)`
  );
  if (rows.length === 0) {
    console.log("  (none matched)");
    return;
  }
  const header = ["Symbol", "Close", "Chg%", "RSI", "EMA50", "RelVol", "Sector"];
  const widths = [16, 10, 8, 6, 10, 7, 24];
  console.log(header.map((h, i) => h.padEnd(widths[i])).join(""));
  for (const r of rows) {
    const cells = [
      r.name,
      r.close?.toFixed(2) ?? "-",
      r.change != null ? `${r.change.toFixed(2)}%` : "-",
      r.RSI != null ? r.RSI.toFixed(1) : "-",
      r.EMA50 != null ? r.EMA50.toFixed(2) : "-",
      r.relative_volume_10d_calc != null ? r.relative_volume_10d_calc.toFixed(2) : "-",
      r.sector ?? "-",
    ];
    console.log(cells.map((c, i) => String(c).padEnd(widths[i])).join(""));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exchanges = args.exchange.split(",").map((s) => s.trim().toUpperCase());
  const results = await runScreen({
    exchanges,
    minMarketCap: args.minMarketCap,
    mode: args.mode,
    limit: args.limit,
    pool: args.pool,
  });
  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`Mode: ${args.mode} | Min market cap: ₹${(args.minMarketCap / 1e7).toFixed(0)}cr`);
    for (const r of results) printTable(r);
  }
}

main().catch((err) => {
  console.error("Screen failed:", err.message);
  process.exit(1);
});

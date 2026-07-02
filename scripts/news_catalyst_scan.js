#!/usr/bin/env node
/**
 * Free news/catalyst scanner for a list of NSE/BSE stock symbols (CLI).
 *
 * Uses Google News RSS (no API key, no login, no cost) to pull recent
 * headlines per company. Intended to run AFTER a technical screen
 * (see nse_bse_market_screen.js) on a short list of candidates — RSS
 * fetching one-by-one does not scale to the whole market.
 *
 * Core logic lives in scripts/lib/news.js (shared with the web app at
 * webapp/server.js) — this file is just the CLI wrapper.
 *
 * Usage:
 *   node scripts/news_catalyst_scan.js SYMBOL1 SYMBOL2 SYMBOL3 ...
 *   node scripts/news_catalyst_scan.js --company="Delhivery Limited" --symbol=DELHIVERY
 *   node scripts/news_catalyst_scan.js --json SYMBOL1 SYMBOL2
 *
 * Options:
 *   --days=14        Only show headlines from the last N days (default 14)
 *   --limit=8         Max headlines per symbol (default 8)
 *   --json            Print raw JSON instead of formatted text
 */

import { runNewsScan } from "./lib/news.js";

function parseArgs(argv) {
  const args = { days: 14, limit: 8, json: false, symbols: [], companyOverrides: {} };
  for (const raw of argv) {
    if (raw.startsWith("--days=")) args.days = Number(raw.split("=")[1]);
    else if (raw.startsWith("--limit=")) args.limit = Number(raw.split("=")[1]);
    else if (raw === "--json") args.json = true;
    else if (raw.startsWith("--company=")) args._pendingCompany = raw.split("=").slice(1).join("=");
    else if (raw.startsWith("--symbol=")) {
      const sym = raw.split("=")[1];
      args.symbols.push(sym);
      if (args._pendingCompany) {
        args.companyOverrides[sym] = args._pendingCompany;
        args._pendingCompany = null;
      }
    } else {
      args.symbols.push(raw);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.symbols.length === 0) {
    console.error("Usage: node scripts/news_catalyst_scan.js SYMBOL1 SYMBOL2 ...");
    process.exit(1);
  }

  const results = await runNewsScan(args);

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    console.log(`\n=== ${r.symbol} (query: "${r.query}") ===`);
    if (r.error) {
      console.log(`  error: ${r.error}`);
      continue;
    }
    if (r.headlines.length === 0) {
      console.log("  (no recent headlines found)");
      continue;
    }
    for (const h of r.headlines) {
      console.log(`  - [${h.tag}] ${h.title}`);
      console.log(`    ${h.source} · ${h.pubDate}`);
    }
  }
}

main().catch((err) => {
  console.error("News scan failed:", err.message);
  process.exit(1);
});

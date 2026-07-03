#!/usr/bin/env node
/**
 * Local dashboard server for the NSE/BSE screener + news catalyst scanner.
 *
 * Zero extra npm dependencies — uses Node's built-in http module. Serves
 * the static dashboard from webapp/public and exposes JSON APIs wrapping
 * scripts/lib/*.js:
 *
 *   GET  /api/screen?mode=&exchange=&minMarketCap=&limit=&pool=
 *   GET  /api/news?symbol=&company=&days=&limit=
 *   GET  /api/announcements?symbol=&limit=
 *   GET  /api/mtf?symbol=&exchange=                          (multi-timeframe confirmation)
 *   GET  /api/backtest?symbols=A,B,C&exchange=NSE&range=2y&holdDays=10
 *   GET  /api/shortlist
 *   POST /api/shortlist                 body: {symbol, exchange, company, priceAtAdd}
 *   DELETE /api/shortlist?symbol=X
 *   GET  /api/shortlist/performance
 *   GET  /api/market-context                                  (India VIX + FII/DII net flows, cached 5 min)
 *
 * Run with:
 *   node webapp/server.js
 * Then open http://localhost:4545 in a browser.
 *
 * This must run as a real Node process (not inside the TradingView app's
 * webview) because scanner.tradingview.com, news.google.com, and
 * nseindia.com are all blocked by that app's own CSP.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runScreen, fetchMultiTimeframe } from "../scripts/lib/screener.js";
import { runNewsScan } from "../scripts/lib/news.js";
import { fetchAnnouncements } from "../scripts/lib/nseAnnouncements.js";
import { runBacktest } from "../scripts/lib/backtest.js";
import { fetchMarketContext } from "../scripts/lib/marketContext.js";
import {
  listShortlist,
  addToShortlist,
  removeFromShortlist,
  computePerformance,
} from "../scripts/lib/shortlistStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4545;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function serveStatic(req, res, pathname) {
  const relPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, relPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// --- Simple in-memory cache with TTL for the (relatively) expensive screen endpoint ---
const screenCache = new Map();
const SCREEN_CACHE_TTL_MS = 60_000;

async function cachedScreen({ exchanges, minMarketCap, mode, limit, pool }) {
  const key = JSON.stringify({ exchanges, minMarketCap, mode, limit, pool });
  const hit = screenCache.get(key);
  if (hit && Date.now() - hit.at < SCREEN_CACHE_TTL_MS) return hit.value;
  const value = await runScreen({ exchanges, minMarketCap, mode, limit, pool });
  screenCache.set(key, { at: Date.now(), value });
  return value;
}

async function handleScreen(req, res, query) {
  try {
    const exchanges = (query.get("exchange") || "NSE,BSE").split(",").map((s) => s.trim().toUpperCase());
    const minMarketCap = Number(query.get("minMarketCap") || 5_000_000_000);
    const mode = query.get("mode") || "bullish";
    const limit = Number(query.get("limit") || 20);
    const pool = Number(query.get("pool") || 150);
    const results = await cachedScreen({ exchanges, minMarketCap, mode, limit, pool });
    sendJson(res, 200, { ok: true, mode, minMarketCap, results });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleNews(req, res, query) {
  try {
    const symbol = query.get("symbol");
    const company = query.get("company");
    const days = Number(query.get("days") || 14);
    const limit = Number(query.get("limit") || 8);
    if (!symbol) return sendJson(res, 400, { ok: false, error: "symbol is required" });
    const results = await runNewsScan({
      symbols: [symbol],
      companyOverrides: company ? { [symbol]: company } : {},
      days,
      limit,
    });
    sendJson(res, 200, { ok: true, result: results[0] });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleAnnouncements(req, res, query) {
  try {
    const symbol = query.get("symbol");
    const limit = Number(query.get("limit") || 8);
    if (!symbol) return sendJson(res, 400, { ok: false, error: "symbol is required" });
    const items = await fetchAnnouncements({ symbol, limit });
    sendJson(res, 200, { ok: true, items });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleMtf(req, res, query) {
  try {
    const symbol = query.get("symbol");
    const exchange = query.get("exchange") || "NSE";
    if (!symbol) return sendJson(res, 400, { ok: false, error: "symbol is required" });
    const result = await fetchMultiTimeframe(exchange, symbol);
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleBacktest(req, res, query) {
  try {
    const rawSymbols = (query.get("symbols") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const exchange = query.get("exchange") || "NSE";
    const range = query.get("range") || "2y";
    const holdDays = Number(query.get("holdDays") || 10);
    if (rawSymbols.length === 0) return sendJson(res, 400, { ok: false, error: "symbols is required" });
    const symbols = rawSymbols.map((s) => ({ symbol: s, exchange }));
    const result = await runBacktest({ symbols, range, holdDays });
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleShortlist(req, res, url) {
  try {
    if (req.method === "GET") {
      const items = await listShortlist();
      return sendJson(res, 200, { ok: true, items });
    }
    if (req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const items = await addToShortlist(body);
      return sendJson(res, 200, { ok: true, items });
    }
    if (req.method === "DELETE") {
      const symbol = url.searchParams.get("symbol");
      if (!symbol) return sendJson(res, 400, { ok: false, error: "symbol is required" });
      const items = await removeFromShortlist(symbol);
      return sendJson(res, 200, { ok: true, items });
    }
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleShortlistPerformance(req, res) {
  try {
    const items = await computePerformance();
    sendJson(res, 200, { ok: true, items });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

// Market context (VIX + FII/DII) changes slowly during the day — cache for 5 min.
let marketContextCache = null;
let marketContextCachedAt = 0;
const MARKET_CONTEXT_TTL_MS = 5 * 60_000;

async function handleMarketContext(req, res) {
  try {
    if (!marketContextCache || Date.now() - marketContextCachedAt > MARKET_CONTEXT_TTL_MS) {
      marketContextCache = await fetchMarketContext();
      marketContextCachedAt = Date.now();
    }
    sendJson(res, 200, { ok: true, ...marketContextCache });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/health") return sendJson(res, 200, { ok: true });
  if (url.pathname === "/api/screen") return handleScreen(req, res, url.searchParams);
  if (url.pathname === "/api/news") return handleNews(req, res, url.searchParams);
  if (url.pathname === "/api/announcements") return handleAnnouncements(req, res, url.searchParams);
  if (url.pathname === "/api/mtf") return handleMtf(req, res, url.searchParams);
  if (url.pathname === "/api/backtest") return handleBacktest(req, res, url.searchParams);
  if (url.pathname === "/api/shortlist/performance") return handleShortlistPerformance(req, res);
  if (url.pathname === "/api/shortlist") return handleShortlist(req, res, url);
  if (url.pathname === "/api/market-context") return handleMarketContext(req, res);
  return serveStatic(req, res, url.pathname);
});

// Warm the default bullish scan on startup and every 5 minutes, so the
// first page load (and most subsequent ones) hit a warm cache instead of
// waiting on a live scanner round-trip.
const DEFAULT_SCREEN_PARAMS = {
  exchanges: ["NSE", "BSE"],
  minMarketCap: 5_000_000_000,
  mode: "bullish",
  limit: 20,
  pool: 150,
};
function warmDefaultScan() {
  cachedScreen(DEFAULT_SCREEN_PARAMS).catch((err) => console.error("Background scan warm-up failed:", err.message));
}
warmDefaultScan();
setInterval(warmDefaultScan, 5 * 60_000);

server.listen(PORT, () => {
  console.log(`NSE/BSE dashboard running at http://localhost:${PORT}`);
});

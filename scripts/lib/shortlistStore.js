/**
 * Lightweight server-side persistence for the shortlist, so performance can
 * be tracked over time regardless of which browser/device stars a stock.
 * Just a JSON file — no database needed for this scale.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchQuote } from "./screener.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "webapp", "data");
const STORE_PATH = path.join(DATA_DIR, "shortlist.json");

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(STORE_PATH, "utf-8");
  } catch {
    await writeFile(STORE_PATH, "[]", "utf-8");
  }
}

async function readStore() {
  await ensureStore();
  const raw = await readFile(STORE_PATH, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeStore(entries) {
  await ensureStore();
  await writeFile(STORE_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

export async function listShortlist() {
  return readStore();
}

export async function addToShortlist({ symbol, exchange = "NSE", company, priceAtAdd }) {
  const entries = await readStore();
  if (entries.some((e) => e.symbol === symbol)) return entries;
  entries.push({
    symbol,
    exchange,
    company: company || symbol,
    priceAtAdd,
    addedAt: new Date().toISOString(),
  });
  await writeStore(entries);
  return entries;
}

export async function removeFromShortlist(symbol) {
  const entries = await readStore();
  const filtered = entries.filter((e) => e.symbol !== symbol);
  await writeStore(filtered);
  return filtered;
}

/**
 * For every saved entry, fetch its current price and compute the return
 * since it was added — this is the actual feedback loop: did the picks
 * that got starred actually go up?
 */
export async function computePerformance() {
  const entries = await readStore();
  const results = [];
  for (const entry of entries) {
    try {
      const quote = await fetchQuote(entry.exchange, entry.symbol);
      const returnPct =
        entry.priceAtAdd != null && entry.priceAtAdd !== 0
          ? ((quote.close - entry.priceAtAdd) / entry.priceAtAdd) * 100
          : null;
      const daysHeld = Math.round((Date.now() - new Date(entry.addedAt).getTime()) / 86_400_000);
      results.push({ ...entry, currentPrice: quote.close, returnPct, daysHeld });
    } catch (err) {
      results.push({ ...entry, error: err.message });
    }
  }
  return results;
}

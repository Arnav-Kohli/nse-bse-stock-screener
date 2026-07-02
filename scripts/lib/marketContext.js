/**
 * Whole-market context signals — not specific to any one stock, but useful
 * for judging whether a technical signal is more or less likely to hold:
 * India VIX (fear gauge) and daily FII/DII net institutional flows.
 */

export async function fetchIndiaVix() {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EINDIAVIX?range=5d&interval=1d";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`India VIX request failed: HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("No India VIX data returned");
  const value = result.meta.regularMarketPrice;
  const prevClose = result.meta.chartPreviousClose;
  const changePct = prevClose ? ((value - prevClose) / prevClose) * 100 : null;
  let regime;
  if (value < 13) regime = "calm";
  else if (value < 18) regime = "normal";
  else if (value < 24) regime = "elevated";
  else regime = "high";
  return { value, changePct, regime };
}

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

let cachedCookie = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 4 * 60 * 1000;

async function getNseSessionCookie() {
  if (cachedCookie && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) return cachedCookie;
  const res = await fetch("https://www.nseindia.com/", { headers: BASE_HEADERS });
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  cachedCookie = raw.map((c) => c.split(";")[0]).join("; ");
  cookieFetchedAt = Date.now();
  return cachedCookie;
}

export async function fetchFiiDiiFlows() {
  const cookie = await getNseSessionCookie();
  const res = await fetch("https://www.nseindia.com/api/fiidiiTradeReact", {
    headers: { ...BASE_HEADERS, Cookie: cookie, Referer: "https://www.nseindia.com/" },
  });
  if (!res.ok) throw new Error(`FII/DII request failed: HTTP ${res.status}`);
  const json = await res.json();
  return json.map((row) => ({
    category: row.category,
    date: row.date,
    buyValueCr: Number(row.buyValue),
    sellValueCr: Number(row.sellValue),
    netValueCr: Number(row.netValue),
  }));
}

export async function fetchMarketContext() {
  const [vix, flows] = await Promise.all([
    fetchIndiaVix().catch((err) => ({ error: err.message })),
    fetchFiiDiiFlows().catch((err) => ({ error: err.message })),
  ]);
  return { vix, flows };
}

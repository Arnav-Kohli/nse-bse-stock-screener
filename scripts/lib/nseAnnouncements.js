/**
 * Fetches official NSE corporate announcements (board meetings, results,
 * insider trades, credit rating actions, etc.) — free, no API key, no login.
 *
 * NSE's site requires a "warm-up" request first to receive cookies before
 * the JSON API accepts requests (it 403s otherwise). This is a well-known
 * quirk of nseindia.com, not a bug — we just replicate what a real browser
 * visit would do.
 *
 * This is a materially higher-signal catalyst source than general news
 * search: every item here is an actual regulatory filing, not a blog post
 * or a re-syndicated headline.
 */

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

let cachedCookie = null;
let cookieFetchedAt = 0;
const COOKIE_TTL_MS = 4 * 60 * 1000;

async function getSessionCookie() {
  if (cachedCookie && Date.now() - cookieFetchedAt < COOKIE_TTL_MS) {
    return cachedCookie;
  }
  const res = await fetch("https://www.nseindia.com/", { headers: BASE_HEADERS });
  const setCookie = res.headers.get("set-cookie");
  // Node's fetch merges multiple Set-Cookie headers with ", " — split back into pairs.
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : setCookie ? [setCookie] : [];
  const cookie = raw.map((c) => c.split(";")[0]).join("; ");
  cachedCookie = cookie;
  cookieFetchedAt = Date.now();
  return cookie;
}

export async function fetchAnnouncements({ symbol, limit = 8 } = {}) {
  const cookie = await getSessionCookie();
  const url = symbol
    ? `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`
    : `https://www.nseindia.com/api/corporate-announcements?index=equities`;
  const res = await fetch(url, {
    headers: { ...BASE_HEADERS, Cookie: cookie, Referer: "https://www.nseindia.com/" },
  });
  if (!res.ok) throw new Error(`NSE announcements request failed: HTTP ${res.status}`);
  const json = await res.json();
  const items = Array.isArray(json) ? json : [];
  return items.slice(0, limit).map((item) => ({
    company: item.sm_name,
    symbol: item.symbol,
    subject: item.desc,
    detail: item.attchmntText,
    date: item.sort_date || item.an_dt,
    attachmentUrl: item.attchmntFile,
    sector: item.smIndustry,
  }));
}

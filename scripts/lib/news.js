/**
 * Shared news/catalyst fetching logic — pulls recent headlines per company
 * from Google News RSS (free, no API key, no login). Used by both the CLI
 * script (scripts/news_catalyst_scan.js) and the local web app
 * (webapp/server.js).
 *
 * This only fetches and returns raw headlines/links. It does NOT classify
 * sentiment or "score" stocks — interpreting a headline as a genuine
 * catalyst vs a risk flag vs noise requires judgment that RSS metadata
 * can't reliably encode. The web app applies only a rough, clearly-labeled
 * keyword heuristic for a visual nudge; real interpretation is left to
 * the person (or agent) reading the headlines.
 */

export function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "";
    const link = /<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? "";
    const pubDate = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1] ?? "";
    const source = /<source[^>]*>([\s\S]*?)<\/source>/.exec(block)?.[1] ?? "";
    items.push({
      title: decodeEntities(title.replace(/<!\[CDATA\[|\]\]>/g, "")),
      link: decodeEntities(link.replace(/<!\[CDATA\[|\]\]>/g, "")),
      pubDate,
      source: decodeEntities(source.replace(/<!\[CDATA\[|\]\]>/g, "")),
    });
  }
  return items;
}

export async function fetchNews(query, days, limit) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}+when:${days}d&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`RSS fetch failed for "${query}": HTTP ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml).slice(0, limit);
}

const POSITIVE_KEYWORDS = [
  "wins order", "wins contract", "bags order", "profit rises", "profit jumps",
  "revenue jumps", "revenue rises", "beats estimates", "partnership", "mou",
  "expands", "record", "upgrade", "raises guidance", "dividend", "buyback",
  "bonus", "new ceo", "new md", "stake buy", "promoter buy", "block deal buy",
  "outperform", "target price hike", "surge", "rally", "breakout",
];

const NEGATIVE_KEYWORDS = [
  "resigns", "steps down", "insolvency", "bankruptcy", "raid", "penalty",
  "fine", "fraud", "probe", "investigation", "downgrade", "sells stake",
  "bulk deal sell", "offloads", "promoter sell", "pledge", "default",
  "license cancel", "licence cancel", "ban", "lawsuit", "litigation",
  "court", "crash", "plunge", "scam", "cbi", "sebi action",
];

/** Rough, transparent keyword heuristic — a hint, not a verdict. */
export function tagHeadline(title) {
  const lower = title.toLowerCase();
  const isPositive = POSITIVE_KEYWORDS.some((k) => lower.includes(k));
  const isNegative = NEGATIVE_KEYWORDS.some((k) => lower.includes(k));
  if (isPositive && !isNegative) return "positive";
  if (isNegative && !isPositive) return "negative";
  return "neutral";
}

/**
 * @param {{symbols: string[], companyOverrides: Record<string,string>, days: number, limit: number}} opts
 */
export async function runNewsScan({ symbols, companyOverrides = {}, days = 14, limit = 8 }) {
  const results = [];
  for (const symbol of symbols) {
    const query = companyOverrides[symbol] || `${symbol} NSE stock`;
    try {
      const headlines = await fetchNews(query, days, limit);
      results.push({
        symbol,
        query,
        headlines: headlines.map((h) => ({ ...h, tag: tagHeadline(h.title) })),
      });
    } catch (err) {
      results.push({ symbol, query, error: err.message, headlines: [] });
    }
  }
  return results;
}

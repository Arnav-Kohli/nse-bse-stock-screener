# NSE/BSE Killer Stock Screener

A self-serve market intelligence dashboard for Indian equities (NSE & BSE) that combines
live technical screening, news sentiment, ATR-based backtesting, multi-timeframe confirmation,
market context, and risk-managed position sizing — built as a personal project, zero external
runtime dependencies.

Live dashboard: `npm run dashboard` → http://localhost:4545 (or deploy to Render — see [DEPLOY.md](DEPLOY.md))
Landing page: https://arnav-kohli.github.io/nse-bse-stock-screener/

## Why this exists

Most free stock screeners either show you a curated top-10 list or make you pay for full-market
access. This project talks directly to public/undocumented market data endpoints to run a real
full-market NSE + BSE scan for free, then layers analysis on top that a plain screener doesn't do:
news sentiment, multi-timeframe confirmation, and — most importantly — **honest backtesting**.
Every "bullish" or "bearish" rule is simulated bar-by-bar against real historical data with an
ATR-based stop-loss and 2:1 reward:risk target, so the dashboard reports how often a setup
actually worked historically, not just how it looks right now.

## What's in this repo

```
├── webapp/              # The dashboard (Node http server + vanilla JS frontend)
│   ├── server.js        # API routes: screen, mtf, backtest, shortlist, announcements, market-context
│   ├── public/          # Frontend: index.html, app.js, styles.css
│   └── data/            # Server-persisted shortlist storage
├── scripts/
│   ├── lib/             # Shared logic: screener, news, backtest, NSE announcements, market context
│   ├── nse_bse_market_screen.js   # CLI: full-market technical scan
│   └── news_catalyst_scan.js      # CLI: news + sentiment tagging for given symbols
├── site/                # Marketing/portfolio landing page (Apple-style scroll motion sections)
└── rules.json           # Risk & scope rules this project is built around
```

## Features

- **Full-market technical screener** — RSI, EMA(50/200), volume, relative volume, fundamentals
  (P/E, P/B, ROE, debt/equity, dividend yield, earnings growth) across NSE & BSE, not a curated sample
- **News & sentiment** — live headline scraping per symbol with heuristic positive/negative/neutral
  tagging, plus official NSE corporate announcements
- **Multi-timeframe confirmation** — cross-checks daily signals against weekly and 4-hour structure
- **ATR-based backtesting** — simulates real stop-loss/target exits bar-by-bar (not a fixed holding
  period), reporting hit-target %, hit-stop %, and timed-out % per rule
- **Market context** — India VIX and live FII/DII flow data
- **Position sizing & Kite tickets** — enforces a fixed risk budget (default: 1% of portfolio per
  trade, min 2:1 reward:risk) and generates ready-to-place Zerodha Kite order tickets; **never
  places real orders**
- **Shortlist tracking** — server-persisted watchlist with live performance tracking
- **Caching + background refresh** — in-memory TTL cache and a background scan refresh loop so
  repeat visits don't re-hit external APIs unnecessarily

## Running it

```bash
npm install   # no external deps currently, but keeps this future-proof
npm run dashboard
# open http://localhost:4545
```

CLI-only usage:

```bash
npm run screen -- --bias bullish --exchange NSE
npm run news -- RELIANCE TCS INFY
```

## Deploy for others (no clone required)

To let visitors use the screener/backtester from a link (without running code locally), deploy the dashboard to **Render** (recommended) or Railway. Step-by-step: **[DEPLOY.md](DEPLOY.md)**.

Quick version: connect this GitHub repo on [render.com](https://render.com) → **New → Blueprint** → it reads `render.yaml` → you get a URL like `https://nse-bse-screener.onrender.com`.

**Vercel** is not a good fit here — free tier requests time out at 10 seconds, and full-market scans/backtests often take longer.

## Risk rules this project encodes

Defined in `rules.json` — the screener and position-size calculator are built around:

- Indian equities only (NSE, BSE) — no crypto
- Max 1% of portfolio risked per trade
- Minimum 2:1 reward:risk on every suggested setup
- No direct broker order placement — outputs Kite-ready order tickets only

## Disclaimer

This is a personal educational project, not financial advice. Backtest results are historical
simulations, not guarantees of future performance. Always do your own research before trading.

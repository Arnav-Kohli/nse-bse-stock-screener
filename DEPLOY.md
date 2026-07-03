# Deploy the live dashboard (no clone required for visitors)

Visitors should open a URL and use the screener/backtester directly. Your repo is already set up for that.

## Recommended: Render (free, works with zero code changes)

Your dashboard is a **long-running Node server** (`webapp/server.js`) that calls external APIs (TradingView scanner, Yahoo Finance, NSE, Google News). That fits a **web service**, not Vercel serverless.

| Platform | Works? | Why |
|----------|--------|-----|
| **Render** | ✅ Best fit | Runs `npm start` as a real server. No timeout issues for scans/backtests. |
| **Railway** | ✅ Same | Also runs a persistent Node process. |
| **Fly.io** | ✅ Same | Same model as Render. |
| **Vercel** | ⚠️ Poor fit | Free tier = **10s max per request**. Full-market scans and backtests often take longer. No persistent disk for the shortlist file. Would need a full serverless rewrite + external database. |
| **GitHub Pages** | ❌ Static only | Can host the marketing landing page (`docs/`), not the API/backtester. |

### One-time setup on Render (~5 minutes)

1. Push this repo to GitHub (already done if you're reading this from `Arnav-Kohli/nse-bse-stock-screener`).
2. Go to [render.com](https://render.com) → sign up with GitHub.
3. **New → Blueprint** → connect `nse-bse-stock-screener` → Render reads `render.yaml` automatically.
4. Click **Apply**. Render builds and deploys.
5. You get a URL like: `https://nse-bse-screener.onrender.com`

That's it. Share that link — anyone can use the screener without installing anything.

### After deploy

1. Open the URL → you should see the dashboard at `/`.
2. Test: click **Run scan** on the Screener tab, then try **Backtest** with 2–3 symbols.
3. Update the landing page button in `docs/index.html` to point to your live URL (replace the placeholder if you used a different service name).

### Free tier caveats (Render)

- **Cold starts**: if nobody uses it for ~15 minutes, the service sleeps. First visit after that can take **30–60 seconds** to wake up.
- **Shortlist storage**: saved to a file on the server. It persists while the service is running, but can reset on redeploy. Fine for a portfolio demo; use a database later if you need permanent multi-user storage.

### Custom domain (optional)

Render → your service → **Settings → Custom Domains** → e.g. `screener.yourdomain.com`.

---

## Alternative: Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub → select this repo.
2. Set **Start Command**: `npm start`
3. Railway sets `PORT` automatically.

---

## What stays on GitHub Pages

Keep `docs/` on GitHub Pages for the **marketing landing page**:

`https://arnav-kohli.github.io/nse-bse-stock-screener/`

Point the **"Open live dashboard"** button to your Render/Railway URL.

---

## Local development (unchanged)

```bash
npm run dashboard
# http://localhost:4545
```

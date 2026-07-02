const els = {
  mode: document.getElementById("mode"),
  minMarketCap: document.getElementById("minMarketCap"),
  limit: document.getElementById("limit"),
  runScan: document.getElementById("runScan"),
  exchangeChecks: Array.from(document.querySelectorAll(".checkbox-row input[type=checkbox]")),
  resultsTitle: document.getElementById("resultsTitle"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsBody: document.getElementById("resultsBody"),
  resultsError: document.getElementById("resultsError"),
  resultsLoading: document.getElementById("resultsLoading"),
  resultsEmpty: document.getElementById("resultsEmpty"),
  resultsTable: document.getElementById("resultsTable"),
  lastUpdated: document.getElementById("lastUpdated"),

  shortlistBody: document.getElementById("shortlistBody"),
  shortlistCount: document.getElementById("shortlistCount"),
  shortlistEmpty: document.getElementById("shortlistEmpty"),
  refreshPerformance: document.getElementById("refreshPerformance"),
  exportCsv: document.getElementById("exportCsv"),

  backtestVisible: document.getElementById("backtestVisible"),
  btSymbols: document.getElementById("btSymbols"),
  btRange: document.getElementById("btRange"),
  btHold: document.getElementById("btHold"),
  runBacktest: document.getElementById("runBacktest"),
  backtestLoading: document.getElementById("backtestLoading"),
  backtestError: document.getElementById("backtestError"),
  backtestSummary: document.getElementById("backtestSummary"),
  backtestTable: document.getElementById("backtestTable"),
  backtestBody: document.getElementById("backtestBody"),

  drawer: document.getElementById("newsDrawer"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  drawerClose: document.getElementById("drawerClose"),
  drawerTitle: document.getElementById("drawerTitle"),
  drawerLoading: document.getElementById("drawerLoading"),
  drawerError: document.getElementById("drawerError"),
  drawerHeadlines: document.getElementById("drawerHeadlines"),
  drawerNewsPanel: document.getElementById("drawerNewsPanel"),
  drawerAnnouncementsPanel: document.getElementById("drawerAnnouncementsPanel"),
  announcementsLoading: document.getElementById("announcementsLoading"),
  announcementsError: document.getElementById("announcementsError"),
  announcementsList: document.getElementById("announcementsList"),
  drawerFundamentalsPanel: document.getElementById("drawerFundamentalsPanel"),
  fundamentalsBody: document.getElementById("fundamentalsBody"),

  marketContext: document.getElementById("marketContext"),

  tradeModal: document.getElementById("tradeModal"),
  tradeModalBackdrop: document.getElementById("tradeModalBackdrop"),
  tradeModalClose: document.getElementById("tradeModalClose"),
  tradeModalTitle: document.getElementById("tradeModalTitle"),
  tmEntry: document.getElementById("tmEntry"),
  tmStop: document.getElementById("tmStop"),
  tmTarget: document.getElementById("tmTarget"),
  tmPortfolio: document.getElementById("tmPortfolio"),
  tmRisk: document.getElementById("tmRisk"),
  tmResult: document.getElementById("tmResult"),
  tmEarningsWarning: document.getElementById("tmEarningsWarning"),
};

const MODE_LABELS = {
  bullish: "Bullish candidates",
  bearish: "Bearish candidates",
  gainers: "Top gainers",
  losers: "Top losers",
  active: "Most active by volume",
};

let currentRows = [];
let sortState = { key: "change", dir: "desc" };
let shortlistCache = [];
let currentTradeSymbol = null;

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "shortlist") loadShortlist();
  });
});

// ---------- Formatting ----------
function formatNum(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function pctClass(n) {
  if (n == null || Number.isNaN(n)) return "";
  return n > 0 ? "pos" : n < 0 ? "neg" : "";
}

// ---------- Market context (VIX + FII/DII) ----------
async function loadMarketContext() {
  try {
    const res = await fetch("/api/market-context");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load market context");

    const parts = [];
    if (data.vix && !data.vix.error) {
      parts.push(`
        <div class="ctx-item">
          <span class="ctx-label">India VIX</span>
          <span class="ctx-value regime-${data.vix.regime}">${data.vix.value.toFixed(2)} (${data.vix.regime})</span>
        </div>
      `);
    }
    if (Array.isArray(data.flows)) {
      for (const flow of data.flows) {
        const cls = pctClass(flow.netValueCr);
        parts.push(`
          <div class="ctx-item">
            <span class="ctx-label">${flow.category} net</span>
            <span class="ctx-value ${cls}">${flow.netValueCr > 0 ? "+" : ""}₹${flow.netValueCr.toLocaleString("en-IN")}cr</span>
          </div>
        `);
      }
      if (data.flows[0]) parts.push(`<div class="ctx-item"><span class="ctx-label">As of</span><span class="ctx-value">${data.flows[0].date}</span></div>`);
    }
    els.marketContext.innerHTML = parts.length
      ? parts.join("")
      : `<span class="muted">Market context unavailable right now.</span>`;
  } catch (err) {
    els.marketContext.innerHTML = `<span class="muted">Market context unavailable: ${err.message}</span>`;
  }
}

// ---------- Screener ----------
function setLoading(isLoading) {
  els.resultsLoading.classList.toggle("hidden", !isLoading);
  els.resultsTable.classList.toggle("hidden", isLoading);
}

function setError(message) {
  if (!message) {
    els.resultsError.classList.add("hidden");
    els.resultsError.textContent = "";
    return;
  }
  els.resultsError.classList.remove("hidden");
  els.resultsError.textContent = message;
}

async function runScan() {
  const mode = els.mode.value;
  const exchanges = els.exchangeChecks.filter((c) => c.checked).map((c) => c.value);
  const minMarketCap = els.minMarketCap.value;
  const limit = els.limit.value;

  if (exchanges.length === 0) {
    setError("Select at least one exchange.");
    return;
  }

  setError(null);
  setLoading(true);
  els.resultsEmpty.classList.add("hidden");
  els.resultsTitle.textContent = MODE_LABELS[mode] || "Results";

  try {
    const params = new URLSearchParams({ mode, exchange: exchanges.join(","), minMarketCap, limit });
    const res = await fetch(`/api/screen?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Scan failed");

    const allRows = [];
    let totalUniverse = 0;
    for (const exResult of data.results) {
      totalUniverse += exResult.totalCount || 0;
      for (const row of exResult.rows) allRows.push({ ...row, exchange: exResult.exchange });
    }
    currentRows = allRows;
    sortAndRender();
    els.resultsSummary.textContent = `${allRows.length} matches, screened from ${totalUniverse.toLocaleString("en-IN")} listed symbols`;
    els.lastUpdated.textContent = `Last scan: ${new Date().toLocaleTimeString("en-IN")}`;
  } catch (err) {
    setError(err.message);
    currentRows = [];
    els.resultsBody.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

function sortAndRender() {
  const { key, dir } = sortState;
  const rows = [...currentRows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });
  renderResults(rows);
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("sort-active", th.dataset.sort === key);
  });
}

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortState.key === key) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    else sortState = { key, dir: "desc" };
    sortAndRender();
  });
});

function renderResults(rows) {
  els.resultsBody.innerHTML = "";
  if (rows.length === 0) {
    els.resultsEmpty.classList.remove("hidden");
    return;
  }
  els.resultsEmpty.classList.add("hidden");

  for (const row of rows) {
    const tr = document.createElement("tr");
    const starred = shortlistCache.some((s) => s.symbol === row.name);
    tr.innerHTML = `
      <td><button class="star-btn ${starred ? "active" : ""}" data-symbol="${row.name}">${starred ? "★" : "☆"}</button></td>
      <td class="symbol-cell">${row.exchange}:${row.name}<span class="company-name">${row.description || ""}</span></td>
      <td>${row.sector || "—"}</td>
      <td class="num">${formatNum(row.close)}</td>
      <td class="num ${pctClass(row.change)}">${formatPct(row.change)}</td>
      <td class="num">${row.RSI != null ? row.RSI.toFixed(1) : "—"}</td>
      <td class="num">${formatNum(row.EMA50)}</td>
      <td class="num">${row.relative_volume_10d_calc != null ? row.relative_volume_10d_calc.toFixed(2) + "x" : "—"}</td>
      <td class="num">${row.price_earnings_ttm != null ? row.price_earnings_ttm.toFixed(1) : "—"}</td>
      <td class="num ${row.return_on_equity_fq != null ? pctClass(row.return_on_equity_fq) : ""}">${row.return_on_equity_fq != null ? row.return_on_equity_fq.toFixed(1) + "%" : "—"}</td>
      <td><button class="btn-icon confirm-btn" data-symbol="${row.name}" data-exchange="${row.exchange}">Check</button></td>
      <td><button class="btn-icon news-btn" data-symbol="${row.name}">News</button></td>
      <td><button class="btn-icon plan-btn" data-symbol="${row.name}" data-close="${row.close}">Plan</button></td>
    `;
    tr.querySelector(".star-btn").addEventListener("click", (e) => toggleShortlist(row, e.currentTarget));
    tr.querySelector(".confirm-btn").addEventListener("click", (e) => runConfirm(row, e.currentTarget));
    tr.querySelector(".news-btn").addEventListener("click", () => openNewsDrawer(row));
    tr.querySelector(".plan-btn").addEventListener("click", () => openTradeModal(row));
    els.resultsBody.appendChild(tr);
  }
}

// ---------- Multi-timeframe confirm ----------
async function runConfirm(row, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const params = new URLSearchParams({ symbol: row.name, exchange: row.exchange });
    const res = await fetch(`/api/mtf?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Confirm failed");
    const { aligned, verdicts } = data.result;
    const label = aligned === "bullish" ? "Aligned ↑" : aligned === "bearish" ? "Aligned ↓" : "Mixed";
    btn.outerHTML = `<span class="confirm-badge ${aligned}" title="4H: ${verdicts["4H"]} · 1D: ${verdicts["1D"]} · 1W: ${verdicts["1W"]}">${label}</span>`;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Retry";
    btn.title = err.message;
  }
}

// ---------- Shortlist (server-persisted) ----------
async function fetchShortlist() {
  const res = await fetch("/api/shortlist");
  const data = await res.json();
  shortlistCache = data.ok ? data.items : [];
  return shortlistCache;
}

async function toggleShortlist(row, btn) {
  const isStarred = shortlistCache.some((s) => s.symbol === row.name);
  btn.disabled = true;
  try {
    if (isStarred) {
      await fetch(`/api/shortlist?symbol=${encodeURIComponent(row.name)}`, { method: "DELETE" });
    } else {
      await fetch("/api/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: row.name,
          exchange: row.exchange,
          company: row.description,
          priceAtAdd: row.close,
        }),
      });
    }
    await fetchShortlist();
    btn.classList.toggle("active", !isStarred);
    btn.textContent = !isStarred ? "★" : "☆";
  } finally {
    btn.disabled = false;
  }
}

async function loadShortlist() {
  await fetchShortlist();
  els.shortlistCount.textContent = `${shortlistCache.length} stock${shortlistCache.length === 1 ? "" : "s"}`;
  renderShortlistTable(shortlistCache.map((s) => ({ ...s, currentPrice: null, returnPct: null, daysHeld: null })));
}

function renderShortlistTable(items) {
  els.shortlistBody.innerHTML = "";
  els.shortlistEmpty.classList.toggle("hidden", items.length > 0);
  for (const item of items) {
    const daysHeld =
      item.daysHeld ?? Math.round((Date.now() - new Date(item.addedAt).getTime()) / 86_400_000);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="symbol-cell">${item.exchange}:${item.symbol}</td>
      <td>${item.company || "—"}</td>
      <td class="num">${formatNum(item.priceAtAdd)}</td>
      <td class="num">${item.currentPrice != null ? formatNum(item.currentPrice) : "—"}</td>
      <td class="num ${pctClass(item.returnPct)}">${item.returnPct != null ? formatPct(item.returnPct) : "—"}</td>
      <td class="num">${daysHeld}</td>
      <td><button class="remove-btn" data-symbol="${item.symbol}">remove</button></td>
    `;
    tr.querySelector(".remove-btn").addEventListener("click", async () => {
      await fetch(`/api/shortlist?symbol=${encodeURIComponent(item.symbol)}`, { method: "DELETE" });
      await loadShortlist();
    });
    els.shortlistBody.appendChild(tr);
  }
}

els.refreshPerformance.addEventListener("click", async () => {
  els.refreshPerformance.disabled = true;
  els.refreshPerformance.textContent = "Refreshing…";
  try {
    const res = await fetch("/api/shortlist/performance");
    const data = await res.json();
    if (data.ok) renderShortlistTable(data.items);
  } finally {
    els.refreshPerformance.disabled = false;
    els.refreshPerformance.textContent = "Refresh performance";
  }
});

els.exportCsv.addEventListener("click", () => {
  const header = ["Symbol", "Exchange", "Company", "Price at add", "Added at"];
  const rows = shortlistCache.map((s) => [s.symbol, s.exchange, s.company, s.priceAtAdd, s.addedAt]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "shortlist.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- News + announcements drawer ----------
document.querySelectorAll(".drawer-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".drawer-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.drawerTab;
    els.drawerNewsPanel.classList.toggle("hidden", tab !== "news");
    els.drawerAnnouncementsPanel.classList.toggle("hidden", tab !== "announcements");
    els.drawerFundamentalsPanel.classList.toggle("hidden", tab !== "fundamentals");
    if (tab === "announcements" && els.announcementsList.dataset.loadedFor !== els.drawerTitle.dataset.symbol) {
      loadAnnouncements(els.drawerTitle.dataset.symbol);
    }
  });
});

function formatFundamentals(row) {
  if (!row) return "No fundamentals data available for this row.";
  const lines = [
    ["P/E (TTM)", row.price_earnings_ttm != null ? row.price_earnings_ttm.toFixed(2) : "—"],
    ["P/B", row.price_book_fq != null ? row.price_book_fq.toFixed(2) : "—"],
    ["ROE (quarterly)", row.return_on_equity_fq != null ? row.return_on_equity_fq.toFixed(2) + "%" : "—"],
    ["Debt/Equity", row.debt_to_equity_fq != null ? row.debt_to_equity_fq.toFixed(2) : "—"],
    ["Dividend yield", row.dividend_yield_recent != null ? row.dividend_yield_recent.toFixed(2) + "%" : "—"],
    ["EPS growth YoY (TTM)", row.earnings_per_share_diluted_yoy_growth_ttm != null ? row.earnings_per_share_diluted_yoy_growth_ttm.toFixed(2) + "%" : "—"],
    ["Revenue growth YoY (TTM)", row.total_revenue_yoy_growth_ttm != null ? row.total_revenue_yoy_growth_ttm.toFixed(2) + "%" : "—"],
    ["Next earnings date", row.earnings_release_next_date != null ? new Date(row.earnings_release_next_date * 1000).toLocaleDateString("en-IN") : "—"],
  ];
  return lines.map(([label, value]) => `${label.padEnd(26, " ")}${value}`).join("\n");
}

async function openNewsDrawer(row) {
  const { name: symbol, description: company } = row;
  els.drawer.classList.remove("hidden");
  els.drawerTitle.textContent = `${symbol} — recent news`;
  els.drawerTitle.dataset.symbol = symbol;
  els.drawerHeadlines.innerHTML = "";
  els.drawerError.classList.add("hidden");
  els.drawerLoading.classList.remove("hidden");
  els.announcementsList.innerHTML = "";
  els.announcementsList.removeAttribute("data-loaded-for");
  els.fundamentalsBody.textContent = formatFundamentals(row);
  document.querySelectorAll(".drawer-tab-btn")[0].click();

  try {
    const params = new URLSearchParams({ symbol, company, days: "14", limit: "10" });
    const res = await fetch(`/api/news?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "News fetch failed");
    const result = data.result;
    if (result.error) throw new Error(result.error);

    if (result.headlines.length === 0) {
      els.drawerHeadlines.innerHTML = `<li class="muted">No recent headlines found in the last 14 days.</li>`;
    } else {
      for (const h of result.headlines) {
        const li = document.createElement("li");
        li.className = `headline-item ${h.tag}`;
        li.innerHTML = `
          <a class="headline-title" href="${h.link}" target="_blank" rel="noopener">${h.title}</a>
          <div class="headline-meta">${h.source || ""} · ${h.pubDate || ""}</div>
        `;
        els.drawerHeadlines.appendChild(li);
      }
    }
  } catch (err) {
    els.drawerError.classList.remove("hidden");
    els.drawerError.textContent = err.message;
  } finally {
    els.drawerLoading.classList.add("hidden");
  }
}

async function loadAnnouncements(symbol) {
  els.announcementsList.innerHTML = "";
  els.announcementsError.classList.add("hidden");
  els.announcementsLoading.classList.remove("hidden");
  try {
    const params = new URLSearchParams({ symbol, limit: "8" });
    const res = await fetch(`/api/announcements?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Announcements fetch failed");
    if (data.items.length === 0) {
      els.announcementsList.innerHTML = `<li class="muted">No recent official filings found.</li>`;
    } else {
      for (const item of data.items) {
        const li = document.createElement("li");
        li.className = "headline-item";
        li.innerHTML = `
          <a class="headline-title" href="${item.attachmentUrl}" target="_blank" rel="noopener">${item.subject}</a>
          <div class="headline-meta">${item.date || ""}</div>
          <div class="headline-meta">${(item.detail || "").slice(0, 160)}</div>
        `;
        els.announcementsList.appendChild(li);
      }
    }
    els.announcementsList.dataset.loadedFor = symbol;
  } catch (err) {
    els.announcementsError.classList.remove("hidden");
    els.announcementsError.textContent = err.message;
  } finally {
    els.announcementsLoading.classList.add("hidden");
  }
}

function closeDrawer() {
  els.drawer.classList.add("hidden");
}
els.drawerClose.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);

// ---------- Position sizing / Kite ticket modal ----------
function openTradeModal(row) {
  currentTradeSymbol = row.name;
  els.tradeModal.classList.remove("hidden");
  els.tradeModalTitle.textContent = `Plan trade — ${row.exchange}:${row.name}`;
  els.tmEntry.value = row.close;
  els.tmStop.value = "";
  els.tmTarget.value = "";
  els.tmResult.textContent = "Enter a stop-loss and target to see position size and a Kite-ready order ticket.";
  els.tmResult.classList.remove("warn");

  if (row.earnings_release_next_date) {
    const earningsDate = new Date(row.earnings_release_next_date * 1000);
    const daysAway = Math.round((earningsDate.getTime() - Date.now()) / 86_400_000);
    if (daysAway >= 0 && daysAway <= 7) {
      els.tmEarningsWarning.classList.remove("hidden");
      els.tmEarningsWarning.textContent = `⚠ Earnings expected on ${earningsDate.toLocaleDateString("en-IN")} (${daysAway} day${daysAway === 1 ? "" : "s"} away) — your rules say avoid new trades on earnings day unless you've confirmed you want the volatility.`;
    } else {
      els.tmEarningsWarning.classList.add("hidden");
    }
  } else {
    els.tmEarningsWarning.classList.add("hidden");
  }
}

function computeTrade() {
  const entry = Number(els.tmEntry.value);
  const stop = Number(els.tmStop.value);
  const target = Number(els.tmTarget.value);
  const portfolio = Number(els.tmPortfolio.value);
  const riskPct = Number(els.tmRisk.value);

  if (!entry || !stop || stop >= entry) {
    els.tmResult.textContent = "Enter an entry price and a stop-loss below the entry price.";
    els.tmResult.classList.remove("warn");
    return;
  }

  const riskAmount = portfolio * (riskPct / 100);
  const perShareRisk = entry - stop;
  const quantity = Math.floor(riskAmount / perShareRisk);
  const investment = quantity * entry;
  const rr = target ? (target - entry) / perShareRisk : null;

  if (quantity <= 0) {
    els.tmResult.textContent = `Risk budget (₹${riskAmount.toFixed(0)}) is smaller than the per-share risk (₹${perShareRisk.toFixed(2)}) — this stop is too wide for your risk rule, or quantity would be 0.`;
    els.tmResult.classList.add("warn");
    return;
  }

  const rrWarning = rr != null && rr < 2 ? `\n⚠ Reward:Risk is ${rr.toFixed(2)}:1 — below your 2:1 minimum.` : "";

  els.tmResult.classList.toggle("warn", rr != null && rr < 2);
  els.tmResult.textContent =
    `Risk budget: ₹${riskAmount.toFixed(0)} (${riskPct}% of ₹${portfolio.toLocaleString("en-IN")})\n` +
    `Per-share risk: ₹${perShareRisk.toFixed(2)}\n` +
    `Quantity: ${quantity} shares\n` +
    `Investment: ₹${investment.toFixed(0)}\n` +
    (rr != null ? `Reward:Risk: ${rr.toFixed(2)}:1${rrWarning}\n` : "") +
    `\n--- Kite order ticket ---\n` +
    `${currentTradeSymbol}  |  BUY  |  Qty: ${quantity}  |  Order type: LIMIT @ ₹${entry}\n` +
    `Stop-loss (GTT): ₹${stop.toFixed(2)}` +
    (target ? `\nTarget (GTT): ₹${target.toFixed(2)}` : "");
}

[els.tmEntry, els.tmStop, els.tmTarget, els.tmPortfolio, els.tmRisk].forEach((input) =>
  input.addEventListener("input", computeTrade)
);

function closeTradeModal() {
  els.tradeModal.classList.add("hidden");
}
els.tradeModalClose.addEventListener("click", closeTradeModal);
els.tradeModalBackdrop.addEventListener("click", closeTradeModal);

// ---------- Backtest ----------
els.backtestVisible.addEventListener("click", () => {
  const symbols = currentRows.slice(0, 25).map((r) => r.name);
  els.btSymbols.value = symbols.join(",");
  els.btRange.value = "5y";
  document.querySelector('.tab-btn[data-tab="backtest"]').click();
  runBacktestNow();
});

els.runBacktest.addEventListener("click", runBacktestNow);

async function runBacktestNow() {
  const symbols = els.btSymbols.value
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) {
    els.backtestError.classList.remove("hidden");
    els.backtestError.textContent = "Enter at least one symbol.";
    return;
  }

  els.backtestError.classList.add("hidden");
  els.backtestSummary.classList.add("hidden");
  els.backtestTable.classList.add("hidden");
  els.backtestLoading.classList.remove("hidden");

  try {
    const params = new URLSearchParams({
      symbols: symbols.join(","),
      exchange: "NSE",
      range: els.btRange.value,
      holdDays: els.btHold.value,
    });
    const res = await fetch(`/api/backtest?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Backtest failed");
    renderBacktest(data);
  } catch (err) {
    els.backtestError.classList.remove("hidden");
    els.backtestError.textContent = err.message;
  } finally {
    els.backtestLoading.classList.add("hidden");
  }
}

function renderBacktest(data) {
  if (data.aggregate) {
    els.backtestSummary.classList.remove("hidden");
    els.backtestSummary.innerHTML = `
      <div class="stat-item"><span class="stat-value">${data.aggregate.totalSignals}</span><span class="stat-label">Total bullish signals</span></div>
      <div class="stat-item"><span class="stat-value ${pctClass(data.aggregate.avgWinRatePct - 50)}">${data.aggregate.avgWinRatePct.toFixed(1)}%</span><span class="stat-label">Avg win rate</span></div>
      <div class="stat-item"><span class="stat-value ${pctClass(data.aggregate.avgReturnPct)}">${formatPct(data.aggregate.avgReturnPct)}</span><span class="stat-label">Avg forward return (${data.holdDays}d)</span></div>
      <div class="stat-item"><span class="stat-value">${data.aggregate.symbolsWithSignals}</span><span class="stat-label">Symbols with signals</span></div>
    `;
  }

  els.backtestTable.classList.remove("hidden");
  els.backtestBody.innerHTML = "";
  for (const r of data.results) {
    const tr = document.createElement("tr");
    if (r.error) {
      tr.innerHTML = `<td>${r.symbol}</td><td colspan="7" class="muted">${r.error}</td>`;
    } else {
      const b = r.summary.bullish;
      tr.innerHTML = `
        <td class="symbol-cell">${r.exchange}:${r.symbol}</td>
        <td class="num">${b ? b.count : 0}</td>
        <td class="num ${b ? pctClass(b.winRatePct - 50) : ""}">${b ? b.winRatePct.toFixed(1) + "%" : "—"}</td>
        <td class="num ${b ? pctClass(b.avgReturnPct) : ""}">${b ? formatPct(b.avgReturnPct) : "—"}</td>
        <td class="num">${b ? b.hitTargetPct.toFixed(0) + "%" : "—"}</td>
        <td class="num">${b ? b.hitStopPct.toFixed(0) + "%" : "—"}</td>
        <td class="num">${b ? b.timedOutPct.toFixed(0) + "%" : "—"}</td>
        <td class="num ${pctClass(r.summary.buyAndHoldPct)}">${formatPct(r.summary.buyAndHoldPct)}</td>
      `;
    }
    els.backtestBody.appendChild(tr);
  }
}

// ---------- Init ----------
els.runScan.addEventListener("click", runScan);

(async function init() {
  await fetchShortlist();
  runScan();
  loadMarketContext();
})();

/*! Albireus Yahoo Stocks — main UI */
(function () {
  "use strict";

  const DEFAULT_WATCH = [
    { symbol: "2330.TW", name: "台積電" },
    { symbol: "2317.TW", name: "鴻海" },
    { symbol: "2454.TW", name: "聯發科" },
    { symbol: "2303.TW", name: "聯電" },
    { symbol: "2881.TW", name: "富邦金" },
    { symbol: "0050.TW", name: "元大台灣50" },
    { symbol: "AAPL", name: "Apple" },
    { symbol: "NVDA", name: "NVIDIA" },
    { symbol: "TSLA", name: "Tesla" },
    { symbol: "^TWII", name: "加權指數" },
  ];

  const MA_COLORS = {
    5: "#f59e0b",
    10: "#8b5cf6",
    20: "#0d9488",
    60: "#3b82f6",
    120: "#ec4899",
    240: "#64748b",
  };

  const state = {
    symbol: "2330.TW",
    theme: "auto",
    refreshSec: 20,
    ma: new Set([5, 10, 20, 60]),
    inds: new Set(),
    bars: [],
    quoteTimer: null,
    searchTimer: null,
    syncing: false,
  };

  const el = {
    search: document.getElementById("searchInput"),
    suggest: document.getElementById("suggest"),
    btnLoad: document.getElementById("btnLoad"),
    btnRefresh: document.getElementById("btnRefresh"),
    error: document.getElementById("errorBanner"),
    qSymbol: document.getElementById("qSymbol"),
    qPrice: document.getElementById("qPrice"),
    qChg: document.getElementById("qChg"),
    qMeta: document.getElementById("qMeta"),
    qStatus: document.getElementById("qStatus"),
    watchList: document.getElementById("watchList"),
    chartMain: document.getElementById("chartMain"),
    chartVol: document.getElementById("chartVol"),
    chartKd: document.getElementById("chartKd"),
    chartMacd: document.getElementById("chartMacd"),
    chartRsi: document.getElementById("chartRsi"),
    chartObv: document.getElementById("chartObv"),
    paneKd: document.getElementById("paneKd"),
    paneMacd: document.getElementById("paneMacd"),
    paneRsi: document.getElementById("paneRsi"),
    paneObv: document.getElementById("paneObv"),
  };

  /** @type {Record<string, import('lightweight-charts').IChartApi>} */
  const charts = {};
  /** @type {Record<string, any>} */
  const series = {};

  function apiBase() {
    // Same-origin Next proxy when served from Albireus; fall back for file://
    if (location.protocol === "file:") return "http://localhost:3000/api/stocks";
    return "/api/stocks";
  }

  function showError(msg) {
    if (!msg) {
      el.error.classList.remove("show");
      el.error.textContent = "";
      return;
    }
    el.error.textContent = msg;
    el.error.classList.add("show");
  }

  function parseSettings() {
    const qs = new URLSearchParams(location.search);
    let settings = {};
    try {
      settings = JSON.parse(qs.get("settings") || "{}");
    } catch {
      /* ignore */
    }
    for (const [k, v] of qs.entries()) {
      if (k.startsWith("s_")) settings[k.slice(2)] = v;
    }
    if (settings.default_symbol) state.symbol = String(settings.default_symbol).trim().toUpperCase();
    if (settings.refresh_seconds != null) {
      const n = Number(settings.refresh_seconds);
      if (Number.isFinite(n) && n >= 10 && n <= 120) state.refreshSec = n;
    }
    if (settings.theme) state.theme = String(settings.theme);
    applyTheme(state.theme);
  }

  function applyTheme(theme) {
    state.theme = theme || "auto";
    document.documentElement.setAttribute("data-theme", state.theme);
    // Rebuild chart colors if charts exist
    if (charts.main) {
      const opts = chartOptions();
      Object.values(charts).forEach((c) => {
        c.applyOptions({
          layout: opts.layout,
          grid: opts.grid,
          rightPriceScale: opts.rightPriceScale,
          timeScale: opts.timeScale,
          crosshair: opts.crosshair,
        });
      });
    }
  }

  function isDark() {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function chartOptions() {
    const dark = isDark();
    const text = dark ? "#94a3b8" : "#787774";
    const border = dark ? "rgba(148,163,184,0.16)" : "rgba(55,53,47,0.09)";
    const grid = dark ? "rgba(148,163,184,0.1)" : "rgba(55,53,47,0.06)";
    const bg = dark ? "#151c2c" : "#ffffff";
    return {
      layout: {
        background: { type: "solid", color: bg },
        textColor: text,
        fontFamily: "Outfit, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      rightPriceScale: {
        borderColor: border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: border,
        timeVisible: false,
        rightOffset: 4,
        barSpacing: 6,
        minBarSpacing: 2,
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    };
  }

  function createCharts() {
    const LC = window.LightweightCharts;
    if (!LC) {
      showError("圖表函式庫載入失敗，請重新整理。");
      return;
    }

    const base = chartOptions();

    charts.main = LC.createChart(el.chartMain, {
      ...base,
      height: el.chartMain.parentElement.clientHeight || 320,
    });
    series.candle = charts.main.addCandlestickSeries({
      upColor: "#e03e3e",
      downColor: "#0f7b6c",
      borderUpColor: "#e03e3e",
      borderDownColor: "#0f7b6c",
      wickUpColor: "#e03e3e",
      wickDownColor: "#0f7b6c",
    });
    series.ma = {};
    [5, 10, 20, 60, 120, 240].forEach((p) => {
      series.ma[p] = charts.main.addLineSeries({
        color: MA_COLORS[p],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: state.ma.has(p),
      });
    });

    charts.vol = LC.createChart(el.chartVol, {
      ...base,
      height: el.chartVol.parentElement.clientHeight || 90,
    });
    charts.vol.priceScale("right").applyOptions({
      scaleMargins: { top: 0.1, bottom: 0 },
    });
    series.vol = charts.vol.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "right",
    });

    charts.kd = LC.createChart(el.chartKd, { ...base, height: 110 });
    series.k = charts.kd.addLineSeries({ color: "#f59e0b", lineWidth: 1, lastValueVisible: false });
    series.d = charts.kd.addLineSeries({ color: "#3b82f6", lineWidth: 1, lastValueVisible: false });

    charts.macd = LC.createChart(el.chartMacd, { ...base, height: 110 });
    series.macdHist = charts.macd.addHistogramSeries({ priceScaleId: "right" });
    series.dif = charts.macd.addLineSeries({ color: "#0d9488", lineWidth: 1, lastValueVisible: false });
    series.dea = charts.macd.addLineSeries({ color: "#f59e0b", lineWidth: 1, lastValueVisible: false });

    charts.rsi = LC.createChart(el.chartRsi, { ...base, height: 110 });
    series.rsi = charts.rsi.addLineSeries({ color: "#8b5cf6", lineWidth: 1, lastValueVisible: false });

    charts.obv = LC.createChart(el.chartObv, { ...base, height: 110 });
    series.obv = charts.obv.addLineSeries({ color: "#64748b", lineWidth: 1, lastValueVisible: false });

    // Sync time scales: drag / zoom on any pane
    const list = ["main", "vol", "kd", "macd", "rsi", "obv"];
    list.forEach((key) => {
      charts[key].timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || state.syncing) return;
        state.syncing = true;
        list.forEach((other) => {
          if (other === key) return;
          try {
            charts[other].timeScale().setVisibleLogicalRange(range);
          } catch {
            /* ignore */
          }
        });
        state.syncing = false;
      });
    });

    const ro = new ResizeObserver(() => resizeCharts());
    ro.observe(document.getElementById("charts"));
    window.addEventListener("resize", resizeCharts);
  }

  function resizeCharts() {
    if (!charts.main) return;
    const mainH = el.chartMain.parentElement.clientHeight || 280;
    charts.main.applyOptions({ width: el.chartMain.clientWidth, height: mainH });
    charts.vol.applyOptions({
      width: el.chartVol.clientWidth,
      height: el.chartVol.parentElement.clientHeight || 90,
    });
    ["kd", "macd", "rsi", "obv"].forEach((k) => {
      const host = el["chart" + k.charAt(0).toUpperCase() + k.slice(1)];
      if (!host || !charts[k]) return;
      charts[k].applyOptions({
        width: host.clientWidth,
        height: host.parentElement.clientHeight || 110,
      });
    });
  }

  function toDay(t) {
    // Yahoo returns unix seconds; lightweight-charts expects UTCTimestamp or business day
    const d = new Date(t * 1000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }

  function fmtNum(n, digits) {
    if (n == null || !Number.isFinite(n)) return "—";
    return n.toLocaleString("zh-TW", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toFixed(2) + "%";
  }

  async function fetchJson(path) {
    const res = await fetch(apiBase() + path);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "請求失敗 " + res.status);
    return data;
  }

  async function loadChart(symbol) {
    state.symbol = normalizeLocal(symbol);
    el.qStatus.textContent = "載入 K 線…";
    showError("");
    try {
      const data = await fetchJson(
        "/chart?symbol=" + encodeURIComponent(state.symbol) + "&range=2y&interval=1d"
      );
      state.bars = data.bars || [];
      if (!state.bars.length) throw new Error("無日 K 資料");
      renderBars(data);
      await refreshQuote();
      highlightWatch();
      el.search.value = state.symbol;
      el.qStatus.textContent = "已更新 " + new Date().toLocaleTimeString("zh-TW");
      startQuotePoll();
    } catch (e) {
      showError(e.message || "載入失敗");
      el.qStatus.textContent = "錯誤";
    }
  }

  function normalizeLocal(s) {
    const t = String(s || "").trim().toUpperCase();
    if (/^\d{4,6}$/.test(t)) return t + ".TW";
    return t;
  }

  function renderBars(meta) {
    const bars = state.bars;
    const Ind = window.StockIndicators;
    const times = bars.map((b) => toDay(b.time));
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const vols = bars.map((b) => b.volume || 0);

    const candles = bars.map((b) => ({
      time: toDay(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
    series.candle.setData(candles);

    [5, 10, 20, 60, 120, 240].forEach((p) => {
      const vals = Ind.sma(closes, p);
      const pts = [];
      for (let i = 0; i < times.length; i++) {
        if (vals[i] == null) continue;
        pts.push({ time: times[i], value: vals[i] });
      }
      series.ma[p].setData(pts);
      series.ma[p].applyOptions({ visible: state.ma.has(p) });
    });

    const volData = bars.map((b) => ({
      time: toDay(b.time),
      value: b.volume || 0,
      color: b.close >= b.open ? "rgba(224,62,62,0.55)" : "rgba(15,123,108,0.55)",
    }));
    series.vol.setData(volData);

    const { k, d } = Ind.kd(highs, lows, closes);
    series.k.setData(Ind.toLinePoints(times, k));
    series.d.setData(Ind.toLinePoints(times, d));

    const m = Ind.macd(closes);
    series.dif.setData(Ind.toLinePoints(times, m.dif));
    series.dea.setData(Ind.toLinePoints(times, m.dea));
    series.macdHist.setData(
      times
        .map((t, i) => {
          if (m.hist[i] == null) return null;
          return {
            time: t,
            value: m.hist[i],
            color: m.hist[i] >= 0 ? "rgba(224,62,62,0.55)" : "rgba(15,123,108,0.55)",
          };
        })
        .filter(Boolean)
    );

    series.rsi.setData(Ind.toLinePoints(times, Ind.rsi(closes)));
    series.obv.setData(Ind.toLinePoints(times, Ind.obv(closes, vols)));

    const name = meta.shortName || meta.longName || "";
    el.qSymbol.textContent = (meta.symbol || state.symbol) + (name ? " · " + name : "");
    el.qMeta.textContent = [meta.exchange, meta.currency, "日 K " + bars.length + " 根"]
      .filter(Boolean)
      .join(" · ");

    charts.main.timeScale().fitContent();
    resizeCharts();
    updateIndPanes();
  }

  async function refreshQuote() {
    try {
      const q = await fetchJson("/quote?symbol=" + encodeURIComponent(state.symbol));
      const price = q.price;
      const chg = q.change;
      const pct = q.changePercent;
      el.qPrice.textContent = fmtNum(price, price != null && price < 10 ? 3 : 2);
      const up = (chg || 0) >= 0;
      el.qChg.className = "chg " + (up ? "up" : "down");
      el.qChg.textContent =
        (chg != null ? (up ? "+" : "") + fmtNum(chg, 2) : "—") +
        " (" +
        fmtPct(pct) +
        ")";
      const bits = [];
      if (q.dayHigh != null) bits.push("高 " + fmtNum(q.dayHigh, 2));
      if (q.dayLow != null) bits.push("低 " + fmtNum(q.dayLow, 2));
      if (q.volume != null) bits.push("量 " + fmtNum(q.volume, 0));
      if (bits.length) {
        el.qMeta.textContent =
          [q.exchange, q.currency].filter(Boolean).join(" · ") +
          (bits.length ? " · " + bits.join(" · ") : "");
      }
      el.qStatus.textContent = "報價 " + new Date().toLocaleTimeString("zh-TW");
      updateWatchQuote(q);
    } catch (e) {
      el.qStatus.textContent = "報價暫不可用";
    }
  }

  function startQuotePoll() {
    stopQuotePoll();
    const tick = () => {
      if (document.hidden) return;
      refreshQuote();
    };
    state.quoteTimer = setInterval(tick, state.refreshSec * 1000);
  }

  function stopQuotePoll() {
    if (state.quoteTimer) {
      clearInterval(state.quoteTimer);
      state.quoteTimer = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopQuotePoll();
    else {
      refreshQuote();
      startQuotePoll();
    }
  });

  function updateIndPanes() {
    const map = {
      kd: el.paneKd,
      macd: el.paneMacd,
      rsi: el.paneRsi,
      obv: el.paneObv,
    };
    Object.keys(map).forEach((k) => {
      map[k].classList.toggle("visible", state.inds.has(k));
    });
    requestAnimationFrame(resizeCharts);
  }

  function renderWatchList() {
    el.watchList.innerHTML = "";
    DEFAULT_WATCH.forEach((w) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "watch-item" + (w.symbol === state.symbol ? " active" : "");
      btn.dataset.symbol = w.symbol;
      btn.innerHTML =
        '<div class="row"><span class="sym">' +
        w.symbol.replace(".TW", "") +
        '</span><span class="px" data-px>—</span></div>' +
        '<div class="row"><span class="nm">' +
        w.name +
        '</span><span class="pct" data-pct></span></div>';
      btn.addEventListener("click", () => loadChart(w.symbol));
      el.watchList.appendChild(btn);
    });
    // Soft-refresh watch quotes
    DEFAULT_WATCH.forEach((w) => {
      fetchJson("/quote?symbol=" + encodeURIComponent(w.symbol))
        .then((q) => updateWatchQuote(q))
        .catch(() => {});
    });
  }

  function highlightWatch() {
    el.watchList.querySelectorAll(".watch-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.symbol === state.symbol);
    });
  }

  function updateWatchQuote(q) {
    if (!q || !q.symbol) return;
    const node = el.watchList.querySelector('[data-symbol="' + q.symbol + '"]');
    if (!node) return;
    const px = node.querySelector("[data-px]");
    const pct = node.querySelector("[data-pct]");
    if (px) px.textContent = fmtNum(q.price, q.price != null && q.price < 10 ? 2 : 1);
    if (pct) {
      const up = (q.changePercent || 0) >= 0;
      pct.className = "pct " + (up ? "up" : "down");
      pct.textContent = fmtPct(q.changePercent);
    }
  }

  // Search
  el.search.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    const q = el.search.value.trim();
    if (q.length < 1) {
      el.suggest.classList.remove("open");
      el.suggest.innerHTML = "";
      return;
    }
    state.searchTimer = setTimeout(() => runSearch(q), 280);
  });

  el.search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.suggest.classList.remove("open");
      loadChart(el.search.value);
    } else if (e.key === "Escape") {
      el.suggest.classList.remove("open");
    }
  });

  async function runSearch(q) {
    try {
      const data = await fetchJson("/search?q=" + encodeURIComponent(q));
      const results = data.results || [];
      if (!results.length) {
        el.suggest.innerHTML = '<button type="button" disabled>無結果</button>';
        el.suggest.classList.add("open");
        return;
      }
      el.suggest.innerHTML = results
        .map(
          (r) =>
            '<button type="button" role="option" data-sym="' +
            escapeAttr(r.symbol) +
            '"><span class="sym">' +
            escapeHtml(r.symbol) +
            '</span><span class="name">' +
            escapeHtml(r.shortname || r.longname || r.exchange || "") +
            "</span></button>"
        )
        .join("");
      el.suggest.classList.add("open");
      el.suggest.querySelectorAll("button[data-sym]").forEach((b) => {
        b.addEventListener("click", () => {
          el.suggest.classList.remove("open");
          loadChart(b.dataset.sym);
        });
      });
    } catch {
      el.suggest.classList.remove("open");
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, "&quot;");
  }

  document.addEventListener("click", (e) => {
    if (!el.suggest.contains(e.target) && e.target !== el.search) {
      el.suggest.classList.remove("open");
    }
  });

  el.btnLoad.addEventListener("click", () => loadChart(el.search.value || state.symbol));
  el.btnRefresh.addEventListener("click", async () => {
    await loadChart(state.symbol);
  });

  document.querySelectorAll("[data-ma]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.ma);
      if (state.ma.has(p)) state.ma.delete(p);
      else state.ma.add(p);
      btn.classList.toggle("active", state.ma.has(p));
      if (series.ma && series.ma[p]) series.ma[p].applyOptions({ visible: state.ma.has(p) });
    });
  });

  document.querySelectorAll("[data-ind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.ind;
      if (state.inds.has(k)) state.inds.delete(k);
      else state.inds.add(k);
      btn.classList.toggle("active", state.inds.has(k));
      updateIndPanes();
    });
  });

  window.addEventListener("message", (e) => {
    if (e.data?.type === "albireus:settings") {
      const s = e.data.settings || {};
      if (s.theme) applyTheme(String(s.theme));
      if (s.refresh_seconds != null) {
        const n = Number(s.refresh_seconds);
        if (Number.isFinite(n) && n >= 10) {
          state.refreshSec = n;
          startQuotePoll();
        }
      }
      if (s.default_symbol && String(s.default_symbol).toUpperCase() !== state.symbol) {
        loadChart(String(s.default_symbol));
      }
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.theme === "auto") applyTheme("auto");
  });

  // Boot
  parseSettings();
  createCharts();
  renderWatchList();
  loadChart(state.symbol);
})();

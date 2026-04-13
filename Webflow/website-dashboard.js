(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__STORKAUP_WEBSITE_DASHBOARD_INIT__) return;
  window.__STORKAUP_WEBSITE_DASHBOARD_INIT__ = true;

  var DEBUG = true;
  var pageReadySent = false;

  function log() { if (DEBUG && window.console) console.log.apply(console, arguments); }

  function emitPageReady() {
    if (pageReadySent) return;
    pageReadySent = true;
    document.dispatchEvent(new CustomEvent("storkaup:page-ready"));
  }

  function getCfg() { return window.STORKAUP_CONFIG || {}; }

  function getRpcUrl() {
    var cfg = getCfg();
    return (cfg.supabaseUrl || "") + "/rest/v1/rpc/website_kpi_pack";
  }

  function toNumberSafe(v) {
    if (typeof v === "number") return v;
    if (v == null) return 0;
    var cleaned = v.toString().replace(/[^0-9.-]/g, "");
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function formatNumber(v) {
    var n = Math.round(toNumberSafe(v));
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function pct(n) {
    var value = toNumberSafe(n);
    return (Math.round(value * 1000) / 10) + "%";
  }

  function clamp01(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function getRequestedDay() {
    var fromBody = document.body ? String(document.body.getAttribute("data-website-kpi-day") || "").trim() : "";
    if (!fromBody || fromBody.toLowerCase() === "yesterday") {
      var d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    if (fromBody.toLowerCase() === "today") {
      return new Date().toISOString().slice(0, 10);
    }
    return fromBody;
  }

  function setText(metric, valueText) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (el) el.textContent = valueText;
  }

  function setSignedPct(metric, rawValue) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (!el) return;
    var n = toNumberSafe(rawValue);
    el.textContent = pct(n);
    el.classList.remove("is-pos", "is-neg", "is-flat");
    if (n > 0.0001) el.classList.add("is-pos");
    else if (n < -0.0001) el.classList.add("is-neg");
    else el.classList.add("is-flat");
  }

  function buildMetricMap() {
    var out = {};
    function put(key, value) {
      out[key] = Math.max(0, Math.min(100, toNumberSafe(value)));
    }

    var sessions = toNumberSafe(document.querySelector('[data-metric="website-sessions"]') && document.querySelector('[data-metric="website-sessions"]').textContent);
    var users = toNumberSafe(document.querySelector('[data-metric="website-users"]') && document.querySelector('[data-metric="website-users"]').textContent);
    var pageviews = toNumberSafe(document.querySelector('[data-metric="website-pageviews"]') && document.querySelector('[data-metric="website-pageviews"]').textContent);
    var addToCart = toNumberSafe(document.querySelector('[data-metric="website-add-to-cart"]') && document.querySelector('[data-metric="website-add-to-cart"]').textContent);
    var beginCheckout = toNumberSafe(document.querySelector('[data-metric="website-begin-checkout"]') && document.querySelector('[data-metric="website-begin-checkout"]').textContent);
    var purchaseEvents = toNumberSafe(document.querySelector('[data-metric="website-purchase-events"]') && document.querySelector('[data-metric="website-purchase-events"]').textContent);
    var engagementRateText = document.querySelector('[data-metric="website-engagement-rate"]');
    var engagementRate = engagementRateText ? toNumberSafe(String(engagementRateText.textContent || "").replace("%", "")) : 0;

    put("website-sessions-fill", sessions);
    put("website-users-fill", users);
    put("website-pageviews-fill", pageviews);
    put("website-engagement-rate-fill", engagementRate);
    put("website-add-to-cart-fill", addToCart);
    put("website-begin-checkout-fill", beginCheckout);
    put("website-purchase-events-fill", purchaseEvents);
    return out;
  }

  function updateMeters(values) {
    document.querySelectorAll(".meter-fill[data-fill-from]").forEach(function (fill) {
      var key = fill.getAttribute("data-fill-from");
      var p = values[key];
      if (p == null) return;
      fill.style.width = p + "%";
    });
  }

  function findTopChannelsHost() {
    var direct = document.querySelector('[data-role="website-top-channels"]');
    if (direct) return direct;

    var cards = document.querySelectorAll(".webapp-item");
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var txt = (card.textContent || "").toLowerCase();
      if (txt.indexOf("top channels") !== -1) {
        return card.querySelector(".webapp-data") || card;
      }
    }
    return null;
  }

  function renderTopChannels(items) {
    var host = findTopChannelsHost();
    if (!host) return;

    var list = Array.isArray(items) ? items : [];
    if (!list.length) {
      host.textContent = "Engin gögn";
      return;
    }

    var html = "";
    list.forEach(function (item, idx) {
      html += ''
        + '<div class="website-channel-row" data-index="' + idx + '">'
        +   '<span class="website-channel-name">' + escapeHtml(String(item.channel || "")) + '</span>'
        +   '<span class="website-channel-value">' + formatNumber(item.sessions) + '</span>'
        + '</div>';
    });
    host.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeRpcPayload(raw) {
    var data = raw;
    if (Array.isArray(data)) data = data[0];
    return data || null;
  }

  function formatDayLabel(day) {
    var s = String(day || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var parts = s.split("-");
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    try {
      return new Intl.DateTimeFormat("is-IS", {
        day: "numeric",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC"
      }).format(d);
    } catch (_err) {
      return s;
    }
  }

  function applyWebsiteMetrics(row) {
    if (!row) return;

    setText("website-last-updated", formatDayLabel(row.day));
    setText("website-sessions", formatNumber(row.sessions));
    setText("website-users", formatNumber(row.total_users));
    setText("website-pageviews", formatNumber(row.screen_page_views));
    setText("website-engagement-rate", pct(clamp01(row.engagement_rate)));
    setText("website-add-to-cart", formatNumber(row.add_to_cart));
    setText("website-begin-checkout", formatNumber(row.begin_checkout));
    setText("website-purchase-events", formatNumber(row.purchases));

    setSignedPct("website-sessions-vs-prev7", row.vs_prev7_sessions_pct);
    setSignedPct("website-users-vs-prev7", row.vs_prev7_users_pct);
    setSignedPct("website-pageviews-vs-prev7", row.vs_prev7_page_views_pct);
    setSignedPct("website-purchases-vs-prev7", row.vs_prev7_purchases_pct);

    renderTopChannels(row.top_channels);
    updateMeters(buildMetricMap());
  }

  function fetchWebsiteKpis() {
    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) {
      log("Missing Supabase config for website dashboard");
      emitPageReady();
      return Promise.resolve();
    }

    return fetch(getRpcUrl(), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey,
        "Content-Profile": "public"
      },
      body: JSON.stringify({ p_day: getRequestedDay() })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("website_kpi_pack HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        var row = normalizeRpcPayload(raw);
        applyWebsiteMetrics(row);
        emitPageReady();
      })
      .catch(function (err) {
        log("Website KPI fetch failed:", err);
        emitPageReady();
      });
  }

  function init() {
    var hasMetrics = !!document.querySelector('[data-metric^="website-"]');
    if (!hasMetrics) return;
    fetchWebsiteKpis();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

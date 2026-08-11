(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__STORKAUP_DASHBOARD_INIT__) return;
  window.__STORKAUP_DASHBOARD_INIT__ = true;
  var selectedDay = getTodayIso();
  var selectedWeekdayIso = null; // 1..7 (Mon..Sun) for separate weekday-average chart override
  var weekdayGridCacheDay = null;
  var weekdayGridCacheTs = 0;
  var bcSyncCacheTs = 0;
  var webBookingCacheTs = 0;
  var klaviyoCacheTs = 0;
  var STABLE_RPC_TTL_MS = 10 * 60 * 1000; // 10 minutes — these RPCs update infrequently
  var dayApiUnavailable = false;
  var DEBUG = false;
  var pageReadySent = false;
  var WEEKDAY_SHORT_IS = { 1: "Mán", 2: "Þri", 3: "Mið", 4: "Fim", 5: "Fös", 6: "Lau", 7: "Sun" };

  function log() { if (DEBUG && window.console) console.log.apply(console, arguments); }
  function emitPageReady() {
    if (pageReadySent) return;
    pageReadySent = true;
    document.dispatchEvent(new CustomEvent("storkaup:page-ready"));
  }
  function getCfg() { return window.STORKAUP_CONFIG || {}; }
  function getBcDayMinOrders() {
    var fromBody = document.body ? Number(document.body.getAttribute("data-bc-day-min-orders")) : NaN;
    return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 20;
  }
  function getBcDayMinRevenueExcl() {
    var fromBody = document.body ? Number(document.body.getAttribute("data-bc-day-min-revenue-excl")) : NaN;
    return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 500000;
  }
  function getDayMode() {
    var node = document.querySelector("[data-day-mode]");
    var mode = node ? String(node.getAttribute("data-day-mode") || "").trim().toLowerCase() : "";
    return mode || "picker";
  }
  function getRpcUrl() {
    var cfg = getCfg();
    return (cfg.supabaseUrl || "") + "/rest/v1/rpc/dashboard_compat";
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

  function pctOrDash(n) {
    if (n === null || n === undefined || n === "") return "-";
    var value = Number(n);
    if (!Number.isFinite(value)) return "-";
    return (Math.round(value * 1000) / 10) + "%";
  }

  function clamp01(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function digitalScoreBand(score100) {
    var s = toNumberSafe(score100);
    if (s > 80) return "good";
    if (s >= 60) return "warn";
    return "bad";
  }

  function getDigitalAdoptionTargetPct() {
    var fromBody = document.body
      ? Number(document.body.getAttribute("data-digital-adoption-target-pct"))
      : NaN;
    if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
    return 0.10; // 10% new web customer rate == full score contribution
  }

  function getWebrevGoalTarget_() {
    var fromBody = document.body
      ? Number(document.body.getAttribute("data-webrev-goal-target"))
      : NaN;
    if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
    return 0.50; // 50% web revenue share = full score
  }

  function getDigitalAdoptionWebshareTarget() {
    var fromBody = document.body
      ? Number(document.body.getAttribute("data-digital-adoption-webshare-target"))
      : NaN;
    if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
    return 0.50; // 50% web revenue share == full score contribution
  }

  function getDigitalAdoptionDisclaimerText() {
    return "Skor 0-100 byggt á vefsölu m.v. " + pct(getDigitalAdoptionWebshareTarget())
      + " markmið (50%), sjálfsafgreiðslu (30%) og nýjum vefviðskiptavinum m.v. "
      + pct(getDigitalAdoptionTargetPct()) + " markmið (20%).";
  }

  function applyDigitalAdoptionDisclaimer() {
    setText("digital-adoption-disclaimer", getDigitalAdoptionDisclaimerText());
  }

  function setDigitalAdoptionVisualState(score100) {
    var band = digitalScoreBand(score100);
    var card = document.querySelector('[data-kpi="digital-adoption"]');
    if (!card) return;
    card.setAttribute("data-score-band", band);
    if (!conicSupported()) {
      var bandColors = { good: "#c4e08c", warn: "#fdc65d", bad: "#c23340" };
      var svgFill = card.querySelector(".arc-meter--score-band .arc-svg-fill");
      if (svgFill) svgFill.setAttribute("stroke", bandColors[band] || "#8077fa");
    }
  }

  function applyDigitalAdoptionMetrics(month, firstTimeWebBuyersPct) {
    if (!month) return;

    var webshareTarget = getDigitalAdoptionWebshareTarget();
    var webShare = clamp01(month.webRevenuePct);
    var normalizedWebShare = clamp01(webshareTarget > 0 ? (webShare / webshareTarget) : 0);
    var selfServe = clamp01(month.selfServePct);
    var targetPct = getDigitalAdoptionTargetPct();
    var newWebPct = clamp01(firstTimeWebBuyersPct);
    var normalizedNewWeb = clamp01(targetPct > 0 ? (newWebPct / targetPct) : 0);

    var score01 = (normalizedWebShare * 0.5) + (selfServe * 0.3) + (normalizedNewWeb * 0.2);
    var score100 = Math.round(clamp01(score01) * 100);

    setText("digital-adoption-score", score100 + " / 100");
    setText("digital-adoption-score-pct", score100 + "%");
    setText("digital-adoption-webshare-pct", pct(webShare));
    setText("digital-adoption-selfserve-pct", pct(selfServe));
    setText("digital-adoption-newcustomers-norm-pct", pct(normalizedNewWeb));
    setText("month-new-web-customers-norm-pct", pct(normalizedNewWeb));

    setDigitalAdoptionVisualState(score100);
    applyDigitalAdoptionDisclaimer();

    var newWebBand = normalizedNewWeb > 0.8 ? "good" : normalizedNewWeb >= 0.6 ? "warn" : "bad";
    var newWebCard = document.querySelector('[data-kpi="new-web-customers"]');
    if (newWebCard) newWebCard.setAttribute("data-score-band", newWebBand);
    if (!conicSupported()) {
      var bandColors = { good: "#c4e08c", warn: "#fdc65d", bad: "#c23340" };
      var svgFill = newWebCard && newWebCard.querySelector(".arc-meter--score-band .arc-svg-fill");
      if (svgFill) svgFill.setAttribute("stroke", bandColors[newWebBand] || "#8077fa");
    }
  }

  function parsePercent(text) {
    if (!text) return null;
    var cleaned = text.toString().trim().replace("%", "").replace(",", ".");
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function setText(metric, valueText) {
    var els = document.querySelectorAll('[data-metric="' + metric + '"]');
    els.forEach(function(el) { el.textContent = valueText; });
  }

  function setMetricHint(metric, hintText) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (!el) return;
    var txt = String(hintText || "").trim();
    if (txt) el.setAttribute("title", txt);
    else el.removeAttribute("title");
  }

  function setMetricNAState(metric, isNA) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (!el) return;
    el.classList.toggle("is-na", !!isNA);
  }

  function setSignedMetric(metric, rawValue) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (!el) return;
    var n = toNumberSafe(rawValue);
    el.textContent = pct(n);
    el.classList.remove("is-pos", "is-neg", "is-flat");
    if (n > 0.0001) el.classList.add("is-pos");
    else if (n < -0.0001) el.classList.add("is-neg");
    else el.classList.add("is-flat");
  }

  function setAlertMetric(metric, isAlert, alertText, okText) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (!el) return;
    var on = !!isAlert;
    el.textContent = on ? alertText : (okText || "");
    el.classList.remove("alert-on", "alert-off");
    el.classList.add(on ? "alert-on" : "alert-off");
  }

  function buildMetricMap() {
    var values = {};
    document.querySelectorAll(".webapp-data[data-metric], .webapp-data [data-metric]").forEach(function (el) {
      var key = el.getAttribute("data-metric");
      var p = parsePercent(el.textContent);
      if (key && p !== null) values[key] = p;
    });
    return values;
  }

  function updateMeters(values) {
    document.querySelectorAll(".meter-fill[data-fill-from]").forEach(function (fill) {
      var key = fill.getAttribute("data-fill-from");
      var p = values[key];
      var raw = (p == null || !Number.isFinite(Number(p))) ? 0 : Number(p);

      if (fill.classList.contains("meter-fill--overflow")) {
        // Overflow bar: scale 0–140% into full track width, split gradient at 100% mark
        var capped = Math.max(0, Math.min(140, raw));
        fill.style.width = (capped / 140 * 100) + "%";
        fill.style.setProperty("--overflow-split",
          (capped > 0 ? Math.min(100 / capped * 100, 100) : 100) + "%");
      } else {
        fill.style.width = Math.max(0, Math.min(100, raw)) + "%";
      }
    });

    // Arc meters: CSS conic-gradient driven by --fill-pct (0–100)
    document.querySelectorAll(".arc-meter[data-fill-from]").forEach(function (arc) {
      var key = arc.getAttribute("data-fill-from");
      var p = values[key];
      var raw = (p == null || !Number.isFinite(Number(p))) ? 0 : Number(p);
      var v = Math.max(0, Math.min(100, raw));
      if (arc.getAttribute("data-svg-arc")) {
        var f = arc.querySelector(".arc-svg-fill");
        if (f) f.setAttribute("stroke-dasharray", v + "," + (100 - v));
      } else {
        arc.style.setProperty("--fill-pct", v);
      }
    });

    // Split arc meters: two segments on the wrap (data-seg-a / data-seg-b)
    document.querySelectorAll(".arc-meter-wrap[data-seg-a]").forEach(function (wrap) {
      var arc = wrap.querySelector(".arc-meter");
      if (!arc) return;
      var keyA = wrap.getAttribute("data-seg-a");
      var keyB = wrap.getAttribute("data-seg-b") || "";
      var pA = values[keyA]; var pB = values[keyB];
      var rawA = (pA == null || !Number.isFinite(Number(pA))) ? 0 : Math.max(0, Math.min(100, Number(pA)));
      var rawB = (pB == null || !Number.isFinite(Number(pB))) ? 0 : Math.max(0, Math.min(100, Number(pB)));
      if (wrap.getAttribute("data-svg-arc")) {
        var fA = arc.querySelector(".arc-svg-fill-a");
        var fB = arc.querySelector(".arc-svg-fill-b");
        if (fA) fA.setAttribute("stroke-dasharray", rawA + "," + (100 - rawA));
        if (fB) {
          fB.setAttribute("stroke-dasharray", rawB + "," + (100 - rawB));
          fB.setAttribute("transform", "rotate(" + (rawA * 3.6) + ",18,18)");
        }
      } else {
        arc.style.setProperty("--pct-a", rawA);
        arc.style.setProperty("--pct-b", rawB);
      }
    });
  }

  function updateDiverging(values) {
    var BASE = 100;
    var RIGHT_MAX = 200;
    document.querySelectorAll(".diverge").forEach(function (track) {
      var any = track.querySelector("[data-diverge-from]");
      if (!any) return;
      var key = any.getAttribute("data-diverge-from");
      var v = values[key];
      if (v == null) v = BASE;

      var clamped = Math.max(0, Math.min(RIGHT_MAX, v));
      var leftWidth = Math.min(clamped / BASE, 1) * 50;

      var rightWidth = 0;
      if (clamped > BASE) {
        rightWidth = ((clamped - BASE) / (RIGHT_MAX - BASE)) * 50;
        rightWidth = Math.max(0, Math.min(50, rightWidth));
      }

      var neg = track.querySelector('.diverge-neg[data-diverge-from="' + key + '"]');
      var pos = track.querySelector('.diverge-pos[data-diverge-from="' + key + '"]');
      if (neg) neg.style.width = leftWidth + "%";
      if (pos) pos.style.width = rightWidth + "%";
    });
  }

  function setActiveByMonth(month) {
    document.querySelectorAll(".dashboard-date-item").forEach(function (node) {
      node.classList.toggle("active", node.getAttribute("data-month") === month);
    });
  }

  function prettifyMonthLabel(month) {
    var s = String(month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(s)) return s;
    var parts = s.split("-");
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return s;
    var d = new Date(Date.UTC(y, m - 1, 1));
    try {
      var txt = new Intl.DateTimeFormat("is-IS", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
      return txt.charAt(0).toUpperCase() + txt.slice(1);
    } catch (_) {
      return s;
    }
  }

  function getMonthItemLabel(month) {
    var item = document.querySelector('.dashboard-date-item[data-month="' + String(month || "") + '"]');
    if (!item) return "";
    var txt = (item.textContent || "").replace(/\s+/g, " ").trim();
    return txt;
  }

  function setCurrentMonthLabel(month) {
    var target = document.querySelector('[data-month="current"]');
    if (!target) return;
    var chosen = getMonthItemLabel(month) || prettifyMonthLabel(month) || target.textContent || "";
    target.textContent = chosen;
  }

  function normalizeRpcPayload(raw) {
    var data = raw;
    if (Array.isArray(data)) data = data[0];
    if (data && data.dashboard_compat) data = data.dashboard_compat;
    return data;
  }

  // Manual BC figures — entered monthly from PowerBI/BC into the password-protected
  // Webflow page (window.STORKAUP_BC_MANUAL). BC ingest into Supabase was frozen for
  // security (Syndis flag: financial data too open via anon key), so the BC-derived
  // ratios no longer come from the RPC — they are supplied here per month. All
  // web/Magento metrics (YoY, day pace, new customers, self-serve) are untouched.
  //
  //   window.STORKAUP_BC_MANUAL = {
  //     "2026-06": { webOrdersPct: 0.385, webRevenuePct: 0.419, webAov: 80396, bcAov: 69742 }
  //   };
  function getManualBcFigures_(month) {
    var store = (typeof window !== "undefined") ? window.STORKAUP_BC_MANUAL : null;
    if (!store || typeof store !== "object") return null;
    var fig = store[month];
    return (fig && typeof fig === "object") ? fig : null;
  }

  function applyManualBcFigures_(data, month) {
    if (!data || !data.month) return false;
    var fig = getManualBcFigures_(month);
    if (!fig) return false;
    var m = data.month;
    var wo = Number(fig.webOrdersPct);
    var wr = Number(fig.webRevenuePct);
    if (Number.isFinite(wo)) m.webOrdersPct = wo;
    if (Number.isFinite(wr)) m.webRevenuePct = wr;
    var webAov = Number(fig.webAov);
    var bcAov = Number(fig.bcAov);
    if (Number.isFinite(webAov) && Number.isFinite(bcAov) && (webAov + bcAov) > 0) {
      m.aovWebPct = webAov / (webAov + bcAov);
      m.aovBcPct = bcAov / (webAov + bcAov);
      m.bcAovExcl = bcAov;
    }
    m.bcManual = true;
    m.bcRatioMonth = month; // drives the "BC hlutföll byggjast á: <mánuður>" hint
    return true;
  }

  function getTodayIso() {
    var now = new Date();
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      try {
        var parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Atlantic/Reykjavik",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(now);
        var out = {};
        parts.forEach(function (part) {
          if (part && part.type) out[part.type] = part.value;
        });
        if (out.year && out.month && out.day) {
          return out.year + "-" + out.month + "-" + out.day;
        }
      } catch (_err) {}
    }

    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, "0");
    var dd = String(now.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function getCurrentMonthKey() {
    return getTodayIso().slice(0, 7);
  }

  function getMonthDropdownCount() {
    var fromBody = document.body ? Number(document.body.getAttribute("data-month-count")) : NaN;
    if (Number.isFinite(fromBody) && fromBody > 0) return Math.max(1, Math.min(36, Math.round(fromBody)));
    return 12;
  }

  function shiftMonthKey(monthKey, diffMonths) {
    var s = String(monthKey || "").trim();
    if (!/^\d{4}-\d{2}$/.test(s)) return "";
    var parts = s.split("-");
    var year = Number(parts[0]);
    var monthIndex = Number(parts[1]) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return "";
    var d = new Date(Date.UTC(year, monthIndex + Number(diffMonths || 0), 1));
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 7);
  }

  function populateMonthDropdown() {
    var list = document.querySelector(".dropdowndashboardlist");
    if (!list) return;

    var count = getMonthDropdownCount();
    var currentMonth = getCurrentMonthKey();
    var activeMonth = currentMonth;
    var html = "";

    for (var i = 0; i < count; i += 1) {
      var month = shiftMonthKey(currentMonth, -i);
      if (!month) continue;
      var activeClass = month === activeMonth ? " active" : "";
      html += ''
        + '<div data-month="' + month + '" class="dashboard-date-item' + activeClass + '">'
        +   '<div>' + prettifyMonthLabel(month) + '</div>'
        + '</div>';
    }

    list.innerHTML = html;
  }

  function normalizeDay(day) {
    var s = String(day || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function isoDowFromDay(dayStr) {
    var s = normalizeDay(dayStr);
    if (!s) return null;
    var d = new Date(s + "T00:00:00Z");
    if (isNaN(d.getTime())) return null;
    var wd = d.getUTCDay(); // 0..6 (Sun..Sat)
    return wd === 0 ? 7 : wd; // 1..7 (Mon..Sun)
  }

  function shiftDay(dayStr, diffDays) {
    var s = normalizeDay(dayStr);
    if (!s) return "";
    var d = new Date(s + "T00:00:00Z");
    if (isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + diffDays);
    return d.toISOString().slice(0, 10);
  }

  function nearestDayByIsoDow(baseDay, isoDow) {
    var b = normalizeDay(baseDay);
    var target = Number(isoDow || 0);
    if (!b || target < 1 || target > 7) return "";
    var baseIso = isoDowFromDay(b);
    if (!baseIso) return "";
    var diff = target - baseIso;
    return shiftDay(b, diff);
  }

  function getActiveMonth() {
    var active = document.querySelector(".dashboard-date-item.active[data-month]");
    var first = document.querySelector(".dashboard-date-item[data-month]");
    return active ? active.getAttribute("data-month") : (first ? first.getAttribute("data-month") : null);
  }

  function applyDayMetrics(dayKey, orders, revenueExcl, revenueIncl) {
    var revExcl = toNumberSafe(revenueExcl);
    var revIncl = toNumberSafe(revenueIncl);
    if (revIncl > 0 && revExcl > revIncl) {
      // Defensive: if payload fields are accidentally flipped, keep labels coherent.
      var tmp = revExcl;
      revExcl = revIncl;
      revIncl = tmp;
    }
    setText("day-date", formatDayLabel(dayKey || ""));
    setText("day-orders", toNumberSafe(orders));
    setText("day-revenue-excl", formatNumber(revExcl));
    setText("day-revenue-incl", formatNumber(revIncl));
  }

  function applyDayBenchmarkMetrics(bench) {
    var b = bench || {};
    setText("day-avg-orders-365", toNumberSafe(b.avgOrders365));
    setText("day-avg-revenue-excl-365", formatNumber(b.avgRevenueExcl365));
    setText("day-avg-revenue-incl-365", formatNumber(b.avgRevenueIncl365));
    setText("day-vs-avg-orders-365-pct", pct(b.paceOrdersPct365));
    setText("day-vs-avg-revenue-excl-365-pct", pct(b.paceRevenueExclPct365));

    setText("day-avg-orders-weekday-12w", toNumberSafe(b.avgOrdersWeekday12w));
    setText("day-avg-revenue-excl-weekday-12w", formatNumber(b.avgRevenueExclWeekday12w));
    setText("day-avg-revenue-incl-weekday-12w", formatNumber(b.avgRevenueInclWeekday12w));
    setText("day-avg-weekday-12w-sample-days", toNumberSafe(b.sampleDaysWeekday12w));
    setSignedMetric("day-vs-avg-orders-weekday-12w-pct", (b.paceOrdersPctWeekday12w || 0) - 1);
    setSignedMetric("day-vs-avg-revenue-excl-weekday-12w-pct", (b.paceRevenueExclPctWeekday12w || 0) - 1);
  }

  function applyDayAdvancedMetrics(row) {
    if (!row) return;
    var avgOrdersWeekday12w = toNumberSafe(row.weekday_avg_orders_per_day);
    var avgRevenueExclWeekday12w = toNumberSafe(row.weekday_avg_revenue_excl_per_day);
    var paceOrdersWeekday12w = avgOrdersWeekday12w > 0
      ? (toNumberSafe(row.orders) / avgOrdersWeekday12w)
      : 0;
    var paceRevenueExclWeekday12w = avgRevenueExclWeekday12w > 0
      ? (toNumberSafe(row.revenue_excl) / avgRevenueExclWeekday12w)
      : 0;

    setText("day-aov-excl", formatNumber(row.aov_excl));
    setText("day-avg-orders-weekday-12w", toNumberSafe(avgOrdersWeekday12w));
    setText("day-avg-revenue-excl-weekday-12w", formatNumber(avgRevenueExclWeekday12w));
    setSignedMetric("day-vs-avg-orders-weekday-12w-pct", paceOrdersWeekday12w - 1);
    setSignedMetric("day-vs-avg-revenue-excl-weekday-12w-pct", paceRevenueExclWeekday12w - 1);
    updateDayContext_(row.orders, paceOrdersWeekday12w - 1, row.weekday_hourly_avg_series);
    renderHourlySparkline_(row.hourly_series || []);
    var bcOrdersBase = toNumberSafe(row.bc_invoices_day_orders);
    var bcRevenueBase = toNumberSafe(row.bc_invoices_day_revenue_excl);
    var bcCreditsOrders = toNumberSafe(row.bc_credits_day_orders);
    var bcCreditsRevenue = toNumberSafe(row.bc_credits_day_revenue_excl);
    var missingBcOrdersBase = !(bcOrdersBase > 0);
    var missingBcRevenueBase = !(bcRevenueBase > 0);
    var minOrders = getBcDayMinOrders();
    var minRevenueExcl = getBcDayMinRevenueExcl();
    var weakBcOrdersBase = !missingBcOrdersBase && bcOrdersBase < minOrders;
    var weakBcRevenueBase = !missingBcRevenueBase && bcRevenueBase < minRevenueExcl;

    var showOrdersPct = !(missingBcOrdersBase || weakBcOrdersBase);
    var showRevenuePct = !(missingBcRevenueBase || weakBcRevenueBase);

    setText("day-web-orders-pct-of-bc", showOrdersPct ? pctOrDash(row.web_orders_pct_of_bc_day) : "-");
    setText("day-web-revenue-pct-of-bc", showRevenuePct ? pctOrDash(row.web_revenue_pct_of_bc_day) : "-");

    setMetricNAState("day-web-orders-pct-of-bc", !showOrdersPct);
    setMetricNAState("day-web-revenue-pct-of-bc", !showRevenuePct);

    setMetricHint(
      "day-web-orders-pct-of-bc",
      missingBcOrdersBase
        ? "Engin BC bókuð sala fyrir valinn dag."
        : weakBcOrdersBase
          ? ("BC grunnur of lítill fyrir stöðugt hlutfall (min pantanir: " + minOrders + ").")
        : "Web pantanir / BC invoices pantanir (valinn dagur)."
    );
    setMetricHint(
      "day-web-revenue-pct-of-bc",
      missingBcRevenueBase
        ? "Engin BC bókuð sala fyrir valinn dag."
        : weakBcRevenueBase
          ? ("BC grunnur of lítill fyrir stöðugt hlutfall (min velta: " + formatNumber(minRevenueExcl) + ").")
        : "Web sala / BC invoices sala (valinn dagur)."
    );

    var note = "";
    if (missingBcOrdersBase || missingBcRevenueBase) {
      note = "Engin BC bókuð sala fyrir valinn dag";
    } else if (weakBcOrdersBase || weakBcRevenueBase) {
      note = "BC grunnur of lítill fyrir stöðugt % af BC";
    }
    setText("day-web-pct-of-bc-note", note);
    setText("day-bc-invoices-orders", toNumberSafe(bcOrdersBase));
    setText("day-bc-credits-orders", toNumberSafe(bcCreditsOrders));
    setText("day-bc-invoices-revenue-excl", formatNumber(bcRevenueBase));
    setText("day-bc-credits-revenue-excl", formatNumber(bcCreditsRevenue));
    setSignedMetric("day-vs-yesterday-orders-pct", row.vs_yesterday_orders_pct);
    setSignedMetric("day-vs-yesterday-revenue-pct", row.vs_yesterday_revenue_excl_pct);
    setSignedMetric("day-vs-yesterday-aov-pct", row.vs_yesterday_aov_excl_pct);
    setSignedMetric("day-vs-lastweek-orders-pct", row.vs_lastweek_orders_pct);
    setSignedMetric("day-vs-lastweek-revenue-pct", row.vs_lastweek_revenue_excl_pct);
    setSignedMetric("day-vs-lastweek-aov-pct", row.vs_lastweek_aov_excl_pct);
    setText("day-unique-buyers", toNumberSafe(row.unique_buyers));
    setText("day-repeat-buyer-pct", pct(row.repeat_buyer_pct));
    setText("day-first-time-buyers", toNumberSafe(row.first_time_buyers));
    setText("day-registrations-today", toNumberSafe(row.registrations_today));
    setText("day-registrations-bought-today", toNumberSafe(row.registrations_bought_today));
    setText("day-registrations-conversion-pct", pct(row.registrations_conversion_pct));
    setText("day-current-hour-orders", toNumberSafe(row.current_hour_orders));
    setText("day-current-hour-revenue-excl", formatNumber(row.current_hour_revenue_excl));
    setText("day-eod-orders-forecast", formatNumber(row.eod_orders_forecast));
    setText("day-eod-revenue-excl-forecast", formatNumber(row.eod_revenue_excl_forecast));
    setSignedMetric("day-eod-orders-vs-lastweek-pct", row.eod_orders_vs_lastweek_pct);
    setSignedMetric("day-eod-revenue-vs-lastweek-pct", row.eod_revenue_excl_vs_lastweek_pct);
    setText("day-noon-hour", toNumberSafe(row.noon_hour));
    setSignedMetric("day-noon-sales-vs-lastweek-pct", row.noon_sales_vs_lastweek_pct);
    setSignedMetric("day-noon-orders-vs-lastweek-pct", row.noon_orders_vs_lastweek_pct);
    setAlertMetric(
      "day-alert-noon-sales",
      row.alert_noon_sales_drop,
      "Viðvörun: sala undir viðmiði fyrir hádegi",
      "Sala í lagi fyrir hádegi"
    );
    setAlertMetric(
      "day-alert-noon-orders",
      row.alert_noon_orders_drop,
      "Viðvörun: pantanir undir viðmiði fyrir hádegi",
      "Pantanir í lagi fyrir hádegi"
    );
    setText("day-top-customer-1", row.top_customer_1 || "");
    setText("day-top-customer-2", row.top_customer_2 || "");
    setText("day-top-customer-3", row.top_customer_3 || "");
    setText("top_sku_1", row.top_sku_1 || "");
    setText("top_sku_2", row.top_sku_2 || "");
    setText("top_sku_3", row.top_sku_3 || "");
    setText("top_sku_4", row.top_sku_4 || "");
    setText("top_sku_5", row.top_sku_5 || "");
    setText("top_cat_1", row.top_cat_1 || "");
    setText("top_cat_2", row.top_cat_2 || "");
    setText("top_cat_3", row.top_cat_3 || "");
    var hourly = row.hourly_series || [];
    setText("day-hourly-series-json", JSON.stringify(hourly));
    renderHourlyChart(hourly);
    applyWeekdayAverageChart(row);
  }

  function normalizeSingleRow(raw) {
    var data = raw;
    if (Array.isArray(data)) data = data[0];
    return data || null;
  }

  function renderHourlyChart(series, hostSelector, valueLabel) {
    var host = document.querySelector(hostSelector || "[data-hourly-chart]");
    if (!host) return;

    var arr = Array.isArray(series) ? series : [];
    if (!arr.length) {
      host.innerHTML = "";
      return;
    }

    var maxOrders = 0;
    arr.forEach(function (p) {
      var n = toNumberSafe(p && p.orders);
      if (n > maxOrders) maxOrders = n;
    });
    if (maxOrders <= 0) maxOrders = 1;

    var html = '<div class="hourly-chart">';
    arr.forEach(function (p) {
      var hour = String(p && p.hour != null ? p.hour : "").padStart(2, "0");
      var orders = toNumberSafe(p && p.orders);
      var height = Math.max(4, Math.round((orders / maxOrders) * 100));
      var unit = valueLabel || "pantanir";
      html += ''
        + '<div class="hourly-col" title="' + hour + ':00 - ' + orders + ' ' + unit + '">'
        +   '<div class="hourly-bar-wrap">'
        +     '<div class="hourly-bar" style="height:' + height + '%"></div>'
        +   '</div>'
        +   '<div class="hourly-label">' + hour + '</div>'
        + '</div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  function buildHourlyBarsHtml(series, maxOrders, cssClass) {
    var arr = Array.isArray(series) ? series : [];
    var html = '<div class="' + (cssClass || "hourly-chart") + '">';
    arr.forEach(function (p) {
      var hour = String(p && p.hour != null ? p.hour : "").padStart(2, "0");
      var orders = toNumberSafe(p && p.orders);
      var height = Math.max(4, Math.round((orders / maxOrders) * 100));
      html += ''
        + '<div class="hourly-col" title="' + hour + ':00 - ' + orders + ' meðaltal">'
        +   '<div class="hourly-bar-wrap">'
        +     '<div class="hourly-bar" style="height:' + height + '%"></div>'
        +   '</div>'
        +   '<div class="hourly-label">' + hour + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderWeekdayComparisonGrid(items) {
    var host = document.querySelector("[data-hourly-weekday-grid]");
    if (!host) return;
    var rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      host.innerHTML = "";
      return;
    }
    var globalMax = 0;
    rows.forEach(function (r) {
      (r.series || []).forEach(function (p) {
        var n = toNumberSafe(p && p.orders);
        if (n > globalMax) globalMax = n;
      });
    });
    if (globalMax <= 0) globalMax = 1;

    var html = '';
    rows.sort(function (a, b) { return a.isoDow - b.isoDow; }).forEach(function (r) {
      var label = WEEKDAY_SHORT_IS[r.isoDow] || String(r.isoDow);
      html += ''
        + '<div class="weekday-card" data-weekday-card="' + r.isoDow + '">'
        +   '<div class="weekday-card-title">' + label + '</div>'
        +   buildHourlyBarsHtml(r.series || [], globalMax, "hourly-chart hourly-chart-mini")
        +   '<div class="weekday-card-meta">' + toNumberSafe(r.sampleDays) + ' dagar</div>'
        +   '<div class="weekday-card-meta">Meðalpantanir: ' + formatNumber(r.avgOrdersPerDay) + '</div>'
        +   '<div class="weekday-card-meta">Meðalsala: ' + formatNumber(r.avgRevenuePerDay) + ' kr</div>'
        + '</div>';
    });
    host.innerHTML = html;
  }

  function applyWeekdayAverageChart(row) {
    var weekdayHourly = row && row.weekday_hourly_avg_series ? row.weekday_hourly_avg_series : [];
    setText("day-weekday-hourly-series-json", JSON.stringify(weekdayHourly));
    setText("day-weekday-hourly-sample-days", toNumberSafe(row && row.weekday_hourly_avg_days));
    renderHourlyChart(weekdayHourly, "[data-hourly-weekday-chart]", "Meðaltal");
  }

  function setWeekdayChipActive() {
    document.querySelectorAll("[data-weekday-iso]").forEach(function (el) {
      var iso = Number(el.getAttribute("data-weekday-iso"));
      el.classList.toggle("active", selectedWeekdayIso != null && iso === selectedWeekdayIso);
    });
  }

  function fetchWeekdayAverage(isoDow) {
    var target = Number(isoDow || 0);
    if (target < 1 || target > 7) return Promise.resolve();

    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();

    var baseDay = normalizeDay(selectedDay) || getTodayIso();
    var anchorDay = nearestDayByIsoDow(baseDay, target);
    if (!anchorDay) return Promise.resolve();

    var dayRpcUrl = (cfg.supabaseUrl || "") + "/rest/v1/rpc/day_kpi_pack";
    return fetch(dayRpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey,
        "Content-Profile": "public"
      },
      body: JSON.stringify({ p_day: anchorDay })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Weekday pack HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        var row = normalizeSingleRow(raw);
        if (!row) throw new Error("Weekday pack empty payload");
        applyWeekdayAverageChart(row);
      })
      .catch(function (err) {
        log("Weekday average fetch failed:", err);
      });
  }

  function fetchWeekdayComparisonGrid(force) {
    var host = document.querySelector("[data-hourly-weekday-grid]");
    if (!host) return Promise.resolve();

    var baseDay = normalizeDay(selectedDay) || getTodayIso();
    var nowMs = Date.now();
    if (!force && weekdayGridCacheDay === baseDay && (nowMs - weekdayGridCacheTs) < (30 * 60 * 1000)) {
      return Promise.resolve();
    }

    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();
    var dayRpcUrl = (cfg.supabaseUrl || "") + "/rest/v1/rpc/day_kpi_pack";
    var isos = [1, 2, 3, 4, 5, 6, 7];

    return Promise.all(isos.map(function (iso) {
      var anchorDay = nearestDayByIsoDow(baseDay, iso);
      if (!anchorDay) return Promise.resolve(null);
      return fetch(dayRpcUrl, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKey,
          "Authorization": "Bearer " + apiKey,
          "Content-Profile": "public"
        },
        body: JSON.stringify({ p_day: anchorDay })
      })
        .then(function (r) {
          if (!r.ok) throw new Error("Weekday grid HTTP " + r.status);
          return r.json();
        })
        .then(function (raw) {
          var row = normalizeSingleRow(raw);
          if (!row) return null;
          return {
            isoDow: iso,
            sampleDays: toNumberSafe(row.weekday_hourly_avg_days),
            avgOrdersPerDay: toNumberSafe(row.weekday_avg_orders_per_day),
            avgRevenuePerDay: toNumberSafe(row.weekday_avg_revenue_excl_per_day),
            series: Array.isArray(row.weekday_hourly_avg_series) ? row.weekday_hourly_avg_series : []
          };
        })
        .catch(function () { return null; });
    }))
      .then(function (items) {
        var ok = (items || []).filter(function (x) { return !!x; });
        renderWeekdayComparisonGrid(ok);
        weekdayGridCacheDay = baseDay;
        weekdayGridCacheTs = Date.now();
      })
      .catch(function (err) {
        log("Weekday comparison fetch failed:", err);
      });
  }

  function formatDayLabel(dayKey) {
    var s = normalizeDay(dayKey);
    if (!s) return dayKey || "";

    var target = document.querySelector('[data-metric="day-date"]');
    var mode = target ? String(target.getAttribute("data-date-format") || "").trim().toLowerCase() : "";

    var parts = s.split("-");
    var yyyy = parts[0];
    var mm = parts[1];
    var dd = parts[2];
    var monthNamesIs = {
      "01": "janúar",
      "02": "febrúar",
      "03": "mars",
      "04": "apríl",
      "05": "maí",
      "06": "júní",
      "07": "júlí",
      "08": "ágúst",
      "09": "september",
      "10": "október",
      "11": "nóvember",
      "12": "desember"
    };

    if (mode === "iso") return s;
    if (mode === "slash") return dd + "/" + mm + "/" + yyyy;
    if (mode === "long-is") {
      var d = new Date(s + "T00:00:00");
      if (!isNaN(d.getTime()) && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        try {
          var intlLabel = new Intl.DateTimeFormat("is-IS", { day: "numeric", month: "long", year: "numeric" }).format(d);
          if (intlLabel && /[áðéíóúýþæö]/i.test(intlLabel)) return intlLabel;
        } catch (_err) {}
      }
      return String(Number(dd || 0)) + ". " + (monthNamesIs[mm] || mm) + " " + yyyy;
    }

    // Default: dd.mm.yyyy
    return dd + "." + mm + "." + yyyy;
  }

  function initFlatpickrIfAvailable(dayPicker) {
    if (!dayPicker || typeof window.flatpickr !== "function") return;
    if (dayPicker._flatpickr) return;

    try {
      var localeOpt = (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.is) ? "is" : "default";
      window.flatpickr(dayPicker, {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d.m.Y",
        locale: localeOpt,
        monthSelectorType: "static",
        disableMobile: true,
        allowInput: true,
        defaultDate: normalizeDay(dayPicker.value) || getTodayIso(),
        onChange: function (_selectedDates, dateStr) {
          dayPicker.value = normalizeDay(dateStr) || "";
          dayPicker.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    } catch (err) {
      log("Flatpickr init failed:", err);
    }
  }

  // ── Day context badge + hourly sparkline ─────────────────────────────────
  var _dayTooltipOpen = false;

  function getCumulativeHourThreshold_(series, targetPct) {
    if (!Array.isArray(series) || !series.length) return null;
    var total = series.reduce(function (s, h) { return s + (h.orders || 0); }, 0);
    if (!total) return null;
    var cum = 0;
    for (var i = 0; i < series.length; i++) {
      cum += series[i].orders || 0;
      if (cum / total >= targetPct) return series[i].hour;
    }
    return series[series.length - 1].hour;
  }

  function getDayContextBadge_(hour, deltaDec, thresholds) {
    var t = thresholds || { suppress: 10, late: 16 };
    if (hour < t.suppress) return { text: "Anda djúpt, dagurinn rétt að byrja!", suppress: true };
    if (hour < t.suppress + 2) return { text: "Vefsalan virðist vera að komast í gang í dag!", suppress: false };
    if (hour >= t.late) return { text: "Lítur út fyrir að vefsalan sé að ljúka í dag", suppress: false };
    if (deltaDec > 0.3) return { text: "Lítur út fyrir að vefsalan sé í góðri sveiflu þessa stundina!", suppress: false };
    if (deltaDec < -0.3) return { text: "Vefsalan hefur nú verið í rólegri kantinum í dag!", suppress: false };
    return { text: null, suppress: false };
  }

  function getDayTooltipText_(hour, thresholds) {
    var t = thresholds || { suppress: 10, late: 16 };
    if (hour < t.suppress) return "Vefsalan hefst venjulega um kl. " + t.suppress + ". Samanburður við meðaltal gefur betri mynd þegar líður á daginn.";
    if (hour < t.suppress + 2) return "Vefsalan virðist vera að fara í gang. Samanburður verður þvi áreiðanlegri í kjölfarið.";
    if (hour < t.late) return "Meirihluti daglegra vefpantana koma fyrir kl. " + t.late + ". Samanburður við meðaltal er því að mestu kominn í gagnið, þó stundum sé hægt að sjá vísbendingar um dagsferilinn mun fyrr.";
    return "Vefsala eftir kl. " + t.late + " er venjulega lítil. Mögulega er þetta lokastaðan í dag.";
  }

  function updateDayContext_(dayOrders, deltaDec, series) {
    var badge = document.querySelector("[data-day-context-badge]");
    var deltaRow = document.querySelector("[data-day-delta-row]");
    var tooltipEl = document.querySelector("[data-day-tooltip]");
    if (!badge) return;
    var hour = new Date().getHours();
    if (dayOrders == null || !Number.isFinite(Number(dayOrders))) {
      badge.style.display = "none";
      if (deltaRow) deltaRow.style.visibility = "";
      return;
    }
    var thresholds = series && series.length ? {
      suppress: getCumulativeHourThreshold_(series, 0.10) || 10,
      late:     getCumulativeHourThreshold_(series, 0.80) || 16
    } : null;
    var ctx = getDayContextBadge_(hour, deltaDec, thresholds);
    if (ctx.text) { badge.textContent = ctx.text; badge.style.display = ""; }
    else { badge.style.display = "none"; }
    if (deltaRow) deltaRow.style.visibility = "";
    if (tooltipEl && !_dayTooltipOpen) tooltipEl.textContent = getDayTooltipText_(hour, thresholds);
    badge._thresholds = thresholds;
  }

  function initDayContextBadge_() {
    var badge = document.querySelector("[data-day-context-badge]");
    if (!badge || badge.getAttribute("data-ctx-init")) return;
    badge.setAttribute("data-ctx-init", "1");
    badge.style.display = "none";
    var tooltipInit = document.querySelector("[data-day-tooltip]");
    if (tooltipInit) tooltipInit.style.display = "none";
    badge.addEventListener("click", function () {
      var tooltipEl = document.querySelector("[data-day-tooltip]");
      if (!tooltipEl) return;
      _dayTooltipOpen = !_dayTooltipOpen;
      if (_dayTooltipOpen) tooltipEl.textContent = getDayTooltipText_(new Date().getHours(), badge._thresholds);
      tooltipEl.style.display = _dayTooltipOpen ? "" : "none";
    });
  }

  function renderHourlySparkline_(rows) {
    var chart = document.querySelector("[data-day-sparkline]");
    if (!chart) return;
    var counts = new Array(24).fill(0);
    // Accepts both raw order rows {purchase_date} and pre-grouped series {hour, orders}
    rows.forEach(function (row) {
      if (row.hour != null) {
        var h = Number(row.hour);
        if (h >= 0 && h < 24) counts[h] = row.orders || 0;
      } else if (row.purchase_date) {
        var h = new Date(row.purchase_date).getHours();
        if (h >= 0 && h < 24) counts[h]++;
      }
    });
    var maxCount = Math.max.apply(null, counts) || 1;
    var curHour = new Date().getHours();
    var LABELS = { 0: "00", 6: "06", 12: "12", 18: "18" };
    chart.innerHTML = "";
    counts.forEach(function (count, h) {
      var col = document.createElement("div");
      col.className = "hsp-col";
      var bar = document.createElement("div");
      bar.className = "hsp-bar " + (h < curHour ? "hsp-past" : h === curHour ? "hsp-current" : "hsp-future");
      bar.style.height = (count === 0 ? 2 : Math.max(2, Math.round((count / maxCount) * 40))) + "px";
      var lbl = document.createElement("div");
      lbl.className = "hsp-label";
      lbl.textContent = LABELS[h] || "";
      col.appendChild(bar);
      col.appendChild(lbl);
      chart.appendChild(col);
    });
  }

  function fetchDay(dayKey) {
    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    var day = normalizeDay(dayKey);
    if (!day || !cfg.supabaseUrl || !apiKey || dayApiUnavailable) return Promise.resolve();

    var dayRpcUrl = (cfg.supabaseUrl || "") + "/rest/v1/rpc/day_kpi_pack";
    var dayBaseUrl = (cfg.supabaseUrl || "") +
      "/rest/v1/v_web_daily_unified?select=day,revenue_incl,revenue_excl,orders&day=eq." +
      encodeURIComponent(day) + "&limit=1";

    return fetch(dayRpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey,
        "Content-Profile": "public"
      },
      body: JSON.stringify({ p_day: day })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Day pack HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        var row = normalizeSingleRow(raw);
        if (!row) throw new Error("Day pack returned empty payload");
        applyDayMetrics(
          row.day || day,
          row.orders,
          row.revenue_excl,
          row.revenue_incl
        );
        applyDayAdvancedMetrics(row);
        fetchWeekdayComparisonGrid(false);
        if (selectedWeekdayIso != null) fetchWeekdayAverage(selectedWeekdayIso);
      })
      .catch(function () {
        // Backward-compatible fallback if RPC is not available yet.
        return fetch(dayBaseUrl, {
          method: "GET",
          cache: "no-store",
          headers: {
            "apikey": apiKey,
            "Authorization": "Bearer " + apiKey,
            "Accept-Profile": "mart"
          }
        })
          .then(function (r) {
            if (!r.ok) throw new Error("Day endpoint HTTP " + r.status);
            return r.json();
          })
          .then(function (rows) {
            var row = Array.isArray(rows) && rows.length ? rows[0] : null;
            applyDayMetrics(
              day,
              row ? row.orders : 0,
              row ? row.revenue_excl : 0,
              row ? row.revenue_incl : 0
            );
          });
      })
      .catch(function (err) {
        log("Day fetch failed:", err);
        if (err && /HTTP 401/.test(String(err.message || err))) {
          dayApiUnavailable = true;
        }
        // Keep last rendered day values; monthly cards refresh independently.
      });
  }

  function fetchDayOrders(day) {
    var container = document.querySelector("[data-day-orders-list]") || document.querySelector("[data-day-orders]");
    if (!container) return Promise.resolve();

    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();

    var limit = parseInt(
      container.getAttribute("data-day-orders-limit") ||
      document.body.getAttribute("data-day-orders-limit") || "10", 10
    );

    var rpcUrl = cfg.supabaseUrl + "/rest/v1/rpc/get_day_orders";

    return fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey,
        "Content-Profile": "public"
      },
      body: JSON.stringify({ p_day: day, p_limit: limit })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("get_day_orders HTTP " + r.status);
        return r.json();
      })
      .then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];

        // Template is the Webflow-designed row; rendered clones are marked data-day-order-rendered
        var tmpl = container.querySelector("[data-day-order-row]:not([data-day-order-rendered])");
        if (tmpl) tmpl.style.display = "none";

        container.querySelectorAll("[data-day-order-rendered], [data-day-orders-empty]")
          .forEach(function (el) { el.remove(); });

        if (!rows.length) {
          var empty = document.createElement("p");
          empty.setAttribute("data-day-orders-empty", "");
          empty.textContent = "Engar pantanir fundust.";
          container.appendChild(empty);
          return;
        }

        if (!tmpl) return;

        rows.forEach(function (row) {
          var time = row.purchase_date
            ? new Date(row.purchase_date).toLocaleTimeString("is-IS", { hour: "2-digit", minute: "2-digit", hour12: false })
            : "";
          var name = row.customer_name || "Óþekktur";
          var cid  = row.customer_id  || "";
          var amt  = row.subtotal_excl != null
            ? Number(row.subtotal_excl).toLocaleString("is-IS", { maximumFractionDigits: 0 }) + " kr"
            : "";

          var isNew = row.is_first_time === true;

          var el = tmpl.cloneNode(true);
          el.setAttribute("data-day-order-rendered", "");
          el.style.display = "";
          var t = el.querySelector("[data-day-order-time]");
          var n = el.querySelector("[data-day-order-name]");
          var c = el.querySelector("[data-day-order-cid]");
          var a = el.querySelector("[data-day-order-amount]");
          if (t) t.textContent = time;
          if (n) n.textContent = name;
          if (c) c.textContent = cid;
          if (a) a.textContent = amt;
          // First-time buyer marker — Webflow row template carries a hidden
          // [data-day-order-new] badge; show it only for first-ever web purchases.
          el.classList.toggle("is-first-time", isNew);
          var badge = el.querySelector("[data-day-order-new]");
          if (badge) badge.style.display = isNew ? "" : "none";
          container.appendChild(el);
        });
        renderHourlySparkline_(rows);
      })
      .catch(function (err) {
        log("fetchDayOrders failed:", err);
      });
  }

  function fetchMonth(month) {
    var targetMonth = month || getCurrentMonthKey();
    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    var rpcUrl = getRpcUrl();
    if (!cfg.supabaseUrl || !apiKey) {
      log("Missing STORKAUP_CONFIG.supabaseUrl or publishableKey");
      return Promise.resolve();
    }

    log("Fetching month:", targetMonth, rpcUrl);

    return fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({ p_month: targetMonth })
    })
      .then(function (r) { return r.json(); })
      .then(function (raw) {
        log("Raw RPC response:", raw);
        var data = normalizeRpcPayload(raw);
        log("Normalized response:", data);

        if (!data || !data.month) {
          log("Dashboard error: invalid payload", data);
          return;
        }

        applyManualBcFigures_(data, targetMonth);

        setText("month-yoy", pct(data.month.yoyPct));
        setText("month-weborders-pct", pct(data.month.webOrdersPct));
        setText("month-webrev-pct", pct(data.month.webRevenuePct));
        var bcMonthNames = {
          "01":"janúar","02":"febrúar","03":"mars","04":"apríl","05":"maí","06":"júní",
          "07":"júlí","08":"ágúst","09":"september","10":"október","11":"nóvember","12":"desember"
        };
        if (data.month.bcRatioMonth) {
          var rmParts = String(data.month.bcRatioMonth).split("-");
          var rmLabel = (bcMonthNames[rmParts[1]] || rmParts[1]) + " " + rmParts[0];
          setText("bc-as-of-label", rmLabel);
          setMetricHint("month-weborders-pct", "BC hlutföll byggjast á: " + rmLabel);
          setMetricHint("month-webrev-pct", "BC hlutföll byggjast á: " + rmLabel);
        }
        setText("rolling30-webrev-pct", pctOrDash(data.month.rolling30WebRevenuePct));
        setText("rolling30-weborders-pct", pctOrDash(data.month.rolling30WebOrdersPct));
        if (data.month.rolling30StartDate && data.month.rolling30EndDate) {
          var r30Label = data.month.rolling30StartDate + "–" + data.month.rolling30EndDate;
          setText("rolling30-date-range", r30Label);
          setMetricHint("rolling30-webrev-pct", "Síðustu 30 dagar (3d buffer): " + r30Label);
          setMetricHint("rolling30-weborders-pct", "Síðustu 30 dagar (3d buffer): " + r30Label);
        }
        setText("month-salesrep-pct", pct(data.month.salesRepPct));
        setText("month-yoy-orders", pct(data.month.yoyOrdersPct));
        if (dayApiUnavailable) {
          var dayDate = (data.day && data.day.date) ? data.day.date : getTodayIso();
          var dayOrders = data.dayOrders != null ? data.dayOrders : (data.day ? data.day.orders : 0);
          var dayRevenueExcl = data.dayRevenueExcl != null ? data.dayRevenueExcl : (data.day ? data.day.revenueExcl : 0);
          var dayRevenueIncl = data.day && data.day.revenueIncl != null ? data.day.revenueIncl : 0;
          applyDayMetrics(dayDate, dayOrders, dayRevenueExcl, dayRevenueIncl);
        }
        applyDayBenchmarkMetrics(data.dayBenchmark || {});
        setText("month-selfserve-pct", pct(data.month.selfServePct));
        setText("month-aov-excl", formatNumber(data.month.aovExcl));
        setText("month-bc-aov-excl", formatNumber(data.month.bcAovExcl));
        setText("month-revenue-excl", formatNumber(data.month.revenueExcl || 0));
        setText("month-orders", data.month.orders || 0);
        setText("month-aov-web-pct", pct(data.month.aovWebPct));
        setText("month-aov-bc-pct", pct(data.month.aovBcPct));
        var firstTimeWebBuyers = (data.month.firstTimeWebBuyers != null)
          ? data.month.firstTimeWebBuyers
          : data.month.newWebCustomers;
        var firstTimeWebBuyersPct = (data.month.firstTimeWebBuyersPct != null)
          ? data.month.firstTimeWebBuyersPct
          : data.month.newWebCustomersPct;
        setText("month-new-web-customers", toNumberSafe(firstTimeWebBuyers));
        setText("month-new-web-customers-pct", pct(firstTimeWebBuyersPct));
        setText("month-first-time-web-buyers", toNumberSafe(firstTimeWebBuyers));
        setText("month-first-time-web-buyers-pct", pct(firstTimeWebBuyersPct));
        applyDigitalAdoptionMetrics(data.month, firstTimeWebBuyersPct);

        var values = buildMetricMap();
        // Inject arc-driving metrics directly from raw data — avoids DOM round-trip
        // mismatch and ensures arcs update correctly when switching months.
        var m = data.month;
        if (m.webRevenuePct   != null) values["month-webrev-pct"]        = m.webRevenuePct   * 100;
        if (m.webOrdersPct    != null) values["month-weborders-pct"]     = m.webOrdersPct    * 100;
        if (m.rolling30WebRevenuePct  != null) values["rolling30-webrev-pct"]     = m.rolling30WebRevenuePct  * 100;
        if (m.rolling30WebOrdersPct   != null) values["rolling30-weborders-pct"]  = m.rolling30WebOrdersPct   * 100;

        // Web goal progress — normalized against 50% target (configurable via data-webrev-goal-target on body)
        // Uses rolling30WebOrdersPct (web orders share) as it better reflects digital adoption
        var webrevTarget = getWebrevGoalTarget_();
        // "Vefsala % MARKMIÐ" goal card: with manual BC figures, track the
        // manually-entered web-sales share against the target; otherwise fall back
        // to the rolling-30d web-orders share from the RPC.
        var goalShare = (m.bcManual && m.webRevenuePct != null)
          ? m.webRevenuePct
          : m.rolling30WebOrdersPct;
        var webrevNorm = goalShare != null
          ? Math.max(0, Math.min(1, goalShare / webrevTarget)) : null;
        if (webrevNorm != null) {
          values["webrev-goal-norm-pct"] = webrevNorm * 100;
          setText("webrev-goal-norm-pct", pct(webrevNorm));
          var webrevBand = webrevNorm > 0.8 ? "good" : webrevNorm >= 0.6 ? "warn" : "bad";
          var webrevCard = document.querySelector('[data-kpi="webrev-goal"]');
          if (webrevCard) webrevCard.setAttribute("data-score-band", webrevBand);
          if (!conicSupported()) {
            var bandColors = { good: "#c4e08c", warn: "#fdc65d", bad: "#c23340" };
            var svgFill = webrevCard && webrevCard.querySelector(".arc-meter--score-band .arc-svg-fill");
            if (svgFill) svgFill.setAttribute("stroke", bandColors[webrevBand] || "#8077fa");
          }
        }
        if (m.selfServePct    != null) values["month-selfserve-pct"]     = m.selfServePct    * 100;
        if (m.aovWebPct       != null) values["month-aov-web-pct"]       = m.aovWebPct       * 100;
        if (m.aovBcPct        != null) values["month-aov-bc-pct"]        = m.aovBcPct        * 100;
        updateMeters(values);
        updateDiverging(values);
      })
      .catch(function (err) {
        log("Fetch failed:", err);
      });
  }

  function hasKlaviyoMetricTargets() {
    return !!document.querySelector('[data-metric^="klaviyo-"]')
      || !!document.querySelector("[data-klaviyo-campaign-cards]");
  }

  function shiftIsoDays(baseIso, diffDays) {
    var s = normalizeDay(baseIso);
    if (!s) return "";
    var d = new Date(s + "T00:00:00Z");
    if (isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + Number(diffDays || 0));
    return d.toISOString().slice(0, 10);
  }

  /* ── Klaviyo insights block ────────────────────────────────────────────
     Renders a monthly timeline, a traceability split and a campaign table
     into a container inserted above the Webflow-authored campaign cards.

     Strictly ADDITIVE: it builds its own .kl-* markup and never mutates or
     restyles the existing Webflow rows, so if anything in here throws, the
     page renders exactly as it did before. Styles live in
     dashboard-theme.css under "Klaviyo insights".

     Note on empty months: the attribution MV simply has no rows for a month
     with nothing attributed, which is indistinguishable from a month where
     the sync was not running. The chart therefore says "engin skráning"
     rather than claiming zero — see klRenderTimeline. */

  var KL_MONTHS_BACK = 14;
  var KL_MONTH_ABBR = ["jan", "feb", "mar", "apr", "maí", "jún", "júl", "ágú", "sep", "okt", "nóv", "des"];
  var klTipEl = null;

  function klEl(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== null && text !== undefined) n.textContent = String(text);
    return n;
  }

  function klSvgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function klMonthLabel(key, withYear) {
    var parts = String(key || "").split("-");
    var name = KL_MONTH_ABBR[Number(parts[1]) - 1] || key;
    return withYear ? name + " " + String(parts[0]).slice(2) : name;
  }

  function klDaysBetween(fromIso, toIso) {
    var a = new Date(String(fromIso) + "T00:00:00Z").getTime();
    var b = new Date(String(toIso) + "T00:00:00Z").getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function klMkr(value) {
    var v = toNumberSafe(value) / 1000000;
    return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
  }

  function klNiceMax(peak) {
    var steps = [4, 8, 12, 20, 40, 60, 80, 120, 200, 400, 600, 800, 1200, 2000];
    if (!peak || peak <= 0) return 4;
    for (var i = 0; i < steps.length; i += 1) { if (peak <= steps[i]) return steps[i]; }
    return Math.ceil(peak / 400) * 400;
  }

  /* Last KL_MONTHS_BACK months ending at the current one. A month absent from
     `monthly` gets orders:null — drawn as an explicit void, never a zero bar. */
  function klBuildMonthSeries(monthly, todayIso) {
    var year = Number(String(todayIso).slice(0, 4));
    var month = Number(String(todayIso).slice(5, 7));
    var keys = [];
    var i;
    for (i = KL_MONTHS_BACK - 1; i >= 0; i -= 1) {
      var mm = month - i;
      var yy = year;
      while (mm <= 0) { mm += 12; yy -= 1; }
      keys.push(String(yy) + "-" + (mm < 10 ? "0" + mm : String(mm)));
    }
    return keys.map(function (key, idx) {
      var hit = monthly[key];
      var showYear = idx === 0 || key.slice(0, 4) !== keys[idx - 1].slice(0, 4);
      return {
        key: key,
        label: klMonthLabel(key, showYear),
        orders: hit ? hit.orders : null,
        revIncl: hit ? hit.revIncl : 0,
        partial: key === String(todayIso).slice(0, 7)
      };
    });
  }

  function klTooltip() {
    if (klTipEl && document.body && document.body.contains(klTipEl)) return klTipEl;
    klTipEl = klEl("div", "kl-tip");
    klTipEl.setAttribute("role", "tooltip");
    klTipEl.setAttribute("aria-hidden", "true");
    if (document.body) document.body.appendChild(klTipEl);
    return klTipEl;
  }

  /* Values are set with textContent, never innerHTML — campaign names come
     from Klaviyo and are not trusted markup. */
  function klBindTooltip(node, lines) {
    function show() {
      var tip = klTooltip();
      tip.textContent = "";
      lines.forEach(function (line, idx) {
        if (idx) tip.appendChild(document.createElement("br"));
        var span = klEl(idx ? "span" : "b", null, line);
        tip.appendChild(span);
      });
      tip.classList.add("is-on");
      tip.setAttribute("aria-hidden", "false");
      var r = node.getBoundingClientRect();
      var t = tip.getBoundingClientRect();
      var left = r.left + (r.width / 2) - (t.width / 2);
      left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
      var top = r.top - t.height - 10;
      if (top < 8) top = r.bottom + 10;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function hide() {
      var tip = klTooltip();
      tip.classList.remove("is-on");
      tip.setAttribute("aria-hidden", "true");
    }
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("mouseleave", hide);
    node.addEventListener("blur", hide);
  }

  function klRenderTimeline(series) {
    var W = 760, H = 232, padT = 26, padR = 8, padB = 34, padL = 34;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var base = padT + plotH;

    var peak = 0;
    series.forEach(function (d) { if (d.orders !== null && d.orders > peak) peak = d.orders; });
    var max = klNiceMax(peak);

    var svg = klSvgEl("svg", {
      "class": "kl-chart",
      viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "xMinYMin meet",
      role: "img"
    });
    var voidCount = series.filter(function (d) { return d.orders === null; }).length;
    svg.setAttribute(
      "aria-label",
      "Súlurit: eignaðar pantanir á mánuði, síðustu " + series.length + " mánuðir. " +
      "Hæsti mánuður " + peak + " pantanir. " + voidCount + " mánuðir án skráningar."
    );

    var defs = klSvgEl("defs", {});
    var pattern = klSvgEl("pattern", {
      id: "kl-hatch", width: "6", height: "6",
      patternTransform: "rotate(45)", patternUnits: "userSpaceOnUse"
    });
    pattern.appendChild(klSvgEl("line", {
      x1: "0", y1: "0", x2: "0", y2: "6",
      stroke: "var(--kl-void, #c2c5de)", "stroke-width": "1.5"
    }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    [0, 0.25, 0.5, 0.75, 1].forEach(function (frac) {
      var value = Math.round(max * frac);
      var y = base - (frac * plotH);
      svg.appendChild(klSvgEl("line", {
        "class": frac === 0 ? "kl-zero" : "kl-grid",
        x1: padL, y1: y, x2: W - padR, y2: y
      }));
      var lab = klSvgEl("text", { x: padL - 8, y: y + 3.5, "text-anchor": "end" });
      lab.textContent = String(value);
      svg.appendChild(lab);
    });

    var slot = plotW / series.length;
    var barW = Math.min(38, slot * 0.62);

    series.forEach(function (d, idx) {
      var cx = padL + (slot * idx) + (slot / 2);
      var x = cx - (barW / 2);

      var mlab = klSvgEl("text", { x: cx, y: base + 16, "text-anchor": "middle" });
      mlab.textContent = d.label;
      svg.appendChild(mlab);

      if (d.orders === null) {
        svg.appendChild(klSvgEl("rect", {
          "class": "kl-void", x: x, y: padT, width: barW, height: plotH, rx: 4
        }));
      } else {
        var h = Math.max(2, (d.orders / max) * plotH);
        svg.appendChild(klSvgEl("rect", {
          "class": d.partial ? "kl-bar--partial" : "kl-bar",
          x: x, y: base - h, width: barW, height: h, rx: 4
        }));
        if (d.orders > 0 && (d.orders / max) > 0.15) {
          var val = klSvgEl("text", { "class": "kl-val", x: cx, y: base - h - 7, "text-anchor": "middle" });
          val.textContent = String(d.orders);
          svg.appendChild(val);
        }
      }

      var full = klMonthLabel(d.key, true);
      var lines = d.orders === null
        ? [full, "engin skráning í eignunargögnum"]
        : [full, d.orders + " eignaðar pantanir", klMkr(d.revIncl) + " Mkr m. vsk"];
      if (d.partial && d.orders !== null) lines.push("mánuður ekki búinn");

      var hit = klSvgEl("rect", {
        "class": "kl-hit", x: padL + (slot * idx), y: padT,
        width: slot, height: plotH, tabindex: "0", role: "img"
      });
      hit.setAttribute("aria-label", lines.join(" — "));
      klBindTooltip(hit, lines);
      svg.appendChild(hit);
    });

    return svg;
  }

  function klCard(title, subtitle, noteText) {
    var card = klEl("section", "kl-card");
    var head = klEl("div", "kl-card-head");
    head.appendChild(klEl("h3", "kl-h2", title));
    if (subtitle) head.appendChild(klEl("span", "kl-strip-sub", subtitle));
    card.appendChild(head);
    if (noteText) card.appendChild(klEl("p", "kl-note", noteText));
    return card;
  }

  function klRow(label, valueText, hintText, swatchColor) {
    var row = klEl("div", "kl-row");
    var k = klEl("span", "kl-row-k");
    if (swatchColor) {
      var sw = klEl("span", "kl-swatch");
      sw.style.background = swatchColor;
      k.appendChild(sw);
    }
    k.appendChild(document.createTextNode(label));
    var v = klEl("span", "kl-row-v", valueText);
    if (hintText) {
      var small = klEl("small", null, " · " + hintText);
      v.appendChild(small);
    }
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }

  /* The campaign table is filled later, once the campaign-cards view resolves.
     It is a table rather than one card per campaign so the layout holds from a
     single row up to twenty as sending picks up. */
  function klRenderCampaignTable(rows, cardsHost) {
    var host = document.querySelector("[data-kl-campaign-table]");
    if (!host) return;

    var list = (Array.isArray(rows) ? rows : []).slice();
    list.sort(function (a, b) {
      return toNumberSafe(b && b.attributed_orders_30d) - toNumberSafe(a && a.attributed_orders_30d);
    });

    var totalOrders = 0;
    list.forEach(function (r) { totalOrders += toNumberSafe(r && r.attributed_orders_30d); });
    var topOrders = list.length ? toNumberSafe(list[0].attributed_orders_30d) : 0;

    host.textContent = "";

    var countHost = document.querySelector("[data-kl-campaign-count]");
    if (countHost) {
      countHost.textContent = list.length === 1 ? "1 herferð" : list.length + " herferðir";
    }

    if (!list.length) {
      host.appendChild(klEl("p", "kl-muted", "Engin herferð með eignaða pöntun síðustu 30 daga."));
    } else {
      var table = klEl("table", "kl-table");
      var thead = klEl("thead");
      var htr = klEl("tr");
      [
        { t: "Herferð", c: "kl-c-name" },
        { t: "Pantanir", c: null },
        { t: "Sala m. vsk", c: null },
        { t: "Hlutfall pantana", c: "kl-c-share" }
      ].forEach(function (col) {
        var th = klEl("th", col.c, col.t);
        th.setAttribute("scope", "col");
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      var tbody = klEl("tbody");
      list.forEach(function (r) {
        var orders = toNumberSafe(r && r.attributed_orders_30d);
        var tr = klEl("tr");

        /* Name only. The view carries no send timestamp, and the campaign_id is
           a ULID — noise in a list a salesperson reads. Klaviyo's default names
           already embed the send date. */
        var nameCell = klEl("td", "kl-c-name",
          String((r && r.campaign_name) || (r && r.campaign_id) || "Ónafngreind herferð"));
        tr.appendChild(nameCell);

        tr.appendChild(klEl("td", null, formatNumber(orders)));
        tr.appendChild(klEl("td", null, formatNumber(r && r.attributed_revenue_incl_30d)));

        var shareCell = klEl("td", "kl-c-share");
        if (totalOrders <= 1) {
          /* A share of a single order carries no information — say so instead
             of printing a confident 100%. */
          shareCell.appendChild(klEl("span", "kl-muted", "eina í mælingu"));
        } else {
          var wrap = klEl("span", "kl-share-wrap");
          var track = klEl("span", "kl-share-track");
          var fill = klEl("span", "kl-share-fill");
          fill.style.width = (topOrders > 0 ? Math.round((orders / topOrders) * 100) : 0) + "%";
          track.appendChild(fill);
          wrap.appendChild(track);
          wrap.appendChild(klEl("span", "kl-share-n", pct(orders / totalOrders)));
          shareCell.appendChild(wrap);
        }
        tr.appendChild(shareCell);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      host.appendChild(table);
    }

    /* Only once the table is actually on the page do we retire the original
       Webflow cards, so a failure above leaves them in place. Delete the
       cards host in Webflow to make this permanent. */
    if (cardsHost && cardsHost.style.display !== "none") {
      cardsHost.style.display = "none";
      cardsHost.setAttribute("data-kl-superseded", "1");
    }
  }

  function klRenderInsights(agg, cardsHost) {
    if (!cardsHost || !cardsHost.parentNode) return;

    var existing = document.querySelector("[data-kl-insights]");
    if (existing) existing.remove();

    var wrap = klEl("div", "kl-insights");
    wrap.setAttribute("data-kl-insights", "1");

    /* ── Freshness strip: the real last data day, not today's date ──────── */
    var lastDay = agg.lastDataDay;
    var age = lastDay ? klDaysBetween(lastDay, agg.today) : null;
    var level = "crit";
    var pillText = "Gögn ekki fersk";
    if (age !== null && age <= 2) { level = "ok"; pillText = "Gögn fersk"; }
    else if (age !== null && age <= 7) { level = "warn"; pillText = "Gögn dagsett"; }

    var strip = klEl("div", "kl-strip kl-strip--" + level);
    strip.setAttribute("role", "status");
    var pill = klEl("span", "kl-pill kl-pill--" + level);
    pill.appendChild(klEl("span", "kl-pill-dot"));
    pill.appendChild(document.createTextNode(pillText));
    strip.appendChild(pill);

    var msg = klEl("span", "kl-strip-msg");
    if (lastDay) {
      msg.appendChild(document.createTextNode("Nýjustu eignuðu gögnin eru frá "));
      msg.appendChild(klEl("strong", null, lastDay));
      msg.appendChild(document.createTextNode(
        age === 0 ? " — í dag." : age === 1 ? " — í gær." : " — " + age + " dagar síðan."
      ));
    } else {
      msg.textContent = "Engin eignuð gögn fundust.";
    }
    strip.appendChild(msg);
    strip.appendChild(klEl("span", "kl-strip-sub", "last click, 30 d" + (agg.botExcluded ? ", án bot-klikka" : "")));
    wrap.appendChild(strip);

    /* ── Monthly timeline ──────────────────────────────────────────────── */
    var series = klBuildMonthSeries(agg.monthly, agg.today);
    var first = series[0];
    var timeline = klCard(
      "Eignaðar pantanir á mánuði",
      klMonthLabel(first.key, true) + " – " + klMonthLabel(series[series.length - 1].key, true),
      "Mánuður án súlu hefur engar raðir í eignunargögnunum. Það þýðir annaðhvort að ekkert " +
      "eignaðist herferð þann mánuð, eða að samstillingin lá niðri — gögnin greina það ekki í sundur."
    );
    var scroll = klEl("div", "kl-chart-scroll");
    scroll.appendChild(klRenderTimeline(series));
    timeline.appendChild(scroll);

    var legend = klEl("div", "kl-legend");
    [
      ["kl-swatch--s1", "Eignaðar pantanir"],
      ["kl-swatch--half", "Mánuður ekki búinn"],
      ["kl-swatch--void", "Engin skráning"]
    ].forEach(function (pair) {
      var item = klEl("span", "kl-legend-item");
      item.appendChild(klEl("span", "kl-swatch " + pair[0]));
      item.appendChild(document.createTextNode(pair[1]));
      legend.appendChild(item);
    });
    timeline.appendChild(legend);
    wrap.appendChild(timeline);

    /* ── Split: traceability + campaign table ──────────────────────────── */
    var split = klEl("div", "kl-split");

    var traced = agg.tracedOrders;
    var untraced = agg.untracedOrders;
    var totalAll = traced + untraced;
    var trace = klCard(
      "Hve mikið getum við rakið?",
      null,
      "Herferðalistinn getur aldrei stemmt við heildartöluna: pantanir sem eignast Klaviyo án " +
      "herferðar-ID komast ekki á lista. Það vantar ID í upprunann, það er ekki villa í listanum."
    );
    if (totalAll > 0) {
      var bar = klEl("div", "kl-trace-bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label",
        traced + " af " + totalAll + " pöntunum hafa herferðar-ID, " + untraced + " hafa ekkert ID.");
      var segA = klEl("span", "kl-trace-seg");
      segA.style.flex = String(traced);
      segA.style.background = "var(--kl-s2)";
      var segB = klEl("span", "kl-trace-seg");
      segB.style.flex = String(untraced);
      segB.style.background = "var(--kl-s1)";
      bar.appendChild(segA);
      bar.appendChild(segB);
      trace.appendChild(bar);
    }
    var rows = klEl("div", "kl-rows");
    rows.appendChild(klRow("Með herferðar-ID", formatNumber(traced),
      totalAll ? pct(traced / totalAll) : null, "var(--kl-s2)"));
    rows.appendChild(klRow("Ekkert ID", formatNumber(untraced),
      totalAll ? pct(untraced / totalAll) : null, "var(--kl-s1)"));
    rows.appendChild(klRow("Ólíkar herferðir frá upphafi", formatNumber(agg.campaignsAllTime), null, null));
    rows.appendChild(klRow("Eignuð sala frá upphafi", klMkr(agg.revenueInclAllTime) + " Mkr", "m. vsk", null));
    trace.appendChild(rows);
    split.appendChild(trace);

    var camp = klCard("Herferðir, síðustu 30 dagar", null, null);
    var countSpan = camp.querySelector(".kl-strip-sub");
    if (!countSpan) {
      countSpan = klEl("span", "kl-strip-sub");
      camp.querySelector(".kl-card-head").appendChild(countSpan);
    }
    countSpan.setAttribute("data-kl-campaign-count", "1");
    var tableHost = klEl("div");
    tableHost.setAttribute("data-kl-campaign-table", "1");
    camp.appendChild(tableHost);
    split.appendChild(camp);

    wrap.appendChild(split);

    /* Lead with the timeline. The Webflow section stacks
       [stats rows] → [spacer] → [data-klaviyo-campaign-cards], so inserting
       before the cards host would bury the chart below the old rows. Anchor
       on whichever sibling holds the first klaviyo metric instead, falling
       back to the cards host if the rows have already been removed. */
    var parent = cardsHost.parentNode;
    var anchor = cardsHost;
    var firstMetric = document.querySelector('[data-metric^="klaviyo-"]');
    if (firstMetric) {
      var node = firstMetric;
      while (node && node.parentNode !== parent) node = node.parentNode;
      if (node) anchor = node;
    }
    parent.insertBefore(wrap, anchor);
  }

  function fetchKlaviyoAttributionSummary() {
    if (!hasKlaviyoMetricTargets()) return Promise.resolve();
    if (klaviyoCacheTs && (Date.now() - klaviyoCacheTs) < STABLE_RPC_TTL_MS) return Promise.resolve();
    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();

    var today = getTodayIso();
    var from30d = shiftIsoDays(today, -29);
    var cardsHost = document.querySelector("[data-klaviyo-campaign-cards]");
    var includeBotClicks = false;
    if (cardsHost) includeBotClicks = String(cardsHost.getAttribute("data-klaviyo-include-bot-clicks") || "").toLowerCase() === "true";
    if (!includeBotClicks && document.body) {
      includeBotClicks = String(document.body.getAttribute("data-klaviyo-include-bot-clicks") || "").toLowerCase() === "true";
    }
    var attributionMvName = includeBotClicks ? "mv_klaviyo_attribution_daily" : "mv_klaviyo_attribution_daily_nobot";
    var campaignCardsViewName = includeBotClicks ? "v_klaviyo_campaign_cards_30d" : "v_klaviyo_campaign_cards_30d_nobot";

    var endpoint = (cfg.supabaseUrl || "") + "/rest/v1/" + attributionMvName;
    var query =
      "?select=order_date,campaign_id,attributed_orders,attributed_revenue_excl,attributed_revenue_incl" +
      "&limit=5000";
    var campaignCardsEndpoint = (cfg.supabaseUrl || "") + "/rest/v1/" + campaignCardsViewName;
    var campaignCardsQuery =
      "?select=campaign_id,campaign_name,attributed_orders_30d,attributed_revenue_excl_30d,attributed_revenue_incl_30d" +
      "&limit=50";

    function setKlaviyoQualityLine(orders30d, syncDate) {
      var host = document.querySelector("[data-klaviyo-quality-line]");
      if (!host) return;
      var excludedText = includeBotClicks ? "nei" : "ja";
      host.textContent =
        "Gaeðastada: Klaviyo pantanir (30d): " + toNumberSafe(orders30d) +
        " | Bot Click utilekad: " + excludedText +
        " | Sidast samstillt: " + (syncDate || "-");
    }

    function setKlaviyoAttributionMethodMetric() {
      var excludedText = includeBotClicks ? "nei" : "ja";
      setText(
        "klaviyo-attribution-method",
        "Last click, 30 dagar, netfangssamsvorun, Bot Click utilekad: " + excludedText
      );
    }

    function fetchAndRenderCampaignCards(retryLeft) {
      if (!cardsHost) return Promise.resolve();
      return fetch(campaignCardsEndpoint + campaignCardsQuery, {
        method: "GET",
        cache: "no-store",
        headers: {
          "apikey": apiKey,
          "Authorization": "Bearer " + apiKey,
          "Accept-Profile": "mart"
        }
      })
        .then(function (r2) {
          if (!r2.ok) throw new Error("Klaviyo campaign cards HTTP " + r2.status);
          return r2.json();
        })
        .then(function (campaignRows) {
          renderKlaviyoCampaignCards(campaignRows);
          try {
            klRenderCampaignTable(campaignRows, cardsHost);
          } catch (tableErr) {
            log("Klaviyo campaign table render failed:", tableErr);
          }
        })
        .catch(function (err2) {
          if (retryLeft > 0) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(fetchAndRenderCampaignCards(retryLeft - 1));
              }, 1200);
            });
          }
          log("Klaviyo campaign cards fetch failed:", err2);
        });
    }

    function renderKlaviyoCampaignCards(rows) {
      if (!cardsHost) return;
      var list = Array.isArray(rows) ? rows : [];
      var totalOrders = 0;
      var totalRevenueExcl = 0;
      list.forEach(function (r0) {
        totalOrders += toNumberSafe(r0 && r0.attributed_orders_30d);
        totalRevenueExcl += toNumberSafe(r0 && r0.attributed_revenue_excl_30d);
      });

      var template = cardsHost.querySelector("[data-kc-template]");
      cardsHost.querySelectorAll("[data-kc-rendered]").forEach(function (el) { el.remove(); });

      if (!list.length) return;

      if (template) {
        list.forEach(function (r) {
          var name = String((r && r.campaign_name) || (r && r.campaign_id) || "Unknown campaign");
          var orders = toNumberSafe(r && r.attributed_orders_30d);
          var revExclRaw = toNumberSafe(r && r.attributed_revenue_excl_30d);
          var revExcl = formatNumber(revExclRaw);
          var revIncl = formatNumber(r && r.attributed_revenue_incl_30d);
          var ordersShare = totalOrders > 0 ? pct(orders / totalOrders) : "0%";
          var revenueShare = totalRevenueExcl > 0 ? pct(revExclRaw / totalRevenueExcl) : "0%";
          var cid = String((r && r.campaign_id) || "");

          var card = template.cloneNode(true);
          card.removeAttribute("data-kc-template");
          card.setAttribute("data-kc-rendered", "1");
          card.setAttribute("data-campaign-id", cid);
          card.style.display = "";

          var titleEl = card.querySelector("[data-kc-title]") || card.querySelector(".klaviyo-campaign-card-title");
          if (titleEl) titleEl.textContent = name;

          var valueMap = {
            "orders-30d": String(orders),
            "revenue-excl-30d": String(revExcl),
            "revenue-incl-30d": String(revIncl),
            "orders-share-30d": String(ordersShare),
            "revenue-share-30d": String(revenueShare)
          };

          Object.keys(valueMap).forEach(function (key) {
            var valueEl = card.querySelector('[data-kc-value="' + key + '"]');
            if (valueEl) valueEl.textContent = valueMap[key];
          });

          cardsHost.appendChild(card);
        });
        return;
      }

      var html = "";
      function metricRowHtml(key, value) {
        return ''
          + '<div class="klaviyo-campaign-card-meta klaviyo-campaign-card-meta-' + key + '" data-kc-row="' + key + '">'
          +   '<span class="klaviyo-campaign-card-value" data-kc-value="' + key + '">' + value + '</span>'
          + '</div>';
      }
      list.forEach(function (r) {
        var name = String((r && r.campaign_name) || (r && r.campaign_id) || "Unknown campaign");
        var orders = toNumberSafe(r && r.attributed_orders_30d);
        var revExclRaw = toNumberSafe(r && r.attributed_revenue_excl_30d);
        var revExcl = formatNumber(revExclRaw);
        var revIncl = formatNumber(r && r.attributed_revenue_incl_30d);
        var ordersShare = totalOrders > 0 ? pct(orders / totalOrders) : "0%";
        var revenueShare = totalRevenueExcl > 0 ? pct(revExclRaw / totalRevenueExcl) : "0%";
        var cid = String((r && r.campaign_id) || "");

        html += ''
          + '<div class="klaviyo-campaign-card" data-campaign-id="' + cid + '" data-kc-rendered="1">'
          +   '<div class="klaviyo-campaign-card-title">' + name + '</div>'
          +   metricRowHtml("orders-30d", String(orders))
          +   metricRowHtml("revenue-excl-30d", String(revExcl))
          +   metricRowHtml("revenue-incl-30d", String(revIncl))
          +   metricRowHtml("orders-share-30d", String(ordersShare))
          +   metricRowHtml("revenue-share-30d", String(revenueShare))
          + '</div>';
      });
      cardsHost.insertAdjacentHTML("beforeend", html);
    }
    return fetch(endpoint + query, {
      method: "GET",
      cache: "no-store",
      headers: {
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey,
        "Accept-Profile": "mart"
      }
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Klaviyo MV HTTP " + r.status);
        return r.json();
      })
      .then(function (rows) {
        var list = Array.isArray(rows) ? rows : [];
        var totals = {
          orders30d: 0,
          revenueExcl30d: 0,
          revenueIncl30d: 0,
          ordersToday: 0,
          revenueExclToday: 0,
          revenueInclToday: 0,
          ordersAllTime: 0,
          revenueExclAllTime: 0,
          revenueInclAllTime: 0,
          campaigns30d: {},
          /* extras for the insights block */
          monthly: {},
          campaignsAllTime: {},
          tracedOrders: 0,
          untracedOrders: 0,
          lastDataDay: ""
        };

        list.forEach(function (r) {
          var d = normalizeDay(r && r.order_date);
          var orders = toNumberSafe(r && r.attributed_orders);
          var revExcl = toNumberSafe(r && r.attributed_revenue_excl);
          var revIncl = toNumberSafe(r && r.attributed_revenue_incl);
          var cid = String((r && r.campaign_id) || "").trim();

          totals.ordersAllTime += orders;
          totals.revenueExclAllTime += revExcl;
          totals.revenueInclAllTime += revIncl;

          if (d) {
            if (!totals.lastDataDay || d > totals.lastDataDay) totals.lastDataDay = d;
            var mk = d.slice(0, 7);
            if (!totals.monthly[mk]) totals.monthly[mk] = { orders: 0, revIncl: 0 };
            totals.monthly[mk].orders += orders;
            totals.monthly[mk].revIncl += revIncl;
          }
          if (cid) {
            totals.campaignsAllTime[cid] = 1;
            totals.tracedOrders += orders;
          } else {
            totals.untracedOrders += orders;
          }

          if (d && d >= from30d && d <= today) {
            totals.orders30d += orders;
            totals.revenueExcl30d += revExcl;
            totals.revenueIncl30d += revIncl;
            if (cid) totals.campaigns30d[cid] = 1;
          }

          if (d === today) {
            totals.ordersToday += orders;
            totals.revenueExclToday += revExcl;
            totals.revenueInclToday += revIncl;
          }
        });

        klaviyoCacheTs = Date.now();
        setText("klaviyo-orders-30d", toNumberSafe(totals.orders30d));
        setText("klaviyo-revenue-excl-30d", formatNumber(totals.revenueExcl30d));
        setText("klaviyo-revenue-incl-30d", formatNumber(totals.revenueIncl30d));
        setText("klaviyo-orders-today", toNumberSafe(totals.ordersToday));
        setText("klaviyo-revenue-excl-today", formatNumber(totals.revenueExclToday));
        setText("klaviyo-revenue-incl-today", formatNumber(totals.revenueInclToday));
        setText("klaviyo-active-campaigns-30d", Object.keys(totals.campaigns30d).length);
        setText("klaviyo-orders-all-time", toNumberSafe(totals.ordersAllTime));
        setText("klaviyo-revenue-excl-all-time", formatNumber(totals.revenueExclAllTime));
        setText("klaviyo-revenue-incl-all-time", formatNumber(totals.revenueInclAllTime));
        /* The real last day with attributed data — this used to print today's
           date unconditionally, so the page always claimed to be current. */
        var freshness = totals.lastDataDay || "-";
        setText("klaviyo-last-sync-date", freshness);
        setKlaviyoAttributionMethodMetric();
        setKlaviyoQualityLine(totals.orders30d, freshness);

        /* Additive insights block. Wrapped so a failure here cannot take the
           existing rows or the campaign cards down with it. */
        try {
          klRenderInsights({
            today: today,
            lastDataDay: totals.lastDataDay,
            monthly: totals.monthly,
            tracedOrders: totals.tracedOrders,
            untracedOrders: totals.untracedOrders,
            campaignsAllTime: Object.keys(totals.campaignsAllTime).length,
            revenueInclAllTime: totals.revenueInclAllTime,
            botExcluded: !includeBotClicks
          }, cardsHost);
        } catch (insightsErr) {
          log("Klaviyo insights render failed:", insightsErr);
        }

        return fetchAndRenderCampaignCards(1);
      })
      .catch(function (err) {
        log("Klaviyo attribution fetch failed:", err);
        setText("klaviyo-last-sync-date", "error");
        setKlaviyoAttributionMethodMetric();
        setKlaviyoQualityLine(0, "error");
      });
  }

  function formatSyncDateTime(iso) {
    var s = String(iso || "").trim();
    if (!s) return "-";
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    try {
      return new Intl.DateTimeFormat("is-IS", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(d);
    } catch (_) {
      return d.toISOString();
    }
  }

  function fetchBcSyncStatus() {
    if (!document.querySelector('[data-metric="bc-last-sync-at"]')
      && !document.querySelector('[data-metric="bc-sync-errors-24h"]')) {
      return Promise.resolve();
    }
    if (bcSyncCacheTs && (Date.now() - bcSyncCacheTs) < STABLE_RPC_TTL_MS) return Promise.resolve();

    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();

    var endpoint = (cfg.supabaseUrl || "") + "/rest/v1/rpc/bc_sync_status";
    return fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({})
    })
      .then(function (r) {
        if (!r.ok) throw new Error("BC sync status RPC HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        var row = Array.isArray(raw) ? (raw[0] || null) : raw;
        if (!row) return;
        bcSyncCacheTs = Date.now();
        setText("bc-last-sync-at", formatSyncDateTime(row.last_success_at));
        if (row.error_count_24h != null) {
          setText("bc-sync-errors-24h", toNumberSafe(row.error_count_24h));
        }
      })
      .catch(function (err) {
        log("BC sync status fetch failed:", err);
      });
  }

  function hasWebBookingMetricTargets() {
    return !!document.querySelector('[data-metric="web-booking-rate-exact-30d"]')
      || !!document.querySelector('[data-metric="web-booking-rate-est-30d"]')
      || !!document.querySelector('[data-metric="web-booking-orders-30d"]')
      || !!document.querySelector('[data-metric="web-booking-booked-exact-30d"]')
      || !!document.querySelector('[data-metric="web-booking-booked-est-30d"]')
      || !!document.querySelector('[data-metric="web-booking-gap-exact-30d"]')
      || !!document.querySelector('[data-metric="web-booking-gap-est-30d"]');
  }

  function fetchWebBookingReconciliationSummary() {
    if (!hasWebBookingMetricTargets()) return Promise.resolve();
    if (webBookingCacheTs && (Date.now() - webBookingCacheTs) < STABLE_RPC_TTL_MS) return Promise.resolve();

    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();

    var endpoint = (cfg.supabaseUrl || "") + "/rest/v1/rpc/web_booking_reconciliation_30d";
    var viewEndpoint = (cfg.supabaseUrl || "") + "/rest/v1/v_web_booking_reconciliation_daily_v2";

    function applyRow(row) {
      if (!row) return;
      webBookingCacheTs = Date.now();
      setText("web-booking-orders-30d", toNumberSafe(row.web_orders_30d));
      setText("web-booking-booked-exact-30d", toNumberSafe(row.web_orders_booked_exact_30d));
      setText("web-booking-booked-est-30d", toNumberSafe(row.web_orders_booked_est_30d));
      setText("web-booking-gap-exact-30d", toNumberSafe(row.web_orders_unbooked_gap_exact_30d));
      setText("web-booking-gap-est-30d", toNumberSafe(row.web_orders_unbooked_gap_est_30d));
      setText("web-booking-rate-exact-30d", pct(row.booking_rate_exact_30d));
      setText("web-booking-rate-est-30d", pct(row.booking_rate_est_30d));
    }

    function fallbackFromView() {
      var today = getTodayIso();
      var from30d = shiftIsoDays(today, -29);
      var query =
        "?select=day,web_orders_magento,web_orders_booked_exact,web_orders_booked_total_est,web_orders_unbooked_gap_exact,web_orders_unbooked_gap_est" +
        "&day=gte." + encodeURIComponent(from30d) +
        "&day=lte." + encodeURIComponent(today) +
        "&limit=200";
      return fetch(viewEndpoint + query, {
        method: "GET",
        cache: "no-store",
        headers: {
          "apikey": apiKey,
          "Authorization": "Bearer " + apiKey,
          "Accept-Profile": "mart"
        }
      })
        .then(function (r) {
          if (!r.ok) throw new Error("v_web_booking_reconciliation_daily_v2 HTTP " + r.status);
          return r.json();
        })
        .then(function (rows) {
          var list = Array.isArray(rows) ? rows : [];
          var agg = {
            web_orders_30d: 0,
            web_orders_booked_exact_30d: 0,
            web_orders_booked_est_30d: 0,
            web_orders_unbooked_gap_exact_30d: 0,
            web_orders_unbooked_gap_est_30d: 0,
            booking_rate_exact_30d: 0,
            booking_rate_est_30d: 0
          };
          list.forEach(function (r) {
            agg.web_orders_30d += toNumberSafe(r && r.web_orders_magento);
            agg.web_orders_booked_exact_30d += toNumberSafe(r && r.web_orders_booked_exact);
            agg.web_orders_booked_est_30d += toNumberSafe(r && r.web_orders_booked_total_est);
            agg.web_orders_unbooked_gap_exact_30d += toNumberSafe(r && r.web_orders_unbooked_gap_exact);
            agg.web_orders_unbooked_gap_est_30d += toNumberSafe(r && r.web_orders_unbooked_gap_est);
          });
          if (agg.web_orders_30d > 0) {
            agg.booking_rate_exact_30d = agg.web_orders_booked_exact_30d / agg.web_orders_30d;
            agg.booking_rate_est_30d = agg.web_orders_booked_est_30d / agg.web_orders_30d;
          }
          applyRow(agg);
        });
    }

    return fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({})
    })
      .then(function (r) {
        if (!r.ok) throw new Error("web_booking_reconciliation_30d RPC HTTP " + r.status);
        return r.json();
      })
      .then(function (raw) {
        var row = Array.isArray(raw) ? (raw[0] || null) : raw;
        if (!row) return fallbackFromView();
        applyRow(row);
      })
      .catch(function (err) {
        log("Web booking reconciliation fetch failed:", err);
        return fallbackFromView().catch(function (fallbackErr) {
          log("Web booking reconciliation fallback failed:", fallbackErr);
        });
      });
  }

  function applyMeterUpgrades() {
    document.querySelectorAll(".meter[data-upgrade]").forEach(function (meter) {
      var upgrade = meter.getAttribute("data-upgrade");
      var fill = meter.querySelector("[data-fill-from]");
      if (!fill) return;
      var key = fill.getAttribute("data-fill-from");

      if (upgrade === "arc-blue" || upgrade === "arc-amber") {
        var color = upgrade.replace("arc-", "");

        var wrap = document.createElement("div");
        wrap.className = "arc-meter-wrap arc-meter-wrap--" + color;

        var arc = document.createElement("div");
        arc.className = "arc-meter arc-meter--" + color;
        arc.setAttribute("data-fill-from", key);

        var label = document.createElement("span");
        label.className = "arc-meter-label";
        label.setAttribute("data-metric", key);
        label.textContent = "-";

        wrap.appendChild(arc);
        wrap.appendChild(label);
        meter.parentNode.insertBefore(wrap, meter);
        meter.style.display = "none";

      } else if (upgrade === "pill") {
        var card = meter.closest(".webapp-item");
        var metricEl = card && card.querySelector('[data-metric="' + key + '"]');
        if (metricEl) metricEl.classList.add("delta-pill");
        meter.style.display = "none";
      }
    });
  }

  // ── SVG arc fallback (Samsung TV / browsers without conic-gradient) ─────────
  var _svgNS = "http://www.w3.org/2000/svg";
  var _conicOk = null;

  function conicSupported() {
    if (_conicOk !== null) return _conicOk;
    try {
      _conicOk = (typeof CSS !== "undefined" && CSS.supports)
        ? CSS.supports("background", "conic-gradient(red 0%,blue 100%)")
        : (function () { var e = document.createElement("div"); e.style.background = "conic-gradient(red 0%,blue 100%)"; return !!e.style.background; })();
    } catch (e) { _conicOk = false; }
    return _conicOk;
  }

  function _svgCircle(stroke, dasharray) {
    var c = document.createElementNS(_svgNS, "circle");
    c.setAttribute("cx", "18"); c.setAttribute("cy", "18"); c.setAttribute("r", "15.9155");
    c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "3.5");
    c.setAttribute("stroke", stroke);
    c.setAttribute("stroke-dasharray", dasharray);
    return c;
  }

  function _svgWrap(children) {
    var svg = document.createElementNS(_svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.style.cssText = "position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible";
    children.forEach(function (c) { svg.appendChild(c); });
    return svg;
  }

  function applyArcFallbacks() {
    if (conicSupported()) return;
    // Single arcs
    document.querySelectorAll(".arc-meter[data-fill-from]").forEach(function (arcEl) {
      var color = arcEl.classList.contains("arc-meter--amber") ? "#fdc65d" : "#8077fa";
      var track = _svgCircle("#e9e9e9", "100,100");
      var fill  = _svgCircle(color, "0,100");
      fill.setAttribute("stroke-linecap", "round");
      fill.classList.add("arc-svg-fill");
      arcEl.appendChild(_svgWrap([track, fill]));
      arcEl.removeAttribute("style");
      arcEl.setAttribute("data-svg-arc", "1");
    });
    // Split arcs
    document.querySelectorAll(".arc-meter-wrap[data-seg-a]").forEach(function (wrapEl) {
      var arcEl = wrapEl.querySelector(".arc-meter");
      if (!arcEl) return;
      var track = _svgCircle("#e9e9e9", "100,100");
      var fillA = _svgCircle("#8077fa", "0,100"); fillA.setAttribute("stroke-linecap", "round"); fillA.classList.add("arc-svg-fill-a");
      var fillB = _svgCircle("#c4e08c", "0,100"); fillB.setAttribute("stroke-linecap", "round"); fillB.classList.add("arc-svg-fill-b");
      arcEl.appendChild(_svgWrap([track, fillA, fillB]));
      arcEl.removeAttribute("style");
      wrapEl.setAttribute("data-svg-arc", "1");
    });
  }

  function init() {
    populateMonthDropdown();
    applyArcFallbacks();
    applyMeterUpgrades();
    initDayContextBadge_();
    var items = document.querySelectorAll(".dashboard-date-item[data-month]");
    var hasMetrics = !!document.querySelector("[data-metric]");
    var dayPicker = document.querySelector("input[data-day-picker], [data-day-picker] input[type='date'], input[type='date'][data-day-picker]");
    var dayMode = getDayMode();

    if (!items.length && !hasMetrics && !dayPicker) return;
    log("Found month items:", items.length);
    applyDigitalAdoptionDisclaimer();

    if (dayPicker && dayMode !== "live") {
      dayPicker.setAttribute("lang", "is-IS");
      var initialDay = normalizeDay(dayPicker.value) || getTodayIso();
      dayPicker.value = initialDay;
      selectedDay = initialDay;
      initFlatpickrIfAvailable(dayPicker);
      dayPicker.addEventListener("change", function () {
        var next = normalizeDay(dayPicker.value);
        selectedDay = next || getTodayIso();
        fetchDay(selectedDay);
        fetchDayOrders(selectedDay);
      });
    } else if (dayMode === "live") {
      selectedDay = getTodayIso();
    }

    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(".dashboard-date-item[data-month]") : null;
      if (!el) return;
      var month = el.getAttribute("data-month");
      setActiveByMonth(month);
      setCurrentMonthLabel(month);
      if (dayMode === "live") selectedDay = getTodayIso();
      fetchMonth(month);
      fetchDay(selectedDay || getTodayIso());
      fetchDayOrders(selectedDay || getTodayIso());
    });

    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-weekday-iso]") : null;
      if (!el) return;
      ev.preventDefault();
      var iso = Number(el.getAttribute("data-weekday-iso"));
      if (!Number.isFinite(iso) || iso < 1 || iso > 7) return;
      selectedWeekdayIso = (selectedWeekdayIso === iso) ? null : iso;
      setWeekdayChipActive();
      if (selectedWeekdayIso == null) {
        fetchDay(selectedDay || getTodayIso());
        return;
      }
      fetchWeekdayAverage(selectedWeekdayIso);
    });

    var active = document.querySelector(".dashboard-date-item.active[data-month]");
    var first = document.querySelector(".dashboard-date-item[data-month]");
    var initialMonth = active ? active.getAttribute("data-month") : (first ? first.getAttribute("data-month") : getCurrentMonthKey());
    setCurrentMonthLabel(initialMonth);

    Promise.allSettled([
      fetchMonth(initialMonth),
      fetchDay(selectedDay || getTodayIso()),
      fetchDayOrders(selectedDay || getTodayIso()),
      fetchWeekdayComparisonGrid(true),
      fetchKlaviyoAttributionSummary(),
      fetchBcSyncStatus(),
      fetchWebBookingReconciliationSummary()
    ]).then(function () {
      emitPageReady();
    });

    setInterval(function () {
      var activeNow = document.querySelector(".dashboard-date-item.active[data-month]");
      var month = activeNow ? activeNow.getAttribute("data-month") : (initialMonth || getCurrentMonthKey());
      if (dayMode === "live") selectedDay = getTodayIso();
      setCurrentMonthLabel(month);
      fetchMonth(month);
      fetchDay(selectedDay || getTodayIso());
      fetchDayOrders(selectedDay || getTodayIso());
      fetchKlaviyoAttributionSummary();
      fetchBcSyncStatus();
      fetchWebBookingReconciliationSummary();
    }, 120000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

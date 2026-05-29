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
    if (hour < t.suppress) return { text: "Dagurinn er ungur", suppress: true };
    if (hour < t.suppress + 2) return { text: "Sala í gangi", suppress: false };
    if (hour >= t.late) return { text: "Dagurinn að ljúka", suppress: false };
    if (deltaDec > 0.3) return { text: "Sterk dagssala", suppress: false };
    if (deltaDec < -0.3) return { text: "Hægur dagur", suppress: false };
    return { text: null, suppress: false };
  }

  function getDayTooltipText_(hour, thresholds) {
    var t = thresholds || { suppress: 10, late: 16 };
    if (hour < t.suppress) return "Sala hefst venjulega um kl. " + t.suppress + ". Samanburður við meðaltal gefur betri mynd þegar líður á daginn.";
    if (hour < t.suppress + 2) return "Annasamt tímabil er að hefjast. Samanburður er að verða áreiðanlegri.";
    if (hour < t.late) return "Meirihluti daglegra pantana kemur fyrir kl. " + t.late + ". Góð staða ef yfir meðaltali.";
    return "Sala eftir kl. " + t.late + " er venjulega lítil. Þetta er nánast lokaniðurstaðan.";
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
    if (deltaRow) deltaRow.style.visibility = ctx.suppress ? "hidden" : "";
    if (tooltipEl && !_dayTooltipOpen) tooltipEl.textContent = getDayTooltipText_(hour, thresholds);
    badge._thresholds = thresholds;
  }

  function initDayContextBadge_() {
    var badge = document.querySelector("[data-day-context-badge]");
    if (!badge || badge.getAttribute("data-ctx-init")) return;
    badge.setAttribute("data-ctx-init", "1");
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
    rows.forEach(function (row) {
      if (!row.purchase_date) return;
      var h = new Date(row.purchase_date).getHours();
      if (h >= 0 && h < 24) counts[h]++;
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
          campaigns30d: {}
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
        setText("klaviyo-last-sync-date", today);
        setKlaviyoAttributionMethodMetric();
        setKlaviyoQualityLine(totals.orders30d, today);

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

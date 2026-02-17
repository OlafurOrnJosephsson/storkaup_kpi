(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__STORKAUP_DASHBOARD_INIT__) return;
  window.__STORKAUP_DASHBOARD_INIT__ = true;
  var selectedDay = null;
  var dayApiUnavailable = false;
  var DEBUG = true;

  function log() { if (DEBUG && window.console) console.log.apply(console, arguments); }
  function getCfg() { return window.STORKAUP_CONFIG || {}; }
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

  function parsePercent(text) {
    if (!text) return null;
    var cleaned = text.toString().trim().replace("%", "").replace(",", ".");
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function setText(metric, valueText) {
    var el = document.querySelector('[data-metric="' + metric + '"]');
    if (el) el.textContent = valueText;
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

  function buildMetricMap() {
    var values = {};
    document.querySelectorAll(".webapp-data[data-metric]").forEach(function (el) {
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
      var clamped = Math.max(0, Math.min(100, p == null ? 0 : p));
      fill.style.width = clamped + "%";
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

  function normalizeRpcPayload(raw) {
    var data = raw;
    if (Array.isArray(data)) data = data[0];
    if (data && data.dashboard_compat) data = data.dashboard_compat;
    return data;
  }

  function getTodayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeDay(day) {
    var s = String(day || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function getActiveMonth() {
    var active = document.querySelector(".dashboard-date-item.active[data-month]");
    var first = document.querySelector(".dashboard-date-item[data-month]");
    return active ? active.getAttribute("data-month") : (first ? first.getAttribute("data-month") : null);
  }

  function applyDayMetrics(dayKey, orders, revenueExcl, revenueIncl) {
    setText("day-date", formatDayLabel(dayKey || ""));
    setText("day-orders", toNumberSafe(orders));
    setText("day-revenue-excl", formatNumber(revenueExcl));
    setText("day-revenue-incl", formatNumber(revenueIncl));
  }

  function applyDayAdvancedMetrics(row) {
    if (!row) return;
    setText("day-aov-excl", formatNumber(row.aov_excl));
    setSignedMetric("day-vs-yesterday-orders-pct", row.vs_yesterday_orders_pct);
    setSignedMetric("day-vs-yesterday-revenue-pct", row.vs_yesterday_revenue_excl_pct);
    setSignedMetric("day-vs-yesterday-aov-pct", row.vs_yesterday_aov_excl_pct);
    setSignedMetric("day-vs-lastweek-orders-pct", row.vs_lastweek_orders_pct);
    setSignedMetric("day-vs-lastweek-revenue-pct", row.vs_lastweek_revenue_excl_pct);
    setSignedMetric("day-vs-lastweek-aov-pct", row.vs_lastweek_aov_excl_pct);
    setText("day-unique-buyers", toNumberSafe(row.unique_buyers));
    setText("day-repeat-buyer-pct", pct(row.repeat_buyer_pct));
    setText("day-first-time-buyers", toNumberSafe(row.first_time_buyers));
    setText("day-current-hour-orders", toNumberSafe(row.current_hour_orders));
    setText("day-current-hour-revenue-excl", formatNumber(row.current_hour_revenue_excl));
    setText("day-eod-orders-forecast", formatNumber(row.eod_orders_forecast));
    setText("day-eod-revenue-excl-forecast", formatNumber(row.eod_revenue_excl_forecast));
    setSignedMetric("day-eod-orders-vs-lastweek-pct", row.eod_orders_vs_lastweek_pct);
    setSignedMetric("day-eod-revenue-vs-lastweek-pct", row.eod_revenue_excl_vs_lastweek_pct);
    setText("day-top-customer-1", row.top_customer_1 || "");
    setText("day-top-customer-2", row.top_customer_2 || "");
    setText("day-top-customer-3", row.top_customer_3 || "");
    setText("day-hourly-series-json", JSON.stringify(row.hourly_series || []));
  }

  function normalizeSingleRow(raw) {
    var data = raw;
    if (Array.isArray(data)) data = data[0];
    return data || null;
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

    if (mode === "iso") return s;
    if (mode === "slash") return dd + "/" + mm + "/" + yyyy;
    if (mode === "long-is") {
      var d = new Date(s + "T00:00:00");
      if (!isNaN(d.getTime()) && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        return new Intl.DateTimeFormat("is-IS", { day: "numeric", month: "long", year: "numeric" }).format(d);
      }
    }

    // Default: dd.mm.yyyy
    return dd + "." + mm + "." + yyyy;
  }

  function initFlatpickrIfAvailable(dayPicker) {
    if (!dayPicker || typeof window.flatpickr !== "function") return;
    if (dayPicker._flatpickr) return;

    try {
      window.flatpickr(dayPicker, {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
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
        "Authorization": "Bearer " + apiKey
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
        // Fall back to monthly payload day values if day endpoint is unauthorized/unavailable.
        selectedDay = null;
        fetchMonth(getActiveMonth());
      });
  }

  function fetchMonth(month) {
    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    var rpcUrl = getRpcUrl();
    if (!cfg.supabaseUrl || !apiKey) {
      log("Missing STORKAUP_CONFIG.supabaseUrl or publishableKey");
      return Promise.resolve();
    }

    log("Fetching month:", month, rpcUrl);

    return fetch(rpcUrl, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({ p_month: month || null })
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
        setText("month-salesrep-pct", pct(data.month.salesRepPct));
        setText("month-yoy-orders", pct(data.month.yoyOrdersPct));
        if (!selectedDay) {
          var dayDate = (data.day && data.day.date) ? data.day.date : getTodayIso();
          var dayOrders = data.dayOrders != null ? data.dayOrders : (data.day ? data.day.orders : 0);
          var dayRevenueExcl = data.dayRevenueExcl != null ? data.dayRevenueExcl : (data.day ? data.day.revenueExcl : 0);
          var dayRevenueIncl = data.day && data.day.revenueIncl != null ? data.day.revenueIncl : 0;
          applyDayMetrics(dayDate, dayOrders, dayRevenueExcl, dayRevenueIncl);
        }
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

        var values = buildMetricMap();
        updateMeters(values);
        updateDiverging(values);
      })
      .catch(function (err) {
        log("Fetch failed:", err);
      });
  }

  function init() {
    var items = document.querySelectorAll(".dashboard-date-item[data-month]");
    log("Found month items:", items.length);
    var dayPicker = document.querySelector("input[data-day-picker], [data-day-picker] input[type='date'], input[type='date'][data-day-picker]");

    if (dayPicker) {
      var initialDay = normalizeDay(dayPicker.value) || getTodayIso();
      dayPicker.value = initialDay;
      initFlatpickrIfAvailable(dayPicker);
      dayPicker.addEventListener("change", function () {
        var next = normalizeDay(dayPicker.value);
        selectedDay = next || null;
        if (selectedDay) {
          fetchDay(selectedDay);
        } else {
          fetchMonth(getActiveMonth());
        }
      });
    }

    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(".dashboard-date-item[data-month]") : null;
      if (!el) return;
      var month = el.getAttribute("data-month");
      setActiveByMonth(month);
      fetchMonth(month);
      if (selectedDay) fetchDay(selectedDay);
    });

    var active = document.querySelector(".dashboard-date-item.active[data-month]");
    var first = document.querySelector(".dashboard-date-item[data-month]");
    var initialMonth = active ? active.getAttribute("data-month") : (first ? first.getAttribute("data-month") : null);

    fetchMonth(initialMonth);
    if (selectedDay) fetchDay(selectedDay);

    setInterval(function () {
      var activeNow = document.querySelector(".dashboard-date-item.active[data-month]");
      var month = activeNow ? activeNow.getAttribute("data-month") : initialMonth;
      fetchMonth(month);
      if (selectedDay) fetchDay(selectedDay);
    }, 120000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

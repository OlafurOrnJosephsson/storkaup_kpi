(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__STORKAUP_DASHBOARD_INIT__) return;
  window.__STORKAUP_DASHBOARD_INIT__ = true;
  var selectedDay = null;
  var selectedWeekdayIso = null; // 1..7 (Mon..Sun) for separate weekday-average chart override
  var weekdayGridCacheDay = null;
  var weekdayGridCacheTs = 0;
  var dayApiUnavailable = false;
  var DEBUG = true;
  var WEEKDAY_SHORT_IS = { 1: "Mán", 2: "Þri", 3: "Mið", 4: "Fim", 5: "Fös", 6: "Lau", 7: "Sun" };

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
        "Authorization": "Bearer " + apiKey
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
          "Authorization": "Bearer " + apiKey
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

    var cfg = getCfg();
    var apiKey = cfg.publishableKey || "";
    if (!cfg.supabaseUrl || !apiKey) return Promise.resolve();

    var endpoint = (cfg.supabaseUrl || "") + "/rest/v1/rpc/web_booking_reconciliation_30d";
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
        if (!row) return;

        setText("web-booking-orders-30d", toNumberSafe(row.web_orders_30d));
        setText("web-booking-booked-exact-30d", toNumberSafe(row.web_orders_booked_exact_30d));
        setText("web-booking-booked-est-30d", toNumberSafe(row.web_orders_booked_est_30d));
        setText("web-booking-gap-exact-30d", toNumberSafe(row.web_orders_unbooked_gap_exact_30d));
        setText("web-booking-gap-est-30d", toNumberSafe(row.web_orders_unbooked_gap_est_30d));
        setText("web-booking-rate-exact-30d", pct(row.booking_rate_exact_30d));
        setText("web-booking-rate-est-30d", pct(row.booking_rate_est_30d));
      })
      .catch(function (err) {
        log("Web booking reconciliation fetch failed:", err);
      });
  }

  function init() {
    var items = document.querySelectorAll(".dashboard-date-item[data-month]");
    var hasMetrics = !!document.querySelector("[data-metric]");
    var dayPicker = document.querySelector("input[data-day-picker], [data-day-picker] input[type='date'], input[type='date'][data-day-picker]");

    if (!items.length && !hasMetrics && !dayPicker) return;
    log("Found month items:", items.length);

    if (dayPicker) {
      var initialDay = normalizeDay(dayPicker.value) || getTodayIso();
      dayPicker.value = initialDay;
      selectedDay = initialDay;
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

    document.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-weekday-iso]") : null;
      if (!el) return;
      ev.preventDefault();
      var iso = Number(el.getAttribute("data-weekday-iso"));
      if (!Number.isFinite(iso) || iso < 1 || iso > 7) return;
      selectedWeekdayIso = (selectedWeekdayIso === iso) ? null : iso;
      setWeekdayChipActive();
      if (selectedWeekdayIso == null) {
        if (selectedDay) fetchDay(selectedDay);
        return;
      }
      fetchWeekdayAverage(selectedWeekdayIso);
    });

    var active = document.querySelector(".dashboard-date-item.active[data-month]");
    var first = document.querySelector(".dashboard-date-item[data-month]");
    var initialMonth = active ? active.getAttribute("data-month") : (first ? first.getAttribute("data-month") : null);

    fetchMonth(initialMonth);
    if (selectedDay) fetchDay(selectedDay);
    fetchWeekdayComparisonGrid(true);
    fetchKlaviyoAttributionSummary();
    fetchBcSyncStatus();
    fetchWebBookingReconciliationSummary();

    setInterval(function () {
      var activeNow = document.querySelector(".dashboard-date-item.active[data-month]");
      var month = activeNow ? activeNow.getAttribute("data-month") : initialMonth;
      fetchMonth(month);
      if (selectedDay) fetchDay(selectedDay);
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

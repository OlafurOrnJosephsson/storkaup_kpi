(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__STORKAUP_WEBSITE_DASHBOARD_INIT__) return;
  window.__STORKAUP_WEBSITE_DASHBOARD_INIT__ = true;

  var DEBUG = false;
  var pageReadySent = false;
  var selectedDay = null;

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
    return now.toISOString().slice(0, 10);
  }

  function shiftIsoDays(dayStr, delta) {
    var s = normalizeDay(dayStr);
    if (!s) return "";
    var d = new Date(s + "T00:00:00Z");
    if (isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + Number(delta || 0));
    return d.toISOString().slice(0, 10);
  }

  function normalizeDay(dayStr) {
    var s = String(dayStr || "").trim();
    if (!s) return "";
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return s;
    var dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dot) {
      var dd = String(Number(dot[1])).padStart(2, "0");
      var mm = String(Number(dot[2])).padStart(2, "0");
      return dot[3] + "-" + mm + "-" + dd;
    }
    var slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      var dds = String(Number(slash[1])).padStart(2, "0");
      var mms = String(Number(slash[2])).padStart(2, "0");
      return slash[3] + "-" + mms + "-" + dds;
    }
    return "";
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
        defaultDate: normalizeDay(dayPicker.value) || getRequestedDay(),
        onChange: function (_selectedDates, dateStr) {
          dayPicker.value = normalizeDay(dateStr) || "";
          dayPicker.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    } catch (err) {
      log("Website flatpickr init failed:", err);
    }
  }

  function getRequestedDay() {
    if (selectedDay) return selectedDay;
    var fromBody = document.body ? String(document.body.getAttribute("data-website-kpi-day") || "").trim() : "";
    if (!fromBody || fromBody.toLowerCase() === "yesterday") {
      return shiftIsoDays(getTodayIso(), -1);
    }
    if (fromBody.toLowerCase() === "today") {
      return getTodayIso();
    }
    return normalizeDay(fromBody) || shiftIsoDays(getTodayIso(), -1);
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
    return parts[2] + "." + parts[1] + "." + parts[0];
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

  // ── Leit & SEO section (Search Console /flokkur/ stats) ────────────────────
  // Renders into [data-role="website-seo"] if present. Entirely secondary:
  // any failure here must never affect the primary GA4 dashboard.

  function seoStyles() {
    return ''
      + '.sk-seo{font-family:var(--primary-font,"Sf Pro Text",Arial,sans-serif);color:var(--black,#282828)}'
      + '.sk-seo *{box-sizing:border-box}'
      + '.sk-seo-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:14px}'
      + '.sk-seo-tile{background:#fff;border:1px solid var(--light-gray-border,#e9e9e9);border-radius:12px;padding:14px 16px 12px}'
      + '.sk-seo-tile .lbl{font-size:12px;color:#6b6b6b;margin-bottom:6px}'
      + '.sk-seo-tile .val{font-size:24px;font-weight:650;line-height:1.1}'
      + '.sk-seo-tile .dlt{font-size:12px;margin-top:6px}'
      + '.sk-seo-tile .dlt.is-pos{color:#0a7a2f}.sk-seo-tile .dlt.is-neg{color:#c02f2f}'
      + '.sk-seo-tile .dlt .ctx{color:#9a9a9a}'
      + '.sk-seo-card{background:#fff;border:1px solid var(--light-gray-border,#e9e9e9);border-radius:12px;padding:16px 18px 10px;margin-bottom:14px}'
      + '.sk-seo-card h3{font-size:14px;font-weight:650;margin:0 0 2px}'
      + '.sk-seo-card .desc{font-size:12px;color:#6b6b6b;margin:0 0 10px}'
      + '.sk-seo-chart{position:relative}'
      + '.sk-seo-chart svg{display:block;width:100%;height:auto}'
      + '.sk-seo-tip{position:absolute;pointer-events:none;background:#fff;border:1px solid var(--light-gray-border,#e9e9e9);border-radius:8px;box-shadow:0 4px 12px rgba(16,6,159,.10);padding:6px 10px;font-size:12px;display:none;white-space:nowrap;z-index:5}'
      + '.sk-seo table{border-collapse:collapse;width:100%;font-size:13px}'
      + '.sk-seo th,.sk-seo td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--light-gray-border,#e9e9e9)}'
      + '.sk-seo th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9a9a9a;font-weight:600}'
      + '.sk-seo td.num,.sk-seo th.num{text-align:right;font-variant-numeric:tabular-nums}'
      + '.sk-seo .path{color:#6b6b6b;font-size:12px;word-break:break-all}'
      + '.sk-seo .ctrbar{display:inline-block;height:8px;border-radius:4px;background:var(--blue,#10069f);vertical-align:middle;margin-right:8px}'
      + '.sk-seo .flag{display:inline-flex;align-items:center;gap:4px;background:rgba(250,178,25,.16);color:#7a5200;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}'
      + '.sk-seo .flag:before{content:"\\25B2";font-size:9px}'
      + '.sk-seo .tblwrap{overflow-x:auto}';
  }

  function seoFetch() {
    var cfg = getCfg();
    if (!cfg.gasWebAppUrl || !cfg.gasKey) return Promise.reject(new Error("missing gas config"));
    return fetch(cfg.gasWebAppUrl, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "seo_stats", key: cfg.gasKey })
    }).then(function (r) {
      if (!r.ok) throw new Error("seo_stats HTTP " + r.status);
      return r.json();
    });
  }

  function seoSvgEl(svg, tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    var style = [];
    for (var k in attrs) {
      if (k === "fill" || k === "stroke") style.push(k + ":" + attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (style.length) e.setAttribute("style", style.join(";"));
    svg.appendChild(e);
    return e;
  }

  function renderSeoSection(host, data) {
    var daily = (data && data.daily) || [];
    var pages = (data && data.pages) || [];
    if (!daily.length) { host.innerHTML = ""; return; }

    var styleEl = document.createElement("style");
    styleEl.textContent = seoStyles();
    host.innerHTML = "";
    host.appendChild(styleEl);
    var root = document.createElement("div");
    root.className = "sk-seo";
    host.appendChild(root);

    function sumK(arr, k) { return arr.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); }
    var n = daily.length;
    var cur = daily.slice(Math.max(0, n - 14));
    var prev = daily.slice(Math.max(0, n - 28), Math.max(0, n - 14));
    function deltaPct(c, p) { return p ? 100 * (c - p) / p : 0; }

    var curCtr = sumK(cur, "impressions") ? 100 * sumK(cur, "clicks") / sumK(cur, "impressions") : 0;
    var prevCtr = sumK(prev, "impressions") ? 100 * sumK(prev, "clicks") / sumK(prev, "impressions") : 0;
    var curPos = cur.length ? sumK(cur, "position") / cur.length : 0;
    var prevPos = prev.length ? sumK(prev, "position") / prev.length : 0;

    var tiles = [
      { lbl: "Smellir (14d)", val: formatNumber(sumK(cur, "clicks")), d: deltaPct(sumK(cur, "clicks"), sumK(prev, "clicks")), upGood: true },
      { lbl: "Birtingar (14d)", val: formatNumber(sumK(cur, "impressions")), d: deltaPct(sumK(cur, "impressions"), sumK(prev, "impressions")), upGood: true },
      { lbl: "CTR (14d)", val: curCtr.toFixed(2) + "%", d: deltaPct(curCtr, prevCtr), upGood: true },
      { lbl: "Meðalstaða (14d)", val: curPos.toFixed(1), d: deltaPct(curPos, prevPos), upGood: false }
    ];
    var tilesEl = document.createElement("div");
    tilesEl.className = "sk-seo-tiles";
    tiles.forEach(function (t) {
      var good = t.upGood ? t.d >= 0 : t.d <= 0;
      var div = document.createElement("div");
      div.className = "sk-seo-tile";
      div.innerHTML = '<div class="lbl">' + t.lbl + '</div><div class="val">' + t.val + '</div>'
        + '<div class="dlt ' + (good ? "is-pos" : "is-neg") + '">' + (t.d >= 0 ? "▲" : "▼") + " "
        + Math.abs(t.d).toFixed(1) + '% <span class="ctx">vs fyrri 14d</span></div>';
      tilesEl.appendChild(div);
    });
    root.appendChild(tilesEl);

    // Shared chart scaffolding
    var W = 920, H = 230, PAD = { l: 44, r: 16, t: 14, b: 26 };
    function xAt(i) { return PAD.l + (W - PAD.l - PAD.r) * (n > 1 ? i / (n - 1) : 0); }
    function yAt(v, yMax) { return H - PAD.b - (H - PAD.t - PAD.b) * (v / yMax); }

    function chartCard(title, desc) {
      var card = document.createElement("div");
      card.className = "sk-seo-card";
      card.innerHTML = "<h3>" + title + '</h3><p class="desc">' + desc + "</p>";
      var box = document.createElement("div");
      box.className = "sk-seo-chart";
      card.appendChild(box);
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      box.appendChild(svg);
      root.appendChild(card);
      return { box: box, svg: svg };
    }

    function drawAxes(svg, yMax, step, fmt) {
      for (var t = 0; t <= yMax; t += step) {
        var y = yAt(t, yMax);
        seoSvgEl(svg, "line", { x1: PAD.l, x2: W - PAD.r, y1: y, y2: y, stroke: "#efefef", "stroke-width": 1 });
        var tx = seoSvgEl(svg, "text", { x: PAD.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#9a9a9a" });
        tx.textContent = fmt(t);
      }
      seoSvgEl(svg, "line", { x1: PAD.l, x2: W - PAD.r, y1: H - PAD.b, y2: H - PAD.b, stroke: "#d9d9d9", "stroke-width": 1 });
      [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1].forEach(function (i) {
        if (i < 0 || i >= n) return;
        var tx = seoSvgEl(svg, "text", { x: xAt(i), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "#9a9a9a" });
        tx.textContent = String(daily[i].date).slice(5).replace("-", ".");
      });
    }

    function attachHover(box, svg, labelFor) {
      var tip = document.createElement("div");
      tip.className = "sk-seo-tip";
      box.appendChild(tip);
      var cross = seoSvgEl(svg, "line", { y1: PAD.t, y2: H - PAD.b, stroke: "#c9c9c9", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
      svg.addEventListener("mousemove", function (ev) {
        var rect = svg.getBoundingClientRect();
        var px = (ev.clientX - rect.left) * (W / rect.width);
        var i = Math.round((px - PAD.l) / (W - PAD.l - PAD.r) * (n - 1));
        i = Math.max(0, Math.min(n - 1, i));
        var x = xAt(i);
        cross.setAttribute("x1", x); cross.setAttribute("x2", x);
        cross.setAttribute("visibility", "visible");
        tip.style.display = "block";
        tip.innerHTML = '<div style="color:#6b6b6b">' + daily[i].date + '</div><div style="font-weight:650">' + labelFor(daily[i]) + "</div>";
        var bx = box.getBoundingClientRect();
        var left = (x / W) * bx.width;
        tip.style.left = Math.min(left + 12, Math.max(0, bx.width - tip.offsetWidth - 4)) + "px";
        tip.style.top = "8px";
      });
      svg.addEventListener("mouseleave", function () {
        tip.style.display = "none";
        cross.setAttribute("visibility", "hidden");
      });
    }

    // CTR chart: daily thin gray + 7d rolling brand-blue
    (function () {
      var c = chartCard("Smellihlutfall (CTR) — flokkasíður í Google-leit",
        "Grá lína = dagleg gildi · blá lína = 7 daga meðaltal");
      var ctrMax = 0;
      daily.forEach(function (r) { ctrMax = Math.max(ctrMax, r.ctr); });
      var yMax = Math.max(4, Math.ceil(ctrMax) + 1);
      drawAxes(c.svg, yMax, yMax > 8 ? 2 : 1, function (t) { return t + "%"; });

      seoSvgEl(c.svg, "polyline", {
        points: daily.map(function (r, i) { return xAt(i) + "," + yAt(r.ctr, yMax); }).join(" "),
        fill: "none", stroke: "#b9b9b9", "stroke-width": 1
      });
      var roll = daily.map(function (_r, i) {
        var win = daily.slice(Math.max(0, i - 6), i + 1);
        var cl = sumK(win, "clicks"), im = sumK(win, "impressions");
        return xAt(i) + "," + yAt(im ? 100 * cl / im : 0, yMax);
      });
      seoSvgEl(c.svg, "polyline", {
        points: roll.join(" "),
        fill: "none", stroke: "var(--blue,#10069f)", "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round"
      });
      attachHover(c.box, c.svg, function (r) {
        return r.ctr.toFixed(2) + "% CTR · " + r.clicks + " smellir / " + formatNumber(r.impressions) + " birt.";
      });
    })();

    // Clicks bars
    (function () {
      var c = chartCard("Smellir á dag", "Heimsóknir úr Google-leit inn á flokkasíður");
      var clickMax = 0;
      daily.forEach(function (r) { clickMax = Math.max(clickMax, r.clicks); });
      var yMax = Math.max(10, Math.ceil(clickMax / 10) * 10);
      drawAxes(c.svg, yMax, yMax > 40 ? 20 : 10, function (t) { return t; });
      var bw = Math.max(3, (W - PAD.l - PAD.r) / n - 2);
      daily.forEach(function (r, i) {
        var y = yAt(r.clicks, yMax);
        seoSvgEl(c.svg, "rect", {
          x: xAt(i) - bw / 2, y: y, width: bw, height: (H - PAD.b) - y,
          fill: "var(--blue,#10069f)", rx: 2
        });
      });
      attachHover(c.box, c.svg, function (r) { return r.clicks + " smellir"; });
    })();

    // Top pages table
    if (pages.length) {
      var card = document.createElement("div");
      card.className = "sk-seo-card";
      card.innerHTML = "<h3>Stærstu flokkasíðurnar — síðustu 28 dagar</h3>"
        + '<p class="desc">Raðað eftir birtingum. „Lágt CTR" = sést mikið en fáir smella.</p>';
      var wrap = document.createElement("div");
      wrap.className = "tblwrap";
      var maxCtr = 4;
      var rowsHtml = pages.map(function (p) {
        var ctr = Number(p.ctr) || 0;
        var lowCtr = ctr < 2 && Number(p.impressions) >= 500;
        var path = escapeHtml(String(p.page || "").replace(/^https?:\/\/[^/]+/, ""));
        return "<tr>"
          + '<td class="path">' + path + "</td>"
          + '<td class="num">' + formatNumber(p.impressions) + "</td>"
          + '<td class="num">' + formatNumber(p.clicks) + "</td>"
          + '<td class="num"><span class="ctrbar" style="width:' + Math.min(60, 60 * ctr / maxCtr) + 'px"></span>' + ctr.toFixed(2) + "%</td>"
          + '<td class="num">' + (Number(p.position) || 0).toFixed(1) + "</td>"
          + "<td>" + (lowCtr ? '<span class="flag">Lágt CTR</span>' : "") + "</td>"
          + "</tr>";
      }).join("");
      wrap.innerHTML = "<table><thead><tr><th>Flokkasíða</th><th class=\"num\">Birtingar</th><th class=\"num\">Smellir</th>"
        + "<th class=\"num\">CTR</th><th class=\"num\">Staða</th><th></th></tr></thead><tbody>" + rowsHtml + "</tbody></table>";
      card.appendChild(wrap);
      root.appendChild(card);
    }
  }

  function initSeoSection() {
    try {
      var host = document.querySelector('[data-role="website-seo"]');
      if (!host) return;
      seoFetch()
        .then(function (data) {
          if (!data || data.error) throw new Error((data && data.error) || "empty seo_stats");
          renderSeoSection(host, data);
        })
        .catch(function (err) {
          log("SEO section skipped:", err);
          try { host.innerHTML = ""; } catch (_e) {}
        });
    } catch (err) {
      log("SEO section init failed:", err);
    }
  }

  function init() {
    var hasMetrics = !!document.querySelector('[data-metric^="website-"]');
    if (!hasMetrics) return;
    var dayPicker = document.querySelector("input[data-website-day-picker], [data-website-day-picker] input[type='date'], input[type='date'][data-website-day-picker]");

    if (dayPicker) {
      dayPicker.setAttribute("lang", "is-IS");
      selectedDay = normalizeDay(dayPicker.value) || getRequestedDay();
      dayPicker.value = selectedDay;
      initFlatpickrIfAvailable(dayPicker);
      dayPicker.addEventListener("change", function () {
        selectedDay = normalizeDay(dayPicker.value) || getRequestedDay();
        fetchWebsiteKpis();
      });
    } else {
      selectedDay = getRequestedDay();
    }

    fetchWebsiteKpis();
    initSeoSection();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

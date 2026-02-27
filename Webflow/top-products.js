(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var cfg = window.STORKAUP_CONFIG || {};
  var URL = cfg.supabaseUrl;
  var KEY = cfg.publishableKey;

  if (!URL || !KEY) {
    console.error("Missing STORKAUP_CONFIG.supabaseUrl or publishableKey");
    return;
  }

  var PERIOD_TO_DAYS = { "7d": 7, "30d": 30, "90d": 90, "all": 3650 };

  function fmtInt(v) {
    return Number(v || 0).toLocaleString("is-IS", { maximumFractionDigits: 0 });
  }

  function fmtISK(v) {
    return Number(v || 0).toLocaleString("is-IS", { maximumFractionDigits: 0 }) + " ISK";
  }

  function normalizeSkuForLookup(sku) {
    var s = String(sku || "").trim();
    if (!s) return "";
    // Strip pack/unit suffixes used in sales exports (e.g. _KASSI, _BRETTI).
    s = s.replace(/_[A-Za-z0-9]+$/i, "");
    return s;
  }

  function headers(profile) {
    var h = {
      apikey: KEY,
      Authorization: "Bearer " + KEY
    };
    if (profile) h["Accept-Profile"] = profile;
    return h;
  }

  async function fetchJson(path, opts) {
    var res = await fetch(URL + path, opts || {});
    if (!res.ok) throw new Error("HTTP " + res.status + " " + await res.text());
    return res.json();
  }

  function setActive(groupRoot, selector, attrName, value) {
    groupRoot.querySelectorAll(selector).forEach(function (el) {
      el.classList.toggle("active", el.getAttribute(attrName) === value);
    });
  }

  function resolvePrototype(moduleEl, protoAttr, templateAttr) {
    var tpl = moduleEl.querySelector('[data-template="' + templateAttr + '"]');
    if (tpl && tpl.content && tpl.content.firstElementChild) {
      return { type: "template", node: tpl.content.firstElementChild };
    }
    var proto = moduleEl.querySelector('[data-prototype="' + protoAttr + '"]');
    if (proto) return { type: "prototype", node: proto };
    return null;
  }

  function renderRows(moduleEl, listAttr, protoInfo, rows, mapRowFn) {
    var list = moduleEl.querySelector('[data-list="' + listAttr + '"]');
    if (!list || !protoInfo) return;

    list.innerHTML = "";
    rows.forEach(function (row) {
      var n = protoInfo.node.cloneNode(true);
      if (protoInfo.type === "prototype") {
        n.removeAttribute("data-prototype");
        n.style.display = "";
      }
      mapRowFn(n, row);
      list.appendChild(n);
    });
  }

  function pickSourceRow(row, source) {
    var webOrders = row.web_orders ?? 0;
    var webRev = row.web_revenue_excl ?? 0;
    var bcOrders = row.bc_orders ?? 0;
    var bcRev = row.bc_revenue_excl ?? 0;
    var totalOrders = row.total_orders ?? row.orders ?? 0;
    var totalRev = row.total_revenue_excl ?? row.revenue_excl ?? 0;

    if (source === "web") {
      return { product_name: row.product_name, sku: row.sku, orders: webOrders, revenue_excl: webRev };
    }
    if (source === "bc") {
      return { product_name: row.product_name, sku: row.sku, orders: bcOrders, revenue_excl: bcRev };
    }
    return { product_name: row.product_name, sku: row.sku, orders: totalOrders, revenue_excl: totalRev };
  }

  async function getTopProductsByPeriod(period, limit, source) {
    var orderCol = "total_revenue_excl";
    if (source === "web") orderCol = "web_revenue_excl";
    if (source === "bc") orderCol = "bc_revenue_excl";

    var q =
      "/rest/v1/v_top_products_master" +
      "?select=sku,product_name,web_orders,web_revenue_excl,bc_orders,bc_revenue_excl,total_orders,total_revenue_excl" +
      "&period=eq." + encodeURIComponent(period) +
      "&order=" + encodeURIComponent(orderCol) + ".desc&limit=" + Number(limit);

    try {
      return await fetchJson(q, { headers: headers("api"), cache: "no-store" });
    } catch (err) {
      // Backward-compatible fallback for older schema where "all" may only exist in v_top_products_all.
      if (period !== "all" || source !== "combined") throw err;
      var qall =
        "/rest/v1/v_top_products_all" +
        "?select=sku,product_name,total_orders,total_revenue_excl" +
        "&order=total_revenue_excl.desc&limit=" + Number(limit);
      return fetchJson(qall, { headers: headers("api"), cache: "no-store" });
    }
  }

  async function getTopProductsByDays(daysBack, limit) {
    return fetchJson("/rest/v1/rpc/top_products_by_days", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({
        days_back: Number(daysBack),
        row_limit: Number(limit)
      })
    });
  }

  async function fetchCanonicalProductNamesBySkus(skus) {
    var uniq = {};
    (skus || []).forEach(function (s) {
      var raw = String(s || "").trim();
      if (raw) uniq[raw] = true;
      var norm = normalizeSkuForLookup(raw);
      if (norm) uniq[norm] = true;
    });
    var keys = Object.keys(uniq);
    if (!keys.length) return {};

    var escaped = keys.map(function (k) { return '"' + String(k).replace(/"/g, '""') + '"'; }).join(",");
    var map = {};

    // Preferred source: API view (if it has product_name exposed).
    try {
      var vpath = "/rest/v1/v_sku_category?select=sku,product_name&sku=in.(" + escaped + ")";
      var vrows = await fetchJson(vpath, { headers: headers("api"), cache: "no-store" });
      (vrows || []).forEach(function (r) {
        var k = String(r && r.sku || "").trim();
        var n = String(r && r.product_name || "").trim();
        if (k && n) map[k] = n;
      });
    } catch (_) {}

    if (Object.keys(map).length) return map;

    // Fallback source: raw products table (may be blocked by RLS in some envs).
    try {
      var rpath = "/rest/v1/products_raw?select=sku,product_name&sku=in.(" + escaped + ")";
      var rrows = await fetchJson(rpath, { headers: headers("raw"), cache: "no-store" });
      (rrows || []).forEach(function (r) {
        var k = String(r && r.sku || "").trim();
        var n = String(r && r.product_name || "").trim();
        if (k && n) map[k] = n;
      });
    } catch (_) {}

    return map;
  }

  async function loadProducts(moduleEl, mode) {
    var limit = Number(moduleEl.getAttribute("data-limit") || 30);
    var source = moduleEl.getAttribute("data-source") || "combined";
    var rows = [];

    if (mode && mode.kind === "days") {
      rows = await getTopProductsByDays(mode.value, limit);
      rows = rows.map(function (r) {
        return {
          product_name: r.product_name,
          sku: r.sku,
          orders: r.orders ?? r.total_orders ?? 0,
          revenue_excl: r.revenue_excl ?? r.total_revenue_excl ?? 0
        };
      });
    } else {
      var period = (mode && mode.value) || (moduleEl.getAttribute("data-period") || "30d");

      try {
        rows = await getTopProductsByPeriod(period, limit, source);
        rows = rows.map(function (r) {
          return pickSourceRow(r, source);
        });
      } catch (err) {
        // fallback for heavy view timeouts
        var days = PERIOD_TO_DAYS[period] || 30;
        rows = await getTopProductsByDays(days, limit);
        rows = rows.map(function (r) {
          return {
            product_name: r.product_name,
            sku: r.sku,
            orders: r.orders ?? r.total_orders ?? 0,
            revenue_excl: r.revenue_excl ?? r.total_revenue_excl ?? 0
          };
        });
      }
    }

    rows.sort(function (a, b) {
      var ra = Number(a && a.revenue_excl || 0);
      var rb = Number(b && b.revenue_excl || 0);
      if (rb !== ra) return rb - ra;
      var oa = Number(a && a.orders || 0);
      var ob = Number(b && b.orders || 0);
      return ob - oa;
    });

    try {
      var skuNameMap = await fetchCanonicalProductNamesBySkus(rows.map(function (r) { return r && r.sku; }));
      rows = rows.map(function (r) {
        var sku = String(r && r.sku || "").trim();
        var base = normalizeSkuForLookup(sku);
        var canonical = skuNameMap[sku] || skuNameMap[base] || "";
        if (!canonical) return r;
        return Object.assign({}, r, { product_name: canonical });
      });
    } catch (_) {}

    var protoInfo = resolvePrototype(moduleEl, "product-row", "product-row");
    renderRows(moduleEl, "products", protoInfo, rows, function (n, row) {
     var f1 = n.querySelector('[data-field="product_name"]');
var f2 = n.querySelector('[data-field="sku"]');
var f3 = n.querySelector('[data-field="orders"]') || n.querySelector('[data-field="total_orders"]');
var f4 = n.querySelector('[data-field="revenue_excl"]') || n.querySelector('[data-field="total_revenue_excl"]');

if (f1) f1.textContent = row.product_name || "";
if (f2) f2.textContent = row.sku || "";
if (f3) f3.textContent = fmtInt(row.orders);
if (f4) f4.textContent = fmtISK(row.revenue_excl);

    });
  }

  async function getTopCategoriesByPeriod(period, limit) {
    var q =
      "/rest/v1/v_category_master" +
      "?select=category_path,total_orders,total_revenue_excl" +
      "&period=eq." + encodeURIComponent(period) +
      "&order=total_revenue_excl.desc&limit=" + Number(limit);

    return fetchJson(q, { headers: headers("api"), cache: "no-store" });
  }

  async function getTopCategoriesByDays(daysBack, limit) {
    return fetchJson("/rest/v1/rpc/top_categories_by_days", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({
        days_back: Number(daysBack),
        row_limit: Number(limit)
      })
    });
  }

  async function loadCategories(moduleEl, mode) {
    var limit = Number(moduleEl.getAttribute("data-limit") || 30);
    var rows = [];

    if (mode && mode.kind === "days") {
      rows = await getTopCategoriesByDays(mode.value, limit);
    } else {
      var period = (mode && mode.value) || (moduleEl.getAttribute("data-period") || "30d");
      try {
        rows = await getTopCategoriesByPeriod(period, limit);
      } catch (err) {
        var days = PERIOD_TO_DAYS[period] || 30;
        rows = await getTopCategoriesByDays(days, limit);
      }
    }

    var protoInfo = resolvePrototype(moduleEl, "category-row", "category-row");
    renderRows(moduleEl, "categories", protoInfo, rows, function (n, row) {
      var f1 = n.querySelector('[data-field="category_path"]');
      var f2 = n.querySelector('[data-field="orders"]');
      var f3 = n.querySelector('[data-field="revenue_excl"]');

      var orders = row.orders ?? row.total_orders ?? 0;
      var revenue = row.revenue_excl ?? row.total_revenue_excl ?? 0;

      if (f1) f1.textContent = row.category_path || "Unmapped";
      if (f2) f2.textContent = fmtInt(orders);
      if (f3) f3.textContent = fmtISK(revenue);
    });
  }

  function wireProductsModule(moduleEl) {
    moduleEl.setAttribute("data-period", moduleEl.getAttribute("data-period") || "30d");
    moduleEl.setAttribute("data-source", moduleEl.getAttribute("data-source") || "combined");

    moduleEl.addEventListener("click", function (e) {
      var sourceBtn = e.target.closest("[data-source-btn]");
      if (sourceBtn) {
        e.preventDefault();
        var source = sourceBtn.getAttribute("data-source-btn");
        moduleEl.setAttribute("data-source", source);
        setActive(moduleEl, "[data-source-btn]", "data-source-btn", source);
        loadProducts(moduleEl, { kind: "period", value: moduleEl.getAttribute("data-period") }).catch(console.error);
        return;
      }

      var periodBtn = e.target.closest("[data-period-btn]");
      if (periodBtn) {
        e.preventDefault();
        var period = periodBtn.getAttribute("data-period-btn");
        moduleEl.setAttribute("data-period", period);
        setActive(moduleEl, "[data-period-btn]", "data-period-btn", period);
        loadProducts(moduleEl, { kind: "period", value: period }).catch(console.error);
        return;
      }

      var submitBtn = e.target.closest('[data-action="custom-days-submit"]');
      if (submitBtn) {
        e.preventDefault();
        var input = moduleEl.querySelector('[data-input="custom-days"]');
        var days = Number(input && input.value);
        if (!days || days < 1) return;
        loadProducts(moduleEl, { kind: "days", value: days }).catch(console.error);
      }
    });

    loadProducts(moduleEl, { kind: "period", value: moduleEl.getAttribute("data-period") }).catch(console.error);
  }

  function wireCategoriesModule(moduleEl) {
    moduleEl.setAttribute("data-period", moduleEl.getAttribute("data-period") || "30d");

    moduleEl.addEventListener("click", function (e) {
      var periodBtn = e.target.closest("[data-period-btn]");
      if (periodBtn) {
        e.preventDefault();
        var period = periodBtn.getAttribute("data-period-btn");
        moduleEl.setAttribute("data-period", period);
        setActive(moduleEl, "[data-period-btn]", "data-period-btn", period);
        loadCategories(moduleEl, { kind: "period", value: period }).catch(console.error);
        return;
      }

      var submitBtn = e.target.closest('[data-action="custom-days-submit"]');
      if (submitBtn) {
        e.preventDefault();
        var input = moduleEl.querySelector('[data-input="custom-days"]');
        var days = Number(input && input.value);
        if (!days || days < 1) return;
        loadCategories(moduleEl, { kind: "days", value: days }).catch(console.error);
      }
    });

    loadCategories(moduleEl, { kind: "period", value: moduleEl.getAttribute("data-period") }).catch(console.error);
  }

  function init() {
    var productsModule = document.querySelector('[data-module="top-products"]');
    if (productsModule) wireProductsModule(productsModule);

    var categoriesModule = document.querySelector('[data-module="top-categories"]');
    if (categoriesModule) wireCategoriesModule(categoriesModule);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

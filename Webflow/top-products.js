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
  var CACHE_TTL_MS = 45000;
  var RESPONSE_CACHE = new Map();

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

  function cacheGet(key) {
    var hit = RESPONSE_CACHE.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_TTL_MS) {
      RESPONSE_CACHE.delete(key);
      return null;
    }
    return hit.value;
  }

  function cacheSet(key, value) {
    RESPONSE_CACHE.set(key, { ts: Date.now(), value: value });
    return value;
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

  async function getTopProductsByPeriod(period, limit, source, signal) {
    var orderCol = "total_revenue_excl";
    if (source === "web") orderCol = "web_revenue_excl";
    if (source === "bc") orderCol = "bc_revenue_excl";

    var q =
      "/rest/v1/v_top_products_master" +
      "?select=sku,product_name,web_orders,web_revenue_excl,bc_orders,bc_revenue_excl,total_orders,total_revenue_excl" +
      "&period=eq." + encodeURIComponent(period) +
      "&order=" + encodeURIComponent(orderCol) + ".desc&limit=" + Number(limit);

    try {
      return await fetchJson(q, { headers: headers("api"), cache: "no-store", signal: signal });
    } catch (err) {
      // Backward-compatible fallback for older schema where "all" may only exist in v_top_products_all.
      if (period !== "all" || source !== "combined") throw err;
      var qall =
        "/rest/v1/v_top_products_all" +
        "?select=sku,product_name,total_orders,total_revenue_excl" +
        "&order=total_revenue_excl.desc&limit=" + Number(limit);
      return fetchJson(qall, { headers: headers("api"), cache: "no-store", signal: signal });
    }
  }

  async function getTopProductsByDays(daysBack, limit, signal) {
    return fetchJson("/rest/v1/rpc/top_products_by_days", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({
        days_back: Number(daysBack),
        row_limit: Number(limit)
      }),
      signal: signal
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

    var map = {};
    try {
      var rpcRows = await fetchJson("/rest/v1/rpc/get_product_names_by_skus", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
        body: JSON.stringify({ p_skus: keys }),
        cache: "no-store"
      });
      (rpcRows || []).forEach(function (r) {
        var inSku = String(r && r.input_sku || "").trim();
        var canonSku = String(r && r.canonical_sku || "").trim();
        var name = String(r && r.product_name || "").trim();
        if (!name) return;
        if (inSku) map[inSku] = name;
        if (canonSku) map[canonSku] = name;
      });
    } catch (_) {}

    return map;
  }

  function getModuleRuntime_(moduleEl) {
    if (!moduleEl.__tpRuntime) {
      moduleEl.__tpRuntime = {
        productsSeq: 0,
        categoriesSeq: 0,
        productsAbort: null,
        categoriesAbort: null
      };
    }
    return moduleEl.__tpRuntime;
  }

  function setModuleError_(moduleEl, kind, msg) {
    var el = moduleEl.querySelector('[data-bind="' + kind + '-error"]');
    if (!el) return;
    el.textContent = msg ? String(msg) : "";
    el.style.display = msg ? "" : "none";
  }

  function clearModuleError_(moduleEl, kind) {
    setModuleError_(moduleEl, kind, "");
  }

  function isAbortError_(err) {
    if (!err) return false;
    return err.name === "AbortError" || String(err.message || "").toLowerCase().indexOf("abort") !== -1;
  }

  async function loadProducts(moduleEl, mode) {
    var rt = getModuleRuntime_(moduleEl);
    rt.productsSeq += 1;
    var seq = rt.productsSeq;
    if (rt.productsAbort) {
      try { rt.productsAbort.abort(); } catch (_) {}
    }
    rt.productsAbort = new AbortController();
    var signal = rt.productsAbort.signal;

    var limit = Number(moduleEl.getAttribute("data-limit") || 30);
    var source = moduleEl.getAttribute("data-source") || "combined";
    var rows = [];
    clearModuleError_(moduleEl, "products");

    try {
      var cacheKey =
        "products|" + source + "|" +
        ((mode && mode.kind) || "period") + "|" +
        ((mode && mode.value) || moduleEl.getAttribute("data-period") || "30d") + "|" + limit;
      var cached = cacheGet(cacheKey);
      if (cached) {
        rows = cached;
      } else if (mode && mode.kind === "days") {
        rows = await getTopProductsByDays(mode.value, limit, signal);
        rows = rows.map(function (r) {
          return {
            product_name: r.product_name,
            sku: r.sku,
            orders: r.orders ?? r.total_orders ?? 0,
            revenue_excl: r.revenue_excl ?? r.total_revenue_excl ?? 0
          };
        });
        cacheSet(cacheKey, rows);
      } else {
        var period = (mode && mode.value) || (moduleEl.getAttribute("data-period") || "30d");

        try {
          rows = await getTopProductsByPeriod(period, limit, source, signal);
          rows = rows.map(function (r) {
            return pickSourceRow(r, source);
          });
          cacheSet(cacheKey, rows);
        } catch (err) {
          if (isAbortError_(err)) return;
          // fallback for heavy view timeouts
          var days = PERIOD_TO_DAYS[period] || 30;
          rows = await getTopProductsByDays(days, limit, signal);
          rows = rows.map(function (r) {
            return {
              product_name: r.product_name,
              sku: r.sku,
              orders: r.orders ?? r.total_orders ?? 0,
              revenue_excl: r.revenue_excl ?? r.total_revenue_excl ?? 0
            };
          });
          cacheSet(cacheKey, rows);
        }
      }

      if (seq !== rt.productsSeq) return;

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

      if (seq !== rt.productsSeq) return;

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
    } catch (errTop) {
      if (isAbortError_(errTop)) return;
      setModuleError_(moduleEl, "products", "Gat ekki hlaðið vinsælustu vörum.");
      console.error(errTop);
    }
  }

  async function getTopCategoriesByPeriod(period, limit, signal) {
    var q =
      "/rest/v1/v_category_master" +
      "?select=category_path,total_orders,total_revenue_excl" +
      "&period=eq." + encodeURIComponent(period) +
      "&order=total_revenue_excl.desc&limit=" + Number(limit);

    return fetchJson(q, { headers: headers("api"), cache: "no-store", signal: signal });
  }

  async function getTopCategoriesByDays(daysBack, limit, signal) {
    return fetchJson("/rest/v1/rpc/top_categories_by_days", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({
        days_back: Number(daysBack),
        row_limit: Number(limit)
      }),
      signal: signal
    });
  }

  async function loadCategories(moduleEl, mode) {
    var rt = getModuleRuntime_(moduleEl);
    rt.categoriesSeq += 1;
    var seq = rt.categoriesSeq;
    if (rt.categoriesAbort) {
      try { rt.categoriesAbort.abort(); } catch (_) {}
    }
    rt.categoriesAbort = new AbortController();
    var signal = rt.categoriesAbort.signal;

    var limit = Number(moduleEl.getAttribute("data-limit") || 30);
    var rows = [];
    clearModuleError_(moduleEl, "categories");

    try {
      var cacheKey =
        "categories|" +
        ((mode && mode.kind) || "period") + "|" +
        ((mode && mode.value) || moduleEl.getAttribute("data-period") || "30d") + "|" + limit;
      var cached = cacheGet(cacheKey);
      if (cached) {
        rows = cached;
      } else if (mode && mode.kind === "days") {
        rows = await getTopCategoriesByDays(mode.value, limit, signal);
        cacheSet(cacheKey, rows);
      } else {
        var period = (mode && mode.value) || (moduleEl.getAttribute("data-period") || "30d");
        var days = PERIOD_TO_DAYS[period] || 30;
        try {
          rows = await getTopCategoriesByPeriod(period, limit, signal);
          cacheSet(cacheKey, rows);
        } catch (err) {
          if (isAbortError_(err)) return;
          rows = await getTopCategoriesByDays(days, limit, signal);
          cacheSet(cacheKey, rows);
        }
      }
      if (seq !== rt.categoriesSeq) return;

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
    } catch (errTop) {
      if (isAbortError_(errTop)) return;
      setModuleError_(moduleEl, "categories", "Gat ekki hlaðið vinsælustu flokkum.");
      console.error(errTop);
    }
  }

  // --- Product drawer ---

  var _drawerEl = null;
  function getDrawer() {
    if (!_drawerEl) _drawerEl = document.querySelector('[data-panel="product-detail"]');
    return _drawerEl;
  }

  async function fetchProductBuyers(sku, daysBack) {
    return fetchJson("/rest/v1/rpc/get_product_buyers", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({ p_sku: sku, p_days_back: daysBack })
    });
  }

  async function fetchProductTransactions(sku, daysBack) {
    return fetchJson("/rest/v1/rpc/get_product_transactions", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify({ p_sku: sku, p_days_back: daysBack, p_limit: 200 })
    });
  }

  function renderDrawerRows(panel, listAttr, protoAttr, rows, mapFn) {
    var list = panel.querySelector('[data-list="' + listAttr + '"]');
    var proto = panel.querySelector('[data-prototype="' + protoAttr + '"]');
    if (!list) return;
    list.innerHTML = "";
    if (!rows.length) {
      list.textContent = "Engar niðurstöður.";
      return;
    }
    rows.forEach(function (row) {
      var n = proto ? proto.cloneNode(true) : document.createElement("div");
      n.removeAttribute("data-prototype");
      n.style.display = "";
      mapFn(n, row);
      list.appendChild(n);
    });
  }

  async function openProductDrawer(sku, productName, daysBack) {
    var panel = getDrawer();
    if (!panel) return;

    var nameEl = panel.querySelector('[data-field="product-name"]');
    var skuEl  = panel.querySelector('[data-field="product-sku"]');
    if (nameEl) nameEl.textContent = productName || sku;
    if (skuEl)  skuEl.textContent  = sku;

    var buyersList = panel.querySelector('[data-list="buyers"]');
    var txList     = panel.querySelector('[data-list="transactions"]');
    if (buyersList) buyersList.textContent = "Hleður...";
    if (txList)     txList.textContent     = "";

    panel.style.display = "";
    document.body.style.overflow = "hidden";

    var normSku = normalizeSkuForLookup(sku);

    try {
      var results = await Promise.all([
        fetchProductBuyers(normSku, daysBack),
        fetchProductTransactions(normSku, daysBack)
      ]);
      var buyers       = results[0] || [];
      var transactions = results[1] || [];

      renderDrawerRows(panel, "buyers", "buyer-row", buyers, function (n, row) {
        var f1 = n.querySelector('[data-field="customer_name"]');
        var f2 = n.querySelector('[data-field="orders"]');
        var f3 = n.querySelector('[data-field="qty_total"]');
        var f4 = n.querySelector('[data-field="revenue_excl"]');
        if (f1) f1.textContent = row.customer_name || row.customer_no || "";
        if (f2) f2.textContent = fmtInt(row.orders);
        if (f3) f3.textContent = fmtInt(row.qty_total);
        if (f4) f4.textContent = fmtISK(row.revenue_excl);
      });

      renderDrawerRows(panel, "transactions", "transaction-row", transactions, function (n, row) {
        var f1 = n.querySelector('[data-field="booking_date"]');
        var f2 = n.querySelector('[data-field="document_no"]');
        var f3 = n.querySelector('[data-field="customer_name"]');
        var f4 = n.querySelector('[data-field="qty"]');
        var f5 = n.querySelector('[data-field="amount_excl"]');
        if (f1) f1.textContent = row.booking_date || "";
        if (f2) f2.textContent = row.document_no  || "";
        if (f3) f3.textContent = row.customer_name || "";
        if (f4) f4.textContent = fmtInt(row.qty);
        if (f5) f5.textContent = fmtISK(row.amount_excl);
      });
    } catch (err) {
      if (buyersList) buyersList.textContent = "Villa við að sækja gögn.";
      console.error(err);
    }
  }

  function closeProductDrawer() {
    var panel = getDrawer();
    if (!panel) return;
    panel.style.display = "none";
    document.body.style.overflow = "";
  }

  function wireDrawer() {
    var panel = getDrawer();
    if (!panel) return;
    var overlay  = panel.querySelector("[data-panel-overlay]");
    var closeBtn = panel.querySelector("[data-panel-close]");
    if (overlay)  overlay.addEventListener("click", closeProductDrawer);
    if (closeBtn) closeBtn.addEventListener("click", closeProductDrawer);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeProductDrawer();
    });
  }

  // --- End product drawer ---

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
        return;
      }

      var productsList = moduleEl.querySelector('[data-list="products"]');
      if (productsList && productsList.contains(e.target)) {
        var rowEl = e.target.closest('[data-list="products"] > *');
        if (rowEl) {
          var skuEl  = rowEl.querySelector('[data-field="sku"]');
          var nameEl = rowEl.querySelector('[data-field="product_name"]');
          var sku    = skuEl  ? skuEl.textContent.trim()  : "";
          var name   = nameEl ? nameEl.textContent.trim() : "";
          if (sku) {
            var daysBack = PERIOD_TO_DAYS[moduleEl.getAttribute("data-period")] || 365;
            openProductDrawer(sku, name, daysBack).catch(console.error);
          }
        }
        return;
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
    wireDrawer();

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

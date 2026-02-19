(function() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    var cfg = window.STORKAUP_CONFIG || {};
    var URL = cfg.supabaseUrl;
    var KEY = cfg.publishableKey;
    if (!URL || !KEY) return console.error("Missing STORKAUP_CONFIG");

    var state = {
        customers: [],
        filtered: [],
        selected: null,
        shoppingRows: [],
        shoppingFiltered: [],
        sortKey: "total_revenue",
        sortDir: "desc",
        activeChip: "all",
        searchTerm: "",
        searchDebounceId: null
    };
    var MAX_RENDERED_CUSTOMERS = 150;

    function headers(profile) {
        var h = { apikey: KEY, Authorization: "Bearer " + KEY };
        if (profile) h["Accept-Profile"] = profile;
        return h;
    }

    function numOrZero(v) {
        if (v === null || v === undefined || v === "") return 0;
        var n = Number(v);
        return isNaN(n) ? 0 : n;
    }

    function fmtInt(v) {
        return numOrZero(v).toLocaleString("is-IS", { maximumFractionDigits: 0 });
    }

    function fmtCurrency(v) {
        return numOrZero(v).toLocaleString("is-IS", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function fmtPctChange(curr, prev) {
        var c = numOrZero(curr);
        var p = numOrZero(prev);
        if (p === 0) return c === 0 ? "0%" : "Nytt";
        var pct = ((c - p) / p) * 100;
        var sign = pct > 0 ? "+" : "";
        return sign + pct.toFixed(1).replace(".", ",") + "%";
    }

    function normalizeCustomerId(value) {
        var raw = String(value || "").trim();
        if (!raw) return "";
        return raw.replace(/\D/g, "") || raw;
    }

    function customerFamilyId(value) {
        var n = normalizeCustomerId(value);
        if (!n) return "";
        return n.length > 10 ? n.slice(0, 10) : n;
    }

    function avgPositive(rows, field) {
        var sum = 0;
        var count = 0;
        (rows || []).forEach(function(r) {
            var v = numOrZero(r && r[field]);
            if (v > 0) {
                sum += v;
                count += 1;
            }
        });
        return count ? (sum / count) : 0;
    }

    function buildSelectedProfile(selected, allRows) {
        if (!selected) return null;
        var out = Object.assign({}, selected);
        var fam = customerFamilyId(selected.customer_id);
        if (!fam) {
            out._queryCustomerId = String(selected.customer_id || "").trim();
            return out;
        }

        var familyRows = (allRows || []).filter(function(r) {
            return customerFamilyId(r && r.customer_id) === fam;
        });
        if (!familyRows.length) {
            out._queryCustomerId = String(selected.customer_id || "").trim();
            return out;
        }

        var sumFields = [
            "orders_bc_365d",
            "orders_web_365d",
            "bc_orders_30d",
            "bc_orders_prev_30d",
            "web_orders_30d",
            "web_orders_prev_30d",
            "bc_revenue_30d",
            "bc_revenue_prev_30d",
            "web_revenue_30d",
            "web_revenue_prev_30d"
        ];
        sumFields.forEach(function(f) {
            out[f] = familyRows.reduce(function(acc, r) { return acc + numOrZero(r && r[f]); }, 0);
        });
        out.avg_days_between_bc_orders = avgPositive(familyRows, "avg_days_between_bc_orders");
        out.avg_days_between_web_orders = avgPositive(familyRows, "avg_days_between_web_orders");

        var parent = familyRows.find(function(r) {
            return normalizeCustomerId(r && r.customer_id) === fam;
        });
        out._queryCustomerId = String((parent && parent.customer_id) || selected.customer_id || "").trim();
        return out;
    }

    function getSelectedQueryCustomerId() {
        if (!state.selected) return "";
        return String(state.selected._queryCustomerId || state.selected.customer_id || "").trim();
    }

    function setProfileVisible(root, visible) {
        var panel = root.querySelector('[data-panel="customer-profile"]');
        if (!panel) return;
        panel.hidden = !visible;
        panel.setAttribute("data-state", visible ? "ready" : "empty");
    }

    function setCustomerListVisible(root, visible) {
        var listWrap = root.querySelector('[data-panel="customer-list"]');
        if (!listWrap) return;
        listWrap.hidden = !visible;
    }

    var PROFILE_FIELDS = [
        "customer_id",
        "customer_name",
        "webshop_active",
        "recommended_action",
        "low_hanging_fruit_score",
        "lhfs_percentile",
        "lhfs_label",
        "orders_bc_365d",
        "orders_web_365d",
        "avg_days_between_bc_orders",
        "avg_days_between_web_orders",
        "bc_orders_30d",
        "bc_orders_prev_30d",
        "web_orders_30d",
        "web_orders_prev_30d",
        "bc_revenue_30d",
        "bc_revenue_prev_30d",
        "web_revenue_30d",
        "web_revenue_prev_30d"
    ].join(",");

    function isTimeoutErrorText(txt) {
        var t = String(txt || "").toLowerCase();
        return t.indexOf("57014") !== -1 || t.indexOf("statement timeout") !== -1 || t.indexOf("canceling statement") !== -1;
    }

    async function fetchProfilesPage(offset, pageSize, useOrder) {
        var path =
            "/rest/v1/v_customer_profiles_labeled_trends?select=" + encodeURIComponent(PROFILE_FIELDS) +
            (useOrder === false ? "" : "&order=customer_id.asc.nullslast") +
            "&limit=" + pageSize +
            "&offset=" + offset;
        var res = await fetch(URL + path, { headers: headers("api") });
        if (!res.ok) {
            var errText = await res.text();
            var e = new Error(errText);
            e.__isTimeout = isTimeoutErrorText(errText);
            throw e;
        }
        var rows = await res.json();
        return Array.isArray(rows) ? rows : [];
    }

    function sortProfilesByScore(rows) {
        rows.sort(function(a, b) {
            return numOrZero(b.low_hanging_fruit_score) - numOrZero(a.low_hanging_fruit_score);
        });
    }

    async function hydrateProfilesInBackground(root, startOffset, pageSize, maxRows, useOrder) {
        for (var offset = startOffset; offset < maxRows; offset += pageSize) {
            var rows = await fetchProfilesPage(offset, pageSize, useOrder);
            if (!rows.length) break;

            state.customers = state.customers.concat(rows);
            sortProfilesByScore(state.customers);
            if (!state.searchTerm) {
                applyFilters(root, "");
            }

            if (rows.length < pageSize) break;
            await new Promise(function(resolve) { setTimeout(resolve, 0); });
        }
        if (state.searchTerm) {
            var q = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
            applyFilters(root, q);
        }
    }

    function matchesChip(c, chip) {
        if (chip === "none") return false;
        if (chip === "all") return true;
        if (chip === "lhfs_very_high") return String(c.lhfs_label || "").toLowerCase() === "very high";
        if (chip === "no_web_30d") return numOrZero(c.web_orders_30d) === 0;
        if (chip === "revenue_down_30d") return numOrZero(c.bc_revenue_30d) < numOrZero(c.bc_revenue_prev_30d);
        if (chip === "webshop_inactive") return !c.webshop_active;
        return true;
    }

    async function generateList(customerId) {
        var res = await fetch(URL + "/rest/v1/rpc/generate_shopping_list_v2", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify({ p_customer_id: customerId, p_days_back: 365, p_row_limit: 50 })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    async function fetchCategoriesForSkus(skus) {
        var uniq = [];
        var seen = {};
        (skus || []).forEach(function(s) {
            var k = String(s || "").trim();
            if (!k || seen[k]) return;
            seen[k] = true;
            uniq.push(k);
        });
        if (!uniq.length) return {};

        var out = {};
        for (var i = 0; i < uniq.length; i += 80) {
            var chunk = uniq.slice(i, i + 80);
            var inList = chunk.map(function(s) { return '"' + s.replace(/"/g, '\\"') + '"'; }).join(",");
            var path = "/rest/v1/v_sku_category?select=sku,category&sku=in.(" + inList + ")";
            var res = await fetch(URL + path, { headers: headers("api") });
            if (!res.ok) throw new Error(await res.text());
            var rows = await res.json();
            rows.forEach(function(r) {
                out[String(r.sku || "").trim()] = r.category || "Óflokkað";
            });
        }
        return out;
    }

    function resolveProto(root, key) {
        var tpl = root.querySelector('[data-template="' + key + '"]');
        if (tpl && tpl.content && tpl.content.firstElementChild) return { type: "template", node: tpl.content.firstElementChild };
        var proto = root.querySelector('[data-prototype="' + key + '"]');
        if (proto) return { type: "prototype", node: proto };
        return null;
    }

    function renderCustomers(root) {
        var list = root.querySelector('[data-list="customers"]');
        var proto = resolveProto(root, "customer-row");
        if (!list || !proto) return;
        list.innerHTML = "";
        var frag = document.createDocumentFragment();
        var rows = state.filtered.slice(0, MAX_RENDERED_CUSTOMERS);

        rows.forEach(function(c) {
            var n = proto.node.cloneNode(true);
            if (proto.type === "prototype") {
                n.removeAttribute("data-prototype");
                n.style.display = "";
            }

            var fn = n.querySelector('[data-field="customer_name"]');
            var fi = n.querySelector('[data-field="customer_id"]');
            var fw = n.querySelector('[data-field="webshop_active"]');
            var fobc = n.querySelector('[data-field="orders_bc_365d"]');
            var fgbc = n.querySelector('[data-field="avg_days_between_bc_orders"]');
            var foweb = n.querySelector('[data-field="orders_web_365d"]');
            var fgweb = n.querySelector('[data-field="avg_days_between_web_orders"]');
            var fp = n.querySelector('[data-field="lhfs_percentile"]');
            var fl = n.querySelector('[data-field="lhfs_label"]');
            var open = n.querySelector('[data-action="open-profile"]') || n;

            if (fn) fn.textContent = c.customer_name || "";
            if (fi) fi.textContent = c.customer_id || "";
            if (fw) fw.textContent = c.webshop_active ? "Active" : "Inactive";
            if (fobc) fobc.textContent = fmtInt(c.orders_bc_365d);
            if (fgbc) fgbc.textContent = c.avg_days_between_bc_orders ? fmtInt(c.avg_days_between_bc_orders) : "-";
            if (foweb) foweb.textContent = fmtInt(c.orders_web_365d);
            if (fgweb) fgweb.textContent = c.avg_days_between_web_orders ? fmtInt(c.avg_days_between_web_orders) : "-";
            if (fp) fp.textContent = c.lhfs_percentile != null ? c.lhfs_percentile : "-";
            if (fl) fl.textContent = c.lhfs_label || "-";

            open.setAttribute("data-customer-id", c.customer_id || "");
            frag.appendChild(n);
        });
        list.appendChild(frag);

        var shownEl = root.querySelector('[data-bind="customers-shown"]');
        if (shownEl) shownEl.textContent = String(rows.length);
        var totalEl = root.querySelector('[data-bind="customers-total"]');
        if (totalEl) totalEl.textContent = String(state.filtered.length);
    }

    function buildScoreDrivers(p) {
        var drivers = [];
        var bc365 = Number(p.orders_bc_365d || 0);
        var web365 = Number(p.orders_web_365d || 0);
        var bcGap = Number(p.avg_days_between_bc_orders || 0);
        var webGap = Number(p.avg_days_between_web_orders || 0);
        var lhfs = Number(p.low_hanging_fruit_score || 0);

        if (bc365 >= 6 && web365 === 0) drivers.push("Kaupir reglulega í BC en ekkert á vef síðustu 365 daga.");
        if (bcGap > 0 && bcGap <= 30) drivers.push("Stutt bil milli BC pantana bendir til góðrar endurpöntunartíðni.");
        if (web365 > 0 && webGap > 45) drivers.push("Vefpantanir eru til staðar en með löngu bili, hægt að virkja betur.");

        if (lhfs >= 70) drivers.push("Hátt LHFS: sterkt skammtímatækifæri.");
        else if (lhfs >= 40) drivers.push("Miðlungs LHFS: tækifæri með markvissri eftirfylgni.");
        else drivers.push("Lágt LHFS: lægri forgangur í bili.");

        while (drivers.length < 3) drivers.push("-");
        return drivers.slice(0, 3);
    }

    function bindSelected(root) {
        var p = state.selected;
        if (!p) return;
        var drivers = buildScoreDrivers(p);

        var map = {
            selected_customer_name: p.customer_name || "",
            selected_customer_id: p.customer_id || "",
            selected_recommended_action: p.recommended_action || "",
            selected_low_hanging_fruit_score: fmtInt(p.low_hanging_fruit_score),
            selected_lhfs_percentile: p.lhfs_percentile != null ? p.lhfs_percentile : "-",
            selected_lhfs_label: p.lhfs_label || "-",
            selected_lhfs_driver_1: drivers[0],
            selected_lhfs_driver_2: drivers[1],
            selected_lhfs_driver_3: drivers[2],
            selected_bc_orders_30d: fmtInt(p.bc_orders_30d),
            selected_bc_orders_prev_30d: fmtInt(p.bc_orders_prev_30d),
            selected_bc_orders_pct_30d: fmtPctChange(p.bc_orders_30d, p.bc_orders_prev_30d),
            selected_web_orders_30d: fmtInt(p.web_orders_30d),
            selected_web_orders_prev_30d: fmtInt(p.web_orders_prev_30d),
            selected_web_orders_pct_30d: fmtPctChange(p.web_orders_30d, p.web_orders_prev_30d),
            selected_bc_revenue_30d: fmtCurrency(p.bc_revenue_30d),
            selected_bc_revenue_prev_30d: fmtCurrency(p.bc_revenue_prev_30d),
            selected_bc_revenue_pct_30d: fmtPctChange(p.bc_revenue_30d, p.bc_revenue_prev_30d),
            selected_web_revenue_30d: fmtCurrency(p.web_revenue_30d),
            selected_web_revenue_prev_30d: fmtCurrency(p.web_revenue_prev_30d),
            selected_web_revenue_pct_30d: fmtPctChange(p.web_revenue_30d, p.web_revenue_prev_30d)
        };

        Object.keys(map).forEach(function(k) {
            var els = root.querySelectorAll('[data-bind="' + k + '"]');
            if (!els || !els.length) return;
            els.forEach(function(el) { el.textContent = map[k]; });
        });

        ["selected_bc_orders_pct_30d", "selected_web_orders_pct_30d", "selected_bc_revenue_pct_30d", "selected_web_revenue_pct_30d"].forEach(function(k) {
            var els = root.querySelectorAll('[data-bind="' + k + '"]');
            if (!els || !els.length) return;
            els.forEach(function(el) {
                var t = (el.textContent || "").trim();
                el.classList.remove("pct-up", "pct-down", "pct-flat");
                if (t.indexOf("+") === 0) el.classList.add("pct-up");
                else if (t.indexOf("-") === 0) el.classList.add("pct-down");
                else el.classList.add("pct-flat");
            });
        });
    }

    function renderShoppingList(root, rows) {
        var list = root.querySelector('[data-list="shopping-list"]');
        var proto = resolveProto(root, "shopping-row");
        if (!list || !proto) return;
        list.innerHTML = "";

        rows.forEach(function(r) {
            var n = proto.node.cloneNode(true);
            if (proto.type === "prototype") {
                n.removeAttribute("data-prototype");
                n.style.display = "";
            }

            var sku = n.querySelector('[data-field="sku"]');
            var name = n.querySelector('[data-field="product_name"]');
            var category = n.querySelector('[data-field="category"]');
            var orders = n.querySelector('[data-field="order_count"]');
            var qtyTotal = n.querySelector('[data-field="total_qty_ordered"]');
            var revenue = n.querySelector('[data-field="total_revenue"]');

            if (sku) sku.textContent = r.sku || "";
            if (name) name.textContent = r.product_name || "";
            if (category) category.textContent = r.category || "-";
            if (orders) orders.textContent = fmtInt(r.order_count);
            if (qtyTotal) qtyTotal.textContent = fmtInt(r.total_qty_ordered);
            if (revenue) revenue.textContent = fmtCurrency(r.total_revenue);

            list.appendChild(n);
        });
    }

    function applyShoppingFilters(root) {
        var rows = (state.shoppingRows || []).slice();

        rows.sort(function(a, b) {
            var key = state.sortKey;
            var dir = state.sortDir;
            if (key === "product_name" || key === "sku" || key === "category") {
                var avs = String(a[key] || "").toLowerCase();
                var bvs = String(b[key] || "").toLowerCase();
                if (avs < bvs) return dir === "asc" ? -1 : 1;
                if (avs > bvs) return dir === "asc" ? 1 : -1;
                return 0;
            }
            var av = numOrZero(a[key]);
            var bv = numOrZero(b[key]);
            return dir === "asc" ? (av - bv) : (bv - av);
        });

        state.shoppingFiltered = rows;
        renderShoppingList(root, rows);
        updateSortIndicators(root);
    }

    function updateSortIndicators(root) {
        var heads = root.querySelectorAll("[data-sort]");
        if (!heads || !heads.length) return;
        heads.forEach(function(h) {
            h.classList.remove("is-sort-active", "is-asc", "is-desc");
            h.removeAttribute("data-sort-dir");
            var key = h.getAttribute("data-sort");
            if (key === state.sortKey) {
                h.classList.add("is-sort-active");
                h.classList.add(state.sortDir === "asc" ? "is-asc" : "is-desc");
                h.setAttribute("data-sort-dir", state.sortDir);
            }
        });
    }

    async function exportXlsx() {
        if (!window.XLSX) return alert("XLSX library not loaded.");
        var rows = state.shoppingFiltered && state.shoppingFiltered.length ? state.shoppingFiltered : state.shoppingRows;
        var data = (rows || []).map(function(r) {
            return { SKU: r.sku || "", Vara: r.product_name || "", Flokkur: r.category || "", Pantanir: numOrZero(r.order_count), Magn: numOrZero(r.total_qty_ordered), Velta: numOrZero(r.total_revenue) };
        });
        var ws = window.XLSX.utils.json_to_sheet(data);
        var wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Innkaupalisti");
        window.XLSX.writeFile(wb, "innkaupalisti.xlsx");
    }

    async function createTaskForSelected(root) {
        if (!state.selected) return;

        var p = state.selected;
        var payload = {
            customer_id: String(p.customer_id || "").trim(),
            customer_name: p.customer_name || "",
            priority: String(p.lhfs_label || "").toLowerCase().indexOf("very") !== -1 ? "high" : "medium",
            reason: p.recommended_action || "Eftirfylgni",
            owner: null,
            due_date: null,
            status: "open"
        };

        var res = await fetch(URL + "/rest/v1/sales_tasks", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=representation" }, headers("api")),
            body: JSON.stringify(payload)
        });

        var msgEl = root.querySelector('[data-bind="task-feedback"]');

        if (!res.ok) {
            var t = await res.text();
            if (msgEl) msgEl.textContent = "Villa við vistun verkefnis.";
            throw new Error(t);
        }

        if (msgEl) msgEl.textContent = "Verkefni stofnað.";
        var tasks = await fetchOpenTasks(state.selected.customer_id);
        renderOpenTasks(root, tasks);

    }
    async function fetchOpenTasks(customerId) {
  var res = await fetch(URL + "/rest/v1/rpc/get_open_tasks", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
    body: JSON.stringify({ p_customer_id: String(customerId || "").trim() })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

    async function fetchLastOrders(customerId, limit) {
        var res = await fetch(URL + "/rest/v1/rpc/get_customer_last_orders", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify({
                p_customer_id: String(customerId || "").trim(),
                p_limit: Number(limit || 5)
            })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    function renderLastOrderRows(list, proto, rows) {
        if (!list || !proto) return;
        list.innerHTML = "";
        (rows || []).forEach(function(r) {
            var n = proto.node.cloneNode(true);
            if (proto.type === "prototype") {
                n.removeAttribute("data-prototype");
                n.style.display = "";
            }

            var fOrder = n.querySelector('[data-field="last_order_id"]');
            var fTotal = n.querySelector('[data-field="last_order_total"]');
            var fUser = n.querySelector('[data-field="last_order_user"]');
            var fDate = n.querySelector('[data-field="last_order_date"]');
            var fSource = n.querySelector('[data-field="last_order_source"]');

            if (fOrder) fOrder.textContent = r.order_id || "-";
            if (fTotal) fTotal.textContent = fmtCurrency(r.total);
            if (fUser) fUser.textContent = r.order_user || "-";
            if (fDate) fDate.textContent = r.purchase_date ? new Date(r.purchase_date).toLocaleDateString("is-IS") : "-";
            if (fSource) fSource.textContent = String(r.source || "").toLowerCase() === "bc" ? "BC" : "Vefur";

            list.appendChild(n);
        });
    }

    function renderLastOrders(root, rows) {
        var all = rows || [];
        var webRows = all.filter(function(r) { return String(r.source || "").toLowerCase() !== "bc"; });
        var bcRows = all.filter(function(r) { return String(r.source || "").toLowerCase() === "bc"; });

        var webList = root.querySelector('[data-list="last-orders-web"]');
        var bcList = root.querySelector('[data-list="last-orders-bc"]');
        var webProto = resolveProto(root, "last-order-row-web") || resolveProto(root, "last-order-row");
        var bcProto = resolveProto(root, "last-order-row-bc") || resolveProto(root, "last-order-row");

        if (webList && bcList) {
            renderLastOrderRows(webList, webProto, webRows);
            renderLastOrderRows(bcList, bcProto, bcRows);
            return;
        }

        var legacyList = root.querySelector('[data-list="last-orders"]');
        var legacyProto = resolveProto(root, "last-order-row");
        renderLastOrderRows(legacyList, legacyProto, all);
    }


    function renderOpenTasks(root, tasks) {
        var list = root.querySelector('[data-list="open-tasks"]');
        var proto = resolveProto(root, "task-row");
        if (!list || !proto) return;
        list.innerHTML = "";

        var countEl = root.querySelector('[data-bind="open-tasks-count"]');
        if (countEl) countEl.textContent = String((tasks || []).length);

        (tasks || []).forEach(function(t) {
            var n = proto.node.cloneNode(true);
            if (proto.type === "prototype") {
                n.removeAttribute("data-prototype");
                n.style.display = "";
            }
            var r = n.querySelector('[data-field="task_reason"]');
            var p = n.querySelector('[data-field="task_priority"]');
            var s = n.querySelector('[data-field="task_status"]');
            var d = n.querySelector('[data-field="task_created_at"]');
            var doneBtn = n.querySelector('[data-action="task-done"]');


            if (r) r.textContent = t.reason || "-";
            if (p) p.textContent = t.priority || "-";
            if (s) s.textContent = t.status || "-";
            if (d) d.textContent = t.created_at ? new Date(t.created_at).toLocaleDateString("is-IS") : "-";
            if (s) s.textContent = (String(t.status || "").toLowerCase() === "open") ? "Opið" : "Lokið";
            if (doneBtn) {
                doneBtn.setAttribute("data-task-id", String(t.id || ""));
                doneBtn.style.display = String(t.status || "").toLowerCase() === "open" ? "" : "none";
            }


            list.appendChild(n);
        });
    }

    async function markTaskDone(taskId) {
        var id = String(taskId || "").trim();
        if (!id) return;

        var res = await fetch(URL + "/rest/v1/sales_tasks?id=eq." + encodeURIComponent(id), {
            method: "PATCH",
            headers: Object.assign({ "Content-Type": "application/json", Prefer: "return=representation" }, headers("api")),
            body: JSON.stringify({ status: "done" })
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }

    function exportPdf() {
        if (!window.jspdf || !window.jspdf.jsPDF) return alert("jsPDF library not loaded.");
        var rows = state.shoppingFiltered && state.shoppingFiltered.length ? state.shoppingFiltered : state.shoppingRows;
        var doc = new window.jspdf.jsPDF({ orientation: "landscape" });
        var body = (rows || []).map(function(r) {
            return [r.sku || "", r.product_name || "", r.category || "-", fmtInt(r.order_count), fmtInt(r.total_qty_ordered), fmtCurrency(r.total_revenue)];
        });
        if (doc.autoTable) {
            doc.autoTable({
                head: [
                    ["SKU", "Vara", "Flokkur", "Pantanir", "Magn", "Velta"]
                ],
                body: body
            });
        }
        doc.save("innkaupalisti.pdf");
    }

    function applyFilters(root, q) {
        var s = (q || "").trim().toLowerCase();
        state.searchTerm = s;
        var out = state.customers.filter(function(c) {
            if (!matchesChip(c, state.activeChip)) return false;
            if (!s) return true;
            var name = String(c.customer_name || "").toLowerCase();
            var id = String(c.customer_id || "").toLowerCase();
            return name.indexOf(s) !== -1 || id.indexOf(s) !== -1;
        });
        state.filtered = out;
        renderCustomers(root);
    }

    async function init() {
        var root = document.querySelector('[data-module="customer-profiles"]');
        if (!root) return;

        setProfileVisible(root, false);
        setCustomerListVisible(root, true);

        var pageSize = 300;
        var maxRows = 6000;
        var useOrder = true;
        var firstPage;
        try {
            firstPage = await fetchProfilesPage(0, pageSize, useOrder);
        } catch (err) {
            if (!err || !err.__isTimeout) throw err;
            // Timeout-safe fallback for heavy view scans on some environments.
            useOrder = false;
            pageSize = 100;
            maxRows = 3000;
            firstPage = await fetchProfilesPage(0, pageSize, useOrder);
        }
        state.customers = firstPage;
        sortProfilesByScore(state.customers);
        root.querySelectorAll("[data-chip]").forEach(function(b) {
            var chip = b.getAttribute("data-chip") || "";
            b.classList.toggle("is-active", chip === state.activeChip);
        });
        applyFilters(root, "");

        hydrateProfilesInBackground(root, pageSize, pageSize, maxRows, useOrder).catch(function(err) {
            console.error("Background profile hydration failed:", err);
        });

        var searchInput = root.querySelector('[data-input="customer-search"]');
        if (searchInput) {
            searchInput.addEventListener("input", function() {
                if (state.searchDebounceId) clearTimeout(state.searchDebounceId);
                state.searchDebounceId = setTimeout(function() {
                    applyFilters(root, searchInput.value);
                }, 120);
            });
        }

        root.addEventListener("click", async function(e) {
            var chipBtn = e.target.closest("[data-chip]");
            if (chipBtn) {
                e.preventDefault();
                state.activeChip = chipBtn.getAttribute("data-chip") || "all";
                root.querySelectorAll("[data-chip]").forEach(function(b) {
                    b.classList.toggle("is-active", b === chipBtn);
                });
                var q = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
                applyFilters(root, q);
                return;
            }

            var sortEl = e.target.closest("[data-sort]");
            if (sortEl) {
                e.preventDefault();
                var key = sortEl.getAttribute("data-sort");
                if (!key) return;
                if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
                else {
                    state.sortKey = key;
                    state.sortDir = (key === "product_name" || key === "sku" || key === "category") ? "asc" : "desc";
                }
                applyShoppingFilters(root);
                return;
            }

            var doneBtn = e.target.closest('[data-action="task-done"]');
            if (doneBtn) {
                e.preventDefault();
                var taskId = doneBtn.getAttribute("data-task-id");
                if (!taskId) return;

                await markTaskDone(taskId);

                var doneMsgEl = root.querySelector('[data-bind="task-feedback"]');
                if (doneMsgEl) doneMsgEl.textContent = "Verkefni lokad.";

                if (state.selected && state.selected.customer_id) {
                    var tasksAfterDone = await fetchOpenTasks(state.selected.customer_id);
                    renderOpenTasks(root, tasksAfterDone);
                }
                return;
            }

            var createTask = e.target.closest('[data-action="create-task"]');
            if (createTask) {
                e.preventDefault();
                await createTaskForSelected(root);
                return;
            }

            var open = e.target.closest('[data-action="open-profile"]');
            if (open) {
                e.preventDefault();
                var id = open.getAttribute("data-customer-id");
                var selectedRaw = state.customers.find(function(c) { return String(c.customer_id) === String(id); }) || null;
                state.selected = buildSelectedProfile(selectedRaw, state.customers);

                bindSelected(root);
                setProfileVisible(root, !!state.selected);
                setCustomerListVisible(root, false);

                try {
                    var tasks = await fetchOpenTasks(state.selected.customer_id);
                    renderOpenTasks(root, tasks);
                } catch (err) {
                    console.error(err);
                    renderOpenTasks(root, []); // keep UI usable
                }

                try {
                    var orders = await fetchLastOrders(getSelectedQueryCustomerId(), 5);
                    renderLastOrders(root, orders);
                } catch (err2) {
                    console.error(err2);
                    renderLastOrders(root, []);
                }

                state.shoppingRows = [];
                state.shoppingFiltered = [];
                var sl = root.querySelector('[data-list="shopping-list"]');
                if (sl) sl.innerHTML = "";
                return;
            }


            var back = e.target.closest('[data-action="back-to-list"]');
            if (back) {
                e.preventDefault();
                setCustomerListVisible(root, true);
                setProfileVisible(root, false);
                state.selected = null;
                renderLastOrders(root, []);
                return;
            }

            var gen = e.target.closest('[data-action="generate-shopping-list"]');
            if (gen) {
                e.preventDefault();
                if (!state.selected || !state.selected.customer_id) return;

                var rows = await generateList(getSelectedQueryCustomerId());
                var skuMap = await fetchCategoriesForSkus(rows.map(function(r) { return r.sku; }));
                state.shoppingRows = rows.map(function(r) {
                    return Object.assign({}, r, { category: skuMap[String(r.sku || "").trim()] || "Óflokkað" });
                });

                applyShoppingFilters(root);
                return;
            }

            if (e.target.closest('[data-action="export-xlsx"]')) {
                e.preventDefault();
                exportXlsx();
                return;
            }

            if (e.target.closest('[data-action="export-pdf"]')) {
                e.preventDefault();
                exportPdf();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { init().catch(console.error); });
    } else {
        init().catch(console.error);
    }
})();


(function () {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    var cfg = window.STORKAUP_CONFIG || {};
    var SUPA_URL = cfg.supabaseUrl;
    var SUPA_KEY = cfg.publishableKey;
    if (!SUPA_URL || !SUPA_KEY) return console.error("[order-search] Missing STORKAUP_CONFIG");

    var root = document.querySelector('[data-el="order-search-root"]');
    if (!root) return;

    var MIN_LEN     = 2;
    var DEBOUNCE_MS = 150;
    var LIMIT       = 30;

    var state = { seq: 0, debounceId: null };

    function rpcHeaders() {
        return {
            apikey:            SUPA_KEY,
            Authorization:     "Bearer " + SUPA_KEY,
            "Content-Type":    "application/json",
            "Content-Profile": "api"
        };
    }

    function fmtIsk(v) {
        var n = Number(v);
        if (!isFinite(n)) return "-";
        return n.toLocaleString("is-IS", { style: "currency", currency: "ISK", maximumFractionDigits: 0 });
    }

    function fmtDate(v) {
        if (!v) return "-";
        try {
            var d = new Date(v);
            if (isNaN(d.getTime())) return String(v).slice(0, 10);
            return d.toLocaleDateString("is-IS", { day: "2-digit", month: "2-digit", year: "numeric" });
        } catch (_) {
            return String(v).slice(0, 10);
        }
    }

    function escHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g,  "&lt;")
            .replace(/>/g,  "&gt;")
            .replace(/"/g,  "&quot;");
    }

    // Clone the Webflow-designed template, fill data-field children, set data-* on root.
    // Template element: [data-el="order-template"] (hidden in Webflow)
    // Child elements carry data-field="order-id" | "ext-id" | "company-id" |
    //   "company-name" | "total" | "date" | "status" | "salesperson" | "items" | "source"
    function renderRow(row, tmpl) {
        var el = tmpl.cloneNode(true);
        el.removeAttribute("data-el");      // don't accidentally match template selector
        el.style.display = "";              // template is hidden; show the clone

        var totalFmt = fmtIsk(row.total);
        var dateFmt  = fmtDate(row.order_date);

        // All data as attributes on the root element
        el.setAttribute("data-source",      row.source      || "");
        el.setAttribute("data-doc-type",    row.doc_type    || "");   // SR | SK | WEB
        el.setAttribute("data-order-id",    row.order_id    || "");   // SR-nr / SK-nr / web order ID
        el.setAttribute("data-sp-no",          row.sp_no        || "");   // SP-nr (sölupöntun)
        el.setAttribute("data-web-order-id", row.web_order_id || "");   // Magento order ID
        el.setAttribute("data-company-id",   row.company_id   || "");   // kennitala
        el.setAttribute("data-company-name",row.company_name|| "");
        el.setAttribute("data-total",       row.total       || "0");
        el.setAttribute("data-total-fmt",   totalFmt);
        el.setAttribute("data-date",        dateFmt);
        el.setAttribute("data-status",      row.status      || "");
        el.setAttribute("data-salesperson", row.salesperson_code || "");
        el.setAttribute("data-items",       row.items       || "");
        el.setAttribute("data-is-vefur",    (row.source === "bc" && String(row.salesperson_code || "").toUpperCase() === "VEFUR") ? "true" : "false");

        // Populate any child elements that declare data-field="..."
        var fields = {
            "source":       row.source      || "",
            "doc-type":     row.doc_type    || "",
            "order-id":     row.order_id    || "",
            "sp-no":          row.sp_no        || "",
            "web-order-id":   row.web_order_id || "",
            "company-id":     row.company_id   || "",
            "company-name": row.company_name|| "",
            "total":        totalFmt,
            "date":         dateFmt,
            "status":       row.status      || "",
            "salesperson":  row.salesperson_code || "",
            "items":        row.items       || ""
        };

        el.querySelectorAll("[data-field]").forEach(function (child) {
            var key = child.getAttribute("data-field");
            if (key in fields) child.textContent = fields[key];
        });

        return el;
    }

    async function searchOrders(query) {
        var seq = ++state.seq;
        var q   = String(query || "").trim();

        var resultsEl = root.querySelector('[data-el="order-results"]');
        var emptyEl   = root.querySelector('[data-el="order-empty"]');
        var loadingEl = root.querySelector('[data-el="order-loading"]');
        var countEl   = root.querySelector('[data-el="order-count"]');
        var tmpl      = root.querySelector('[data-el="order-template"]');

        if (q.length < MIN_LEN) {
            if (resultsEl)  resultsEl.innerHTML     = "";
            if (emptyEl)    emptyEl.style.display   = "none";
            if (loadingEl)  loadingEl.style.display = "none";
            if (countEl)    countEl.textContent      = "";
            return;
        }

        if (loadingEl) loadingEl.style.display = "";
        if (emptyEl)   emptyEl.style.display   = "none";
        if (countEl)   countEl.textContent      = "";

        try {
            var res = await fetch(SUPA_URL + "/rest/v1/rpc/search_orders", {
                method:  "POST",
                headers: rpcHeaders(),
                body:    JSON.stringify({ p_query: q, p_limit: LIMIT }),
                cache:   "no-store"
            });

            if (seq !== state.seq) return;
            if (loadingEl) loadingEl.style.display = "none";

            if (!res.ok) {
                console.error("[order-search] RPC error", res.status, await res.text());
                return;
            }

            var rows = await res.json();
            if (seq !== state.seq) return;

            if (!Array.isArray(rows) || !rows.length) {
                if (resultsEl) resultsEl.innerHTML   = "";
                if (emptyEl)   emptyEl.style.display = "";
                if (countEl)   countEl.textContent    = "";
                return;
            }

            if (countEl) {
                countEl.textContent = rows.length + (rows.length >= LIMIT ? "+" : "") + " niðurstöður";
            }
            if (emptyEl) emptyEl.style.display = "none";

            if (resultsEl) {
                resultsEl.innerHTML = "";
                if (tmpl) {
                    rows.forEach(function (row) {
                        resultsEl.appendChild(renderRow(row, tmpl));
                    });
                } else {
                    // Fallback if no Webflow template: plain data-attribute divs
                    resultsEl.innerHTML = rows.map(function (row) {
                        return '<div'
                            + ' data-source="'      + escHtml(row.source)               + '"'
                            + ' data-doc-type="'    + escHtml(row.doc_type)             + '"'
                            + ' data-order-id="'    + escHtml(row.order_id)             + '"'
                            + ' data-sp-no="'          + escHtml(row.sp_no)               + '"'
                            + ' data-web-order-id="' + escHtml(row.web_order_id)         + '"'
                            + ' data-company-id="'   + escHtml(row.company_id)           + '"'
                            + ' data-company-name="'+ escHtml(row.company_name)         + '"'
                            + ' data-total="'       + escHtml(String(row.total || "0")) + '"'
                            + ' data-total-fmt="'   + escHtml(fmtIsk(row.total))        + '"'
                            + ' data-date="'        + escHtml(fmtDate(row.order_date))  + '"'
                            + ' data-status="'      + escHtml(row.status)               + '"'
                            + ' data-salesperson="' + escHtml(row.salesperson_code)     + '"'
                            + ' data-items="'       + escHtml(row.items)                + '"'
                            + '></div>';
                    }).join("");
                }
            }

        } catch (err) {
            if (seq !== state.seq) return;
            if (loadingEl) loadingEl.style.display = "none";
            console.error("[order-search] fetch error", err);
        }
    }

    var input = root.querySelector('[data-input="order-search"]');
    if (!input) return;

    input.addEventListener("input", function () {
        clearTimeout(state.debounceId);
        var val = input.value;
        state.debounceId = setTimeout(function () { searchOrders(val); }, DEBOUNCE_MS);
    });

    if (input.value && input.value.length >= MIN_LEN) {
        searchOrders(input.value);
    }

    document.dispatchEvent(new CustomEvent("storkaup:page-ready"));
})();

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

    function statusTag(row) {
        if (row.source === "bc") {
            if (row.status === "canceled") return { label: "Afturkallaður", cls: "order-tag--red" };
            if (row.status === "closed")   return { label: "Lokið",         cls: "order-tag--grey" };
            return { label: "Opið", cls: "order-tag--green" };
        }
        var s = String(row.status || "").toLowerCase();
        if (s === "complete")   return { label: "Lokið",      cls: "order-tag--grey" };
        if (s === "canceled")   return { label: "Afturkallaður", cls: "order-tag--red" };
        if (s === "pending")    return { label: "Í bið",       cls: "order-tag--yellow" };
        if (s === "processing") return { label: "Í vinnslu",   cls: "order-tag--blue" };
        return { label: row.status || "-", cls: "order-tag--grey" };
    }

    function renderRow(row) {
        var srcBadge = row.source === "bc"
            ? '<span class="order-tag order-tag--bc">BC</span>'
            : '<span class="order-tag order-tag--web">WEB</span>';

        var isVefur = row.source === "bc" && String(row.salesperson_code || "").toUpperCase() === "VEFUR";
        var vefurBadge = isVefur ? '<span class="order-tag order-tag--vefur">Vefpöntun</span>' : "";

        var st = statusTag(row);
        var stBadge = '<span class="order-tag ' + st.cls + '">' + st.label + '</span>';

        return '<div class="order-row">'
            + '<div class="order-row__meta">'
            +   srcBadge + vefurBadge + stBadge
            +   '<span class="order-row__date">' + fmtDate(row.order_date) + '</span>'
            + '</div>'
            + '<div class="order-row__main">'
            +   '<span class="order-row__id">' + escHtml(row.order_id || "-") + '</span>'
            +   '<span class="order-row__name">' + escHtml(row.company_name || "-") + '</span>'
            + '</div>'
            + '<div class="order-row__total">' + fmtIsk(row.total) + '</div>'
            + '</div>';
    }

    async function searchOrders(query) {
        var seq = ++state.seq;
        var q   = String(query || "").trim();

        var resultsEl = root.querySelector('[data-el="order-results"]');
        var emptyEl   = root.querySelector('[data-el="order-empty"]');
        var loadingEl = root.querySelector('[data-el="order-loading"]');
        var countEl   = root.querySelector('[data-el="order-count"]');

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
            if (emptyEl)   emptyEl.style.display = "none";
            if (resultsEl) resultsEl.innerHTML    = rows.map(renderRow).join("");

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

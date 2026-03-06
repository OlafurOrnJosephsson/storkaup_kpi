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
        priorityFlagsByFamily: {},
        reps: [],
        customerSortKey: "low_hanging_fruit_score",
        customerSortDir: "desc",
        shoppingRows: [],
        shoppingFiltered: [],
        sortKey: "total_revenue",
        sortDir: "desc",
        activeChip: "all",
        defaultChip: "all",
        searchTerm: "",
        searchDebounceId: null,
        searchSeq: 0,
        profileScope: "family"
    };
    var MAX_RENDERED_CUSTOMERS = 150;
    var CUSTOMER_CACHE_KEY = "storkaup:customer_profiles_labeled_trends:v1";
    var CUSTOMER_CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
    var PRIORITY_FLAGS_CACHE_KEY = "storkaup:customer_priority_flags:v1";
    var PRIORITY_FLAGS_CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes

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

    function canUseLocalStorage_() {
        try {
            return typeof window !== "undefined" && !!window.localStorage;
        } catch (_) {
            return false;
        }
    }

    function loadCustomerCache_() {
        if (!canUseLocalStorage_()) return [];
        try {
            var raw = window.localStorage.getItem(CUSTOMER_CACHE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.rows)) return [];
            var ts = Number(parsed.ts || 0);
            if (!Number.isFinite(ts) || ts <= 0) return [];
            if ((Date.now() - ts) > CUSTOMER_CACHE_TTL_MS) return [];
            return parsed.rows;
        } catch (_) {
            return [];
        }
    }

    function saveCustomerCache_(rows) {
        if (!canUseLocalStorage_()) return;
        try {
            var data = {
                ts: Date.now(),
                rows: Array.isArray(rows) ? rows : []
            };
            window.localStorage.setItem(CUSTOMER_CACHE_KEY, JSON.stringify(data));
        } catch (_) {
            // Ignore quota/storage errors silently.
        }
    }

    function loadPriorityFlagsCache_() {
        if (!canUseLocalStorage_()) return null;
        try {
            var raw = window.localStorage.getItem(PRIORITY_FLAGS_CACHE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.rows)) return null;
            var ts = Number(parsed.ts || 0);
            if (!Number.isFinite(ts) || ts <= 0) return null;
            if ((Date.now() - ts) > PRIORITY_FLAGS_CACHE_TTL_MS) return null;
            return parsed.rows;
        } catch (_) {
            return null;
        }
    }

    function savePriorityFlagsCache_(rows) {
        if (!canUseLocalStorage_()) return;
        try {
            window.localStorage.setItem(PRIORITY_FLAGS_CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                rows: Array.isArray(rows) ? rows : []
            }));
        } catch (_) {
            // Ignore quota/storage errors silently.
        }
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
        if (p === 0) return c === 0 ? "0%" : "Nýtt";
        var pct = ((c - p) / p) * 100;
        var sign = pct > 0 ? "+" : "";
        return sign + pct.toFixed(1).replace(".", ",") + "%";
    }

    function normalizeChip_(chip) {
        var raw = String(chip || "").trim().toLowerCase();
        if (!raw) return "all";
        var compact = raw
            .replace(/[\s_\-]+/g, "")
            .replace(/á/g, "a")
            .replace(/í/g, "i")
            .replace(/é/g, "e")
            .replace(/ó/g, "o")
            .replace(/ú/g, "u")
            .replace(/ý/g, "y")
            .replace(/ö/g, "o")
            .replace(/ð/g, "d")
            .replace(/þ/g, "th")
            .replace(/æ/g, "ae");

        if (compact === "all" || compact === "allir") return "all";
        if (compact === "flagged" || compact === "forgangslisti") return "flagged";
        if (compact === "priority" || compact === "forgangur") return "priority";
        if (compact === "nonpriority" || compact === "ekkiforgangur") return "nonpriority";

        if (compact === "webshopactive" || compact === "active" || compact === "virkaravef" || compact === "virkuravef") return "webshop_active";
        if (compact === "webshopinactive" || compact === "inactive" || compact === "ovirkiravef" || compact === "ovirkuravef") return "webshop_inactive";

        if (
            compact === "priorityonboardedselfserve" ||
            compact === "onboardedselfserve" ||
            compact === "selfserve" ||
            compact === "sjalfsafgreidsla"
        ) return "priority_onboarded_selfserve";

        if (
            compact === "priorityreponly" ||
            compact === "onboardedreponly" ||
            compact === "reponly" ||
            compact === "iferli"
        ) return "priority_rep_only";

        if (
            compact === "prioritypending" ||
            compact === "pending" ||
            compact === "ekkiferli" ||
            compact === "biouronboarding" ||
            compact === "biduronboarding"
        ) return "priority_pending";

        return raw;
    }

    function formatPriorityStatusLabel_(status) {
        var s = String(status || "").trim().toLowerCase();
        if (s === "priority") return "Forgangur";
        if (s === "nonpriority") return "Ekki forgangur";
        return "-";
    }

    function formatOnboardedStatusLabel_(status) {
        var s = String(status || "").trim().toLowerCase();
        if (s === "onboarded_selfserve") return "Sjálfsafgreiðsla";
        if (s === "onboarded_rep_only") return "Í ferli";
        if (s === "priority_pending") return "Ekki í ferli";
        if (s === "nonpriority") return "Ekki forgangur";
        return "-";
    }

    function formatWebshopStatusLabel_(isActive) {
        return isActive ? "Virkur" : "Óvirkur";
    }

    function formatRepLabel_(nameNorm) {
        var s = String(nameNorm || "").trim();
        if (!s) return "-";
        return s;
    }

    function repCanonicalKey_(nameNorm) {
        var raw = String(nameNorm || "").trim().toLowerCase();
        if (!raw) return "";
        var compact = raw.replace(/[^a-z0-9]/g, "");
        var stripped = compact.replace(/solumadur/g, "").replace(/storkaup/g, "");
        return stripped || compact;
    }

    function repChoiceScore_(nameNorm) {
        var n = String(nameNorm || "").trim().toLowerCase();
        if (!n) return 99;
        if (n.indexOf("solumadur") === 0) return 0;
        if (n.indexOf("storkaup") === 0) return 1;
        return 2;
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

    function priorityKeyFromCustomerId(value) {
        var raw = String(value || "").trim();
        if (!raw) return "";
        var norm = raw.replace(/\D/g, "");
        return norm || raw.toLowerCase();
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

    function emptyPriorityFlag_() {
        return {
            status: "",
            onboarded_status: "",
            first_web_order_at: "",
            first_selfserve_order_at: "",
            assigned_rep_name_norm: "",
            updated_at: "",
            note: ""
        };
    }

    function applyPriorityFlagToTarget_(target, flag) {
        if (!target) return;
        var f = flag || emptyPriorityFlag_();
        target.manual_priority_status = f.status || "";
        target.onboarded_status = f.onboarded_status || "";
        target.first_web_order_at = f.first_web_order_at || "";
        target.first_selfserve_order_at = f.first_selfserve_order_at || "";
        target.assigned_rep_name_norm = f.assigned_rep_name_norm || "";
        target.manual_priority_updated_at = f.updated_at || "";
        target.manual_priority_note = f.note || "";
    }

    function syncChipButtons_(root) {
        if (!root) return;
        root.querySelectorAll("[data-chip]").forEach(function(b) {
            var chip = normalizeChip_(b.getAttribute("data-chip") || "");
            b.classList.toggle("is-active", chip === state.activeChip);
        });
    }

    function buildSelectedProfile(selected, allRows, profileScope) {
        if (!selected) return null;
        var out = Object.assign({}, selected);
        var fam = customerFamilyId(selected.customer_id);
        var scope = String(profileScope || "family").toLowerCase();
        out._priorityTargetCustomerId = String(selected.customer_id || "").trim();

        if (scope === "child") {
            out._queryCustomerId = String(selected.customer_id || "").trim();
            out.customer_family_id = fam;
            var keyChild = priorityKeyFromCustomerId(selected.customer_id);
            var fchild = keyChild ? state.priorityFlagsByFamily[keyChild] : null;
            if (fchild) {
                out.manual_priority_status = fchild.status || "";
                out.onboarded_status = fchild.onboarded_status || "";
                out.first_web_order_at = fchild.first_web_order_at || "";
                out.first_selfserve_order_at = fchild.first_selfserve_order_at || "";
                out.assigned_rep_name_norm = fchild.assigned_rep_name_norm || "";
                out.manual_priority_updated_at = fchild.updated_at || "";
                out.manual_priority_note = fchild.note || "";
            }
            return out;
        }

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
        out.customer_family_id = fam;
        var keySel = priorityKeyFromCustomerId(selected.customer_id);
        var f = keySel ? state.priorityFlagsByFamily[keySel] : null;
        if (f) {
            out.manual_priority_status = f.status || "";
            out.onboarded_status = f.onboarded_status || "";
            out.first_web_order_at = f.first_web_order_at || "";
            out.first_selfserve_order_at = f.first_selfserve_order_at || "";
            out.assigned_rep_name_norm = f.assigned_rep_name_norm || "";
            out.manual_priority_updated_at = f.updated_at || "";
            out.manual_priority_note = f.note || "";
        }
        return out;
    }

    function getSelectedQueryCustomerId() {
        if (!state.selected) return "";
        return String(state.selected._queryCustomerId || state.selected.customer_id || "").trim();
    }

    function getSelectedPriorityTargetCustomerId() {
        if (!state.selected) return "";
        return String(state.selected._priorityTargetCustomerId || state.selected.customer_id || "").trim();
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

    function ensureModuleLoader_(root) {
        if (!root) return null;
        var existing = root.querySelector('[data-role="cp-loading-overlay"]');
        if (existing) return existing;

        if (window.getComputedStyle(root).position === "static") {
            root.style.position = "relative";
        }

        var overlay = document.createElement("div");
        overlay.setAttribute("data-role", "cp-loading-overlay");
        overlay.setAttribute("aria-hidden", "true");
        overlay.className = "cp-loading-overlay";

        var spinner = document.createElement("div");
        spinner.className = "cp-loading-spinner";

        var label = document.createElement("div");
        label.className = "cp-loading-label";
        label.textContent = "Augnablik! Hleð gögnum";

        overlay.appendChild(spinner);
        overlay.appendChild(label);
        root.appendChild(overlay);
        return overlay;
    }

    function setModuleLoading_(root, on, message) {
        if (!root) return;
        var n = Number(root.getAttribute("data-loading-count") || 0) || 0;
        var overlay = ensureModuleLoader_(root);
        if (!overlay) return;

        if (on) {
            n += 1;
            root.setAttribute("data-loading-count", String(n));
            root.setAttribute("data-loading", "true");
            root.setAttribute("aria-busy", "true");
            var label = overlay.querySelector(".cp-loading-label");
            if (label && message) label.textContent = String(message);
            overlay.style.display = "flex";
            return;
        }

        n = Math.max(0, n - 1);
        root.setAttribute("data-loading-count", String(n));
        if (n > 0) return;
        root.removeAttribute("data-loading");
        root.setAttribute("aria-busy", "false");
        overlay.style.display = "none";
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
        var res = await fetch(URL + path, { headers: headers("api"), cache: "no-store" });
        if (!res.ok) {
            var errText = await res.text();
            var e = new Error(errText);
            e.__isTimeout = isTimeoutErrorText(errText);
            e.__status = Number(res.status || 0);
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

    async function fetchProfilesByQuery(query, limit) {
        var q = String(query || "").trim();
        if (!q) return [];
        var lim = Number(limit || 50);
        var escaped = q.replace(/[%*,()]/g, "");
        var orExpr = "(customer_name.ilike.*" + escaped + "*,customer_id.ilike.*" + escaped + "*)";
        var path =
            "/rest/v1/v_customer_profiles_labeled_trends?select=" + encodeURIComponent(PROFILE_FIELDS) +
            "&or=" + encodeURIComponent(orExpr) +
            "&limit=" + lim;
        var res = await fetch(URL + path, { headers: headers("api"), cache: "no-store" });
        if (!res.ok) return [];
        var rows = await res.json();
        return Array.isArray(rows) ? rows : [];
    }

    async function fetchProfilesByCustomerIds(ids, maxRows) {
        var clean = (ids || []).map(function(x) { return String(x || "").trim(); }).filter(function(x) { return !!x; });
        if (!clean.length) return [];
        var limitMax = Math.max(1, Number(maxRows || 2000));
        var out = [];
        var seen = {};
        // Keep chunk size conservative to avoid intermittent 500/timeout spikes
        // from heavy view evaluation during initial flagged bootstrap.
        var chunkSize = 8;

        async function fetchChunk_(chunk) {
            if (!chunk || !chunk.length) return [];
            var inList = chunk.map(function(v) {
                return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
            }).join(",");
            var path =
                "/rest/v1/v_customer_profiles_labeled_trends?select=" + encodeURIComponent(PROFILE_FIELDS) +
                "&customer_id=in.(" + inList + ")" +
                "&limit=" + Math.min(1000, chunk.length);
            var res = await fetch(URL + path, { headers: headers("api"), cache: "no-store" });
            if (res.ok) return res.json();

            var errText = await res.text();
            var retryable = Number(res.status || 0) >= 500 || isTimeoutErrorText(errText);
            if (!retryable) return [];

            if (chunk.length <= 1) return [];
            var mid = Math.floor(chunk.length / 2);
            var left = await fetchChunk_(chunk.slice(0, mid));
            var right = await fetchChunk_(chunk.slice(mid));
            return (left || []).concat(right || []);
        }

        for (var i = 0; i < clean.length; i += chunkSize) {
            var chunk = clean.slice(i, i + chunkSize);
            var rows = await fetchChunk_(chunk);
            (rows || []).forEach(function(r) {
                var key = String(r && r.customer_id || "");
                if (!key || seen[key]) return;
                seen[key] = true;
                out.push(r);
            });
            if (out.length >= limitMax) break;
        }

        return out.slice(0, limitMax);
    }

    async function hydrateProfilesInBackground(root, startOffset, pageSize, maxRows, useOrder) {
        for (var offset = startOffset; offset < maxRows; offset += pageSize) {
            var rows = await fetchProfilesPage(offset, pageSize, useOrder);
            if (!rows.length) break;

            state.customers = state.customers.concat(rows);
            applyPriorityFlagsToCustomers_();
            sortProfilesByScore(state.customers);
            if (!state.searchTerm) {
                applyFilters(root, "");
            }

            if (rows.length < pageSize) break;
            await new Promise(function(resolve) { setTimeout(resolve, 0); });
        }
        saveCustomerCache_(state.customers);
        if (state.searchTerm) {
            var q = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
            applyFilters(root, q);
        }
    }

    function matchesChip(c, chip) {
        chip = normalizeChip_(chip);
        if (chip === "none") return false;
        if (chip === "all") return true;
        if (chip === "flagged") {
            var st = String(c.manual_priority_status || "").toLowerCase();
            return st === "priority" || st === "nonpriority";
        }
        if (chip === "priority") return String(c.manual_priority_status || "").toLowerCase() === "priority";
        if (chip === "nonpriority") return String(c.manual_priority_status || "").toLowerCase() === "nonpriority";
        if (chip === "priority_onboarded_selfserve") return String(c.onboarded_status || "").toLowerCase() === "onboarded_selfserve";
        if (chip === "priority_pending") return String(c.onboarded_status || "").toLowerCase() === "priority_pending";
        if (chip === "priority_rep_only") return String(c.onboarded_status || "").toLowerCase() === "onboarded_rep_only";
        if (chip === "lhfs_very_high") return String(c.lhfs_label || "").toLowerCase() === "very high";
        if (chip === "no_web_30d") return numOrZero(c.web_orders_30d) === 0;
        if (chip === "revenue_down_30d") return numOrZero(c.bc_revenue_30d) < numOrZero(c.bc_revenue_prev_30d);
        if (chip === "webshop_active") return !!c.webshop_active;
        if (chip === "webshop_inactive") return !c.webshop_active;
        return true;
    }

    function sortCustomers_(rows) {
        var key = String(state.customerSortKey || "low_hanging_fruit_score");
        var dir = String(state.customerSortDir || "desc");
        var mul = dir === "asc" ? 1 : -1;
        rows.sort(function(a, b) {
            if (key === "customer_name") {
                var an = String(a.customer_name || "").toLowerCase();
                var bn = String(b.customer_name || "").toLowerCase();
                return an.localeCompare(bn) * mul;
            }
            if (key === "webshop_active") {
                var av = a.webshop_active ? 1 : 0;
                var bv = b.webshop_active ? 1 : 0;
                if (av !== bv) return (av - bv) * mul;
                var an2 = String(a.customer_name || "").toLowerCase();
                var bn2 = String(b.customer_name || "").toLowerCase();
                return an2.localeCompare(bn2);
            }
            if (key === "customer_id") {
                var ai = String(a.customer_id || "");
                var bi = String(b.customer_id || "");
                return ai.localeCompare(bi) * mul;
            }
            if (key === "assigned_rep_name_norm") {
                var ar = String(a.assigned_rep_name_norm || "").toLowerCase();
                var br = String(b.assigned_rep_name_norm || "").toLowerCase();
                if (!ar && br) return 1;
                if (ar && !br) return -1;
                if (ar !== br) return ar.localeCompare(br) * mul;
                var an4 = String(a.customer_name || "").toLowerCase();
                var bn4 = String(b.customer_name || "").toLowerCase();
                return an4.localeCompare(bn4);
            }
            var avn = numOrZero(a[key]);
            var bvn = numOrZero(b[key]);
            if (avn !== bvn) return (avn - bvn) * mul;
            var an3 = String(a.customer_name || "").toLowerCase();
            var bn3 = String(b.customer_name || "").toLowerCase();
            return an3.localeCompare(bn3);
        });
    }

    function updateCustomerSortIndicators(root) {
        var heads = root.querySelectorAll("[data-sort-customer], [data-sort]");
        if (!heads || !heads.length) return;
        heads.forEach(function(h) {
            var key = String(h.getAttribute("data-sort-customer") || h.getAttribute("data-sort") || "").trim();
            var isCustomerSortKey =
                key === "customer_name" ||
                key === "webshop_active" ||
                key === "customer_id" ||
                key === "low_hanging_fruit_score" ||
                key === "assigned_rep_name_norm";
            if (!isCustomerSortKey) return;
            h.classList.remove("is-sort-active", "is-asc", "is-desc");
            if (key === state.customerSortKey) {
                h.classList.add("is-sort-active");
                h.classList.add(state.customerSortDir === "asc" ? "is-asc" : "is-desc");
            }
        });
    }

    function applyPriorityFlagsToCustomers_() {
        (state.customers || []).forEach(function(c) {
            var fam = customerFamilyId(c && c.customer_id);
            var key = priorityKeyFromCustomerId(c && c.customer_id);
            var f = key ? state.priorityFlagsByFamily[key] : null;
            c.customer_family_id = fam;
            applyPriorityFlagToTarget_(c, f);
        });
        if (state.selected && state.selected.customer_id) {
            var sf = customerFamilyId(state.selected.customer_id);
            var skey = priorityKeyFromCustomerId(getSelectedPriorityTargetCustomerId());
            var flag = skey ? state.priorityFlagsByFamily[skey] : null;
            state.selected.customer_family_id = sf;
            applyPriorityFlagToTarget_(state.selected, flag);
        }
    }

    async function fetchPriorityFlags_() {
        var res = await fetch(URL + "/rest/v1/rpc/get_customer_priority_flags", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify({})
        });
        if (!res.ok) throw new Error(await res.text());
        var rows = await res.json();
        var map = {};
        (rows || []).forEach(function(r) {
            var key = priorityKeyFromCustomerId((r && r.customer_id) || (r && r.customer_family_id));
            if (!key) return;
            map[key] = {
                status: String(r && r.status || "").toLowerCase(),
                onboarded_status: String(r && r.onboarded_status || "").toLowerCase(),
                first_web_order_at: r && r.first_web_order_at ? r.first_web_order_at : "",
                first_selfserve_order_at: r && r.first_selfserve_order_at ? r.first_selfserve_order_at : "",
                assigned_rep_name_norm: String(r && r.assigned_rep_name_norm || "").toLowerCase(),
                updated_at: r && r.updated_at ? r.updated_at : "",
                note: r && r.note ? r.note : ""
            };
        });
        savePriorityFlagsCache_(rows || []);
        state.priorityFlagsByFamily = map;
        applyPriorityFlagsToCustomers_();
    }

    async function fetchActiveReps_() {
        var res = await fetch(URL + "/rest/v1/rpc/get_active_sales_reps", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify({})
        });
        if (!res.ok) throw new Error(await res.text());
        var rows = await res.json();
        var normalized = (rows || []).map(function(r) {
            return {
                name_norm: String(r && r.name_norm || "").toLowerCase(),
                email_norm: String(r && r.email_norm || "").toLowerCase()
            };
        }).filter(function(r) { return !!r.name_norm; });

        var byCanonical = {};
        normalized.forEach(function(rep) {
            var key = repCanonicalKey_(rep.name_norm);
            if (!key) return;
            var existing = byCanonical[key];
            if (!existing) {
                byCanonical[key] = rep;
                return;
            }
            var oldScore = repChoiceScore_(existing.name_norm);
            var newScore = repChoiceScore_(rep.name_norm);
            if (newScore < oldScore || (newScore === oldScore && rep.name_norm < existing.name_norm)) {
                byCanonical[key] = rep;
            }
        });

        state.reps = Object.keys(byCanonical).map(function(k) { return byCanonical[k]; }).sort(function(a, b) {
            return String(a.name_norm || "").localeCompare(String(b.name_norm || ""));
        });
    }

    function setPriorityFeedback_(root, msg) {
        var el = root.querySelector('[data-bind="priority-feedback"]') || root.querySelector('[data-bind="task-feedback"]');
        if (!el) return;
        el.textContent = msg || "";
    }

    function ensureActionToast_() {
        var id = "storkaup-action-toast";
        var el = document.getElementById(id);
        if (el) return el;

        el = document.createElement("div");
        el.id = id;
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        el.style.position = "fixed";
        el.style.right = "20px";
        el.style.bottom = "20px";
        el.style.zIndex = "9999";
        el.style.maxWidth = "360px";
        el.style.padding = "10px 14px";
        el.style.borderRadius = "10px";
        el.style.fontSize = "14px";
        el.style.fontWeight = "600";
        el.style.boxShadow = "0 10px 24px rgba(0,0,0,0.18)";
        el.style.opacity = "0";
        el.style.transform = "translateY(8px)";
        el.style.transition = "opacity 180ms ease, transform 180ms ease";
        el.style.pointerEvents = "none";
        el.style.display = "none";
        document.body.appendChild(el);
        return el;
    }

    var toastHideTimer_ = null;
    function showActionToast_(message, kind) {
        var el = ensureActionToast_();
        var k = String(kind || "info").toLowerCase();
        el.textContent = String(message || "");
        if (k === "error") {
            el.style.background = "#fee4e2";
            el.style.color = "#b42318";
            el.style.border = "1px solid #fecdca";
        } else {
            el.style.background = "#ecfdf3";
            el.style.color = "#027a48";
            el.style.border = "1px solid #abefc6";
        }

        if (toastHideTimer_) clearTimeout(toastHideTimer_);
        el.style.display = "block";
        requestAnimationFrame(function() {
            el.style.opacity = "1";
            el.style.transform = "translateY(0)";
        });
        toastHideTimer_ = setTimeout(function() {
            el.style.opacity = "0";
            el.style.transform = "translateY(8px)";
            setTimeout(function() { el.style.display = "none"; }, 200);
        }, 2600);
    }

    async function setSelectedPriorityStatus_(root, status) {
        if (!state.selected) return;
        var payload = {
            p_customer_id: getSelectedPriorityTargetCustomerId(),
            p_status: String(status || "").trim().toLowerCase(),
            p_customer_name: state.selected.customer_name || null,
            p_note: null
        };
        var res = await fetch(URL + "/rest/v1/rpc/set_customer_priority_flag", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        await res.json();
        await fetchPriorityFlags_();
        bindSelected(root);
        var q = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
        await applyFilters(root, q);
        var okMsg = status === "priority" ? "Vistað: Forgangur." : "Vistað: Ekki forgangur.";
        setPriorityFeedback_(root, okMsg);
        showActionToast_(okMsg, "success");
    }

    async function assignSelectedRep_(root, repNameNorm) {
        if (!state.selected) return;
        var payload = {
            p_customer_id: getSelectedPriorityTargetCustomerId(),
            p_assigned_rep_name_norm: String(repNameNorm || "").trim().toLowerCase()
        };
        var res = await fetch(URL + "/rest/v1/rpc/assign_customer_priority_rep", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        await res.json();
        await fetchPriorityFlags_();
        bindSelected(root);
        var q = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
        await applyFilters(root, q);
        var msg = repNameNorm ? ("Sölumaður tengdur: " + formatRepLabel_(repNameNorm)) : "Sölumaður aftengdur.";
        setPriorityFeedback_(root, msg);
        showActionToast_(msg, "success");
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
            var fps = n.querySelector('[data-field="manual_priority_status"]');
            var open = n.querySelector('[data-action="open-profile"]') || n;

            if (fn) fn.textContent = c.customer_name || "";
            if (fi) fi.textContent = c.customer_id || "";
            if (fw) {
                fw.textContent = formatWebshopStatusLabel_(!!c.webshop_active);
                fw.setAttribute("data-status", c.webshop_active ? "active" : "inactive");
            }
            if (fobc) fobc.textContent = fmtInt(c.orders_bc_365d);
            if (fgbc) fgbc.textContent = c.avg_days_between_bc_orders ? fmtInt(c.avg_days_between_bc_orders) : "-";
            if (foweb) foweb.textContent = fmtInt(c.orders_web_365d);
            if (fgweb) fgweb.textContent = c.avg_days_between_web_orders ? fmtInt(c.avg_days_between_web_orders) : "-";
            if (fp) fp.textContent = c.lhfs_percentile != null ? c.lhfs_percentile : "-";
            if (fl) fl.textContent = c.lhfs_label || "-";
            if (fps) fps.textContent = formatPriorityStatusLabel_(c.manual_priority_status);
            var fos = n.querySelector('[data-field="onboarded_status"]');
            if (fos) {
                var onboardedNorm = String(c.onboarded_status || "").toLowerCase() || "unknown";
                fos.textContent = formatOnboardedStatusLabel_(c.onboarded_status);
                fos.setAttribute("data-status", onboardedNorm);
            }
            var frep = n.querySelector('[data-field="assigned_rep_name_norm"]');
            if (frep) frep.textContent = formatRepLabel_(c.assigned_rep_name_norm);

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
            selected_manual_priority_status: formatPriorityStatusLabel_(p.manual_priority_status),
            selected_onboarded_status: formatOnboardedStatusLabel_(p.onboarded_status),
            selected_webshop_active: formatWebshopStatusLabel_(!!p.webshop_active),
            selected_assigned_rep_name_norm: formatRepLabel_(p.assigned_rep_name_norm),
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
        var cid = String(customerId || "").trim();
        var baseLimit = Math.max(10, Number(limit || 5));
        var tried = {};
        var attempts = [baseLimit, 12, 10, 8, 6].filter(function(v) {
            var n = Number(v || 0);
            if (n <= 0) return false;
            var k = String(n);
            if (tried[k]) return false;
            tried[k] = true;
            return true;
        });

        var lastErr = null;
        for (var i = 0; i < attempts.length; i++) {
            var lim = attempts[i];
            var res = await fetch(URL + "/rest/v1/rpc/get_customer_last_orders", {
                method: "POST",
                headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
                body: JSON.stringify({
                    p_customer_id: cid,
                    p_limit: lim
                })
            });
            if (res.ok) return res.json();

            var errText = await res.text();
            var isRetryable = Number(res.status || 0) >= 500 || isTimeoutErrorText(errText);
            lastErr = new Error(errText);
            if (!isRetryable || i === attempts.length - 1) break;
        }
        throw lastErr || new Error("Failed to fetch last orders");
    }

    async function fetchFamilyProfileSummary(customerId) {
        var res = await fetch(URL + "/rest/v1/rpc/get_customer_profile_family_summary", {
            method: "POST",
            headers: Object.assign({ "Content-Type": "application/json" }, headers("api"), { "Content-Profile": "api" }),
            body: JSON.stringify({
                p_customer_id: String(customerId || "").trim()
            })
        });
        if (!res.ok) throw new Error(await res.text());
        var rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) return null;
        return rows[0] || null;
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
        var bcProto =
            resolveProto(root, "last-order-row-bc") ||
            resolveProto(root, "last-order-row-web") ||
            resolveProto(root, "last-order-row");

        if (webList && bcList) {
            renderLastOrderRows(webList, webProto, webRows);
            renderLastOrderRows(bcList, bcProto, bcRows);
            return;
        }

        var legacyList = root.querySelector('[data-list="last-orders"]');
        var legacyProto = resolveProto(root, "last-order-row");
        renderLastOrderRows(legacyList, legacyProto, all);
    }

    function renderAssignRepControls_(root) {
        if (!root) return;
        var list = root.querySelector('[data-list="assign-reps"]');
        if (list) {
            var proto = resolveProto(root, "assign-rep-option");
            list.innerHTML = "";
            (state.reps || []).forEach(function(rep) {
                var nameNorm = String(rep && rep.name_norm || "").trim().toLowerCase();
                if (!nameNorm) return;
                var node;
                if (proto && proto.node) {
                    node = proto.node.cloneNode(true);
                    if (proto.type === "prototype") {
                        node.removeAttribute("data-prototype");
                        node.style.display = "";
                    }
                } else {
                    node = document.createElement("a");
                    node.href = "#";
                    node.className = "cp-chip w-inline-block";
                    node.innerHTML = "<div></div>";
                }
                node.setAttribute("data-action", "assign-rep");
                node.setAttribute("data-rep", nameNorm);
                var txt = node.querySelector("div");
                if (txt) txt.textContent = nameNorm;
                else node.textContent = nameNorm;
                list.appendChild(node);
            });
        }

        var select = root.querySelector('[data-input="assign-rep"]');
        if (select && select.tagName && select.tagName.toLowerCase() === "select") {
            var first = select.querySelector('option[value=""]');
            select.innerHTML = "";
            var placeholder = first || document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = placeholder.textContent || "Velja sölumann";
            select.appendChild(placeholder);
            (state.reps || []).forEach(function(rep) {
                var nameNorm = String(rep && rep.name_norm || "").trim().toLowerCase();
                if (!nameNorm) return;
                var opt = document.createElement("option");
                opt.value = nameNorm;
                opt.textContent = nameNorm;
                select.appendChild(opt);
            });
        }
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

    async function applyFilters(root, q) {
        var s = (q || "").trim().toLowerCase();
        var seq = ++state.searchSeq;
        state.searchTerm = s;
        var out = state.customers.filter(function(c) {
            if (!matchesChip(c, state.activeChip)) return false;
            if (!s) return true;
            var name = String(c.customer_name || "").toLowerCase();
            var id = String(c.customer_id || "").toLowerCase();
            return name.indexOf(s) !== -1 || id.indexOf(s) !== -1;
        });

        // Fallback: query server when local cache misses the term.
        if (s && out.length === 0 && s.length >= 3) {
            setModuleLoading_(root, true, "Augnablik! Hleð gögnum");
            try {
                var remote = await fetchProfilesByQuery(s, 80);
                if (seq !== state.searchSeq) return; // stale async response
                if (remote.length) {
                    var seen = {};
                    state.customers.forEach(function(r) { seen[String(r.customer_id || "")] = true; });
                    remote.forEach(function(r) {
                        var k = String(r.customer_id || "");
                        if (!seen[k]) {
                            state.customers.push(r);
                            seen[k] = true;
                        }
                    });
                    applyPriorityFlagsToCustomers_();
                    sortProfilesByScore(state.customers);
                    out = state.customers.filter(function(c) {
                        if (!matchesChip(c, state.activeChip)) return false;
                        var name = String(c.customer_name || "").toLowerCase();
                        var id = String(c.customer_id || "").toLowerCase();
                        return name.indexOf(s) !== -1 || id.indexOf(s) !== -1;
                    });
                }
            } finally {
                setModuleLoading_(root, false);
            }
        }

        sortCustomers_(out);
        state.filtered = out;
        renderCustomers(root);
        updateCustomerSortIndicators(root);
    }

    async function init() {
        var root = document.querySelector('[data-module="customer-profiles"]');
        if (!root) return;
        setModuleLoading_(root, true, "Augnablik! Hleð gögnum");

        try {
            var rawScope = String(root.getAttribute("data-profile-scope") || "").trim().toLowerCase();
            state.profileScope = rawScope === "child" ? "child" : "family";

            var defaultChip = normalizeChip_(root.getAttribute("data-default-chip") || "all");
            state.defaultChip = defaultChip || "all";
            state.activeChip = state.defaultChip;

            setProfileVisible(root, false);
            setCustomerListVisible(root, true);

            var cachedRows = loadCustomerCache_();
            if (cachedRows.length) {
                state.customers = cachedRows;
            }
            var cachedPriorityRows = loadPriorityFlagsCache_();
            if (cachedPriorityRows && cachedPriorityRows.length) {
                var cachedMap = {};
                cachedPriorityRows.forEach(function(r) {
                    var key = priorityKeyFromCustomerId((r && r.customer_id) || (r && r.customer_family_id));
                    if (!key) return;
                    cachedMap[key] = {
                        status: String(r && r.status || "").toLowerCase(),
                        onboarded_status: String(r && r.onboarded_status || "").toLowerCase(),
                        first_web_order_at: r && r.first_web_order_at ? r.first_web_order_at : "",
                        first_selfserve_order_at: r && r.first_selfserve_order_at ? r.first_selfserve_order_at : "",
                        assigned_rep_name_norm: String(r && r.assigned_rep_name_norm || "").toLowerCase(),
                        updated_at: r && r.updated_at ? r.updated_at : "",
                        note: r && r.note ? r.note : ""
                    };
                });
                state.priorityFlagsByFamily = cachedMap;
                applyPriorityFlagsToCustomers_();
            }

            var pageSize = 300;
            var maxRows = 6000;
            var useOrder = true;
            var hasCachedPriority = !!(cachedPriorityRows && cachedPriorityRows.length);
            if (hasCachedPriority) {
                fetchPriorityFlags_().catch(function(flagErrBg) {
                    console.error("Priority flags background refresh failed:", flagErrBg);
                });
            } else {
                try {
                    await fetchPriorityFlags_();
                } catch (flagErr) {
                    console.error("Priority flags fetch failed:", flagErr);
                    state.priorityFlagsByFamily = {};
                    applyPriorityFlagsToCustomers_();
                }
            }
            if (cachedRows.length) {
                sortProfilesByScore(state.customers);
                syncChipButtons_(root);
                updateCustomerSortIndicators(root);
                applyFilters(root, "");
            }
            var firstPage = [];
            var flaggedBootstrap = state.activeChip === "flagged" && Object.keys(state.priorityFlagsByFamily || {}).length > 0;
            if (flaggedBootstrap) {
                try {
                    firstPage = await fetchProfilesByCustomerIds(Object.keys(state.priorityFlagsByFamily || {}), maxRows);
                } catch (flaggedErr) {
                    console.error("Flagged bootstrap fetch failed:", flaggedErr);
                    firstPage = [];
                }
                if (!firstPage.length) {
                    try {
                        useOrder = false;
                        pageSize = 100;
                        maxRows = 3000;
                        firstPage = await fetchProfilesPage(0, pageSize, useOrder);
                    } catch (_) {
                        firstPage = [];
                    }
                }
            } else {
                try {
                    firstPage = await fetchProfilesPage(0, pageSize, useOrder);
                } catch (err) {
                    var shouldFallback = !!(err && (err.__isTimeout || Number(err.__status || 0) >= 500));
                    if (!shouldFallback) throw err;
                    // Timeout-safe fallback for heavy view scans on some environments.
                    useOrder = false;
                    pageSize = 100;
                    maxRows = 3000;
                    firstPage = await fetchProfilesPage(0, pageSize, useOrder);
                }
            }
            if (firstPage.length) {
                state.customers = firstPage;
            }
            applyPriorityFlagsToCustomers_();
            if (state.customers.length) saveCustomerCache_(state.customers);
            try {
                await fetchActiveReps_();
            } catch (repErr) {
                console.error("Active reps fetch failed:", repErr);
                state.reps = [];
            }
            renderAssignRepControls_(root);
            sortProfilesByScore(state.customers);
            syncChipButtons_(root);
            updateCustomerSortIndicators(root);
            applyFilters(root, "");

            if (!flaggedBootstrap) {
                hydrateProfilesInBackground(root, pageSize, pageSize, maxRows, useOrder).catch(function(err) {
                    console.error("Background profile hydration failed:", err);
                });
            }

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
                var clickedChip = normalizeChip_(chipBtn.getAttribute("data-chip") || "all");
                if (clickedChip === state.activeChip) {
                    state.activeChip = state.defaultChip || "all";
                } else {
                    state.activeChip = clickedChip;
                }
                syncChipButtons_(root);
                var q = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
                applyFilters(root, q);
                return;
            }

            var customerSortEl = e.target.closest("[data-sort-customer], [data-sort]");
            if (customerSortEl) {
                var ckey = String(
                    customerSortEl.getAttribute("data-sort-customer") ||
                    customerSortEl.getAttribute("data-sort") ||
                    ""
                ).trim();
                var isCustomerSortKey =
                    ckey === "customer_name" ||
                    ckey === "webshop_active" ||
                    ckey === "customer_id" ||
                    ckey === "low_hanging_fruit_score" ||
                    ckey === "assigned_rep_name_norm";
                if (isCustomerSortKey) {
                    e.preventDefault();
                    if (state.customerSortKey === ckey) {
                        state.customerSortDir = state.customerSortDir === "asc" ? "desc" : "asc";
                    } else {
                        state.customerSortKey = ckey;
                        state.customerSortDir = (ckey === "customer_name" || ckey === "customer_id" || ckey === "assigned_rep_name_norm") ? "asc" : "desc";
                    }
                    var qsort = (root.querySelector('[data-input="customer-search"]') || {}).value || "";
                    applyFilters(root, qsort);
                    return;
                }
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
                if (doneMsgEl) doneMsgEl.textContent = "Verkefni lokað.";
                showActionToast_("Verkefni lokað.", "success");

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
                showActionToast_("Verkefni stofnað.", "success");
                return;
            }

            var setPriority = e.target.closest('[data-action="set-priority"]');
            if (setPriority) {
                e.preventDefault();
                try {
                    await setSelectedPriorityStatus_(root, "priority");
                } catch (priorityErr) {
                    console.error(priorityErr);
                    setPriorityFeedback_(root, "Villa við að vista forgang.");
                    showActionToast_("Villa við að vista forgang.", "error");
                }
                return;
            }

            var setNonPriority = e.target.closest('[data-action="set-nonpriority"]');
            if (setNonPriority) {
                e.preventDefault();
                try {
                    await setSelectedPriorityStatus_(root, "nonpriority");
                } catch (nonPriorityErr) {
                    console.error(nonPriorityErr);
                    setPriorityFeedback_(root, "Villa við að vista stöðu.");
                    showActionToast_("Villa við að vista stöðu.", "error");
                }
                return;
            }

            var assignRep = e.target.closest('[data-action="assign-rep"]');
            if (assignRep) {
                e.preventDefault();
                var rep = String(assignRep.getAttribute("data-rep") || "").trim().toLowerCase();
                if (!rep) {
                    var sel = root.querySelector('[data-input="assign-rep"]');
                    rep = String(sel && sel.value || "").trim().toLowerCase();
                }
                try {
                    await assignSelectedRep_(root, rep);
                } catch (assignErr) {
                    console.error(assignErr);
                    setPriorityFeedback_(root, "Villa við að tengja sölumann.");
                    showActionToast_("Villa við að tengja sölumann.", "error");
                }
                return;
            }

            var clearRep = e.target.closest('[data-action="clear-assigned-rep"]');
            if (clearRep) {
                e.preventDefault();
                try {
                    await assignSelectedRep_(root, "");
                } catch (clearErr) {
                    console.error(clearErr);
                    setPriorityFeedback_(root, "Villa við að aftengja sölumann.");
                    showActionToast_("Villa við að aftengja sölumann.", "error");
                }
                return;
            }

            var open = e.target.closest('[data-action="open-profile"]');
            if (open) {
                e.preventDefault();
                var id = open.getAttribute("data-customer-id");
                var selectedRaw = state.customers.find(function(c) { return String(c.customer_id) === String(id); }) || null;
                state.selected = buildSelectedProfile(selectedRaw, state.customers, state.profileScope);

                if (state.profileScope !== "child") {
                    try {
                        var familySummary = await fetchFamilyProfileSummary(selectedRaw && selectedRaw.customer_id);
                        if (familySummary) {
                            state.selected = Object.assign({}, state.selected || {}, familySummary, {
                                _queryCustomerId: String(
                                    (state.selected && state.selected._queryCustomerId) ||
                                    (selectedRaw && selectedRaw.customer_id) ||
                                    (familySummary && familySummary.customer_id) ||
                                    ""
                                ).trim()
                            });
                        }
                    } catch (familyErr) {
                        console.error(familyErr);
                    }
                }

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
                    var orders = await fetchLastOrders(state.selected.customer_id, 5);
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
        } finally {
            setModuleLoading_(root, false);
            document.dispatchEvent(new CustomEvent("storkaup:page-ready"));
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function() { init().catch(console.error); });
    } else {
        init().catch(console.error);
    }
})();


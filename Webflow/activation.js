/*
 * Web Activation view — fresh, BC-free funnel for driving web adoption.
 *
 * Self-rendering: drop a single container on the page and load this script.
 *   <div data-module="web-activation"></div>
 *
 * Reuses the existing STORKAUP_CONFIG bootstrap, the priority-flag / rep-assign
 * RPCs, the GAS web-app email flow, and the dashboard CSS classes (funnelchip,
 * cp-chip, cp-row, cp-cachehelp__*) so it matches the Forgangslisti look without
 * cloning that page.
 *
 * Data source: api.get_web_activation() + api.web_activation_kpis() (see
 * core/sql/web_activation.sql). These read ONLY fresh tables (Magento web
 * accounts + web orders), never frozen BC.
 */
(function() {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    var cfg = window.STORKAUP_CONFIG || {};
    var URL = cfg.supabaseUrl;
    var KEY = cfg.publishableKey;
    if (!URL || !KEY) return console.error("[activation] Missing STORKAUP_CONFIG");

    var MAX_RENDERED = 800;

    // never_ordered + lapsing + lapsed are the actionable targets; active/activating
    // shown for context. Order drives chip order.
    var STATES = [
        { key: "never_ordered", label: "Aldrei pantað" },
        { key: "lapsing",       label: "Að dofna" },
        { key: "lapsed",        label: "Dottinn út" },
        { key: "activating",    label: "Að virkjast" },
        { key: "active",        label: "Virkur" }
    ];
    var STATE_LABEL = STATES.reduce(function(m, s) { m[s.key] = s.label; return m; }, {});

    var state = {
        rows: [],            // rows for the currently active state only (per-state fetch)
        rowsByState: {},     // cache: stateKey -> rows[]
        counts: {},          // server-side per-state counts (not truncated)
        kpis: null,
        reps: [],
        activeState: "never_ordered",
        selectedKey: null
    };

    // ----- shared helpers (mirror customer-profiles.js) -----------------------
    function headers(profile) {
        var h = { apikey: KEY, Authorization: "Bearer " + KEY };
        if (profile) h["Accept-Profile"] = profile;
        return h;
    }

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function fmtInt(v) {
        var n = Number(v);
        return isNaN(n) ? "-" : String(Math.round(n));
    }

    function fmtDays(v) {
        if (v === null || v === undefined || v === "") return "-";
        var n = Number(v);
        if (isNaN(n)) return "-";
        return n + " d";
    }

    async function rpc(fn, body, profile) {
        var res = await fetch(URL + "/rest/v1/rpc/" + fn, {
            method: "POST",
            headers: Object.assign(
                { "Content-Type": "application/json" },
                headers(profile || "api"),
                { "Content-Profile": profile || "api" }
            ),
            body: JSON.stringify(body || {}),
            cache: "no-store"
        });
        if (!res.ok) throw new Error(fn + ": " + (await res.text()));
        return await res.json();
    }

    // text/plain avoids a CORS preflight; key attached server-side-style.
    async function gasPost(payload) {
        var gasUrl = cfg.gasWebAppUrl;
        if (!gasUrl) throw new Error("missing gasWebAppUrl");
        payload.key = cfg.gasKey || "";
        var res = await fetch(gasUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            redirect: "follow",
            body: JSON.stringify(payload)
        });
        return await res.json();
    }

    // ----- data ---------------------------------------------------------------
    // Counts + KPIs come from server-side aggregates (no 1000-row cap). The list
    // is fetched ONE STATE AT A TIME so each response stays well under the cap.
    async function loadAggregates() {
        var out = await Promise.all([
            rpc("web_activation_state_counts", { p_only_with_account: true }).catch(function() { return []; }),
            rpc("web_activation_kpis", {}).catch(function() { return []; }),
            rpc("get_active_sales_reps", {}).catch(function() { return []; })
        ]);
        var counts = {};
        (Array.isArray(out[0]) ? out[0] : []).forEach(function(c) { counts[c.state] = Number(c.n) || 0; });
        state.counts = counts;
        state.kpis = (Array.isArray(out[1]) && out[1][0]) || null;
        state.reps = Array.isArray(out[2]) ? out[2] : [];
    }

    async function loadState(stateKey) {
        if (state.rowsByState[stateKey]) {
            state.rows = state.rowsByState[stateKey];
            return;
        }
        var rows = await rpc("get_web_activation", { p_only_with_account: true, p_states: [stateKey] });
        rows = Array.isArray(rows) ? rows : [];
        state.rowsByState[stateKey] = rows;
        state.rows = rows;
    }

    // ----- render -------------------------------------------------------------
    function kpiCard(label, value) {
        return '<div class="funnelchip">'
            + '<div class="text-size-tiny text-weight-normal">' + esc(label) + '</div>'
            + '<div>' + esc(value == null ? "-" : value) + '</div>'
            + '</div>';
    }

    function renderKpis(root) {
        var k = state.kpis || {};
        var c = state.counts || {};
        var wrap = root.querySelector("[data-act-kpis]");
        if (!wrap) return;
        // never/lapsing/lapsed mirror the chip counts exactly (same population);
        // web-active + new-this-month are the extra leading indicators.
        wrap.innerHTML =
            kpiCard("Aldrei pantað", fmtInt(c.never_ordered)) +
            kpiCard("Að dofna", fmtInt(c.lapsing)) +
            kpiCard("Dottinn út", fmtInt(c.lapsed)) +
            kpiCard("Vef-virkir (90d)", fmtInt(k.web_active_90d)) +
            kpiCard("Nýir í mánuðinum", fmtInt(k.new_web_customers_mtd));
    }

    function renderChips(root) {
        var wrap = root.querySelector("[data-act-chips]");
        if (!wrap) return;
        wrap.innerHTML = STATES.map(function(s) {
            var on = s.key === state.activeState;
            return '<a href="#" data-act-chip="' + s.key + '" class="cp-chip"'
                + (on ? ' data-active="1" style="font-weight:600"' : '') + '>'
                + '<div>' + esc(s.label) + ' (' + (state.counts[s.key] || 0) + ')</div></a>';
        }).join("");
    }

    function repOptions(selected) {
        var sel = String(selected || "").toLowerCase();
        var opts = '<option value="">— Velja sölumann —</option>';
        opts += state.reps.map(function(r) {
            var n = String(r.name_norm || "").toLowerCase();
            if (!n) return "";
            return '<option value="' + esc(n) + '"' + (n === sel ? " selected" : "") + '>' + esc(r.name_norm) + '</option>';
        }).join("");
        return opts;
    }

    function rowHtml(r) {
        var isSel = r.customer_key === state.selectedKey;
        var rep = r.assigned_rep_name_norm || "-";
        var prio = r.priority_status === "priority" ? "Forgangur"
                 : (r.priority_status === "nonpriority" ? "Ekki forgangur" : "-");
        var html = '<div class="cp-row cp-row-prioritylist" data-act-row="' + esc(r.customer_key) + '">'
            + '<div class="flex gap--5rem">'
            +   '<a href="#" data-act-open="' + esc(r.customer_key) + '" class="cp-action-btn w-inline-block">'
            +     '<div class="text-size-tiny">' + (isSel ? "▾" : "▸") + '</div></a>'
            +   '<div class="text-size-tiny">' + esc(r.company_name || r.customer_key) + '</div>'
            + '</div>'
            + '<div class="flex"><div class="text-size-tiny text-weight-normal">' + esc(r.customer_key) + '</div></div>'
            + '<div class="flex"><div class="text-size-tiny text-weight-normal">' + esc(STATE_LABEL[r.state] || r.state) + '</div></div>'
            + '<div class="flex"><div class="text-size-tiny text-weight-normal">' + fmtInt(r.web_orders_count) + '</div></div>'
            + '<div class="flex"><div class="text-size-tiny text-weight-normal">' + fmtDays(r.days_since_last_order) + '</div></div>'
            + '<div class="flex"><div class="text-size-tiny text-weight-normal">' + esc(prio) + '</div></div>'
            + '<div class="flex"><div class="text-size-tiny text-weight-normal">' + esc(rep) + '</div></div>'
            + '</div>';
        if (isSel) html += actionPanelHtml(r);
        return html;
    }

    function actionPanelHtml(r) {
        var inForgang = r.priority_status === "priority";
        return '<div class="cp-row" data-act-panel="' + esc(r.customer_key) + '" style="background:#f7f7fb;display:block;padding:12px 16px">'
            + '<div class="flex gap--5rem" style="flex-wrap:wrap;align-items:center">'
            +   '<button type="button" data-act="flag" class="cp-cachehelp__btn cp-cachehelp__btn--is">'
            +     (inForgang ? "Úr forgangi −" : "Í forgang +") + '</button>'
            +   '<select data-act="rep" class="cp-cachehelp__select" style="max-width:220px">' + repOptions(r.assigned_rep_name_norm) + '</select>'
            +   '<button type="button" data-act="email" class="cp-cachehelp__btn cp-cachehelp__btn--is">Senda onboarding-póst</button>'
            + '</div>'
            + '<div data-act-feedback class="text-size-tiny" style="margin-top:6px;color:#555"></div>'
            + '<div data-cache-help-panel style="margin-top:8px"></div>'
            + '</div>';
    }

    function renderList(root) {
        var list = root.querySelector("[data-act-list]");
        if (!list) return;
        var rows = state.rows.slice(); // already the active state (per-state fetch)
        // never_ordered has no order recency; others sort by most-recently-quiet.
        rows.sort(function(a, b) {
            return (b.days_since_last_order || 0) - (a.days_since_last_order || 0)
                || String(a.company_name || "").localeCompare(String(b.company_name || ""));
        });
        var shown = rows.slice(0, MAX_RENDERED);
        var note = rows.length > shown.length
            ? '<div class="text-size-tiny" style="padding:8px 16px;color:#888">Sýni ' + shown.length + ' af ' + rows.length + ' — þrengdu með leit/flokki.</div>'
            : "";
        list.innerHTML = note + shown.map(rowHtml).join("");
    }

    function rowByKey(key) {
        for (var i = 0; i < state.rows.length; i++) {
            if (state.rows[i].customer_key === key) return state.rows[i];
        }
        return null;
    }

    function feedback(root, key, msg) {
        var panel = root.querySelector('[data-act-panel="' + cssEsc(key) + '"]');
        var el = panel && panel.querySelector("[data-act-feedback]");
        if (el) el.textContent = msg || "";
    }

    function cssEsc(s) {
        return String(s).replace(/["\\]/g, "\\$&");
    }

    // ----- actions ------------------------------------------------------------
    async function toggleFlag(root, r) {
        var newStatus = r.priority_status === "priority" ? "nonpriority" : "priority";
        feedback(root, r.customer_key, "Vista…");
        try {
            await rpc("set_customer_priority_flag", {
                p_customer_id: r.customer_key,
                p_status: newStatus,
                p_customer_name: r.company_name || null,
                p_note: null
            });
            r.priority_status = newStatus;
            renderList(root);
            feedback(root, r.customer_key, newStatus === "priority" ? "Sett í forgang." : "Tekið úr forgangi.");
        } catch (e) {
            console.error(e);
            feedback(root, r.customer_key, "Villa við vistun.");
        }
    }

    async function assignRep(root, r, repNorm) {
        feedback(root, r.customer_key, "Vista…");
        var payload = { p_customer_id: r.customer_key, p_assigned_rep_name_norm: String(repNorm || "").toLowerCase() };
        try {
            try {
                await rpc("assign_customer_priority_rep", payload);
            } catch (firstErr) {
                // No flag row yet — bootstrap one into forgang, then retry.
                if (String(firstErr.message || "").toLowerCase().indexOf("not found") !== -1) {
                    await rpc("set_customer_priority_flag", {
                        p_customer_id: r.customer_key, p_status: "priority",
                        p_customer_name: r.company_name || null, p_note: null
                    });
                    r.priority_status = "priority";
                    await rpc("assign_customer_priority_rep", payload);
                } else { throw firstErr; }
            }
            r.assigned_rep_name_norm = String(repNorm || "").toLowerCase() || null;
            renderList(root);
            feedback(root, r.customer_key, repNorm ? "Sölumaður tengdur." : "Sölumaður aftengdur.");
        } catch (e) {
            console.error(e);
            feedback(root, r.customer_key, "Villa við tengingu sölumanns.");
        }
    }

    async function openEmail(root, r) {
        var panel = root.querySelector('[data-act-panel="' + cssEsc(r.customer_key) + '"]');
        var box = panel && panel.querySelector("[data-cache-help-panel]");
        if (!box) return;
        if (box.getAttribute("data-open") === "1") {
            box.style.display = "none"; box.setAttribute("data-open", "0"); box.innerHTML = ""; return;
        }
        if (!cfg.gasWebAppUrl) { feedback(root, r.customer_key, "Tölvupóstur ekki uppsettur (vantar gasWebAppUrl)."); return; }
        box.style.display = "block"; box.setAttribute("data-open", "1");
        box.innerHTML = '<div class="cp-cachehelp__msg">Sæki gögn…</div>';
        try {
            var out = await Promise.all([
                gasPost({ action: "list_templates" }),
                gasPost({ action: "list_recipients", customer_id: r.customer_key })
            ]);
            var tmplOut = out[0], usersOut = out[1];
            if (!tmplOut || tmplOut.error || !usersOut || usersOut.error) {
                box.innerHTML = '<div class="cp-cachehelp__msg cp-cachehelp__msg--error">Villa: '
                    + esc((tmplOut && tmplOut.error) || (usersOut && usersOut.error) || "óþekkt") + '</div>';
                return;
            }
            var templates = tmplOut.templates || [], users = usersOut.users || [];
            if (!templates.length) { box.innerHTML = '<div class="cp-cachehelp__msg cp-cachehelp__msg--error">Engin template skilgreind.</div>'; return; }
            if (!users.length) { box.innerHTML = '<div class="cp-cachehelp__msg cp-cachehelp__msg--error">Ekkert netfang skráð.</div>'; return; }
            box.innerHTML = emailPanelHtml(templates, users);
            wireEmailPanel(box, r);
        } catch (e) {
            console.error(e);
            box.innerHTML = '<div class="cp-cachehelp__msg cp-cachehelp__msg--error">Náði ekki í gögn (net).</div>';
        }
    }

    function langOptions(langs, selected) {
        return (langs && langs.length ? langs : ["is"]).map(function(l) {
            var label = l === "en" ? "Enska" : (l === "is" ? "Íslenska" : l);
            return '<option value="' + esc(l) + '"' + (l === selected ? " selected" : "") + '>' + label + '</option>';
        }).join("");
    }

    function emailPanelHtml(templates, users) {
        var tmplOpts = templates.map(function(t) {
            return '<option value="' + esc(t.id) + '" data-langs="' + esc((t.langs || []).join(",")) + '">' + esc(t.label) + '</option>';
        }).join("");
        var firstLangs = (templates[0] && templates[0].langs) || ["is"];
        var rows = users.map(function(u) {
            var name = u.name || "(nafnlaus)", email = u.email || "";
            return '<div class="cp-cachehelp__row">'
                + '<div class="cp-cachehelp__who"><div class="cp-cachehelp__name">' + esc(name) + '</div>'
                + '<div class="cp-cachehelp__email">' + esc(email) + '</div></div>'
                + '<div class="cp-cachehelp__actions"><button type="button" data-email-send'
                + ' data-email="' + esc(email) + '" data-name="' + esc(name) + '" class="cp-cachehelp__btn cp-cachehelp__btn--is">Senda</button></div></div>';
        }).join("");
        return '<div class="cp-cachehelp__box">'
            + '<div class="cp-cachehelp__head">Senda onboarding-póst</div>'
            + '<div class="cp-cachehelp__controls">'
            +   '<label class="cp-cachehelp__field"><span>Template</span><select data-email-template class="cp-cachehelp__select">' + tmplOpts + '</select></label>'
            +   '<label class="cp-cachehelp__field"><span>Tungumál</span><select data-email-lang class="cp-cachehelp__select">' + langOptions(firstLangs, firstLangs[0]) + '</select></label>'
            + '</div>'
            + '<div data-email-rows class="cp-cachehelp__rows">' + rows + '</div></div>';
    }

    function wireEmailPanel(box, r) {
        var tmplSel = box.querySelector("[data-email-template]");
        var langSel = box.querySelector("[data-email-lang]");
        if (tmplSel && langSel) {
            tmplSel.addEventListener("change", function() {
                var opt = this.options[this.selectedIndex];
                var langs = String(opt && opt.getAttribute("data-langs") || "is").split(",").filter(Boolean);
                langSel.innerHTML = langOptions(langs, langs[0]);
            });
        }
        box.querySelectorAll("[data-email-send]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                sendEmail(box, r, btn.getAttribute("data-email"), btn.getAttribute("data-name"));
            });
        });
    }

    async function sendEmail(box, r, email, name) {
        email = String(email || "").trim();
        if (!email) return;
        var template = (box.querySelector("[data-email-template]") || {}).value || "";
        var lang = (box.querySelector("[data-email-lang]") || {}).value || "is";
        var tsel = box.querySelector("[data-email-template]");
        var tlabel = tsel ? (tsel.options[tsel.selectedIndex] || {}).text || template : template;
        if (!template) return;
        if (!window.confirm('Senda "' + tlabel + '" (' + lang.toUpperCase() + ") á:\n" + (name ? name + " " : "") + "<" + email + "> ?")) return;
        try {
            var out = await gasPost({ action: "send_template_email", template: template, customer_id: r.customer_key, to: email, lang: lang });
            var msg = (out && out.ok) ? "Sent á " + out.sentTo
                : (out && out.error === "recipient_not_in_customer") ? "Netfang tilheyrir ekki þessum viðskiptavin."
                : "Sending mistókst" + (out && out.error ? ": " + out.error : "") + ".";
            window.alert(msg);
        } catch (e) {
            console.error(e);
            window.alert("Sending mistókst (net).");
        }
    }

    // ----- events -------------------------------------------------------------
    function wire(root) {
        root.addEventListener("click", function(ev) {
            var chip = ev.target.closest("[data-act-chip]");
            if (chip) {
                ev.preventDefault();
                state.activeState = chip.getAttribute("data-act-chip");
                state.selectedKey = null;
                renderChips(root);
                var listEl = root.querySelector("[data-act-list]");
                if (listEl) listEl.innerHTML = '<div class="text-size-tiny" style="padding:16px;color:#888">Sæki…</div>';
                loadState(state.activeState).then(function() { renderList(root); }).catch(function(e) {
                    console.error("[activation]", e);
                    if (listEl) listEl.innerHTML = '<div class="text-size-tiny" style="padding:16px;color:#c23340">Náði ekki í lista.</div>';
                });
                return;
            }
            var open = ev.target.closest("[data-act-open]");
            if (open) {
                ev.preventDefault();
                var key = open.getAttribute("data-act-open");
                state.selectedKey = (state.selectedKey === key) ? null : key;
                renderList(root);
                return;
            }
            var actBtn = ev.target.closest("[data-act]");
            if (actBtn) {
                var rowEl = actBtn.closest("[data-act-panel]");
                var rkey = rowEl && rowEl.getAttribute("data-act-panel");
                var r = rkey && rowByKey(rkey);
                if (!r) return;
                var kind = actBtn.getAttribute("data-act");
                if (kind === "flag") toggleFlag(root, r);
                else if (kind === "email") openEmail(root, r);
                return;
            }
        });
        root.addEventListener("change", function(ev) {
            var repSel = ev.target.closest('[data-act="rep"]');
            if (!repSel) return;
            var rowEl = repSel.closest("[data-act-panel]");
            var rkey = rowEl && rowEl.getAttribute("data-act-panel");
            var r = rkey && rowByKey(rkey);
            if (r) assignRep(root, r, repSel.value);
        });
    }

    function shell() {
        return ''
            + '<h1 class="cp-heading">Virkjun á vef</h1>'
            + '<div class="cp-chips" data-act-kpis></div>'
            + '<div class="cp-chips" data-act-chips></div>'
            + '<div class="cp-list extended" data-act-list></div>';
    }

    // ----- init ---------------------------------------------------------------
    async function init() {
        var root = document.querySelector('[data-module="web-activation"]');
        if (!root) return;
        root.innerHTML = shell();
        wire(root);
        root.setAttribute("aria-busy", "true");
        try {
            await loadAggregates();
            renderKpis(root);
            renderChips(root);
            await loadState(state.activeState);
            renderList(root);
        } catch (e) {
            console.error("[activation]", e);
            var list = root.querySelector("[data-act-list]");
            if (list) list.innerHTML = '<div class="text-size-tiny" style="padding:16px;color:#c23340">Náði ekki í activation-gögn.</div>';
        } finally {
            root.setAttribute("aria-busy", "false");
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

/**
 * Webflow/portal.js — vöruportalinn á /kpi/voruportal
 *
 * Ein vara, fjórar spurningar: hver er hún, hvernig selst hún, hvað er
 * hún tengd, og er innihaldið í lagi. Lesportal — engar aðgerðir. Þegar
 * eitthvað þarf að laga er tengt í tólið sem lagar það.
 *
 * Hledst ur jsDelivr inn i Webflow/portal-embed.html. Sú skel ber ekkert
 * nema festingu og script-tag; markup OG STÍLAR eru smíðaðir hér. Það er
 * vegna 10.000 stafa marks Webflow-Embed, sem skar uppflettinguna
 * þegjandi í miðju kafi. Skel sem ber engan stíl getur ekki vaxið.
 *
 * ── FJÖGUR KÖLL, EKKI EITT ──────────────────────────────────────────
 * Hausinn kemur úr get_product_overview_v1, tengslin úr
 * get_product_relations_v1, hreyfingarnar úr get_product_buyers og
 * get_product_transactions. Hvert kall skilar í sinn panel og hver
 * panel fellur fyrir sig.
 *
 * Það er ekki tilviljun heldur regla hússins: Webflow-síða verður að
 * standa þótt aukafyrirspurn bregðist. Sölufyrirspurnirnar tvær eru þær
 * þyngstu og þær sem féllu á 8 sek þakinu fyrr í dag — hausinn og
 * tengslin eiga ekki að hverfa með þeim.
 *
 * ── SKU SEM KEMUR TIL BAKA, EKKI ÞAÐ SEM VAR SLEGIÐ INN ─────────────
 * Notandinn má slá inn 1015, 01015, STO_01015_STK eða birgjanúmer.
 * Uppflettingin fyrirgefur allt það. En hreyfingafyrirspurnirnar bera
 * saman við bc_lines_raw STAFRÉTT, svo þær verða að fá BC-formið sem
 * overview-kallið skilar. Að senda innsláttinn áfram er villan sem
 * kostaði 2.036 BC-línur fyrr í dag, í öðrum búningi.
 */
(function () {
  "use strict";

  var CSS = [
    '#sk-portal{font-family:Arial,Helvetica,sans-serif;color:#1a1a1f}',
    '#sk-portal *{box-sizing:border-box}',
    '.skp-search{position:relative;margin-bottom:18px}',
    '.skp-search input{width:100%;padding:12px 14px;font-size:15px;border:1px solid #e3e3e8;border-radius:8px}',
    '.skp-res{position:absolute;z-index:20;left:0;right:0;top:100%;background:#fff;border:1px solid #e3e3e8;',
    'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.10);max-height:340px;overflow:auto;margin-top:4px}',
    '.skp-res button{display:block;width:100%;text-align:left;border:0;background:none;padding:9px 14px;',
    'font-size:13px;cursor:pointer;border-bottom:1px solid #f0f0f3}',
    '.skp-res button:hover{background:#f7f7f9}',
    '.skp-res .skp-sku{font-family:ui-monospace,Menlo,Consolas,monospace;color:#5c5c63;margin-right:8px}',
    '.skp-card{border:1px solid #e3e3e8;border-radius:10px;padding:18px 20px;margin-bottom:16px;background:#fff}',
    '.skp-card h3{margin:0 0 12px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5c5c63}',
    '.skp-title{font-size:20px;font-weight:700;margin:0 0 6px}',
    '.skp-meta{font-size:13px;color:#5c5c63;margin:0 0 10px}',
    '.skp-meta code{font-family:ui-monospace,Menlo,Consolas,monospace}',
    '.skp-tag{display:inline-block;padding:3px 9px;border-radius:11px;font-size:11px;font-weight:700;margin-right:6px}',
    '.skp-ok{background:#e4f3e7;color:#1c6b32}.skp-warn{background:#fff3c4;color:#6b5600}',
    '.skp-bad{background:#fce8e6;color:#8a1c12}.skp-mute{background:#f0f0f3;color:#5c5c63}',
    '.skp-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
    '@media(max-width:900px){.skp-grid{grid-template-columns:1fr}}',
    '.skp-tbl{width:100%;border-collapse:collapse;font-size:13px}',
    '.skp-tbl th{text-align:left;padding:7px 9px;border-bottom:2px solid #e3e3e8;font-size:11px;',
    'letter-spacing:.04em;text-transform:uppercase;color:#5c5c63;font-weight:700}',
    '.skp-tbl td{padding:7px 9px;border-bottom:1px solid #f0f0f3;vertical-align:top}',
    '.skp-num{text-align:right;white-space:nowrap}',
    '.skp-mono{font-family:ui-monospace,Menlo,Consolas,monospace}',
    '.skp-dim{color:#5c5c63}',
    '.skp-dead td{background:#fce8e6}',
    '.skp-note{font-size:12px;color:#5c5c63;margin:10px 0 0}',
    '.skp-err{font-size:13px;color:#8a1c12;background:#fce8e6;padding:9px 11px;border-radius:6px}',
    '.skp-empty{font-size:13px;color:#5c5c63;font-style:italic}',
    'a.skp-link{color:#10069f;text-decoration:none}a.skp-link:hover{text-decoration:underline}'
  ].join('');

  var DAGAR_HREYFINGAR = 365;
  var FAERSLUR = 25;

  function boot() {
    var root = document.getElementById("sk-portal");
    if (!root) return;

    var cfg = window.STORKAUP_CONFIG || {};
    var URL_BASE = cfg.supabaseUrl;
    var KEY = cfg.publishableKey;

    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    if (!URL_BASE || !KEY) {
      root.innerHTML = "";
      root.appendChild(el("p", "skp-err",
        "Uppsetning vantar: STORKAUP_CONFIG.supabaseUrl / publishableKey á þessari síðu."));
      return;
    }

    root.innerHTML = "";
    var search = buildSearch(root);
    var panels = buildPanels(root);

    // Djuptengill: /kpi/voruportal?sku=114112 opnar voruna beint. Thad er
    // thad sem leyfir top-products og uppflettingunni ad senda folk hingad
    // i stad thess ad endurtaka panelana.
    var initial = new URLSearchParams(window.location.search).get("sku");
    if (initial) {
      search.input.value = initial;
      loadProduct(initial);
    }

    // ---------------------------------------------------------------
    function api(fn, body) {
      return fetch(URL_BASE + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: KEY, Authorization: "Bearer " + KEY,
                   "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (res.ok) return res.json();
        // Postgres-villan liggur i svarbolnum. Ad kasta bara stodunni
        // gerdi 500 ad radgatu fyrr i dag.
        return res.text().then(function (t) {
          var m = "HTTP " + res.status;
          try { var j = JSON.parse(t); if (j && j.message) m += " — " + j.message; }
          catch (e) { if (t) m += " — " + t.slice(0, 200); }
          throw new Error(m);
        });
      });
    }

    var timer = null;
    search.input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = search.input.value.trim();
      if (q.length < 2) { search.results.innerHTML = ""; return; }
      timer = setTimeout(function () {
        // search_web_catalog_v1, EKKI search_products. Su sidari leitar i
        // bc_lines_raw yfir 365 daga og fellur a statement_timeout vid
        // lyklabordsleit — maelt i framleidslu 2026-09-21. Leitarreitur i
        // voruportali a ad finna VORU; vorulistinn er 4.474 radir og
        // snertir soluognin aldrei.
        api("search_web_catalog_v1", { p_query: q, p_limit: 20 })
          .then(renderResults)
          .catch(function (err) {
            search.results.innerHTML = "";
            search.results.appendChild(el("div", "skp-err", "Leit brást: " + err.message));
          });
      }, 300);
    });

    document.addEventListener("click", function (e) {
      if (!search.wrap.contains(e.target)) search.results.innerHTML = "";
    });

    function renderResults(rows) {
      search.results.innerHTML = "";
      if (!rows || !rows.length) {
        search.results.appendChild(el("div", "skp-empty", "Ekkert fannst."));
        return;
      }
      rows.forEach(function (r) {
        var b = document.createElement("button");
        b.type = "button";
        var s = document.createElement("span");
        s.className = "skp-sku";
        s.textContent = r.sku || "";
        b.appendChild(s);
        b.appendChild(document.createTextNode(r.product_name || ""));
        var extra = [];
        if (r.brand_name) extra.push(r.brand_name);
        if (r.brand_sku)  extra.push("birgjanr. " + r.brand_sku);
        if (r.match_kind && r.match_kind !== "heiti") extra.push("↳ " + r.match_kind);
        if (extra.length) {
          var t = document.createElement("span");
          t.className = "skp-dim";
          t.textContent = "  · " + extra.join(" · ");
          b.appendChild(t);
        }
        b.addEventListener("click", function () {
          search.results.innerHTML = "";
          loadProduct(r.sku);
        });
        search.results.appendChild(b);
      });
    }

    function loadProduct(sku) {
      panels.head.innerHTML = "";
      panels.head.appendChild(el("p", "skp-empty", "Sæki…"));
      panels.rel.innerHTML = "";
      panels.mov.innerHTML = "";

      api("get_product_overview_v1", { p_sku: sku })
        .then(function (rows) {
          if (!rows || !rows.length) {
            panels.head.innerHTML = "";
            panels.head.appendChild(el("p", "skp-err",
              "„" + sku + "“ fannst ekki í vörulistanum á vefnum."));
            return null;
          }
          renderHead(rows);
          // BC-FORMID sem kom til baka, ekki innslatturinn. Sja hausinn.
          return rows[0].sku;
        })
        .then(function (bcSku) {
          if (!bcSku) return;
          loadRelations(bcSku);
          loadMovements(bcSku);
        })
        .catch(function (err) {
          panels.head.innerHTML = "";
          panels.head.appendChild(el("p", "skp-err", "Villa: " + err.message));
        });
    }

    function renderHead(rows) {
      var p = rows[0];
      var h = panels.head;
      h.innerHTML = "";

      h.appendChild(el("p", "skp-title", p.product_name || p.sku));

      var meta = el("p", "skp-meta", "");
      meta.appendChild(txt("SKU "));
      meta.appendChild(code(p.sku));
      if (p.brand_sku) { meta.appendChild(txt(" · birgjanr. ")); meta.appendChild(code(p.brand_sku)); }
      if (p.brand_name) meta.appendChild(txt(" · " + p.brand_name));
      if (rows.length > 1) {
        meta.appendChild(txt(" · " + rows.length + " sölueiningar: " +
          rows.map(function (r) { return r.web_sku; }).join(", ")));
      }
      h.appendChild(meta);

      h.appendChild(contentTag(p));
      if (p.product_url) {
        var a = document.createElement("a");
        a.className = "skp-link";
        a.href = p.product_url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Opna á storkaup.is ↗";
        h.appendChild(a);
      }

      h.appendChild(el("p", "skp-note",
        "Vefgögn samstillt " + String(p.synced_at || "").replace("T", " ").slice(0, 16) +
        " (á 12 klst. fresti). Vara sem fór á vefinn eftir þann tíma finnst ekki hér."));
    }

    function contentTag(p) {
      var wrap = el("div", "", "");
      var map = {
        "engin":  ["skp-bad",  "Engin lýsing"],
        "heiti":  ["skp-bad",  "Lýsing er bara vöruheitið"],
        "stutt":  ["skp-warn", "Stutt lýsing (" + p.description_length + " stafir)"],
        "i-lagi": ["skp-ok",   "Lýsing " + p.description_length + " stafir"]
      };
      var m = map[p.content_flag] || ["skp-mute", "Innihaldsstaða óþekkt"];
      var s = el("span", "skp-tag " + m[0], m[1]);
      wrap.appendChild(s);
      if (p.content_flag === "engin" || p.content_flag === "heiti") {
        wrap.appendChild(el("span", "skp-dim",
          " — laga í vöruinnihald-appinu"));
      }
      return wrap;
    }

    function loadRelations(sku) {
      panels.rel.appendChild(el("p", "skp-empty", "Sæki tengsl…"));
      api("get_product_relations_v1", { p_sku: sku })
        .then(function (rows) { renderRelations(rows || []); })
        .catch(function (err) {
          panels.rel.innerHTML = "";
          panels.rel.appendChild(el("div", "skp-err", "Tengsl brugðust: " + err.message));
        });
    }

    function renderRelations(rows) {
      panels.rel.innerHTML = "";
      var live = rows.filter(function (r) { return r.kind === "live"; });
      var sugg = rows.filter(function (r) { return r.kind === "suggested"; });

      panels.rel.appendChild(relTable("Tengt á storkaup.is", live, false));
      panels.rel.appendChild(relTable("Tillögur úr sölugögnum", sugg, true));

      var dead = live.filter(function (r) { return !r.related_on_web; }).length;
      if (dead) {
        panels.rel.appendChild(el("p", "skp-note",
          "⚠️ " + dead + " tengsl vísa á vöru sem er ekki lengur á vefnum — dauður hlekkur."));
      }
    }

    function relTable(title, rows, withScore) {
      var box = el("div", "", "");
      box.appendChild(el("h3", "", title));
      if (!rows.length) {
        box.appendChild(el("p", "skp-empty", "Ekkert."));
        return box;
      }
      var cols = withScore ? ["SKU", "Vara", "Stig", "Rök"] : ["SKU", "Vara", "Vörumerki", ""];
      var t = document.createElement("table");
      t.className = "skp-tbl";
      var thead = document.createElement("tr");
      cols.forEach(function (c) { thead.appendChild(el("th", "", c)); });
      t.appendChild(thead);

      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        if (!r.related_on_web) tr.className = "skp-dead";
        tr.appendChild(el("td", "skp-mono", r.related_sku));
        var nameTd = el("td", "", "");
        if (r.related_on_web && r.related_slug) {
          var a = document.createElement("a");
          a.className = "skp-link";
          a.href = "?sku=" + encodeURIComponent(r.related_sku);
          a.textContent = r.related_name || r.related_sku;
          nameTd.appendChild(a);
        } else {
          nameTd.textContent = r.related_name || "(ekki á vefnum)";
        }
        tr.appendChild(nameTd);
        if (withScore) {
          tr.appendChild(el("td", "skp-num", r.score == null ? "" : String(r.score)));
          tr.appendChild(el("td", "skp-dim", r.reason || ""));
        } else {
          tr.appendChild(el("td", "", r.related_brand || ""));
          tr.appendChild(el("td", "skp-dim", r.related_on_web ? "" : "ekki á vef"));
        }
        t.appendChild(tr);
      });
      box.appendChild(t);
      return box;
    }

    function loadMovements(sku) {
      panels.mov.appendChild(el("p", "skp-empty", "Sæki hreyfingar…"));
      Promise.all([
        api("get_product_buyers", { p_sku: sku, p_days_back: DAGAR_HREYFINGAR })
          .catch(function (e) { return { __err: e.message }; }),
        api("get_product_transactions", { p_sku: sku, p_days_back: DAGAR_HREYFINGAR, p_limit: FAERSLUR })
          .catch(function (e) { return { __err: e.message }; })
      ]).then(function (r) {
        panels.mov.innerHTML = "";
        panels.mov.appendChild(buyersTable(r[0]));
        panels.mov.appendChild(txTable(r[1]));
      });
    }

    function buyersTable(rows) {
      var box = el("div", "", "");
      box.appendChild(el("h3", "", "Viðskiptavinir · 365 dagar"));
      if (rows && rows.__err) { box.appendChild(el("div", "skp-err", rows.__err)); return box; }
      if (!rows || !rows.length) { box.appendChild(el("p", "skp-empty", "Engin sala í glugganum.")); return box; }
      var t = document.createElement("table");
      t.className = "skp-tbl";
      var h = document.createElement("tr");
      ["Viðskiptavinur", "Pantanir", "Magn", "Velta"].forEach(function (c, i) {
        h.appendChild(el("th", i ? "skp-num" : "", c));
      });
      t.appendChild(h);
      rows.slice(0, 15).forEach(function (r) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", "", r.customer_name || r.customer_no || ""));
        tr.appendChild(el("td", "skp-num", fmt(r.orders)));
        tr.appendChild(el("td", "skp-num", fmt(r.qty_total)));
        tr.appendChild(el("td", "skp-num", isk(r.revenue_excl)));
        t.appendChild(tr);
      });
      box.appendChild(t);
      if (rows.length > 15) {
        box.appendChild(el("p", "skp-note", rows.length + " viðskiptavinir alls, 15 efstu sýndir."));
      }
      return box;
    }

    function txTable(rows) {
      var box = el("div", "", "");
      box.appendChild(el("h3", "", "Sölureikningar"));
      if (rows && rows.__err) { box.appendChild(el("div", "skp-err", rows.__err)); return box; }
      if (!rows || !rows.length) { box.appendChild(el("p", "skp-empty", "Engar færslur.")); return box; }
      var t = document.createElement("table");
      t.className = "skp-tbl";
      var h = document.createElement("tr");
      ["Dagsetning", "Reikningur", "Viðskiptavinur", "Magn", "Upphæð"].forEach(function (c, i) {
        h.appendChild(el("th", i > 2 ? "skp-num" : "", c));
      });
      t.appendChild(h);
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        tr.appendChild(el("td", "", String(r.booking_date || "").slice(0, 10)));
        tr.appendChild(el("td", "skp-mono", r.document_no || ""));
        tr.appendChild(el("td", "", r.customer_name || ""));
        tr.appendChild(el("td", "skp-num", fmt(r.qty)));
        tr.appendChild(el("td", "skp-num", isk(r.amount_excl)));
        t.appendChild(tr);
      });
      box.appendChild(t);
      return box;
    }
  }

  // -----------------------------------------------------------------
  function buildSearch(root) {
    var wrap = el("div", "skp-search", "");
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Leitaðu að vöru, SKU eða birgjanúmeri…";
    input.autocomplete = "off";
    var results = el("div", "skp-res", "");
    wrap.appendChild(input);
    wrap.appendChild(results);
    root.appendChild(wrap);
    return { wrap: wrap, input: input, results: results };
  }

  function buildPanels(root) {
    var head = el("div", "skp-card", "");
    root.appendChild(head);
    var grid = el("div", "skp-grid", "");
    var rel = el("div", "skp-card", "");
    var mov = el("div", "skp-card", "");
    grid.appendChild(rel);
    grid.appendChild(mov);
    root.appendChild(grid);
    return { head: head, rel: rel, mov: mov };
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;   // textContent, aldrei innerHTML
    return n;
  }
  function txt(s) { return document.createTextNode(s); }
  function code(s) { var c = document.createElement("code"); c.textContent = s; return c; }
  function fmt(v) { return Number(v || 0).toLocaleString("is-IS", { maximumFractionDigits: 0 }); }
  function isk(v) { return fmt(v) + " kr."; }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

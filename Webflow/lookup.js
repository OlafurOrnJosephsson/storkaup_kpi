/**
 * Webflow/lookup.js — uppflettibunadurinn a /kpi/voruuppfletting
 *
 * Hledst ur jsDelivr inn i Webflow/lookup-embed.html, sem ber markupid
 * og stilana. Skipt i tvennt af hardri astaedu: Webflow-Embed tekur
 * 10.000 stafi og allt i einni skra var 12.517. Webflow skar thad i
 * midju renderResult, svo addEventListener nedst komst aldrei med og
 * einkennid vard "ekkert gerist vid smell". Skelin ein er vel undir
 * markinu og getur ekki vaxid ut fyrir thad.
 *
 * ATH: thessi skra er pinnud i script-src i embedinu med EIGIN commit,
 * ekki gegnum data-storkaup-rev. Hun er ekki barnaskra bootstrappsins.
 * Breytist hun tharf ad faera thann pinna — og EKKI data-storkaup-rev.
 *
 * KREFST:
 *   - public.search_products ur core/sql/search_products_v2.sql
 *   - raw.web_catalog fyllt (syncWebCatalogToSupabase_v1)
 *   - window.STORKAUP_CONFIG.supabaseUrl + .publishableKey, page-scoped
 *     head code — ALDREI site-wide (sbr. CLAUDE.md: Webflow birtir
 *     site-wide head-koda a olaesta lykilordaskjanum lika).
 *
 * Falli RPC-id skrifar bunadurinn villu i sinn eigin reit og snertir
 * ekkert annad a sidunni.
 */
(function () {
  "use strict";

  function boot() {
  var root = document.getElementById("sk-lookup");
  if (!root) return;

  // Fyrsta verk: fela raesivisinn. Kemst kodinn hingad er hann ad keyra,
  // og tha a notandinn ekki ad sja vidvorun um ad hann geri thad ekki.
  var bootEl = document.getElementById("sk-lookup-boot");
  if (bootEl) bootEl.hidden = true;

  var cfg = window.STORKAUP_CONFIG || {};
  var URL_BASE = cfg.supabaseUrl;
  var KEY = cfg.publishableKey;

  var inputEl  = document.getElementById("sk-lookup-input");
  var runEl    = document.getElementById("sk-lookup-run");
  var copyEl   = document.getElementById("sk-lookup-copy");
  var statusEl = document.getElementById("sk-lookup-status");
  var tableEl  = document.getElementById("sk-lookup-table");
  var bodyEl   = document.getElementById("sk-lookup-body");

  if (!URL_BASE || !KEY) {
    statusEl.textContent = "Uppsetning vantar: STORKAUP_CONFIG.supabaseUrl / publishableKey.";
    runEl.disabled = true;
    return;
  }

  // Tímabilið hefur AÐEINS áhrif á sölutölurnar, ekki á hvort varan finnst
  // — vara úr vörulistanum kemur með hvort sem hún hefur selst eða ekki.
  // 365 heldur fyrirspurninni innan 8 sek anon-timeout á bc_lines_raw.
  var DAGAR = 365;
  var SVOR_A_FYRIRSPURN = 5;
  var HAMARK_FYRIRSPURNA = 200;
  var SAMHLIDA = 4;

  var LYKLAR = { brand_sku: "Birgjanúmer", sku: "Stórkaups-SKU", leit: "Leit" };

  function fmtInt(v) {
    return Number(v || 0).toLocaleString("is-IS", { maximumFractionDigits: 0 });
  }
  function fmtISK(v) {
    return Number(v || 0).toLocaleString("is-IS", { maximumFractionDigits: 0 }) + " kr.";
  }

  function parseQueries(raw) {
    var parts = String(raw || "").split(/[\s,;]+/);
    var out = [], seen = {};
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i].trim();
      if (!q) continue;
      var k = q.toUpperCase();
      if (seen[k]) continue;          // sama og í sheet-útgáfunni: afrit margfalda töfluna
      seen[k] = true;
      out.push(q);
    }
    return out;
  }

  async function lookupOne(query) {
    var res = await fetch(URL_BASE + "/rest/v1/rpc/search_products", {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_query: query, p_days_back: DAGAR, p_limit: SVOR_A_FYRIRSPURN })
    });
    if (!res.ok) {
      // PostgREST sendir raunverulegu Postgres-villuna i svarbolnum
      // ({message, details, hint, code}). Fyrri utgafa kastadi bara
      // "HTTP 500" og henti thvi einu upplysingunum sem segja hvad for
      // urskeidis — sem gerdi 500 ad radgatu i stad skilabods.
      var raw = "";
      try { raw = await res.text(); } catch (e) { raw = ""; }
      var msg = "HTTP " + res.status;
      try {
        var j = JSON.parse(raw);
        if (j && j.message) {
          msg += " — " + j.message;
          if (j.code) msg += " [" + j.code + "]";
          if (j.hint) msg += " (" + j.hint + ")";
        } else if (raw) {
          msg += " — " + raw.slice(0, 300);
        }
      } catch (e) {
        if (raw) msg += " — " + raw.slice(0, 300);
      }
      throw new Error(msg);
    }
    return res.json();
  }

  // Keyrslubiðröð með þaki. Listi af 200 númerum í einu er 200 beiðnir;
  // fjórar í einu halda svartímanum niðri án þess að hlaða á RPC-ið.
  async function runQueue(queries, onRow, onProgress) {
    var next = 0, done = 0;
    async function worker() {
      while (next < queries.length) {
        var i = next++;
        var q = queries[i];
        try {
          onRow(q, await lookupOne(q), null);
        } catch (err) {
          onRow(q, null, err);
        }
        onProgress(++done, queries.length);
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(SAMHLIDA, queries.length); w++) workers.push(worker());
    await Promise.all(workers);
  }

  var resultRows = [];   // [[fyrirspurn, lykill, sku, birgjanr, heiti, pantanir, velta]]

  function addRow(cells, cssClass) {
    var tr = document.createElement("tr");
    if (cssClass) tr.className = cssClass;
    cells.forEach(function (c, i) {
      var td = document.createElement("td");
      if (i === 1 && c) {
        var tag = document.createElement("span");
        tag.className = "sk-lookup__tag";
        tag.textContent = c;            // textContent, aldrei innerHTML — gögnin koma úr gagnagrunni
        td.appendChild(tag);
      } else {
        td.textContent = c === null || c === undefined ? "" : String(c);
      }
      if (i === 2 || i === 3) td.className = "sk-mono";
      if (i === 5 || i === 6) td.className = "sk-num";
      tr.appendChild(td);
    });
    bodyEl.appendChild(tr);
  }

  function renderResult(query, rows, err) {
    if (err) {
      addRow([query, "", "", "", "Villa: " + err.message, "", ""], "is-miss");
      resultRows.push([query, "villa", "", "", String(err.message), "", ""]);
      return;
    }
    if (!rows || !rows.length) {
      addRow([query, "", "", "", "Fannst ekki", "", ""], "is-miss");
      resultRows.push([query, "ekki til", "", "", "", "", ""]);
      return;
    }
    rows.forEach(function (r) {
      var kind = r.match_kind || "leit";
      var cells = [
        query,
        LYKLAR[kind] || kind,
        r.sku || "",
        r.brand_sku || "",
        r.product_name || "",
        fmtInt(r.orders),
        fmtISK(r.revenue_excl)
      ];
      // „leit" er hlutstrengstreff — það er tillaga, ekki svar, og er grátt.
      addRow(cells, kind === "leit" ? "is-weak" : "");
      resultRows.push([query, kind, r.sku || "", r.brand_sku || "",
                       r.product_name || "", r.orders || 0, r.revenue_excl || 0]);
    });
  }

  async function run() {
    var queries = parseQueries(inputEl.value);
    bodyEl.innerHTML = "";
    resultRows = [];
    copyEl.disabled = true;

    if (!queries.length) {
      tableEl.hidden = true;
      statusEl.textContent = "Engin fyrirspurn.";
      return;
    }

    var skorid = 0;
    if (queries.length > HAMARK_FYRIRSPURNA) {
      skorid = queries.length - HAMARK_FYRIRSPURNA;
      queries = queries.slice(0, HAMARK_FYRIRSPURNA);
    }

    tableEl.hidden = false;
    runEl.disabled = true;
    statusEl.textContent = "Leita... 0/" + queries.length;

    await runQueue(queries, renderResult, function (done, total) {
      statusEl.textContent = "Leita... " + done + "/" + total;
    });

    // Villa er EKKI treff. Fyrri útgáfa taldi hana með, svo þrjár
    // misheppnaðar fyrirspurnir lásust sem „3 treff, 0 ófundin" — talning
    // sem fullyrti að allt hefði gengið á meðan taflan undir var rauð.
    var misses = resultRows.filter(function (r) { return r[1] === "ekki til"; }).length;
    var errors = resultRows.filter(function (r) { return r[1] === "villa"; }).length;
    var weak   = resultRows.filter(function (r) { return r[1] === "leit"; }).length;
    var hits   = resultRows.length - misses - errors;
    var msg = queries.length + " fyrirspurnir → " + hits + " treff, " + misses + " ófundin.";
    if (errors) msg += " " + errors + " VILLA — sjá töfluna.";
    if (weak) msg += " " + weak + " óviss (grá) — lestu þau yfir.";
    if (skorid) msg += " " + skorid + " sleppt yfir " + HAMARK_FYRIRSPURNA + " marki.";
    statusEl.textContent = msg;

    runEl.disabled = false;
    copyEl.disabled = resultRows.length === 0;
  }

  runEl.addEventListener("click", function () {
    run().catch(function (err) {
      statusEl.textContent = "Villa: " + err.message;
      runEl.disabled = false;
    });
  });

  inputEl.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runEl.click();
  });

  copyEl.addEventListener("click", function () {
    var tsv = [["Fyrirspurn", "Lykill", "Stórkaups-SKU", "Birgjanúmer",
                "Vöruheiti", "Pantanir", "Velta"]]
      .concat(resultRows)
      .map(function (r) { return r.join("\t"); })
      .join("\n");
    navigator.clipboard.writeText(tsv).then(function () {
      copyEl.textContent = "Afritað";
      setTimeout(function () { copyEl.textContent = "Afrita töflu"; }, 1500);
    });
  });
  }

  // Ytri skra getur i einhverju samhengi keyrt adur en markupid er komid.
  // Inni i embedinu gerist thad ekki, en thetta kostar ekkert.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

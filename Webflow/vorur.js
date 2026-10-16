/**
 * Webflow/vorur.js — sameinuð vörusíða á /kpi/vorur (áfangi 1, 2026-10-16)
 *
 * Tekur við af þremur síðum sem gerðu að hluta það sama:
 *   /kpi/top-products     (top-products.js — barnaskrá bootstrappsins,
 *                          markup í Designer, drawer = lítill portal)
 *   /kpi/voruuppfletting  (lookup.js + lookup-embed.html — listi í einu)
 *   /kpi/voruportal       (portal.js + portal-embed.html — ein vara)
 * Gömlu síðurnar standa þangað til skipt er (áfangi 2): þá fá þær 301 hingað,
 * lookup/portal-skrárnar fara úr repoinu og top-products.js úr bootstrappinu
 * — EF /kpi/dashboard ber ekki [data-module="top-products"] líka.
 *
 * ── EIN LEIT, ÞRÍR FLIPAR ──────────────────────────────────────────
 *   Vinsælar  (?tab=vinsaelar, sjálfgefið)  söluhæstu vörur + flokkar
 *   Listi     (?tab=listi)                  mörg númer í einu → tafla → TSV
 *   Vara      (?sku=…)                      vöruspjaldið (portalinn)
 * Leitin efst er tvennt: innsláttur leitar í vörulistanum
 * (search_web_catalog_v1, hröð), en LÍMDUR LISTI (lína/komma/semíkomma)
 * fer beint í Lista-flipann. Uppflettingin er þá hegðun leitarinnar, ekki
 * sér síða. search_products (les bc_lines_raw 365 daga) keyrir AÐEINS í
 * listaham — við lyklaborðsleit féll hún á 8 sek þakinu (mælt 2026-09-21),
 * og það var einmitt það sem leitarreiturinn á top-products gerði.
 *
 * Drawer-inn er farinn: smellur á röð hvar sem er opnar vöruspjaldið
 * (pushState), og „Til baka“ / bakkhnappur vafrans skilar á listann.
 *
 * ── VÖRUR SEM ERU EKKI Á VEF ───────────────────────────────────────
 * Söluhæstu vörurnar innihalda BC-vörur sem eru ekki í vörulistanum á
 * vefnum. Portalinn stoppaði á „fannst ekki“ og sótti engar hreyfingar.
 * Hér fær hausinn „Ekki á vefnum“ og kaupendur/reikningar eru sóttir samt,
 * á SKU-inu sem bcGuess_() leiðir af (STO_-forskeyti og pakkningarviðskeyti
 * af, forleiðandi núll HALDAST — tengilykill er stafréttur).
 * Sé varan á vef er BC-formið sem get_product_overview_v1 skilar notað,
 * aldrei innslátturinn: það er villan sem kostaði 2.036 BC-línur 2026-09-21.
 *
 * ── GÖGN (öll óbreytt, ekkert nýtt SQL) ────────────────────────────
 *   api.v_top_products_master / api.v_category_master (REST)   Vinsælar
 *   top_products_by_days / top_categories_by_days              fallback + eigin dagafjöldi
 *   get_product_names_by_skus (api)                            vöruheiti
 *   search_web_catalog_v1                                      leit
 *   search_products                                            Listi
 *   get_product_overview_v1, get_product_relations_v1,
 *   get_product_buyers, get_product_transactions               Vara
 * Húsreglan: hvert kall fellur fyrir sig í sinn reit. Falli flokkarnir
 * standa vörurnar; falli hreyfingarnar stendur hausinn.
 *
 * ── UPPSETNING ─────────────────────────────────────────────────────
 * Webflow/vorur-embed.html: Embed ber AÐEINS <div id="sk-vorur">; script-
 * tagið er í page head code með EIGIN pinna (ekki data-storkaup-rev).
 * KREFST (page-scoped head code, ALDREI site-wide):
 *   window.STORKAUP_CONFIG.supabaseUrl + .publishableKey
 * Webflow/auth.js (site-wide) skiptir lyklinum út fyrir JWT innskráðs notanda.
 */
(function () {
  'use strict';

  var MOUNT_ID = 'sk-vorur';

  var cfg = window.STORKAUP_CONFIG || {};
  var BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var KEY = cfg.publishableKey;

  var PERIODS = [['7d', '7 dagar'], ['30d', '30 dagar'], ['90d', '90 dagar'], ['all', 'Allt']];
  var PERIOD_TO_DAYS = { '7d': 7, '30d': 30, '90d': 90, 'all': 3650 };
  var SOURCES = [['combined', 'Samtals'], ['web', 'Vefur'], ['bc', 'BC']];
  var TOP_LIMIT = 50;
  var CACHE_TTL_MS = 45000;

  // Vöruspjaldið. 365 er það sem portalinn hafði; lengra en það og
  // get_product_buyers (regex á hverja línu í bc_lines_raw) nálgast 8 sek.
  var MOV_DAYS = [['30', '30 d'], ['90', '90 d'], ['365', '365 d']];
  var TX_LIMIT = 200;

  // Listi: sömu mörk og lookup.js. 365 heldur search_products innan
  // 8 sek; fjórar beiðnir í einu halda svartímanum niðri.
  var LIST_DAYS = 365;
  var LIST_PER_QUERY = 5;
  var LIST_MAX = 200;
  var LIST_PARALLEL = 4;
  var LYKLAR = { brand_sku: 'Birgjanúmer', sku: 'Stórkaups-SKU', leit: 'Leit' };

  // Birgjagáttir: hnappurinn AFRITAR birgjanúmerið og opnar gáttina, hann
  // leitar ekki (sjá portal.js 2026-09-22 — djúptengill væri ágiskun).
  var GATTIR = {
    'Abena': { url: 'https://online.abena.dk/Catalog', heiti: 'Abena-gáttin' }
  };

  // ── hjálparar ────────────────────────────────────────────────────────
  // Handsmíðað eins og í vidskiptavinir.js: toLocaleString('is-IS') skilaði
  // „316,529“ í Chrome á Windows.
  function num(v, dec) {
    var n = Number(v);
    if (v == null || v === '' || isNaN(n)) return '–';
    var f = Math.pow(10, dec || 0);
    n = Math.round(n * f) / f;
    var parts = Math.abs(n).toString().split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '−' : '') + int + (parts[1] ? ',' + parts[1] : '');
  }
  function isk(v) { return v == null || v === '' ? '–' : num(v) + ' kr.'; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;   // textContent, aldrei innerHTML
    return n;
  }
  function txt(s) { return document.createTextNode(s); }
  function code(s) { return el('code', 'skr-mono', s); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function extLink(cls, href, text) {
    var a = el('a', cls, text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  // Leiðir BC-formið af SKU sem er EKKI í vörulistanum. Speglar norm_ident_
  // (search_products_v2.sql) NEMA núllin: þau eru hluti af tengilyklinum.
  function bcGuess_(sku) {
    return String(sku || '').trim()
      .replace(/^STO[_\-\s]+/i, '')
      .replace(/[_\-](STK|KASSI|BRETTI|PK|PAKKI)$/i, '');
  }

  // Listi = fleiri en eitt atriði aðskilin með línu, kommu, semíkommu eða
  // dálkstoppi. Bil telst EKKI: vöruheiti bera bil.
  function listTokens(s) {
    return String(s || '').split(/[\r\n\t,;]+/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  // ── gagnalag ─────────────────────────────────────────────────────────
  function headers(profile, extra) {
    var h = { apikey: KEY, Authorization: 'Bearer ' + KEY };
    if (profile) { h['Accept-Profile'] = profile; h['Content-Profile'] = profile; }
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  // PostgREST sendir Postgres-villuna í svarbolnum. Að kasta bara stöðunni
  // gerði 500 að ráðgátu (lookup.js, 2026-09-21).
  function readError(res) {
    return res.text().then(function (t) {
      var m = 'HTTP ' + res.status;
      try {
        var j = JSON.parse(t);
        if (j && j.message) {
          m += ' — ' + j.message;
          if (j.code) m += ' [' + j.code + ']';
          if (j.hint) m += ' (' + j.hint + ')';
        } else if (t) m += ' — ' + t.slice(0, 300);
      } catch (e) { if (t) m += ' — ' + t.slice(0, 300); }
      throw new Error(m);
    });
  }

  function rpc(fn, body, profile, signal) {
    return fetch(BASE + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: headers(profile, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body || {}),
      signal: signal
    }).then(function (res) { return res.ok ? res.json() : readError(res); });
  }

  function rest(path, profile, signal) {
    return fetch(BASE + '/rest/v1/' + path, {
      headers: headers(profile), cache: 'no-store', signal: signal
    }).then(function (res) { return res.ok ? res.json() : readError(res); });
  }

  var CACHE = {};
  function cached(key, make) {
    var hit = CACHE[key];
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return Promise.resolve(hit.v);
    return make().then(function (v) { CACHE[key] = { ts: Date.now(), v: v }; return v; });
  }

  function isAbort(err) {
    return !!err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
  }

  // ── ástand ───────────────────────────────────────────────────────────
  var state = {
    tab: 'vinsaelar',       // vinsaelar | listi | vara
    prevTab: 'vinsaelar',   // þangað sem „Til baka“ fer
    period: '30d',
    customDays: 0,          // >0 = eigin dagafjöldi (uppruni á þá ekki við)
    source: 'combined',
    topLoaded: false,
    sku: '',                // varan sem er opin (eins og hún var send inn)
    skuHint: '',            // vöruheiti úr röðinni sem smellt var á
    bcSku: '',              // BC-formið sem hreyfingarnar nota
    movDays: '365',
    listRows: []
  };

  var root, R = {};          // R = DOM-tilvísanir
  var searchSeq = 0, searchTimer = null, searchHits = [];
  var topSeq = 0, catSeq = 0, prodSeq = 0, movSeq = 0;
  var topAbort = null, catAbort = null;

  // ── stílar ───────────────────────────────────────────────────────────
  // Sömu litatákn og vidskiptavinir.js: síðurnar tvær eru systur.
  var CSS = [
    '#' + MOUNT_ID + '{--ink:#17211D;--ink2:#33403A;--mute:#5E6A64;--line:#E1E5E0;--line2:#EEF0EC;--bg:#F3F4F1;--card:#FFFFFF;--acc:#17614A;--acc-bg:#E8F1EC;font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);font-size:15px;line-height:1.45}',
    '#' + MOUNT_ID + ' *{box-sizing:border-box}',
    '.skr-wrap{max-width:1360px;margin:0 auto;padding:0 20px}',
    '.skr-head{background:var(--card);border-bottom:1px solid var(--line)}',
    '.skr-head .skr-wrap{padding-top:16px;display:flex;flex-direction:column;gap:12px}',
    '.skr-toprow{display:flex;flex-wrap:wrap;gap:14px;align-items:center}',
    '.skr-title{margin:0;font-size:22px;font-weight:700}',
    '.skr-searchwrap{flex:1 1 360px;position:relative;min-width:0}',
    '.skr-search{display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid #D5DAD5;border-radius:10px;padding:0 14px;min-height:46px}',
    '.skr-search input{flex:1;border:0;background:transparent;font:inherit;font-size:16px;padding:11px 0;outline:none;color:var(--ink);min-width:0}',
    '.skr-search:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px rgba(23,97,74,.15)}',
    '.skr-res{position:absolute;z-index:30;left:0;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.12);max-height:380px;overflow:auto}',
    '.skr-res:empty{display:none}',
    '.skr-hit{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line2);background:none;padding:10px 14px;font:inherit;font-size:14px;cursor:pointer;color:var(--ink)}',
    '.skr-hit:hover,.skr-hit[aria-selected="true"]{background:#F7F8F5}',
    '.skr-hit .skr-mono{color:var(--mute);margin-right:8px}',
    '.skr-hit small{color:var(--mute)}',
    '.skr-hit-more{color:var(--acc);font-weight:500}',
    '.skr-tabs{display:flex;flex-wrap:wrap;gap:22px}',
    '.skr-tab{border:0;background:transparent;font:inherit;font-size:15px;font-weight:500;padding:10px 2px;cursor:pointer;color:var(--mute);border-bottom:3px solid transparent;min-height:44px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.skr-tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--acc)}',
    '.skr-main{padding-top:18px;padding-bottom:40px;display:flex;flex-direction:column;gap:16px}',
    '.skr-bar{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center}',
    '.skr-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.skr-chip{border:1px solid #D5DAD5;background:#fff;font:inherit;font-size:13px;padding:6px 11px;border-radius:999px;cursor:pointer;color:var(--ink2);min-height:34px}',
    '.skr-chip[aria-pressed="true"]{background:var(--acc-bg);border-color:var(--acc);color:#0E4535;font-weight:600}',
    '.skr-chip[disabled]{opacity:.45;cursor:default}',
    '.skr-days{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--mute)}',
    '.skr-days input{width:76px;border:1px solid #D5DAD5;border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;min-height:34px}',
    '.skr-grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;align-items:start}',
    '.skr-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}',
    '@media(max-width:960px){.skr-grid,.skr-grid2{grid-template-columns:minmax(0,1fr)}}',
    '.skr-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;min-width:0}',
    '.skr-card h3{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--mute);display:flex;justify-content:space-between;gap:8px}',
    '.skr-card h3 span{text-transform:none;letter-spacing:0;font-weight:400}',
    '.skr-ptitle{margin:0 0 6px;font-size:22px;font-weight:700}',
    '.skr-meta{font-size:14px;color:var(--mute);margin:0 0 10px}',
    '.skr-mono{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:.92em}',
    '.skr-b{display:inline-block;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;margin-right:6px}',
    '.skr-good{background:#DCEFE4;color:#14553F}.skr-warn{background:#FCE8D4;color:#8A4A10}.skr-bad{background:#F6DEDC;color:#8E2B22}.skr-mute{background:#ECEEEA;color:#4A5550}',
    '.skr-docs{margin:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.skr-doc{display:inline-block;padding:6px 11px;border-radius:8px;font-size:13px;border:1px solid #C9D0CA;text-decoration:none;color:var(--ink);background:#fff}',
    '.skr-doc:hover{background:#F7F8F5}',
    '.skr-doc-off{color:#8E2B22;background:#FBEDEB;border-color:#F0C8C3}',
    '.skr-btn{border:1px solid #C9D0CA;background:#fff;font:inherit;font-size:14px;font-weight:500;padding:8px 13px;border-radius:8px;cursor:pointer;color:var(--ink);min-height:40px;text-decoration:none;display:inline-flex;align-items:center;gap:6px}',
    '.skr-btn:hover{background:#F7F8F5}',
    '.skr-btn[disabled]{opacity:.5;cursor:default}',
    '.skr-pri{background:var(--acc);border-color:var(--acc);color:#fff}',
    '.skr-pri:hover{background:#0E4535}',
    '.skr-link{color:var(--acc);text-decoration:none;font-weight:500}',
    '.skr-link:hover{text-decoration:underline}',
    '.skr-tblwrap{overflow-x:auto}',
    '.skr-tbl{width:100%;border-collapse:collapse;font-size:14px}',
    '.skr-tbl th{text-align:left;font-weight:600;color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:8px 10px;border-bottom:1px solid #D5DAD5;white-space:nowrap}',
    '.skr-tbl th button{all:unset;cursor:pointer}',
    '.skr-tbl th button:focus-visible{outline:2px solid var(--acc)}',
    '.skr-tbl td{padding:9px 10px;border-bottom:1px solid var(--line2);vertical-align:top}',
    '.skr-tbl tr.skr-click{cursor:pointer}',
    '.skr-tbl tr.skr-click:hover td{background:#F7F8F5}',
    '.skr-tbl td small{display:block;color:var(--mute);font-size:12.5px}',
    '.skr-tbl tr.is-miss td{background:#FBEDEB}',
    '.skr-tbl tr.is-weak td{background:#F7F8F5;color:var(--mute)}',
    '.skr-tbl tr.is-dead td{background:#FBEDEB}',
    '.skr-n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.skr-rank{color:var(--mute);width:1%;white-space:nowrap}',
    '.skr-more{margin-top:10px}',
    '.skr-note{font-size:13px;color:var(--mute);margin:10px 0 0}',
    '.skr-empty{font-size:14px;color:var(--mute);padding:6px 0}',
    '.skr-err{padding:10px 12px;border-radius:8px;background:#FBEDEB;color:#8E2B22;font-size:14px}',
    '.skr-input{width:100%;border:1px solid #D5DAD5;border-radius:10px;padding:10px 12px;font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:14px;resize:vertical;background:#fff;color:var(--ink)}',
    '.skr-status{font-size:14px;color:var(--mute)}',
    '.skr-hidden{display:none !important}'
  ].join('\n');

  // ── smiðir ───────────────────────────────────────────────────────────
  function chipGroup(items, current, onPick) {
    var g = el('div', 'skr-chips');
    var btns = items.map(function (it) {
      var b = el('button', 'skr-chip', it[1]);
      b.type = 'button';
      b.setAttribute('data-v', it[0]);
      b.setAttribute('aria-pressed', String(it[0] === current));
      b.addEventListener('click', function () { onPick(it[0]); });
      g.appendChild(b);
      return b;
    });
    g.setValue = function (v) {
      btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
    };
    g.setDisabled = function (d) { btns.forEach(function (b) { b.disabled = !!d; }); };
    return g;
  }

  function card(title, extra) {
    var c = el('div', 'skr-card');
    var h = el('h3', '', title);
    if (extra) h.appendChild(extra);
    c.appendChild(h);
    var body = el('div', '');
    c.appendChild(body);
    c.h = h; c.body = body;
    return c;
  }

  function setBody(node, child) { clear(node); if (child) node.appendChild(child); }
  function msg(cls, text) { return el(cls === 'err' ? 'div' : 'p', 'skr-' + cls, text); }

  /**
   * Tafla með röðun og „Sýna allar“. cols: [{k, l, num, v(row), cell(row)}].
   * Raðast í vafranum: gögnin eru þegar komin og raðirnar fáar.
   */
  function sortTable(cols, rows, opt) {
    opt = opt || {};
    var wrap = el('div', '');
    var st = { key: opt.sortKey || '', dir: opt.sortDir || -1, all: false };
    var size = opt.pageSize || 0;
    var byKey = {};
    cols.forEach(function (c) { byKey[c.k] = c; });

    function val(r, k) {
      var c = byKey[k];
      var v = c && c.v ? c.v(r) : r[k];
      if (c && c.num) return Number(v) || 0;
      return String(v == null ? '' : v).toLowerCase();
    }

    function draw() {
      clear(wrap);
      var tw = el('div', 'skr-tblwrap');
      var t = el('table', 'skr-tbl');
      var thead = el('thead', '');
      var hr = el('tr', '');
      cols.forEach(function (c) {
        var th = el('th', c.num ? 'skr-n' : '');
        if (c.nosort) { th.textContent = c.l; }
        else {
          var b = el('button', '', c.l + (st.key === c.k ? (st.dir < 0 ? ' ↓' : ' ↑') : ''));
          b.type = 'button';
          b.addEventListener('click', function () {
            if (st.key === c.k) st.dir = -st.dir;
            else { st.key = c.k; st.dir = c.num ? -1 : 1; }
            draw();
          });
          th.appendChild(b);
        }
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      t.appendChild(thead);

      var sorted = rows.slice();
      if (st.key) {
        sorted.sort(function (a, b) {
          var x = val(a, st.key), y = val(b, st.key);
          return x < y ? -st.dir : x > y ? st.dir : 0;
        });
      }
      var shown = size && !st.all ? sorted.slice(0, size) : sorted;
      var tb = el('tbody', '');
      shown.forEach(function (r) {
        var tr = el('tr', opt.rowClass ? opt.rowClass(r) : '');
        cols.forEach(function (c) {
          var td = el('td', ((c.num ? 'skr-n ' : '') + (c.cls || '')).trim());
          if (c.cell) {
            var n = c.cell(r);
            if (n != null) td.appendChild(typeof n === 'string' ? txt(n) : n);
          } else {
            td.textContent = r[c.k] == null ? '' : String(r[c.k]);
          }
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      tw.appendChild(t);
      wrap.appendChild(tw);

      if (size && rows.length > size) {
        var more = el('button', 'skr-btn skr-more',
          st.all ? 'Sýna færri' : 'Sýna allar (' + num(rows.length) + ')');
        more.type = 'button';
        more.addEventListener('click', function () { st.all = !st.all; draw(); });
        wrap.appendChild(more);
      }
    }
    draw();
    return wrap;
  }

  // Tengill á vöruspjald. href er raunverulegur (?sku=) svo ctrl/miðsmellur
  // opnar nýjan flipa; venjulegur smellur helst á síðunni.
  function productLink(sku, name, cls) {
    var a = el('a', cls || 'skr-link', name || sku);
    a.href = '?sku=' + encodeURIComponent(sku);
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopPropagation();
      openProduct(sku, name || '', true);
    });
    return a;
  }

  // ── uppbygging ───────────────────────────────────────────────────────
  function build() {
    clear(root);

    // Haus: titill + leit + flipar
    var head = el('div', 'skr-head');
    var hw = el('div', 'skr-wrap');
    var top = el('div', 'skr-toprow');
    top.appendChild(el('h1', 'skr-title', 'Vörur'));

    var sw = el('div', 'skr-searchwrap');
    var sbox = el('div', 'skr-search');
    var input = el('input', '');
    input.type = 'search';
    input.id = 'skr-q';
    input.autocomplete = 'off';
    input.placeholder = 'Leitaðu að vöru, SKU eða birgjanúmeri — eða límdu inn lista…';
    input.setAttribute('aria-label', 'Leita að vöru');
    sbox.appendChild(input);
    sw.appendChild(sbox);
    var res = el('div', 'skr-res');
    res.setAttribute('role', 'listbox');
    sw.appendChild(res);
    top.appendChild(sw);
    hw.appendChild(top);

    var tabs = el('div', 'skr-tabs');
    tabs.setAttribute('role', 'tablist');
    R.tabBtns = {};
    [['vinsaelar', 'Vinsælar vörur'], ['listi', 'Listauppfletting'], ['vara', 'Vara']].forEach(function (t) {
      var b = el('button', 'skr-tab', t[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () {
        if (t[0] === 'vara') {
          if (!state.sku || state.tab === 'vara') return;
          state.prevTab = state.tab;
          showTab('vara');
          syncUrl(true);
        }
        else setTab(t[0], true);
      });
      R.tabBtns[t[0]] = b;
      tabs.appendChild(b);
    });
    hw.appendChild(tabs);
    head.appendChild(hw);
    root.appendChild(head);

    var main = el('div', 'skr-wrap skr-main');
    root.appendChild(main);

    R.input = input; R.res = res; R.searchWrap = sw;
    R.views = {
      vinsaelar: buildTopView(main),
      listi: buildListView(main),
      vara: buildProductView(main)
    };

    wireSearch();
  }

  // ── Vinsælar ─────────────────────────────────────────────────────────
  function buildTopView(main) {
    var v = el('div', 'skr-view');
    var bar = el('div', 'skr-bar');

    R.periodChips = chipGroup(PERIODS, state.period, function (p) {
      state.period = p; state.customDays = 0;
      R.periodChips.setValue(p); R.daysInput.value = '';
      R.sourceChips.setDisabled(false);
      loadTop();
    });
    bar.appendChild(R.periodChips);

    var days = el('label', 'skr-days', 'Eða síðustu');
    var di = el('input', '');
    di.type = 'number'; di.min = '1'; di.max = '3650'; di.placeholder = 'dagar';
    days.appendChild(di);
    var db = el('button', 'skr-chip', 'Sýna');
    db.type = 'button';
    function applyDays() {
      var d = Math.floor(Number(di.value));
      if (!d || d < 1) return;
      state.customDays = Math.min(d, 3650);
      R.periodChips.setValue('');
      // top_products_by_days skilar samtölu eingöngu — uppruni á ekki við.
      R.sourceChips.setDisabled(true);
      loadTop();
    }
    db.addEventListener('click', applyDays);
    di.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyDays(); });
    days.appendChild(db);
    bar.appendChild(days);
    R.daysInput = di;

    R.sourceChips = chipGroup(SOURCES, state.source, function (s) {
      state.source = s; R.sourceChips.setValue(s);
      loadTopProducts();     // flokkarnir eru ekki skiptir eftir uppruna
    });
    bar.appendChild(R.sourceChips);
    v.appendChild(bar);

    var grid = el('div', 'skr-grid');
    R.topCard = card('Söluhæstu vörur', el('span', '', 'velta án VSK'));
    R.catCard = card('Söluhæstu flokkar');
    wireRowClicks(R.topCard.body);   // einu sinni — body lifir milli hleðslna
    grid.appendChild(R.topCard);
    grid.appendChild(R.catCard);
    v.appendChild(grid);
    main.appendChild(v);
    return v;
  }

  function topMode() {
    return state.customDays
      ? { kind: 'days', value: state.customDays }
      : { kind: 'period', value: state.period };
  }

  function loadTop() {
    state.topLoaded = true;
    loadTopProducts();
    loadTopCategories();
  }

  function mapDaysRow(r) {
    return {
      product_name: r.product_name, sku: r.sku,
      orders: r.orders != null ? r.orders : (r.total_orders || 0),
      revenue_excl: r.revenue_excl != null ? r.revenue_excl : (r.total_revenue_excl || 0)
    };
  }

  function pickSource(r, source) {
    if (source === 'web') return { product_name: r.product_name, sku: r.sku, orders: r.web_orders || 0, revenue_excl: r.web_revenue_excl || 0 };
    if (source === 'bc')  return { product_name: r.product_name, sku: r.sku, orders: r.bc_orders || 0, revenue_excl: r.bc_revenue_excl || 0 };
    return { product_name: r.product_name, sku: r.sku,
             orders: r.total_orders != null ? r.total_orders : (r.orders || 0),
             revenue_excl: r.total_revenue_excl != null ? r.total_revenue_excl : (r.revenue_excl || 0) };
  }

  // Sama fallback-keðja og top-products.js: MV fyrst, gamla „all“-sýnin
  // fyrir eldra skema, og dagafallið ef sýnin fellur á tíma.
  function fetchTopProducts(mode, source, signal) {
    if (mode.kind === 'days') {
      return rpc('top_products_by_days', { days_back: mode.value, row_limit: TOP_LIMIT }, null, signal)
        .then(function (rows) { return (rows || []).map(mapDaysRow); });
    }
    var period = mode.value;
    var orderCol = source === 'web' ? 'web_revenue_excl' : source === 'bc' ? 'bc_revenue_excl' : 'total_revenue_excl';
    return rest('v_top_products_master?select=sku,product_name,web_orders,web_revenue_excl,bc_orders,bc_revenue_excl,total_orders,total_revenue_excl' +
                '&period=eq.' + encodeURIComponent(period) +
                '&order=' + orderCol + '.desc&limit=' + TOP_LIMIT, 'api', signal)
      .catch(function (err) {
        if (isAbort(err) || period !== 'all' || source !== 'combined') throw err;
        return rest('v_top_products_all?select=sku,product_name,total_orders,total_revenue_excl' +
                    '&order=total_revenue_excl.desc&limit=' + TOP_LIMIT, 'api', signal);
      })
      .then(function (rows) { return (rows || []).map(function (r) { return pickSource(r, source); }); })
      .catch(function (err) {
        if (isAbort(err)) throw err;
        return rpc('top_products_by_days', { days_back: PERIOD_TO_DAYS[period] || 30, row_limit: TOP_LIMIT }, null, signal)
          .then(function (rows) { return (rows || []).map(mapDaysRow); });
      });
  }

  // Vöruheiti úr vörulistanum frekar en úr sölulínunum. Falli kallið
  // standa heitin úr sölugögnunum.
  function withCanonicalNames(rows) {
    var keys = {};
    rows.forEach(function (r) {
      var s = String(r.sku || '').trim();
      if (s) { keys[s] = 1; keys[s.replace(/_[A-Za-z0-9]+$/, '')] = 1; }
    });
    var list = Object.keys(keys);
    if (!list.length) return Promise.resolve(rows);
    return rpc('get_product_names_by_skus', { p_skus: list }, 'api').then(function (names) {
      var map = {};
      (names || []).forEach(function (n) {
        var nm = String(n && n.product_name || '').trim();
        if (!nm) return;
        if (n.input_sku) map[String(n.input_sku).trim()] = nm;
        if (n.canonical_sku) map[String(n.canonical_sku).trim()] = nm;
      });
      return rows.map(function (r) {
        var s = String(r.sku || '').trim();
        var nm = map[s] || map[s.replace(/_[A-Za-z0-9]+$/, '')];
        return nm ? Object.assign({}, r, { product_name: nm }) : r;
      });
    }, function () { return rows; });
  }

  function loadTopProducts() {
    var seq = ++topSeq;
    if (topAbort) { try { topAbort.abort(); } catch (e) {} }
    topAbort = window.AbortController ? new AbortController() : null;
    var signal = topAbort ? topAbort.signal : undefined;
    var mode = topMode();
    var source = mode.kind === 'days' ? 'combined' : state.source;
    var key = 'p|' + source + '|' + mode.kind + '|' + mode.value;

    setBody(R.topCard.body, msg('empty', 'Sæki…'));
    cached(key, function () {
      return fetchTopProducts(mode, source, signal).then(withCanonicalNames);
    }).then(function (rows) {
      if (seq !== topSeq) return;
      rows = rows.slice().sort(function (a, b) {
        return (Number(b.revenue_excl) || 0) - (Number(a.revenue_excl) || 0) ||
               (Number(b.orders) || 0) - (Number(a.orders) || 0);
      });
      rows.forEach(function (r, i) { r._rank = i + 1; });
      if (!rows.length) { setBody(R.topCard.body, msg('empty', 'Engin sala á tímabilinu.')); return; }
      setBody(R.topCard.body, sortTable([
        { k: '_rank', l: '#', num: true, cls: 'skr-rank' },
        { k: 'product_name', l: 'Vara', cell: function (r) {
            var f = document.createDocumentFragment();
            f.appendChild(productLink(r.sku, r.product_name || r.sku));
            f.appendChild(el('small', 'skr-mono', r.sku || ''));
            return f;
          } },
        { k: 'orders', l: 'Pantanir', num: true, cell: function (r) { return num(r.orders); } },
        { k: 'revenue_excl', l: 'Velta', num: true, cell: function (r) { return isk(r.revenue_excl); } }
      ], rows, {
        rowClass: function () { return 'skr-click'; }
      }));
    }).catch(function (err) {
      if (isAbort(err) || seq !== topSeq) return;
      setBody(R.topCard.body, msg('err', 'Gat ekki hlaðið söluhæstu vörum: ' + err.message));
    });
  }

  // Smellur hvar sem er á röðinni opnar vöruna — tengillinn í henni er
  // fyrir ctrl-smell og skjálesara.
  function wireRowClicks(container) {
    container.addEventListener('click', function (e) {
      var tr = e.target.closest('tr.skr-click');
      if (!tr || e.target.closest('a,button')) return;
      var a = tr.querySelector('a[href^="?sku="]');
      if (a) a.click();
    });
  }

  function loadTopCategories() {
    var seq = ++catSeq;
    if (catAbort) { try { catAbort.abort(); } catch (e) {} }
    catAbort = window.AbortController ? new AbortController() : null;
    var signal = catAbort ? catAbort.signal : undefined;
    var mode = topMode();
    var key = 'c|' + mode.kind + '|' + mode.value;

    setBody(R.catCard.body, msg('empty', 'Sæki…'));
    cached(key, function () {
      var byDays = function (d) {
        return rpc('top_categories_by_days', { days_back: d, row_limit: TOP_LIMIT }, null, signal);
      };
      if (mode.kind === 'days') return byDays(mode.value);
      return rest('v_category_master?select=category_path,total_orders,total_revenue_excl' +
                  '&period=eq.' + encodeURIComponent(mode.value) +
                  '&order=total_revenue_excl.desc&limit=' + TOP_LIMIT, 'api', signal)
        .catch(function (err) {
          if (isAbort(err)) throw err;
          return byDays(PERIOD_TO_DAYS[mode.value] || 30);
        });
    }).then(function (rows) {
      if (seq !== catSeq) return;
      rows = (rows || []).map(function (r) {
        return {
          category_path: r.category_path || 'Óflokkað',
          orders: r.orders != null ? r.orders : (r.total_orders || 0),
          revenue_excl: r.revenue_excl != null ? r.revenue_excl : (r.total_revenue_excl || 0)
        };
      });
      if (!rows.length) { setBody(R.catCard.body, msg('empty', 'Engin sala á tímabilinu.')); return; }
      setBody(R.catCard.body, sortTable([
        { k: 'category_path', l: 'Flokkur' },
        { k: 'orders', l: 'Pantanir', num: true, cell: function (r) { return num(r.orders); } },
        { k: 'revenue_excl', l: 'Velta', num: true, cell: function (r) { return isk(r.revenue_excl); } }
      ], rows, { sortKey: 'revenue_excl', pageSize: 20 }));
    }).catch(function (err) {
      if (isAbort(err) || seq !== catSeq) return;
      setBody(R.catCard.body, msg('err', 'Gat ekki hlaðið flokkum: ' + err.message));
    });
  }

  // ── Listi ────────────────────────────────────────────────────────────
  function buildListView(main) {
    var v = el('div', 'skr-view');
    var c = card('Listauppfletting');
    c.body.appendChild(el('p', 'skr-meta',
      'Límdu birgjanúmer eða Stórkaups-SKU — eitt í línu, eða aðskilin með kommu. ' +
      'Blandaður listi er í lagi. Pantanir og velta eru síðustu ' + LIST_DAYS + ' dagar.'));
    var ta = el('textarea', 'skr-input');
    ta.rows = 4;
    ta.id = 'skr-list';
    ta.placeholder = '7265, 7266, 7276\nSTO_114112\n117268';
    c.body.appendChild(ta);

    var bar = el('div', 'skr-bar');
    bar.style.margin = '12px 0';
    var run = el('button', 'skr-btn skr-pri', 'Fletta upp');
    run.type = 'button';
    var copy = el('button', 'skr-btn', 'Afrita töflu');
    copy.type = 'button';
    copy.disabled = true;
    var status = el('span', 'skr-status');
    bar.appendChild(run); bar.appendChild(copy); bar.appendChild(status);
    c.body.appendChild(bar);

    var out = el('div', '');
    c.body.appendChild(out);
    v.appendChild(c);
    main.appendChild(v);

    R.listInput = ta; R.listRun = run; R.listCopy = copy; R.listStatus = status; R.listOut = out;

    run.addEventListener('click', function () {
      runList().catch(function (err) {
        status.textContent = 'Villa: ' + err.message;
        run.disabled = false;
      });
    });
    ta.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run.click();
    });
    copy.addEventListener('click', function () {
      var tsv = [['Fyrirspurn', 'Lykill', 'Stórkaups-SKU', 'Birgjanúmer', 'Vöruheiti', 'Pantanir', 'Velta']]
        .concat(state.listRows)
        .map(function (r) { return r.join('\t'); })
        .join('\n');
      navigator.clipboard.writeText(tsv).then(function () {
        copy.textContent = 'Afritað';
        setTimeout(function () { copy.textContent = 'Afrita töflu'; }, 1500);
      });
    });
    return v;
  }

  // Sama þáttun og lookup.js: bil skilur líka að, afrit hverfa (annars
  // margfaldast taflan).
  function parseQueries(raw) {
    var parts = String(raw || '').split(/[\s,;]+/);
    var out = [], seen = {};
    parts.forEach(function (p) {
      var q = p.trim();
      if (!q) return;
      var k = q.toUpperCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(q);
    });
    return out;
  }

  function runQueue(queries, onRow, onProgress) {
    var next = 0, done = 0;
    function worker() {
      if (next >= queries.length) return Promise.resolve();
      var q = queries[next++];
      return rpc('search_products', { p_query: q, p_days_back: LIST_DAYS, p_limit: LIST_PER_QUERY })
        .then(function (rows) { onRow(q, rows, null); }, function (err) { onRow(q, null, err); })
        .then(function () { onProgress(++done, queries.length); return worker(); });
    }
    var ws = [];
    for (var i = 0; i < Math.min(LIST_PARALLEL, queries.length); i++) ws.push(worker());
    return Promise.all(ws);
  }

  function runList() {
    var queries = parseQueries(R.listInput.value);
    clear(R.listOut);
    state.listRows = [];
    R.listCopy.disabled = true;
    if (!queries.length) { R.listStatus.textContent = 'Engin fyrirspurn.'; return Promise.resolve(); }

    var skorid = 0;
    if (queries.length > LIST_MAX) { skorid = queries.length - LIST_MAX; queries = queries.slice(0, LIST_MAX); }

    var tw = el('div', 'skr-tblwrap');
    var t = el('table', 'skr-tbl');
    var hr = el('tr', '');
    ['Fyrirspurn', 'Lykill', 'Stórkaups-SKU', 'Birgjanúmer', 'Vöruheiti', 'Pantanir', 'Velta'].forEach(function (h, i) {
      hr.appendChild(el('th', i >= 5 ? 'skr-n' : '', h));
    });
    var th = el('thead', ''); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody', ''); t.appendChild(tb);
    tw.appendChild(t);
    R.listOut.appendChild(tw);
    wireRowClicks(tb);

    function addRow(cells, cls, sku) {
      var tr = el('tr', cls || '');
      cells.forEach(function (c, i) {
        var td = el('td', i >= 5 ? 'skr-n' : (i === 2 || i === 3 ? 'skr-mono' : ''));
        if (i === 1 && c) td.appendChild(el('span', 'skr-b skr-mute', c));
        else if (i === 2 && sku) td.appendChild(productLink(sku, c));
        else td.textContent = c == null ? '' : String(c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }

    function onRow(q, rows, err) {
      if (err) {
        addRow([q, '', '', '', 'Villa: ' + err.message, '', ''], 'is-miss');
        state.listRows.push([q, 'villa', '', '', String(err.message), '', '']);
        return;
      }
      if (!rows || !rows.length) {
        addRow([q, '', '', '', 'Fannst ekki', '', ''], 'is-miss');
        state.listRows.push([q, 'ekki til', '', '', '', '', '']);
        return;
      }
      rows.forEach(function (r) {
        var kind = r.match_kind || 'leit';
        // „leit“ er hlutstrengstreff — tillaga, ekki svar, og er grátt.
        addRow([q, LYKLAR[kind] || kind, r.sku || '', r.brand_sku || '', r.product_name || '',
                num(r.orders), isk(r.revenue_excl)],
               (kind === 'leit' ? 'is-weak ' : '') + (r.sku ? 'skr-click' : ''), r.sku);
        state.listRows.push([q, kind, r.sku || '', r.brand_sku || '', r.product_name || '',
                             r.orders || 0, r.revenue_excl || 0]);
      });
    }

    R.listRun.disabled = true;
    R.listStatus.textContent = 'Leita… 0/' + queries.length;
    return runQueue(queries, onRow, function (d, n) {
      R.listStatus.textContent = 'Leita… ' + d + '/' + n;
    }).then(function () {
      // Villa er EKKI treff (lookup.js: þrjár villur lásust áður sem „3 treff“).
      var rows = state.listRows;
      var misses = rows.filter(function (r) { return r[1] === 'ekki til'; }).length;
      var errors = rows.filter(function (r) { return r[1] === 'villa'; }).length;
      var weak = rows.filter(function (r) { return r[1] === 'leit'; }).length;
      var hits = rows.length - misses - errors;
      var m = queries.length + ' fyrirspurnir → ' + hits + ' treff, ' + misses + ' ófundin.';
      if (errors) m += ' ' + errors + ' VILLA — sjá töfluna.';
      if (weak) m += ' ' + weak + ' óviss (grá) — lestu þau yfir.';
      if (skorid) m += ' ' + skorid + ' sleppt yfir ' + LIST_MAX + ' marki.';
      R.listStatus.textContent = m;
      R.listRun.disabled = false;
      R.listCopy.disabled = rows.length === 0;
    });
  }

  function startList(text) {
    R.listInput.value = text;
    R.input.value = '';
    closeResults();
    setTab('listi', true);
    R.listRun.click();
  }

  // ── Vara ─────────────────────────────────────────────────────────────
  function buildProductView(main) {
    var v = el('div', 'skr-view');
    var bar = el('div', 'skr-bar');
    var back = el('button', 'skr-btn', '← Til baka');
    back.type = 'button';
    back.addEventListener('click', goBack);
    bar.appendChild(back);
    var lbl = el('span', 'skr-status', 'Sala síðustu');
    bar.appendChild(lbl);
    R.movChips = chipGroup(MOV_DAYS, state.movDays, function (d) {
      state.movDays = d; R.movChips.setValue(d);
      if (state.bcSku) loadMovements(state.bcSku);
    });
    bar.appendChild(R.movChips);
    v.appendChild(bar);

    R.headCard = el('div', 'skr-card');
    v.appendChild(R.headCard);

    var g1 = el('div', 'skr-grid2');
    R.buyCard = card('Kaupendur');
    R.txCard = card('Sölureikningar');
    g1.appendChild(R.buyCard); g1.appendChild(R.txCard);
    v.appendChild(g1);

    var g2 = el('div', 'skr-grid2');
    R.liveCard = card('Tengt á storkaup.is');
    R.suggCard = card('Tillögur úr sölugögnum');
    g2.appendChild(R.liveCard); g2.appendChild(R.suggCard);
    v.appendChild(g2);

    main.appendChild(v);
    return v;
  }

  function openProduct(sku, hint, push) {
    sku = String(sku || '').trim();
    if (!sku) return;
    if (state.tab !== 'vara') state.prevTab = state.tab;
    closeResults();
    var same = sku === state.sku;
    state.sku = sku;
    state.skuHint = hint || '';
    showTab('vara');
    syncUrl(push);
    window.scrollTo(0, 0);
    if (!same) loadProduct();
  }

  function goBack() {
    if (history.state && history.state.skr === 1) history.back();
    else setTab(state.prevTab || 'vinsaelar', true);
  }

  function loadProduct() {
    var seq = ++prodSeq;
    var sku = state.sku;
    state.bcSku = '';
    R.tabBtns.vara.textContent = state.skuHint || sku;
    setBody(R.headCard, msg('empty', 'Sæki ' + sku + '…'));
    [R.buyCard, R.txCard, R.liveCard, R.suggCard].forEach(function (c) { setBody(c.body, msg('empty', 'Sæki…')); });

    rpc('get_product_overview_v1', { p_sku: sku }).then(function (rows) {
      if (seq !== prodSeq) return;
      if (rows && rows.length) {
        renderHead(rows);
        // BC-FORMIÐ sem kom til baka, ekki innslátturinn — sjá hausinn.
        state.bcSku = rows[0].sku;
        loadRelations(rows[0].sku, seq);
      } else {
        renderHeadOffWeb(sku);
        state.bcSku = bcGuess_(sku);
        setBody(R.liveCard.body, msg('empty', 'Engin — varan er ekki á vefnum.'));
        setBody(R.suggCard.body, msg('empty', 'Tillögur eru aðeins reiknaðar fyrir vörur á vefnum.'));
      }
      loadMovements(state.bcSku);
    }).catch(function (err) {
      if (seq !== prodSeq) return;
      // Hausinn féll en hreyfingarnar geta staðið: sækjum þær á giskaða formið.
      setBody(R.headCard, msg('err', 'Vöruupplýsingar brugðust: ' + err.message));
      setBody(R.liveCard.body, msg('empty', '—'));
      setBody(R.suggCard.body, msg('empty', '—'));
      state.bcSku = bcGuess_(sku);
      loadMovements(state.bcSku);
    });
  }

  function renderHead(rows) {
    var p = rows[0];
    var h = clear(R.headCard);
    R.tabBtns.vara.textContent = p.product_name || p.sku;
    h.appendChild(el('h2', 'skr-ptitle', p.product_name || p.sku));

    var meta = el('p', 'skr-meta');
    meta.appendChild(txt('SKU ')); meta.appendChild(code(p.sku));
    if (p.brand_sku) { meta.appendChild(txt(' · birgjanr. ')); meta.appendChild(code(p.brand_sku)); }
    if (p.brand_name) meta.appendChild(txt(' · ' + p.brand_name));
    if (rows.length > 1) {
      meta.appendChild(txt(' · ' + rows.length + ' sölueiningar: ' +
        rows.map(function (r) { return r.web_sku; }).join(', ')));
    }
    h.appendChild(meta);
    h.appendChild(contentTag(p));
    h.appendChild(docsRow(p));
    if (p.product_url) h.appendChild(extLink('skr-link', p.product_url, 'Opna á storkaup.is ↗'));
    h.appendChild(el('p', 'skr-note',
      'Vefgögn samstillt ' + String(p.synced_at || '').replace('T', ' ').slice(0, 16) +
      ' (á 12 klst. fresti). Vara sem fór á vefinn eftir þann tíma finnst ekki hér.'));
  }

  function renderHeadOffWeb(sku) {
    var h = clear(R.headCard);
    h.appendChild(el('h2', 'skr-ptitle', state.skuHint || sku));
    var meta = el('p', 'skr-meta');
    meta.appendChild(txt('SKU ')); meta.appendChild(code(sku));
    if (bcGuess_(sku) !== sku) { meta.appendChild(txt(' · BC ')); meta.appendChild(code(bcGuess_(sku))); }
    h.appendChild(meta);
    h.appendChild(el('span', 'skr-b skr-bad', 'Ekki á vefnum'));
    h.appendChild(el('p', 'skr-note',
      'Varan er ekki í vörulistanum á vefnum — annaðhvort er hún ekki seld þar, eða hún bættist ' +
      'við eftir síðustu samstillingu (á 12 klst. fresti). Salan hér að neðan er úr BC.'));
  }

  function contentTag(p) {
    var wrap = el('div', '');
    var map = {
      'engin':  ['skr-bad',  'Engin lýsing'],
      'heiti':  ['skr-bad',  'Lýsing er bara vöruheitið'],
      'stutt':  ['skr-warn', 'Stutt lýsing (' + p.description_length + ' stafir)'],
      'i-lagi': ['skr-good', 'Lýsing ' + p.description_length + ' stafir']
    };
    var m = map[p.content_flag] || ['skr-mute', 'Innihaldsstaða óþekkt'];
    wrap.appendChild(el('span', 'skr-b ' + m[0], m[1]));
    if (p.content_flag === 'engin' || p.content_flag === 'heiti') {
      wrap.appendChild(el('span', 'skr-status', ' — laga í vöruinnihald-appinu'));
    }
    return wrap;
  }

  /**
   * Vottanir sem flísar og skjöl sem tenglar (portal.js). Öryggisblað er
   * alltaf sýnt, líka þegar það vantar; gagnablað sem vöntun aðeins ef
   * annað skjal er til — vara með ekkert skjal fær ekki þrjár rauðar flísar.
   */
  function docsRow(p) {
    var row = el('div', 'skr-docs');
    (p.labels || []).forEach(function (l) { row.appendChild(el('span', 'skr-b skr-good', l)); });
    var hasAny = p.datasheet_url || p.safety_url || p.brochure_url;
    row.appendChild(docLink('Gagnablað', p.datasheet_url, hasAny));
    row.appendChild(docLink('Öryggisblað', p.safety_url, true));
    if (p.brochure_url) row.appendChild(docLink('Bæklingur', p.brochure_url, false));

    var g = GATTIR[p.brand_name];
    if (g && p.brand_sku) {
      var b = el('button', 'skr-btn skr-pri', 'Afrita ' + p.brand_sku + ' og opna ' + g.heiti + ' ↗');
      b.type = 'button';
      b.addEventListener('click', function () {
        var open = function () { window.open(g.url, '_blank', 'noopener'); };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(p.brand_sku).then(function () {
            b.textContent = 'Afritað — límdu í leitina';
            open();
          }, open);
        } else open();
      });
      row.appendChild(b);
    }
    return row;
  }

  function docLink(heiti, url, synaVontun) {
    if (url) return extLink('skr-doc', url, heiti + ' ↗');
    if (!synaVontun) return txt('');
    return el('span', 'skr-doc skr-doc-off', 'Ekkert ' + heiti.toLowerCase());
  }

  function loadRelations(sku, seq) {
    rpc('get_product_relations_v1', { p_sku: sku }).then(function (rows) {
      if (seq !== prodSeq) return;
      rows = rows || [];
      var live = rows.filter(function (r) { return r.kind === 'live'; });
      var sugg = rows.filter(function (r) { return r.kind === 'suggested'; });
      var dead = live.filter(function (r) { return !r.related_on_web; }).length;

      var relName = function (r) {
        return r.related_on_web && r.related_slug
          ? productLink(r.related_sku, r.related_name || r.related_sku)
          : (r.related_name || '(ekki á vefnum)');
      };
      var rowCls = function (r) { return r.related_on_web ? '' : 'is-dead'; };

      if (!live.length) setBody(R.liveCard.body, msg('empty', 'Ekkert.'));
      else {
        var lw = el('div', '');
        lw.appendChild(sortTable([
          { k: 'related_sku', l: 'SKU', cls: 'skr-mono' },
          { k: 'related_name', l: 'Vara', cell: relName },
          { k: 'related_brand', l: 'Vörumerki' }
        ], live, { rowClass: rowCls, pageSize: 15 }));
        if (dead) lw.appendChild(el('p', 'skr-note',
          '⚠️ ' + dead + ' tengsl vísa á vöru sem er ekki lengur á vefnum — dauður hlekkur.'));
        setBody(R.liveCard.body, lw);
      }

      if (!sugg.length) setBody(R.suggCard.body, msg('empty', 'Ekkert.'));
      else setBody(R.suggCard.body, sortTable([
        { k: 'related_sku', l: 'SKU', cls: 'skr-mono' },
        { k: 'related_name', l: 'Vara', cell: relName },
        { k: 'score', l: 'Stig', num: true, cell: function (r) { return r.score == null ? '' : String(r.score); } },
        { k: 'reason', l: 'Rök' }
      ], sugg, { rowClass: rowCls, sortKey: 'score', pageSize: 15 }));
    }).catch(function (err) {
      if (seq !== prodSeq) return;
      setBody(R.liveCard.body, msg('err', 'Tengsl brugðust: ' + err.message));
      setBody(R.suggCard.body, msg('empty', '—'));
    });
  }

  function loadMovements(bcSku) {
    var seq = ++movSeq;
    var days = Number(state.movDays) || 365;
    R.buyCard.h.firstChild.textContent = 'Kaupendur · ' + days + ' dagar';
    R.txCard.h.firstChild.textContent = 'Sölureikningar · ' + days + ' dagar';
    setBody(R.buyCard.body, msg('empty', 'Sæki…'));
    setBody(R.txCard.body, msg('empty', 'Sæki…'));

    rpc('get_product_buyers', { p_sku: bcSku, p_days_back: days }).then(function (rows) {
      if (seq !== movSeq) return;
      rows = rows || [];
      if (!rows.length) { setBody(R.buyCard.body, msg('empty', 'Engin sala í glugganum.')); return; }
      var w = el('div', '');
      w.appendChild(sortTable([
        { k: 'customer_name', l: 'Viðskiptavinur', cell: function (r) {
            var id = r.customer_no || '';
            if (!id) return r.customer_name || '';
            // Systursíðan: kaupandi → prófíllinn hans.
            var a = el('a', 'skr-link', r.customer_name || id);
            a.href = '/kpi/vidskiptavinur?customer=' + encodeURIComponent(id);
            return a;
          } },
        { k: 'orders', l: 'Pantanir', num: true, cell: function (r) { return num(r.orders); } },
        { k: 'qty_total', l: 'Magn', num: true, cell: function (r) { return num(r.qty_total); } },
        { k: 'revenue_excl', l: 'Velta', num: true, cell: function (r) { return isk(r.revenue_excl); } }
      ], rows, { sortKey: 'revenue_excl', pageSize: 15 }));
      // get_product_buyers skilar mest 100 röðum.
      w.appendChild(el('p', 'skr-note', rows.length >= 100
        ? '100 stærstu viðskiptavinirnir eftir veltu.'
        : rows.length + ' viðskiptavinir.'));
      setBody(R.buyCard.body, w);
    }).catch(function (err) {
      if (seq !== movSeq) return;
      setBody(R.buyCard.body, msg('err', 'Kaupendur brugðust: ' + err.message));
    });

    rpc('get_product_transactions', { p_sku: bcSku, p_days_back: days, p_limit: TX_LIMIT }).then(function (rows) {
      if (seq !== movSeq) return;
      rows = rows || [];
      if (!rows.length) { setBody(R.txCard.body, msg('empty', 'Engar færslur.')); return; }
      var w = el('div', '');
      w.appendChild(sortTable([
        { k: 'booking_date', l: 'Dags.', cell: function (r) { return String(r.booking_date || '').slice(0, 10); } },
        { k: 'document_no', l: 'Reikningur', cls: 'skr-mono' },
        { k: 'customer_name', l: 'Viðskiptavinur' },
        { k: 'qty', l: 'Magn', num: true, cell: function (r) { return num(r.qty); } },
        { k: 'amount_excl', l: 'Upphæð', num: true, cell: function (r) { return isk(r.amount_excl); } }
      ], rows, { sortKey: 'booking_date', pageSize: 25 }));
      if (rows.length >= TX_LIMIT) w.appendChild(el('p', 'skr-note', TX_LIMIT + ' nýjustu færslurnar.'));
      setBody(R.txCard.body, w);
    }).catch(function (err) {
      if (seq !== movSeq) return;
      setBody(R.txCard.body, msg('err', 'Sölureikningar brugðust: ' + err.message));
    });
  }

  // ── leit ─────────────────────────────────────────────────────────────
  function closeResults() { if (R.res) clear(R.res); searchHits = []; }

  function wireSearch() {
    var input = R.input;

    input.addEventListener('paste', function (e) {
      var t = (e.clipboardData || window.clipboardData);
      t = t ? t.getData('text') : '';
      // Innsláttarreitur gleypir línuskil: límdur listi yrði einn strengur.
      // Því er hann gripinn HÉR og sendur í Lista-flipann.
      if (listTokens(t).length > 1) { e.preventDefault(); startList(t); }
    });

    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = input.value.trim();
      if (q.length < 2 || listTokens(q).length > 1) { closeResults(); return; }
      searchTimer = setTimeout(function () { search(q); }, 300);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeResults(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var items = R.res.querySelectorAll('.skr-hit');
        if (!items.length) return;
        e.preventDefault();
        var cur = -1;
        items.forEach(function (b, i) { if (b.getAttribute('aria-selected') === 'true') cur = i; });
        var nxt = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
        items.forEach(function (b, i) { b.setAttribute('aria-selected', String(i === nxt)); });
        items[nxt].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var q = input.value.trim();
      if (listTokens(q).length > 1) { startList(q); return; }
      var sel = R.res.querySelector('.skr-hit[aria-selected="true"]') || R.res.querySelector('.skr-hit');
      if (sel) sel.click();
      else if (q.length >= 2) { clearTimeout(searchTimer); search(q, true); }
    });

    document.addEventListener('click', function (e) {
      if (!R.searchWrap.contains(e.target)) closeResults();
    });
  }

  // search_web_catalog_v1, EKKI search_products — sjá hausinn.
  function search(q, openFirst) {
    var seq = ++searchSeq;
    rpc('search_web_catalog_v1', { p_query: q, p_limit: 20 }).then(function (rows) {
      if (seq !== searchSeq) return;
      searchHits = rows || [];
      if (openFirst && searchHits.length === 1) { openProduct(searchHits[0].sku, searchHits[0].product_name, true); return; }
      renderResults(q);
    }).catch(function (err) {
      if (seq !== searchSeq) return;
      clear(R.res);
      R.res.appendChild(el('div', 'skr-err', 'Leit brást: ' + err.message));
    });
  }

  function renderResults(q) {
    clear(R.res);
    if (!searchHits.length) {
      var none = el('div', 'skr-empty', 'Ekkert fannst í vörulistanum á vefnum.');
      none.style.padding = '10px 14px';
      R.res.appendChild(none);
    }
    searchHits.forEach(function (r) {
      var b = el('button', 'skr-hit');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.appendChild(el('span', 'skr-mono', r.sku || ''));
      b.appendChild(txt(r.product_name || ''));
      var extra = [];
      if (r.brand_name) extra.push(r.brand_name);
      if (r.brand_sku) extra.push('birgjanr. ' + r.brand_sku);
      if (r.match_kind && r.match_kind !== 'heiti') extra.push('↳ ' + r.match_kind);
      if (extra.length) b.appendChild(el('small', '', '  · ' + extra.join(' · ')));
      b.addEventListener('click', function () {
        R.input.value = '';
        openProduct(r.sku, r.product_name, true);
      });
      R.res.appendChild(b);
    });
    // Vörulistinn ber aðeins það sem er á vefnum. BC-vara utan vefs finnst
    // í sölugögnunum — sú leit er hæg og keyrir því aðeins á smell.
    var more = el('button', 'skr-hit skr-hit-more', 'Leita að „' + q + '“ í sölugögnum (líka vörur utan vefs) →');
    more.type = 'button';
    more.setAttribute('role', 'option');
    more.addEventListener('click', function () { startList(q); });
    R.res.appendChild(more);
  }

  // ── flipar og slóð ───────────────────────────────────────────────────
  function showTab(tab) {
    state.tab = tab;
    Object.keys(R.views).forEach(function (k) {
      R.views[k].classList.toggle('skr-hidden', k !== tab);
      R.tabBtns[k].setAttribute('aria-selected', String(k === tab));
    });
    R.tabBtns.vara.classList.toggle('skr-hidden', !state.sku);
    if (tab === 'vinsaelar' && !state.topLoaded) loadTop();
  }

  function setTab(tab, updateUrl) {
    showTab(tab);
    if (updateUrl) syncUrl(false);
  }

  // ?sku= þegar vara er opin, annars ?tab= (sleppt fyrir sjálfgefna flipann).
  // Vara fer í söguna (push) svo bakkhnappurinn skili á listann; flipaskipti
  // og síur skipta bara út.
  function syncUrl(push) {
    try {
      var u = new URL(location.href);
      u.searchParams.delete('sku');
      u.searchParams.delete('tab');
      if (state.tab === 'vara' && state.sku) u.searchParams.set('sku', state.sku);
      else if (state.tab !== 'vinsaelar') u.searchParams.set('tab', state.tab);
      if (u.toString() === location.href) return;
      if (push) history.pushState({ skr: 1 }, '', u.toString());
      else history.replaceState({ skr: (history.state && history.state.skr) || 0 }, '', u.toString());
    } catch (e) {}
  }

  function applyUrl() {
    var qs;
    try { qs = new URL(location.href).searchParams; } catch (e) { return; }
    var sku = (qs.get('sku') || '').trim();
    var tab = (qs.get('tab') || '').toLowerCase();
    if (sku) {
      if (state.tab !== 'vara') state.prevTab = state.tab;
      var same = sku === state.sku;
      state.sku = sku;
      if (!same) state.skuHint = '';
      showTab('vara');
      if (!same) loadProduct();
      return;
    }
    // listi/uppfletting/voruuppfletting: gömul bókamerki eftir 301.
    showTab(tab === 'listi' || tab === 'uppfletting' ? 'listi' : 'vinsaelar');
  }

  // ── ræsing ───────────────────────────────────────────────────────────
  function boot() {
    root = document.getElementById(MOUNT_ID);
    if (!root || root.getAttribute('data-booted') === '1') return;   // vörn gegn tvíræsingu
    root.setAttribute('data-booted', '1');

    if (!BASE || !KEY) {
      clear(root);
      root.appendChild(el('div', 'skr-err',
        'Vantar STORKAUP_CONFIG (supabaseUrl/publishableKey) í head-kóða síðunnar.'));
      return;
    }

    if (!document.getElementById('skr-style')) {
      var st = document.createElement('style'); st.id = 'skr-style'; st.textContent = CSS;
      document.head.appendChild(st);
      if (!document.querySelector('link[href*="IBM+Plex+Sans"]')) {
        var fl = document.createElement('link'); fl.rel = 'stylesheet';
        fl.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
        document.head.appendChild(fl);
      }
    }

    build();
    try { history.replaceState({ skr: 0 }, '', location.href); } catch (e) {}
    window.addEventListener('popstate', applyUrl);
    applyUrl();
    // Felur hleðsluskjá bootstrappsins strax í stað þess að bíða 2,5 sek.
    try { document.dispatchEvent(new CustomEvent('storkaup:page-ready')); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

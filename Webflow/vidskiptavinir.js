/**
 * Webflow/vidskiptavinir.js — sameinuð viðskiptavinasíða (áfangi 1, 2026-10-15)
 *
 * Á að leysa af hólmi þrjár síður sem gerðu að hluta það sama:
 *   /kpi/vidskiptavinur  (customer-profiles.js, 2.585 línur, markup í Designer)
 *   /kpi/forgangslisti   (forgangslisti.js)
 *   /kpi/activation      (activation.js, ókláruð)
 *
 * Notendur eru ALLIR starfsmenn, og algengasta erindið er að fletta upp
 * viðskiptavini og sjá hvað hann kaupir. Þess vegna er leitin efst og
 * vörulistinn fyrsti flipi prófílsins. Vinnulistinn og tækifærin eru
 * aukaflipar. Skissan: https://claude.ai/artifact/QFBBvhaREqpY8GyABy42Qq
 *
 * Eins og forgangslisti.js smíðar skráin ALLT sitt markup og alla stíla
 * sjálf. Webflow-Embed ber aðeins festinguna <div id="sk-vidskiptavinir">.
 * Þá er viðmótið í repoinu, ekki í Designer, og Embed-ið getur ekki farið
 * yfir 10.000 stafa mörkin.
 *
 * ── GÖGN ────────────────────────────────────────────────────────────
 * Ný RPC (core/sql/vidskiptavinir_v1.sql):
 *   search_customers_v1           leit: nafn, kennitala EÐA vörunúmer
 *   get_customer_card_v1          lykiltölur, fjölskyldan saman, utan vefs/vefur aðskilið
 *   get_customer_products_v1      vörulisti með virku tímabili (í stað shopping_list_v2)
 *   get_customer_touch_history_v1 snertisaga úr flaggasögunni
 *   get_my_staff_v1               innskráð netfang → sölumannsnafn (core/sql/kpi_staff_rep_v1.sql)
 * Fyrir (óbreytt):
 *   get_customer_last_orders, get_customer_priority_flags, get_active_sales_reps,
 *   set_customer_priority_flag, assign_customer_priority_rep,
 *   log_customer_priority_touch, get_web_activation,
 *   mv_customer_profiles_labeled_trends (REST)
 * GAS doPost (valfrjálst, aðeins ef gasWebAppUrl er stillt):
 *   list_templates, list_recipients, send_template_email
 *
 * Húsreglan: hvert kall fellur fyrir sig. Falli vörulistinn standa
 * lykiltölurnar; falli flöggin virkar leitin og prófíllinn samt.
 *
 * ── AUÐKENNING ──────────────────────────────────────────────────────
 * Webflow/auth.js (site-wide) skiptir publishableKey út fyrir JWT
 * innskráðs notanda og bætir authToken í GAS-köll. Hér er ekkert um það.
 *
 * KREFST (page-scoped head code, ALDREI site-wide):
 *   window.STORKAUP_CONFIG.supabaseUrl + .publishableKey
 *   window.STORKAUP_CONFIG.gasWebAppUrl   (valfrjálst: póstsending)
 */
(function () {
  "use strict";

  var MOUNT_ID = 'sk-vidskiptavinir';
  // SAMI lykill og forgangslisti.js: sá sem hefur valið sig þar er valinn hér.
  var ACTOR_KEY = 'storkaup:forgangslisti:actor';
  var RECENT_KEY = 'storkaup:vidskiptavinir:recent';
  var RECENT_MAX = 12;
  var STALE_DAYS = 30;

  var cfg = window.STORKAUP_CONFIG || {};
  var BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var KEY = cfg.publishableKey;
  var GAS_URL = cfg.gasWebAppUrl || '';

  // ── hjálparar ────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Handsmíðað: toLocaleString('is-IS') skilaði „316,529“ í Chrome á
  // Windows (vantar íslensk staðargögn) — þúsundir með punkti, aukastafir
  // með kommu, alltaf.
  function num(v, dec) {
    var n = Number(v);
    if (v == null || v === '' || isNaN(n)) return '–';
    var f = Math.pow(10, dec || 0);
    n = Math.round(n * f) / f;
    var parts = Math.abs(n).toString().split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '−' : '') + int + (parts[1] ? ',' + parts[1] : '');
  }

  function kt(v) {
    var s = String(v == null ? '' : v).replace(/\D/g, '');
    return s.length === 10 ? s.slice(0, 6) + '-' + s.slice(6) : String(v == null ? '' : v);
  }

  function flagKey(v) {
    var raw = String(v == null ? '' : v).trim();
    var digits = raw.replace(/\D/g, '');
    return digits !== '' ? digits : raw.toLowerCase();
  }

  function parseTs(v) {
    if (!v) return null;
    var t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  }

  function daysSince(v) {
    var t = parseTs(v);
    return t == null ? null : Math.floor((Date.now() - t) / 86400000);
  }

  function isoDate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function todayIso() { return isoDate(new Date()); }

  function plusDaysIso(n) {
    var d = new Date(); d.setDate(d.getDate() + n); return isoDate(d);
  }

  var MONTHS = ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ág.', 'sep.', 'okt.', 'nóv.', 'des.'];
  function fmtDate(v) {
    var t = parseTs(v);
    if (t == null) return '–';
    var d = new Date(t);
    var s = d.getDate() + '. ' + MONTHS[d.getMonth()];
    if (d.getFullYear() !== new Date().getFullYear()) s += ' ' + d.getFullYear();
    return s;
  }

  function fmtAgo(v) {
    var d = daysSince(v);
    if (d == null) return '–';
    if (d <= 0) return 'í dag';
    if (d === 1) return 'í gær';
    if (d < 60) return 'fyrir ' + d + ' d';
    return fmtDate(v);
  }

  function lhfsIs(label) {
    var l = String(label || '').toLowerCase();
    if (l === 'very high') return 'Mjög hátt';
    if (l === 'high') return 'Hátt';
    if (l === 'medium') return 'Miðlungs';
    if (l === 'low') return 'Lágt';
    return '–';
  }

  // Sölumannanöfn: sama hreinsun og forgangslisti.js (sjá skýringar þar).
  function repCanonicalKey(nameNorm) {
    var compact = String(nameNorm || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return '';
    var stripped = compact.replace(/solumadur/g, '').replace(/storkaup/g, '');
    return stripped || compact;
  }
  function repLabel(nameNorm) {
    var k = repCanonicalKey(nameNorm);
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : '';
  }
  function repChoiceScore(n) {
    n = String(n || '').toLowerCase();
    if (n.indexOf('solumadur') === 0) return 0;
    if (n.indexOf('storkaup') === 0) return 1;
    return 2;
  }
  function isPersonRep(nameNorm) {
    var compact = String(nameNorm || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var stripped = compact.replace(/solumadur/g, '').replace(/storkaup/g, '');
    return !!stripped && stripped !== 'vefur';
  }
  // Sölumenn búa stundum til eigin Magento-reikninga og nefna þá á mismunandi
  // vegu, svo LOGÍK ræður hver er sama manneskjan (2026-10-15):
  //   * sömu nöfn án solumadur/storkaup → sama manneskja (bjossisolumadur =
  //     solumadurbjossi), og sama @storkaup.is netfang → sama manneskja;
  //   * manneskja er hópur með AÐ MINNSTA KOSTI EITT @storkaup.is netfang.
  //     Sjálfsmíðuð afbrigði með example.com-innskráningu eingöngu
  //     (solumadurbirgir, solumadurvefur) birtast ekki í völunum;
  //   * vefrásin („vefur“) er ekki manneskja;
  //   * solumadur*-formið vinnur — það bera úthlutanirnar á forgangslistanum.
  // Gildi sem þegar er skráð en dettur út hér sýnir „(óvirkur)“ í valinu og
  // glatast ekki.
  function dedupeReps(rows) {
    var groups = {};          // person key -> { names: [], emails: [] }
    var keyByEmail = {};
    (rows || []).forEach(function (r) {
      var name = String(r && r.name_norm || '').trim().toLowerCase();
      var key = repCanonicalKey(name);
      if (!key || key === 'vefur') return;
      var email = String(r.email_norm || '').trim().toLowerCase();
      var staff = /@storkaup\.is$/.test(email) ? email : '';
      if (staff && keyByEmail[staff] && keyByEmail[staff] !== key) {
        // Sama netfang á tveimur lyklum: sameina í þann fyrri.
        key = keyByEmail[staff];
      }
      var g = groups[key] || (groups[key] = { names: [], emails: [] });
      if (g.names.indexOf(name) === -1) g.names.push(name);
      if (staff) { keyByEmail[staff] = key; if (g.emails.indexOf(staff) === -1) g.emails.push(staff); }
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      var best = g.names.slice().sort(function (a, b) {
        return (repChoiceScore(a) - repChoiceScore(b)) || (a < b ? -1 : 1);
      })[0];
      return { name_norm: best, names: g.names, emails: g.emails };
    }).filter(function (p) { return p.emails.length > 0; })
      .sort(function (a, b) { return repLabel(a.name_norm).localeCompare(repLabel(b.name_norm), 'is'); });
  }

  // Sama manneskja? Úthlutun getur borið annað afbrigði en það sem valið er.
  function samePerson(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return repCanonicalKey(a) === repCanonicalKey(b);
  }

  function loadJson(k, dflt) {
    try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? dflt : v; }
    catch (e) { return dflt; }
  }
  function saveJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ── gagnalag ─────────────────────────────────────────────────────────
  function headers(extra) {
    var h = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'api' };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function readError(res) {
    return res.text().then(function (t) {
      var m = 'HTTP ' + res.status;
      try { var j = JSON.parse(t); if (j && j.message) m += ' — ' + j.message; }
      catch (e) { if (t) m += ' — ' + t.slice(0, 200); }
      return Promise.reject(new Error(m));
    });
  }

  function rpc(fn, body) {
    return fetch(BASE + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', 'Content-Profile': 'api' }),
      body: JSON.stringify(body || {})
    }).then(function (res) { return res.ok ? res.json() : readError(res); });
  }

  function rest(path) {
    return fetch(BASE + '/rest/v1/' + path, { headers: headers() })
      .then(function (res) { return res.ok ? res.json() : readError(res); });
  }

  function gas(payload) {
    payload.key = cfg.gasKey || '';
    return fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  // ── ástand ───────────────────────────────────────────────────────────
  var state = {
    tab: 'lookup',          // lookup | work | opp
    query: '',
    searching: false,
    results: null,          // null = engin leit í gangi
    searchError: '',
    recent: loadJson(RECENT_KEY, []),
    flags: {},              // flagKey -> röð úr get_customer_priority_flags
    flagsOk: null,
    reps: [],
    actor: loadJson(ACTOR_KEY, ''),
    actorAuto: false,       // true = fundið út frá innskráðu netfangi
    authEmail: '',
    workChip: 'due',        // due | mine | all
    oppChip: 'lhfs',        // lhfs | never_ordered | lapsing | lapsed
    oppRows: {},            // chip -> röð | 'loading' | Error
    selectedId: '',
    selectedName: '',
    ptab: 'products',       // products | orders | touches
    days: '365',            // 90 | 365 | all
    pFilter: '',
    pSort: { key: 'order_count', dir: -1 },
    card: null, cardErr: '',
    products: null, productsErr: '',
    orders: null, ordersErr: '',
    touches: null, touchesErr: '',
    emailOpen: false, emailData: null, emailErr: '',
    // Drög lifa í ástandinu, ekki í DOM-inu: render() teiknar allt upp á nýtt
    // þegar gögn berast í bakgrunni, og þá mætti ekki hálfskrifuð athugasemd
    // hverfa.
    noteDraft: '', fuDraft: null, tmpl: '', lang: '',
    toast: null
  };

  var root;
  var searchSeq = 0;
  var profileSeq = 0;
  var searchTimer = null;

  // ── stílar ───────────────────────────────────────────────────────────
  var CSS = [
    '#' + MOUNT_ID + '{--ink:#17211D;--ink2:#33403A;--mute:#5E6A64;--line:#E1E5E0;--line2:#EEF0EC;--bg:#F3F4F1;--card:#FFFFFF;--acc:#17614A;--acc-bg:#E8F1EC;font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);font-size:15px;line-height:1.45}',
    '#' + MOUNT_ID + ' *{box-sizing:border-box}',
    '.skv-wrap{max-width:1360px;margin:0 auto;padding:0 20px}',
    '.skv-head{background:var(--card);border-bottom:1px solid var(--line)}',
    '.skv-head .skv-wrap{padding-top:16px;display:flex;flex-direction:column;gap:12px}',
    '.skv-toprow{display:flex;flex-wrap:wrap;gap:14px;align-items:center}',
    '.skv-title{margin:0;font-size:22px;font-weight:700}',
    '.skv-search{flex:1 1 360px;display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid #D5DAD5;border-radius:10px;padding:0 14px;min-height:46px}',
    '.skv-search input{flex:1;border:0;background:transparent;font:inherit;font-size:16px;padding:11px 0;outline:none;color:var(--ink);min-width:0}',
    '.skv-search:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px rgba(23,97,74,.15)}',
    '.skv-actor{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--mute)}',
    '.skv-sel{border:1px solid #D5DAD5;border-radius:8px;padding:7px 9px;background:#fff;font:inherit;font-size:14px;min-height:38px;color:var(--ink)}',
    '.skv-tabs{display:flex;flex-wrap:wrap;gap:22px}',
    '.skv-tab{border:0;background:transparent;font:inherit;font-size:15px;font-weight:500;padding:10px 2px;cursor:pointer;color:var(--mute);border-bottom:3px solid transparent;min-height:44px}',
    '.skv-tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--acc)}',
    '.skv-main{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;padding-top:18px;padding-bottom:40px}',
    '.skv-list{flex:1 1 360px;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}',
    '.skv-prof{flex:999 1 620px;min-width:0;display:flex;flex-direction:column;gap:16px}',
    '.skv-listhead{padding:12px 14px;border-bottom:1px solid #E6E9E5;display:flex;flex-direction:column;gap:10px}',
    '.skv-listhead h2{margin:0;font-size:15px;font-weight:600;display:flex;justify-content:space-between;gap:8px}',
    '.skv-listhead h2 span{font-weight:400;color:var(--mute);font-size:13px}',
    '.skv-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.skv-chip{border:1px solid #D5DAD5;background:#fff;font:inherit;font-size:13px;padding:6px 11px;border-radius:999px;cursor:pointer;color:var(--ink2);min-height:34px}',
    '.skv-chip[aria-pressed="true"]{background:var(--acc-bg);border-color:var(--acc);color:#0E4535;font-weight:600}',
    '.skv-rows{max-height:calc(100vh - 230px);overflow:auto}',
    '.skv-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 14px;border:0;border-bottom:1px solid #E6E9E5;background:#fff;width:100%;text-align:left;font:inherit;cursor:pointer;color:inherit}',
    '.skv-row:hover{background:#F7F8F5}',
    '.skv-row[aria-current="true"]{background:var(--acc-bg)}',
    '.skv-row b{font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.skv-row small{font-size:13px;color:var(--mute);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.skv-rowr{display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:12px;color:var(--mute);text-align:right}',
    '.skv-empty{padding:22px 16px;color:var(--mute);font-size:14px}',
    '.skv-err{padding:12px 14px;background:#FBEDEB;color:#8E2B22;font-size:14px}',
    '.skv-b{display:inline-block;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap}',
    '.skv-good{background:#DCEFE4;color:#14553F}.skv-warn{background:#FCE8D4;color:#8A4A10}.skv-bad{background:#F6DEDC;color:#8E2B22}.skv-mute{background:#ECEEEA;color:#4A5550}.skv-hot{background:var(--ink);color:#fff}',
    '.skv-due{color:#8A4A10;font-weight:600}',
    '.skv-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:14px}',
    '.skv-card0{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}',
    '.skv-ph{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-start}',
    '.skv-ph h2{margin:0;font-size:22px;font-weight:700}',
    '.skv-sub{font-size:14px;color:var(--mute)}',
    '.skv-mono{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace}',
    '.skv-btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.skv-btn{border:1px solid #C9D0CA;background:#fff;font:inherit;font-size:14px;font-weight:500;padding:8px 13px;border-radius:8px;cursor:pointer;color:var(--ink);min-height:40px;text-decoration:none;display:inline-flex;align-items:center}',
    '.skv-btn:hover{background:#F7F8F5}',
    '.skv-btn[disabled]{opacity:.5;cursor:default}',
    '.skv-pri{background:var(--acc);border-color:var(--acc);color:#fff}',
    '.skv-pri:hover{background:#0E4535}',
    '.skv-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.skv-kpi{background:#F7F8F5;border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:1px}',
    '.skv-kpi span{font-size:12px;color:var(--mute)}',
    '.skv-kpi strong{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums}',
    '.skv-kpi em{font-style:normal;font-size:12px;color:var(--mute)}',
    '.skv-opp{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;border:1px solid #D9E6DE;background:#F2F8F4;border-radius:10px;padding:13px 15px}',
    '.skv-opp strong{font-size:19px}',
    '.skv-ptabs{padding:12px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid #E6E9E5}',
    '.skv-ptab{border:1px solid #D5DAD5;background:#fff;font:inherit;font-size:14px;padding:7px 13px;border-radius:999px;cursor:pointer;color:var(--ink2);min-height:38px}',
    '.skv-ptab[aria-selected="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}',
    '.skv-tblwrap{overflow-x:auto}',
    '.skv-tbl{width:100%;border-collapse:collapse;font-size:14px}',
    '.skv-tbl th{text-align:left;font-weight:600;color:var(--mute);font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:9px 11px;border-bottom:1px solid #D5DAD5;white-space:nowrap}',
    '.skv-tbl th button{all:unset;cursor:pointer}',
    '.skv-tbl th button:focus-visible{outline:2px solid var(--acc)}',
    '.skv-tbl td{padding:10px 11px;border-bottom:1px solid var(--line2);vertical-align:top}',
    '.skv-tbl tr.skv-lapsed td{background:#FFF8F0}',
    '.skv-n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.skv-touchform{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;background:#F7F8F5;border-radius:10px;padding:12px;margin:14px}',
    '.skv-touchform label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--mute)}',
    '.skv-touchform textarea,.skv-touchform input{border:1px solid #D5DAD5;border-radius:8px;padding:8px;font:inherit;font-size:14px;color:var(--ink);background:#fff}',
    '.skv-ev{display:flex;gap:12px;border-bottom:1px solid var(--line2);padding:11px 14px}',
    '.skv-ev time{flex:0 0 92px;font-size:13px;color:var(--mute)}',
    '.skv-email{border-top:1px solid #E6E9E5;padding-top:12px;display:flex;flex-direction:column;gap:10px}',
    '.skv-toast{position:fixed;right:18px;bottom:18px;z-index:9999;padding:10px 14px;border-radius:8px;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.15);max-width:360px}',
    '.skv-toast-ok{background:#17211D;color:#fff}.skv-toast-err{background:#8E2B22;color:#fff}',
    '.skv-sr{position:absolute;left:-9999px}',
    '.skv-placeholder{background:var(--card);border:1px dashed #C9D0CA;border-radius:12px;padding:40px 24px;color:var(--mute);text-align:center}'
  ].join('\n');

  // ── teikning ─────────────────────────────────────────────────────────
  function render() {
    if (!root) return;
    var active = document.activeElement;
    var keepId = active && root.contains(active) && active.id ? active.id : '';
    var caret = null;
    try { caret = keepId ? [active.selectionStart, active.selectionEnd] : null; } catch (e) {}

    root.innerHTML =
      '<div class="skv-head"><div class="skv-wrap">' + renderTop() + renderTabs() + '</div></div>' +
      '<div class="skv-wrap skv-main">' +
        '<section class="skv-list" aria-label="Listi">' + renderList() + '</section>' +
        '<section class="skv-prof" aria-label="Viðskiptavinur">' + renderProfile() + '</section>' +
      '</div>' + renderToast();

    if (keepId) {
      var el = document.getElementById(keepId);
      if (el) { el.focus(); if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch (e) {} } }
    }
  }

  function renderTop() {
    var opts = '<option value="">Veldu…</option>' + state.reps.filter(function (r) { return isPersonRep(r.name_norm); })
      .map(function (r) {
        return '<option value="' + esc(r.name_norm) + '"' + (r.name_norm === state.actor ? ' selected' : '') + '>' + esc(repLabel(r.name_norm)) + '</option>';
      }).join('');
    return '<div class="skv-toprow">' +
      '<h1 class="skv-title">Viðskiptavinir</h1>' +
      '<label class="skv-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5550" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>' +
        '<span class="skv-sr">Leita að viðskiptavini</span>' +
        '<input id="skv-q" type="search" autocomplete="off" placeholder="Nafn, kennitala eða vörunúmer…" value="' + esc(state.query) + '"></label>' +
      (state.actorAuto
        ? '<span class="skv-actor" title="Fundið út frá innskráningu (' + esc(state.authEmail) + ')">Ég er <b style="color:var(--ink)">' + esc(repLabel(state.actor)) + '</b></span>'
        : '<label class="skv-actor">Ég er <select class="skv-sel" data-act="actor">' + opts + '</select></label>') +
      '</div>';
  }

  function dueRows() {
    return Object.keys(state.flags).map(function (k) { return state.flags[k]; })
      .filter(function (r) { return isDue(r) && (!state.actor || samePerson(r.assigned_rep_name_norm, state.actor)); });
  }

  function renderTabs() {
    var due = dueRows().length;
    function tab(id, label, extra) {
      return '<button class="skv-tab" role="tab" data-act="tab" data-v="' + id + '" aria-selected="' + (state.tab === id) + '">' + label + (extra || '') + '</button>';
    }
    return '<nav class="skv-tabs" role="tablist" aria-label="Hlutar">' +
      tab('lookup', 'Fletta upp') +
      tab('work', 'Vinnulistinn minn', due ? ' <span class="skv-b skv-warn">' + due + ' á eftir</span>' : '') +
      tab('opp', 'Tækifæri') +
      '</nav>';
  }

  function isDue(r) {
    if (!r || r.status !== 'priority') return false;
    if (r.next_followup_at) return String(r.next_followup_at) <= todayIso();
    if (r.onboarded_status === 'onboarded_selfserve') return false;
    var d = daysSince(r.last_contacted_at || r.created_at);
    return d == null || d >= STALE_DAYS;
  }

  function rowHtml(id, name, sub, badgeHtml, metaHtml) {
    return '<button class="skv-row" data-act="open" data-id="' + esc(id) + '" data-name="' + esc(name) + '"' +
      (flagKey(id) === flagKey(state.selectedId) ? ' aria-current="true"' : '') + '>' +
      '<span style="min-width:0"><b>' + esc(name || id) + '</b><small>' + sub + '</small></span>' +
      '<span class="skv-rowr">' + (badgeHtml || '') + (metaHtml ? '<span>' + metaHtml + '</span>' : '') + '</span></button>';
  }

  function webBadge(active) {
    return active ? '<span class="skv-b skv-good">Á vef</span>' : '<span class="skv-b skv-mute">Ekki á vef</span>';
  }

  function renderList() {
    if (state.tab === 'work') return renderWork();
    if (state.tab === 'opp') return renderOpp();

    if (state.query.trim().length >= 2) {
      var head = '<div class="skv-listhead"><h2>Leitarniðurstöður <span>' +
        (state.searching ? 'Leita…' : (state.results ? state.results.length + ' fundust' : '')) + '</span></h2></div>';
      if (state.searchError) return head + '<div class="skv-err">Leit mistókst: ' + esc(state.searchError) + '</div>';
      if (!state.results) return head + '<div class="skv-empty">Leita…</div>';
      if (!state.results.length) return head + '<div class="skv-empty">Ekkert fannst. Prófaðu hluta af nafni, kennitölu eða vörunúmer.</div>';
      return head + '<div class="skv-rows">' + state.results.map(function (r) {
        var sub = '<span class="skv-mono">' + esc(kt(r.customer_id)) + '</span>' + (r.match_note ? ' · ' + esc(r.match_note) : '');
        return rowHtml(r.customer_id, r.customer_name, sub, webBadge(r.webshop_active),
          r.lhfs_label && r.lhfs_label !== 'Low' ? 'Tækifæri: ' + esc(lhfsIs(r.lhfs_label)) : '');
      }).join('') + '</div>';
    }

    var head2 = '<div class="skv-listhead"><h2>Nýlega skoðað <span>' + state.recent.length + '</span></h2></div>';
    if (!state.recent.length) return head2 + '<div class="skv-empty">Leitaðu að viðskiptavini hér að ofan. Þeir sem þú skoðar birtast hér næst.</div>';
    return head2 + '<div class="skv-rows">' + state.recent.map(function (r) {
      var f = state.flags[flagKey(r.id)];
      return rowHtml(r.id, r.name, '<span class="skv-mono">' + esc(kt(r.id)) + '</span>',
        f && f.status === 'priority' ? '<span class="skv-b skv-hot">Í forgangi</span>' : '',
        'Skoðað ' + esc(fmtAgo(r.at)));
    }).join('') + '</div>';
  }

  function renderWork() {
    function chip(id, label) {
      return '<button class="skv-chip" data-act="workchip" data-v="' + id + '" aria-pressed="' + (state.workChip === id) + '">' + label + '</button>';
    }
    var all = Object.keys(state.flags).map(function (k) { return state.flags[k]; })
      .filter(function (r) { return r.status === 'priority'; });
    var mine = all.filter(function (r) { return !state.actor || samePerson(r.assigned_rep_name_norm, state.actor); });
    var rows = state.workChip === 'due' ? mine.filter(isDue) : state.workChip === 'mine' ? mine : all;
    rows = rows.slice().sort(function (a, b) {
      var fa = a.next_followup_at || '9999', fb = b.next_followup_at || '9999';
      if (isDue(a) !== isDue(b)) return isDue(a) ? -1 : 1;
      return fa < fb ? -1 : fa > fb ? 1 : String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'is');
    });
    var head = '<div class="skv-listhead"><h2>' + (state.actor ? 'Mínir í forgangi' : 'Í forgangi') + ' <span>' + rows.length + '</span></h2>' +
      (state.actor ? '' : '<div class="skv-sub">Veldu „Ég er“ efst til að sjá aðeins þína.</div>') +
      '<div class="skv-chips">' + chip('due', 'Þarf eftirfylgni') + chip('mine', state.actor ? 'Allir mínir' : 'Allir í forgangi') + chip('all', 'Allt fyrirtækið') + '</div></div>';
    if (state.flagsOk === null) return head + '<div class="skv-empty">Sæki forgangslistann…</div>';
    if (state.flagsOk === false) return head + '<div class="skv-err">Náði ekki í forgangslistann.</div>';
    if (!rows.length) return head + '<div class="skv-empty">' + (state.workChip === 'due' ? 'Ekkert komið á tíma. Vel gert.' : 'Enginn á listanum.') + '</div>';
    return head + '<div class="skv-rows">' + rows.map(function (r) {
      var due = isDue(r);
      var meta = r.next_followup_at ? 'Eftirfylgni ' + esc(fmtDate(r.next_followup_at)) :
        (r.last_contacted_at ? 'Snert ' + esc(fmtAgo(r.last_contacted_at)) : 'Aldrei snert');
      return rowHtml(r.customer_id || r.customer_family_id, r.customer_name,
        '<span class="skv-mono">' + esc(kt(r.customer_id || r.customer_family_id)) + '</span>' + (r.assigned_rep_name_norm ? ' · ' + esc(repLabel(r.assigned_rep_name_norm)) : ''),
        onboardBadge(r.onboarded_status), due ? '<span class="skv-due">' + meta + '</span>' : meta);
    }).join('') + '</div>';
  }

  function onboardBadge(s) {
    if (s === 'onboarded_selfserve') return '<span class="skv-b skv-good">Pantar sjálf/ur</span>';
    if (s === 'onboarded_rep_only') return '<span class="skv-b skv-warn">Sölumaður pantar á vef</span>';
    if (s === 'priority_pending') return '<span class="skv-b skv-bad">Ekki byrjað á vef</span>';
    return '';
  }

  var OPP = {
    lhfs: { label: 'Kaupa mikið utan vefs', help: 'Mest BC-sala utan vefs síðustu 365 daga, ×1,5 ef aldrei pantað á vef.' },
    never_ordered: { label: 'Aldrei pantað á vef', help: 'Með vefaðgang en engin vefpöntun.' },
    lapsing: { label: 'Að dofna á vef', help: 'Pöntuðu á vef en hafa hægt á sér.' },
    lapsed: { label: 'Hættir á vef', help: 'Pöntuðu á vef en ekki lengur.' }
  };

  function renderOpp() {
    var chips = Object.keys(OPP).map(function (id) {
      return '<button class="skv-chip" data-act="oppchip" data-v="' + id + '" aria-pressed="' + (state.oppChip === id) + '">' + OPP[id].label + '</button>';
    }).join('');
    var data = state.oppRows[state.oppChip];
    var head = '<div class="skv-listhead"><h2>Hverja á að tala við? <span>' + (Array.isArray(data) ? data.length : '') + '</span></h2>' +
      '<div class="skv-chips">' + chips + '</div><div class="skv-sub">' + esc(OPP[state.oppChip].help) + '</div></div>';
    if (!data || data === 'loading') return head + '<div class="skv-empty">Sæki…</div>';
    if (data instanceof Error) return head + '<div class="skv-err">Náði ekki í listann: ' + esc(data.message) + '</div>';
    if (!data.length) return head + '<div class="skv-empty">Enginn í þessum hópi.</div>';
    return head + '<div class="skv-rows">' + data.map(function (r) {
      var f = state.flags[flagKey(r.id)];
      var badge = f && f.status === 'priority' ? '<span class="skv-b skv-hot">Í forgangi</span>' : r.badge;
      return rowHtml(r.id, r.name, r.sub, badge, r.meta);
    }).join('') + '</div>';
  }

  // ── prófíll ──────────────────────────────────────────────────────────
  function renderProfile() {
    if (!state.selectedId) {
      return '<div class="skv-placeholder">Veldu viðskiptavin úr listanum eða leitaðu efst.<br>Vörunúmer í leitinni sýnir hverjir kaupa vöruna.</div>';
    }
    return renderCard() + renderPanel();
  }

  function flagFor(id) { return state.flags[flagKey(id)] || null; }

  function webStatus(c) {
    if (!c) return '';
    if (Number(c.web_orders_365d) > 0) return '<span class="skv-b skv-good">Pantar á vef</span>';
    if (c.webshop_active) return '<span class="skv-b skv-warn">Hætt á vef</span>';
    return '<span class="skv-b skv-bad">Aldrei pantað á vef</span>';
  }

  function oppWhy(c) {
    var off = Number(c.offline_orders_365d) || 0, web = Number(c.web_orders_365d) || 0;
    var total = off + web;
    if (!total) return 'Engar pantanir síðustu 365 daga.';
    var share = Math.round(web / total * 100);
    var s = off + ' pantanir utan vefs og ' + web + ' á vef síðustu 365 daga (' + share + '% á vef).';
    if (c.offline_interval_days) s += ' Pantar utan vefs á um ' + num(c.offline_interval_days, 0) + ' daga fresti.';
    return s;
  }

  function renderCard() {
    var c = state.card;
    var f = flagFor(state.selectedId);
    var name = (c && c.customer_name) || state.selectedName || state.selectedId;
    var isPri = f && f.status === 'priority';

    var repOpts = '<option value="">Enginn sölumaður</option>' + state.reps.map(function (r) {
      return '<option value="' + esc(r.name_norm) + '"' + (f && samePerson(f.assigned_rep_name_norm, r.name_norm) ? ' selected' : '') + '>' + esc(repLabel(r.name_norm)) + '</option>';
    }).join('');
    if (f && f.assigned_rep_name_norm && !state.reps.some(function (r) { return samePerson(r.name_norm, f.assigned_rep_name_norm); })) {
      repOpts += '<option value="' + esc(f.assigned_rep_name_norm) + '" selected>' + esc(repLabel(f.assigned_rep_name_norm)) + ' (óvirkur)</option>';
    }

    var fam = c && c.family_ids && c.family_ids.length > 1 ? ' · ' + c.family_ids.length + ' reikningar í fjölskyldu' : '';
    var html = '<div class="skv-card">' +
      '<div class="skv-ph"><div style="display:flex;flex-direction:column;gap:6px;min-width:0">' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><h2>' + esc(name) + '</h2>' + webStatus(c) +
          (isPri ? '<span class="skv-b skv-hot">Í forgangi</span>' : '') + '</div>' +
        '<span class="skv-sub"><span class="skv-mono">' + esc(kt(state.selectedId)) + '</span>' +
          (c && c.primary_category ? ' · ' + esc(c.primary_category) : '') + fam + '</span>' +
      '</div><div class="skv-btns">' +
        '<label class="skv-sr" for="skv-rep">Sölumaður</label><select id="skv-rep" class="skv-sel" data-act="rep">' + repOpts + '</select>' +
        (GAS_URL ? '<button class="skv-btn" data-act="email">Senda póst</button>' : '') +
        '<button class="skv-btn skv-pri" data-act="priority">' + (isPri ? 'Taka úr forgangi' : 'Setja í forgang') + '</button>' +
      '</div></div>';

    if (state.cardErr) {
      html += '<div class="skv-err">Náði ekki í lykiltölur: ' + esc(state.cardErr) + '</div>';
    } else if (!c) {
      html += '<div class="skv-sub">Sæki lykiltölur…</div>';
    } else {
      html += '<div class="skv-kpis">' +
        kpi('Pantanir utan vefs · 365 d', num(c.offline_orders_365d), c.last_offline_order ? 'síðast ' + fmtAgo(c.last_offline_order) : '') +
        kpi('Pantanir á vef · 365 d', num(c.web_orders_365d), c.last_web_order ? 'síðast ' + fmtAgo(c.last_web_order) : '') +
        kpi('Pantar á', c.offline_interval_days ? num(c.offline_interval_days, 0) + ' d fresti' : '–', 'utan vefs') +
        kpi('Síðasta pöntun', fmtAgo(maxDate(c.last_offline_order, c.last_web_order)), '') +
        '</div>' +
        '<div class="skv-opp"><div style="display:flex;flex-direction:column;gap:1px"><span class="skv-sub">Tækifæri</span><strong>' + esc(lhfsIs(c.lhfs_label)) + '</strong></div>' +
        '<div style="display:flex;flex-direction:column;gap:3px;flex:1 1 280px;min-width:0"><b>' + esc(c.recommended_action || 'Standard eftirfylgni') + '</b><span style="font-size:14px;color:var(--ink2)">' + esc(oppWhy(c)) + '</span></div></div>';
    }
    if (state.emailOpen) html += renderEmail();
    return html + '</div>';
  }

  function maxDate(a, b) {
    var ta = parseTs(a), tb = parseTs(b);
    if (ta == null) return b; if (tb == null) return a;
    return ta >= tb ? a : b;
  }

  function kpi(label, value, sub) {
    return '<div class="skv-kpi"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong>' + (sub ? '<em>' + esc(sub) + '</em>' : '') + '</div>';
  }

  function renderEmail() {
    var d = state.emailData;
    var h = '<div class="skv-email"><b>Senda póst</b>';
    if (state.emailErr) return h + '<div class="skv-err">' + esc(state.emailErr) + '</div></div>';
    if (!d) return h + '<div class="skv-sub">Sæki sniðmát og netföng…</div></div>';
    if (!d.users.length) return h + '<div class="skv-sub">Ekkert netfang skráð á þennan viðskiptavin.</div></div>';
    var cur = d.templates.filter(function (x) { return x.id === state.tmpl; })[0] || d.templates[0] || {};
    var t = d.templates.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur.id ? ' selected' : '') + '>' + esc(x.label || x.id) + '</option>'; }).join('');
    var langs = (cur.langs || ['is']).map(function (l) { return '<option value="' + esc(l) + '"' + (l === state.lang ? ' selected' : '') + '>' + esc(String(l).toUpperCase()) + '</option>'; }).join('');
    return h + '<div class="skv-btns"><label class="skv-sub">Sniðmát <select class="skv-sel" id="skv-tmpl" data-act="tmpl">' + t + '</select></label>' +
      '<label class="skv-sub">Tungumál <select class="skv-sel" id="skv-lang" data-act="lang">' + langs + '</select></label></div>' +
      '<div class="skv-tblwrap"><table class="skv-tbl"><tbody>' + d.users.map(function (u) {
        return '<tr><td>' + esc(u.name || '') + '</td><td class="skv-mono">' + esc(u.email) + '</td><td class="skv-n"><button class="skv-btn" data-act="send" data-email="' + esc(u.email) + '" data-uname="' + esc(u.name || '') + '">Senda</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function renderPanel() {
    function ptab(id, label) {
      return '<button class="skv-ptab" role="tab" data-act="ptab" data-v="' + id + '" aria-selected="' + (state.ptab === id) + '">' + label + '</button>';
    }
    var tools = '';
    if (state.ptab === 'products') {
      tools = '<div class="skv-btns">' +
        '<label class="skv-sr" for="skv-pf">Sía vörur</label><input id="skv-pf" class="skv-sel" type="search" placeholder="Sía vörur…" value="' + esc(state.pFilter) + '" style="min-width:160px">' +
        '<label class="skv-sr" for="skv-days">Tímabil</label><select id="skv-days" class="skv-sel" data-act="days">' +
          ['90', '365', 'all'].map(function (v) {
            var l = v === 'all' ? 'Öll saga' : 'Síðustu ' + v + ' dagar';
            return '<option value="' + v + '"' + (state.days === v ? ' selected' : '') + '>' + l + '</option>';
          }).join('') + '</select>' +
        '<button class="skv-btn" data-act="csv">Excel</button><button class="skv-btn" data-act="print">PDF</button></div>';
    }
    var body = state.ptab === 'products' ? renderProducts() : state.ptab === 'orders' ? renderOrders() : renderTouches();
    return '<div class="skv-card0"><div class="skv-ptabs"><div class="skv-btns" role="tablist">' +
      ptab('products', 'Vörulisti') + ptab('orders', 'Síðustu pantanir') + ptab('touches', 'Snertisaga') +
      '</div>' + tools + '</div>' + body + '</div>';
  }

  var PCOLS = [
    { key: 'sku', label: 'Vörunr.' },
    { key: 'product_name', label: 'Vara' },
    { key: 'category', label: 'Flokkur' },
    { key: 'order_count', label: 'Pantanir', n: true },
    { key: 'total_qty', label: 'Magn', n: true },
    { key: 'last_bought', label: 'Síðast keypt' },
    { key: 'last_unit_price', label: 'Síðasta verð', n: true },
    { key: 'on_web', label: 'Á vef' }
  ];

  function visibleProducts() {
    var list = (state.products || []).slice();
    var q = state.pFilter.trim().toLowerCase();
    if (q) list = list.filter(function (p) { return (p.sku + ' ' + p.product_name + ' ' + (p.category || '')).toLowerCase().indexOf(q) !== -1; });
    var k = state.pSort.key, dir = state.pSort.dir;
    list.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === 'number' || typeof y === 'number' || (!isNaN(Number(x)) && !isNaN(Number(y)) && x !== '' && y !== '' && x != null && y != null && k !== 'sku')) {
        return ((Number(x) || 0) - (Number(y) || 0)) * dir;
      }
      return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'is') * dir;
    });
    return list;
  }

  function renderProducts() {
    if (state.productsErr) return '<div class="skv-err">Náði ekki í vörulistann: ' + esc(state.productsErr) + '</div>';
    if (!state.products) return '<div class="skv-empty">Sæki vörulista…</div>';
    if (!state.products.length) return '<div class="skv-empty">Engin kaup skráð í BC á þessu tímabili.</div>';
    var list = visibleProducts();
    var lapsed = state.products.filter(function (p) { return p.lapsed; }).length;
    var th = PCOLS.map(function (c) {
      var arrow = state.pSort.key === c.key ? (state.pSort.dir > 0 ? ' ↑' : ' ↓') : '';
      return '<th' + (c.n ? ' class="skv-n"' : '') + ' aria-sort="' + (state.pSort.key === c.key ? (state.pSort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button data-act="psort" data-v="' + c.key + '">' + c.label + arrow + '</button></th>';
    }).join('');
    var rows = list.map(function (p) {
      var web = p.on_web
        ? (p.web_url ? '<a class="skv-b skv-good" href="' + esc(p.web_url) + '" target="_blank" rel="noopener">Á vef ↗</a>' : '<span class="skv-b skv-good">Á vef</span>')
        : '<span class="skv-b skv-warn">Ekki á vef</span>';
      var last = esc(fmtDate(p.last_bought)) + (p.lapsed ? '<br><span class="skv-b skv-warn" title="Keypt reglulega en ekki í ' + esc(daysSince(p.last_bought)) + ' daga">Hætt að kaupa?</span>' : '');
      return '<tr' + (p.lapsed ? ' class="skv-lapsed"' : '') + '><td class="skv-mono">' + esc(p.sku) + '</td><td style="font-weight:500">' + esc(p.product_name) + '</td>' +
        '<td style="color:var(--mute)">' + esc(p.category || '–') + '</td><td class="skv-n">' + num(p.order_count) + '</td>' +
        '<td class="skv-n">' + num(p.total_qty, 2) + (p.uom ? ' ' + esc(String(p.uom).toLowerCase()) : '') + '</td>' +
        '<td>' + last + '</td><td class="skv-n">' + (p.last_unit_price != null ? num(p.last_unit_price, 0) + ' kr.' : '–') + '</td><td>' + web + '</td></tr>';
    }).join('');
    var note = '<div class="skv-sub" style="padding:10px 14px">' + list.length + ' vörur' +
      (lapsed ? ' · <span class="skv-due">' + lapsed + ' keyptar reglulega en ekki nýlega</span>' : '') + ' · verð án VSK, úr síðasta reikningi</div>';
    return note + '<div class="skv-tblwrap"><table class="skv-tbl"><thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderOrders() {
    if (state.ordersErr) return '<div class="skv-err">Náði ekki í pantanir: ' + esc(state.ordersErr) + '</div>';
    if (!state.orders) return '<div class="skv-empty">Sæki pantanir…</div>';
    if (!state.orders.length) return '<div class="skv-empty">Engar pantanir fundust.</div>';
    return '<div class="skv-tblwrap"><table class="skv-tbl"><thead><tr><th>Dags.</th><th>Pöntun</th><th>Rás</th><th>Pantað af</th><th class="skv-n">Upphæð</th></tr></thead><tbody>' +
      state.orders.map(function (o) {
        var web = String(o.source || '').toLowerCase() === 'web';
        return '<tr><td>' + esc(fmtDate(o.purchase_date)) + '</td><td class="skv-mono">' + esc(o.order_id) + '</td>' +
          '<td>' + (web ? '<span class="skv-b skv-good">Vefur</span>' : '<span class="skv-b skv-mute">Utan vefs</span>') + '</td>' +
          '<td>' + esc(o.order_user || '–') + '</td><td class="skv-n">' + (o.total != null ? num(o.total, 0) + ' kr.' : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderTouches() {
    var f = flagFor(state.selectedId);
    var form;
    if (!f) {
      form = '<div class="skv-touchform"><span class="skv-sub" style="flex:1 1 260px">Snertiskráin fylgir forgangslistanum. Settu viðskiptavininn í forgang til að skrá snertingu.</span>' +
        '<button class="skv-btn skv-pri" data-act="priority">Setja í forgang</button></div>';
    } else {
      form = '<div class="skv-touchform">' +
        '<label style="flex:1 1 280px">Athugasemd<textarea id="skv-note" rows="2" placeholder="Hvað var rætt?">' + esc(state.noteDraft) + '</textarea></label>' +
        '<label>Næsta eftirfylgni<input id="skv-fu" type="date" value="' + esc(state.fuDraft != null ? state.fuDraft : (f.next_followup_at || '')) + '"></label>' +
        '<button class="skv-btn" data-act="fu" data-v="7">+7 d</button><button class="skv-btn" data-act="fu" data-v="30">+30 d</button>' +
        '<button class="skv-btn skv-pri" data-act="touch">Skrá snertingu</button>' +
        (state.actor ? '' : '<span class="skv-sub" style="flex-basis:100%">Veldu „Ég er“ efst svo snertingin sé merkt þér.</span>') +
        '</div>';
    }
    var list;
    if (state.touchesErr) list = '<div class="skv-err">Náði ekki í snertisöguna: ' + esc(state.touchesErr) + '</div>';
    else if (!state.touches) list = '<div class="skv-empty">Sæki snertisögu…</div>';
    else if (!state.touches.length) list = '<div class="skv-empty">Engin saga enn.</div>';
    else list = state.touches.map(function (t) {
      var who = t.by_name ? repLabel(t.by_name) || t.by_name : '';
      var txt = t.note_text || (t.kind === 'touch' ? 'Snerting skráð' : '');
      var fu = t.followup ? ' · eftirfylgni ' + fmtDate(t.followup) : '';
      return '<div class="skv-ev"><time datetime="' + esc(t.event_at) + '">' + esc(fmtDate(t.event_at)) + '</time><span style="display:flex;flex-direction:column;gap:2px"><span>' + esc(txt) + '</span>' +
        '<span class="skv-sub" style="font-size:12px">' + esc(who) + esc(fu) + '</span></span></div>';
    }).join('');
    return form + list;
  }

  function renderToast() {
    if (!state.toast) return '';
    return '<div class="skv-toast ' + (state.toast.err ? 'skv-toast-err' : 'skv-toast-ok') + '" role="status">' + esc(state.toast.msg) + '</div>';
  }

  var toastTimer = null;
  function toast(msg, err) {
    state.toast = { msg: msg, err: !!err };
    render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { state.toast = null; render(); }, err ? 6000 : 3000);
  }

  // ── aðgerðir ─────────────────────────────────────────────────────────
  function runSearch() {
    var q = state.query.trim();
    if (q.length < 2) { state.results = null; state.searching = false; render(); return; }
    var seq = ++searchSeq;
    state.searching = true; state.searchError = '';
    render();
    rpc('search_customers_v1', { p_q: q, p_limit: 40 }).then(function (rows) {
      if (seq !== searchSeq) return;
      state.results = rows || []; state.searching = false; render();
    }).catch(function (e) {
      if (seq !== searchSeq) return;
      state.searching = false; state.searchError = e.message; state.results = []; render();
    });
  }

  function remember(id, name) {
    var list = state.recent.filter(function (r) { return flagKey(r.id) !== flagKey(id); });
    list.unshift({ id: id, name: name || id, at: new Date().toISOString() });
    state.recent = list.slice(0, RECENT_MAX);
    saveJson(RECENT_KEY, state.recent);
  }

  function openCustomer(id, name) {
    id = String(id || '').trim();
    if (!id) return;
    var seq = ++profileSeq;
    state.selectedId = id;
    state.selectedName = name || '';
    state.card = null; state.cardErr = '';
    state.products = null; state.productsErr = '';
    state.orders = null; state.ordersErr = '';
    state.touches = null; state.touchesErr = '';
    state.emailOpen = false; state.emailData = null; state.emailErr = '';
    state.pFilter = '';
    state.noteDraft = ''; state.fuDraft = null;
    remember(id, name);
    try {
      var u = new URL(location.href); u.searchParams.set('customer', id);
      history.replaceState(null, '', u.toString());
    } catch (e) {}
    render();

    rpc('get_customer_card_v1', { p_customer_id: id }).then(function (c) {
      if (seq !== profileSeq) return;
      state.card = c || {};
      if (c && c.customer_name) { remember(id, c.customer_name); }
      render();
    }).catch(function (e) { if (seq === profileSeq) { state.cardErr = e.message; render(); } });

    loadProducts(seq);

    rpc('get_customer_last_orders', { p_customer_id: id, p_limit: 20 }).then(function (rows) {
      if (seq !== profileSeq) return;
      state.orders = (rows || []).sort(function (a, b) { return (parseTs(b.purchase_date) || 0) - (parseTs(a.purchase_date) || 0); });
      render();
    }).catch(function (e) { if (seq === profileSeq) { state.ordersErr = e.message; render(); } });

    loadTouches(seq);
  }

  function loadProducts(seq) {
    seq = seq || profileSeq;
    state.products = null; state.productsErr = '';
    rpc('get_customer_products_v1', {
      p_customer_id: state.selectedId,
      p_days_back: state.days === 'all' ? null : Number(state.days),
      p_limit: 500
    }).then(function (rows) {
      if (seq !== profileSeq) return;
      state.products = rows || []; render();
    }).catch(function (e) { if (seq === profileSeq) { state.productsErr = e.message; render(); } });
  }

  function loadTouches(seq) {
    seq = seq || profileSeq;
    rpc('get_customer_touch_history_v1', { p_customer_id: state.selectedId }).then(function (rows) {
      if (seq !== profileSeq) return;
      state.touches = rows || []; render();
    }).catch(function (e) { if (seq === profileSeq) { state.touchesErr = e.message; render(); } });
  }

  function loadFlags() {
    return rpc('get_customer_priority_flags', {}).then(function (rows) {
      var m = {};
      (rows || []).forEach(function (r) { m[r.customer_family_id || flagKey(r.customer_id)] = r; });
      state.flags = m; state.flagsOk = true; render();
    }).catch(function (e) { console.error('[vidskiptavinir] flags', e); state.flagsOk = false; render(); });
  }

  // Innskráð netfang úr JWT-inu sem auth.js geymir. Engin breyting á auth.js
  // þarf: Supabase setur `email` í payload-ið.
  function authEmail() {
    var a = window.STORKAUP_AUTH;
    if (!a || typeof a.getToken !== 'function') return Promise.resolve('');
    return Promise.resolve(a.getToken()).then(function (tok) {
      if (!tok) return '';
      try {
        var b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        var json = decodeURIComponent(atob(b).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return String(JSON.parse(json).email || '').toLowerCase();
      } catch (e) { return ''; }
    }).catch(function () { return ''; });
  }

  // „Hver er ég?“ — api.get_my_staff_v1 (core/sql/kpi_staff_rep_v1.sql) les
  // netfangið úr JWT-inu í gagnagrunninum og flettir upp tengdu sölumannsnafni
  // í raw.kpi_staff_access. Falli kallið (SQL-ið ekki keyrt) er netfangið
  // borið við email_norm sölumanna eins og áður.
  function whoAmI() {
    return rpc('get_my_staff_v1', {}).then(function (me) {
      return { email: (me && me.email) || '', rep: (me && me.rep_name_norm) || '', name: (me && me.display_name) || '' };
    }).catch(function () {
      return authEmail().then(function (e) { return { email: e, rep: '', name: '', fallback: true }; });
    });
  }

  function loadReps() {
    Promise.all([rpc('get_active_sales_reps', {}), whoAmI()]).then(function (r) {
      state.reps = dedupeReps(r[0]);
      var me = r[1];
      state.authEmail = me.email;
      // Sölumaður sem er skráður inn sem hann sjálfur er valinn sjálfkrafa,
      // og það vinnur vistað val (sem gæti verið frá öðrum á sömu tölvu).
      // Sameiginleg innskráning (t.d. umsokn@) finnur engan og handvalið gildir.
      var rep = me.rep;
      if (!rep && me.fallback && me.email) {
        var hit = state.reps.filter(function (x) { return x.emails.indexOf(me.email) !== -1; })[0];
        if (hit) rep = hit.name_norm;
      }
      if (rep) {
        // Kanónískt form: tengt nafn getur verið storkaup*-afbrigðið.
        var canon = state.reps.filter(function (x) { return repCanonicalKey(x.name_norm) === repCanonicalKey(rep); })[0];
        state.actor = canon ? canon.name_norm : rep;
        state.actorAuto = true;
      }
      render();
    }).catch(function (e) { console.error('[vidskiptavinir] reps', e); });
  }

  function loadOpp(chip) {
    if (Array.isArray(state.oppRows[chip]) || state.oppRows[chip] === 'loading') return;
    state.oppRows[chip] = 'loading';
    render();
    var p;
    if (chip === 'lhfs') {
      p = rest('mv_customer_profiles_labeled_trends?select=customer_id,customer_name,webshop_active,low_hanging_fruit_score,lhfs_label,orders_bc_365d,primary_category' +
        '&low_hanging_fruit_score=gt.0&order=low_hanging_fruit_score.desc&limit=200').then(function (rows) {
        return (rows || []).map(function (r) {
          return {
            id: r.customer_id, name: r.customer_name,
            sub: '<span class="skv-mono">' + esc(kt(r.customer_id)) + '</span>' + (r.primary_category ? ' · ' + esc(r.primary_category) : ''),
            badge: '<span class="skv-b ' + (r.lhfs_label === 'Very High' ? 'skv-hot' : 'skv-mute') + '">' + esc(lhfsIs(r.lhfs_label)) + '</span>',
            meta: num(r.orders_bc_365d) + ' reikningar · ' + (r.webshop_active ? 'á vef' : 'aldrei á vef')
          };
        });
      });
    } else {
      p = rpc('get_web_activation', { p_only_with_account: true, p_states: [chip] }).then(function (rows) {
        return (rows || []).map(function (r) {
          var d = r.days_since_last_order;
          return {
            id: r.customer_key, name: r.company_name,
            sub: '<span class="skv-mono">' + esc(kt(r.customer_key)) + '</span>' + (r.assigned_rep_name_norm ? ' · ' + esc(repLabel(r.assigned_rep_name_norm)) : ''),
            badge: '',
            meta: chip === 'never_ordered' ? 'Aldrei pantað' : (d != null ? 'Síðast á vef fyrir ' + d + ' d' : '')
          };
        }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'is'); });
      });
    }
    p.then(function (rows) { state.oppRows[chip] = rows; render(); })
      .catch(function (e) { state.oppRows[chip] = e; render(); });
  }

  function upsertFlagFromResponse(id, out) {
    // RPC-in skila jsonb; sækjum flöggin aftur í heild — eitt kall, og
    // onboarded_status er reiknað í SQL-inu, ekki hér.
    return loadFlags();
  }

  function togglePriority() {
    var id = state.selectedId;
    var f = flagFor(id);
    var name = (state.card && state.card.customer_name) || state.selectedName;
    var p;
    if (f && f.status === 'priority') {
      var reason = window.prompt('Af hverju á að taka „' + name + '“ úr forgangi? (vistast sem athugasemd)');
      if (reason == null) return;
      if (!reason.trim()) { toast('Ástæða er nauðsynleg.', true); return; }
      p = rpc('set_customer_priority_flag', { p_customer_id: id, p_status: 'nonpriority', p_customer_name: name, p_note: reason.trim() });
    } else {
      p = rpc('set_customer_priority_flag', { p_customer_id: id, p_status: 'priority', p_customer_name: name, p_note: null });
    }
    p.then(function (out) { return upsertFlagFromResponse(id, out); })
      .then(function () { toast(flagFor(id) && flagFor(id).status === 'priority' ? 'Sett í forgang.' : 'Tekinn úr forgangi.'); loadTouches(); })
      .catch(function (e) { toast('Mistókst: ' + e.message, true); });
  }

  function assignRep(rep) {
    var id = state.selectedId;
    var name = (state.card && state.card.customer_name) || state.selectedName;
    var call = function () { return rpc('assign_customer_priority_rep', { p_customer_id: id, p_assigned_rep_name_norm: rep || null }); };
    call().catch(function (e) {
      // Engin flaggröð enn: úthlutun setur í forgang fyrst, eins og hinar síðurnar.
      if (/not found/i.test(e.message) && rep) {
        return rpc('set_customer_priority_flag', { p_customer_id: id, p_status: 'priority', p_customer_name: name, p_note: null }).then(call);
      }
      throw e;
    }).then(function () { return loadFlags(); })
      .then(function () { toast(rep ? 'Sölumaður: ' + repLabel(rep) : 'Sölumaður fjarlægður.'); loadTouches(); })
      .catch(function (e) { toast('Mistókst: ' + e.message, true); render(); });
  }

  function logTouch() {
    var id = state.selectedId;
    var f = flagFor(id);
    var note = state.noteDraft.trim();
    var fu = state.fuDraft != null ? state.fuDraft : ((f && f.next_followup_at) || '');
    rpc('log_customer_priority_touch', {
      p_customer_id: id,
      p_note: note || null,
      p_next_followup_at: fu || null,
      p_by: state.actor || '',
      p_clear_followup: !fu
    }).then(function () { return loadFlags(); })
      .then(function () { state.noteDraft = ''; state.fuDraft = null; toast('Snerting skráð.'); loadTouches(); })
      .catch(function (e) { toast('Mistókst: ' + e.message, true); });
  }

  function openEmail() {
    state.emailOpen = !state.emailOpen;
    if (!state.emailOpen) { render(); return; }
    state.emailData = null; state.emailErr = '';
    render();
    var id = state.selectedId;
    Promise.all([gas({ action: 'list_templates' }), gas({ action: 'list_recipients', customer_id: id })])
      .then(function (r) {
        if (id !== state.selectedId) return;
        var t = r[0] || {}, u = r[1] || {};
        if (t.error || u.error) { state.emailErr = 'Villa: ' + (t.error || u.error); render(); return; }
        state.emailData = { templates: t.templates || [], users: u.users || [] };
        render();
      }).catch(function () { state.emailErr = 'Náði ekki sambandi við póstþjónustuna.'; render(); });
  }

  function sendEmail(email, uname) {
    var tSel = document.getElementById('skv-tmpl'), lSel = document.getElementById('skv-lang');
    var template = tSel ? tSel.value : '', lang = lSel ? lSel.value : 'is';
    var label = tSel ? (tSel.options[tSel.selectedIndex] || {}).text : template;
    if (!template) return;
    if (!window.confirm('Senda „' + label + '“ (' + lang.toUpperCase() + ') á ' + (uname ? uname + ' ' : '') + '<' + email + '>?')) return;
    gas({ action: 'send_template_email', template: template, customer_id: state.selectedId, to: email, lang: lang })
      .then(function (out) {
        if (out && out.ok) toast('Sent á ' + (out.sentTo || email));
        else if (out && out.error === 'recipient_not_in_customer') toast('Netfangið tilheyrir ekki þessum viðskiptavin.', true);
        else if (out && out.error === 'rate_limited') toast('Of margar sendingar í bili. Reyndu aftur síðar.', true);
        else toast('Sending mistókst' + (out && out.error ? ': ' + out.error : '.'), true);
      }).catch(function () { toast('Sending mistókst (net).', true); });
  }

  function exportCsv() {
    var list = visibleProducts();
    var cols = ['Vörunr.', 'Vara', 'Flokkur', 'Pantanir', 'Magn', 'Eining', 'Síðast keypt', 'Síðasta verð án VSK', 'Á vef', 'Hætt að kaupa?'];
    var cell = function (v) { var s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var dec = function (v) { return v == null ? '' : String(v).replace('.', ','); };
    var lines = [cols.join(';')].concat(list.map(function (p) {
      return [p.sku, p.product_name, p.category || '', p.order_count, dec(p.total_qty), p.uom || '', p.last_bought || '',
        dec(p.last_unit_price), p.on_web ? 'Já' : 'Nei', p.lapsed ? 'Já' : ''].map(cell).join(';');
    }));
    var name = ((state.card && state.card.customer_name) || state.selectedId).replace(/[^\wÀ-ÿ -]+/g, '').trim();
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Vörulisti - ' + name + ' - ' + todayIso() + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function printList() {
    var list = visibleProducts();
    var name = (state.card && state.card.customer_name) || state.selectedId;
    var period = state.days === 'all' ? 'Öll saga' : 'Síðustu ' + state.days + ' dagar';
    var w = window.open('', '_blank');
    if (!w) { toast('Vafrinn lokaði á nýjan glugga. Leyfðu sprettiglugga fyrir síðuna.', true); return; }
    var rows = list.map(function (p) {
      return '<tr><td>' + esc(p.sku) + '</td><td>' + esc(p.product_name) + '</td><td>' + esc(p.category || '') + '</td><td style="text-align:right">' + num(p.order_count) +
        '</td><td style="text-align:right">' + num(p.total_qty, 2) + ' ' + esc(String(p.uom || '').toLowerCase()) + '</td><td>' + esc(fmtDate(p.last_bought)) + '</td></tr>';
    }).join('');
    w.document.write('<!doctype html><html lang="is"><head><meta charset="utf-8"><title>Vörulisti – ' + esc(name) + '</title>' +
      '<style>body{font:11pt/1.4 Arial,sans-serif;margin:18mm;color:#111}h1{font-size:16pt;margin:0 0 4px}p{margin:0 0 14px;color:#555}' +
      'table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:9pt;text-transform:uppercase;color:#555}</style></head><body>' +
      '<h1>Vörulisti – ' + esc(name) + '</h1><p>' + esc(kt(state.selectedId)) + ' · ' + esc(period) + ' · ' + esc(fmtDate(new Date().toISOString())) + '</p>' +
      '<table><thead><tr><th>Vörunr.</th><th>Vara</th><th>Flokkur</th><th style="text-align:right">Pantanir</th><th style="text-align:right">Magn</th><th>Síðast keypt</th></tr></thead><tbody>' +
      rows + '</tbody></table><script>window.onload=function(){window.print();}<\/script></body></html>');
    w.document.close();
  }

  // ── atburðir ─────────────────────────────────────────────────────────
  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el || !root.contains(el)) return;
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    if (act === 'tab') {
      state.tab = v;
      if (v === 'opp') loadOpp(state.oppChip);
      render();
    } else if (act === 'open') {
      openCustomer(el.getAttribute('data-id'), el.getAttribute('data-name'));
    } else if (act === 'workchip') {
      state.workChip = v; render();
    } else if (act === 'oppchip') {
      state.oppChip = v; loadOpp(v); render();
    } else if (act === 'ptab') {
      state.ptab = v; render();
    } else if (act === 'psort') {
      if (state.pSort.key === v) state.pSort.dir *= -1;
      else state.pSort = { key: v, dir: (v === 'sku' || v === 'product_name' || v === 'category') ? 1 : -1 };
      render();
    } else if (act === 'priority') {
      togglePriority();
    } else if (act === 'touch') {
      logTouch();
    } else if (act === 'fu') {
      state.fuDraft = plusDaysIso(Number(v)); render();
    } else if (act === 'email') {
      openEmail();
    } else if (act === 'send') {
      sendEmail(el.getAttribute('data-email'), el.getAttribute('data-uname'));
    } else if (act === 'csv') {
      exportCsv();
    } else if (act === 'print') {
      printList();
    }
  }

  function onChange(e) {
    var el = e.target;
    var act = el.getAttribute('data-act');
    if (act === 'actor') {
      state.actor = el.value; saveJson(ACTOR_KEY, state.actor); render();
    } else if (act === 'rep') {
      assignRep(el.value);
    } else if (act === 'days') {
      state.days = el.value; loadProducts(); render();
    } else if (act === 'tmpl') {
      state.tmpl = el.value; state.lang = ''; render();
    } else if (act === 'lang') {
      state.lang = el.value;
    } else if (el.id === 'skv-fu') {
      state.fuDraft = el.value;
    }
  }

  var pfTimer = null;
  function onInput(e) {
    var el = e.target;
    if (el.id === 'skv-q') {
      state.query = el.value;
      if (state.tab !== 'lookup') state.tab = 'lookup';
      clearTimeout(searchTimer);
      if (state.query.trim().length < 2) { state.results = null; render(); return; }
      searchTimer = setTimeout(runSearch, 250);
    } else if (el.id === 'skv-note') {
      state.noteDraft = el.value;
    } else if (el.id === 'skv-pf') {
      state.pFilter = el.value;
      clearTimeout(pfTimer);
      pfTimer = setTimeout(function () {
        render();
        var pf = document.getElementById('skv-pf');
        if (pf) { pf.focus(); var n = pf.value.length; try { pf.setSelectionRange(n, n); } catch (x) {} }
      }, 150);
    }
  }

  function onKey(e) {
    if (e.target && e.target.id === 'skv-q' && e.key === 'Enter') {
      clearTimeout(searchTimer);
      var r = state.results;
      if (r && r.length === 1) openCustomer(r[0].customer_id, r[0].customer_name);
      else runSearch();
    }
  }

  // ── ræsing ───────────────────────────────────────────────────────────
  function boot() {
    root = document.getElementById(MOUNT_ID);
    if (!root || root.getAttribute('data-booted') === '1') return;   // vörn gegn tvíræsingu
    root.setAttribute('data-booted', '1');

    if (!BASE || !KEY) {
      root.innerHTML = '<div class="skv-err">Vantar STORKAUP_CONFIG (supabaseUrl/publishableKey) í head-kóða síðunnar.</div>';
      return;
    }

    if (!document.getElementById('skv-style')) {
      var st = document.createElement('style'); st.id = 'skv-style'; st.textContent = CSS;
      document.head.appendChild(st);
      var fl = document.createElement('link'); fl.rel = 'stylesheet';
      fl.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
      document.head.appendChild(fl);
    }

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);

    render();
    loadFlags();
    loadReps();

    var deep = '';
    try { deep = new URL(location.href).searchParams.get('customer') || ''; } catch (e) {}
    if (deep) openCustomer(deep, '');
    else if (state.recent.length) openCustomer(state.recent[0].id, state.recent[0].name);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

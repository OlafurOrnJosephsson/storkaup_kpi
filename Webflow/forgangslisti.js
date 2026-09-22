/**
 * Webflow/forgangslisti.js — vinnulisti sölumanna á /kpi/forgangslisti
 *
 * Hleðst úr jsDelivr inn í Webflow/forgangslisti-embed.html. Sú skel ber
 * ekkert nema festingu og script-tag; markup OG STÍLAR eru smíðaðir hér,
 * af sömu ástæðu og í portal.js: Webflow-Embed tekur 10.000 stafi og sker
 * afganginn þegjandi. Skel sem ber engan stíl getur ekki vaxið út fyrir.
 *
 * ── HVERS VEGNA ÞETTA KOM Í STAÐ GAMLA LISTANS ──────────────────────
 * Gamli forgangslistinn var customer-profiles.js keyrandi á Webflow-
 * teiknuðu markup-i með data-field reitum. Hann gat lesið en varla
 * skrifað: allar skriftir kröfðust `state.selected`, svo til að breyta
 * einni röð þurfti að opna prófílinn (sem FELDI listann), smella, fara
 * til baka og finna staðinn aftur. Fimm viðskiptavinir = fimm ferðir.
 *
 * Og hann sótti gögnin eins og hann væri að sýna alla viðskiptavini:
 * `fetchProfilesByCustomerIds` í bútum af ÁTTA með endurkvæmri helmingun
 * ef bútur féll, plús bakgrunnshleðslu á allt að 4.000 prófílum. Allur
 * listinn er 82 raðir. Mælt 2026-09-21: ein fyrirspurn skilar þeim öllum
 * á 574 ms. Bútunin var vörn gegn þungri sýn sem er ekki lengur til —
 * `mv_customer_profiles_labeled_trends` er materialíseruð.
 *
 * ── FLÖGGIN ERU HRYGGURINN, EKKI PRÓFÍLARNIR ────────────────────────
 * Gamli listinn byggði á prófílaröðunum og lagði flöggin ofan á. Það
 * þýðir að viðskiptavinur sem er flaggaður en vantar í MV-ið hverfur
 * þegjandi af forgangslistanum. Í dag er enginn slíkur (82 af 82 finnast)
 * en það er tilviljun, ekki trygging: MV-ið er endurbyggt eftir
 * `scheduledCustomerAnalysisSync_v1`, flöggin eru skrifuð héðan á
 * sekúndunni. Hér ræður flaggataflan röðunum og prófíllinn er skreyting
 * sem má vanta.
 *
 * ── ÞRJÚ KÖLL, HVERT FELLUR FYRIR SIG ───────────────────────────────
 *   api.get_customer_priority_flags     → raðirnar sjálfar (nauðsynlegt)
 *   api.get_active_sales_reps           → sölumannavalið (má falla)
 *   mv_customer_profiles_labeled_trends → sölutölurnar (má falla)
 * Falli sölumannakallið er valið bara núverandi gildi; falli MV-ið
 * standa raðirnar með striki í tölureitunum. Húsreglan er að síðan
 * verði að standa þótt aukafyrirspurn bregðist.
 *
 * ── SKRIFT UPPFÆRIR RÖÐINA, EKKI LISTANN ────────────────────────────
 * Gamla útfærslan kallaði `fetchPriorityFlags_()` eftir HVERJA skrift og
 * teiknaði allt upp á nýtt — sem lokaði spjaldinu sem verið var að vinna
 * í. Hér er svarinu frá RPC-inu skrifað beint í röðina í minni og aðeins
 * hún endurteiknuð. Fjöldaaðgerðir eru undantekningin: þær snerta margar
 * raðir í einu og sækja því flöggin aftur, sem er eitt kall.
 *
 * KREFST (page-scoped head code, ALDREI site-wide):
 *   window.STORKAUP_CONFIG.supabaseUrl + .publishableKey
 */
(function () {
  "use strict";

  var STALE_DAYS = 30;        // án skráðrar snertingar telst röð ógerð
  var ID_CHUNK = 250;         // hámark auðkenna í einni in.() fyrirspurn
  var HELP_SEEN_KEY = "storkaup:forgangslisti:help-seen";
  // Ný lykill, ekki sá gamli: gildið fór úr frjálsum upphafsstöfum í
  // `name_norm` sölumanns. Gamalt „ÓJ" væri merkingarlaust sem sölumaður.
  var ACTOR_KEY = "storkaup:forgangslisti:actor";
  var PROFILE_PAGE = "/kpi/vidskiptavinur";

  var CSS = [
    '#sk-forgangslisti{font-family:Arial,Helvetica,sans-serif;color:#1a1a1f;font-size:13px}',
    '#sk-forgangslisti *{box-sizing:border-box}',

    '.skf-help{border:1px solid #e3e3e8;border-radius:10px;background:#fff;margin-bottom:14px}',
    '.skf-help>summary{cursor:pointer;padding:10px 14px;font-size:12px;font-weight:700;',
    'color:#10069f;list-style:none;user-select:none}',
    '.skf-help>summary::-webkit-details-marker{display:none}',
    '.skf-help>summary::before{content:"▸ ";display:inline-block;transition:transform .15s}',
    '.skf-help[open]>summary::before{transform:rotate(90deg)}',
    '.skf-help-body{padding:0 14px 12px;font-size:12.5px;line-height:1.65;color:#3a3a42}',
    '.skf-help-body ol{margin:0 0 10px;padding-left:20px}',
    '.skf-help-body li{margin-bottom:3px}',
    '.skf-help-body p{margin:0 0 8px}',
    '.skf-help-body b{color:#1a1a1f}',
    '.skf-kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}',
    '.skf-kpi{border:1px solid #e3e3e8;border-radius:8px;padding:9px 14px;background:#fff;min-width:96px}',
    '.skf-kpi b{display:block;font-size:22px;line-height:1.15;margin-top:2px}',
    '.skf-kpi span{font-size:11px;color:#5c5c63;letter-spacing:.02em}',
    '.skf-kpi.is-due b{color:#8a1c12}',

    '.skf-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
    '.skf-chip{border:1px solid #e3e3e8;background:#fff;border-radius:16px;padding:5px 12px;',
    'font-size:12px;cursor:pointer;color:#1a1a1f;white-space:nowrap}',
    '.skf-chip:hover{background:#f7f7f9}',
    '.skf-chip.is-on{background:#10069f;border-color:#10069f;color:#fff}',
    '.skf-chip .skf-n{opacity:.65;margin-left:5px}',
    '.skf-search{flex:1 1 200px;min-width:160px;padding:7px 11px;font-size:13px;',
    'border:1px solid #e3e3e8;border-radius:8px}',
    '.skf-who{min-width:150px;padding:7px 9px;font-size:13px;border:1px solid #e3e3e8;',
    'border-radius:8px;background:#fff;font-family:inherit;color:#1a1a1f}',
    '.skf-who:invalid,.skf-who[data-empty="1"]{color:#8a8a92}',
    '.skf-count{font-size:12px;color:#5c5c63;white-space:nowrap}',

    '.skf-scroll{overflow-x:auto;border:1px solid #e3e3e8;border-radius:10px;background:#fff}',
    '.skf-head,.skf-row{display:grid;grid-template-columns:var(--skf-cols);align-items:center;',
    'gap:10px;padding:8px 14px;min-width:1240px}',
    '.skf-head{position:sticky;top:0;z-index:3;background:#f7f7f9;border-bottom:2px solid #e3e3e8}',
    '.skf-head div{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#5c5c63;',
    'font-weight:700;cursor:pointer;user-select:none}',
    '.skf-head div.skf-nosort{cursor:default}',
    '.skf-row{border-bottom:1px solid #f0f0f3}',
    '.skf-row:hover{background:#fafafc}',
    '.skf-row.is-due{background:#fffaf0;box-shadow:inset 3px 0 0 #e8a317}',
    '.skf-row.is-open{background:#f4f6ff}',
    '.skf-row.is-off{opacity:.55}',
    '.skf-name{display:flex;align-items:center;gap:6px;min-width:0}',
    '.skf-name-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.skf-num{text-align:right;font-variant-numeric:tabular-nums}',
    '.skf-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}',
    '.skf-dim{color:#8a8a92}',

    '.skf-ico{border:0;background:none;padding:2px;cursor:pointer;line-height:0;color:#5c5c63;border-radius:4px}',
    '.skf-ico:hover{background:#ececf1;color:#1a1a1f}',
    '.skf-ico svg{width:15px;height:15px;display:block}',
    '.skf-tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;',
    'font-weight:700;white-space:nowrap}',
    '.skf-ok{background:#e4f3e7;color:#1c6b32}.skf-warn{background:#fff3c4;color:#6b5600}',
    '.skf-bad{background:#fce8e6;color:#8a1c12}.skf-mute{background:#f0f0f3;color:#5c5c63}',
    '.skf-info{background:#e7ecfb;color:#1c3a8a}',

    '.skf-panel{grid-column:1/-1;padding:12px 14px 14px;background:#f4f6ff;',
    'border-bottom:1px solid #e3e3e8;min-width:1240px}',
    '.skf-panel-grid{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}',
    '.skf-fld{display:flex;flex-direction:column;gap:4px}',
    '.skf-fld>span{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#5c5c63;font-weight:700}',
    '.skf-panel input,.skf-panel select,.skf-panel textarea{padding:6px 9px;font-size:13px;',
    'border:1px solid #d7d7de;border-radius:6px;background:#fff;font-family:inherit;color:#1a1a1f}',
    '.skf-panel textarea{min-width:340px;min-height:58px;resize:vertical}',
    '.skf-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}',
    '.skf-btn{border:1px solid #10069f;background:#10069f;color:#fff;border-radius:6px;',
    'padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}',
    '.skf-btn:hover{background:#0b0475}',
    '.skf-btn[disabled]{opacity:.45;cursor:default}',
    '.skf-btn--ghost{background:#fff;color:#10069f}',
    '.skf-btn--ghost:hover{background:#eceaff}',
    '.skf-btn--warn{border-color:#8a1c12;background:#fff;color:#8a1c12}',
    '.skf-btn--warn:hover{background:#fce8e6}',
    '.skf-fb{font-size:12px;margin-top:8px;min-height:16px;color:#5c5c63}',
    '.skf-fb.is-err{color:#8a1c12}',
    '.skf-fb.is-ok{color:#1c6b32}',
    '.skf-meta{font-size:11px;color:#8a8a92;margin-top:8px;line-height:1.6}',

    '.skf-bulk{position:sticky;bottom:0;z-index:4;display:flex;flex-wrap:wrap;gap:8px;',
    'align-items:center;padding:10px 14px;background:#1a1a1f;color:#fff;border-radius:8px;',
    'margin-top:10px;font-size:12px}',
    '.skf-bulk select{padding:6px 9px;font-size:12px;border-radius:6px;border:0;font-family:inherit}',
    '.skf-bulk .skf-btn{border-color:#fff;background:#fff;color:#1a1a1f}',
    '.skf-bulk .skf-btn:hover{background:#e3e3e8}',
    '.skf-bulk-fb{margin-left:auto;opacity:.8}',

    '.skf-err{font-size:13px;color:#8a1c12;background:#fce8e6;padding:10px 12px;border-radius:8px}',
    '.skf-warnbar{font-size:12px;color:#6b5600;background:#fff3c4;padding:8px 12px;',
    'border-radius:8px;margin-bottom:10px}',
    '.skf-empty{padding:26px 14px;text-align:center;color:#8a8a92;font-style:italic}',
    '.skf-loading{padding:26px 14px;text-align:center;color:#5c5c63}',
    '.skf-note-pill{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;',
    'white-space:nowrap;font-size:11px;color:#5c5c63;font-style:italic}'
  ].join('');

  // Dálkarnir. `num` ræður hægri jöfnun OG tölulegri röðun.
  var COLS = [
    { key: 'customer_name',               label: 'Nafn',         w: 'minmax(210px,1.7fr)' },
    { key: 'customer_id',                 label: 'KT',           w: '1fr' },
    { key: 'webshop_active',              label: 'Vefur',        w: '.7fr' },
    { key: 'orders_bc_365d',              label: 'BC 365d',      w: '.62fr', num: true },
    { key: 'avg_days_between_bc_orders',  label: 'BC tíðni',     w: '.62fr', num: true },
    { key: 'orders_web_365d',             label: 'Vefur 365d',   w: '.62fr', num: true },
    { key: 'avg_days_between_web_orders', label: 'Vef tíðni',    w: '.62fr', num: true },
    { key: 'assigned_rep_name_norm',      label: 'Sölumaður',    w: '1fr' },
    { key: 'onboarded_status',            label: 'Staða',        w: '1fr' },
    { key: 'last_contacted_at',           label: 'Síðast snert', w: '.9fr' },
    { key: 'next_followup_at',            label: 'Eftirfylgni',  w: '.9fr' }
  ];
  var GRID_COLS = '26px 24px ' + COLS.map(function (c) { return c.w; }).join(' ');

  var CHIPS = [
    // Í VINNSLU ER SJÁLFGEFIÐ. Þeir sem eru komnir í sjálfsafgreiðslu eru
    // ekki verk — þeir eru sigrar — en þeir eru ÁFRAM Í TÖLUNNI. Það er
    // munurinn á að sía þá frá og að taka þá úr forgangi: hið síðara
    // fjarlægir þá úr bæði teljara og nefnara og myndi setja árangurinn
    // í núll á þeirri stundu sem hann er fullkominn.
    { key: 'inprogress',   label: 'Í vinnslu',        tip: 'Í forgangi en panta ekki sjálfir enn. Þetta er verkið.' },
    { key: 'all',          label: 'Allir',            tip: 'Allar raðir á listanum, sigrarnir með.' },
    { key: 'due',          label: 'Þarf eftirfylgni', tip: 'Eftirfylgnidagur runninn upp, eða engin snerting skráð í 30 daga. Þitt verk í dag.' },
    { key: 'pending',      label: 'Ekki í ferli',     tip: 'Engin vefpöntun síðustu 365 daga.' },
    { key: 'rep_only',     label: 'Í ferli',          tip: 'Pantað á vefnum, en sölumaður sló það inn.' },
    { key: 'selfserve',    label: 'Sjálfsafgreiðsla', tip: 'Viðskiptavinurinn pantar sjálfur. Markmiðinu er náð.' },
    { key: 'norep',        label: 'Án sölumanns',   tip: 'Í forgangi, ekki kominn í ferli og enginn ábyrgur. Ómannað verk.' },
    { key: 'web_inactive', label: 'Óvirkir á vef',  tip: 'Enginn vefaðgangur virkur.' },
    { key: 'web_active',   label: 'Virkir á vef',    tip: 'Vefaðgangur virkur — geta pantað strax.' },
    { key: 'nonpriority',  label: 'Ekki forgangur',   tip: 'Teknir af listanum.' }
  ];

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  var SVG_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var SVG_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';

  var state = {
    rows: [],          // flöggin sem hryggur, prófílgögn ofan á
    filtered: [],
    reps: [],
    chip: 'inprogress',   // sjálfgefið: bara ólokið — sjá CHIPS
    search: '',
    sortKey: 'next_followup_at',
    sortDir: 'asc',
    openKey: null,     // customer_family_id raðarinnar sem er opin
    selected: {},      // customer_family_id -> true
    actor: '',   // name_norm þess sem er að vinna listann
    profilesOk: true,
    repsOk: true
  };

  // ── litlir hjálparar ─────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function attr(s) { return esc(s).replace(/\s+/g, ' '); }

  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function fmtInt(v) {
    var n = Number(v);
    if (v == null || v === '' || isNaN(n)) return '–';
    return n.toLocaleString('is-IS', { maximumFractionDigits: 0 });
  }

  function isoDate(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function todayIso() { return isoDate(new Date()); }

  function parseTs(v) {
    if (!v) return null;
    var t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  }

  function daysSince(v) {
    var t = parseTs(v);
    if (t == null) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  // "12 d" frekar en dagsetning: talan sem skiptir máli er aldurinn.
  // Dagsetningin sjálf er í title-inu fyrir þann sem vill hana.
  function fmtAge(v) {
    var d = daysSince(v);
    if (d == null) return '<span class="skf-dim">aldrei</span>';
    if (d === 0) return 'í dag';
    if (d === 1) return 'í gær';
    return d + ' d';
  }

  function fmtDateShort(v) {
    var t = parseTs(v);
    if (t == null) return '';
    var d = new Date(t);
    return d.getDate() + '.' + (d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2);
  }

  function kt(v) {
    var s = String(v == null ? '' : v).replace(/\D/g, '');
    return s.length === 10 ? s.slice(0, 6) + '-' + s.slice(6) : String(v == null ? '' : v);
  }

  // Sami lykill og `set_customer_priority_flag` býr til úr p_customer_id.
  // Verður að haldast í takt við SQL-ið, annars skrifum við á ranga röð.
  function flagKey(v) {
    var raw = String(v == null ? '' : v).trim();
    var digits = raw.replace(/\D/g, '');
    return digits !== '' ? digits : raw.toLowerCase();
  }

  // ── SÖLUMANNANÖFN ───────────────────────────────────────────────────
  // `sales_reps_ref` ber 20 virkar raðir en 16 manneskjur: fjórir eiga tvö
  // nöfn, t.d. `solumadurhaddy` og `storkauphaddy`. Forskeytin tvö eru
  // hávaði úr innflutningi, svo þau eru strípuð til að þekkja sömu
  // manneskju. Sama bragð og customer-profiles.js notaði; þetta hverfur
  // ekki fyrr en taflan sjálf er lagfærð.
  //
  // ATH: hér er AÐEINS verið að velja hvað birtist og hvað má velja úr.
  // Raðirnar geyma áfram nákvæmlega það sem stendur í þeim, því nafnið er
  // líka notað til að þekkja pantanir sölumanna í `is_rep_order`.
  function repCanonicalKey(nameNorm) {
    var raw = String(nameNorm || '').trim().toLowerCase();
    if (!raw) return '';
    var compact = raw.replace(/[^a-z0-9]/g, '');
    var stripped = compact.replace(/solumadur/g, '').replace(/storkaup/g, '');
    return stripped || compact;
  }

  // Þegar tvö nöfn eiga sömu manneskju vinnur `solumadur*`-formið: það er
  // formið sem allar 44 úthlutuðu raðirnar bera í dag.
  function repChoiceScore(nameNorm) {
    var n = String(nameNorm || '').trim().toLowerCase();
    if (!n) return 99;
    if (n.indexOf('solumadur') === 0) return 0;
    if (n.indexOf('storkaup') === 0) return 1;
    return 2;
  }

  // „solumadurbjossi" er ekki nafn á manneskju. Strípað og hástafað er það
  // lesanlegt í dálki sem sölumaður skimar hundrað sinnum á dag.
  function repLabel(nameNorm) {
    var key = repCanonicalKey(nameNorm);
    if (!key) return '';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  // Er þetta manneskja? Sölumannalistinn ber tvennt sem er það ekki:
  //
  //   `solumadurstorkaup` — nafn sem er ekkert nema forskeytin tvö. Strípað
  //   stendur ekkert eftir, og það er prófið.
  //
  //   `vefur` — vefrásin sjálf (`salesperson_code = 'VEFUR'`), ekki maður.
  //
  // Bæði eru sía AÐEINS á undirskriftarvalinu. Úthlutunarvalið er látið
  // óhreyft: það er hegðun sem var fyrir og á ekki að breytast í þögn.
  function isPersonRep(nameNorm) {
    var compact = String(nameNorm || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    var stripped = compact.replace(/solumadur/g, '').replace(/storkaup/g, '');
    if (!stripped) return false;
    if (stripped === 'vefur') return false;
    return true;
  }

  function dedupeReps(rows) {
    var byKey = {};
    (rows || []).forEach(function (r) {
      var name = String(r && r.name_norm || '').trim().toLowerCase();
      if (!name) return;
      var key = repCanonicalKey(name);
      if (!key) return;
      var cur = byKey[key];
      if (!cur) { byKey[key] = { name_norm: name, email_norm: r.email_norm || '' }; return; }
      var a = repChoiceScore(cur.name_norm);
      var b = repChoiceScore(name);
      if (b < a || (b === a && name < cur.name_norm)) {
        byKey[key] = { name_norm: name, email_norm: r.email_norm || '' };
      }
    });
    return Object.keys(byKey).map(function (k) { return byKey[k]; })
      .sort(function (a, b) { return repLabel(a.name_norm).localeCompare(repLabel(b.name_norm), 'is'); });
  }

  // Speglar CASE-setninguna í api.get_customer_priority_flags. Hér til þess
  // að röð sem var að breytast geti sýnt rétta stöðu strax, án þess að
  // sækja allt aftur. Breytist CASE-ið í SQL-inu verður þetta að fylgja.
  function deriveOnboarded(r) {
    if (r.status !== 'priority') return 'nonpriority';
    if (r.first_selfserve_order_at) return 'onboarded_selfserve';
    if (r.first_web_order_at) return 'onboarded_rep_only';
    return 'priority_pending';
  }

  // Þarf eftirfylgni?
  //
  // Skráð eftirfylgnidagsetning ræður ein og sér — hún er skýr ákvörðun
  // einhvers og á að vinna hvað sem öðru líður. Að öðrum kosti telst röð
  // ógerð ef ekkert hefur gerst í 30 daga, mælt frá SÍÐUSTU SNERTINGU en
  // ekki flaggdeginum (gamla chippið mældi frá flaggdeginum og sagði því
  // að sölumaður sem hringdi í gær væri ósnertur).
  //
  // Sá sem er kominn í sjálfsafgreiðslu dettur út: markmiðinu er náð og
  // ekkert bíður nema einhver setji dagsetningu sjálfur.
  function isDue(r) {
    if (r.status !== 'priority') return false;
    if (r.next_followup_at) return String(r.next_followup_at) <= todayIso();
    if (r.onboarded_status === 'onboarded_selfserve') return false;
    var d = daysSince(r.last_contacted_at || r.created_at);
    return d == null || d >= STALE_DAYS;
  }

  function labelOnboarded(s) {
    if (s === 'onboarded_selfserve') return 'Sjálfsafgreiðsla';
    if (s === 'onboarded_rep_only') return 'Í ferli';
    if (s === 'priority_pending') return 'Ekki í ferli';
    if (s === 'nonpriority') return 'Ekki forgangur';
    return '–';
  }

  // Merkin eru fjögur orð sem þýða ekki það sem þau virðast þýða — helst
  // „Í ferli", sem er viðvörun en ekki áfangi. Skýringin á að vera á
  // merkinu sjálfu, ekki bara í spjaldinu efst.
  function titleOnboarded(s) {
    if (s === 'onboarded_selfserve') return 'Viðskiptavinurinn pantar sjálfur á vefnum. Markmiðinu er náð.';
    if (s === 'onboarded_rep_only') return 'Pantað hefur verið á vefnum, en sölumaður sló það inn. Vinnan færðist ekki af þér.';
    if (s === 'priority_pending') return 'Engin vefpöntun síðustu 365 daga. Hringja og kenna á vefinn.';
    if (s === 'nonpriority') return 'Tekinn af forgangslistanum.';
    return 'Óþekkt staða.';
  }

  function classOnboarded(s) {
    if (s === 'onboarded_selfserve') return 'skf-ok';
    if (s === 'onboarded_rep_only') return 'skf-info';
    if (s === 'priority_pending') return 'skf-warn';
    return 'skf-mute';
  }

  // ── gagnalag ─────────────────────────────────────────────────────────
  var cfg = window.STORKAUP_CONFIG || {};
  var BASE = cfg.supabaseUrl;
  var KEY = cfg.publishableKey;

  function apiHeaders(extra) {
    var h = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'api' };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  // Postgres-villan liggur í svarbolnum. Að kasta bara stöðunni gerði 500
  // að ráðgátu í portal.js; sama mistök ekki endurtekin hér.
  function readError(res) {
    return res.text().then(function (t) {
      var m = 'HTTP ' + res.status;
      try { var j = JSON.parse(t); if (j && j.message) m += ' — ' + j.message; }
      catch (e) { if (t) m += ' — ' + t.slice(0, 200); }
      var err = new Error(m);
      err.__status = res.status;
      err.__body = t;
      return Promise.reject(err);
    });
  }

  function rpc(fn, body) {
    return fetch(BASE + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json', 'Content-Profile': 'api' }),
      body: JSON.stringify(body || {})
    }).then(function (res) { return res.ok ? res.json() : readError(res); });
  }

  function fetchFlags() {
    return rpc('get_customer_priority_flags', {});
  }

  function fetchReps() {
    return rpc('get_active_sales_reps', {});
  }

  var PROFILE_FIELDS = [
    'customer_id', 'customer_name', 'webshop_active',
    'orders_bc_365d', 'orders_web_365d',
    'avg_days_between_bc_orders', 'avg_days_between_web_orders',
    'low_hanging_fruit_score', 'lhfs_label'
  ].join(',');

  // Ein fyrirspurn fyrir allan listann. Bútað í 250 aðeins svo slóðin
  // sprengi ekki lengdarmörk ef flöggin margfaldast — ekki sem vörn gegn
  // tímaþaki eins og í gamla kóðanum.
  function fetchProfiles(ids) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
    return Promise.all(chunks.map(function (chunk) {
      var inList = chunk.map(function (v) {
        return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      }).join(',');
      var qs = 'select=' + encodeURIComponent(PROFILE_FIELDS) +
               '&customer_id=in.(' + encodeURIComponent(inList) + ')' +
               '&limit=' + chunk.length;
      return fetch(BASE + '/rest/v1/mv_customer_profiles_labeled_trends?' + qs, {
        headers: apiHeaders(), cache: 'no-store'
      }).then(function (res) { return res.ok ? res.json() : readError(res); });
    })).then(function (lists) {
      return lists.reduce(function (a, b) { return a.concat(b || []); }, []);
    });
  }

  // Flaggaröð + prófílröð → ein röð. Flaggið ræður tilvist raðarinnar;
  // prófíllinn leggur til tölurnar og má vanta.
  function mergeRows(flags, profiles) {
    var byId = {};
    (profiles || []).forEach(function (p) { byId[flagKey(p.customer_id)] = p; });

    return (flags || []).map(function (f) {
      var key = String(f.customer_family_id || flagKey(f.customer_id));
      var p = byId[key] || byId[flagKey(f.customer_id)] || {};
      var r = {
        key: key,
        // Skrifin miða á customer_id raðarinnar, ekki fjölskyldulykilinn —
        // síðan keyrði á data-profile-scope="child" og gerði það sama.
        customer_id: f.customer_id || f.customer_family_id || '',
        customer_name: p.customer_name || f.customer_name || '(nafnlaus)',
        status: String(f.status || '').toLowerCase(),
        onboarded_status: String(f.onboarded_status || '').toLowerCase(),
        first_web_order_at: f.first_web_order_at || null,
        first_selfserve_order_at: f.first_selfserve_order_at || null,
        assigned_rep_name_norm: String(f.assigned_rep_name_norm || '').toLowerCase(),
        note: f.note || '',
        last_contacted_at: f.last_contacted_at || null,
        next_followup_at: f.next_followup_at || null,
        updated_by: f.updated_by || '',
        created_at: f.created_at || null,
        updated_at: f.updated_at || null,
        hasProfile: !!p.customer_id,
        webshop_active: p.webshop_active == null ? null : !!p.webshop_active,
        orders_bc_365d: p.orders_bc_365d,
        orders_web_365d: p.orders_web_365d,
        avg_days_between_bc_orders: p.avg_days_between_bc_orders,
        avg_days_between_web_orders: p.avg_days_between_web_orders,
        low_hanging_fruit_score: p.low_hanging_fruit_score,
        lhfs_label: p.lhfs_label || ''
      };
      r.due = isDue(r);
      return r;
    });
  }

  function matchesChip(r, chip) {
    if (chip === 'all') return true;
    if (chip === 'inprogress') {
      return r.status === 'priority' && r.onboarded_status !== 'onboarded_selfserve';
    }
    if (chip === 'due') return r.due;
    if (chip === 'pending') return r.onboarded_status === 'priority_pending';
    if (chip === 'rep_only') return r.onboarded_status === 'onboarded_rep_only';
    if (chip === 'selfserve') return r.onboarded_status === 'onboarded_selfserve';
    // „Án sölumanns“ þýðir ÓMANNAÐ VERK, ekki „reitur tómur“. Viðskiptavinur
    // sem er kominn í sjálfsafgreiðslu þarf engan sölumann. Sama skilgreining
    // og gamla kortið bar (20, ekki 37) — tölur sem heita það sama má
    // þesíða ekki telja sitt hvað.
    if (chip === 'norep') {
      return r.onboarded_status === 'priority_pending' && !r.assigned_rep_name_norm;
    }
    if (chip === 'web_active') return r.webshop_active === true;
    if (chip === 'web_inactive') return r.webshop_active === false;
    if (chip === 'nonpriority') return r.status === 'nonpriority';
    return true;
  }

  function chipCounts() {
    var out = {};
    CHIPS.forEach(function (c) { out[c.key] = 0; });
    state.rows.forEach(function (r) {
      CHIPS.forEach(function (c) { if (matchesChip(r, c.key)) out[c.key] += 1; });
    });
    return out;
  }

  function compareRows(a, b) {
    var k = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    var col = COLS.filter(function (c) { return c.key === k; })[0];

    if (col && col.num) {
      var an = Number(a[k]); if (isNaN(an)) an = -Infinity;
      var bn = Number(b[k]); if (isNaN(bn)) bn = -Infinity;
      if (an !== bn) return (an - bn) * dir;
      return String(a.customer_name).localeCompare(String(b.customer_name), 'is');
    }

    if (k === 'last_contacted_at') {
      // Aldrei snert = elst. null sem -Infinity setur þá fremst þegar
      // raðað er eftir "elst fyrst", sem er einmitt það sem á að vinna.
      var at = parseTs(a.last_contacted_at); if (at == null) at = -Infinity;
      var bt = parseTs(b.last_contacted_at); if (bt == null) bt = -Infinity;
      if (at !== bt) return (at - bt) * dir;
      return String(a.customer_name).localeCompare(String(b.customer_name), 'is');
    }

    if (k === 'next_followup_at') {
      // Sjálfgefna röðunin. Þeir sem eru á tíma koma fyrst í dagsetningar-
      // röð; raðir án dagsetningar fara aftast en ÞÆR SEM ERU Í EINDAGA
      // fara fremst óháð því, því listinn er verkefnalisti.
      var ad = a.next_followup_at || (a.due ? '0000-00-00' : '9999-12-31');
      var bd = b.next_followup_at || (b.due ? '0000-00-00' : '9999-12-31');
      if (ad !== bd) return (ad < bd ? -1 : 1) * dir;
      return String(a.customer_name).localeCompare(String(b.customer_name), 'is');
    }

    if (k === 'webshop_active') {
      var av = a.webshop_active === true ? 1 : (a.webshop_active === false ? 0 : -1);
      var bv = b.webshop_active === true ? 1 : (b.webshop_active === false ? 0 : -1);
      if (av !== bv) return (av - bv) * dir;
      return String(a.customer_name).localeCompare(String(b.customer_name), 'is');
    }

    if (k === 'assigned_rep_name_norm') {
      // Raðað eftir því sem stendur á skjánum. Hráu gildin myndu raða
      // „storkauphaddy" langt frá „solumadurhaddy" þótt sami maður eigi þau.
      var al = repLabel(a.assigned_rep_name_norm);
      var bl = repLabel(b.assigned_rep_name_norm);
      if (al !== bl) return al.localeCompare(bl, 'is') * dir;
      return String(a.customer_name).localeCompare(String(b.customer_name), 'is');
    }

    var as = String(a[k] == null ? '' : a[k]);
    var bs = String(b[k] == null ? '' : b[k]);
    return as.localeCompare(bs, 'is') * dir;
  }

  function applyFilters() {
    var q = state.search.trim().toLowerCase();
    var qDigits = q.replace(/\D/g, '');
    state.filtered = state.rows.filter(function (r) {
      if (!matchesChip(r, state.chip)) return false;
      if (!q) return true;
      if (String(r.customer_name).toLowerCase().indexOf(q) !== -1) return true;
      if (qDigits && String(r.customer_id).replace(/\D/g, '').indexOf(qDigits) !== -1) return true;
      if (r.note && r.note.toLowerCase().indexOf(q) !== -1) return true;
      return false;
    });
    state.filtered.sort(compareRows);
  }

  function rowByKey(key) {
    for (var i = 0; i < state.rows.length; i += 1) {
      if (state.rows[i].key === key) return state.rows[i];
    }
    return null;
  }

  function selectedKeys() {
    return Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
  }

  // ── teikning ─────────────────────────────────────────────────────────
  function kpisHtml() {
    var prio = state.rows.filter(function (r) { return r.status === 'priority'; });
    var n = function (f) { return prio.filter(f).length; };
    var selfserve = n(function (r) { return r.onboarded_status === 'onboarded_selfserve'; });
    var repOnly = n(function (r) { return r.onboarded_status === 'onboarded_rep_only'; });
    var pending = n(function (r) { return r.onboarded_status === 'priority_pending'; });
    var norep = n(function (r) { return r.onboarded_status === 'priority_pending' && !r.assigned_rep_name_norm; });
    var due = n(function (r) { return r.due; });
    var conv = prio.length ? Math.round((selfserve / prio.length) * 100) : 0;

    var cards = [
      ['Í forgangi', prio.length, ''],
      ['Sjálfsafgreiðsla', selfserve, ''],
      ['Í ferli', repOnly, ''],
      ['Ekki í ferli', pending, ''],
      ['Án sölumanns', norep, ''],
      ['Þarf eftirfylgni', due, due > 0 ? ' is-due' : ''],
      ['Árangur', conv + '%', '']
    ];
    return '<div class="skf-kpis">' + cards.map(function (c) {
      return '<div class="skf-kpi' + c[2] + '"><span>' + esc(c[0]) + '</span><b>' + esc(c[1]) + '</b></div>';
    }).join('') + '</div>';
  }

  function barHtml() {
    var counts = chipCounts();
    var chips = CHIPS.map(function (c) {
      return '<button type="button" class="skf-chip' + (state.chip === c.key ? ' is-on' : '') +
        '" data-chip="' + c.key + '" title="' + attr(c.tip || '') + '">' + esc(c.label) +
        '<span class="skf-n">' + counts[c.key] + '</span></button>';
    }).join('');
    return '<div class="skf-bar">' + chips + '</div>' +
      '<div class="skf-bar">' +
        '<input class="skf-search" data-search type="search" placeholder="Leita — nafn, kennitala eða athugasemd" value="' + attr(state.search) + '">' +
        whoHtml() +
        '<span class="skf-count" data-count></span>' +
      '</div>';
  }

  // Hver er að vinna listann. Var frjáls innsláttur („ÓJ", „oj", „Ólafur"
  // — sami maður, þrjú gildi); er nú val úr sömu sölumannaröð og
  // úthlutunin notar. Gildið er `name_norm`, svo `updated_by` verður
  // samanburðarhæft við `assigned_rep_name_norm`: hægt að spyrja síðar
  // hvort sá sem á viðskiptavininn hafi í raun hringt.
  //
  // Falli sölumannakallið er engan lista að velja úr. Þá kemur gamli
  // innslátturinn aftur frekar en tómur fellilisti — betra að geta skrifað
  // eitthvað en ekkert.
  function whoHtml() {
    var title = 'Fylgir hverri snertingu sem þú skráir. Síðan veit ekki hver ' +
                'þú ert — þetta er undirskrift, ekki innskráning.';
    if (!state.repsOk || !state.reps.length) {
      return '<input class="skf-who" data-actor-text type="text" maxlength="24" ' +
        'placeholder="Hver ert þú?" title="' + attr(title) + '" value="' + attr(state.actor) + '">';
    }
    var opts = ['<option value="">Hver ert þú?</option>'];
    state.reps.forEach(function (r) {
      var v = String(r.name_norm || '').trim();
      if (!v || !isPersonRep(v)) return;
      opts.push('<option value="' + attr(v) + '"' + (v === state.actor ? ' selected' : '') +
        '>' + esc(repLabel(v)) + '</option>');
    });
    return '<select class="skf-who" data-actor title="' + attr(title) + '"' +
      (state.actor ? '' : ' data-empty="1"') + '>' + opts.join('') + '</select>';
  }

  function headHtml() {
    var all = state.filtered.length > 0 && state.filtered.every(function (r) { return state.selected[r.key]; });
    var cells = COLS.map(function (c) {
      var on = c.key === state.sortKey;
      var arrow = on ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return '<div data-sort="' + c.key + '"' + (c.num ? ' class="skf-num"' : '') + '>' +
        esc(c.label) + arrow + '</div>';
    }).join('');
    return '<div class="skf-head">' +
      '<div class="skf-nosort"><input type="checkbox" data-all' + (all ? ' checked' : '') +
        ' title="Velja allar síaðar raðir"></div>' +
      '<div class="skf-nosort"></div>' + cells + '</div>';
  }

  function repOptions(current) {
    var cur = String(current || '').toLowerCase();
    var curKey = repCanonicalKey(cur);
    var seenKey = {};
    var opts = ['<option value="">— enginn —</option>'];
    state.reps.forEach(function (r) {
      var v = String(r.name_norm || '').trim();
      if (!v) return;
      var k = repCanonicalKey(v);
      seenKey[k] = true;
      // Ber röðin hitt nafnið á sömu manneskju helst valið á ÞVÍ nafni.
      // Annars myndi vistun skrifa yfir með öðrum rithætti án tilefnis.
      var value = (k === curKey && cur) ? cur : v;
      opts.push('<option value="' + attr(value) + '"' + (k === curKey ? ' selected' : '') +
        '>' + esc(repLabel(v)) + '</option>');
    });
    // Sölumaður sem er skráður á röðina en hvergi í virka listanum má ekki
    // hverfa úr valinu — þá liti röðin út fyrir að vera án sölumanns.
    if (cur && !seenKey[curKey]) {
      opts.push('<option value="' + attr(cur) + '" selected>' + esc(repLabel(cur)) + ' (óvirkur)</option>');
    }
    return opts.join('');
  }

  function rowHtml(r) {
    var open = state.openKey === r.key;
    var cls = 'skf-row' +
      (r.due ? ' is-due' : '') +
      (open ? ' is-open' : '') +
      (r.status === 'nonpriority' ? ' is-off' : '');

    var web = r.webshop_active == null
      ? '<span class="skf-dim">–</span>'
      : '<span class="skf-tag ' + (r.webshop_active ? 'skf-ok' : 'skf-bad') + '">' +
        (r.webshop_active ? 'Virkur' : 'Óvirkur') + '</span>';

    var fu = r.next_followup_at
      ? '<span class="skf-tag ' + (String(r.next_followup_at) <= todayIso() ? 'skf-warn' : 'skf-mute') + '">' +
        esc(fmtDateShort(r.next_followup_at)) + '</span>'
      : '<span class="skf-dim">–</span>';

    var html = '<div class="' + cls + '" data-row="' + attr(r.key) + '">' +
      '<div><input type="checkbox" data-pick="' + attr(r.key) + '"' +
        (state.selected[r.key] ? ' checked' : '') + '></div>' +
      '<div><button type="button" class="skf-ico" data-toggle="' + attr(r.key) + '" ' +
        'title="Aðgerðir" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        (open ? SVG_DOWN : SVG_OPEN) + '</button></div>' +
      '<div class="skf-name">' +
        '<a class="skf-ico" href="' + PROFILE_PAGE + '?customer=' + encodeURIComponent(r.customer_id) +
          '" title="Opna fullan prófíl">' + SVG_EYE + '</a>' +
        '<span class="skf-name-txt" title="' + attr(r.customer_name) + '">' + esc(r.customer_name) + '</span>' +
      '</div>' +
      '<div class="skf-mono">' + esc(kt(r.customer_id)) + '</div>' +
      '<div>' + web + '</div>' +
      '<div class="skf-num">' + fmtInt(r.orders_bc_365d) + '</div>' +
      '<div class="skf-num">' + fmtInt(r.avg_days_between_bc_orders) + '</div>' +
      '<div class="skf-num">' + fmtInt(r.orders_web_365d) + '</div>' +
      '<div class="skf-num">' + fmtInt(r.avg_days_between_web_orders) + '</div>' +
      '<div' + (r.assigned_rep_name_norm ? ' title="' + attr(r.assigned_rep_name_norm) + '"' : '') + '>' +
        (r.assigned_rep_name_norm
          ? esc(repLabel(r.assigned_rep_name_norm))
          : '<span class="skf-dim">–</span>') + '</div>' +
      '<div><span class="skf-tag ' + classOnboarded(r.onboarded_status) + '" title="' +
        attr(titleOnboarded(r.onboarded_status)) + '">' +
        esc(labelOnboarded(r.onboarded_status)) + '</span></div>' +
      '<div title="' + attr(r.last_contacted_at || '') + '">' + fmtAge(r.last_contacted_at) + '</div>' +
      '<div>' + fu + '</div>' +
      '</div>';

    if (open) html += panelHtml(r);
    return html;
  }

  function panelHtml(r) {
    var inPrio = r.status === 'priority';
    var meta = [];
    if (r.created_at) meta.push('Flaggað ' + fmtDateShort(r.created_at));
    if (r.last_contacted_at) {
      meta.push('síðast snert ' + fmtDateShort(r.last_contacted_at) +
        (r.updated_by ? ' af ' + esc(repLabel(r.updated_by) || r.updated_by) : ''));
    }
    if (!r.hasProfile) meta.push('engin prófílröð í MV — tölur vantar');

    return '<div class="skf-panel" data-panel="' + attr(r.key) + '">' +
      '<div class="skf-panel-grid">' +
        '<label class="skf-fld"><span>Sölumaður</span>' +
          '<select data-rep>' + repOptions(r.assigned_rep_name_norm) + '</select></label>' +
        '<label class="skf-fld"><span>Næsta eftirfylgni</span>' +
          '<input type="date" data-followup value="' + attr(r.next_followup_at || '') + '"></label>' +
        '<label class="skf-fld" style="flex:1 1 340px"><span>Athugasemd</span>' +
          '<textarea data-note placeholder="Hvað var gert, hvað er næst">' + esc(r.note) + '</textarea></label>' +
      '</div>' +
      '<div class="skf-acts">' +
        '<button type="button" class="skf-btn" data-act="touch">Skrá snertingu</button>' +
        '<button type="button" class="skf-btn skf-btn--ghost" data-act="snooze7">Eftirfylgni +7 d</button>' +
        '<button type="button" class="skf-btn skf-btn--ghost" data-act="snooze30">+30 d</button>' +
        '<button type="button" class="skf-btn ' + (inPrio ? 'skf-btn--warn' : 'skf-btn--ghost') +
          '" data-act="flag" title="' +
          (inPrio ? attr('Fyrir þá sem ætla sér ekki á vefinn — samningur, sérverð, annar farvegur. '
                       + 'EKKI fyrir þá sem eru búnir; þeir fara af listanum sjálfir.')
                 : attr('Setja aftur í forgang.')) + '">' +
          (inPrio ? 'Ekki markmið' : 'Setja í forgang') + '</button>' +
      '</div>' +
      '<div class="skf-fb" data-fb></div>' +
      (meta.length ? '<div class="skf-meta">' + meta.join(' · ') + '</div>' : '') +
      '</div>';
  }

  function bulkHtml() {
    var n = selectedKeys().length;
    if (!n) return '';
    return '<div class="skf-bulk">' +
      '<b>' + n + ' ' + (n === 1 ? 'valinn' : 'valdir') + '</b>' +
      '<button type="button" class="skf-btn" data-bulk="priority">Í forgang</button>' +
      '<button type="button" class="skf-btn" data-bulk="nonpriority">Úr forgangi</button>' +
      '<select data-bulk-rep><option value="">Úthluta sölumanni…</option>' +
        repOptions('').replace('<option value="">— enginn —</option>',
                               '<option value="__none__">— taka af —</option>') + '</select>' +
      '<button type="button" class="skf-btn" data-bulk="rep">Úthluta</button>' +
      '<button type="button" class="skf-btn" data-bulk="clear">Hreinsa val</button>' +
      '<span class="skf-bulk-fb" data-bulk-fb></span>' +
      '</div>';
  }

  // Leiðbeiningarnar sitja Í tólinu, ekki í skjali sem enginn opnar aftur.
  // Samanbrotnar sjálfkrafa eftir fyrstu heimsókn — sá sem kann þetta á
  // ekki að þurfa að horfa á það daglega, og sá sem gleymir finnur það.
  //
  // Orðalagið er sölumannanna eigin, úr verklagsskjalinu: „vefinnleiðing",
  // „onboarding", vörulistinn í prófílnum.
  function helpHtml(openByDefault) {
    return '<details class="skf-help"' + (openByDefault ? ' open' : '') + ' data-help>' +
      '<summary>Hvernig á að vinna listann</summary>' +
      '<div class="skf-help-body">' +
        '<p>Forgangslistinn er vinnulisti fyrir onboarding á viðskiptavinum — ' +
        'ekki skýrsla. Hann opnast á <b>Í vinnslu</b>: þeim sem eru í forgangi en ' +
        'panta ekki sjálfir enn. Vinnaðu ofan frá, eða smelltu á ' +
        '<b>Þarf eftirfylgni</b> til að sjá bara það sem er á dagskrá í dag.</p>' +
        '<ol>' +
          '<li>Smelltu á örina vinstra megin í röðinni. Spjald opnast undir henni.</li>' +
          '<li>Hafðu samband. Vantar þig að vita hvað viðkomandi hefur verið að versla, ' +
            'smelltu á augntáknið við nafnið — þar má líka búa til vörulista.</li>' +
          '<li>Skrifaðu athugasemd ef það á við, settu næstu eftirfylgni og smelltu ' +
            '<b>Skrá snertingu</b>.</li>' +
        '</ol>' +
        '<p><b>Náðist ekki í viðkomandi? Það er líka snerting.</b> Skráðu „svaraði ekki" ' +
        'og <b>+7 d</b> — þá hverfur röðin af listanum í viku í stað þess að sitja þar.</p>' +
        '<p><b>Viðskiptavinur sem enginn skráir snertingu á birtist aftur eftir 30 daga.</b> ' +
        'Eftirfylgnidagsetning ræður í staðinn ef þú setur hana.</p>' +
        '<p><b>Þú þarft ekki að fjarlægja þá sem eru búnir.</b> Um leið og viðskiptavinur ' +
        'pantar sjálfur á vefnum verður hann „Sjálfsafgreiðsla" og hverfur úr <b>Í vinnslu</b> ' +
        'af sjálfu sér — en telst áfram í árangrinum. Hætti hann aftur kemur hann sjálfur til baka. ' +
        '<b>Ekki markmið</b> er annað: það er fyrir þá sem ætla sér aldrei á vefinn, og ' +
        'það krefst ástæðu.</p>' +
        '<p><b>Staða</b> er reiknuð, ekki sett: hún ræðst af því hver hefur pantað á vefnum ' +
        'síðustu 365 daga. „Í ferli" þýðir að pöntunin fór gegnum vefinn en sölumaður sló ' +
        'hana inn — vinnan færðist ekki af þér.</p>' +
        '<p>Veldu <b>hver þú ert</b> í fellilistanum efst, einu sinni — hann man það. ' +
        'Valið fylgir hverri snertingu sem þú skráir. Veljir þú ekkert er snertingin ' +
        'óundirrituð og enginn sést við hana.</p>' +
      '</div></details>';
  }

  // ── uppsetning og uppfærsla ──────────────────────────────────────────
  var root = null;

  function q(sel) { return root ? root.querySelector(sel) : null; }

  function renderShell() {
    root.innerHTML =
      '<div data-help-slot></div>' +
      '<div data-kpis></div>' +
      '<div data-warn></div>' +
      '<div data-bar></div>' +
      '<div class="skf-scroll"><div data-head></div><div data-list></div></div>' +
      '<div data-bulk></div>';
  }

  function renderWarnings() {
    var msgs = [];
    if (!state.profilesOk) msgs.push('Sölutölur náðust ekki — raðirnar standa en tölureitir eru auðir.');
    if (!state.repsOk) msgs.push('Sölumannalistinn náðist ekki — aðeins núverandi gildi er í boði.');
    var el = q('[data-warn]');
    if (el) el.innerHTML = msgs.length ? '<div class="skf-warnbar">' + esc(msgs.join(' ')) + '</div>' : '';
  }

  // Teiknar allt nema leitarreitinn og upphafsstafina, svo innslátturinn
  // haldi fókus meðan síað er.
  function refresh() {
    applyFilters();

    var kp = q('[data-kpis]'); if (kp) kp.innerHTML = kpisHtml();
    var hd = q('[data-head]'); if (hd) hd.innerHTML = headHtml();

    var list = q('[data-list]');
    if (list) {
      list.innerHTML = state.filtered.length
        ? state.filtered.map(rowHtml).join('')
        : '<div class="skf-empty">Engin röð passar við síuna.</div>';
    }

    var bulk = q('[data-bulk]'); if (bulk) bulk.innerHTML = bulkHtml();

    var cnt = q('[data-count]');
    if (cnt) {
      cnt.textContent = state.filtered.length === state.rows.length
        ? state.rows.length + ' raðir'
        : state.filtered.length + ' af ' + state.rows.length;
    }

    // Chip-teljararnir sitja í stikunni sem er ekki endurteiknuð.
    var counts = chipCounts();
    root.querySelectorAll('[data-chip]').forEach(function (b) {
      var k = b.getAttribute('data-chip');
      var n = b.querySelector('.skf-n');
      if (n) n.textContent = counts[k];
      b.classList.toggle('is-on', state.chip === k);
    });
  }

  function setFb(key, msg, kind) {
    var el = root.querySelector('[data-panel="' + cssEsc(key) + '"] [data-fb]');
    if (!el) return;
    el.className = 'skf-fb' + (kind ? ' is-' + kind : '');
    el.textContent = msg || '';
  }

  function setBulkFb(msg) {
    var el = q('[data-bulk-fb]');
    if (el) el.textContent = msg || '';
  }

  // ── aðgerðir ─────────────────────────────────────────────────────────
  // Sameiginlegt mynstur: skrifa, taka svarið inn í röðina í minni,
  // endurteikna. Aldrei sækja allt aftur — það lokaði spjaldinu.
  function afterWrite(r) {
    r.onboarded_status = deriveOnboarded(r);
    r.due = isDue(r);
    refresh();
  }

  // Að taka röð úr forgangi þýðir „þessi verður aldrei vefviðskiptavinur",
  // ekki „þessi er búinn". Munurinn er ekki orðhengilsskápur: árangurstalan
  // er sjálfsafgreiðsla ÷ í forgangi, svo sigur sem er merktur ekki-forgangur
  // fer úr bæði teljara og nefnara og talan hrynur. Þess vegna kallast
  // hnappurinn „Ekki markmið" og þes vegna er ástæða skylduð.
  //
  // Ástæðan er vistuð sem athugasemdin, svo næsti maður spyrji ekki að því
  // sama eftir hálft ár. Þad er eina frásögnin sem röðin getur borið.
  function toggleFlag(r) {
    var next = r.status === 'priority' ? 'nonpriority' : 'priority';
    var reason = null;

    if (next === 'nonpriority') {
      var panel = root.querySelector('[data-panel="' + cssEsc(r.key) + '"]');
      var ta = panel && panel.querySelector('[data-note]');
      reason = String((ta && ta.value) || '').trim();
      if (!reason) {
        setFb(r.key, 'Skrifaðu ástæðu í athugasemdina fyrst — hvers vegna er þessi ' +
                     'ekki markmið? (Er hann búinn að færa sig á vefinn fer hann af ' +
                     'listanum sjálfur; þú þarft ekki að gera neitt.)', 'err');
        if (ta) ta.focus();
        return Promise.resolve();
      }
    }

    setFb(r.key, 'Vista…');
    return rpc('set_customer_priority_flag', {
      p_customer_id: r.customer_id,
      p_status: next,
      p_customer_name: r.customer_name,
      p_note: reason
    }).then(function () {
      r.status = next;
      if (reason) r.note = reason;
      afterWrite(r);
      setFb(r.key, next === 'priority' ? 'Sett í forgang.' : 'Merkt: ekki markmið.', 'ok');
    }).catch(function (e) {
      console.error('[forgangslisti] toggleFlag', e);
      setFb(r.key, 'Villa við vistun: ' + e.message, 'err');
    });
  }

  function assignRep(r, rep) {
    var repNorm = String(rep || '').trim().toLowerCase();
    var payload = { p_customer_id: r.customer_id, p_assigned_rep_name_norm: repNorm };
    setFb(r.key, 'Vista…');

    // Röð sem hefur aldrei verið flögguð á sér enga fánaröð til að
    // hengja sölumanninn á. Þá er hún sett í forgang fyrst og reynt
    // aftur — sama leið og gamli listinn fór.
    function bootstrapAndRetry(err) {
      if (String(err && err.message || '').toLowerCase().indexOf('not found') === -1) throw err;
      return rpc('set_customer_priority_flag', {
        p_customer_id: r.customer_id, p_status: 'priority',
        p_customer_name: r.customer_name, p_note: null
      }).then(function () {
        r.status = 'priority';
        return rpc('assign_customer_priority_rep', payload);
      });
    }

    return rpc('assign_customer_priority_rep', payload)
      .catch(bootstrapAndRetry)
      .then(function () {
        r.assigned_rep_name_norm = repNorm;
        afterWrite(r);
        setFb(r.key, repNorm ? 'Sölumaður tengdur: ' + repNorm : 'Sölumaður aftengdur.', 'ok');
      })
      .catch(function (e) {
        console.error('[forgangslisti] assignRep', e);
        setFb(r.key, 'Villa við tengingu sölumanns: ' + e.message, 'err');
      });
  }

  function logTouch(r, opts) {
    var panel = root.querySelector('[data-panel="' + cssEsc(r.key) + '"]');
    if (!panel) return Promise.resolve();
    var note = (panel.querySelector('[data-note]') || {}).value;
    var fuField = (panel.querySelector('[data-followup]') || {}).value || '';
    var fu = opts && opts.followup ? opts.followup : fuField;
    // Tómur reitur á röð sem BAR dagsetningu er hreinsun, ekki "óbreytt".
    var clear = !fu && !!r.next_followup_at;

    setFb(r.key, 'Vista…');
    return rpc('log_customer_priority_touch', {
      p_customer_id: r.customer_id,
      p_note: note == null ? null : String(note),
      p_next_followup_at: fu || null,
      // Tómt val er ekki „óbreytt" heldur „óundirritað": SQL-ið hreinsar
      // updated_by við tóman streng, svo röðin bendi ekki á rangan mann.
      p_by: String(state.actor || ''),
      p_clear_followup: clear
    }).then(function (out) {
      var o = Array.isArray(out) ? out[0] : out;
      r.last_contacted_at = (o && o.last_contacted_at) || new Date().toISOString();
      r.next_followup_at = o ? (o.next_followup_at || null) : (fu || null);
      r.note = o ? (o.note || '') : String(note || '');
      r.updated_by = o ? (o.updated_by || '') : (state.actor || '');
      afterWrite(r);
      setFb(r.key, 'Snerting skráð.', 'ok');
    }).catch(function (e) {
      console.error('[forgangslisti] logTouch', e);
      setFb(r.key, 'Villa við skráningu: ' + e.message, 'err');
    });
  }

  function plusDays(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  // Fjöldaaðgerðir snerta margar raðir, svo hér ER sótt aftur — en það er
  // eitt kall á flöggin, ekki 82 prófílfyrirspurnir. Prófílarnir sem þegar
  // eru í minni eru endurnýttir; þeir breytast ekki við þetta.
  function reloadFlags() {
    return fetchFlags().then(function (flags) {
      state.rows = mergeRows(flags, state.profiles);
      refresh();
    });
  }

  function bulkAction(kind) {
    var keys = selectedKeys();
    if (!keys.length) return Promise.resolve();
    var ids = keys.map(function (k) {
      var r = rowByKey(k);
      return r ? r.customer_id : k;
    });

    var call;
    if (kind === 'priority' || kind === 'nonpriority') {
      call = rpc('bulk_set_customer_priority_flags', {
        p_customer_ids: ids, p_status: kind, p_note: null
      });
    } else if (kind === 'rep') {
      var sel = q('[data-bulk-rep]');
      var val = sel ? sel.value : '';
      if (!val) { setBulkFb('Veldu sölumann fyrst.'); return Promise.resolve(); }
      call = rpc('bulk_assign_customer_priority_rep', {
        p_customer_ids: ids,
        p_assigned_rep_name_norm: val === '__none__' ? null : val
      });
    } else {
      return Promise.resolve();
    }

    setBulkFb('Vista ' + ids.length + '…');
    return call.then(function (out) {
      var o = Array.isArray(out) ? out[0] : out;
      return reloadFlags().then(function () {
        var n = o && (o.updated != null ? o.updated : o.upserted);
        setBulkFb('Vistað' + (n != null ? ' — ' + n + ' raðir' : '') + '.');
      });
    }).catch(function (e) {
      console.error('[forgangslisti] bulkAction', e);
      setBulkFb('Villa: ' + e.message);
    });
  }

  // ── atburðir ─────────────────────────────────────────────────────────
  function withBusy(btn, promise) {
    if (btn) btn.disabled = true;
    return promise.then(function () {
      // Endurteikningin bjó til nýjan hnapp, svo sá gamli er horfinn —
      // en hafi aðgerðin fallið án endurteikningar þarf að losa hann.
      if (btn && btn.isConnected) btn.disabled = false;
    });
  }

  // Vafri í einkaham eða með lokað á vefkökur kastar hér. Þá opnast
  // spjaldið í hvert sinn, sem er rétta hliðin að falla á.
  function seenHelpBefore() {
    try { return localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch (e) { return false; }
  }

  function wire() {
    root.addEventListener('toggle', function (e) {
      if (e.target && e.target.matches('[data-help]')) {
        try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch (err) { /* lokaður vafri */ }
      }
    }, true);

    root.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-chip]');
      if (chip) {
        var k = chip.getAttribute('data-chip');
        // Afsmellur fær þig í sjálfgefna sýn, ekki í „Allir“ — annars
        // færðist maður óvart út úr vinnulistanum og inn í sigrana.
        state.chip = state.chip === k ? 'inprogress' : k;
        refresh();
        return;
      }

      var sortEl = e.target.closest('[data-sort]');
      if (sortEl) {
        var sk = sortEl.getAttribute('data-sort');
        if (state.sortKey === sk) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = sk;
          // Tölur og dagsetningar byrja á því sem er áhugaverðast: mest
          // selt, elst snert, næst á dagskrá.
          var col = COLS.filter(function (c) { return c.key === sk; })[0];
          state.sortDir = (col && col.num) ? 'desc' : 'asc';
        }
        refresh();
        return;
      }

      var tog = e.target.closest('[data-toggle]');
      if (tog) {
        var tk = tog.getAttribute('data-toggle');
        state.openKey = state.openKey === tk ? null : tk;
        refresh();
        return;
      }

      var act = e.target.closest('[data-act]');
      if (act) {
        var panel = act.closest('[data-panel]');
        var r = panel && rowByKey(panel.getAttribute('data-panel'));
        if (!r) return;
        var kind = act.getAttribute('data-act');
        if (kind === 'flag') withBusy(act, toggleFlag(r));
        else if (kind === 'touch') withBusy(act, logTouch(r, null));
        else if (kind === 'snooze7') withBusy(act, logTouch(r, { followup: plusDays(7) }));
        else if (kind === 'snooze30') withBusy(act, logTouch(r, { followup: plusDays(30) }));
        return;
      }

      var bulk = e.target.closest('[data-bulk]');
      if (bulk && bulk.tagName === 'BUTTON') {
        var bk = bulk.getAttribute('data-bulk');
        if (bk === 'clear') { state.selected = {}; refresh(); return; }
        withBusy(bulk, bulkAction(bk));
      }
    });

    root.addEventListener('change', function (e) {
      var pick = e.target.closest('[data-pick]');
      if (pick) {
        state.selected[pick.getAttribute('data-pick')] = pick.checked;
        refresh();
        return;
      }

      if (e.target.matches('[data-all]')) {
        var on = e.target.checked;
        state.filtered.forEach(function (r) { state.selected[r.key] = on; });
        refresh();
        return;
      }

      if (e.target.matches('[data-actor]')) {
        state.actor = e.target.value;
        e.target.removeAttribute('data-empty');
        if (!state.actor) e.target.setAttribute('data-empty', '1');
        try { localStorage.setItem(ACTOR_KEY, state.actor); } catch (err) { /* lokaður vafri */ }
        return;
      }

      var rep = e.target.closest('[data-rep]');
      if (rep) {
        var panel = rep.closest('[data-panel]');
        var r = panel && rowByKey(panel.getAttribute('data-panel'));
        if (r) assignRep(r, rep.value);
      }
    });

    root.addEventListener('input', function (e) {
      if (e.target.matches('[data-search]')) {
        state.search = e.target.value;
        refresh();
        return;
      }
      if (e.target.matches('[data-actor-text]')) {
        state.actor = e.target.value.trim();
        try { localStorage.setItem(ACTOR_KEY, state.actor); } catch (err) { /* lokaður vafri */ }
      }
    });
  }

  // ── ræsing ───────────────────────────────────────────────────────────
  function boot() {
    root = document.getElementById('sk-forgangslisti');
    if (!root) return;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root.style.setProperty('--skf-cols', GRID_COLS);

    if (!BASE || !KEY) {
      root.innerHTML = '<p class="skf-err">Uppsetning vantar: STORKAUP_CONFIG.supabaseUrl / ' +
        'publishableKey á þessari síðu.</p>';
      return;
    }

    try { state.actor = localStorage.getItem(ACTOR_KEY) || ''; } catch (e) { /* lokaður vafri */ }

    root.innerHTML = '<div class="skf-loading">Augnablik! Sæki forgangslistann…</div>';

    // Flöggin og sölumennirnir fara af stað saman; prófílarnir þurfa
    // auðkennin úr flöggunum og fara á eftir. Tvær ferðir, ekki þrettán.
    var repsPromise = fetchReps().catch(function (e) {
      console.error('[forgangslisti] reps', e);
      state.repsOk = false;
      return [];
    });

    fetchFlags().then(function (flags) {
      var ids = (flags || []).map(function (f) {
        return String(f.customer_id || f.customer_family_id || '').trim();
      }).filter(Boolean);

      return fetchProfiles(ids).catch(function (e) {
        console.error('[forgangslisti] profiles', e);
        state.profilesOk = false;
        return [];
      }).then(function (profiles) {
        return repsPromise.then(function (reps) {
          state.reps = dedupeReps(reps);
          state.profiles = profiles || [];
          state.rows = mergeRows(flags, state.profiles);

          renderShell();
          var slot = q('[data-help-slot]');
          if (slot) slot.innerHTML = helpHtml(!seenHelpBefore());
          var bar = q('[data-bar]');
          if (bar) bar.innerHTML = barHtml();
          renderWarnings();
          refresh();
          wire();
        });
      });
    }).catch(function (e) {
      console.error('[forgangslisti] boot', e);
      root.innerHTML = '<p class="skf-err">Náði ekki í forgangslistann: ' + esc(e.message) + '</p>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

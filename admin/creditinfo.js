'use strict';

/************************************************************
 * creditinfo.js — úrtak fyrir prófun Snjallákvörðunar (2026-10-20)
 *
 * Creditinfo keyrir 20 kennitölur okkur að kostnaðarlausu. Úrtakið á að
 * spanna tap, vanskil, góða viðskiptavini, umsóknir sem við höfnuðum og
 * einstaklingsfyrirtæki (blaðið „Valviðmið úrtaks“ í docs/creditinfo/ —
 * ekki í git, repo-ið er opið).
 *
 * creditinfoUrtak_v1() les söguflipa umsóknarskjalsins og BC-töflurnar í
 * Supabase og skrifar flipann „Creditinfo úrtak“ í umsóknarskjalið:
 *   1. Samantekt: lánshæfisflokkur × afdrif umsóknar, og hvaða heimild þeir
 *      sem komust í BC hafa núna — raunverulega reglan, ekki sú skrifaða.
 *   2. Kandídatar í hvern úrtakshóp. Valið sjálft er handvirkt.
 *
 * Takmarkanir gagnanna:
 *   - Afskriftir eru hvergi hjá okkur. „Tap“ og „vanskil“ koma úr sama lista
 *     (vanskil > 0); staða (SGM) og BC sjálft skera úr hvor er hvað.
 *   - Hámarksskuld (SGM) hvarf úr BC-útflutningnum 2026-08 og kom aftur
 *     2026-10-20. Viðskiptamaður sem var ekki í nýjum innlestri síðan hefur
 *     enn tóma heimild. -1 = staðgreiðsla.
 *   - status_sgm er 'Staða (SGM)' = staða reiknings í krónum, ekki lokunarstaða.
 *   - Vanskil miðast við síðasta BC-innlestur (BC Sync valmyndin).
 *
 * Kennitölur og vanskil eru PII: aðeins deployer má keyra þetta, ekki
 * allir á ADMIN_APP_EMAILS (fallið er google.script.run-leið eins og öll
 * föll án _ í þessu projecti).
 ************************************************************/

var CI_URTAK_TAB_ = 'Creditinfo úrtak';

var CI_SOURCE_TABS_ = [
  { tab: null,                outcome: 'Í bið' },          // mainTab úr APP_SOURCES
  { tab: 'BC til - stofnað',  outcome: 'Stofnað í BC' },
  { tab: 'LOKID',             outcome: 'Lokið (hreinsað)' },
  { tab: 'Staðgreiðsla',      outcome: 'Staðgreiðsla' },
  { tab: 'Þarf lánshæfismat', outcome: 'Einstaklingur' },
  { tab: 'Ekkert VSK',        outcome: 'Ekkert VSK' }
];

function creditinfoUrtak_v1() {
  adminGuard_('umsokn');
  var user  = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  var owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (user !== owner) throw new Error('Aðeins deployer keyrir Creditinfo-úrtakið.');

  var cfg = loadConfig_();
  var src = APP_SOURCES.find(function (s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var ss  = SpreadsheetApp.openById(cfg.SHEETS.UMSOKN_VIDSKIPTI.ID);

  // ── 1. Umsóknir úr öllum flipum ──────────────────────────────────────────
  var apps = [];
  CI_SOURCE_TABS_.forEach(function (t) {
    var sh = ss.getSheetByName(t.tab || src.mainTab);
    if (!sh) return;
    webapp_readRows_(sh, src).forEach(function (r) {
      var kt = ci_kt_(r.companyKt);
      var score = parseInt(String(r.creditScore || '').replace(/\/.*$/, ''), 10);
      apps.push({
        outcome: t.outcome, date: r.date, company: r.company, kt: kt,
        score: (score >= 1 && score <= 10) ? score : null
      });
    });
  });

  // ── 2. BC-gögn ───────────────────────────────────────────────────────────
  // Allt úr bc_customers_raw (Viðskiptamenn-exportið). customer_analysis_raw
  // er EKKI notað: BC-reitirnir þar hafa verið 0 síðan blöðin frusu 2026-05
  // (sjá core/sql/customer_profiles_live_bc_v1.sql). Sala (SGM) er ævivelta
  // til dags exportsins; pantanafjöldi kemur úr prófíla-MV-inu.
  var appKts = apps.map(function (a) { return a.kt; }).filter(Boolean);
  var BC_SEL = 'company_id,company_name,credit_limit,arrears,status_sgm,payment_terms_code,sales';
  var arrearsRows = ci_sbGet_('bc_customers_raw?select=' + BC_SEL +
                              '&arrears=gt.0&order=arrears.desc&limit=1000');
  var arrearsMap = {};
  arrearsRows.forEach(function (r) { arrearsMap[String(r.company_id)] = r; });

  var topSales = ci_sbGet_('bc_customers_raw?select=' + BC_SEL + '&sales=gt.0&order=sales.desc&limit=300');
  var personalBc = ci_sbGet_('bc_customers_raw?select=' + BC_SEL +
                             '&or=' + encodeURIComponent('(company_id.like.0*,company_id.like.1*,company_id.like.2*,company_id.like.3*)') +
                             '&sales=gt.0&order=sales.desc&limit=100');

  var bcMap = ci_byIds_('bc_customers_raw', 'company_id', BC_SEL, appKts);
  arrearsRows.concat(topSales, personalBc).forEach(function (r) { bcMap[String(r.company_id)] = bcMap[String(r.company_id)] || r; });
  // Greiðsluskilmálar komu í exportið 2026-10-20 (core/sql/bc_customers_payment_terms.sql).
  // Fyrir fyrsta innlestur eru þeir null alls staðar — þá má ekki lesa null sem staðgreiðslu.
  var termsLoaded = Object.keys(bcMap).some(function (k) { return bcMap[k].payment_terms_code; });

  // Pantanafjöldi (BC-reikningar) — prófíla-MV-ið, endurnýjað daglega.
  var ordMap = ci_byIds_('mv_customer_profiles_labeled_trends', 'customer_id',
                         'customer_id,orders_bc_365d,total_bc_orders', Object.keys(bcMap), 'api');

  function isCash(kt) {
    var bc = bcMap[kt];
    if (!bc) return false;
    return ci_num_(bc.credit_limit) === -1 || (termsLoaded && !bc.payment_terms_code);
  }

  function info(kt) {
    var bc = bcMap[kt] || {}, ord = ordMap[kt] || {};
    return {
      inBc: !!bcMap[kt],
      name: bc.company_name || '',
      limit: ci_num_(bc.credit_limit),
      arrears: ci_num_(bc.arrears),
      status: ci_num_(bc.status_sgm),
      terms: bcMap[kt] ? (bc.payment_terms_code || (termsLoaded ? 'Staðgreiðsla (tómt)' : '')) : '',
      sales: ci_num_(bc.sales),
      orders365: ci_num_(ord.orders_bc_365d)
    };
  }

  // ── 3. Samantekt: flokkur × afdrif ───────────────────────────────────────
  var outcomes = CI_SOURCE_TABS_.map(function (t) { return t.outcome; });
  var summary = [['Lánshæfisflokkur'].concat(outcomes).concat(
    ['Samtals', 'Í BC núna', 'Með skráða heimild', 'Miðgildi heimildar', 'Lægst', 'Hæst', 'Í vanskilum núna'])];
  var bands = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null];
  bands.forEach(function (b) {
    var rows = apps.filter(function (a) { return a.score === b; });
    var counts = outcomes.map(function (o) { return rows.filter(function (a) { return a.outcome === o; }).length; });
    var infos = rows.filter(function (a) { return a.kt; }).map(function (a) { return info(a.kt); });
    var inBc = infos.filter(function (i) { return i.inBc; });
    var limits = inBc.map(function (i) { return i.limit; }).filter(function (v) { return v != null && v > 0; })
                     .sort(function (x, y) { return x - y; });
    summary.push([b == null ? 'Ekkert skor' : b].concat(counts).concat([
      rows.length, inBc.length, limits.length,
      limits.length ? limits[Math.floor((limits.length - 1) / 2)] : '',
      limits.length ? limits[0] : '', limits.length ? limits[limits.length - 1] : '',
      inBc.filter(function (i) { return i.arrears > 0; }).length
    ]));
  });

  // ── 4. Kandídatar ────────────────────────────────────────────────────────
  var head = ['Hópur', 'Fyrirtæki', 'Kennitala', 'Skor (umsókn)', 'Afdrif umsóknar', 'Dags. umsóknar',
              'Heimild í BC', 'Greiðsluskilmálar', 'Vanskil', 'Staða reiknings', 'Sala BC alls (SGM)', 'BC-pantanir 12 mán'];
  var cand = [];
  var appByKt = {};
  apps.forEach(function (a) { if (a.kt && (!appByKt[a.kt] || a.score != null)) appByKt[a.kt] = a; });

  function push(group, kt, app) {
    var i = info(kt);
    app = app || appByKt[kt] || {};
    cand.push([group, app.company || i.name, kt, app.score == null ? '' : app.score, app.outcome || '',
               app.date || '', i.limit == null ? '' : i.limit, i.terms, i.arrears == null ? '' : i.arrears,
               i.status == null ? '' : i.status, i.sales == null ? '' : i.sales,
               i.orders365 == null ? '' : i.orders365]);
  }

  // Tap: staðgreiðsluviðskiptamenn sem skulda. Mynstrið 2026-10-20 (11 talsins,
  // ~1,44 m.kr.) bendir til viðskiptamanna sem voru færðir í staðgreiðslu eftir
  // vanskil — bókhald staðfestir hverjir eru í raun tap.
  arrearsRows.filter(function (r) { return isCash(String(r.company_id)); })
    .forEach(function (r) { push('Tap? — staðgreiðsla með skuld (velja 5)', String(r.company_id)); });

  // Vanskil í reikningsviðskiptum. Opinberir aðilar (t.d. Sjúkratryggingar)
  // lenda hér líka en eiga ekki heima í úrtakinu — viðmið 8 sendir þá beint í samþykkt.
  arrearsRows.filter(function (r) { return !isCash(String(r.company_id)); }).slice(0, 25)
    .forEach(function (r) { push('Vanskil í reikningsviðskiptum (velja 4)', String(r.company_id)); });

  // Góðir: söluhæstu lögaðilar án vanskila, í reikningsviðskiptum (ekki
  // staðgreiðsla, ekki SJUKRA) og virkir — a.m.k. 4 BC-pantanir síðustu 12 mán.
  var good = 0;
  topSales.forEach(function (r) {
    var kt = String(r.company_id);
    if (good >= 25 || kt.length !== 10 || ci_isPersonal_(kt) || arrearsMap[kt] || isCash(kt)) return;
    if (r.payment_terms_code === 'SJUKRA') return;
    var ord = ordMap[kt];
    if (ord && ci_num_(ord.orders_bc_365d) != null && ci_num_(ord.orders_bc_365d) < 4) return;
    push('Góður og stöðugur (velja 6)', kt); good++;
  });

  // Höfnuð: staðgreiðsluflipinn, nýjustu fyrst.
  apps.filter(function (a) { return a.outcome === 'Staðgreiðsla' && a.kt; })
      .sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); })
      .forEach(function (a) { push('Umsókn sem við höfnuðum (velja 3)', a.kt, a); });

  // Einstaklingsfyrirtæki: umsækjendur á eigin kennitölu + núverandi í
  // reikningsviðskiptum (SJUKRA eru einstaklingar vegna Sjúkratrygginga, ekki rekstur).
  apps.filter(function (a) { return a.outcome === 'Einstaklingur' && a.kt; })
      .forEach(function (a) { push('Einstaklingsfyrirtæki (velja 2)', a.kt, a); });
  var pers = 0;
  personalBc.forEach(function (r) {
    var kt = String(r.company_id);
    if (pers >= 15 || kt.length !== 10 || arrearsMap[kt] || isCash(kt) || r.payment_terms_code === 'SJUKRA') return;
    push('Einstaklingsfyrirtæki (velja 2)', kt); pers++;
  });

  // ── 5. Skrifa flipann ────────────────────────────────────────────────────
  var out = ss.getSheetByName(CI_URTAK_TAB_) || ss.insertSheet(CI_URTAK_TAB_);
  out.clear();
  var notes = [
    ['Creditinfo úrtak — keyrt ' + Utilities.formatDate(new Date(), 'Atlantic/Reykjavik', 'yyyy-MM-dd HH:mm') +
     ' af creditinfoUrtak_v1 (admin/creditinfo.js). Keyrt aftur skrifar yfir flipann.'],
    ['Tóm heimild = viðskiptamaður ekki í BC-innlestri síðan Hámarksskuld kom aftur (2026-10-20); -1 = staðgreiðsla. Staða reiknings er í krónum. ' +
     'Afskriftir eru ekki í gögnunum; tap og vanskil koma úr sama lista. Einstaklingar: skrifleg heimild áður en kennitala fer til Creditinfo.']
  ];
  var row = 1;
  out.getRange(row, 1, notes.length, 1).setValues(notes).setFontColor('#6b7a7e');
  row += notes.length + 1;
  out.getRange(row, 1).setValue('Samantekt: lánshæfisflokkur × afdrif').setFontWeight('bold');
  row++;
  out.getRange(row, 1, summary.length, summary[0].length).setValues(summary);
  out.getRange(row, 1, 1, summary[0].length).setFontWeight('bold').setBackground('#e8e8e8');
  row += summary.length + 2;
  out.getRange(row, 1).setValue('Kandídatar í úrtak — valið er handvirkt').setFontWeight('bold');
  row++;
  var table = [head].concat(cand);
  // Texti áður en gildin fara inn — annars verður 0101…-kennitala að tölu og núllið hverfur.
  out.getRange(row + 1, 3, cand.length || 1, 1).setNumberFormat('@');
  out.getRange(row, 1, table.length, head.length).setValues(table);
  out.getRange(row, 1, 1, head.length).setFontWeight('bold').setBackground('#e8e8e8');
  out.getRange(row + 1, 7, cand.length || 1, 1).setNumberFormat('#,##0');
  out.getRange(row + 1, 9, cand.length || 1, 3).setNumberFormat('#,##0');

  var withScore = apps.filter(function (a) { return a.score != null; }).length;
  console.log('[CREDITINFO] úrtak: ' + apps.length + ' umsóknir, ' + withScore + ' með skor, ' +
              arrearsRows.length + ' í vanskilum, ' + cand.length + ' kandídatar');
  return { applications: apps.length, withScore: withScore, inArrears: arrearsRows.length, candidates: cand.length };
}

function ci_kt_(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

function ci_isPersonal_(kt) {
  return kt.length === 10 && parseInt(kt.substring(0, 2), 10) <= 31;
}

function ci_num_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function ci_sbGet_(path, profile) {
  var conf = getSupabaseRestConfig_();
  var res = UrlFetchApp.fetch(conf.baseUrl + '/' + path, {
    method: 'get',
    headers: { apikey: conf.serviceRole, Authorization: 'Bearer ' + conf.serviceRole, 'Accept-Profile': profile || 'raw' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Supabase ' + res.getResponseCode() + ' á ' + path.split('?')[0] + ': ' +
                    res.getContentText().slice(0, 200));
  }
  var rows = safeJsonParse_(res.getContentText());
  return Array.isArray(rows) ? rows : [];
}

function ci_byIds_(table, idCol, select, ids, profile) {
  var uniq = ids.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  var map = {};
  for (var i = 0; i < uniq.length; i += 80) {
    var list = uniq.slice(i, i + 80).map(function (kt) { return '"' + kt + '"'; }).join(',');
    ci_sbGet_(table + '?select=' + select + '&' + idCol + '=in.(' + encodeURIComponent(list) + ')', profile)
      .forEach(function (r) { map[String(r[idCol])] = r; });
  }
  return map;
}

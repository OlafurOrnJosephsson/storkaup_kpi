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
  var appKts = apps.map(function (a) { return a.kt; }).filter(Boolean);
  var BC_SEL = 'company_id,company_name,credit_limit,arrears,status_sgm,payment_terms_code';
  var arrearsRows = ci_sbGet_('bc_customers_raw?select=' + BC_SEL +
                              '&arrears=gt.0&order=arrears.desc&limit=1000');
  var arrearsMap = {};
  arrearsRows.forEach(function (r) { arrearsMap[String(r.company_id)] = r; });

  var topSales = ci_sbGet_('customer_analysis_raw?select=customer_id,customer_name,credit_limit,lifetime_bc_sales,last_bc_order_date' +
                           '&order=lifetime_bc_sales.desc.nullslast&limit=300');
  var personalBc = ci_sbGet_('customer_analysis_raw?select=customer_id,customer_name,credit_limit,lifetime_bc_sales,last_bc_order_date' +
                             '&or=' + encodeURIComponent('(customer_id.like.0*,customer_id.like.1*,customer_id.like.2*,customer_id.like.3*)') +
                             '&lifetime_bc_sales=gt.0&order=lifetime_bc_sales.desc&limit=100');

  var lookupKts = appKts.concat(arrearsRows.slice(0, 40).map(function (r) { return String(r.company_id); }));
  var caMap = ci_byIds_('customer_analysis_raw', 'customer_id',
                        'customer_id,customer_name,credit_limit,lifetime_bc_sales,last_bc_order_date', lookupKts);
  var bcMap = ci_byIds_('bc_customers_raw', 'company_id', BC_SEL,
                        appKts.concat(topSales.concat(personalBc).map(function (r) { return String(r.customer_id); })));
  arrearsRows.forEach(function (r) { bcMap[String(r.company_id)] = bcMap[String(r.company_id)] || r; });
  // Greiðsluskilmálar komu í exportið 2026-10-20 (core/sql/bc_customers_payment_terms.sql).
  // Fyrir fyrsta innlestur eru þeir null alls staðar — þá má ekki lesa null sem staðgreiðslu.
  var termsLoaded = Object.keys(bcMap).some(function (k) { return bcMap[k].payment_terms_code; });
  topSales.concat(personalBc).forEach(function (r) { caMap[String(r.customer_id)] = caMap[String(r.customer_id)] || r; });

  function info(kt) {
    var ca = caMap[kt] || {}, bc = bcMap[kt] || arrearsMap[kt] || {};
    var limit = ci_num_(bc.credit_limit);
    if (limit == null) limit = ci_num_(ca.credit_limit);
    return {
      inBc: !!(caMap[kt] || bcMap[kt] || arrearsMap[kt]),
      name: ca.customer_name || bc.company_name || '',
      limit: limit,
      arrears: ci_num_((arrearsMap[kt] || bc).arrears),
      status: (arrearsMap[kt] || bc).status_sgm || '',
      terms: bcMap[kt] ? (bcMap[kt].payment_terms_code || (termsLoaded ? 'Staðgreiðsla (tómt)' : '')) : '',
      sales: ci_num_(ca.lifetime_bc_sales),
      lastOrder: ca.last_bc_order_date ? String(ca.last_bc_order_date).substring(0, 10) : ''
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
              'Heimild í BC', 'Greiðsluskilmálar', 'Vanskil', 'Staða reiknings', 'Velta BC alls', 'Síðasta BC-pöntun'];
  var cand = [];
  var appByKt = {};
  apps.forEach(function (a) { if (a.kt && (!appByKt[a.kt] || a.score != null)) appByKt[a.kt] = a; });

  function push(group, kt, app) {
    var i = info(kt);
    app = app || appByKt[kt] || {};
    cand.push([group, app.company || i.name, kt, app.score == null ? '' : app.score, app.outcome || '',
               app.date || '', i.limit == null ? '' : i.limit, i.terms, i.arrears == null ? '' : i.arrears,
               i.status, i.sales == null ? '' : i.sales, i.lastOrder]);
  }

  // Tap / vanskil — sami listinn; staða (SGM) og BC skera úr hvor er hvað.
  arrearsRows.slice(0, 30).forEach(function (r) { push('Tap eða vanskil (velja 5 + 4)', String(r.company_id)); });

  // Góðir: veltuhæstu lögaðilar án vanskila, í reikningsviðskiptum — ekki
  // staðgreiðsla (-1 eða tómir skilmálar) og ekki SJUKRA.
  var good = 0;
  topSales.forEach(function (r) {
    var kt = String(r.customer_id);
    if (good >= 25 || kt.length !== 10 || ci_isPersonal_(kt) || arrearsMap[kt]) return;
    var lim = ci_num_(r.credit_limit);
    if (lim != null && lim < 0) return;
    var bc = bcMap[kt];
    if (termsLoaded && bc && (!bc.payment_terms_code || bc.payment_terms_code === 'SJUKRA')) return;
    push('Góður og stöðugur (velja 6)', kt); good++;
  });

  // Höfnuð: staðgreiðsluflipinn, nýjustu fyrst.
  apps.filter(function (a) { return a.outcome === 'Staðgreiðsla' && a.kt; })
      .sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); })
      .forEach(function (a) { push('Umsókn sem við höfnuðum (velja 3)', a.kt, a); });

  // Einstaklingsfyrirtæki: umsækjendur á eigin kennitölu + núverandi í BC.
  apps.filter(function (a) { return a.outcome === 'Einstaklingur' && a.kt; })
      .forEach(function (a) { push('Einstaklingsfyrirtæki (velja 2)', a.kt, a); });
  personalBc.slice(0, 15).forEach(function (r) {
    var kt = String(r.customer_id);
    if (kt.length === 10 && !arrearsMap[kt]) push('Einstaklingsfyrirtæki (velja 2)', kt);
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

function ci_sbGet_(path) {
  var conf = getSupabaseRestConfig_();
  var res = UrlFetchApp.fetch(conf.baseUrl + '/' + path, {
    method: 'get',
    headers: { apikey: conf.serviceRole, Authorization: 'Bearer ' + conf.serviceRole, 'Accept-Profile': 'raw' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Supabase ' + res.getResponseCode() + ' á ' + path.split('?')[0] + ': ' +
                    res.getContentText().slice(0, 200));
  }
  var rows = safeJsonParse_(res.getContentText());
  return Array.isArray(rows) ? rows : [];
}

function ci_byIds_(table, idCol, select, ids) {
  var uniq = ids.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  var map = {};
  for (var i = 0; i < uniq.length; i += 80) {
    var list = uniq.slice(i, i + 80).map(function (kt) { return '"' + kt + '"'; }).join(',');
    ci_sbGet_(table + '?select=' + select + '&' + idCol + '=in.(' + encodeURIComponent(list) + ')')
      .forEach(function (r) { map[String(r[idCol])] = r; });
  }
  return map;
}

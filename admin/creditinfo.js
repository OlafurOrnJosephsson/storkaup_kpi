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
      // Einstaklingur í rekstri skráir oft eigin kennitölu sem tengiliður og
      // lætur fyrirtækisreitinn tóman.
      var kt = ci_kt_(r.companyKt) || (t.outcome === 'Einstaklingur' ? ci_kt_(r.personKt) : '');
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

  var topSales = ci_sbGet_('bc_customers_raw?select=' + BC_SEL + '&sales=gt.0&order=sales.desc&limit=1000');
  var personalBc = ci_sbGet_('bc_customers_raw?select=' + BC_SEL +
                             '&or=' + encodeURIComponent('(company_id.like.0*,company_id.like.1*,company_id.like.2*,company_id.like.3*)') +
                             '&payment_terms_code=not.eq.SJUKRA&sales=gt.0&order=sales.desc&limit=100');

  var bcMap = ci_byIds_('bc_customers_raw', 'company_id', BC_SEL, appKts);
  arrearsRows.concat(topSales, personalBc).forEach(function (r) { bcMap[String(r.company_id)] = bcMap[String(r.company_id)] || r; });
  // Greiðsluskilmálar komu í exportið 2026-10-20 (core/sql/bc_customers_payment_terms.sql).
  // Fyrir fyrsta innlestur eru þeir null alls staðar — þá má ekki lesa null sem staðgreiðslu.
  var termsLoaded = Object.keys(bcMap).some(function (k) { return bcMap[k].payment_terms_code; });

  // Pantanafjöldi (BC-reikningar) — prófíla-MV-ið, endurnýjað daglega.
  // Valkvætt: service_role hafði ekki SELECT á MV-inu 2026-10-20 (42501). Án
  // þess er dálkurinn tómur og „góður“ síast aðeins á sölu, ekki virkni.
  var ordMap = {};
  try {
    ordMap = ci_byIds_('mv_customer_profiles_labeled_trends', 'customer_id',
                       'customer_id,orders_bc_365d,total_bc_orders,primary_category', Object.keys(bcMap), 'api');
  } catch (e) {
    console.warn('[CREDITINFO] pantanafjöldi sleppt: ' + String(e.message || e).slice(0, 160));
  }

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
      orders365: ci_num_(ord.orders_bc_365d),
      category: ord.primary_category || ''
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

  // ── 4. Tillaga að úrtaki ─────────────────────────────────────────────────
  // Skriftan leggur til 20 eftir „Valviðmið úrtaks“ (5/4/6/3/2) og sýnir
  // nokkra varamenn í hverjum hópi. Bókhald staðfestir eða skiptir út — en
  // byrjar ekki á 140 raða lista.
  var head = ['Tillaga', 'Hópur', 'Fyrirtæki', 'Kennitala', 'Af hverju', 'Vöruflokkur',
              'Heimild í BC', 'Greiðsluskilmálar', 'Vanskil', 'Staða reiknings', 'Sala BC alls (SGM)',
              'BC-pantanir 12 mán', 'Skor (umsókn)', 'Afdrif umsóknar', 'Dags. umsóknar'];
  var cand = [];
  var used = {};
  var appByKt = {};
  apps.forEach(function (a) { if (a.kt && (!appByKt[a.kt] || a.score != null)) appByKt[a.kt] = a; });

  function line(pick, group, kt, why, app) {
    var i = info(kt);
    app = app || appByKt[kt] || {};
    used[kt] = true;
    return [pick ? '✓' : '', group, app.company || i.name, kt, why, i.category,
            i.limit == null ? '' : i.limit, i.terms, i.arrears == null ? '' : i.arrears,
            i.status == null ? '' : i.status, i.sales == null ? '' : i.sales,
            i.orders365 == null ? '' : i.orders365,
            app.score == null ? '' : app.score, app.outcome || '', app.date || ''];
  }
  // Tillögur (vísar í list) fyrst, svo allt að ALT varamenn úr sama lista.
  var ALT = 5;
  function emit(group, list, picks, why) {
    var chosen = {};
    picks.forEach(function (ix) { chosen[ix] = true; });
    picks.forEach(function (ix) { cand.push(line(true, group, list[ix].kt, why(list[ix], ix), list[ix].app)); });
    var alts = 0;
    list.forEach(function (x, ix) {
      if (chosen[ix] || alts >= ALT || used[x.kt]) return;
      cand.push(line(false, group, x.kt, why(x, ix), x.app)); alts++;
    });
  }
  // n vísar dreifðir jafnt yfir listann — blandar stórum og litlum.
  function spread(len, n) {
    n = Math.min(len, n);
    if (n <= 1) return n === 1 ? [0] : [];
    var out = [];
    for (var k = 0; k < n; k++) out.push(Math.round(k * (len - 1) / (n - 1)));
    return out;
  }
  function first(len, n) {
    var out = [];
    for (var k = 0; k < Math.min(len, n); k++) out.push(k);
    return out;
  }
  // Opinberir aðilar fara beint í samþykkt (viðmið 8) og innri reikningar
  // (STORKAUP) segja ekkert um lánshæfi — hvorugt á heima í úrtakinu.
  var PUBLIC_RE = /sjúkratrygg|ríkis|ráðuneyt|stofnun|sveitarf|hreppur|kaupstaður|\bbær\b|borg\b|skóli|leikskól|heilsugæsl|landspítal|sjúkrahús|heilbrigðisstofnun|lögregl|háskól|sýslumann/i;
  function eligibleOrg(kt) {
    var bc = bcMap[kt] || {};
    if (kt.length !== 10 || used[kt]) return false;
    if (PUBLIC_RE.test(bc.company_name || '')) return false;
    if (bc.payment_terms_code === 'STORKAUP' || bc.payment_terms_code === 'SJUKRA') return false;
    return true;
  }
  function kr(v) { return Math.round(Number(v) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' kr.'; }

  // Tap (5): staðgreiðsla með skuld, stærstu skuldir. Smáupphæðir (<10 þús.) segja lítið.
  var tap = arrearsRows.map(function (r) { return { kt: String(r.company_id), r: r }; })
    .filter(function (x) { return isCash(x.kt) && eligibleOrg(x.kt) && ci_num_(x.r.arrears) >= 10000; });
  emit('Tap / afskrifað (5)', tap, first(tap.length, 5), function (x) {
    return 'Í staðgreiðslu en skuldar ' + kr(x.r.arrears) + ' — líklega færður eftir vanskil. Bókhald staðfestir tap.';
  });

  // Vanskil (4): í reikningsviðskiptum, dreift yfir stærð vanskila.
  var van = arrearsRows.map(function (r) { return { kt: String(r.company_id), r: r }; })
    .filter(function (x) { return !isCash(x.kt) && eligibleOrg(x.kt) && ci_num_(x.r.arrears) >= 10000; });
  emit('Vanskil eða greiðslufrestir (4)', van, spread(van.length, 4), function (x) {
    return 'Reikningsviðskipti (' + (x.r.payment_terms_code || '?') + '), ' + kr(x.r.arrears) + ' í vanskilum.';
  });

  // Góðir (6): virkir lögaðilar í reikningsviðskiptum án vanskila. 2 stórir,
  // 2 miðlungs, 2 minni — og ekki tveir úr sama vöruflokki.
  var goodPool = topSales.map(function (r) { return { kt: String(r.company_id), r: r }; })
    .filter(function (x) {
      if (!eligibleOrg(x.kt) || ci_isPersonal_(x.kt) || arrearsMap[x.kt] || isCash(x.kt)) return false;
      var o = ordMap[x.kt];
      return !o || ci_num_(o.orders_bc_365d) == null || ci_num_(o.orders_bc_365d) >= 4;
    });
  var goodPicks = [], cats = {};
  [0, 1, 2].forEach(function (tier) {
    var lo = Math.floor(tier * goodPool.length / 3), hi = Math.floor((tier + 1) * goodPool.length / 3);
    var got = 0;
    for (var ix = lo; ix < hi && got < 2; ix++) {
      var c = (ordMap[goodPool[ix].kt] || {}).primary_category || ('?' + ix);
      if (cats[c]) continue;
      cats[c] = true; goodPicks.push(ix); got++;
    }
  });
  function tierName(ix) { return ix < Math.floor(goodPool.length / 3) ? 'Stór' : ix < Math.floor(2 * goodPool.length / 3) ? 'Miðlungs' : 'Minni'; }
  emit('Góður og stöðugur (6)', goodPool, goodPicks, function (x, ix) {
    var o = ordMap[x.kt] || {};
    return tierName(ix) + ' viðskiptavinur, ' + kr(x.r.sales) + ' í sölu' +
           (o.orders_bc_365d != null ? ', ' + o.orders_bc_365d + ' pantanir síðustu 12 mán.' : '') + ', engin vanskil.';
  });

  // Höfnuð (3): staðgreiðsluflipinn — með skor fyrst, svo nýjustu.
  var seenRej = {};
  var rej = apps.filter(function (a) { return a.outcome === 'Staðgreiðsla' && a.kt && a.kt.length === 10; })
    .sort(function (x, y) {
      if ((x.score != null) !== (y.score != null)) return x.score != null ? -1 : 1;
      return String(y.date).localeCompare(String(x.date));
    })
    .filter(function (a) { if (seenRej[a.kt]) return false; seenRej[a.kt] = true; return true; })
    .filter(function (a) { return !used[a.kt]; })
    .map(function (a) { return { kt: a.kt, app: a }; });
  emit('Umsókn sem við höfnuðum (3)', rej, first(rej.length, 3), function (x) {
    return 'Hafnað í staðgreiðslu' + (x.app.score != null ? ' á skori ' + x.app.score : '') + '. Hefði kerfið verið sammála?';
  });

  // Einstaklingsfyrirtæki (2): einn umsækjandi + einn núverandi í reikningsviðskiptum.
  var persApps = apps.filter(function (a) { return a.outcome === 'Einstaklingur' && a.kt && a.kt.length === 10; })
    .sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); })
    .filter(function (a) { return !used[a.kt]; })
    .map(function (a) { return { kt: a.kt, app: a, src: 'umsókn' }; });
  var persBc = personalBc.map(function (r) { return { kt: String(r.company_id), r: r, src: 'bc' }; })
    .filter(function (x) { return x.kt.length === 10 && !used[x.kt] && !arrearsMap[x.kt] && !isCash(x.kt) && x.r.payment_terms_code !== 'SJUKRA'; });
  var pers = persApps.slice(0, 1).concat(persBc.slice(0, 1), persApps.slice(1, 4), persBc.slice(1, 4));
  emit('Einstaklingsfyrirtæki (2)', pers, first(pers.length, 2), function (x) {
    return (x.src === 'umsókn' ? 'Sótti um á eigin kennitölu.' : 'Í reikningsviðskiptum á eigin kennitölu, ' + kr(x.r.sales) + ' í sölu.') +
           ' Skrifleg heimild áður en kennitalan fer til Creditinfo.';
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
  var picked = cand.filter(function (c) { return c[0]; }).length;
  out.getRange(row, 1).setValue('Tillaga að úrtaki: ' + picked + ' merktar ✓, varamenn undir hverjum hópi. ' +
                                'Skiptu út eftir þörfum og afritaðu ✓-línurnar í Prófunarlisti 20.').setFontWeight('bold');
  row++;
  var table = [head].concat(cand);
  // Texti áður en gildin fara inn — annars verður 0101…-kennitala að tölu og núllið hverfur.
  out.getRange(row + 1, 4, cand.length || 1, 1).setNumberFormat('@');
  out.getRange(row, 1, table.length, head.length).setValues(table);
  out.getRange(row, 1, 1, head.length).setFontWeight('bold').setBackground('#e8e8e8');
  out.getRange(row + 1, 7, cand.length || 1, 1).setNumberFormat('#,##0');
  out.getRange(row + 1, 9, cand.length || 1, 3).setNumberFormat('#,##0');
  cand.forEach(function (c, k) {
    if (c[0]) out.getRange(row + 1 + k, 1, 1, head.length).setBackground('#e1ede6');
  });
  out.setColumnWidth(5, 380);
  out.getRange(row + 1, 5, cand.length || 1, 1).setWrap(true);

  var withScore = apps.filter(function (a) { return a.score != null; }).length;
  console.log('[CREDITINFO] úrtak: ' + apps.length + ' umsóknir, ' + withScore + ' með skor, ' +
              arrearsRows.length + ' í vanskilum, ' + picked + ' í tillögu, ' + cand.length + ' línur alls');
  return { applications: apps.length, withScore: withScore, inArrears: arrearsRows.length, picked: picked, rows: cand.length };
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

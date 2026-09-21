/************************************************************
 * 🔗 RELATED PRODUCTS — körfugreining á BC_LINES
 *
 * MÆLING, EKKI EIGINLEIKI. Þetta fall skrifar ekkert og breytir engu.
 * Það svarar einni spurningu: er raunverulegt merki í samkaupum okkar,
 * eða er þetta hávaði?
 *
 * Hugmyndin kom 2026-09-16: geta tillögur um tengdar vörur ratað inn í
 * vöruinnihald-appið (admin/voruinnihald_app.html)? Fyrsta dæmið var
 * pappírsskammtarar → miðaþurrkur. Áður en nokkurt viðmót er byggt
 * þarf að vita hvort gögnin beri merkið.
 *
 * ── AF HVERJU LIFT EN EKKI TALNING ──────────────────────────────────
 * Í heildsölu er hrátt samkaup gagnslaust. Stór viðskiptavinur pantar
 * fjörutíu óskyldar vörur á einum reikningi, svo mest selda varan í
 * húsinu kemur fyrir með ÖLLU. Talning myndi því tengja skammtara við
 * salernispappír, ekki af því þeir eigi saman heldur af því
 * salernispappír er á öllum reikningum.
 *
 * Lift leiðréttir fyrir þetta: hversu miklu OFTAR koma A og B saman en
 * þau myndu gera af tilviljun, miðað við hvað hvort um sig er algengt.
 *
 *   lift(A,B) = P(A og B) / (P(A) × P(B)) = co × N / (cntA × cntB)
 *
 * lift = 1 þýðir tilviljun. lift = 10 þýðir tíu sinnum oftar en
 * tilviljun segir til um. Það er merkið sem við erum að leita að.
 *
 * `confidence` fylgir með því lift getur orðið hátt á örfáum
 * reikningum. Bæði þarf að vera sæmilegt til að tillaga sé nothæf,
 * og þess vegna er `minSupport` til.
 *
 * ── STÓRU REIKNINGARNIR ─────────────────────────────────────────────
 * Reikningar yfir `maxLines` línum eru sleppt. Þeir eru
 * birgðapantanir, ekki verkefnakaup, og þeir tengja allt við allt.
 * Sjálfgefið 40; fallið prentar hve mörgum var sleppt svo hægt sé að
 * meta hvort markið sé rétt.
 ************************************************************/


/************************************************************
 * 📊 pimRelatedCandidates_v1 — aðalmælingin
 *
 *   pimRelatedCandidates_v1()                        → Pappírsskammtarar
 *   pimRelatedCandidates_v1({ level3: 'Moppur' })    → annar flokkur
 *
 * Valkostir:
 *   level3      undirflokkur sem á að greina  ('Pappírsskammtarar')
 *   groupBy     'invoice' eða 'customer'      ('invoice')
 *   maxLines    sleppa körfum yfir þessu      (40 / 600)
 *   minSupport  lágmarksfjöldi sameiginlegra karfa (3)
 *   topN        hve margar tillögur á vöru    (6)
 *   maxTargets  hve margar vörur á að prenta  (12)
 *   exclude     Level 3 flokkar sem á að fela ([])
 *
 * ── GROUPBY: HVERS VEGNA TVÆR HÓPANIR ───────────────────────────────
 * Fyrsta keyrslan (2026-09-16, invoice) svaraði ekki spurningunni sem
 * var spurð, en hún svaraði skýrt:
 *
 *   Pappírsskammtarar 63 | Sápuskammtarar 37 | Ruslafötur 12
 *   Miðaþurrkur 3
 *
 * Skammtarar eru keyptir með ÖÐRUM SKAMMTURUM. Ástæðan er að skammtari
 * er keyptur þegar salerni er innréttað — þá fer sápuskammtari,
 * pappírsskammtari og ruslafata á sama reikning. Pappírinn er keyptur
 * aftur og aftur næstu árin, á allt öðrum reikningum.
 *
 * Reikningurinn fangar því UPPSETNINGUNA. Til að ná ÁFYLLINGUNNI þarf
 * stærri einingu: viðskiptavininn yfir alla söguna. Spurningin verður
 * þá "þeir sem keyptu skammtara X — hvað kaupa þeir ítrekað sem aðrir
 * kaupa ekki?", og það er sama lift-stærðfræði á annarri hópun.
 *
 * Varúð á customer-hópun: körfurnar eru margfalt stærri og N margfalt
 * minna (viðskiptavinir, ekki reikningar), svo lift verður lægra og
 * confidence hærra á öllu. Berðu saman innan keyrslu, ekki milli.
 ************************************************************/
function pimRelatedCandidates_v1(opts) {
  const o = opts || {};
  const LEVEL3     = o.level3 || 'Pappírsskammtarar';
  const BY_CUST    = String(o.groupBy || 'invoice').toLowerCase() === 'customer';
  const MAX_LINES  = o.maxLines || (BY_CUST ? 600 : 40);
  const MIN_SUPP   = o.minSupport || 3;
  const TOP_N      = o.topN || 6;
  const MAX_TARGET = o.maxTargets || 12;

  // Flokkar sem á að fela. Á invoice-hópun drukkna áfyllingarnar í
  // innréttingarmynstrinu; exclude hreinsar það frá án þess að henda
  // gögnunum úr útreikningnum sjálfum.
  const EXCLUDE = {};
  (o.exclude || []).forEach(function (c) { EXCLUDE[String(c).toLowerCase()] = true; });

  // ---------------------------------------------------------
  // 1) PRODUCTS → flokkur og heiti á SKU
  // ---------------------------------------------------------
  const products = loadTableBySchema_('PRODUCTS');
  if (!Array.isArray(products)) throw new Error('PRODUCTS skilaði ekki fylki.');

  const meta = {};
  const targets = [];

  products.forEach(function (r) {
    const sku = normalizeSkuGlobal_(r.SKU);
    if (!sku) return;
    const l3 = String(r.LEVEL3 || '').trim();
    meta[sku] = {
      name: String(r.NAME || '').trim(),
      l2: String(r.LEVEL2 || '').trim(),
      l3: l3
    };
    if (l3.toLowerCase() === LEVEL3.toLowerCase()) targets.push(sku);
  });

  Logger.log('📦 PRODUCTS: ' + Object.keys(meta).length + ' vörur | "' +
             LEVEL3 + '": ' + targets.length + ' skotmörk');

  if (!targets.length) {
    Logger.log('⚠️ Enginn undirflokkur með þessu nafni. Athugaðu stafsetningu — ' +
               'gildin koma úr Cludo-breadcrumbs í PRODUCTS (Level 3).');
    return { targets: 0 };
  }

  // ---------------------------------------------------------
  // 2) BC_LINES → reikningur -> mengi SKU
  //
  // Set á hvern reikning, ekki fylki: sama vara getur verið á tveim
  // línum (mismunandi eining eða afsláttur) og á ekki að telja tvisvar.
  // ---------------------------------------------------------
  const lines = loadTableBySchema_('BC_LINES');
  if (!Array.isArray(lines)) throw new Error('BC_LINES skilaði ekki fylki.');

  const baskets = {};
  lines.forEach(function (r) {
    const key = BY_CUST
      ? String(r.COMPANY_ID || '').trim()
      : String(r.DOCUMENT_NO || '').trim();
    const sku = normalizeSkuGlobal_(r.SKU);
    if (!key || !sku) return;
    if (!baskets[key]) baskets[key] = {};
    baskets[key][sku] = true;
  });

  const allDocs = Object.keys(baskets);
  let skipped = 0;
  const kept = [];

  allDocs.forEach(function (doc) {
    const skus = Object.keys(baskets[doc]);
    if (skus.length < 2) { skipped++; return; }      // körfu með einni vöru segir ekkert
    if (skus.length > MAX_LINES) { skipped++; return; }
    kept.push(skus);
  });

  const N = kept.length;
  const UNIT = BY_CUST ? 'viðskiptavinir' : 'reikningar';
  Logger.log('🧾 BC_LINES: ' + lines.length + ' línur | ' + allDocs.length + ' ' +
             UNIT + ' | notaðir: ' + N + ' | sleppt: ' + skipped +
             ' (ein vara eða >' + MAX_LINES + ' vörur)');
  Logger.log('   hópun: ' + (BY_CUST ? 'VIÐSKIPTAVINUR (áfylling)' : 'REIKNINGUR (uppsetning)'));

  if (N < 50) {
    Logger.log('⚠️ Of fáir nothæfir reikningar til að marka sé á tölunum.');
    return { targets: targets.length, baskets: N };
  }

  // ---------------------------------------------------------
  // 3) Tíðni og samkoma
  //
  // Aðeins samkoma sem SNERTIR skotmark er talin. Full N×N fylki yfir
  // allan vörulistann væri óþarft og myndi sprengja minnið.
  // ---------------------------------------------------------
  const cnt = {};          // sku -> fjoldi reikninga
  const co  = {};          // targetSku -> { sku: fjoldi }
  const isTarget = {};
  targets.forEach(function (s) { isTarget[s] = true; co[s] = {}; });

  kept.forEach(function (skus) {
    skus.forEach(function (s) { cnt[s] = (cnt[s] || 0) + 1; });

    const t = skus.filter(function (s) { return isTarget[s]; });
    if (!t.length) return;

    t.forEach(function (a) {
      skus.forEach(function (b) {
        if (b === a) return;
        co[a][b] = (co[a][b] || 0) + 1;
      });
    });
  });

  // ---------------------------------------------------------
  // 4) Raða og prenta
  // ---------------------------------------------------------
  const ranked = targets
    .filter(function (a) { return (cnt[a] || 0) > 0; })
    .map(function (a) {
      const partners = Object.keys(co[a]).map(function (b) {
        const c = co[a][b];
        const lift = (c * N) / ((cnt[a] || 1) * (cnt[b] || 1));
        return {
          sku: b,
          co: c,
          conf: c / cnt[a],
          lift: lift,
          name: (meta[b] && meta[b].name) || '(ekki í PRODUCTS)',
          l3: (meta[b] && meta[b].l3) || ''
        };
      })
      .filter(function (p) {
        if (p.co < MIN_SUPP) return false;
        return !EXCLUDE[p.l3.toLowerCase()];
      })
      // Raðað á lift × confidence, ekki hreinu lifti. Fyrsta keyrslan
      // skilaði lift 1120 á conf 11% / n=5 — smátölubólga sem ýtti
      // raunverulegum mynstrum (conf 50%, lift 80) niður fyrir tilviljanir.
      .sort(function (x, y) { return (y.lift * y.conf) - (x.lift * x.conf); })
      .slice(0, TOP_N);

      return { sku: a, name: (meta[a] && meta[a].name) || '', cnt: cnt[a], partners: partners };
    })
    .sort(function (x, y) { return y.cnt - x.cnt; });

  Logger.log('══════════════════════════════════════════════════');
  Logger.log('TILLÖGUR — "' + LEVEL3 + '" (raðað eftir lift)');
  Logger.log('══════════════════════════════════════════════════');

  ranked.slice(0, MAX_TARGET).forEach(function (t) {
    Logger.log('');
    Logger.log('▶ ' + t.sku + '  ' + t.name + '   (' + t.cnt + ' reikningar)');
    if (!t.partners.length) {
      Logger.log('    engar tillögur yfir minSupport=' + MIN_SUPP);
      return;
    }
    t.partners.forEach(function (p) {
      Logger.log('    lift ' + p.lift.toFixed(1).padStart(6) +
                 ' | conf ' + (p.conf * 100).toFixed(0).padStart(3) + '%' +
                 ' | n=' + String(p.co).padStart(3) +
                 ' | ' + p.sku + ' ' + p.name.slice(0, 42) +
                 (p.l3 ? '  [' + p.l3 + ']' : ''));
    });
  });

  // ---------------------------------------------------------
  // 5) Dómurinn: lenda tillögurnar í skyldum flokkum?
  //
  // Þetta er mælikvarðinn sem skiptir máli. Ef efstu tillögurnar
  // dreifast jafnt yfir alla flokka vörulistans er ekkert merki.
  // ---------------------------------------------------------
  const byCat = {};
  ranked.forEach(function (t) {
    t.partners.forEach(function (p) {
      const k = p.l3 || '(óflokkað)';
      byCat[k] = (byCat[k] || 0) + 1;
    });
  });

  const catRank = Object.keys(byCat)
    .map(function (k) { return { cat: k, n: byCat[k] }; })
    .sort(function (a, b) { return b.n - a.n; });

  Logger.log('');
  Logger.log('══════════════════════════════════════════════════');
  Logger.log('DÓMURINN — í hvaða flokkum lenda tillögurnar?');
  Logger.log('══════════════════════════════════════════════════');
  catRank.slice(0, 15).forEach(function (c) {
    Logger.log('  ' + String(c.n).padStart(4) + '  ' + c.cat);
  });
  Logger.log('');
  Logger.log('Merki ef efstu flokkarnir eru skyldir (t.d. Miðaþurrkur,');
  Logger.log('Handþurrkur) — hávaði ef þeir eru óskyldir stórseljendur.');

  return {
    targets: targets.length,
    baskets: N,
    skipped: skipped,
    topCategories: catRank.slice(0, 10)
  };
}


/************************************************************
 * 🧭 TENGDAR VÖRUR — læra regluna af því sem er þegar skráð
 *
 * Vefurinn er með `relatedProducts` á vöruspjaldinu og starfsfólk hefur
 * fyllt hluta þeirra inn handvirkt. Mælt 2026-09-16:
 *
 *   1.985 vörur af 4.476 (44,3%) hafa tengsl — 9.913 tengsl alls
 *   2.491 vara hefur ENGIN
 *   86% tengsla eru gagnkvæm (A->B og B->A bæði skráð)
 *
 * Skráðu tengslin eru því ekki bara gögn sem á að fylla upp í, þau eru
 * FYRIRMYNDIN. Reglan á ekki að koma úr ágiskun minni um hvað passi
 * saman heldur úr því sem starfsfólk hefur þegar valið.
 *
 * ── HVERS VEGNA TVÖ FÖLL ────────────────────────────────────────────
 * `relatedProducts` leysist aðeins upp í getSingleProductV2 — hvorki
 * listafyrirspurnin né `skus`-lotan skila þeim (prófað, bæði skila
 * tómu). Það þarf eitt HTTP-kall á vöru, 4.476 alls. Það kemst ekki
 * fyrir í einni keyrslu, svo söfnunin er sér og endurræsanleg.
 *
 * ── FLOKKATRÉÐ ──────────────────────────────────────────────────────
 * Kemur úr VINNUSHEET (Yfirflokkur/Flokkur/Undirflokkur), ekki af
 * vefnum: `categories` í GraphQL skilar núlli og engin flokkasía er til.
 *
 * Lyklað á FULLA SLÓÐ, ekki undirflokksheitið eitt. 77 heiti liggja
 * undir fleiri en einni slóð (`Hanskar` er bæði undir Heilbrigðisvörum
 * og Rekstrarvörum) — sjá `vi_key_` í admin/voruinnihald.js. Lyklun á
 * heitið eitt myndi renna ólíkum flokkum saman og reglan lærði vitleysu.
 ************************************************************/

var PIM_REL_SHEET_ = 'TENGSL_HRA';
var PIM_REL_GQL_   = 'https://www.storkaup.is/api/graphql';
var PIM_REL_CHUNK_ = 60;     // fetchAll i einu
var PIM_REL_BUDGET_MS_ = 240000;   // 4 min af 6 — skilur eftir fyrir skrif


/** Grunn-SKU: STO_20829_KASSI -> 20829. Sama regla og storkaupParentSku_. */
function pimRelBase_(sku) {
  return String(sku || '').replace(/^STO_/i, '').split('_')[0];
}


/************************************************************
 * 🔑 pimRelRawSkus_ — HRÁ SKU, ekki strippuð
 *
 * ÞETTA FALL ER TIL VEGNA VILLU SEM KOSTAÐI HEILA KEYRSLU.
 *
 * Fyrsta útgáfa sótti listann með `fetchActiveProducts_()` og spurði
 * `'STO_' + p.parent`. En `parent` er STRIPPAÐ grunn-SKU
 * (STO_104924_KASSI -> 104924), og getSingleProductV2 flettir upp á
 * RAUNVERULEGA auðkenninu. 3.687 af 4.475 vörum bera einingarendingu,
 * svo langflestar fyrirspurnir slógu í tómt og skiluðu engum tengslum:
 *
 *   mælt gegnum GAS með strippuðu SKU : 117 vörur / 569 tengsl
 *   mælt beint með hráu node.sku      : 1.985 vörur / 9.913 tengsl
 *
 * Villan var þögul — hvert kall skilaði HTTP 200 með `null` í gögnunum,
 * svo ekkert taldist mistakast. Hún fannst aðeins af því krossathugun
 * við sjálfstæða mælingu var innbyggð í `pimRelatedRules_v1`.
 *
 * Þess vegna les þetta fall `node.sku` beint og strippar aldrei.
 *
 * ── PAGINERINGIN FLUTT ÚT 2026-09-21 ────────────────────────────────
 * Fallið hafði sína eigin lykkju yfir getProductsV2 — 23 beiðnir til að
 * ná í einn dálk. Hún var þriðja afritið af sömu lykkju í kóðabasanum.
 * `fetchWebCatalogRows_()` í core/web_catalog.js skilar `webSku`
 * ÓBREYTTU úr `node.sku`, sem er nákvæmlega krafan hér að ofan, svo
 * þetta er sama gildi eftir sömu leið — bara ekki sótt tvisvar.
 *
 * ATH: það verður að vera `webSku`, ekki `sku`. Sá síðarnefndi er
 * normalíseraður (STO_104924_KASSI → 104924) og er einmitt villan sem
 * þessi haus lýsir. Sé þessu víxlað fellur mælingin úr 1.985 vörum
 * niður í 117 — þögult, með HTTP 200 í hverju kalli.
 ************************************************************/
function pimRelRawSkus_() {
  const fetched = fetchWebCatalogRows_();
  const out = [];
  const seen = {};

  fetched.rows.forEach(function (r) {
    const sku = r.webSku;
    if (sku && !seen[sku]) { seen[sku] = true; out.push(sku); }
  });

  Logger.log('🔑 ' + out.length + ' hrá SKU (totalCount ' + fetched.totalCount + ')');
  return out;
}


/************************************************************
 * 📥 pimRelatedFetch_v1 — sækir tengslin, endurræsanlegt
 *
 * Keyrðu aftur og aftur þar til hún segir "BÚIÐ". Hver keyrsla tekur
 * við þar sem sú fyrri hætti; staðan liggur í TENGSL_HRA-flipanum
 * sjálfum, ekki í Script Properties, svo hún lifir af hvað sem er.
 ************************************************************/
function pimRelatedFetch_v1(opts) {
  const o = opts || {};
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);

  let sh = ss.getSheetByName(PIM_REL_SHEET_);
  if (sh && o.reset === true) { ss.deleteSheet(sh); sh = null; }
  if (!sh) {
    sh = ss.insertSheet(PIM_REL_SHEET_);
    sh.appendRow(['SKU', 'Tengd SKU', 'Sótt']);
    sh.getRange('A:B').setNumberFormat('@');
  }

  const have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { have[String(r[0]).trim()] = true; });
  }

  const all = pimRelRawSkus_();
  const todo = all.filter(function (sku) { return !have[sku]; });

  Logger.log('📦 ' + all.length + ' vörur | sótt áður: ' + Object.keys(have).length +
             ' | eftir: ' + todo.length);
  if (!todo.length) {
    Logger.log('✅ BÚIÐ — keyrðu pimRelatedRules_v1() næst.');
    return { done: true };
  }

  const Q = 'query($sku: String!) { getSingleProductV2(sku: $sku) ' +
            '{ sku relatedProducts { sku } } }';
  const t0 = Date.now();
  const rows = [];
  let i = 0;

  while (i < todo.length && (Date.now() - t0) < PIM_REL_BUDGET_MS_) {
    const batch = todo.slice(i, i + PIM_REL_CHUNK_);
    i += batch.length;

    const reqs = batch.map(function (sku) {
      return {
        url: PIM_REL_GQL_,
        method: 'post',
        contentType: 'application/json',
        headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
        muteHttpExceptions: true,
        payload: JSON.stringify({ query: Q, variables: { sku: sku } })
      };
    });

    let responses;
    try {
      responses = UrlFetchApp.fetchAll(reqs);
    } catch (e) {
      Logger.log('⚠️ fetchAll féll: ' + e.message + ' — hætti og vista það sem komið er.');
      break;
    }

    responses.forEach(function (res, k) {
      const sku = batch[k];
      if (res.getResponseCode() !== 200) { rows.push([sku, '', new Date()]); return; }
      const d = safeJsonParse_(res.getContentText()) || {};
      const p = (d.data && d.data.getSingleProductV2) || {};
      const rel = (p.relatedProducts || []).map(function (r) { return r.sku; });
      rows.push([sku, rel.join(','), new Date()]);
    });
  }

  if (rows.length) {
    const at = sh.getLastRow() + 1;
    sh.getRange(at, 1, rows.length, 3).setValues(rows);
    sh.getRange(at, 1, rows.length, 2).setNumberFormat('@');
  }

  const left = todo.length - rows.length;
  Logger.log('💾 skrifaðar ' + rows.length + ' raðir | eftir: ' + left);
  Logger.log(left > 0 ? '↻ KEYRÐU AFTUR — ekki búið.' : '✅ BÚIÐ.');
  return { fetched: rows.length, remaining: left };
}


/************************************************************
 * 📐 pimRelatedRules_v1 — lærir flokkaparið og MÆLIR sig
 *
 * Tvennt í einni keyrslu:
 *
 *   1. Hvaða flokkur tengist hvaða flokki, talið úr skráðu tengslunum.
 *   2. Hversu vel það spáir — mælt með því að halda eftir fimmtungi
 *      tengslanna, byggja regluna á hinum fjórum og telja hversu oft
 *      rétt flokkspar er í topp-3.
 *
 * Skref 2 er það sem skiptir máli. Án þess er þetta bara tafla sem
 * lítur sannfærandi út. Með því fæst tala: "reglan hittir á X% af
 * þínum eigin völum" — og þá er hægt að ákveða hvort hún megi giska
 * á vörurnar 2.491 sem hafa ekkert.
 ************************************************************/
function pimRelatedRules_v1(opts) {
  const o = opts || {};
  const HOLDOUT = o.holdout === undefined ? 0.2 : o.holdout;
  const TOPK = o.topK || 3;

  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);

  // --- flokkatred ur VINNUSHEET ---
  const wsh = ss.getSheetByName('Vinnusheet');
  if (!wsh) throw new Error('Flipinn „Vinnusheet" finnst ekki.');
  const wv = wsh.getDataRange().getValues();
  const wh = wv[0].map(function (h) {
    return String(h || '').toLowerCase().replace(/[\s_\-]/g, '');
  });
  function col_(name) {
    const j = wh.indexOf(name.toLowerCase().replace(/[\s_\-]/g, ''));
    if (j < 0) throw new Error('Kólumnan „' + name + '" finnst ekki í Vinnusheet.');
    return j;
  }
  const cSku = col_('SKU'), c1 = col_('Yfirflokkur'), c2 = col_('Flokkur'), c3 = col_('Undirflokkur');

  const path = {};
  for (let r = 1; r < wv.length; r++) {
    const s = pimRelBase_(wv[r][cSku]);
    if (!s) continue;
    path[s] = [String(wv[r][c1] || '').trim(),
               String(wv[r][c2] || '').trim(),
               String(wv[r][c3] || '').trim()].join(' › ');
  }
  Logger.log('🌳 Vinnusheet: ' + Object.keys(path).length + ' vörur með flokkaslóð');

  // --- tengslin ---
  const rsh = ss.getSheetByName(PIM_REL_SHEET_);
  if (!rsh || rsh.getLastRow() < 2) {
    throw new Error('TENGSL_HRA er tómt — keyrðu pimRelatedFetch_v1() fyrst.');
  }
  const rv = rsh.getRange(2, 1, rsh.getLastRow() - 1, 2).getValues();

  const edges = [];
  let withRel = 0;
  rv.forEach(function (row) {
    const src = pimRelBase_(row[0]);
    const tgts = String(row[1] || '').split(',').map(function (x) { return pimRelBase_(x); })
      .filter(Boolean);
    if (!src || !tgts.length) return;
    withRel++;
    tgts.forEach(function (t) { edges.push([src, t]); });
  });

  Logger.log('🔗 ' + rv.length + ' vörur sóttar | ' + withRel + ' með tengsl | ' +
             edges.length + ' tengsl');

  // --- skipta i thjalfun og prof ---
  // Fast fræ: sama skipting milli keyrslna, svo tolur seu samanburdarhaefar.
  let seed = 12345;
  function rnd_() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  const train = [], test = [];
  edges.forEach(function (e) { (rnd_() < HOLDOUT ? test : train).push(e); });

  const pairs = {};
  const srcTotal = {};
  train.forEach(function (e) {
    const a = path[e[0]], b = path[e[1]];
    if (!a || !b) return;
    if (!pairs[a]) pairs[a] = {};
    pairs[a][b] = (pairs[a][b] || 0) + 1;
    srcTotal[a] = (srcTotal[a] || 0) + 1;
  });

  // --- taflan ---
  const flat = [];
  Object.keys(pairs).forEach(function (a) {
    Object.keys(pairs[a]).forEach(function (b) {
      flat.push({ a: a, b: b, n: pairs[a][b], share: pairs[a][b] / srcTotal[a] });
    });
  });
  flat.sort(function (x, y) { return y.n - x.n; });

  Logger.log('');
  Logger.log('════ 25 ALGENGUSTU FLOKKAPÖRIN (úr ykkar eigin skráningu) ════');
  flat.slice(0, 25).forEach(function (p) {
    Logger.log('  ' + String(p.n).padStart(5) + '  ' + (p.share * 100).toFixed(0).padStart(3) + '%  ' +
               p.a.split(' › ').pop() + '  →  ' + p.b.split(' › ').pop() +
               (p.a === p.b ? '   <SAMI FLOKKUR>' : ''));
  });

  // --- MÆLINGIN ---
  const top = {};
  Object.keys(pairs).forEach(function (a) {
    top[a] = Object.keys(pairs[a])
      .sort(function (x, y) { return pairs[a][y] - pairs[a][x]; })
      .slice(0, TOPK);
  });

  // MÆLT SUNDURLIÐAÐ — SAMI FLOKKUR OG KROSS SÉR.
  //
  // Heildartalan er blekkjandi. Yfirgnæfandi meirihluti skráðra tengsla
  // er innan flokks (Orkudrykkir->Orkudrykkir 97%, Gos->Gos 98%), og að
  // spá "sami flokkur" hittir næstum alltaf. Fyrsta keyrslan á fullum
  // gögnum gaf 93,4% heild — sem mælir aðallega hve auðveldur
  // meirihlutinn er.
  //
  // Krosstengslin eru erfiða málið OG það sem spurt var um:
  // skammtari -> áfylling er kross. Sé krosstalan lág dugar flokkurinn
  // fyrir afbrigði en ekki fyrir fylgihluti, og þá þarf annað merki.
  let hit = 0, miss = 0, unknown = 0;
  let sHit = 0, sTot = 0, xHit = 0, xTot = 0;

  test.forEach(function (e) {
    const a = path[e[0]], b = path[e[1]];
    if (!a || !b || !top[a]) { unknown++; return; }
    const ok = top[a].indexOf(b) !== -1;
    if (ok) hit++; else miss++;
    if (a === b) { sTot++; if (ok) sHit++; }
    else { xTot++; if (ok) xHit++; }
  });

  const scored = hit + miss;
  function pct_(h, t) { return t ? (100 * h / t).toFixed(1) + '%' : '—'; }

  Logger.log('');
  Logger.log('════ MÆLINGIN — spáir reglan fyrir um ykkar eigin val? ════');
  Logger.log('  þjálfun: ' + train.length + ' tengsl | próf: ' + test.length);
  Logger.log('  metin  : ' + scored + ' | utan trés: ' + unknown);
  Logger.log('');
  Logger.log('  HEILD        topp-' + TOPK + ': ' + hit + '/' + scored + ' = ' + pct_(hit, scored));
  Logger.log('  SAMI FLOKKUR          : ' + sHit + '/' + sTot + ' = ' + pct_(sHit, sTot) +
             '   (' + pct_(sTot, scored) + ' af prófinu)');
  Logger.log('  KROSSTENGSL           : ' + xHit + '/' + xTot + ' = ' + pct_(xHit, xTot) +
             '   (' + pct_(xTot, scored) + ' af prófinu)');
  Logger.log('');
  Logger.log('  Krosstalan er sú sem skiptir máli fyrir fylgihluti');
  Logger.log('  (skammtari -> áfylling). Heildartalan er borin uppi af');
  Logger.log('  afbrigðum innan flokks og segir lítið um þau.');

  return {
    edges: edges.length, train: train.length, test: test.length,
    hit: hit, scored: scored,
    accuracy: scored ? hit / scored : 0,
    sameAcc: sTot ? sHit / sTot : null, sameN: sTot,
    crossAcc: xTot ? xHit / xTot : null, crossN: xTot
  };
}


/************************************************************
 * 💡 pimRelatedSuggest_v1 — tillögur fyrir vörur án tengsla
 *
 * Byggt á mælingunni 2026-09-16 (pimRelatedRules_v1, 9.939 tengsl):
 *
 *   sami flokkur : 99,3% (67% tengslanna)
 *   krosstengsl  : 81,5% (33% tengslanna)
 *
 * Krosstalan var forsendan. Hefði hún verið lág mætti reglan aðeins
 * stinga upp á afbrigðum innan flokks, og fylgihlutir (skammtari ->
 * áfylling) hefðu þurft allt annað merki. Hún var það ekki.
 *
 * ── TVÖ ÞREP ────────────────────────────────────────────────────────
 * 1. FLOKKUR. Hvaða flokkar tengjast flokki vörunnar, lært úr því sem
 *    starfsfólk hefur skráð. Þetta þrengir 4.475 vörur niður í tugi.
 * 2. NAFNALÍKING innan þeirra flokka. Sameiginleg orð í heitinu ráða
 *    röðinni — vörumerki vegur þyngst því það stendur fremst.
 *
 * Tölur og einingar eru vegnar létt: "20x" og "250stk" segja lítið um
 * hvað á saman og myndu annars láta allar 20-stykkja pakkningar líta
 * út fyrir að vera skyldar.
 *
 * ── ÞETTA SKRIFAR EKKI Í PLYTIX ─────────────────────────────────────
 * Úttakið er yfirferðarflipi. Tillaga er ágiskun með 81–99% hittni,
 * sem er gagnlegt til að þrengja val en ekki til að skrá blint. Sá sem
 * les hefur vöruþekkinguna; reglan hefur bara tölfræðina.
 ************************************************************/

var PIM_SUGG_SHEET_ = 'TENGSL_TILLOGUR';

/************************************************************
 * ✂️ pimRelStrip_ — STO_ burt, ENDINGIN EFTIR
 *
 * `STO_` er Plytix-forskeyti sem aðgreinir Stórkaup frá Bónus og
 * Hagkaup í sameiginlegum katalóg. Það segir ekkert innan okkar gagna
 * og er bara hávaði í yfirferðarskjali.
 *
 * EININGARENDINGIN FER EKKI:
 *   STO_20829_KASSI -> 20829_KASSI     (ekki 20829)
 *
 * Skráð tengsl benda á SÖLUAFBRIGÐIN, ekki grunnvöruna — vöruspjald
 * 107226 vísar á `STO_20829_KASSI`, ekki `STO_20829`. Væri endingin
 * strippuð líka myndu tillögurnar benda á auðkenni sem er ekki það sem
 * Plytix geymir, og hver einasta lína þyrfti handvirka leiðréttingu.
 * Sjá pimRelBase_ hér að ofan — það fall strippar bæði og er notað til
 * uppflettingar, aldrei til úttaks.
 ************************************************************/
function pimRelStrip_(sku) {
  return String(sku || '').replace(/^STO_/i, '');
}

/** Orð sem segja ekkert um skyldleika: einingar, tölur, pakkningastærðir. */
var PIM_STOP_RE_ = /^(\d+[.,]?\d*|\d+x|x\d+|ml|cl|dl|l|kg|g|gr|mm|cm|m|stk|pk|ks|kassi|bretti|lag|laga|cm2|st)$/i;

function pimTokens_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\wáéíóúýðþæö]+/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t && t.length > 1 && !PIM_STOP_RE_.test(t); });
}


function pimRelatedSuggest_v1(opts) {
  const o = opts || {};
  const TOPCAT = o.topCategories || 3;
  const TOPN   = o.topN || 5;
  const MINPAIR = o.minPair || 3;      // flokkspar tharf ad vera skrad svo oft

  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);

  // --- flokkaslod og heiti ur Vinnusheet ---
  const wsh = ss.getSheetByName('Vinnusheet');
  if (!wsh) throw new Error('Flipinn „Vinnusheet" finnst ekki.');
  const wv = wsh.getDataRange().getValues();
  const wh = wv[0].map(function (h) {
    return String(h || '').toLowerCase().replace(/[\s_\-]/g, '');
  });
  function col_(n) {
    const j = wh.indexOf(n.toLowerCase().replace(/[\s_\-]/g, ''));
    if (j < 0) throw new Error('Kólumnan „' + n + '" finnst ekki í Vinnusheet.');
    return j;
  }
  const cSku = col_('SKU'), c1 = col_('Yfirflokkur'), c2 = col_('Flokkur'),
        c3 = col_('Undirflokkur'), cNm = col_('Vöruheiti (núv.)');

  const path = {}, nm = {};
  for (let r = 1; r < wv.length; r++) {
    const s = pimRelBase_(wv[r][cSku]);
    if (!s) continue;
    path[s] = [String(wv[r][c1] || '').trim(), String(wv[r][c2] || '').trim(),
               String(wv[r][c3] || '').trim()].join(' › ');
    nm[s] = String(wv[r][cNm] || '').trim();
  }

  // --- tengslin. DEDUP: flipinn getur haft badar utgafur af sama SKU
  // (gamla strippada formid skildi eftir tomar radir, sja pimRelRawSkus_).
  // Rod MED tengslum vinnur alltaf. ---
  const rsh = ss.getSheetByName(PIM_REL_SHEET_);
  if (!rsh || rsh.getLastRow() < 2) {
    throw new Error('TENGSL_HRA er tómt — keyrðu pimRelatedFetch_v1() fyrst.');
  }
  const rv = rsh.getRange(2, 1, rsh.getLastRow() - 1, 2).getValues();

  const relOf = {}, rawOf = {};
  rv.forEach(function (row) {
    const raw = String(row[0] || '').trim();
    const b = pimRelBase_(raw);
    if (!b) return;
    const t = String(row[1] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (relOf[b] && relOf[b].length && !t.length) return;   // ekki yfirskrifa
    relOf[b] = t;
    if (!rawOf[b] || t.length) rawOf[b] = raw;
  });

  const skus = Object.keys(relOf);
  const withRel = skus.filter(function (s) { return relOf[s].length; });
  Logger.log('🔗 ' + skus.length + ' vörur | með tengsl: ' + withRel.length +
             ' | án: ' + (skus.length - withRel.length));

  // --- laera flokkaparid af OLLUM tengslum (ekkert holdout her) ---
  const pairs = {}, tot = {};
  withRel.forEach(function (a) {
    const pa = path[a];
    if (!pa) return;
    relOf[a].forEach(function (t) {
      const pb = path[pimRelBase_(t)];
      if (!pb) return;
      if (!pairs[pa]) pairs[pa] = {};
      pairs[pa][pb] = (pairs[pa][pb] || 0) + 1;
      tot[pa] = (tot[pa] || 0) + 1;
    });
  });

  const topCats = {};
  Object.keys(pairs).forEach(function (a) {
    topCats[a] = Object.keys(pairs[a])
      .filter(function (b) { return pairs[a][b] >= MINPAIR; })
      .sort(function (x, y) { return pairs[a][y] - pairs[a][x]; })
      .slice(0, TOPCAT);
  });

  // --- vorur eftir flokki, til ad na i frambjodendur ---
  const byCat = {};
  skus.forEach(function (s) {
    const p = path[s];
    if (!p) return;
    if (!byCat[p]) byCat[p] = [];
    byCat[p].push(s);
  });

  // --- tillogur ---
  const targets = skus.filter(function (s) { return !relOf[s].length && path[s]; });
  Logger.log('🎯 vörur án tengsla með flokkaslóð: ' + targets.length);

  const rows = [];
  let noRule = 0;

  targets.forEach(function (a) {
    const pa = path[a];
    const cats = topCats[pa];
    if (!cats || !cats.length) { noRule++; return; }

    const ta = pimTokens_(nm[a]);
    const cand = [];

    cats.forEach(function (pb) {
      const share = pairs[pa][pb] / tot[pa];
      (byCat[pb] || []).forEach(function (b) {
        if (b === a) return;
        const tb = pimTokens_(nm[b]);
        if (!tb.length) return;
        let shared = 0;
        ta.forEach(function (t) { if (tb.indexOf(t) !== -1) shared++; });
        if (!shared) return;                  // ekkert sameiginlegt -> sleppum
        // Vorumerki stendur fremst i heitinu og vegur thyngst.
        const brand = (ta.length && tb.length && ta[0] === tb[0]) ? 1 : 0;
        const overlap = shared / Math.max(ta.length, tb.length);
        cand.push({ sku: b, score: share * (overlap + brand), shared: shared,
                    brand: brand, cat: pb, share: share });
      });
    });

    cand.sort(function (x, y) { return y.score - x.score; });
    cand.slice(0, TOPN).forEach(function (c) {
      rows.push([
        pimRelStrip_(rawOf[a] || a), nm[a] || '', pa.split(' › ').pop(),
        pimRelStrip_(rawOf[c.sku] || c.sku), nm[c.sku] || '', c.cat.split(' › ').pop(),
        Number(c.score.toFixed(3)),
        (pa === c.cat ? 'Sami flokkur' : 'Krossflokkur ' + (c.share * 100).toFixed(0) + '%') +
        ', ' + c.shared + ' sameiginleg orð' + (c.brand ? ', sama vörumerki' : '')
      ]);
    });
  });

  Logger.log('💡 ' + rows.length + ' tillögur á ' +
             (new Set(rows.map(function (r) { return r[0]; }))).size + ' vörur');
  Logger.log('   engin regla fyrir flokkinn: ' + noRule + ' vörur');

  // --- skrifa flipann ---
  let out = ss.getSheetByName(PIM_SUGG_SHEET_);
  if (out) ss.deleteSheet(out);
  out = ss.insertSheet(PIM_SUGG_SHEET_);
  const HEAD = ['SKU', 'Vöruheiti', 'Flokkur', 'Tillaga SKU', 'Tillaga heiti',
                'Tillaga flokkur', 'Stig', 'Rök'];
  out.appendRow(HEAD);
  if (rows.length) {
    out.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
    out.getRange(1, 1, rows.length + 1, 1).setNumberFormat('@');
    out.getRange(1, 4, rows.length + 1, 1).setNumberFormat('@');
  }
  out.setFrozenRows(1);
  Logger.log('📄 skrifað í flipann „' + PIM_SUGG_SHEET_ + '"');

  return { targets: targets.length, rows: rows.length, noRule: noRule };
}

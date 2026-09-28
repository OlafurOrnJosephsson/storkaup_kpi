'use strict';

/************************************************************
 * 📦 pakkning_i_heiti.js — hversu mörg vöruheiti bera pakkninguna
 *
 * SPURNINGIN (2026-09-28): á „12x 750ml" að standa í vöruheitinu þegar
 * vefurinn býður STK og KASSA? Tillagan er að heitið lýsi EINNI einingu
 * og sölueiningin sýni pakkninguna. Áður en það er ákveðið: hversu margar
 * vörur snertir það, og hverjar eru undantekningarnar?
 *
 * Plytix-útdrátturinn veit ekkert um sölueiningar. Þær koma aðeins úr
 * getProductsV2 (opinbert, engir lyklar), svo þetta keyrir í Apps Script.
 *
 * FJÓRIR FLOKKAR, á parent-SKU:
 *   VAL       — fleiri en ein sölueining á sömu færslu (STK + KASSI).
 *               Pakkningin á heima í valinu → fjarlægja úr heiti.
 *   KASSI     — ein sölueining með fleiri en 1 stk (t.d. Kassi (2 stk)).
 *               Sama regla → fjarlægja; kassinn sýnir hana.
 *   SER_SKU   — tvær færslur strippast í sama parent (103406_KASSI og
 *               103406_STK). Pakkningin er eina leiðin til að greina þær
 *               að í leit og körfu → HALDA.
 *   STAKT     — ein eining, 1 stk. „Nx" í heiti hér er grunsamlegt: annað
 *               hvort er varan í raun seld í kassa sem kallast STK, eða
 *               heitið er rangt → ATHUGA.
 *
 * Aukaathugun: stemmir N í heitinu við stk í sölueiningu? „12x" í heiti
 * á vöru sem er „Kassi (6 stk)" er gagnavilla hvað sem reglunni líður.
 *
 * Skrifar flipann PAKKNING_I_HEITI í SALES_SUMMARIES (opnað eftir
 * auðkenni) og samantekt í keyrsluskrána. Snertir EKKI
 * vinnusheetið og breytir engu heiti.
 ************************************************************/

var PIH_SHEET_ = 'PAKKNING_I_HEITI';

/** `12x 750ml`, `2x 5L`, `24x20stk`, `20x 50stk`. Einingin er SKYLD:
 *  `364x325` og `14x19cm` eru mál á vörunni, ekki pakkning (sjá
 *  pim/README.md um sama greinarmun í linternum). */
var PIH_PACK_RE_ = /(\d+)\s?[x×]\s?\d+(?:[.,]\d+)?\s?(kg|g|ml|cl|dl|l|stk|pk|rl)(?![a-záðéíóúýþæö])/i;

function countPackInNames_v1() {
  var nodes = pih_fetchAll_();

  // Hópa á parent — tvær færslur á sama parent = sér SKU per einingu.
  var byParent = {};
  nodes.forEach(function (n) {
    var p = storkaupParentSku_(n.sku);
    if (!p) return;
    (byParent[p] = byParent[p] || []).push(n);
  });

  var rows = [], tally = {}, mismatch = 0, withPack = 0;
  Object.keys(byParent).forEach(function (parent) {
    var group = byParent[parent];
    // Heitið af grunnfærslunni ef hún er til, annars fyrstu.
    var node = group.filter(function (n) { return n.variants && n.variants.length; })[0] || group[0];
    var name = String(node.name || '').trim();
    var m = name.match(PIH_PACK_RE_);
    if (!m) return;
    withPack++;

    var attrs = node.attributes || {};
    var salesUnit = String(attrs.salesUnitOfMeasure || node.salesUnitOfMeasure || '').toUpperCase();
    var perUnit = Number(attrs.salesUnitOfMeasureValue);
    if (!isFinite(perUnit) || perUnit <= 0) perUnit = null;

    var units = {};
    group.forEach(function (n) {
      if (n.salesUnitOfMeasure) units[String(n.salesUnitOfMeasure).toUpperCase()] = true;
      (n.variants || []).forEach(function (v) {
        if (v && v.salesUnitOfMeasure) units[String(v.salesUnitOfMeasure).toUpperCase()] = true;
      });
    });
    var unitList = Object.keys(units).sort();

    var cls, action;
    if (group.length > 1)            { cls = 'SER_SKU'; action = 'Halda'; }
    else if (unitList.length > 1)    { cls = 'VAL';     action = 'Fjarlægja'; }
    else if (perUnit && perUnit > 1) { cls = 'KASSI';   action = 'Fjarlægja'; }
    else                             { cls = 'STAKT';   action = 'Athuga'; }
    tally[cls] = (tally[cls] || 0) + 1;

    // N í heiti á móti stk í sölueiningu. Aðeins borið saman þar sem
    // sölueiningin er pakkning (perUnit > 1) — annars segir talan ekkert.
    var nInName = Number(m[1]);
    var agrees = '';
    if (perUnit && perUnit > 1) {
      agrees = (nInName === perUnit) ? 'Já' : 'NEI';
      if (agrees === 'NEI') mismatch++;
    }

    rows.push([
      cls, action, parent, name, m[0], salesUnit, perUnit || '',
      unitList.join(' + '), agrees, storkaupProductUrl_(node.slug)
    ]);
  });

  var order = { VAL: 0, KASSI: 1, STAKT: 2, SER_SKU: 3 };
  rows.sort(function (a, b) {
    return (order[a[0]] - order[b[0]]) || String(a[3]).localeCompare(String(b[3]), 'is');
  });

  var summary = {
    products: Object.keys(byParent).length,
    withPack: withPack,
    VAL: tally.VAL || 0, KASSI: tally.KASSI || 0,
    STAKT: tally.STAKT || 0, SER_SKU: tally.SER_SKU || 0,
    mismatch: mismatch
  };
  Logger.log('[PIH] vörur á vef: ' + summary.products +
             ' · með pakkningu í heiti: ' + summary.withPack);
  Logger.log('[PIH]   VAL (STK+KASSI) → fjarlægja: ' + summary.VAL);
  Logger.log('[PIH]   KASSI eingöngu   → fjarlægja: ' + summary.KASSI);
  Logger.log('[PIH]   STAKT            → athuga:    ' + summary.STAKT);
  Logger.log('[PIH]   SER_SKU          → halda:     ' + summary.SER_SKU);
  Logger.log('[PIH]   N í heiti ≠ stk í einingu:    ' + summary.mismatch);

  pih_write_(rows, summary);
  return summary;
}

/** Allar færslur úr getProductsV2, ÓDEDUPAÐAR — fetchActiveProducts_
 *  dedupar á parent og hendir einmitt þeim upplýsingum sem SER_SKU þarf. */
function pih_fetchAll_() {
  var PAGE = 200;
  var query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug baseUnitOfMeasure salesUnitOfMeasure' +
    '      variants { sku salesUnitOfMeasure }' +
    '      attributes { salesUnitOfMeasure salesUnitOfMeasureValue } } }' +
    '  }' +
    '}';

  var out = [], offset = 0, total = null;
  while (true) {
    var res = UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        query: query,
        variables: { pagination: { first: PAGE, offset: offset } },
        operationName: 'getProductsV2'
      })
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('getProductsV2 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    var data = JSON.parse(res.getContentText());
    if (data.errors) throw new Error('getProductsV2 errors: ' + JSON.stringify(data.errors).slice(0, 300));

    var conn = (data.data && data.data.getProductsV2) || {};
    total = conn.totalCount;
    var edges = conn.edges || [];
    if (!edges.length) break;
    edges.forEach(function (e) { if (e && e.node) out.push(e.node); });

    // Skref = fjöldi raða sem KOM (sama rök og í fetchActiveProducts_).
    offset += edges.length;
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    if (offset > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
    Utilities.sleep(120);
  }
  if (total !== null && total !== undefined && out.length < total) {
    Logger.log('⚠️ [PIH] sótti ' + out.length + ' færslur af ' + total +
               ' — tölurnar ná ekki yfir allan listann.');
  }
  return out;
}

function pih_write_(rows, s) {
  // Opnad eftir AUDKENNI, ekki getActiveSpreadsheet(): keyrt ur ritlinum
  // skiladi thad null (maelt 2026-09-28) og flipinn var aldrei skrifadur.
  var cfg = loadConfig_();
  var id = cfg.SHEETS && cfg.SHEETS.SALES_SUMMARIES && cfg.SHEETS.SALES_SUMMARIES.ID;
  if (!id) { Logger.log('[PIH] vantar SHEETS.SALES_SUMMARIES.ID — aðeins keyrsluskrá.'); return; }
  var ss = SpreadsheetApp.openById(id);

  var sh = ss.getSheetByName(PIH_SHEET_) || ss.insertSheet(PIH_SHEET_);
  sh.clear();

  var head = [['Flokkur', 'Tillaga', 'SKU', 'Vöruheiti', 'Pakkning í heiti',
               'Sölueining', 'Stk í einingu', 'Einingar í boði', 'Stemmir N?', 'Vefslóð']];
  var intro = [[
    'Keyrt ' + Utilities.formatDate(new Date(), 'Atlantic/Reykjavik', 'yyyy-MM-dd HH:mm') +
    ' · ' + s.withPack + ' af ' + s.products + ' vörum með pakkningu í heiti · ' +
    'VAL ' + s.VAL + ' · KASSI ' + s.KASSI + ' · STAKT ' + s.STAKT +
    ' · SER_SKU ' + s.SER_SKU + ' · N stemmir ekki: ' + s.mismatch
  ]];
  sh.getRange(1, 1).setValues(intro).setFontStyle('italic');
  sh.getRange(2, 1, 1, head[0].length).setValues(head).setFontWeight('bold');
  if (rows.length) sh.getRange(3, 1, rows.length, head[0].length).setValues(rows);
  sh.setFrozenRows(2);
  toast_('PAKKNING_I_HEITI: ' + s.withPack + ' vörur', 'Pakkning í heiti');
}

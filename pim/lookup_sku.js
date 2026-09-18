/************************************************************
 * 🔎 UPPFLETTING — birgjanúmer eða Stórkaups-SKU → varan á vefnum
 *
 * Límdu lista í A-kólumnu á flipanum `Uppfletting` í PIM-skjalinu,
 * keyrðu `pimLookupSkus_v1`, og flipinn fyllist af því sem fannst.
 * Blandaður listi er í lagi — fallið giskar ekki á hvort tala sé
 * birgjanúmer eða okkar SKU, það prófar báða lykla og segir hvor hitti.
 *
 * Tilefnið (2026-09-18): tengdar vörur eru unnar út frá listum frá
 * birgjum þar sem ekkert Stórkaups-SKU fylgir. Handvirk uppfletting á
 * sautján númerum tók lengri tíma en að skrifa þetta.
 *
 * ── HVAÐAN GÖGNIN KOMA ──────────────────────────────────────────────
 * `attributes.brand_sku` úr getProductsV2 (OPINBERT, enginn Bearer —
 * sbr. core/storkaup_pricing.js). Það er birgjanúmerið sjálft og er
 * fyllt út á 4.408 af 4.473 vörum í birtingu (98,5%, mælt 2026-09-18).
 * Fjarvist er því raunveruleg fjarvist, ekki gloppa í skráningu.
 *
 * MIKILVÆGT: reiturinn er FYLKI af strengjum í svarinu (`["7276"]`),
 * ekki strengur, og `null` þar sem ekkert er. `String()` beint á hann
 * gefur rétta útkomu fyrir slysni á eins staks fylki en þegjandi ranga
 * á öðru — normBrandSku_ tekur fyrsta gildið vísvitandi.
 *
 * ── LEITIN Í VEFNUM DUGAR EKKI ──────────────────────────────────────
 * `getProductsV2(search: "7276")` skilar NÚLLI þótt varan sé til með
 * nákvæmlega því brand_sku. Leitarvísirinn nær ekki yfir reitinn. Þess
 * vegna er allur listinn sóttur og borinn saman hérna megin — 23
 * beiðnir, ~30 sek. Ekkert cache: spurningin sem er verið að spyrja er
 * „er þetta á vefnum NÚNA", og dagsgamalt svar við henni er verra en
 * ekkert.
 *
 * ── AF HVERJU EKKI HLUTSTRENGSLEIT ──────────────────────────────────
 * Prófað á raunlista 2026-09-18. `contains` á 6054 skilaði Pepsi
 * (26054), servíettum (95263) og skammtara (16054001) — þrjú svör, öll
 * röng, ekkert þeirra auðþekkt sem rangt við yfirlestur. Sá sem treystir
 * slíkri töflu skrifar vitleysu inn í tengdar vörur. Leyfð eru tvö stig:
 *   nákvæmt  — eftir hreinsun á bilum, hástöfum og forleiðandi núllum
 *   laust    — aðeins bókstafir og tölustafir eftir ("AC 1/2" = "AC1/2")
 * Laust treff er merkt sem slíkt í kólumnu C. Það er tillaga, ekki svar.
 *
 * ── BIRGJANÚMER ERU EKKI EINKVÆM ────────────────────────────────────
 * 41 birgjanúmer af 4.360 eiga fleiri en eina vöru eftir normalíserun
 * (mælt 2026-09-18). Stutt númer frá ólíkum birgjum rekast á: "6135" er
 * bæði KC-ilmur og handþurrka frá Abena, og "1" — með "01" og "001" —
 * á sex matvörur. Þess vegna skilar fallið ÖLLUM treffum, hverju á sinni
 * röð, með vörumerkinu. Vörumerkið er ekki skraut í töflunni heldur það
 * sem sker úr.
 *
 * Okkar eigið SKU rekst á í nákvæmlega einu tilviki: STO_9004599_STK og
 * STO_9004599_KASSI (Brúsapumpa, Pelican) eru tvær færslur í birtingu,
 * sama vara í tveimur sölueiningum. Báðar raðir koma, sem er rétt svar —
 * það er einmitt það sem sá sem flettir upp þarf að vita.
 ************************************************************/

const PIM_LOOKUP_SHEET_ = 'Uppfletting';

const PIM_LOOKUP_COLS_ = [
  { head: 'Fyrirspurn',      w: 110 },
  { head: 'Treff',           w:  80 },
  { head: 'Lykill',          w: 130 },
  { head: 'Stórkaups-SKU',   w: 140 },
  { head: 'Birgjanúmer',     w: 110 },
  { head: 'Vöruheiti',       w: 320 },
  { head: 'Vörumerki',       w: 140 },
  { head: 'Slóð',            w: 300 }
];


/************************************************************
 * ▶️ pimLookupSkus_v1 — keyrsluhnappurinn
 *
 * Les A2:A á `Uppfletting`, flettir upp, skrifar töfluna aftur.
 * Flipinn er búinn til ef hann vantar; fyrsta keyrsla á tómum flipa
 * skrifar bara hausinn og leiðbeiningarnar.
 *
 * Fyrirspurnir eru afritahreinsaðar áður en leitað er. Það er ekki
 * snyrtimennska: vara með tvö treff skrifar tvær raðir, báðar með sömu
 * fyrirspurn í A. Án hreinsunar læsi næsta keyrsla þær tvær og skilaði
 * fjórum. Taflan margfaldaðist við hverja keyrslu. Núna er hún föst.
 ************************************************************/
function pimLookupSkus_v1() {
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);
  let sh = ss.getSheetByName(PIM_LOOKUP_SHEET_);
  if (!sh) sh = ss.insertSheet(PIM_LOOKUP_SHEET_);

  const last = sh.getLastRow();
  const raw = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];

  // Afritahreinsun sem heldur röðinni sem var límd inn.
  const queries = [];
  const seenQ = {};
  raw.forEach(function (r) {
    const q = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
    if (!q) return;
    const k = q.toUpperCase();
    if (seenQ[k]) return;
    seenQ[k] = true;
    queries.push(q);
  });

  if (!queries.length) {
    pimWriteLookupSheet_(sh, []);
    const m = 'Uppfletting: engin fyrirspurn í A-kólumnu. Límdu númer í A2 og niður.';
    Logger.log('[PIM][UPPFLETTING] ' + m);
    toast_(m);
    return { queries: 0, hits: 0, misses: 0, loose: 0 };
  }

  const rows = pimLookupList_v1(queries);
  pimWriteLookupSheet_(sh, rows);

  const misses = rows.filter(function (r) { return r[1] === 'Nei'; }).length;
  const loose  = rows.filter(function (r) { return r[2] === 'Laust treff'; }).length;
  let msg = 'Uppfletting: ' + queries.length + ' fyrirspurnir → ' +
            (rows.length - misses) + ' treff, ' + misses + ' ófundin.';
  if (loose) msg += ' ' + loose + ' laus treff — lestu þau yfir.';
  Logger.log('[PIM][UPPFLETTING] ' + msg);
  toast_(msg);
  return { queries: queries.length, hits: rows.length - misses, misses: misses, loose: loose };
}


/************************************************************
 * 🔁 pimLookupList_v1 — sama uppfletting án sheets
 *   pimLookupList_v1(['7276', 'STO_114112'])
 * Skilar fylki af röðum í sömu kólumnuröð og PIM_LOOKUP_COLS_.
 * Hér inni liggur öll rökfræðin; sheet-fallið er umbúðir.
 ************************************************************/
function pimLookupList_v1(values) {
  const idx = pimBuildWebIndex_();
  const out = [];

  (values || []).forEach(function (v) {
    const q = String(v === null || v === undefined ? '' : v).trim();
    if (!q) return;

    const seen = {};
    let n = 0;
    const push = function (node, label) {
      if (!node || seen[node.sku]) return;
      seen[node.sku] = true;
      n++;
      out.push([
        q, 'Já', label, node.sku, node.brandSku, node.name, node.brand,
        node.slug ? ('https://www.storkaup.is/vara/' + node.slug) : ''
      ]);
    };

    // Röðin skiptir máli. Okkar eigið SKU er ótvírætt; birgjanúmer getur
    // rekist á. Finnist hvort tveggja fær notandinn báðar raðirnar og sker
    // úr sjálfur — fallið felur ekki treff til að líta afgerandi út.
    (idx.bySku[normStorkaupSku_(q)] || []).forEach(function (x) { push(x, 'Stórkaups-SKU'); });
    (idx.byBrand[normLookupKey_(q)] || []).forEach(function (x) { push(x, 'Birgjanúmer'); });

    // Lausa treffið er ÞRAUTALENDING, ekki viðbót. Það keyrir aðeins þegar
    // nákvæmu lyklarnir tveir skiluðu engu, svo það getur aldrei mengað röð
    // sem átti nákvæmt svar.
    if (!n) {
      (idx.byLoose[looseKey_(q)] || []).forEach(function (x) { push(x, 'Laust treff'); });
    }
    if (!n) {
      out.push([q, 'Nei', '', '', '', '', '', '']);
    }
  });

  return out;
}


/************************************************************
 * 🌐 pimBuildWebIndex_ — allur birti vörulistinn, þrír lyklar
 *   bySku    normalíserað Stórkaups-SKU  (STO_117268_STK → 117268)
 *   byBrand  normalíserað birgjanúmer
 *   byLoose  aðeins bókstafir og tölustafir
 * Hvert gildi er FYLKI — sjá athugasemdina um einkvæmni efst.
 ************************************************************/
function pimBuildWebIndex_() {
  const PAGE = 200;
  const query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug' +
    '      attributes { brand_sku BrandName } } }' +
    '  }' +
    '}';

  const bySku = {}, byBrand = {}, byLoose = {};
  let offset = 0, total = null, count = 0, withBrand = 0;

  const add = function (map, key, node) {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(node);
  };

  while (true) {
    const res = UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
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
      throw new Error('getProductsV2 ' + res.getResponseCode() + ': ' +
                      res.getContentText().slice(0, 300));
    }
    const data = JSON.parse(res.getContentText());
    if (data.errors) {
      throw new Error('getProductsV2 errors: ' + JSON.stringify(data.errors).slice(0, 300));
    }

    const conn = (data.data && data.data.getProductsV2) || {};
    total = conn.totalCount;
    const edges = conn.edges || [];

    edges.forEach(function (e) {
      const node = (e && e.node) || null;
      if (!node || !node.sku) return;
      const attrs = node.attributes || {};
      const brandSku = normBrandSku_(attrs.brand_sku);
      const rec = {
        sku: node.sku,
        name: node.name || '',
        slug: node.slug || '',
        brand: attrs.BrandName || '',
        brandSku: brandSku
      };
      count++;
      add(bySku, normStorkaupSku_(node.sku), rec);
      add(byLoose, looseKey_(node.sku), rec);
      if (brandSku) {
        withBrand++;
        add(byBrand, normLookupKey_(brandSku), rec);
        add(byLoose, looseKey_(brandSku), rec);
      }
    });

    offset += PAGE;
    if (!(conn.pageInfo && conn.pageInfo.hasNextPage)) break;
    if (offset > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
  }

  Logger.log('🌐 Uppfletting: ' + count + ' vörur af ' + total + ', ' +
             withBrand + ' með birgjanúmer.');
  return { bySku: bySku, byBrand: byBrand, byLoose: byLoose };
}


// ---------------------------------------------------------------------------
// Normalíserun
// ---------------------------------------------------------------------------

/**
 * brand_sku er `[String]` eða `null` — ALDREI strengur. Mælt á öllum
 * 4.473 vörum 2026-09-18: 4.408 fylki af lengd 1, 65 null.
 * Fyrsta gildið er tekið; komi lengra fylki einhvern tíma er restin
 * hunsuð vísvitandi frekar en að þau renni saman í "7276,7277".
 */
function normBrandSku_(v) {
  if (v === null || v === undefined) return '';
  const first = Array.isArray(v) ? (v.length ? v[0] : '') : v;
  return String(first === null || first === undefined ? '' : first).trim();
}

/**
 * Almennur samanburðarlykill: hástafir, bil felld saman, forleiðandi
 * núll af hreinum tölum. "007276" og "7276" eru sama númerið; "AC 1/2"
 * og "AC  1/2" líka.
 */
function normLookupKey_(v) {
  const s = String(v === null || v === undefined ? '' : v)
    .trim().replace(/\s+/g, ' ').toUpperCase();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

/**
 * Stórkaups-SKU á fjóra rithætti í kerfunum:
 *   STO_114112        STO_117268_STK        STO_9002572_KASSI      114112
 * Sölueiningarviðskeytið er ekki hluti af auðkenninu — sama vara, önnur
 * pökkun — svo það er skorið af. Án þess skilar `117268` engu þótt
 * `STO_117268_STK` sé til, sem er nákvæmlega uppflettingin sem fólk gerir.
 *
 * ATH: þetta er VÍSVITANDI ekki normSku_ úr buildPimWorksheet.js. Það fall
 * sker ekki viðskeytið (STO_117268_STK → 117268_STK) af því að þar er
 * matchað á Plytix/Cludo þar sem viðskeytið er ekki til. Hér er matchað á
 * GraphQL, þar sem 3.608 af 4.473 SKU-um BERA viðskeyti. Að sameina föllin
 * myndi brjóta annað hvort.
 */
function normStorkaupSku_(v) {
  let s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (!s) return '';
  s = s.replace(/^STO[_\-\s]+/, '');
  s = s.replace(/[_\-](STK|KASSI|BRETTI|PK|PAKKI)$/, '');
  return normLookupKey_(s);
}

/** Aðeins bókstafir og tölustafir. Notað eingöngu í lausa treffið. */
function looseKey_(v) {
  return normLookupKey_(v).replace(/[^A-Z0-9ÁÉÍÓÚÝÐÞÆÖ]/g, '');
}


// ---------------------------------------------------------------------------
// Flipinn
// ---------------------------------------------------------------------------
function pimWriteLookupSheet_(sh, rows) {
  sh.clear();
  const nCols = PIM_LOOKUP_COLS_.length;

  sh.getRange(1, 1, 1, nCols)
    .setValues([PIM_LOOKUP_COLS_.map(function (c) { return c.head; })])
    .setBackground('#10069f').setFontColor('#ffffff').setFontWeight('bold').setFontFamily('Arial');

  if (rows.length) {
    sh.getRange(2, 1, rows.length, nCols).setValues(rows)
      .setFontFamily('Arial').setFontSize(10);

    // Ófundin og laus treff eru lituð. Taflan er lesin með augunum og
    // 200 raðir af „Já" fela þrjú „Nei" fullkomlega ef ekkert greinir þau.
    const flags = sh.getRange(2, 1, rows.length, nCols);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$B2="Nei"')
        .setBackground('#fce8e6').setRanges([flags]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$C2="Laust treff"')
        .setBackground('#fff3c4').setRanges([flags]).build()
    ]);
  } else {
    sh.setConditionalFormatRules([]);
  }

  PIM_LOOKUP_COLS_.forEach(function (c, i) { sh.setColumnWidth(i + 1, c.w); });
  sh.setFrozenRows(1);

  sh.getRange(rows.length + 3, 1).setValue(
    'Límdu birgjanúmer EÐA Stórkaups-SKU í A-kólumnu (frá A2 og niður) og keyrðu ' +
    'pimLookupSkus_v1. Blandaður listi er í lagi. Taflan er endurskrifuð í heild ' +
    'við hverja keyrslu og fyrirspurnir afritahreinsaðar. — Kólumna C segir hvað ' +
    'passaði: „Stórkaups-SKU" og „Birgjanúmer" eru nákvæm treff, „Laust treff" ' +
    '(gult) hunsar bandstrik og bil og er TILLAGA sem á að lesa yfir. Birgjanúmer ' +
    'eru ekki einkvæm — 41 þeirra á fleiri en eina vöru — svo ein fyrirspurn ' +
    'getur skilað mörgum röðum. Vörumerkið sker úr. Rautt = fannst ekki á vefnum; ' +
    'brand_sku er fyllt á 98,5% vara í birtingu, svo það er raunveruleg fjarvist.'
  ).setFontFamily('Arial').setFontStyle('italic').setFontColor('#5c5c63');
}

// Utgafumerki: 2026-09-18, fyrsta utgafa.

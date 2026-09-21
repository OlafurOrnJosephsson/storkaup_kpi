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
 * Gögnin og normalíserunin eru í core/web_catalog.js — þessi skrá er
 * viðmótið eitt. Sá haus útskýrir hvaðan `brand_sku` kemur og hvers
 * vegna `sku` og `web_sku` eru ekki sami hluturinn.
 *
 * ── AF HVERJU EKKI HLUTSTRENGSLEIT ──────────────────────────────────
 * Prófað á raunlista 2026-09-18. `contains` á 6054 skilaði Pepsi
 * (26054), servíettum (95263) og skammtara (16054001) — þrjú svör, öll
 * röng, ekkert þeirra auðþekkt sem rangt við yfirlestur. Sá sem treystir
 * slíkri töflu skrifar vitleysu inn í tengdar vörur. Leyfð eru tvö stig:
 *   nákvæmt  — eftir hreinsun á bilum, hástöfum og forleiðandi núllum
 *   laust    — aðeins bókstafir og tölustafir eftir ("AC 070/23CS"
 *              finnst þótt slegið sé inn "ac-070-23cs")
 * Laust treff er merkt sem slíkt í kólumnu C og keyrir aðeins þegar
 * nákvæmu lyklarnir skiluðu engu. Það er tillaga, ekki svar.
 *
 * ── EITT NÚMER GETUR ÁTT MARGAR VÖRUR ───────────────────────────────
 * 41 birgjanúmer af 4.360 eiga fleiri en eina vöru eftir normalíserun
 * (mælt 2026-09-18). Stutt númer frá ólíkum birgjum rekast á: "6135" er
 * bæði KC-ilmur og handþurrka frá Abena, og "1" — með "01" og "001" —
 * á sex matvörur. Okkar eigið SKU rekst á í nákvæmlega einu tilviki:
 * STO_9004599_STK og STO_9004599_KASSI, sama Brúsapumpan í tveimur
 * sölueiningum. Fallið skilar ÖLLUM treffum, hverju á sinni röð, með
 * vörumerkinu. Vörumerkið er ekki skraut í töflunni heldur það sem
 * sker úr.
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
    pimWriteLookupSheet_(sh, [], null);
    const m = 'Uppfletting: engin fyrirspurn í A-kólumnu. Límdu númer í A2 og niður.';
    Logger.log('[PIM][UPPFLETTING] ' + m);
    toast_(m);
    return { queries: 0, hits: 0, misses: 0, loose: 0 };
  }

  const idx  = loadWebCatalogIndex_();
  const rows = pimLookupList_v1(queries, idx);
  pimWriteLookupSheet_(sh, rows, idx);

  const misses = rows.filter(function (r) { return r[1] === 'Nei'; }).length;
  const loose  = rows.filter(function (r) { return r[2] === 'Laust treff'; }).length;
  let msg = 'Uppfletting: ' + queries.length + ' fyrirspurnir → ' +
            (rows.length - misses) + ' treff, ' + misses + ' ófundin.';
  if (loose) msg += ' ' + loose + ' laus treff — lestu þau yfir.';
  if (idx.source === 'graphql') {
    msg += ' ⚠️ Las beint af vefnum — raw.web_catalog svaraði ekki.';
  }
  Logger.log('[PIM][UPPFLETTING] ' + msg);
  toast_(msg);
  return { queries: queries.length, hits: rows.length - misses, misses: misses, loose: loose };
}


/************************************************************
 * 🔁 pimLookupList_v1 — sama uppfletting án sheets
 *   pimLookupList_v1(['7276', 'STO_114112'])
 * Skilar fylki af röðum í sömu kólumnuröð og PIM_LOOKUP_COLS_.
 *
 * `idx` má gefa með ef kallandinn er þegar búinn að hlaða vísinum —
 * pimLookupSkus_v1 gerir það til að geta birt `syncedAt`. Sé hann ekki
 * gefinn er hann sóttur úr raw.web_catalog (loadWebCatalogIndex_), sem
 * fellur sjálfkrafa í GraphQL sé taflan tóm.
 ************************************************************/
function pimLookupList_v1(values, idx) {
  idx = idx || loadWebCatalogIndex_();
  const out = [];

  (values || []).forEach(function (v) {
    const q = String(v === null || v === undefined ? '' : v).trim();
    if (!q) return;

    const seen = {};
    let n = 0;
    const push = function (rec, label) {
      if (!rec || seen[rec.sku]) return;
      seen[rec.sku] = true;
      n++;
      out.push([
        q, 'Já', label, rec.sku, rec.brandSku, rec.name, rec.brand,
        rec.slug ? ('https://www.storkaup.is/vara/' + rec.slug) : ''
      ]);
    };

    // Röðin skiptir máli. Okkar eigið SKU er ótvírætt; birgjanúmer getur
    // rekist á. Finnist hvort tveggja fær notandinn báðar raðirnar og sker
    // úr sjálfur — fallið felur ekki treff til að líta afgerandi út.
    (idx.bySku[normLookupKey_(normStorkaupSku_(q))] || []).forEach(function (x) { push(x, 'Stórkaups-SKU'); });
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


// ---------------------------------------------------------------------------
// Flipinn
// ---------------------------------------------------------------------------
function pimWriteLookupSheet_(sh, rows, idx) {
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

  // FERSKLEIKINN Á AÐ SJÁST. Uppflettingin les raw.web_catalog, sem er
  // endurnýjuð á 12 tíma fresti — ekki vefinn sjálfan þessa stundina.
  // Sá munur skiptir máli fyrir vöru sem var sett inn í morgun, og
  // notandinn á ekki að þurfa að lesa kóðann til að vita af honum.
  let uppruni = '';
  if (idx && idx.source === 'supabase') {
    uppruni = 'Gögn úr raw.web_catalog, samstillt ' +
              String(idx.syncedAt || '').replace('T', ' ').slice(0, 16) +
              ' (endurnýjast á 12 klst. fresti). Vara sem fór á vefinn eftir þann tíma ' +
              'finnst ekki fyrr en næsta samstilling hefur keyrt — ' +
              'syncWebCatalogToSupabase_v1 keyrir hana strax. ';
  } else if (idx && idx.source === 'graphql') {
    uppruni = '⚠️ Lesið BEINT af vefnum: raw.web_catalog var tóm eða svaraði ekki. ' +
              'Svarið er ferskt en tók ~30 sek. Keyrðu syncWebCatalogToSupabase_v1. ';
  }

  sh.getRange(rows.length + 3, 1).setValue(
    uppruni +
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

// Utgafumerki: 2026-09-18, gogn faerd i core/web_catalog.js.

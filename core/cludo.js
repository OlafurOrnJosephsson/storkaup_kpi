/************************************************************
 * ✅ Cludo Search API Integration (STÓRKAUP KPI CORE v6)
 * ----------------------------------------------------------
 * - Notar loadConfig_() + STORKAUP_SCHEMA + utils
 * - PRODUCTS = master catalog úr Cludo
 * - PRODUCTS_MISSING = SKUs sem Cludo finnur ekki / óklárar
 * - Zero leading-zero loss (SKU alltaf TEXT)
 ************************************************************/


/************************************************************
 * 🔧 Cludo env úr CONFIG
 ************************************************************/
function getCludoEnv_() {
  const cfg = loadConfig_();

  const searchUrl = cfg.ENDPOINTS.Cludo.SEARCH;
  const siteKey    = cfg.API.Cludo.SITE_KEY;
  const customerId = cfg.API.Cludo.CUSTOMER_ID;
  const engineId   = cfg.API.Cludo.ENGINE_ID;

  if (!searchUrl || !siteKey || !customerId || !engineId) {
    throw new Error(
      'CONFIG ERROR — vantar Cludo stillingar. Athugaðu STORKAUP_CONFIG → API & ENDPOINTS.\n' +
      JSON.stringify(cfg.API.Cludo || {}, null, 2) + '\n' +
      JSON.stringify(cfg.ENDPOINTS.Cludo || {}, null, 2)
    );
  }

  return {
    SEARCH_URL: searchUrl,
    SITE_KEY: siteKey,
    CUSTOMER_ID: customerId,
    ENGINE_ID: engineId
  };
}


/************************************************************
 * 🔢 Safna ÖLLUM SKU sem PRODUCTS á að þekkja
 *
 * FJÓRAR uppsprettur. Þrjár fyrstu eru söluskrár; sú fjórða er birti
 * vörulistinn og var VIÐBÓT 2026-09-09.
 *
 * Hvers vegna: fram að því voru aðeins söluskrárnar hér, svo vara sem hefur
 * ALDREI VERIÐ KEYPT komst aldrei í PRODUCTS. Þetta er kallað "master
 * catalog úr Cludo" í hausnum á skránni, en það var í raun "katalógur yfir
 * það sem hefur selst". Það voru 605 vörur af 4.477 birtum (13,5%) sem
 * vantaði, og þær komu fram í PIM-vinnusheetinu sem "Ekki í leitarvísi" og
 * fylltu EKKI_A_VEF-flipann þótt þrjár efstu fyndust allar á vefnum við
 * handvirka prófun.
 *
 * getProductsV2 er opinber og krefst engra lykla. Bili hann heldur
 * söfnunin áfram með söluskránum þrem — PRODUCTS verður þá ófullkominn eins
 * og áður, en ekki tómur.
 *
 * Skilar unique, normalized SKU-fylki.
 ************************************************************/
function collectAllSkusFromSystems_() {
  const skus = [];

  // --- 1) NEWWEB SKUs ---
  let newweb = loadTableBySchema_('NEWWEB');
  if (Array.isArray(newweb)) {
    newweb.forEach(r => {
      const sku = normalizeSkuGlobal_(r.SKU);
      if (sku) skus.push(sku);
    });
  } else {
    Logger.log("⚠️ NEWWEB not array in collector");
  }

  // --- 2) OLDWEB SKUs ---
  let oldweb = loadTableBySchema_('OLDWEB');
  if (Array.isArray(oldweb)) {
    oldweb.forEach(r => {
      const raw = r.SKU_LIST;
      if (!raw) return;

      splitSkuList_(raw).forEach(s => {
        if (s) skus.push(s);
      });
    });
  } else {
    Logger.log("⚠️ OLDWEB not array in collector");
  }

  // --- 3) BC_LINES SKUs ---
  // NB: Ef schema key heitir BC_INVOICE_LINES → notum það
  let bc = loadTableBySchema_('BC_LINES');
  if (Array.isArray(bc)) {
    bc.forEach(r => {
      const sku = normalizeSkuGlobal_(r.SKU);
      if (sku) skus.push(sku);
    });
  } else {
    Logger.log("⚠️ BC_LINES not array in collector");
  }

  // --- 4) BIRTI VÖRULISTINN (storkaup.is GraphQL, opinber) ---
  // Sér-try: bili þetta á söfnunin ekki að stöðvast. Sjá hausinn.
  try {
    const active = fetchActiveProducts_();
    let added = 0;
    active.forEach(a => {
      const sku = normalizeSkuGlobal_(a && a.parent);
      if (sku) { skus.push(sku); added++; }
    });
    Logger.log(`🌐 collector: +${added} SKU úr birta vörulistanum`);
  } catch (e) {
    Logger.log(`⚠️ collector: náði ekki í birta vörulistann — PRODUCTS verður `
      + `ófullkominn fyrir vörur sem hafa ekki selst: ${e.message}`);
  }

  // --- 5) CLEANUP ---
  const clean = skus
    .map(s => normalizeSkuGlobal_(s))
    .filter(s => s && s.length >= 3 && /^\d+$/.test(s));

  const uniq = [...new Set(clean)];
  uniq.sort();

  Logger.log(`✔ collector returns ARRAY of ${uniq.length} SKUs`);

  return uniq;
}

/************************************************************
 * 🧹 removeDuplicateSkusFromCludo — CONFIG v5
 * - Notar CONFIG.SHEETS.PRODUCTS
 * - Leading-zero safe
 * - Writes back sorted, deduped list
 ************************************************************/
function removeDuplicateSkusFromCludo() {

  const cfg = loadConfig_();
  const ssId = cfg.SHEETS.PRODUCTS.ID;
  const sheetName = cfg.SHEETS.PRODUCTS.NAME;

  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheetByName(sheetName);

  if (!sh) throw new Error(`❌ PRODUCTS sheet not found: ${sheetName}`);

  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return;

  const header = vals[0];
  const iSKU = header.indexOf('SKU');
  if (iSKU < 0) throw new Error("❌ 'SKU' column not found in PRODUCTS");

  const seen = new Set();
  const out = [header];

  for (let r = 1; r < vals.length; r++) {
    const raw = vals[r][iSKU];
    const sku = normalizeSkuGlobal_(raw);
    if (!sku) continue;
    if (seen.has(sku)) continue;
    seen.add(sku);
    out.push(vals[r]);
  }

  sh.clearContents();

  sh.getRange(1, iSKU + 1, out.length, 1).setNumberFormat("@");
  sh.getRange(1, 1, out.length, header.length).setValues(out);
  sh.sort(1);

  Logger.log(`✅ PRODUCTS dedup complete — ${out.length - 1} unique SKUs remain.`);
}


/************************************************************
 * 🔍 Fetch single SKU from Cludo API (CONFIG-based)
 ************************************************************/
function fetchCludoResult_(sku, env) {
  const e = env || getCludoEnv_();
  const url = e.SEARCH_URL;
  const siteKey = e.SITE_KEY;

  const payload = {
    query: sku,
    take: 1,
    skip: 0,
    searchType: "phrase",
    filters: { StorkaupSKU: [sku] }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `SiteKey ${siteKey}`,
      Accept: "application/json"
    },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log(`⚠️ ${sku} → HTTP ${code} – ${res.getContentText()}`);
      return null;
    }

    const data = JSON.parse(res.getContentText());
    if (!data.TypedDocuments || !data.TypedDocuments.length) return null;

    const doc = data.TypedDocuments[0];
    const fields = doc.Fields || {};
    const urlField = (fields.Url && fields.Url.Value) || "";

    const title =
      (fields.Title && fields.Title.Value) ||
      (fields.Name && fields.Name.Value) ||
      (fields.Description && fields.Description.Value) || "";

    let level1 = "", level2 = "", level3 = "";
    let categoryPath = "";

    // Reynum að lesa breadcrumbs af vefnum – fallback á Category
    if (urlField) {
      try {
        const htmlRes = UrlFetchApp.fetch(urlField, { muteHttpExceptions: true });
        const htmlCode = htmlRes.getResponseCode();
        if (htmlCode === 200) {
          const html = htmlRes.getContentText();
          const matches = [...html.matchAll(/<a[^>]+href="\/flokkur\/[^"]+"[^>]*>(.*?)<\/a>/g)];
          const crumbs = matches.map(m => m[1].replace(/<[^>]+>/g, "").trim());

          if (crumbs.length) {
            categoryPath = crumbs.join(" / ");
            level1 = crumbs[0] || "";
            level2 = crumbs[1] || "";
            level3 = crumbs[2] || "";
          }
        } else {
          Logger.log(`⚠️ Breadcrumb fetch for ${sku} got HTTP ${htmlCode}`);
        }
      } catch (e2) {
        Logger.log(`⚠️ Breadcrumb fetch failed for ${sku}: ${e2.message}`);
      }
    }

    if (!categoryPath) {
      categoryPath = (fields.Category && fields.Category.Value) || "";
    }

    return { sku, title, url: urlField, categoryPath, level1, level2, level3 };

  } catch (err) {
    Logger.log(`❌ Error fetching ${sku}: ${err.message}`);
    return null;
  }
}

/****************************************************
 * 📄 writeMissingSkus_()
 * Skrifar SKUs sem ekki fundust í Cludo → í sérstakan flipa
 ****************************************************/
function writeMissingSkus_(missingList) {
  if (!missingList || !missingList.length) {
    Logger.log("✨ No missing SKUs — sheet not updated");
    return;
  }

  const cfg = loadConfig_();
  const ssId = cfg.SHEETS.PRODUCTS.ID;
  const ss   = SpreadsheetApp.openById(ssId);

  const sheetName = "MISSING_SKUS";

  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  }

  // HEADER
  const HEADER = ["SKU", "Source", "Timestamp"];

  const vals = sh.getDataRange().getValues();
  if (vals.length < 1 || vals[0][0] !== "SKU") {
    sh.clearContents();
    sh.appendRow(HEADER);
  }

  // Prepare rows
  const rows = missingList.map(item => [
    item.sku,
    item.source,
    new Date()
  ]);

  // Overwrite content
  sh.getRange(2, 1, rows.length, 3).setValues(rows);

  sh.sort(1);
  sh.getRange("A:A").setNumberFormat("@");

  Logger.log(`⚠️ Missing SKUs written → ${rows.length} items`);
}

/****************************************************
 * ⚙️ updateFromSalesCludo_Batched — CONFIG v6 (SAFE)
 *  - Safnar SKUs úr NEWWEB + OLDWEB + BC_LINES
 *  - Uppfærir PRODUCTS skjalið með Cludo info
 *  - Tryggir header, text-format, sort og batch-processing
 ****************************************************/
function countIncompleteProducts_() {
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);
  const sh = ss.getSheetByName(cfg.SHEETS.PRODUCTS.NAME);
  if (!sh || sh.getLastRow() < 2) return 0;

  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(String);
  const iL1   = h.indexOf('Level 1');
  const iPATH = h.indexOf('Category Path');
  if (iL1 < 0 && iPATH < 0) return vals.length - 1;

  var incomplete = 0;
  for (var r = 1; r < vals.length; r++) {
    const path = iPATH >= 0 ? String(vals[r][iPATH] || '').trim() : '';
    const l1   = iL1   >= 0 ? String(vals[r][iL1]   || '').trim() : '';
    const bad  = !path || path === 'Vörur' || path === '/vara' ||
                 !l1   || l1   === 'Vörur' || l1   === '(Uncategorized)';
    if (bad) incomplete++;
  }
  return incomplete;
}

function updateFromSalesCludo_Batched() {
  const missing = [];   // geymir SKUs sem ekki finnast

  const env   = getCludoEnv_();
  const cfg   = loadConfig_();
  const props = PropertiesService.getScriptProperties();

  // ----------------------------------------------------
  // 1) Tengjast rétta PRODUCTS skjalinu samkvæmt CONFIG
  // ----------------------------------------------------
  const ssId        = cfg.SHEETS.PRODUCTS.ID;
  const sheetName   = cfg.SHEETS.PRODUCTS.NAME;
  const ssProd      = SpreadsheetApp.openById(ssId);

  let dest = ssProd.getSheetByName(sheetName);
  if (!dest) {
    dest = ssProd.insertSheet(sheetName);
  }

  // ----------------------------------------------------
  // 2) Tryggja að header sé til staðar (örugg útgáfa)
  // ----------------------------------------------------
  const HEADER = [
    'SKU', 'Product Name', 'Product URL', 'Category Path',
    'Level 1', 'Level 2', 'Level 3', 'Timestamp'
  ];

  function ensureHeader_() {
    const vals = dest.getDataRange().getValues();

    // Sheet tómur:
    if (vals.length === 0 || vals[0].length === 0) {
      dest.clearContents();
      dest.appendRow(HEADER);
      return;
    }

    // Ef fyrsta röðin er tóm eða ekki header:
    const first = vals[0].map(String);
    if (first.length < HEADER.length || first[0] !== 'SKU') {
      dest.clearContents();
      dest.appendRow(HEADER);
    }
  }

  ensureHeader_();

  // ----------------------------------------------------
  // 3) Sækjum eksisting values Eftir að header tryggður
  // ----------------------------------------------------
  let destVals = dest.getDataRange().getValues();
  const headers = destVals[0].map(String);

  const iSKU  = headers.indexOf('SKU');
  const iNAME = headers.indexOf('Product Name');
  const iPATH = headers.indexOf('Category Path');
  const iL1   = headers.indexOf('Level 1');

  // Text-format á SKU
  if (iSKU >= 0) {
    dest.getRange(1, iSKU + 1, dest.getMaxRows(), 1).setNumberFormat("@");
  }

  // ----------------------------------------------------
  // 4) Byggja map af eksisterandi línum
  // ----------------------------------------------------
  const existing = {};
  for (let r = 1; r < destVals.length; r++) {
    const rawSku = destVals[r][iSKU];
    const sku = normalizeSkuGlobal_(rawSku);
    if (!sku) continue;

    existing[sku] = {
      row: r + 1,
      name: destVals[r][iNAME],
      path: destVals[r][iPATH],
      l1:   destVals[r][iL1]
    };
  }

  // ----------------------------------------------------
  // 5) Sækjum alla SKUs úr öllum kerfum
  // ----------------------------------------------------
  const uniqueSKUs = collectAllSkusFromSystems_();
  Logger.log(`🔢 Collector returned ${uniqueSKUs.length} unique SKUs.`);

  // ----------------------------------------------------
  // 6) Batch-loop
  // ----------------------------------------------------
  const MAX_API_CALLS = 50;
  let apiCalls = 0;
  let processed = 0;
  let index = Number(props.getProperty('CLUDO_LAST_INDEX') || 0);

  Logger.log(`▶ Starting Cludo batch from index ${index}/${uniqueSKUs.length}`);

  while (index < uniqueSKUs.length && apiCalls < MAX_API_CALLS) {

    const sku = normalizeSkuGlobal_(uniqueSKUs[index]);
    index++;

    const er = existing[sku];
    const needsUpdate =
      !er ||
      !er.path ||
      er.path === 'Vörur' ||
      er.path === '/vara' ||
      !er.l1 ||
      er.l1 === 'Vörur' ||
      er.l1 === '(Uncategorized)';

    if (!needsUpdate) continue;

    const result = fetchCludoResult_(sku, env);
    apiCalls++;

    if (!result) {
      missing.push({ sku, source: "Cludo API - No Result" });
      continue;
    }


    const { title, url, categoryPath, level1, level2, level3 } = result;

    if (er) {
      // Update existing row
      dest.getRange(er.row, 2, 1, 7).setValues([[
        title, url, categoryPath, level1, level2, level3, new Date()
      ]]);
      Logger.log(`🔄 Updated ${sku}`);
    } else {
      // Insert new row
      const newRow = dest.getLastRow() + 1;
      dest.getRange(newRow, 1).setNumberFormat("@");
      dest.getRange(newRow, 1, 1, 8).setValues([[
        sku, title, url, categoryPath, level1, level2, level3, new Date()
      ]]);
      Logger.log(`➕ Added ${sku}`);
    }

    processed++;
    Utilities.sleep(800);
  }

  // ----------------------------------------------------
  // 7) Sort + Save index
  // ----------------------------------------------------
  dest.sort(1);
  props.setProperty('CLUDO_LAST_INDEX', index < uniqueSKUs.length ? index : 0);

  Logger.log(`✅ Batch complete — processed ${processed} SKUs.`);
  // 🔥 Write missing SKUs to SPECIAL SHEET
  writeMissingSkus_(missing);

}


/************************************************************
 * 🔁 syncCludoToSalesSheets — CONFIG v5
 * - Uppfærir Sales — Top Products flipana út frá PRODUCTS
 ************************************************************/
function syncCludoToSalesSheets() {

  const cfg = loadConfig_();

  // 1) Load PRODUCTS
  const prodSs = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);
  const prodSh = prodSs.getSheetByName(cfg.SHEETS.PRODUCTS.NAME);
  if (!prodSh) throw new Error("❌ PRODUCTS sheet not found");

  const pVals = prodSh.getDataRange().getValues();
  if (pVals.length < 2) return;

  const pHead = pVals[0].map(String);

  const iSKU     = pHead.indexOf('SKU');
  const iNAME    = pHead.indexOf('Product Name');
  const iURL     = pHead.indexOf('Product URL');
  const iCATPATH = pHead.indexOf('Category Path');
  const iL1      = pHead.indexOf('Level 1');
  const iL2      = pHead.indexOf('Level 2');
  const iL3      = pHead.indexOf('Level 3');

  const PRODUCT_MAP = {};

  for (let r = 1; r < pVals.length; r++) {
    const sku = normalizeSkuGlobal_(pVals[r][iSKU]);
    if (!sku) continue;

    PRODUCT_MAP[sku] = {
      name:   pVals[r][iNAME]    || "",
      url:    pVals[r][iURL]     || "",
      catPath:pVals[r][iCATPATH] || "",
      L1:     pVals[r][iL1]      || "",
      L2:     pVals[r][iL2]      || "",
      L3:     pVals[r][iL3]      || ""
    };
  }

  Logger.log(`📦 Loaded ${Object.keys(PRODUCT_MAP).length} products from PRODUCTS`);

  // 2) SALES_SUMMARIES workbook
  const salesSs = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);

  const targetSheets = [
    'Sales — Top Products (7d)',
    'Sales — Top Products (30d)',
    'Sales — Top Products (90d)',
    'Sales — Top Products (All Time)'
  ];

  let updated = 0;

  targetSheets.forEach(name => {
    const sh = salesSs.getSheetByName(name);
    if (!sh) return;

    const vals = sh.getDataRange().getValues();
    if (vals.length < 2) return;

    const h = vals[0].map(String);

    const iSKU  = h.findIndex(c => /sku/i.test(c));
    const iNAME = h.findIndex(c => /product\s*name/i.test(c));
    const iL1   = h.findIndex(c => c === 'Category (L1)' || c === 'Level 1');
    const iL2   = h.findIndex(c => c === 'Category (L2)' || c === 'Level 2');
    const iL3   = h.findIndex(c => c === 'Category (L3)' || c === 'Level 3');
    const iPATH = h.findIndex(c => c === 'Category Path');

    if (iSKU < 0) {
      Logger.log(`⚠️ No SKU column in ${name}`);
      return;
    }

    sh.getRange(1, iSKU + 1, sh.getMaxRows(), 1).setNumberFormat("@");

    for (let r = 1; r < vals.length; r++) {
      const raw = vals[r][iSKU];
      const sku = normalizeSkuGlobal_(raw);
      if (!sku || !PRODUCT_MAP[sku]) continue;

      const prod = PRODUCT_MAP[sku];
      let changed = false;

      if (raw !== sku) {
        vals[r][iSKU] = sku;
        changed = true;
      }

      if (iNAME >= 0 && vals[r][iNAME] !== prod.name) {
        vals[r][iNAME] = prod.name;
        changed = true;
      }
      if (iL1 >= 0 && vals[r][iL1] !== prod.L1) {
        vals[r][iL1] = prod.L1;
        changed = true;
      }
      if (iL2 >= 0 && vals[r][iL2] !== prod.L2) {
        vals[r][iL2] = prod.L2;
        changed = true;
      }
      if (iL3 >= 0 && vals[r][iL3] !== prod.L3) {
        vals[r][iL3] = prod.L3;
        changed = true;
      }
      if (iPATH >= 0 && vals[r][iPATH] !== prod.catPath) {
        vals[r][iPATH] = prod.catPath;
        changed = true;
      }

      if (changed) updated++;
    }

    sh.getRange(1, 1, vals.length, h.length).setValues(vals);
    Logger.log(`🔄 Synced → ${name}`);
  });

  Logger.log(`🎉 syncCludoToSalesSheets DONE — ${updated} rows updated`);
}


/************************************************************
 * 🔁 ONE-CLICK FULL SYNC
 ************************************************************/
function runCludoFullSync() {
  const incomplete = countIncompleteProducts_();
  Logger.log('🔍 Cludo sync — incomplete products: ' + incomplete);

  if (incomplete === 0) {
    Logger.log('⏭ Cludo sync skipped — all products complete.');
    return { skipped: true, reason: 'all_products_complete' };
  }

  Logger.log('🚀 Step 1/3 — updateFromSalesCludo_Batched()');
  updateFromSalesCludo_Batched();

  Logger.log('🚀 Step 2/3 — removeDuplicateSkusFromCludo()');
  removeDuplicateSkusFromCludo();

  Logger.log('🚀 Step 3/3 — syncCludoToSalesSheets()');
  syncCludoToSalesSheets();

  Logger.log('✅ Cludo full sync complete!');
  return { skipped: false, incomplete: incomplete };
}


/************************************************************
 * 🧹 CLUDO INDEX CLEANUP — foreldralausar /vara/ slóðir
 *
 * Vandinn (mælt 2026-09-16): storkaup.is skilar HTTP 200 fyrir hvaða
 * slug sem er undir /vara/ — routerinn les bara vörunúmerið aftast og
 * hunsar textann á undan. Hver síða canonical-ar á sjálfa sig, svo
 * ekkert segir skriðli hver rétta slóðin er.
 *
 * 703 vörur eiga HREINA SKU-slóð í sitemap og hafa að auki lifandi
 * afbrigðisslóðir (<slóð>kassi, <slóð>stk). Cludo hefur skriðið þær og
 * geymir þær sem sjálfstæð skjöl — Page Inventory sýndi 5.858 /vara/
 * skjöl á móti 4.477 raunverulegum vörum.
 *
 * Útilokunarregla í Cludo (URL regex) stöðvar FRAMTÍÐARSKRIÐ en eyðir
 * ekki skjölunum sem eru þegar inni. Test search á 104886 skilaði enn
 * tveim niðurstöðum eftir skrið, og afritið raðaðist HÆRRA (19.00 á
 * móti 6.72). Einingarafritunum (709) var eytt 2026-09-16 með falli sem
 * reiknaði þau úr sitemap-inu; það og greiningarföllin sem fundu
 * eyðingarleiðina voru fjarlægð 2026-10-14 — sjá git-sögu. Hreinsunin
 * sem gildir núna er cludoHreinsaVaraDocs_v1 hér að neðan, og hún nær
 * einingarafritum líka (cludoUrlSku_ les vörunúmerið óháð endingu).
 *
 * Rétta lagfæringin er á vefnum (301 á kanóníska slóð + alvöru 404).
 * Þetta er þrif á afleiðingunni, ekki orsökinni.
 ************************************************************/

var STORKAUP_SITEMAP_URL_ = 'https://www.storkaup.is/sitemap.xml';


/************************************************************
 * 🔑 getCludoAdminEnv_ — Basic auth, EKKI SiteKey
 *
 * Index Management API-ið tekur ekki við SiteKey. Basic auth er
 * CUSTOMER_ID sem notandanafn og API_KEY sem lykilorð.
 *
 * CRAWLER_ID er EKKI í STORKAUP_CONFIG í dag — bættu við röð í API
 * flipann: Cludo | CRAWLER_ID | <id>. Hann fæst í MyCludo undir
 * Configuration -> Crawlers (talan í slóð vafrans þegar crawler er opnaður).
 ************************************************************/
function getCludoAdminEnv_() {
  const cfg = loadConfig_();
  const c = cfg.API.Cludo || {};

  const customerId = String(c.CUSTOMER_ID || '').trim();
  const apiKey     = String(c.API_KEY || '').trim();
  const crawlerId  = String(c.CRAWLER_ID || '').trim();

  const missing = [];
  if (!customerId) missing.push('API.Cludo.CUSTOMER_ID');
  if (!apiKey)     missing.push('API.Cludo.API_KEY');
  if (!crawlerId)  missing.push('API.Cludo.CRAWLER_ID');
  if (missing.length) {
    throw new Error(
      'CONFIG ERROR — vantar Cludo admin stillingar: ' + missing.join(', ') +
      '\nBættu við röð í STORKAUP_CONFIG -> API flipann (Service | Key | Value).'
    );
  }

  // HOST er í config (API.Cludo.HOST) og er skráð sem SKYLDUREITUR í
  // core/config.js — það er svæðisendapunkturinn ykkar, api-eu1. Ekki
  // leiða hann út frá customer ID: skjölin nefna api.cludo.com fyrir EU
  // en reikningurinn okkar situr á api-eu1, svo ágiskun væri röng.
  const host = String(c.HOST || '').trim().replace(/\/+$/, '')
    || ((Number(customerId) >= 10000000) ? 'https://api-us1.cludo.com' : 'https://api.cludo.com');

  return {
    CUSTOMER_ID: customerId,
    CRAWLER_ID: crawlerId,
    BASE: host + '/api/v4/' + customerId + '/index/' + crawlerId,
    AUTH: 'Basic ' + Utilities.base64Encode(customerId + ':' + apiKey)
  };
}


/************************************************************
 * 🗺️ fetchStorkaupSitemapUrls_ — allar KANÓNÍSKAR /vara/ slóðir
 *
 * sitemap.xml er sitemap-index; vöruslóðirnar liggja í níu undirskrám
 * (/sitemaps/products/1..9). Skilar einni slóð á vöru — nákvæmlega
 * þeim lista sem MÁ vera í vísinum.
 ************************************************************/
function fetchStorkaupSitemapUrls_() {
  function locs_(xml) {
    return (xml.match(/<loc>[^<]+<\/loc>/g) || [])
      .map(function (s) { return s.replace(/<\/?loc>/g, '').trim(); });
  }

  const idxRes = UrlFetchApp.fetch(STORKAUP_SITEMAP_URL_, { muteHttpExceptions: true });
  if (idxRes.getResponseCode() !== 200) {
    throw new Error('sitemap.xml -> HTTP ' + idxRes.getResponseCode());
  }

  const children = locs_(idxRes.getContentText());
  const out = [];

  children.forEach(function (child) {
    const res = UrlFetchApp.fetch(child, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log('⚠️ sitemap ' + child + ' -> HTTP ' + res.getResponseCode() + ' (sleppt)');
      return;
    }
    locs_(res.getContentText()).forEach(function (u) {
      if (u.indexOf('/vara/') !== -1) out.push(u);
    });
  });

  const uniq = [...new Set(out)];
  Logger.log('🗺️ sitemap: ' + uniq.length + ' kanónískar /vara/ slóðir');
  return uniq;
}


/************************************************************
 * 🗑️ cludoBulkDeleteUrls_ — POST .../documents/bulk-delete
 *
 * Síar á Url með Eq og mörgum gildum (Cludo hefur engan In-virkja;
 * Eq með fylki hegðar sér eins). Sent í 50-slóða lotum — engin
 * skjalfest efri mörk á values, svo þetta er varfærni, ekki regla.
 *
 * Slóð sem er ekki í vísinum telst einfaldlega ekki með í `deleted`.
 ************************************************************/
function cludoBulkDeleteUrls_(urls, env) {
  const e = env || getCludoAdminEnv_();

  // Cludo-reikningurinn (customer 3342) er SAMEIGINLEGUR með Hagkaup.
  // Endapunkturinn er crawler-bundinn (/index/{crawlerId}), svo rangur
  // CRAWLER_ID væri eina leiðin til að snerta annan vef — og þá myndi
  // þessi sía stöðva það: ekkert í öðrum vísi ber storkaup.is slóð.
  // Belti og axlabönd, því lykillinn verður ekki endurnýjaður.
  const foreign = urls.filter(function (u) {
    return u.indexOf('https://www.storkaup.is/vara/') !== 0;
  });
  if (foreign.length) {
    throw new Error(
      '❌ ÖRYGGISSTOPP — ' + foreign.length + ' slóðir eru ekki undir ' +
      'https://www.storkaup.is/vara/. Ekkert var sent.\n' + foreign.slice(0, 5).join('\n')
    );
  }

  const CHUNK = 50;
  let deleted = 0, failed = 0;

  for (let i = 0; i < urls.length; i += CHUNK) {
    const batch = urls.slice(i, i + CHUNK);

    const res = UrlFetchApp.fetch(e.BASE + '/documents/bulk-delete', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: e.AUTH, Accept: 'application/json' },
      muteHttpExceptions: true,
      payload: JSON.stringify({ Url: { operator: 'Eq', values: batch } })
    });

    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code !== 200) {
      Logger.log('⚠️ lota ' + (i / CHUNK + 1) + ' -> HTTP ' + code + ' - ' + truncateForLog_(body));
      failed += batch.length;
      continue;
    }

    const data = safeJsonParse_(body) || {};
    deleted += Number(data.deleted || 0);
    failed  += Number(data.failed || 0);
    if (data.reason) Logger.log('⚠️ ' + data.reason);

    Utilities.sleep(250);   // kurteisi við API-ið, ekki quota-krafa
  }

  return { deleted: deleted, failed: failed };
}


/************************************************************
 * 🧹 SEINNI UMFERÐ — gömul slug eftir endurnefningu
 *
 * Fyrsta hreinsunin (2026-09-16) náði einingarafritunum,
 * sem eru reiknanleg úr sitemap-inu. Page Inventory fór úr 5.858 í 5.149
 * og ~650 stóðu eftir. Það eru slóðir sem vefurinn gaf vörunni ÁÐUR en
 * hún var endurnefnd — routerinn les aðeins vörunúmerið aftast, svo
 * gamla slóðin svarar enn 200 og Cludo heldur henni.
 *
 * Þær eru aðeins til í vísinum sjálfum. Þetta fall telur því vísinn upp
 * (leitar-API, SiteKey, tóm fyrirspurn, síðað) og ber hverja /vara/-slóð
 * saman við sitemap-ið. Allt sem er ekki kanónískt fellur í einn af
 * tveimur flokkum eftir vörunúmerinu aftast:
 *
 *   GAMALT_SLUG — vörunúmerið ER í sitemap undir annarri slóð. Varan lifir,
 *                 þetta er gamalt heiti hennar. Eytt.
 *   HORFIN      — vörunúmerið er HVERGI í sitemap. Varan er ekki birt
 *                 lengur. Aðeins eytt með {includeGone:true}, því tómur
 *                 eða hálfur sitemap myndi láta ALLAR vörur lenda hér.
 *
 * ÖRYGGISSTOPP, öll áður en nokkru er eytt:
 *   - sitemap undir 4.000 slóðum -> hætt (undirskrá féll, listinn er hálfur)
 *   - fleiri en 1.500 til eyðingar -> hætt (væntum ~650; meira er villa
 *     í samanburðinum, ekki óhreinn vísir)
 *   - cludoBulkDeleteUrls_ hafnar öllu utan https://www.storkaup.is/vara/
 *     (reikningurinn er sameiginlegur með Hagkaup)
 *
 * Samanburður er á NORMALISERAÐRI slóð (lágstafir, án / í lokin, án ? og #)
 * en eytt er með strengnum EINS OG HANN ER GEYMDUR í vísinum. Fyrsta
 * raunkeyrsla fyrri umferðar skilaði „Eytt: 0" einmitt af því að strengurinn
 * sem var sendur var ekki sá sem var geymdur.
 *
 *   cludoPurgeStaleVaraDocs_v1()      -> þurrkeyrsla + flipinn CLUDO_AFRIT
 *   cludoHreinsaVaraDocs_v1()         -> eyðir GAMALT_SLUG + HORFIN, endurtekið
 *   cludoPurgeGoneVaraDocsEYDA_v1()   -> sama, ein umferð, hámark 1.500
 *
 * Þurrkeyrslan og cludoHreinsaVaraDocs_v1 eru í valmyndinni:
 * Stórkaup KPI → Cludo.
 ************************************************************/

var CLUDO_STALE_SHEET_ = 'CLUDO_AFRIT';
var CLUDO_STALE_MAX_ = 1500;
var CLUDO_SITEMAP_MIN_ = 4000;

function cludoNormUrl_(u) {
  return String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/** Vörunúmerið aftast í /vara/-slóð, án einingarendingar.
 *  .../glerhreinsir-clear-2x-5l-104886kassi -> 104886 */
function cludoUrlSku_(u) {
  // HVAÐA stafir sem er aftan við númerið, ekki bara kassi/stk/bretti:
  // 9003652 er í sitemap sem `...-9003652kg` (mælt 2026-09-28). Með
  // listanum einum fékk sú slóð ekkert vörunúmer, og gamla slóðin hennar
  // lenti í HORFIN í stað GAMALT_SLUG.
  var tail = cludoNormUrl_(u).split('/').pop() || '';
  var m = tail.match(/-(\d+)[a-z]*$/) || tail.match(/^(\d+)[a-z]*$/);
  return m ? m[1] : '';
}

/** Allar /vara/-slóðir í vísinum, síðað í gegnum leitar-API-ið.
 *  `complete` segir hvort upptalningin náði heildartölunni sem API-ið
 *  gefur upp — ef djúpt skip er lokað stoppar hún fyrr og segir frá því. */
function cludoEnumerateVaraUrls_() {
  var env = getCludoEnv_();
  var PER_PAGE = 100, MAX_PAGE = 200;
  var seen = {}, vara = [], total = null, page = 1, emptyNew = 0;

  // SÍÐUN ER `page` + `perPage`, EKKI `take` + `skip` (mælt 2026-09-28).
  // Með take/skip skilaði API-ið 11 skjölum af 5.507 og sömu síðunni aftur
  // við hvert skip — það hunsar báða reitina og notar sjálfgefna síðu.
  function search_(query, page) {
    return UrlFetchApp.fetch(env.SEARCH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'SiteKey ' + env.SITE_KEY, Accept: 'application/json' },
      muteHttpExceptions: true,
      payload: JSON.stringify({ query: query, page: page, perPage: PER_PAGE })
    });
  }

  // TÓM FYRIRSPURN SKILAR HTTP 400 (mælt 2026-09-28). `*` er það sem
  // Cludo notar fyrir „allt"; tóma strengnum er haldið til vara. Sú
  // fyrirspurn sem skilar 200 með skjölum á skip=0 er notuð áfram.
  var query = null;
  ['*', ''].some(function (q) {
    var r = search_(q, 1);
    var body = r.getContentText();
    var ok = r.getResponseCode() === 200 &&
             ((safeJsonParse_(body) || {}).TypedDocuments || []).length > 0;
    Logger.log('🔎 fyrirspurn ' + JSON.stringify(q) + ' -> HTTP ' + r.getResponseCode() +
               (ok ? '' : ' — ' + truncateForLog_(body, 400)));
    if (ok) query = q;
    return ok;
  });
  if (query === null) {
    Logger.log('⚠️ engin fyrirspurn taldi upp vísinn — sjá svörin hér að ofan.');
    return { urls: [], seen: 0, total: null, complete: false };
  }

  var firstPageSize = 0;
  while (page <= MAX_PAGE) {
    var res = search_(query, page);
    if (res.getResponseCode() !== 200) {
      Logger.log('⚠️ upptalning page=' + page + ' -> HTTP ' + res.getResponseCode() +
                 ' — ' + truncateForLog_(res.getContentText(), 400));
      break;
    }
    var data = safeJsonParse_(res.getContentText()) || {};
    if (total === null) total = data.TotalDocument || data.TotalDocuments || data.Total || null;
    var docs = data.TypedDocuments || [];
    if (!docs.length) break;

    var fresh = 0;
    docs.forEach(function (d) {
      var f = d.Fields || {};
      var u = (f.Url && f.Url.Value) || '';
      if (!u || seen[u]) return;
      seen[u] = true; fresh++;
      if (u.indexOf('https://www.storkaup.is/vara/') === 0) vara.push(u);
    });
    if (page === 1) firstPageSize = docs.length;
    // API sem hunsar síðunarreitina skilar sömu síðunni aftur og aftur.
    // Tvær síður í röð án nýrra slóða = komin eins langt og hægt er.
    if (!fresh) { if (++emptyNew >= 2) break; } else emptyNew = 0;

    page++;
    Utilities.sleep(150);
  }

  var n = Object.keys(seen).length;
  var complete = total !== null && n >= Number(total);
  Logger.log('🔎 síður: ' + (page - 1) + ' · skjöl á fyrstu síðu: ' + firstPageSize +
             ' (beðið um ' + PER_PAGE + ')');
  Logger.log('🔎 vísir: ' + n + ' skjöl talin upp' + (total !== null ? ' af ' + total : '') +
             ' · þar af /vara/: ' + vara.length + (complete ? '' : ' · ⚠️ ÓFULLGERT'));
  return { urls: vara, seen: n, total: total, complete: complete };
}

/** Eyðir LÍKA HORFIN. Sannreynt 2026-09-28 á átta sýnum: öll átta utan
 *  vörulistans (getProductsV2), fjögur Archived í Plytix og fjögur
 *  Completed — síðurnar svara samt 200 af því routerinn les bara
 *  vörunúmerið. HORFIN er auk þess borið við vörulistann áður en eytt er;
 *  sjá VEF_EKKI_SITEMAP í cludoPurgeStaleVaraDocs_v1. */
function cludoPurgeGoneVaraDocsEYDA_v1() {
  return cludoPurgeStaleVaraDocs_v1({ confirm: true, includeGone: true });
}

/************************************************************
 * 🧹 cludoHreinsaVaraDocs_v1 — ALLT Í EINNI AÐGERÐ
 *
 * Þurrkeyrsla + GAMALT_SLUG + HORFIN í einu falli, fyrir reglulega
 * hreinsun á meðan vefurinn svarar 200 á gömul slug (~30 afrit á tveimur
 * vikum, mælt 2026-10-14). Upptalning vísisins er óstöðug — hver umferð
 * sér ~4.550 af ~4.830 — svo fallið telur upp aftur þar til umferð finnur
 * ekkert til að eyða, mest CLUDO_CLEAN_PASSES_ sinnum.
 *
 * Öryggisnetin eru þau sömu og í EYDA-föllunum (sitemap-lágmark,
 * VEF_EKKI_SITEMAP-vörn), en hámarkið er þrengra: við væntum tuga, ekki
 * hundraða. Fari það yfir CLUDO_CLEAN_MAX_ er stoppað og CLUDO_AFRIT sýnir
 * listann — þá á að skoða hann og keyra cludoPurgeGoneVaraDocsEYDA_v1
 * handvirkt úr ritlinum.
 * CLUDO_AFRIT geymir lista fyrstu umferðar.
 ************************************************************/
var CLUDO_CLEAN_MAX_ = 300;
var CLUDO_CLEAN_PASSES_ = 3;

function cludoHreinsaVaraDocs_v1() {
  var total = 0, passes = 0;
  for (var i = 1; i <= CLUDO_CLEAN_PASSES_; i++) {
    Logger.log('════ Umferð ' + i + ' af ' + CLUDO_CLEAN_PASSES_ + ' ════');
    var r = cludoPurgeStaleVaraDocs_v1({ confirm: true, includeGone: true,
                                         max: CLUDO_CLEAN_MAX_, writeSheet: i === 1 });
    passes = i;
    total += r.deleted || 0;
    if (!r.deleted) break;
    Utilities.sleep(5000);  // gefa vísinum tíma til að sleppa eyddu skjölunum
  }
  Logger.log('✅ Samtals eytt: ' + total + ' í ' + passes + ' umferð(um).');
  return { deleted: total, passes: passes };
}

function cludoPurgeStaleVaraDocs_v1(opts) {
  var o = opts || {};
  var confirm = o.confirm === true;
  var includeGone = o.includeGone === true;
  var max = o.max || CLUDO_STALE_MAX_;

  var sitemap = fetchStorkaupSitemapUrls_();
  if (sitemap.length < CLUDO_SITEMAP_MIN_) {
    throw new Error('❌ ÖRYGGISSTOPP — sitemap skilaði aðeins ' + sitemap.length +
      ' slóðum (lágmark ' + CLUDO_SITEMAP_MIN_ + '). Undirskrá féll líklega; ' +
      'þá lentu lifandi vörur í HORFIN. Ekkert var eytt.');
  }
  var canon = {}, canonSku = {};
  sitemap.forEach(function (u) {
    canon[cludoNormUrl_(u)] = true;
    var s = cludoUrlSku_(u);
    if (s) canonSku[s] = u;
  });

  var idx = cludoEnumerateVaraUrls_();
  var old = [], gone = [], rows = [];
  idx.urls.forEach(function (u) {
    if (canon[cludoNormUrl_(u)]) return;
    var sku = cludoUrlSku_(u);
    if (sku && canonSku[sku]) {
      old.push(u); rows.push(['GAMALT_SLUG', u, sku, canonSku[sku]]);
    } else {
      gone.push(u); rows.push(['HORFIN', u, sku, '']);
    }
  });

  // ANNAÐ ÖRYGGISNET FYRIR HORFIN: vörunúmer sem vörulistinn á vefnum
  // þekkir er LIFANDI vara sem vantar í sitemap — vefvilla, ekki rusl.
  // Henni er aldrei eytt, og hún fær sinn eigin flokk í flipanum.
  if (includeGone && gone.length) {
    var live = {};
    fetchActiveProducts_().forEach(function (p) { live[String(p.parent)] = true; });
    var keep = [];
    gone = gone.filter(function (u) {
      var s = cludoUrlSku_(u);
      if (live[s]) { keep.push(u); return false; }
      return true;
    });
    keep.forEach(function (u) {
      rows.forEach(function (r) { if (r[1] === u) r[0] = 'VEF_EKKI_SITEMAP'; });
    });
    Logger.log('VEF_EKKI_SITEMAP (á vef, vantar í sitemap — EKKI eytt): ' + keep.length);
  }

  var targets = includeGone ? old.concat(gone) : old;

  Logger.log('──────────────────────────────────────────────');
  Logger.log('Kanónískar vöruslóðir (sitemap)   : ' + sitemap.length);
  Logger.log('/vara/-skjöl í vísinum            : ' + idx.urls.length +
             (idx.complete ? '' : '  (upptalning ÓFULLGERÐ — fleiri kunna að vera eftir)'));
  Logger.log('GAMALT_SLUG (varan lifir)         : ' + old.length);
  Logger.log('HORFIN (vörunúmer ekki í sitemap) : ' + gone.length +
             (includeGone ? '' : '  — ekki eytt nema {includeGone:true}'));
  Logger.log('Dæmi                              : ' + old.slice(0, 3).join(', '));
  Logger.log('──────────────────────────────────────────────');

  if (o.writeSheet !== false) cludoWriteStaleSheet_(rows, idx);

  if (targets.length > max) {
    throw new Error('❌ ÖRYGGISSTOPP — ' + targets.length + ' til eyðingar (hámark ' +
      max + '). Svona tala bendir á villu í samanburðinum eða sitemap. ' +
      'Skoðaðu flipann ' + CLUDO_STALE_SHEET_ + '. Ekkert var eytt.');
  }

  if (!confirm) {
    Logger.log('🧪 ÞURRKEYRSLA — engu eytt. Skoðaðu flipann ' + CLUDO_STALE_SHEET_ +
               ' og keyrðu svo cludoHreinsaVaraDocs_v1().');
    return { dryRun: true, indexed: idx.urls.length, complete: idx.complete,
             oldSlug: old.length, gone: gone.length };
  }

  var r = cludoBulkDeleteUrls_(targets, getCludoAdminEnv_());
  Logger.log('🗑️ Eytt: ' + r.deleted + ' | mistókst/fannst ekki: ' + r.failed);
  Logger.log('   Staðfestu í Page Inventory: /vara skal nálgast ' + sitemap.length + '.');
  return { dryRun: false, indexed: idx.urls.length, complete: idx.complete,
           oldSlug: old.length, gone: gone.length, deleted: r.deleted, failed: r.failed };
}

function cludoWriteStaleSheet_(rows, idx) {
  var cfg = loadConfig_();
  var id = cfg.SHEETS && cfg.SHEETS.SALES_SUMMARIES && cfg.SHEETS.SALES_SUMMARIES.ID;
  if (!id) { Logger.log('[CLUDO] vantar SHEETS.SALES_SUMMARIES.ID — aðeins keyrsluskrá.'); return; }
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(CLUDO_STALE_SHEET_) || ss.insertSheet(CLUDO_STALE_SHEET_);
  sh.clear();
  sh.getRange(1, 1).setValue(
    'Keyrt ' + Utilities.formatDate(new Date(), 'Atlantic/Reykjavik', 'yyyy-MM-dd HH:mm') +
    ' · ' + idx.urls.length + ' /vara/-skjöl í vísinum' +
    (idx.complete ? '' : ' · upptalning ÓFULLGERÐ')).setFontStyle('italic');
  var head = [['Flokkur', 'Slóð í vísinum', 'Vörunúmer', 'Rétt slóð (sitemap)']];
  sh.getRange(2, 1, 1, 4).setValues(head).setFontWeight('bold');
  if (rows.length) sh.getRange(3, 1, rows.length, 4).setValues(rows);
  sh.setFrozenRows(2);
}


/************************************************************
 * ⏱️ scheduledCludoCleanup_v1 — hreinsunin á tímastilli
 *
 * Vikulega, sunnudaga ~04:15 (síðan 2026-10-19). Fram að því var
 * cludoHreinsaVaraDocs_v1 aðeins keyrð úr valmyndinni, og á milli
 * keyrslna söfnuðust ~30 afrit á tveimur vikum: gömul slug sem vefurinn
 * svarar enn með 200 og Cludo skríður aftur. Þetta heldur vísinum hreinum
 * þar til vefurinn 301-ar (docs/cludo/TASK_cludo_leit.md).
 *
 * Öryggisstoppin í cludoPurgeStaleVaraDocs_v1 gilda óbreytt. Stopp
 * (sitemap undir 4.000, fleiri en CLUDO_CLEAN_MAX_ til eyðingar) kastar
 * og sendir [KPI ALERT]. Skoðaðu þá CLUDO_AFRIT áður en nokkuð er keyrt
 * handvirkt.
 *
 * Ekki hluti af scheduledCludoSync_v1, því upptalning vísisins tekur
 * 1–3 mín og sú keyrsla er þegar þung. Tekur heldur ekki ScriptLock:
 * hreinsunin snertir engin gögn sem önnur verk skrifa, og lás í 3 mín
 * léti Klaviyo- og Magento-keyrslur sleppa umferð.
 ************************************************************/
function scheduledCludoCleanup_v1() {
  var runId = null;
  var result = { startedAt: new Date().toISOString() };
  try {
    try {
      runId = startIngestionRun_('scheduledCludoCleanup_v1', 'cludo_index', { trigger_type: 'time_based' });
    } catch (logErr) {
      Logger.log('[CLUDOCLEAN][WARN] Could not start ingestion run log: ' + logErr);
    }

    var out = cludoHreinsaVaraDocs_v1();
    result.deleted = out.deleted;
    result.passes = out.passes;
    result.finishedAt = new Date().toISOString();

    if (runId) {
      try { finishIngestionRun_(runId, 'success', out.deleted, result, null); }
      catch (logErr2) { Logger.log('[CLUDOCLEAN][WARN] Could not finish ingestion run log: ' + logErr2); }
    }
    Logger.log('[CLUDOCLEAN][INFO] ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = String(e && e.message || e);
    if (runId) {
      try { finishIngestionRun_(runId, 'error', 0, result, result.error); }
      catch (logErr3) { Logger.log('[CLUDOCLEAN][WARN] Could not finish ingestion run log: ' + logErr3); }
    }
    try { notifyTriggerFailure_('scheduledCludoCleanup_v1', e, result); }
    catch (alertErr) { Logger.log('[CLUDOCLEAN][WARN] Failure alert failed: ' + alertErr); }
    throw e;
  }
}

function installCludoCleanupTrigger_v1() {
  var fn = 'scheduledCludoCleanup_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[CLUDOCLEAN][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn).timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).nearMinute(15).create();
  Logger.log('[CLUDOCLEAN][INFO] Created trigger for ' + fn + ' (Sundays ~04:15)');
  return { created: true, schedule: 'onWeekDay(SUNDAY).atHour(4).nearMinute(15)' };
}


/************************************************************
 * 🔎 LEITARVAKT — það sem viðskiptavinur sér í leitinni
 *
 * Kallar á /api/search á storkaup.is, sömu leið og leitarboxið, svo
 * vaktin nær bæði framendanum og Cludo. Keyrð daglega í
 * runDailySanityChecks_v1 (síðan 2026-10-19):
 *
 *   cludo_search_alive  — `hanskar` skilar minnst 20 (89 þann 2026-10-19).
 *                         error: leitin er niðri eða vísirinn tæmdist.
 *   cludo_search_dupes  — sama vörunúmer tvisvar í efstu 50 á föstum
 *                         fyrirspurnum. error: viðskiptavinur kvartaði
 *                         yfir nákvæmlega þessu í sept. (113258).
 *   cludo_search_pasted — flipaheiti („Vara | Merki | Stórkaup“) skilar
 *                         vörunni. warning: þekkt bilun, `|` gefur 0.
 *                         Bíður lagfæringar hjá Högum. Fer að standast
 *                         sjálfkrafa þegar hún kemur.
 *
 * cludoLeitarvakt_v1() keyrir sömu athuganir handvirkt og skrifar í log.
 ************************************************************/
var STORKAUP_SEARCH_URL_ = 'https://www.storkaup.is/api/search';
var CLUDO_DUPE_QUERIES_ = ['113258', 'hanskar', 'ryksugupokar', 'kaffi', 'sápa'];
var CLUDO_PASTED_PROBE_ = { query: 'Ryksugupokar Buddy II, 4stk | Nilfisk | Stórkaup', sku: '113258' };
var CLUDO_ALIVE_MIN_ = 20;

function storkaupSearch_(query, pageSize) {
  var res = UrlFetchApp.fetch(STORKAUP_SEARCH_URL_, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ query: query, pageNumber: 1, pageSize: pageSize || 50,
                              responseType: 'full', facets: { Category: [''] } })
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('/api/search "' + query + '" -> HTTP ' + res.getResponseCode() +
                    ' — ' + truncateForLog_(res.getContentText(), 200));
  }
  var d = safeJsonParse_(res.getContentText()) || {};
  var urls = (d.TypedDocuments || []).map(function (doc) {
    var f = doc.Fields || {};
    return (f.Url && f.Url.Value) || '';
  }).filter(String);
  return { total: Number(d.TotalDocument || 0), urls: urls, fixed: d.FixedQuery || '' };
}

function evaluateCludoSearchHealth_() {
  var checks = [];
  function add_(name, passed, details, severity) {
    checks.push({ name: name, passed: !!passed, details: details, severity: severity || 'error' });
  }

  try {
    var alive = storkaupSearch_('hanskar', 10);
    add_('cludo_search_alive', alive.total >= CLUDO_ALIVE_MIN_,
         '`hanskar` -> ' + alive.total + ' niðurstöður (lágmark ' + CLUDO_ALIVE_MIN_ + ')');
  } catch (e) {
    add_('cludo_search_alive', false, 'Leitin svarar ekki: ' + (e && e.message || e));
    return checks;   // ekkert vit í hinum athugununum ef leitin er niðri
  }

  try {
    var dupes = [];
    CLUDO_DUPE_QUERIES_.forEach(function (q) {
      var bySku = {};
      storkaupSearch_(q, 50).urls.forEach(function (u) {
        var s = cludoUrlSku_(u);
        if (s) (bySku[s] = bySku[s] || []).push(u);
      });
      Object.keys(bySku).forEach(function (s) {
        if (bySku[s].length > 1) dupes.push('`' + q + '`: ' + bySku[s].join(' + '));
      });
      Utilities.sleep(200);
    });
    add_('cludo_search_dupes', dupes.length === 0,
         dupes.length
           ? 'Sama vara oftar en einu sinni: ' + dupes.slice(0, 5).join(' | ') +
             ' — keyrðu Stórkaup KPI → Cludo → Hreinsa leitarvísi'
           : 'Engar tvítekningar í efstu 50 á ' + CLUDO_DUPE_QUERIES_.length + ' fyrirspurnum');
  } catch (e2) {
    add_('cludo_search_dupes', false, String(e2 && e2.message || e2), 'warning');
  }

  try {
    var p = storkaupSearch_(CLUDO_PASTED_PROBE_.query, 10);
    var hit = p.urls.some(function (u) { return cludoUrlSku_(u) === CLUDO_PASTED_PROBE_.sku; });
    add_('cludo_search_pasted', hit,
         hit ? 'Inn-límt flipaheiti finnur vöruna'
             : 'Inn-límt flipaheiti („… | Nilfisk | Stórkaup“) -> ' + p.total +
               ' niðurstöður. Þekkt: `|` í leit gefur 0, bíður Haga (docs/cludo/)',
         'warning');
  } catch (e3) {
    add_('cludo_search_pasted', false, String(e3 && e3.message || e3), 'warning');
  }

  return checks;
}

function cludoLeitarvakt_v1() {
  var checks = evaluateCludoSearchHealth_();
  checks.forEach(function (c) {
    Logger.log('[' + (c.passed ? 'PASS' : (c.severity === 'warning' ? 'WARN' : 'FAIL')) + '] ' +
               c.name + ' - ' + c.details);
  });
  return checks;
}

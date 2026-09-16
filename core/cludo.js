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
 * ✔ Unified normalization wrapper
 ************************************************************/
function normalizeSkuKey_(value) {
  return normalizeSkuGlobal_(value);
}


/************************************************************
 * 🧩 LOGGING: PRODUCTS_MISSING
 *  - SKU sem Cludo finnur ekki / vantar category o.fl.
 ************************************************************/
function logMissingProduct_(sku, reason, source) {
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);

  const missingName = 'PRODUCTS_MISSING';
  let sh = ss.getSheetByName(missingName);

  if (!sh) {
    sh = ss.insertSheet(missingName);
    sh.appendRow(['SKU', 'Reason', 'Last Checked', 'Source', 'Notes']);
  }

  const row = [
    String(sku),
    String(reason),
    new Date(),
    source || '',
    ''
  ];

  sh.appendRow(row);
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
 * 📋 exportCategoryPriceList_ — verðlisti eftir Level 1
 * - Sía PRODUCTS eftir Level 1 gildi
 * - Tengja við BC_LINES: median UNIT_PRICE_EXCL per SKU
 * - Output: nýr flips í PRODUCTS workbook
 ************************************************************/
function exportCategoryPriceList_(level1Value) {
  const cfg = loadConfig_();

  // 1) Load + filter products
  const products = loadTableBySchema_('PRODUCTS');
  const filtered = products.filter(r =>
    String(r.LEVEL1 || '').trim() === level1Value
  );

  if (!filtered.length) {
    Logger.log(`⚠️ No products for Level 1 = "${level1Value}"`);
    return;
  }
  Logger.log(`📦 ${filtered.length} products in "${level1Value}"`);

  // 2) Median verð per SKU úr BC_LINES
  const bcLines = loadTableBySchema_('BC_LINES');
  const pricesBySku = {};

  bcLines.forEach(r => {
    const sku = normalizeSkuGlobal_(r.SKU);
    const price = parseFloat(r.UNIT_PRICE_EXCL);
    if (!sku || isNaN(price) || price <= 0) return;
    if (!pricesBySku[sku]) pricesBySku[sku] = [];
    pricesBySku[sku].push(price);
  });

  // 3) Join + búa til raðir
  const HEADER = ['SKU', 'Product Name', 'Level 2', 'Level 3', 'Category Path', 'Median Price', '# Sales'];

  const rows = filtered.map(p => {
    const sku = normalizeSkuGlobal_(p.SKU);
    const prices = pricesBySku[sku] || [];
    const sorted = prices.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length
      ? (sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid])
      : '';

    return [sku, p.NAME || '', p.LEVEL2 || '', p.LEVEL3 || '', p.CATEGORY_PATH || '', median, prices.length];
  });

  rows.sort((a, b) =>
    String(a[2]).localeCompare(String(b[2])) ||
    String(a[3]).localeCompare(String(b[3])) ||
    String(a[0]).localeCompare(String(b[0]))
  );

  // 4) Skrifa í flipa
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);
  const sheetName = `Price List — ${level1Value}`;
  let sh = ss.getSheetByName(sheetName);
  if (sh) sh.clearContents();
  else sh = ss.insertSheet(sheetName);

  sh.appendRow(HEADER);
  if (rows.length) sh.getRange(2, 1, rows.length, HEADER.length).setValues(rows);
  sh.getRange(1, 1, sh.getLastRow(), 1).setNumberFormat('@');

  Logger.log(`✅ Price list done — ${rows.length} rows → "${sheetName}"`);
}

function menu_exportAfengirDrykkir() {
  exportCategoryPriceList_('Áfengir drykkir');
}


/************************************************************
 * 🔬 Manual test function
 ************************************************************/

function testSingleSku() {
  const raw = '107228';
  const sku = normalizeSkuGlobal_(raw);
  Logger.log(`🔎 raw='${raw}' → normalized='${sku}'`);

  const env = getCludoEnv_();
  const res = fetchCludoResult_(sku, env);
  Logger.log(JSON.stringify(res, null, 2));

  // Debug: skoðum öll Fields sem Cludo skilar
  const payload = {
    query: sku, take: 1, skip: 0,
    searchType: "phrase",
    filters: { StorkaupSKU: [sku] }
  };
  const rawRes = UrlFetchApp.fetch(env.SEARCH_URL, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `SiteKey ${env.SITE_KEY}`, Accept: "application/json" },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });
  const data = JSON.parse(rawRes.getContentText());
  const fields = data?.TypedDocuments?.[0]?.Fields || {};
  Logger.log('ALL FIELD KEYS: ' + JSON.stringify(Object.keys(fields)));
  Logger.log('ALL FIELDS: ' + JSON.stringify(fields, null, 2));
}



function debugMissingBcSkus() {
  // 1) Safna ALLA SKU úr NEWWEB + OLDWEB + BC_LINES
  let all = collectAllSkusFromSystems_();

  // Force → array
  if (!Array.isArray(all)) {
    all = Object.values(all);
  }

  Logger.log("Total SKUs from collector: " + all.length);

  // 2) Sækja BC SKU
  let bc = loadTableBySchema_('BC_LINES')
    .map(r => normalizeSkuGlobal_(r.SKU))
    .filter(Boolean);

  if (!Array.isArray(bc)) {
    bc = Object.values(bc);
  }

  const bcSet = new Set(bc);

  // 3) Finna hvaða SKU vantar
  const missing = all.filter(sku => !bcSet.has(sku));

  Logger.log("Missing SKU count: " + missing.length);
  Logger.log(JSON.stringify(missing.slice(0,150), null, 2));  // preview
}
function testCollectorType() {
  const res = collectAllSkusFromSystems_();
  Logger.log("TYPE: " + typeof res);
  Logger.log("IS ARRAY: " + Array.isArray(res));
  Logger.log(JSON.stringify(res, null, 2).slice(0,500));
}

function testCollectorSteps() {

  const newweb = loadTableBySchema_('NEWWEB');
  Logger.log("NEWWEB type = " + typeof newweb + " | array? " + Array.isArray(newweb));
  Logger.log("NEWWEB length = " + (Array.isArray(newweb) ? newweb.length : Object.keys(newweb).length));

  const oldweb = loadTableBySchema_('OLDWEB');
  Logger.log("OLDWEB type = " + typeof oldweb + " | array? " + Array.isArray(oldweb));
  Logger.log("OLDWEB length = " + (Array.isArray(oldweb) ? oldweb.length : Object.keys(oldweb).length));

  const bc = loadTableBySchema_('BC_LINES');
  Logger.log("BC_LINES type = " + typeof bc + " | array? " + Array.isArray(bc));
  Logger.log("BC_LINES length = " + (Array.isArray(bc) ? bc.length : Object.keys(bc).length));
}
function debugCollectorRaw() {
  const result = collectAllSkusFromSystems_();
  Logger.log("Collector returned type = " + typeof result + " | Array? " + Array.isArray(result));
  Logger.log("Length = " + (Array.isArray(result) ? result.length : JSON.stringify(result).length));
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
 * móti 6.72). Þess vegna þarf þetta fall.
 *
 * Listinn er reiknaður úr sitemap-inu í hvert skipti, ekki harðkóðaður,
 * svo hann eldist ekki þegar vörur bætast við.
 *
 * Rétta lagfæringin er á vefnum (301 á kanóníska slóð + alvöru 404).
 * Þetta er þrif á afleiðingunni, ekki orsökinni.
 ************************************************************/

var STORKAUP_SITEMAP_URL_ = 'https://www.storkaup.is/sitemap.xml';

// Söluendingar sem vefurinn hengir aftan á SKU-slóð. Bæta við hér ef
// nýjar einingar birtast — sjá storkaupParentSku_ í storkaup_pricing.js.
var STORKAUP_UNIT_SUFFIXES_ = ['kassi', 'stk', 'bretti'];


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
 * 🧮 cludoBuildOrphanUrls_ — afritaslóðirnar sem eiga að hverfa
 *
 * Aðeins vörur þar sem sitemap-slóðin endar á HREINU vörunúmeri eiga
 * afrit. Fyrir hinar (3.687 af 4.477) er einingarslóðin sjálf rétta
 * slóðin og má alls ekki snerta — það var gildran sem gerði blanket
 * regexið `kassi$` óhæft.
 *
 * Öryggisnetið neðst er ekki skraut: það staðfestir að enginn
 * reiknaður listi skarist við sitemap-ið áður en nokkru er eytt.
 ************************************************************/
function cludoBuildOrphanUrls_(sitemapUrls) {
  const canonical = {};
  sitemapUrls.forEach(function (u) { canonical[u] = true; });

  const orphans = [];
  sitemapUrls.forEach(function (u) {
    if (!/-\d+$/.test(u)) return;              // endar á einingu -> engin afrit
    STORKAUP_UNIT_SUFFIXES_.forEach(function (sfx) { orphans.push(u + sfx); });
  });

  const collision = orphans.filter(function (u) { return canonical[u]; });
  if (collision.length) {
    throw new Error(
      '❌ ÖRYGGISSTOPP — ' + collision.length + ' reiknaðar afritaslóðir eru ' +
      'í sitemap-inu og eru því RÉTTAR slóðir. Ekkert var eytt.\n' +
      collision.slice(0, 5).join('\n')
    );
  }

  Logger.log('🧮 ' + orphans.length + ' afritaslóðir reiknaðar (0 árekstrar við sitemap)');
  return orphans;
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
 * ✅ cludoPurgeOrphanVaraDocs_v1 — AÐALFALLIÐ, keyrt handvirkt
 *
 * Sjálfgefið ÞURRKEYRSLA. Ekkert er eytt fyrr en confirm:true er sent.
 *
 *   cludoPurgeOrphanVaraDocs_v1()                  -> skýrsla, engin eyðing
 *   cludoPurgeOrphanVaraDocs_v1({confirm:true})    -> eyðir
 *
 * Ekkert _ í endann viljandi: fallið á að sjást í fallavalmyndinni.
 ************************************************************/
/************************************************************
 * 🔬 cludoDebugDeleteOne_v1 — hvers vegna hitti sían ekkert?
 *
 * Fyrsta raunkeyrslan skilaði 200 á öllum 43 lotum en
 * "No documents matching the given filters" og Eytt: 0. Sían keyrði
 * sem sagt en `Url`-gildið í vísinum er ekki nákvæmlega strengurinn
 * sem við sendum.
 *
 * Þetta fall giskar ekki: það les skjalið gegnum leitar-API-ið (SiteKey,
 * sama leið og fetchCludoResult_ notar) og prentar Id og Url EINS OG ÞAU
 * ERU GEYMD. Svo prófar það báðar eyðingarleiðirnar á þeirri einu slóð:
 *
 *   1) bulk-delete með Url-síu
 *   2) DELETE .../documents?documentId=<Id>
 *
 * Skotmarkið er alltaf AFRIT (slóð sem endar á einingu og er ekki í
 * sitemap) — aldrei kanóníska síðan.
 ************************************************************/
function cludoDebugDeleteOne_v1() {
  const TARGET = 'https://www.storkaup.is/vara/glerhreinsir-clear-2x-5l-104886kassi';
  const SKU = '104886';

  if (!/(kassi|stk|bretti)$/.test(TARGET)) {
    throw new Error('❌ Skotmarkið lítur ekki út fyrir að vera afrit — hætt við.');
  }

  // --- 1) Lesa skjalið eins og það er geymt ---
  const env = getCludoEnv_();
  const res = UrlFetchApp.fetch(env.SEARCH_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'SiteKey ' + env.SITE_KEY, Accept: 'application/json' },
    muteHttpExceptions: true,
    payload: JSON.stringify({ query: SKU, take: 10, skip: 0 })
  });

  const data = safeJsonParse_(res.getContentText()) || {};
  const docs = data.TypedDocuments || [];
  Logger.log('🔎 leit á ' + SKU + ' → ' + docs.length + ' skjöl (HTTP ' + res.getResponseCode() + ')');

  let targetId = '';
  docs.forEach(function (d, i) {
    const f = d.Fields || {};
    const u = (f.Url && f.Url.Value) || '';
    // Id getur legið á skjalinu sjálfu EÐA sem reitur — prenta bæði.
    const idTop = d.Id || d.id || '';
    const idFld = (f.Id && f.Id.Value) || '';
    Logger.log('  [' + i + '] Url = ' + JSON.stringify(u));
    Logger.log('       Id(doc) = ' + JSON.stringify(idTop) + ' | Id(field) = ' + JSON.stringify(idFld));
    if (i === 0) Logger.log('       REITIR: ' + JSON.stringify(Object.keys(f)));
    if (u === TARGET) targetId = idTop || idFld || u;
  });

  if (!targetId) {
    Logger.log('⚠️ Fann ekki ' + TARGET + ' í leitarniðurstöðum — kannski þegar eytt.');
    return { found: false };
  }

  const adm = getCludoAdminEnv_();

  // --- 2) bulk-delete með Url-síu, EIN slóð ---
  const bulk = UrlFetchApp.fetch(adm.BASE + '/documents/bulk-delete', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: adm.AUTH, Accept: 'application/json' },
    muteHttpExceptions: true,
    payload: JSON.stringify({ Url: { operator: 'Eq', values: [TARGET] } })
  });
  Logger.log('🧪 bulk-delete → HTTP ' + bulk.getResponseCode() + ' – ' + bulk.getContentText());

  // --- 3) single delete á documentId ---
  const single = UrlFetchApp.fetch(
    adm.BASE + '/documents?documentId=' + encodeURIComponent(targetId), {
      method: 'delete',
      headers: { Authorization: adm.AUTH, Accept: 'application/json' },
      muteHttpExceptions: true
    });
  Logger.log('🧪 single delete (' + targetId + ') → HTTP ' + single.getResponseCode() +
             ' – ' + single.getContentText());

  return { found: true, targetId: targetId };
}


/************************************************************
 * 🔬 cludoDebugEnumerate_v1 — ræður leitar-API-ið við upptalningu?
 *
 * Eftir fyrstu hreinsun fór Page Inventory úr 5.858 í 5.149 — 709
 * fjarlægð en ~650 enn umfram 4.475 kanónískar vörur. Afgangurinn er
 * flokkur 2 (gömul slug eftir endurnefningu), sem er EKKI reiknanlegur
 * úr sitemap-inu: gömlu slugin eru aðeins til í vísinum.
 *
 * Til að ná þeim þarf að telja upp allt sem er indexað og bera saman
 * við sitemap-ið. Spurningin er hvort API-ið leyfi djúpt skip — margar
 * leitarvélar loka á skip yfir ~1.000. Þetta fall eyðir ENGU; það
 * mælir bara hvað er hægt.
 ************************************************************/
function cludoDebugEnumerate_v1() {
  const env = getCludoEnv_();

  function probe_(skip, take) {
    const res = UrlFetchApp.fetch(env.SEARCH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'SiteKey ' + env.SITE_KEY, Accept: 'application/json' },
      muteHttpExceptions: true,
      payload: JSON.stringify({ query: '', take: take, skip: skip })
    });
    const code = res.getResponseCode();
    const body = res.getContentText();
    const data = safeJsonParse_(body) || {};
    const docs = data.TypedDocuments || [];
    return {
      code: code,
      count: docs.length,
      total: data.TotalDocument || data.TotalDocuments || data.Total || null,
      first: docs.length ? ((docs[0].Fields && docs[0].Fields.Url && docs[0].Fields.Url.Value) || '') : '',
      keys: Object.keys(data),
      raw: body.slice(0, 200)
    };
  }

  const p0 = probe_(0, 100);
  Logger.log('skip=0    take=100 → HTTP ' + p0.code + ' | skjöl: ' + p0.count +
             ' | heild: ' + p0.total);
  Logger.log('  svarlyklar: ' + JSON.stringify(p0.keys));
  if (!p0.count) Logger.log('  hrátt: ' + p0.raw);
  else Logger.log('  fyrsta: ' + p0.first);

  [100, 1000, 3000, 5000].forEach(function (s) {
    const p = probe_(s, 100);
    Logger.log('skip=' + s + ' take=100 → HTTP ' + p.code + ' | skjöl: ' + p.count +
               (p.first ? ' | fyrsta: ' + p.first : ''));
    Utilities.sleep(300);
  });

  return { total: p0.total };
}


/************************************************************
 * ⚠️ cludoPurgeOrphanVaraDocsEYDA_v1 — RAUNKEYRSLAN
 *
 * Fallavalmyndin í Apps Script ritlinum getur ekki sent breytur, svo
 * confirm:true þarf sitt eigið fall til að sjást þar. Nafnið er með
 * EYDA í miðjunni svo það sé ekki hægt að ruglast á því og þurrkeyrslunni
 * í valmyndinni.
 ************************************************************/
function cludoPurgeOrphanVaraDocsEYDA_v1() {
  return cludoPurgeOrphanVaraDocs_v1({ confirm: true });
}


function cludoPurgeOrphanVaraDocs_v1(opts) {
  const o = opts || {};
  const confirm = o.confirm === true;

  const sitemap = fetchStorkaupSitemapUrls_();
  const orphans = cludoBuildOrphanUrls_(sitemap);

  Logger.log('──────────────────────────────────────────────');
  Logger.log('Kanónískar vöruslóðir (mega vera)  : ' + sitemap.length);
  Logger.log('Afritaslóðir til eyðingar          : ' + orphans.length);
  Logger.log('Dæmi                               : ' + orphans.slice(0, 3).join(', '));
  Logger.log('──────────────────────────────────────────────');

  if (!confirm) {
    Logger.log('🧪 ÞURRKEYRSLA — engu eytt.');
    Logger.log('   Keyrðu cludoPurgeOrphanVaraDocs_v1({confirm:true}) til að eyða.');
    return { dryRun: true, canonical: sitemap.length, candidates: orphans.length };
  }

  const env = getCludoAdminEnv_();
  const r = cludoBulkDeleteUrls_(orphans, env);

  Logger.log('🗑️ Eytt: ' + r.deleted + ' | mistókst/fannst ekki: ' + r.failed);
  Logger.log('   Staðfestu í Page Inventory: /vara skal fara úr ~5.858 í ~4.480.');
  return {
    dryRun: false,
    canonical: sitemap.length,
    candidates: orphans.length,
    deleted: r.deleted,
    failed: r.failed
  };
}

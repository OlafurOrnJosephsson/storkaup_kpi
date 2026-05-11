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
 * 🔢 Safna ALLSKO úr NEWWEB + OLDWEB + BC_INVOICE_LINES
 * Skilar:
 *  - skus:   unique sku list (normalized)
 *  - source: map[sku] = Set(["NEWWEB","BC_LINES",...])
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

  // --- 4) CLEANUP ---
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
 * 🔬 Manual test function
 ************************************************************/

function testSingleSku() {
  const raw = '107228';
  const sku = normalizeSkuGlobal_(raw);
  Logger.log(`🔎 raw='${raw}' → normalized='${sku}'`);

  const env = getCludoEnv_();
  const res = fetchCludoResult_(sku, env);
  Logger.log(JSON.stringify(res, null, 2));
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

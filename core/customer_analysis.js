/************************************************************
 * 👥 CUSTOMER INTELLIGENCE CORE v8.5
 * ----------------------------------------------------------
 * - Customer Analysis (BC + NEWWEB + scores)
 * - Customer Profiles v7 (ctx-based)
 * - Category Fit v2 (ctx-based)
 *
 * Byggir á:
 *   STORKAUP_SCHEMA
 *   loadConfig_(), loadSheetObjects_() (utils.gs)
 *   buildOrderContext_(cfg) (salessummaries.gs)
 ************************************************************/


/************************************************************
 * 🚀 MAIN: CUSTOMER ANALYSIS
 ************************************************************/
function buildCustomerAnalysis() {
  const cfg = loadConfig_();

  // 🎯 Target: SALES_SUMMARIES skjalið, "Customer Analysis" flipi
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateCustomerAnalysisSheet_(ss);

  // 1) Product category map (SKU → Level 1)
  const productCategoryMap = loadProductCategoryMap_();

  // Product lookup for SKU names in Top Products
  const productLookup = typeof loadProductsLookup_ === 'function'
    ? (loadProductsLookup_(cfg) || {})
    : {};

  // 2) Gagnalög
  const bcCustomers    = loadBCCustomers_();                      // master BC viðskiptamenn
  const bcInvoices     = loadBCInvoices_();                       // BC sölureikningar (samantekt)
  const bcInvoiceLines = loadBCInvoiceLines_(productCategoryMap); // BC línur (SKU + flokkar)
  const webMap         = loadNEWWEBLines_();                      // NEWWEB (Magento) sölulínur
  const magentoNames   = loadMagentoCompanyNameMap_();            // fallback nafn (vef-kúnnar án BC-master)

  // 3) Sameina alla Customer ID
  const idCollector = {};
  addIdsFromMap_(idCollector, bcCustomers);
  addIdsFromMap_(idCollector, bcInvoices);
  addIdsFromMap_(idCollector, bcInvoiceLines);
  addIdsFromMap_(idCollector, webMap);

  const allIds = Object.keys(idCollector).sort();

  // 4) Byggja útflutningsröð
  const header = getCustomerAnalysisHeader_();
  const rows = [header];

  allIds.forEach(id => {
    const row = buildCustomerAnalysisRow_(
      id,
      bcCustomers[id],
      bcInvoices[id],
      bcInvoiceLines[id],
      webMap[id],
      productLookup,
      magentoNames
    );
    if (row) rows.push(row);
  });

  // 5) Skrifa og formatta
  sh.clearContents();
  if (rows.length) {
    sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  }

  // Fallega default formatting (úr utils)
  applyDefaultFormatting_(sh, 'Last BC Order Date');

  Logger.log(`✅ buildCustomerAnalysis: ${rows.length - 1} customers.`);
}


/************************************************************
 * 🧱 SHEET HELPERS
 ************************************************************/
function getOrCreateCustomerAnalysisSheet_(ss) {
  const name = 'Customer Analysis';
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function getCustomerAnalysisHeader_() {
  return [
    'Customer ID',
    'Customer Name',
    'Webshop Active',
    'Webshop Added Date',
    'Phone',
    'Credit Limit',
    'Primary Email',

    'Lifetime BC Sales',
    'Total BC Orders',
    'Average BC Order Value',
    'Last BC Order Date',
    'Orders BC (last 90d)',
    'Orders BC (last 365d)',

    'Webshop Orders',
    'Webshop Sales',
    'Webshop AOV',
    'Webshop Last Order',
    'Webshop Share — Lifetime (%)',

    'Total Value',
    'Total Orders',

    'Frequency Score',
    'Recency Score',
    'Product Fit Score',
    'Value Score',
    'Readiness Score',
    'Category Fit Score',
    'Potential Score (0–100)',
    'Low Hanging Fruit Score',
    'Recommended Action',

    'Total SKU Count',
    'Top 15 Products',

    'Category % Rekstrarvörur',
    'Category % Heilbrigðisvörur',
    'Category % Matvörur',
    'Category % Vélar og tæki',
    'Category % Áfengi',
    'Primary Category'
  ];
}

function addIdsFromMap_(collector, map) {
  if (!map) return;
  Object.keys(map).forEach(id => {
    if (id && id !== 'undefined') collector[id] = true;
  });
}

/************************************************************
 * 🔨 BUILD ONE CUSTOMER ANALYSIS ROW
 ************************************************************/
function buildCustomerAnalysisRow_(id, bcCust, bcInv, bcLines, web, productLookup, magentoNames) {
  // Skoppum línu ef við höfum bókstaflega ekkert um þennan kúnna
  if (!bcCust && !bcInv && !web) return null;

  const empty = '';

  // 🔹 BC master info — fall back to Magento company name for web customers that
  //    have no BC master record (BC ingest is frozen, so its master never gains
  //    newer web-only customers).
  const mNames = magentoNames || {};
  const customerName = (bcCust && bcCust.companyName)
    || mNames[id]
    || mNames[String(id).replace(/\D/g, '')]
    || '';
  const phone        = (bcCust && bcCust.phone) || '';
  const creditLimit  = (bcCust && bcCust.creditLimit) || 0;

  // 🔹 Primary email — tökum af vefnum ef til
  let primaryEmail = '';
  if (web && web.primaryEmail) {
    primaryEmail = web.primaryEmail;
  }

  // 🔹 Offline (BC_INVOICES)
  const bcSalesIncl = bcInv ? (bcInv.totalValueIncl || 0) : 0;
  const bcOrders    = bcInv ? (bcInv.invoiceCount   || 0) : 0;
  const bcAOV       = bcOrders ? bcSalesIncl / bcOrders : 0;
  const bcLast      = bcInv ? bcInv.lastOrderDate : null;
  const bc90        = bcInv ? (bcInv.orders90d  || 0) : 0;
  const bc365       = bcInv ? (bcInv.orders365d || 0) : 0;

  // 🔹 Online (NEWWEB)
  const webSales  = web ? (web.webSales  || 0) : 0;
  const webOrders = web ? (web.webOrders || 0) : 0;
  const webAOV    = webOrders ? webSales / webOrders : 0;
  const webLast   = web ? web.lastWebOrder : null;
  const webFirst  = web ? web.firstWebOrder : null;

  // 🔹 Combined
  const totalValue      = bcSalesIncl + webSales;
  const totalOrders     = bcOrders + webOrders;
  const webshopActive   = webOrders > 0;
  const webShareLifetime = totalValue ? (webSales / totalValue) * 100 : 0;

  // 🔹 Scores
  const freqScore    = calcFrequencyScore_(totalOrders);
  const recencyScore = calcRecencyScore_(bcLast, webLast);
  const valueScore   = calcValueScore_(totalValue);
  const productFit   = calcProductFitScore_(bcLines);
  const catFit       = calcCategoryFitScore_(bcLines);
  const readiness    = calcReadinessScore_(recencyScore, freqScore);
  const potential    = calcPotentialScore_(valueScore, catFit);
  const lhScore      = calcLowHangingFruitScore_(bcSalesIncl, webSales, webshopActive);
  const action       = suggestAction_(webshopActive, lhScore, readiness);

  // 🔹 SKU stats
  let totalSkuCount = 0;
  let topProducts = '';
  if (bcLines && bcLines.skuTotals) {
    totalSkuCount = Object.keys(bcLines.skuTotals).length;
    topProducts   = topNSKUs_(bcLines.skuTotals, 15, productLookup);
  }

  // 🔹 Category mix
  const catPerc    = calcCategoryPercentages_(bcLines);
  const primaryCat = pickPrimaryCategory_(catPerc);

  return [
    id,
    customerName,
    webshopActive,
    webFirst || empty,
    phone,
    creditLimit,
    primaryEmail,

    bcSalesIncl,
    bcOrders,
    bcAOV,
    bcLast || empty,
    bc90,
    bc365,

    webOrders,
    webSales,
    webAOV,
    webLast || empty,
    webShareLifetime,

    totalValue,
    totalOrders,

    freqScore,
    recencyScore,
    productFit,
    valueScore,
    readiness,
    catFit,
    potential,
    lhScore,
    action,

    totalSkuCount,
    topProducts,

    catPerc['Rekstrarvörur'],
    catPerc['Heilbrigðisvörur'],
    catPerc['Matvörur'],
    catPerc['Vélar og tæki'],
    catPerc['Áfengi'],
    primaryCat
  ];
}


/************************************************************
 * 📦 LOADER LAYER — byggt á STORKAUP_SCHEMA + CONFIG v2
 ************************************************************/

/********* PRODUCTS → SKU → Level1 category *********/
function loadProductCategoryMap_() {
  const cfg = loadConfig_();
  const svc = cfg.SHEETS.PRODUCTS;
  const rows = loadSheetObjects_(svc.ID, svc.NAME);
  if (!rows || !rows.length) return {};

  const S = STORKAUP_SCHEMA.PRODUCTS;
  const map = {};

  rows.forEach(r => {
    const rawSku = r[S.SKU];
    if (!rawSku) return;

    const sku = normalizeSkuGlobal_(rawSku);
    const cat = r[S.LEVEL1] || '';
    if (sku && cat) {
      map[sku] = String(cat).trim();
    }
  });

  return map;
}

/********* BC_CUSTOMERS (“Viðskiptamenn”) *********/
function loadBCCustomers_() {
  const cfg = loadConfig_();
  const svc = cfg.SHEETS.BC_CUSTOMERS;
  const rows = loadSheetObjects_(svc.ID, svc.NAME);
  if (!rows || !rows.length) return {};

  const C = STORKAUP_SCHEMA.BC_CUSTOMERS.COLUMNS;
  const out = {};

  rows.forEach(r => {
    const id = String(r[C.COMPANY_ID] || '').trim();
    if (!id) return;

    out[id] = {
      companyId:      id,
      companyName:    r[C.COMPANY_NAME] || '',
      creditLimit:    toNum_(r[C.CREDIT_LIMIT]),
      phone:          r[C.PHONE] || '',
      balance:        toNum_(r[C.BALANCE]),
      payments:       toNum_(r[C.PAYMENTS]),
      bcSalesSmoothed:toNum_(r[C.SALES]),
      modifiedDate:   parseDateSafe_(r[C.MODIFIED_DATE])
    };
  });

  return out;
}

/********* BC_INVOICES (“Bókaðir sölureikningar”) *********/
function loadBCInvoices_() {
  const cfg = loadConfig_();
  const svc = cfg.SHEETS.BC_INVOICES;
  const rows = loadSheetObjects_(svc.ID, svc.NAME);
  if (!rows || !rows.length) return {};

  const C = STORKAUP_SCHEMA.BC_INVOICES.COLUMNS;
  const now = new Date();
  const out = {};

  rows.forEach(r => {
    const id = String(r[C.COMPANY_ID] || '').trim();
    if (!id) return;

    if (!out[id]) {
      out[id] = {
        totalValueExcl: 0,
        totalValueIncl: 0,
        invoiceCount:   0,
        lastOrderDate:  null,
        orders90d:      0,
        orders365d:     0
      };
    }

    const c    = out[id];
    const date = parseDateSafe_(r[C.BOOKING_DATE]) || parseDateSafe_(r[C.ORDER_DATE]);
    const excl = toNum_(r[C.AMOUNT_EXCL]);
    const incl = toNum_(r[C.AMOUNT_INCL]);

    c.totalValueExcl += excl;
    c.totalValueIncl += incl;
    c.invoiceCount++;

    if (date && (!c.lastOrderDate || date > c.lastOrderDate)) {
      c.lastOrderDate = date;
    }

    if (date) {
      const diff = (now - date) / 86400000;
      if (diff <=  90) c.orders90d++;
      if (diff <= 365) c.orders365d++;
    }
  });

  return out;
}

/********* BC_LINES (“Bókaðar sölureikningslínur”) *********/
function loadBCInvoiceLines_(PRODUCT_CATEGORY_MAP) {
  const cfg = loadConfig_();
  const svc = cfg.SHEETS.BC_LINES;
  const rows = loadSheetObjects_(svc.ID, svc.NAME);
  if (!rows || !rows.length) return {};

  const C = STORKAUP_SCHEMA.BC_LINES.COLUMNS;
  const out = {};

  rows.forEach(r => {
    const id = String(r[C.COMPANY_ID] || '').trim();
    if (!id) return;

    if (!out[id]) {
      out[id] = {
        totalQty:        0,
        skuTotals:       {},
        skuAmounts:      {},
        categoryAmounts: {}
      };
    }

    const c      = out[id];
    const sku    = String(r[C.SKU] || '').trim();
    const qty    = toNum_(r[C.QTY]);
    const amount = toNum_(r[C.AMOUNT_EXCL]);

    c.totalQty += qty;

    if (sku) {
      c.skuTotals[sku]  = (c.skuTotals[sku]  || 0) + qty;
      c.skuAmounts[sku] = (c.skuAmounts[sku] || 0) + amount;

      const baseSku = normalizeSkuGlobal_(sku);
      const cat = PRODUCT_CATEGORY_MAP[baseSku] || 'UNKNOWN';
      c.categoryAmounts[cat] = (c.categoryAmounts[cat] || 0) + amount;
    }
  });

  return out;
}

/********* NEWWEB (“NEWWEB” Magento lines) *********/
function loadNEWWEBLines_() {
  const cfg = loadConfig_();
  const svc = cfg.SHEETS.WEBSALES;           // service WEBSALES → {ID, NAME}
  const rows = loadSheetObjects_(svc.ID, svc.NAME);
  if (!rows || !rows.length) return {};

  const S = STORKAUP_SCHEMA.NEWWEB;
  const out = {};

  rows.forEach(r => {
    // Prefer "Company ID" but fall back to "National ID" if missing
    const rawId = r[S.COMPANY_ID] || r[S.NATIONAL_ID] || '';
    const id = String(rawId).trim();
    if (!id) return;

    if (!out[id]) {
      out[id] = {
        webSales:     0,
        webOrders:    0,
        webQty:       0,
        lastWebOrder: null,
        firstWebOrder: null,
        skuTotals:    {},
        primaryEmail: '',
        _orders:      new Set()
      };
    }

    const c      = out[id];
    const date   = parseDateSafe_(r[S.DATE]);
    const amount = toNum_(r[S.GRAND_TOTAL]);
    const qty    = toNum_(r[S.QTY]);
    const sku    = String(r[S.SKU] || '').trim();
    const orderId = r[S.ID] || (id + '_' + (date || new Date()).toISOString());

    c.webSales += amount;
    c.webQty   += qty;
    c._orders.add(orderId);

    if (date) {
      if (!c.lastWebOrder || date > c.lastWebOrder) {
        c.lastWebOrder = date;
      }
      if (!c.firstWebOrder || date < c.firstWebOrder) {
        c.firstWebOrder = date;
      }
    }

    if (sku) {
      c.skuTotals[sku] = (c.skuTotals[sku] || 0) + qty;
    }

    // Tökum real email ef til
    if (!c.primaryEmail && r[S.REAL_EMAIL]) {
      c.primaryEmail = r[S.REAL_EMAIL];
    }
  });

  // finalize order count
  Object.values(out).forEach(c => {
    c.webOrders = c._orders.size;
    delete c._orders;
  });

  return out;
}


/********* MAGENTO_CUSTOMERS → company_id / national_id → company name *********/
// Fallback name source for web customers absent from the (now frozen) BC master.
// Keyed by both the raw id and its digit-only form so it matches whatever
// customer_id shape the BC/web join produced.
function loadMagentoCompanyNameMap_() {
  const cfg = loadConfig_();
  const ssId = (cfg.SHEET_IDS && cfg.SHEET_IDS.CUSTOMERS)
    || (cfg.SHEETS && cfg.SHEETS.CUSTOMERS && cfg.SHEETS.CUSTOMERS.ID);
  if (!ssId) return {};

  const rows = loadSheetObjects_(ssId, 'MAGENTO_CUSTOMERS');
  if (!rows || !rows.length) return {};

  const map = {};
  rows.forEach(r => {
    const name = String(r['Company Name'] || r['Name'] || '').trim();
    if (!name) return;
    [r['Company ID'], r['National ID']].forEach(raw => {
      const v = String(raw || '').trim();
      if (!v) return;
      if (!map[v]) map[v] = name;
      const digits = v.replace(/\D/g, '');
      if (digits && !map[digits]) map[digits] = name;
    });
  });
  return map;
}


/************************************************************
 * 🧮 SCORING HELPERS
 ************************************************************/
function calcFrequencyScore_(totalOrders) {
  if (!totalOrders) return 0;
  if (totalOrders > 100) return 5;
  if (totalOrders > 50)  return 4;
  if (totalOrders > 20)  return 3;
  if (totalOrders > 5)   return 2;
  return 1;
}

function calcRecencyScore_(bcLast, webLast) {
  const dates = [];
  if (bcLast  instanceof Date) dates.push(bcLast);
  if (webLast instanceof Date) dates.push(webLast);
  if (!dates.length) return 0;

  dates.sort((a, b) => b - a);
  const last = dates[0];
  const days = (new Date() - last) / 86400000;

  if (days <=  30) return 5;
  if (days <=  90) return 4;
  if (days <= 180) return 3;
  if (days <= 365) return 2;
  return 1;
}

function calcValueScore_(totalValue) {
  if (!totalValue) return 0;
  if (totalValue > 50000000) return 5;
  if (totalValue > 20000000) return 4;
  if (totalValue >  5000000) return 3;
  if (totalValue >  1000000) return 2;
  return 1;
}

function calcProductFitScore_(bcLines) {
  if (!bcLines || !bcLines.skuTotals) return 0;
  const skuCount = Object.keys(bcLines.skuTotals).length;
  if (skuCount > 200) return 5;
  if (skuCount > 100) return 4;
  if (skuCount >  40) return 3;
  if (skuCount >  10) return 2;
  return 1;
}

function calcCategoryFitScore_(bcLines) {
  if (!bcLines || !bcLines.categoryAmounts) return 0;
  const used = Object.keys(bcLines.categoryAmounts).length;
  if (used >= 4) return 5;
  if (used === 3) return 4;
  if (used === 2) return 3;
  if (used === 1) return 2;
  return 1;
}

function calcReadinessScore_(recency, freq) {
  return Math.round((recency + freq) / 2);
}

function calcPotentialScore_(valueScore, categoryFitScore) {
  const vs = valueScore   || 0;
  const cf = categoryFitScore || 0;
  return vs * 10 + cf * 10;
}

function calcLowHangingFruitScore_(bcSalesIncl, webSales, webshopActive) {
  const offline = bcSalesIncl || 0;
  const online  = webSales    || 0;
  const gap     = offline - online;
  if (gap <= 0) return 0;

  let score = Math.round(gap / 1000000);
  if (!webshopActive) score *= 1.5;
  return score;
}

function suggestAction_(webshopActive, lhScore, readiness) {
  if (!webshopActive && lhScore > 5 && readiness >= 3)
    return 'Onboarda á vef — stórt tækifæri';

  if (webshopActive && lhScore > 3)
    return 'Auka web share — kynna sjálfsafgreiðslu';

  if (!webshopActive && readiness <= 2)
    return 'Viðhalda sambandi, ekki forgangsviðskiptavinur';

  return 'Standard eftirfylgni';
}


/************************************************************
 * 📊 CATEGORY MIX + TOP SKUs
 ************************************************************/
function calcCategoryPercentages_(bcLines) {
  const zero = {
    'Rekstrarvörur':   0,
    'Heilbrigðisvörur':0,
    'Matvörur':        0,
    'Vélar og tæki':   0,
    'Áfengi':          0
  };

  if (!bcLines || !bcLines.categoryAmounts) return zero;

  const sums = bcLines.categoryAmounts;
  let total = 0;
  Object.keys(sums).forEach(k => total += sums[k]);
  if (!total) return zero;

  const out = {};
  Object.keys(zero).forEach(k => {
    out[k] = (sums[k] || 0) / total;
  });
  return out;
}

function pickPrimaryCategory_(catPerc) {
  let best = '';
  let bestVal = -1;
  Object.keys(catPerc).forEach(k => {
    if (catPerc[k] > bestVal) {
      bestVal = catPerc[k];
      best = k;
    }
  });
  return best;
}

function topNSKUs_(skuTotals, n, productLookup) {
  if (!skuTotals) return '';
  const lookup = productLookup || {};
  const nameForSku = (sku) => {
    const norm = typeof normalizeSkuGlobal_ === 'function'
      ? normalizeSkuGlobal_(sku)
      : String(sku || '').trim();
    const hit = lookup[norm] || lookup[sku];
    return (hit && hit.name) || '';
  };

  const arr = Object.entries(skuTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([sku, qty]) => {
      const name = nameForSku(sku);
      return name ? `${sku} (${qty}) | ${name}` : `${sku} (${qty})`;
    });
  return arr.join(', ');
}


/************************************************************
 * 🧠 buildCustomerProfilesFromContext_(ctx)
 * - Tekur ctx.lines og býr til profíla per fyrirtæki
 ************************************************************/
function buildCustomerProfilesFromContext_(ctx) {
  const byCompany = {};

  ctx.lines.forEach(l => {
    const key =
      (l.companyId && l.companyId.trim()) ||
      (l.companyName && ('NAME:' + l.companyName.trim())) ||
      ('CUSTOMER:' + (l.customer || '').trim());

    if (!key) return;

    if (!byCompany[key]) {
      byCompany[key] = {
        companyKey: key,
        companyId:   l.companyId   || '',
        companyName: l.companyName || '',
        customerName: l.customer   || '',
        region:      l.region      || '',
      email:       l.realEmail   || '',
      totalRevenueIncl: 0,
      totalRevenueExcl: 0,
      totalQty: 0,
      orderDates: {}, // orderId -> Date
      firstPurchaseDate: null,
      lastPurchaseDate: null,
      categories: {}   // catKey -> { l1,l2,l3, qty, revenueIncl }
    };
    }

    const p = byCompany[key];

    p.totalRevenueIncl += l.rowIncl || 0;
    p.totalRevenueExcl += l.rowExcl || 0;
    p.totalQty         += l.qty || 0;
    if (l.orderId) {
      const oid = String(l.orderId);
      if (l.date instanceof Date) {
        const prev = p.orderDates[oid];
        if (!prev || l.date > prev) p.orderDates[oid] = l.date;
      } else if (!p.orderDates[oid]) {
        p.orderDates[oid] = null;
      }
    }

    if (l.date instanceof Date) {
      if (!p.lastPurchaseDate || l.date > p.lastPurchaseDate) {
        p.lastPurchaseDate = l.date;
      }
      if (!p.firstPurchaseDate || l.date < p.firstPurchaseDate) {
        p.firstPurchaseDate = l.date;
      }
    }

    const l1 = l.l1 || '';
    const l2 = l.l2 || '';
    const l3 = l.l3 || '';

    // Sleppum alveg kategoríu ef ekkert Level er fyllt
    const parts = [l1, l2, l3].filter(Boolean);
    if (!parts.length) return;

    const catKey = parts.join(' / ');

    if (!p.categories[catKey]) {
      p.categories[catKey] = {
        l1, l2, l3,
        qty: 0,
        revenueIncl: 0
      };
    }
    const c = p.categories[catKey];
    c.qty          += l.qty || 0;
    c.revenueIncl  += l.rowIncl || 0;
  });

  // breytum í array og bætum summary fields
  return Object.values(byCompany).map(p => {
    const now = new Date();
    const orderDates = Object.values(p.orderDates || {});
    const totalOrders = orderDates.length;
    let orders90d = 0;
    let orders365d = 0;
    orderDates.forEach(d => {
      if (!(d instanceof Date)) return;
      const diff = (now - d) / 86400000;
      if (diff <= 90) orders90d += 1;
      if (diff <= 365) orders365d += 1;
    });

    const cats = Object.values(p.categories);
    let topCat = '';
    let topRev = 0;
    cats.forEach(c => {
      if (c.revenueIncl > topRev) {
        topRev = c.revenueIncl;
        topCat = [c.l1, c.l2, c.l3].filter(Boolean).join(' / ');
      }
    });

    return {
      companyKey: p.companyKey,
      companyId:  p.companyId,
      companyName:p.companyName,
      customerName: p.customerName,
      region:     p.region,
      email:      p.email,
      totalRevenueIncl: p.totalRevenueIncl,
      totalRevenueExcl: p.totalRevenueExcl,
      totalQty:         p.totalQty,
      totalOrders:      totalOrders,
      orders90d:        orders90d,
      orders365d:       orders365d,
      firstPurchaseDate: p.firstPurchaseDate,
      lastPurchaseDate: p.lastPurchaseDate,
      categoryCount:    cats.length,
      topCategory:      topCat,
      categories:       p.categories    // geymum fyrir Category Fit v2
    };
  });
}

function buildCustomerProfiles_v7() {
  const cfg = loadConfig_();
  const ctx = buildOrderContext_(cfg); // same context og Sales Summaries

  // Enrich context lines with category levels for usable category stats
  const products = (typeof loadProductsLookup_ === 'function')
    ? (loadProductsLookup_(cfg) || {})
    : {};
  if (products && Object.keys(products).length) {
    ctx.lines.forEach(l => {
      if (l.l1 || l.l2 || l.l3) return;
      const skuNorm = l.skuNorm || (l.skuRaw ? normalizeSkuForStats_v6_(l.skuRaw) : null);
      if (!skuNorm) return;
      const prod = products[skuNorm] || {};
      if (prod.l1) l.l1 = prod.l1;
      if (prod.l2) l.l2 = prod.l2;
      if (prod.l3) l.l3 = prod.l3;
    });
  }

  const profiles = buildCustomerProfilesFromContext_(ctx);

  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sheetName = 'Web Customer Profiles';
  const legacyName = 'Customer Profiles v7';
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    const legacy = ss.getSheetByName(legacyName);
    if (legacy) {
      legacy.setName(sheetName);
      sh = legacy;
    } else {
      sh = ss.insertSheet(sheetName);
    }
  }
  sh.clear();

  const header = [
    'Company ID',
    'Company Name',
    'Customer Name',
    'Region',
    'Email',
    'Web Orders',
    'Web Revenue m/vsk',
    'Web Revenue án vsk',
    'Web AOV',
    'First Web Order',
    'Last Web Order',
    'Orders (last 90d)',
    'Orders (last 365d)',
    'Total Qty',
    'Category Count',
    'Top Category'
  ];

  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const body = profiles
    .sort((a, b) => b.totalRevenueIncl - a.totalRevenueIncl)
    .map(p => [
      p.companyId,
      p.companyName || p.companyKey,
      p.customerName,
      p.region,
      p.email,
      p.totalOrders,
      p.totalRevenueIncl,
      p.totalRevenueExcl,
      p.totalOrders ? (p.totalRevenueIncl / p.totalOrders) : 0,
      p.firstPurchaseDate
        ? Utilities.formatDate(p.firstPurchaseDate, 'GMT', 'yyyy-MM-dd')
        : '',
      p.lastPurchaseDate
        ? Utilities.formatDate(p.lastPurchaseDate, 'GMT', 'yyyy-MM-dd')
        : '',
      p.orders90d,
      p.orders365d,
      p.totalQty,
      p.categoryCount,
      p.topCategory
    ]);

  if (body.length) {
    sh.getRange(2, 1, body.length, header.length).setValues(body);
  }

  const rows = Math.max(1, body.length);
  sh.getRange(2, 6, rows, 1).setNumberFormat('0');          // orders
  sh.getRange(2, 7, rows, 2).setNumberFormat('"kr" #,##0'); // revenue
  sh.getRange(2, 9, rows, 1).setNumberFormat('"kr" #,##0'); // AOV
  sh.getRange(2, 12, rows, 2).setNumberFormat('0');         // orders 90d/365d
  sh.getRange(2, 14, rows, 1).setNumberFormat('0');         // qty

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`✅ buildCustomerProfiles_v7: ${body.length} companies.`);
}

/************************************************************
 * 🧮 buildCategoryFit_v2
 * - Ber saman category share hjá viðskiptavini vs global share
 * - FitScore ~ 100 = “eðlilegt”, >100 = yfir-index, <100 = undir
 ************************************************************/
function buildCategoryFit_v2() {
  const cfg = loadConfig_();
  const ctx = buildOrderContext_(cfg);         // v7.5 context + enrichment
  const profiles = buildCustomerProfilesFromContext_(ctx);

  // 🌍 Global category stats (úr öllum línum)
  const globalCat = {};
  let globalTotalRev = 0;

  ctx.lines.forEach(l => {
    const l1 = l.l1 || '';
    const l2 = l.l2 || '';
    const l3 = l.l3 || '';

    const parts = [l1, l2, l3].filter(Boolean);
    if (!parts.length) return;

    const catKey = parts.join(' / ');

    if (!globalCat[catKey]) {
      globalCat[catKey] = { l1, l2, l3, revenueIncl: 0 };
    }
    globalCat[catKey].revenueIncl += l.rowIncl || 0;
    globalTotalRev += l.rowIncl || 0;
  });

  // share per category global
  Object.values(globalCat).forEach(c => {
    c.globalShare = globalTotalRev
      ? c.revenueIncl / globalTotalRev
      : 0;
  });

  // 🔎 Build rows per company + category
  const rows = [];

  profiles.forEach(p => {
    const catEntries = Object.entries(p.categories || {});
    if (!catEntries.length || !p.totalRevenueIncl) return;

    catEntries.forEach(([catKey, c]) => {
      const global = globalCat[catKey];
      if (!global) return;

      const customerShare = c.revenueIncl / p.totalRevenueIncl; // 0-1
      const globalShare   = global.globalShare || 0;

      let fitScore = 0;
      if (globalShare > 0) {
        const ratio = customerShare / globalShare;
        // 100 = normal, 200 = mjög yfir-index, 0 = algjört undir
        fitScore = Math.max(0, Math.min(200, Math.round(ratio * 100)));
      }

      rows.push([
        p.companyId,
        p.companyName || p.companyKey,
        p.region,
        p.email,
        global.l1,
        global.l2,
        global.l3,
        c.revenueIncl,
        p.totalRevenueIncl,
        Math.round(customerShare * 100), // % hjá viðskiptavini
        Math.round(globalShare * 100),   // % global
        fitScore
      ]);
    });
  });

  // sortum þannig að “interesting” case komi efst: fitScore lágt eða hátt
  rows.sort((a, b) => a[11] - b[11]); // eftir FitScore (col 12)

  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sheetName = 'Category Fit v2';
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clear();

  const header = [
    'Company ID',
    'Company Name',
    'Region',
    'Email',
    'Level 1',
    'Level 2',
    'Level 3',
    'Cat Revenue m/vsk',
    'Total Revenue m/vsk',
    'Customer Cat %',
    'Global Cat %',
    'FitScore (0–200)'
  ];

  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }

  const r = Math.max(1, rows.length);
  sh.getRange(2, 8, r, 2).setNumberFormat('"kr" #,##0'); // revenues
  sh.getRange(2,10, r, 2).setNumberFormat('0"%"');       // percentages
  sh.getRange(2,12, r, 1).setNumberFormat('0');          // FitScore

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1,1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`✅ buildCategoryFit_v2: ${rows.length} company×category rows.`);
}


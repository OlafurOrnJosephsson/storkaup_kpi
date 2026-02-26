'use strict';

/***********************
 * Entry point - UNIVERSAL
 * Builds all sales summary tabs in the SALES_SUMMARIES spreadsheet.
 ***********************/
function buildAll_v6() {
  const start = new Date();
  Logger.log(`buildAll_v6() started at ${start.toISOString()}`);

  const cfg = loadConfig_();
  const ctx = buildOrderContext_(cfg);

  buildDaily_v6_(cfg, ctx);
  buildMonthly_v6_(cfg, ctx);
  buildWeekly_v6_(cfg, ctx);

  buildTopProductsAllTime_v6_(cfg, ctx);
  buildTopProducts_7d_(cfg, ctx);
  buildTopProducts_30d_(cfg, ctx);
  buildTopProducts_90d_(cfg, ctx);
  buildCategorySummary_v6_(cfg, ctx);
  buildUomAnalysis_v6_(cfg, ctx);
  buildSalesRepOnboarding_v1_(cfg);

  Logger.log('buildAll_v6() completed');
}

/************************************************************
 * SALES REPS (Onboarding) - Web orders by "Sölumaður" users
 ************************************************************/
function buildSalesRepOnboarding_v1_(cfg) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - Sales Reps', [
    'Sales - Sales Reps',
    'Sales - Salesmen'
  ]);
  sh.clear();

  const reps = loadTableBySchema_('CUSTOMERS') || [];
  const repAgg = {};
  const salesRepNameSet = {};

  reps.forEach(r => {
    if (!isSalesRepCustomer_(r)) return;
    const name = cleanString_(r.NAME || '');
    const key = normalizeNameAdvanced_(name);
    if (!key) return;
    salesRepNameSet[key] = true;

    if (!repAgg[key]) {
      repAgg[key] = {
        name,
        role: r.ROLE || '',
        email: r.REAL_EMAIL || r.EMAIL || '',
        orders: new Set(),
        revenue: 0,
        customers: new Set(),
        companyIds: new Set(),
        companyKeys: new Set(),
        firstDate: null,
        lastDate: null
      };
    } else {
      if (!repAgg[key].role) repAgg[key].role = r.ROLE || '';
      if (!repAgg[key].email) repAgg[key].email = r.REAL_EMAIL || r.EMAIL || '';
    }
  });

  const newRows = loadTableBySchema_('NEWWEB') || [];
  const companyOrders = {};
  const companyDetails = {};
  newRows.forEach(row => {
    const custName = cleanString_(row.CUSTOMER_NAME || '');
    if (!custName) return;
    const key = normalizeNameAdvanced_(custName);
    const agg = repAgg[key];

    const rawCompanyId = String(row.COMPANY_ID || row.NATIONAL_ID || '').trim();
    const companyName = cleanString_(row.COMPANY_NAME || row.CUSTOMER_NAME || '');
    const companyKey = rawCompanyId || normalizeNameAdvanced_(companyName);
    if (companyKey) {
      if (!companyOrders[companyKey]) companyOrders[companyKey] = { hasRep: false, hasNonRep: false };
      if (!companyDetails[companyKey]) {
        companyDetails[companyKey] = {
          companyId: rawCompanyId,
          companyName,
          reps: new Set(),
          orders: new Set(),
          revenueIncl: 0,
          firstDate: null,
          lastDate: null
        };
      }
    }

    const isRep = !!salesRepNameSet[key];
    if (companyKey) {
      if (isRep) companyOrders[companyKey].hasRep = true;
      else companyOrders[companyKey].hasNonRep = true;
    }

    if (companyKey) {
      const detail = companyDetails[companyKey];
      if (isRep) detail.reps.add(custName);
      if (row.ID) detail.orders.add(String(row.ID));
      detail.revenueIncl += toNum_(row.GRAND_TOTAL || row.SUBTOTAL_INCL);
      const d = parseDateSafe_(row.DATE);
      if (d) {
        if (!detail.firstDate || d < detail.firstDate) detail.firstDate = d;
        if (!detail.lastDate || d > detail.lastDate) detail.lastDate = d;
      }
    }

    if (!agg) return;

    if (row.ID) agg.orders.add(String(row.ID));
    agg.revenue += toNum_(row.GRAND_TOTAL || row.SUBTOTAL_INCL);

    const compName = cleanString_(row.COMPANY_NAME || '');
    if (compName) agg.customers.add(compName);
    const compId = String(row.COMPANY_ID || '').trim();
    if (compId) agg.companyIds.add(compId);
    if (companyKey) agg.companyKeys.add(companyKey);

    const d = parseDateSafe_(row.DATE);
    if (d) {
      if (!agg.firstDate || d < agg.firstDate) agg.firstDate = d;
      if (!agg.lastDate || d > agg.lastDate) agg.lastDate = d;
    }
  });

  const header = [
    'Sales Rep',
    'Role',
    'Email',
    'Orders',
    'Unique Customers',
    'Self-Serve Customers',
    'Self-Serve %',
    'Revenue Incl',
    'First Order',
    'Last Order',
    'Customers (Top 10)',
    'Company IDs (Top 10)'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const body = Object.values(repAgg)
    .map(a => {
      const customers = Array.from(a.customers);
      const companyIds = Array.from(a.companyIds);
      const topCustomers = customers.slice(0, 10).join(', ');
      const topCompanyIds = companyIds.slice(0, 10).join(', ');
      const repCustomerCount = a.companyKeys.size;
      let selfServeCount = 0;
      a.companyKeys.forEach(k => {
        if (companyOrders[k] && companyOrders[k].hasNonRep) selfServeCount += 1;
      });
      const selfServePct = repCustomerCount ? (selfServeCount / repCustomerCount) : 0;
      const first = a.firstDate ? formatDateYMD_(a.firstDate) : '';
      const last = a.lastDate ? formatDateYMD_(a.lastDate) : '';
      return [
        a.name || '',
        a.role || '',
        a.email || '',
        a.orders.size,
        customers.length,
        selfServeCount,
        selfServePct,
        a.revenue,
        first,
        last,
        topCustomers,
        topCompanyIds
      ];
    })
    .sort((a, b) => b[3] - a[3]);

  if (body.length) sh.getRange(2, 1, body.length, header.length).setValues(body);

  const rows = Math.max(1, body.length);
  sh.getRange(2, 4, rows, 3).setNumberFormat('0');
  sh.getRange(2, 7, rows, 1).setNumberFormat('0.0%');
  sh.getRange(2, 8, rows, 1).setNumberFormat('"kr" #,##0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Sales Rep onboarding report built (${body.length} reps).`);

  buildCustomerSelfServeReport_(ss, companyOrders, companyDetails);
}

// Public entry point to run only the sales rep onboarding report
function buildSalesRepOnboardingReport() {
  const cfg = loadConfig_();
  buildSalesRepOnboarding_v1_(cfg);
}

function isSalesRepCustomer_(row) {
  return looksLikeSalesRepLabel_(row.ROLE) || looksLikeSalesRepLabel_(row.NAME);
}

function looksLikeSalesRepLabel_(value) {
  const norm = normalizeNameAdvanced_(value || '');
  if (!norm) return false;
  if (norm.indexOf('veftest') !== -1 || norm.indexOf('test') !== -1) return false;
  return (
    norm.indexOf('solumadur') !== -1 ||
    norm.indexOf('salesman') !== -1 ||
    norm.indexOf('storkaup') !== -1
  );
}

function buildCustomerSelfServeReport_(ss, companyOrders, companyDetails) {
  const sh = getOrCreateSheet_(ss, 'Sales - Customers (Self-Serve)', [
    'Sales - Customers (Self-Serve)'
  ]);
  sh.clear();

  const header = [
    'Company ID',
    'Company Name',
    'Sales Reps',
    'Has Rep Orders',
    'Has Self-Serve Orders',
    'Self-Serve?',
    'Orders',
    'Revenue Incl',
    'First Order',
    'Last Order'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const rows = Object.keys(companyDetails)
    .map(key => {
      const detail = companyDetails[key];
      const flags = companyOrders[key] || { hasRep: false, hasNonRep: false };
      const hasSelfServe = flags.hasRep && flags.hasNonRep;
      const reps = Array.from(detail.reps).slice(0, 5).join(', ');
      const first = detail.firstDate ? formatDateYMD_(detail.firstDate) : '';
      const last = detail.lastDate ? formatDateYMD_(detail.lastDate) : '';
      return [
        detail.companyId || '',
        detail.companyName || '',
        reps,
        flags.hasRep ? 'Y' : '',
        flags.hasNonRep ? 'Y' : '',
        hasSelfServe ? 'Y' : '',
        detail.orders.size,
        detail.revenueIncl,
        first,
        last
      ];
    })
    .sort((a, b) => b[7] - a[7]);

  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  const r = Math.max(1, rows.length);
  sh.getRange(2, 7, r, 1).setNumberFormat('0');
  sh.getRange(2, 8, r, 1).setNumberFormat('"kr" #,##0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();
}

/************************************************************
 * Helper: get or create sheet by desired name, renaming aliases
 ************************************************************/
function getOrCreateSheet_(ss, desiredName, aliases) {
  const existing = ss.getSheetByName(desiredName);
  if (existing) return existing;
  for (const alias of (aliases || [])) {
    const sh = ss.getSheetByName(alias);
    if (sh) {
      sh.setName(desiredName);
      return sh;
    }
  }
  return ss.insertSheet(desiredName);
}

/************************************************************
 * Date helpers
 ************************************************************/
function parseOldwebDate_(raw) {
  if (raw instanceof Date) return raw;

  if (typeof raw === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + raw * 24 * 60 * 60 * 1000);
  }

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;

  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T00:00:00Z`);
}

/************************************************************
 * buildOrderContext_(cfg) - NEWWEB + OLDWEB
 * ctx.lines is used for daily/monthly totals, so OLDWEB rows must be split correctly.
 ************************************************************/
function buildOrderContext_(cfg) {
  const resolver = buildCompanyResolver_(cfg);
  const lines = [];
  const orders = [];

  // -----------------------
  // NEWWEB
  // -----------------------
  const newRows = loadTableBySchema_('NEWWEB') || [];
  newRows.forEach(row => {
    const rawCompanyId = row.COMPANY_ID || row.NATIONAL_ID || '';
    const comp = resolveCompanyInfo_(
      resolver,
      rawCompanyId,
      row.COMPANY_NAME,
      row.NATIONAL_ID || '',
      row.CUSTOMER_NAME
    );

    const companyId = String(comp.companyId || rawCompanyId || '').trim();
    const companyName = comp.companyName || row.COMPANY_NAME || row.CUSTOMER_NAME || '';
    const region = comp.region || row.REGION || '';
    const d = parseDateSafe_(row.DATE) || new Date(row.DATE);

    orders.push({
      source: 'NEWWEB',
      orderId: row.ID,
      date: d,
      customer: row.CUSTOMER_NAME,
      realEmail: row.REAL_EMAIL,
      companyId,
      companyName,
      region,
      subtotalExcl: toNum_(row.SUBTOTAL_EXCL),
      subtotalIncl: toNum_(row.SUBTOTAL_INCL),
      tax: toNum_(row.TAX)
    });

    const rawSkus = String(row.SKU || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!rawSkus.length) return;

    const normSkus = rawSkus.map(s => normalizeSkuGlobal_(s));
    const names = String(row.PRODUCT_NAME || '').split(',');

    const totalQty = Number(row.QTY || rawSkus.length) || rawSkus.length;
    const share = 1 / rawSkus.length;

    rawSkus.forEach((skuRaw, i) => {
      lines.push({
        source: 'NEWWEB',
        orderId: row.ID,
        date: d,
        customer: row.CUSTOMER_NAME,
        companyId,
        companyName,
        region,
        skuRaw,
        skuNorm: normSkus[i],
        name: (names[i] || '').trim(),
        qty: totalQty * share,
        rowExcl: toNum_(row.SUBTOTAL_EXCL) * share,
        rowIncl: toNum_(row.SUBTOTAL_INCL) * share,
        tax: toNum_(row.TAX) * share
      });
    });
  });

  // -----------------------
  // OLDWEB
  // -----------------------
  const oldRows = loadTableBySchema_('OLDWEB') || [];
  oldRows.forEach(row => {
    const comp = resolveCompanyInfo_(
      resolver,
      row.COMPANY_ID || '',
      row.COMPANY_NAME,
      row.CUSTOMER_GROUP,
      row.CUSTOMER_NAME,
      false // OLDWEB: prefer ID/name, no fuzzy
    );

    const subtotalExcl = toNum_(row.SUBTOTAL_EXCL);
    const subtotalIncl = toNum_(row.SUBTOTAL_INCL);
    const d = parseDateSafe_(row.DATE) || parseOldwebDate_(row.DATE) || new Date(row.DATE);

    orders.push({
      source: 'OLDWEB',
      orderId: row.ID,
      date: d,
      customer: row.CUSTOMER_NAME,
      customerEmail: row.CUSTOMER_EMAIL,
      companyId: comp.companyId,
      companyName: comp.companyName,
      region: comp.region,
      subtotalExcl,
      subtotalIncl,
      tax: 0
    });

    const items = String(row.ITEMS_BLOCK || '')
      .split(/\s*\|\s*/g)
      .map(s => s.trim())
      .filter(Boolean);

    const parsed = items
      .map(it => {
        // 9000874×3 — Coca Cola Zero... (allow × or x, and em/en dash or hyphen)
        const m = it.match(/^(\d+)[×x](\d+)\s*[—–-]\s*(.+)$/);
        return m ? { sku: m[1], qty: Number(m[2]), name: m[3] } : null;
      })
      .filter(Boolean);

    if (!parsed.length) return;

    const totalQty = parsed.reduce((sum, p) => sum + (p.qty || 0), 0) || 1;

    parsed.forEach(p => {
      const share = (p.qty || 0) / totalQty;
      lines.push({
        source: 'OLDWEB',
        orderId: row.ID,
        date: d,
        customer: row.CUSTOMER_NAME,
        companyId: comp.companyId,
        companyName: comp.companyName,
        region: comp.region,
        skuRaw: p.sku,
        skuNorm: normalizeSkuGlobal_(p.sku),
        name: p.name,
        qty: p.qty,
        rowExcl: subtotalExcl * share,
        rowIncl: subtotalIncl * share,
        tax: 0
      });
    });
  });

  Logger.log(`buildOrderContext_ complete: ${orders.length} orders, ${lines.length} lines`);
  return { orders, lines };
}

/************************************************************
 * BC monthly totals: sum "Upphæð með VSK" by "Pöntunardags."
 ************************************************************/
function normalizeHeaderKey_(s) {
  const str = String(s || '').trim().toLowerCase()
    // Icelandic chars need explicit transliteration before stripping non-ascii.
    .replace(/ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/ö/g, 'o');

  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}


function parseBcInvoiceDateFromRowByIndex_(row, iBookingDate, iOrderDate) {
  const bookingVal = iBookingDate >= 0 ? row[iBookingDate] : null;
  const orderVal = iOrderDate >= 0 ? row[iOrderDate] : null;
  return parseOldwebDate_(bookingVal) || new Date(bookingVal) || parseOldwebDate_(orderVal) || new Date(orderVal);
}

function parseBcInvoiceDateFromObject_(row) {
  return parseOldwebDate_(row.BOOKING_DATE) || new Date(row.BOOKING_DATE) || parseOldwebDate_(row.ORDER_DATE) || new Date(row.ORDER_DATE);
}

function loadBCMonthlyTotals_() {
  try {
    const full = loadTableBySchemaFull_('BC_INVOICES'); // {header, rows}
    const headerKeys = (full.header || []).map(normalizeHeaderKey_);

    const findCol = (cands) => {
      const targets = cands.map(normalizeHeaderKey_);
      for (let i = 0; i < headerKeys.length; i++) {
        const h = headerKeys[i];
        if (targets.some(t => h === t || h.includes(t))) return i;
      }
      return -1;
    };

    const iBookingDate = findCol(['bokunardags', 'bokunardag', 'posting date', 'booking date', 'booked date']);
    const iOrderDate = findCol(['pontunardags', 'pontunardag', 'order date', 'orderdate']);
    const inclKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.AMOUNT_INCL
      : '';
    let iIncl = findCol([inclKey, 'upphaed med vsk', 'amount including vat', 'amount incl', 'amountincl', 'medvsk', 'withvat', 'vsk']);
    if (iIncl < 0) {
      // Last-resort fallback for locale-specific headers where accented letters are dropped during normalization.
      for (let i = 0; i < headerKeys.length; i++) {
        const h = headerKeys[i];
        if (h.includes('vsk') && (h.includes('upph') || h.includes('amount'))) {
          iIncl = i;
          break;
        }
      }
    }

    const map = {};
    if ((iBookingDate < 0 && iOrderDate < 0) || iIncl < 0) {
      Logger.log('[BCMT] Missing columns: iBookingDate=' + iBookingDate + ' iOrderDate=' + iOrderDate + ' iIncl=' + iIncl);
      Logger.log('[BCMT] Header: ' + JSON.stringify(full.header || []));
      return map;
    }

    (full.rows || []).forEach(r => {
      const d = parseBcInvoiceDateFromRowByIndex_(r, iBookingDate, iOrderDate);
      if (!(d instanceof Date) || isNaN(d.getTime())) return;

      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      if (!map[key]) map[key] = 0;
      map[key] += toNum_(r[iIncl]);
    });

    return map;
  } catch (e) {
    Logger.log('loadBCMonthlyTotals_ failed: ' + e);
    return {};
  }
}

function loadBCMonthlyTotalsExcl_() {
  try {
    const full = loadTableBySchemaFull_('BC_INVOICES'); // {header, rows}
    const headerKeys = (full.header || []).map(normalizeHeaderKey_);

    const findCol = (cands, excludes) => {
      const targets = cands.map(normalizeHeaderKey_);
      const blocked = (excludes || []).map(normalizeHeaderKey_);
      for (let i = 0; i < headerKeys.length; i++) {
        const h = headerKeys[i];
        if (blocked.some(b => h.includes(b))) continue;
        if (targets.some(t => h === t || h.includes(t))) return i;
      }
      return -1;
    };

    const bookingDateKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.BOOKING_DATE
      : '';
    const orderDateKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.ORDER_DATE
      : '';
    const exclKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.AMOUNT_EXCL
      : '';
    const inclKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.AMOUNT_INCL
      : '';

    const iBookingDate = findCol([bookingDateKey, 'bokunardags', 'bokunardag', 'posting date', 'booking date', 'booked date']);
    const iOrderDate = findCol([orderDateKey, 'pontunardags', 'pontunardag', 'order date', 'orderdate']);
    const iExcl = findCol(
      [exclKey, 'upphaed', 'amount excl', 'amount excluding vat', 'amount excluding tax', 'amountexcl'],
      [inclKey, 'medvsk', 'incl', 'withvat']
    );

    const map = {};
    if ((iBookingDate < 0 && iOrderDate < 0) || iExcl < 0) {
      Logger.log('[BCMT-EXCL] Missing columns: iBookingDate=' + iBookingDate + ' iOrderDate=' + iOrderDate + ' iExcl=' + iExcl);
      Logger.log('[BCMT-EXCL] Header: ' + JSON.stringify(full.header || []));
      return map;
    }

    (full.rows || []).forEach(r => {
      const d = parseBcInvoiceDateFromRowByIndex_(r, iBookingDate, iOrderDate);
      if (!(d instanceof Date) || isNaN(d.getTime())) return;

      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      if (!map[key]) map[key] = 0;
      map[key] += toNum_(r[iExcl]);
    });

    return map;
  } catch (e) {
    Logger.log('loadBCMonthlyTotalsExcl_ failed: ' + e);
    return {};
  }
}

function loadBCMonthlyOrderCounts_() {
  try {
    const rows = loadTableBySchema_('BC_INVOICES') || [];
    const map = {};
    rows.forEach(r => {
      const d = parseBcInvoiceDateFromObject_(r);
      if (!(d instanceof Date) || isNaN(d.getTime())) return;

      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      if (!map[key]) map[key] = 0;
      map[key] += 1;
    });

    return map;
  } catch (e) {
    Logger.log('loadBCMonthlyOrderCounts_ failed: ' + e);
    return {};
  }
}

function loadBCMonthlyWebStats_() {
  try {
    const full = loadTableBySchemaFull_('BC_INVOICES'); // {header, rows}
    const headerKeys = (full.header || []).map(normalizeHeaderKey_);

    const findCol = (cands) => {
      const targets = cands.map(normalizeHeaderKey_);
      for (let i = 0; i < headerKeys.length; i++) {
        const h = headerKeys[i];
        if (targets.some(t => h === t || h.includes(t))) return i;
      }
      return -1;
    };

    const bookingDateKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.BOOKING_DATE
      : '';
    const orderDateKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.ORDER_DATE
      : '';
    const exclKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.AMOUNT_EXCL
      : '';

    const iBookingDate = findCol([bookingDateKey, 'bokunardags', 'bokunardag', 'posting date', 'booking date', 'booked date']);
    const iOrderDate = findCol([orderDateKey, 'pontunardags', 'pontunardag', 'order date', 'orderdate']);
    const iExcl = findCol([exclKey, 'upphaed', 'amount excl', 'amount excluding vat', 'amount excluding tax', 'amountexcl']);
    const spKey = STORKAUP_SCHEMA.BC_INVOICES && STORKAUP_SCHEMA.BC_INVOICES.COLUMNS
      ? STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.SALESPERSON_CODE
      : '';
    const iSalesperson = findCol([spKey, 'koti solumanns', 'solumanns', 'salesperson', 'sales person', 'salesperson code', 'salespersoncode']);
    const iWebFlag = findCol(['weborder', 'web order', 'web_order', 'vefpontun', 'vefpontun?', 'webshop', 'netverslun', 'isweb']);

    const webCodes = ['VEFUR'];
    const orderMap = {};
    const revMap = {};

    if ((iBookingDate < 0 && iOrderDate < 0) || iExcl < 0) {
      Logger.log('[BC-WEB] Missing columns: iBookingDate=' + iBookingDate + ' iOrderDate=' + iOrderDate + ' iExcl=' + iExcl);
      Logger.log('[BC-WEB] Header: ' + JSON.stringify(full.header || []));
      return { orders: orderMap, revenueExcl: revMap };
    }

    (full.rows || []).forEach(r => {
      const d = parseBcInvoiceDateFromRowByIndex_(r, iBookingDate, iOrderDate);
      if (!(d instanceof Date) || isNaN(d.getTime())) return;

      let isWeb = false;
      if (iWebFlag >= 0) {
        isWeb = isWebFlagTruthy_(r[iWebFlag]);
      } else if (iSalesperson >= 0) {
        const code = String(r[iSalesperson] || '').trim().toUpperCase();
        isWeb = webCodes.indexOf(code) !== -1;
      }
      if (!isWeb) return;

      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      if (!orderMap[key]) orderMap[key] = 0;
      if (!revMap[key]) revMap[key] = 0;
      orderMap[key] += 1;
      revMap[key] += toNum_(r[iExcl]);
    });

    return { orders: orderMap, revenueExcl: revMap };
  } catch (e) {
    Logger.log('loadBCMonthlyWebStats_ failed: ' + e);
    return { orders: {}, revenueExcl: {} };
  }
}
function isWebFlagTruthy_(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return false;
  return s === '1' || s === 'y' || s === 'yes' || s === 'true' || s === 't';
}

/************************************************************
 * DAILY (v6)
 ************************************************************/
function buildDaily_v6_(cfg, ctx) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - Daily', ['Sales — Daily', 'Sales – Daily']);
  sh.clear();

  const header = ['Date', 'Total Qty', 'Total Revenue Incl', 'Total Revenue Excl', 'Orders'];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const daily = {};
  ctx.lines.forEach(l => {
    const d = l.date instanceof Date ? l.date : (parseOldwebDate_(l.date) || new Date(l.date));
    if (!(d instanceof Date) || isNaN(d.getTime())) return;

    const dayKey = Utilities.formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), 'GMT', 'yyyy-MM-dd');
    if (!daily[dayKey]) daily[dayKey] = { date: dayKey, qty: 0, incl: 0, excl: 0, orders: new Set() };

    const bucket = daily[dayKey];
    bucket.qty += l.qty || 0;
    bucket.incl += l.rowIncl || 0;
    bucket.excl += l.rowExcl || 0;
    if (l.orderId) bucket.orders.add(l.orderId);
  });

  const body = Object.values(daily)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(b => [b.date, Math.round(b.qty), b.incl, b.excl, b.orders.size]);

  if (body.length) sh.getRange(2, 1, body.length, header.length).setValues(body);

  const rows = Math.max(1, body.length);
  sh.getRange(2, 2, rows, 1).setNumberFormat('0');
  sh.getRange(2, 3, rows, 2).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 5, rows, 1).setNumberFormat('0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Daily v6 built (${body.length} days).`);
}

/************************************************************
 * WEEKLY (v6)
 ************************************************************/
function buildWeekly_v6_(cfg, ctx) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - Weekly', ['Sales ƒ?" Weekly', 'Sales ƒ?" Weekly']);
  sh.clear();

  const products = loadProductsLookup_(cfg) || {};
  const weeks = {};

  const toUtcDateOnly = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const weekKey = (d) => {
    const dateOnly = toUtcDateOnly(d);
    const day = dateOnly.getUTCDay(); // 0 = Sun, 1 = Mon
    const diffToMonday = (day + 6) % 7; // Monday = 0, Sunday = 6
    const start = new Date(dateOnly);
    start.setUTCDate(start.getUTCDate() - diffToMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return {
      key: Utilities.formatDate(start, 'GMT', 'yyyy-MM-dd'),
      start,
      end
    };
  };

  ctx.lines.forEach(l => {
    const d = l.date instanceof Date ? l.date : (parseOldwebDate_(l.date) || new Date(l.date));
    if (!(d instanceof Date) || isNaN(d.getTime())) return;

    const wk = weekKey(d);
    if (!weeks[wk.key]) {
      weeks[wk.key] = {
        start: wk.start,
        end: wk.end,
        qty: 0,
        incl: 0,
        excl: 0,
        orders: new Set(),
        skus: {},
        customers: {}
      };
    }

    const bucket = weeks[wk.key];
    bucket.qty += l.qty || 0;
    bucket.incl += l.rowIncl || 0;
    bucket.excl += l.rowExcl || 0;
    if (l.orderId) bucket.orders.add(l.orderId);

    const skuKey = l.skuNorm || (l.sku ? normalizeSkuForStats_v6_(l.sku) : '') || l.skuRaw || 'UNKNOWN';
    if (!bucket.skus[skuKey]) bucket.skus[skuKey] = { sku: skuKey, name: '', qty: 0 };
    bucket.skus[skuKey].qty += l.qty || 0;
    if (!bucket.skus[skuKey].name) {
      const master = products[skuKey];
      bucket.skus[skuKey].name = (l.name || (master && master.name) || '').trim();
    }

    const custName = (l.customer || l.companyName || '').trim() || 'Unknown';
    if (!bucket.customers[custName]) bucket.customers[custName] = { name: custName, revenue: 0 };
    bucket.customers[custName].revenue += l.rowIncl || 0;
  });

  const formatCurrency = (n) => `kr ${Math.round(n || 0).toLocaleString('is-IS')}`;

  const rows = Object.values(weeks)
    .sort((a, b) => b.start - a.start)
    .map(w => {
      const topSkus = Object.values(w.skus)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5)
        .map(s => {
          const namePart = s.name ? ` - ${s.name}` : '';
          return `${s.sku}${namePart} (${Math.round(s.qty)})`;
        })
        .join(', ');

      const topCustomers = Object.values(w.customers)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)
        .map(c => `${c.name} (${formatCurrency(c.revenue)})`)
        .join(', ');

      return [
        Utilities.formatDate(w.start, 'GMT', 'yyyy-MM-dd'),
        Utilities.formatDate(w.end, 'GMT', 'yyyy-MM-dd'),
        Math.round(w.qty),
        w.incl,
        w.excl,
        w.orders.size,
        topSkus,
        topCustomers
      ];
    });

  const header = [
    'Week Start',
    'Week End',
    'Total Qty',
    'Total Revenue Incl',
    'Total Revenue Excl',
    'Orders',
    'Top 5 SKUs',
    'Top 5 Customers'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  const r = Math.max(1, rows.length);
  sh.getRange(2, 3, r, 1).setNumberFormat('0');
  sh.getRange(2, 4, r, 2).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 6, r, 1).setNumberFormat('0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Weekly v6 built (${rows.length} weeks).`);
}

/************************************************************
 * MONTHLY (v6) + BC revenue + Web share
 ************************************************************/
function buildMonthly_v6_(cfg, ctx) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - Monthly', ['Sales — Monthly', 'Sales – Monthly']);
  sh.clear();

  const header = [
    'Month',
    'Total Qty',
    'Total Revenue Incl',
    'Total Revenue Excl',
    'Orders',
    'BC Revenue Incl',
    'BC Revenue Excl',
    'BC Orders',
    'Web Orders % of BC',
    'Web % of BC',
    'Sales Rep % of Web',
    'Self-Serve % of Rep Customers',
    'AOV (Incl)',
    'AOV (Excl)',
    'BC AOV (Excl)',
    'AOV Balance % (Web)',
    'AOV Balance % (BC)',
    'New Web Customers',
    'New Web Customers % of Web Orders',
    'YoY % (Web Incl)',
    'YoY % (Orders)'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const bcMonthly = loadBCMonthlyTotals_();
  const bcMonthlyExcl = loadBCMonthlyTotalsExcl_();
  const bcOrdersMonthly = loadBCMonthlyOrderCounts_();
  const bcWeb = loadBCMonthlyWebStats_();
  const monthly = {};
  const salesRepKeys = buildSalesRepNameSet_();
  const repMonthly = {};
  const selfServeMonthly = {};
  const firstNewwebByBuyer = {};

  ctx.lines.forEach(l => {
    const d = l.date instanceof Date ? l.date : (parseOldwebDate_(l.date) || new Date(l.date));
    if (!(d instanceof Date) || isNaN(d.getTime())) return;

    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthly[key]) monthly[key] = { month: key, qty: 0, incl: 0, excl: 0, orders: new Set() };

    const bucket = monthly[key];
    bucket.qty += l.qty || 0;
    bucket.incl += l.rowIncl || 0;
    bucket.excl += l.rowExcl || 0;
    if (l.orderId) bucket.orders.add(l.orderId);
  });

  ctx.orders.forEach(o => {
    const d = o.date instanceof Date ? o.date : (parseOldwebDate_(o.date) || new Date(o.date));
    if (!(d instanceof Date) || isNaN(d.getTime())) return;

    // First-time web buyers are based on the first observed NEWWEB order per unique buyer key.
    if (o.source === 'NEWWEB') {
      const buyerKey = getWebBuyerKey_(o);
      if (buyerKey) {
        if (!firstNewwebByBuyer[buyerKey] || d < firstNewwebByBuyer[buyerKey]) {
          firstNewwebByBuyer[buyerKey] = d;
        }
      }
    }

    const custName = cleanString_(o.customer || '');
    const key = normalizeNameAdvanced_(custName);
    if (!key || !salesRepKeys[key]) return;

    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!repMonthly[monthKey]) repMonthly[monthKey] = { incl: 0, orders: new Set() };

    const bucket = repMonthly[monthKey];
    bucket.incl += toNum_(o.subtotalIncl);
    if (o.orderId) bucket.orders.add(o.orderId);
  });

  ctx.orders.forEach(o => {
    const d = o.date instanceof Date ? o.date : (parseOldwebDate_(o.date) || new Date(o.date));
    if (!(d instanceof Date) || isNaN(d.getTime())) return;

    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!selfServeMonthly[monthKey]) {
      selfServeMonthly[monthKey] = { repCompanies: new Set(), nonRepCompanies: new Set() };
    }

    const custName = cleanString_(o.customer || '');
    const nameKey = normalizeNameAdvanced_(custName);
    const isRep = !!(nameKey && salesRepKeys[nameKey]);

    const companyId = String(o.companyId || '').trim();
    const companyName = cleanString_(o.companyName || o.customer || '');
    const companyKey = companyId || normalizeNameAdvanced_(companyName);
    if (!companyKey) return;

    const bucket = selfServeMonthly[monthKey];
    if (isRep) bucket.repCompanies.add(companyKey);
    else bucket.nonRepCompanies.add(companyKey);
  });

  const newWebCustomersByMonth = {};
  Object.keys(firstNewwebByBuyer).forEach(buyerKey => {
    const firstNew = firstNewwebByBuyer[buyerKey];
    if (!firstNew) return;

    const monthKey = `${firstNew.getUTCFullYear()}-${String(firstNew.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!newWebCustomersByMonth[monthKey]) newWebCustomersByMonth[monthKey] = 0;
    newWebCustomersByMonth[monthKey] += 1;
  });

  const body = Object.values(monthly)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map(b => {
      const bc = bcMonthly[b.month] || 0;
      const bcExcl = bcMonthlyExcl[b.month] || 0;
      const bcOrders = bcOrdersMonthly[b.month] || 0;
      const bcWebExcl = bcWeb && bcWeb.revenueExcl ? (bcWeb.revenueExcl[b.month] || 0) : 0;
      const bcWebOrders = bcWeb && bcWeb.orders ? (bcWeb.orders[b.month] || 0) : 0;
      const orders = b.orders.size;
      const webPct = bcExcl > 0 ? (bcWebExcl / bcExcl) : 0;
      const webOrdersPct = bcOrders > 0 ? (bcWebOrders / bcOrders) : 0;
      const aov = orders ? b.incl / orders : 0;
      const aovExcl = orders ? b.excl / orders : 0;
      const bcAovExcl = bcOrders ? bcExcl / bcOrders : 0;
      const aovBalanceTotal = aovExcl + bcAovExcl;
      const aovWebPct = aovBalanceTotal > 0 ? (aovExcl / aovBalanceTotal) : 0;
      const aovBcPct = aovBalanceTotal > 0 ? (bcAovExcl / aovBalanceTotal) : 0;
      const newWebCustomers = newWebCustomersByMonth[b.month] || 0;
      const newWebCustomersPct = orders ? (newWebCustomers / orders) : 0;
      const lastYearKey = `${Number(b.month.slice(0, 4)) - 1}-${b.month.slice(5)}`;
      const lastYear = monthly[lastYearKey];
      const yoy = lastYear && lastYear.incl ? (b.incl / lastYear.incl) : 0;
      const yoyOrders = lastYear && lastYear.orders && lastYear.orders.size
        ? (orders / lastYear.orders.size)
        : 0;
      const rep = repMonthly[b.month];
      const repPct = rep && b.incl ? rep.incl / b.incl : 0;
      const ss = selfServeMonthly[b.month];
      const repCompanies = ss ? ss.repCompanies.size : 0;
      let selfServeCount = 0;
      if (ss) {
        ss.repCompanies.forEach(c => {
          if (ss.nonRepCompanies.has(c)) selfServeCount += 1;
        });
      }
      const selfServePct = repCompanies ? (selfServeCount / repCompanies) : 0;
      return [
        b.month,
        Math.round(b.qty),
        b.incl,
        b.excl,
        orders,
        bc,
        bcExcl,
        bcOrders,
        webOrdersPct,
        webPct,
        repPct,
        selfServePct,
        aov,
        aovExcl,
        bcAovExcl,
        aovWebPct,
        aovBcPct,
        newWebCustomers,
        newWebCustomersPct,
        yoy,
        yoyOrders
      ];
    });

  if (body.length) sh.getRange(2, 1, body.length, header.length).setValues(body);

  const rows = Math.max(1, body.length);
  sh.getRange(2, 1, rows, 1).setNumberFormat('@');
  sh.getRange(2, 2, rows, 1).setNumberFormat('0');
  sh.getRange(2, 3, rows, 2).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 5, rows, 1).setNumberFormat('0');
  sh.getRange(2, 6, rows, 1).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 7, rows, 1).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 8, rows, 1).setNumberFormat('0');
  sh.getRange(2, 9, rows, 1).setNumberFormat('0.0%');
  sh.getRange(2, 10, rows, 1).setNumberFormat('0.0%');
  sh.getRange(2, 11, rows, 1).setNumberFormat('0.0%');
  sh.getRange(2, 12, rows, 1).setNumberFormat('0.0%');
  sh.getRange(2, 13, rows, 1).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 14, rows, 1).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 15, rows, 1).setNumberFormat('"kr" #,##0');
  sh.getRange(2, 16, rows, 2).setNumberFormat('0.0%');
  sh.getRange(2, 18, rows, 1).setNumberFormat('0');
  sh.getRange(2, 19, rows, 1).setNumberFormat('0.0%');
  sh.getRange(2, 20, rows, 2).setNumberFormat('0.0%');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Monthly v6 built (${body.length} months).`);
}

function getWebBuyerKey_(o) {
  const companyId = String(o.companyId || '').trim();
  if (companyId) return 'cid:' + companyId;

  const realEmail = String(o.realEmail || o.customerEmail || '').toLowerCase().trim();
  if (realEmail) return 'email:' + realEmail;

  const companyNameKey = normalizeNameAdvanced_(cleanString_(o.companyName || ''));
  if (companyNameKey) return 'cname:' + companyNameKey;

  const customerKey = normalizeNameAdvanced_(cleanString_(o.customer || ''));
  if (customerKey) return 'cust:' + customerKey;

  return '';
}

// Public entry point to run only the monthly report
function buildMonthlyReport() {
  const cfg = loadConfig_();
  const ctx = buildOrderContext_(cfg);
  buildMonthly_v6_(cfg, ctx);
}

// Public entry point to run only the daily report
function buildDailyReport() {
  const cfg = loadConfig_();
  const ctx = buildOrderContext_(cfg);
  buildDaily_v6_(cfg, ctx);
}

// Public entry point to run only the weekly report
function buildWeeklyReport() {
  const cfg = loadConfig_();
  const ctx = buildOrderContext_(cfg);
  buildWeekly_v6_(cfg, ctx);
}

function buildSalesRepNameSet_() {
  const reps = loadTableBySchema_('CUSTOMERS') || [];
  const set = {};

  reps.forEach(r => {
    if (!isSalesRepCustomer_(r)) return;
    const name = cleanString_(r.NAME || '');
    const key = normalizeNameAdvanced_(name);
    if (key) set[key] = true;
  });

  return set;
}

/************************************************************
 * TOP PRODUCTS (All Time)
 ************************************************************/
function buildTopProductsAllTime_v6_(cfg, ctx) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - Top Products (All Time)', [
    'Sales — Top Products (All Time)',
    'Sales – Top Products (All Time)'
  ]);
  sh.clear();

  const products = loadProductsLookup_(cfg) || {};
  const bySku = {};

  ctx.lines.forEach(l => {
    const skuNorm = l.skuNorm || (l.sku ? normalizeSkuForStats_v6_(l.sku) : null);
    if (!skuNorm) return;

    if (!bySku[skuNorm]) {
      bySku[skuNorm] = {
        sku: skuNorm,
        qty: 0,
        revIncl: 0,
        revExcl: 0,
        orders: new Set(),
        names: new Set(),
        lastPurchased: null
      };
    }

    const b = bySku[skuNorm];
    b.qty += l.qty || 0;
    b.revIncl += l.rowIncl || 0;
    b.revExcl += l.rowExcl || 0;
    if (l.orderId) b.orders.add(l.orderId);
    if (l.name) b.names.add(l.name);

    if (l.date instanceof Date) {
      if (!b.lastPurchased || l.date > b.lastPurchased) b.lastPurchased = l.date;
    }
  });

  const header = [
    'SKU',
    'Product Name',
    'Level 1',
    'Level 2',
    'Level 3',
    'Category Path',
    'Product URL',
    'Qty (All Time)',
    'Orders',
    'Revenue Incl',
    'Revenue Excl',
    'Last Purchased'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const body = Object.keys(bySku)
    .map(sku => {
      const b = bySku[sku];
      const master = products[sku] || {};
      const fallbackName = Array.from(b.names).filter(Boolean)[0] || '';
      const name = master.name || fallbackName;

      return [
        sku,
        name,
        master.l1 || '',
        master.l2 || '',
        master.l3 || '',
        master.catPath || '',
        master.url || '',
        Math.round(b.qty),
        b.orders.size,
        b.revIncl,
        b.revExcl,
        b.lastPurchased ? Utilities.formatDate(b.lastPurchased, 'GMT', 'yyyy-MM-dd') : ''
      ];
    })
    .sort((a, b) => b[7] - a[7]);

  if (body.length) {
    sh.getRange(1, 1, 50000, 1).setNumberFormat('@');
    sh.getRange(2, 1, body.length, header.length).setValues(body);
  }

  const rows = Math.max(1, body.length);
  sh.getRange(2, 1, rows, 1).setNumberFormat('@');
  sh.getRange(2, 8, rows, 2).setNumberFormat('0');
  sh.getRange(2, 10, rows, 2).setNumberFormat('"kr" #,##0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Top Products All Time built (${body.length} SKUs).`);
}

function buildTopProductsPeriod_(cfg, ctx, days, sheetName) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, sheetName, [
    sheetName.replace(' - ', ' — '),
    sheetName.replace(' - ', ' – ')
  ]);
  sh.clear();

  const products = loadProductsLookup_(cfg) || {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const bySku = {};
  ctx.lines.forEach(l => {
    if (!(l.date instanceof Date)) return;
    if (l.date < cutoff) return;

    const skuNorm = l.skuNorm || (l.sku ? normalizeSkuForStats_v6_(l.sku) : null);
    if (!skuNorm) return;

    if (!bySku[skuNorm]) {
      bySku[skuNorm] = {
        sku: skuNorm,
        qty: 0,
        revIncl: 0,
        revExcl: 0,
        orders: new Set(),
        names: new Set(),
        lastPurchased: null
      };
    }

    const b = bySku[skuNorm];
    b.qty += l.qty || 0;
    b.revIncl += l.rowIncl || 0;
    b.revExcl += l.rowExcl || 0;
    if (l.orderId) b.orders.add(l.orderId);
    if (l.name) b.names.add(l.name);
    if (!b.lastPurchased || l.date > b.lastPurchased) b.lastPurchased = l.date;
  });

  const header = [
    'SKU',
    'Product Name',
    'Level 1',
    'Level 2',
    'Level 3',
    'Category Path',
    'Product URL',
    `Qty (${days}d)`,
    'Orders',
    'Revenue Incl',
    'Revenue Excl',
    'Last Purchased'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const body = Object.keys(bySku)
    .map(sku => {
      const b = bySku[sku];
      const master = products[sku] || {};
      const fallbackName = Array.from(b.names).filter(Boolean)[0] || '';
      const name = master.name || fallbackName;
      return [
        sku,
        name,
        master.l1 || '',
        master.l2 || '',
        master.l3 || '',
        master.catPath || '',
        master.url || '',
        Math.round(b.qty),
        b.orders.size,
        b.revIncl,
        b.revExcl,
        b.lastPurchased ? Utilities.formatDate(b.lastPurchased, 'GMT', 'yyyy-MM-dd') : ''
      ];
    })
    .sort((a, b) => b[7] - a[7]);

  if (body.length) {
    sh.getRange(1, 1, 50000, 1).setNumberFormat('@');
    sh.getRange(2, 1, body.length, header.length).setValues(body);
  }

  const rows = Math.max(1, body.length);
  sh.getRange(2, 1, rows, 1).setNumberFormat('@');
  sh.getRange(2, 8, rows, 2).setNumberFormat('0');
  sh.getRange(2, 10, rows, 2).setNumberFormat('"kr" #,##0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Top Products (${days}d) built (${body.length} SKUs).`);
}

function buildTopProducts_7d_(cfg, ctx) { buildTopProductsPeriod_(cfg, ctx, 7, 'Sales - Top Products (7d)'); }
function buildTopProducts_30d_(cfg, ctx) { buildTopProductsPeriod_(cfg, ctx, 30, 'Sales - Top Products (30d)'); }
function buildTopProducts_90d_(cfg, ctx) { buildTopProductsPeriod_(cfg, ctx, 90, 'Sales - Top Products (90d)'); }

/************************************************************
 * CATEGORY SUMMARY - All Time
 ************************************************************/
function buildCategorySummary_v6_(cfg, ctx) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - Category (All Time)', [
    'Sales — Category (All Time)',
    'Sales – Category (All Time)'
  ]);
  sh.clear();

  const products = loadProductsLookup_(cfg) || {};
  const byCat = {}; // key = L1||L2||L3

  ctx.lines.forEach(l => {
    const skuNorm = l.skuNorm || (l.sku ? normalizeSkuForStats_v6_(l.sku) : null);
    if (!skuNorm) return;

    const prod = products[skuNorm] || {};
    const l1 = prod.l1 || '';
    const l2 = prod.l2 || '';
    const l3 = prod.l3 || '';
    const path = prod.catPath || '';
    const key = [l1, l2, l3].join('||');

    if (!byCat[key]) {
      byCat[key] = {
        l1,
        l2,
        l3,
        path,
        qty: 0,
        revenueIncl: 0,
        revenueExcl: 0,
        orders: new Set(),
        skuQty: {}
      };
    }

    const c = byCat[key];
    c.qty += l.qty || 0;
    c.revenueIncl += l.rowIncl || 0;
    c.revenueExcl += l.rowExcl || 0;
    if (l.orderId) c.orders.add(l.orderId);

    if (!c.skuQty[skuNorm]) c.skuQty[skuNorm] = 0;
    c.skuQty[skuNorm] += l.qty || 0;
  });

  const rows = Object.keys(byCat)
    .map(key => {
      const c = byCat[key];
      let topSku = '';
      let topQty = 0;
      Object.keys(c.skuQty).forEach(sku => {
        if (c.skuQty[sku] > topQty) {
          topQty = c.skuQty[sku];
          topSku = sku;
        }
      });

      return [
        c.l1,
        c.l2,
        c.l3,
        c.path,
        Math.round(c.qty),
        c.orders.size,
        c.revenueIncl,
        c.revenueExcl,
        Object.keys(c.skuQty).length,
        topSku,
        Math.round(topQty)
      ];
    })
    .sort((a, b) => b[6] - a[6]);

  const header = [
    'Level 1',
    'Level 2',
    'Level 3',
    'Category Path',
    'Total Qty',
    'Orders',
    'Revenue Incl',
    'Revenue Excl',
    'Unique SKUs',
    'Top SKU',
    'Top SKU Qty'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  const r = Math.max(1, rows.length);
  sh.getRange(2, 5, r, 2).setNumberFormat('0');
  sh.getRange(2, 7, r, 2).setNumberFormat('"kr" #,##0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`Category Summary built (${rows.length} categories).`);
}

/************************************************************
 * UOM ANALYSIS - Multi-UOM products (NEWWEB only)
 ************************************************************/
function buildUomAnalysis_v7_(cfg, ctx) {
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = getOrCreateSheet_(ss, 'Sales - UOM Analysis', ['Sales — UOM Analysis', 'Sales – UOM Analysis']);
  sh.clear();

  const products = loadProductsLookup_(cfg) || {};
  const map = {}; // baseSku -> { productName, variants: {UOM:{...}} }

  ctx.lines.forEach(l => {
    if (l.source !== 'NEWWEB') return;

    const rawSku = l.skuRaw || l.sku || '';
    if (!rawSku) return;

    const base = extractBaseSku_(rawSku);
    const uom = extractUom_(rawSku);
    if (!base) return;

    if (!map[base]) {
      map[base] = { baseSku: base, productName: '', variants: {} };
    }
    if (!map[base].variants[uom]) {
      map[base].variants[uom] = { qty: 0, revIncl: 0, revExcl: 0, orders: new Set(), lastDate: null, lastCustomer: '' };
    }

    const v = map[base].variants[uom];
    v.qty += l.qty || 0;
    v.revIncl += l.rowIncl || 0;
    v.revExcl += l.rowExcl || 0;
    if (l.orderId) v.orders.add(l.orderId);

    if (l.date instanceof Date) {
      if (!v.lastDate || l.date > v.lastDate) {
        v.lastDate = l.date;
        v.lastCustomer = l.customer || '';
      }
    }

    if (!map[base].productName) {
      const prod = products[l.skuNorm] || products[normalizeSkuForStats_v6_(base)];
      if (prod && prod.name) map[base].productName = prod.name;
    }
  });

  const rows = [];
  Object.keys(map).forEach(base => {
    const item = map[base];
    const variants = item.variants;

    const realUoms = Object.keys(variants).filter(u => u !== 'UNKNOWN');
    if (realUoms.length <= 1) return;

    realUoms.forEach(uom => {
      const v = variants[uom];
      rows.push([
        base,
        item.productName || '',
        uom,
        Math.round(v.qty),
        v.orders.size,
        v.revIncl,
        v.revExcl,
        realUoms.length,
        realUoms.join(', '),
        v.lastDate ? Utilities.formatDate(v.lastDate, 'GMT', 'yyyy-MM-dd') : '',
        v.lastCustomer || ''
      ]);
    });
  });

  rows.sort((a, b) => b[5] - a[5]);

  const header = [
    'Base SKU',
    'Product Name',
    'UOM',
    'Qty',
    'Orders',
    'Revenue Incl',
    'Revenue Excl',
    'UOM Count',
    'All UOMs',
    'Last Purchased',
    'Last Customer'
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  const r = Math.max(1, rows.length);
  sh.getRange(1, 1, 50000, 1).setNumberFormat('@');
  sh.getRange(2, 4, r, 2).setNumberFormat('0');
  sh.getRange(2, 6, r, 2).setNumberFormat('"kr" #,##0');

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, header.length);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(2, sh.getLastRow()), header.length).createFilter();

  Logger.log(`UOM Analysis built (${rows.length} rows).`);
}

function buildUomAnalysis_v6_(cfg, ctx) {
  return buildUomAnalysis_v7_(cfg, ctx);
}

function extractBaseSku_(raw) {
  if (!raw) return '';
  return String(raw).split('_')[0] || String(raw);
}

function extractUom_(raw) {
  if (!raw) return 'UNKNOWN';
  const parts = String(raw).split('_');
  return parts[1] ? parts[1].toUpperCase() : 'STK';
}

function normalizeSkuForStats_v6_(sku) {
  if (typeof normalizeSkuGlobal_ === 'function') return normalizeSkuGlobal_(sku);
  const s = String(sku || '').trim().replace(/_[A-Za-z0-9]+$/i, '');
  const m = s.match(/^(\d+)/);
  return m ? m[1] : s;
}

/************************************************************
 * PRODUCTS lookup - external PRODUCTS master sheet
 * Returns: { skuNorm: { name, url, catPath, l1, l2, l3 } }
 ************************************************************/
function loadProductsLookup_(cfg) {
  try {
    if (!cfg.SHEETS || !cfg.SHEETS.PRODUCTS) return {};
    const { ID, NAME } = cfg.SHEETS.PRODUCTS;
    const ss = SpreadsheetApp.openById(ID);
    const sh = ss.getSheetByName(NAME || 'PRODUCTS');
    if (!sh) return {};

    const values = sh.getDataRange().getValues();
    if (values.length < 2) return {};

    const header = values[0].map(h => String(h || ''));
    const idx = {};
    header.forEach((h, i) => { idx[h] = i; });

    const iSku = idx['SKU'];
    if (iSku == null) return {};

    const map = {};
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const rawSku = row[iSku];
      if (!rawSku) continue;
      const skuNorm = normalizeSkuForStats_v6_(rawSku);
      if (!skuNorm) continue;

      map[skuNorm] = {
        name: idx['Product Name'] != null ? (row[idx['Product Name']] || '') : '',
        url: idx['Product URL'] != null ? (row[idx['Product URL']] || '') : '',
        catPath: idx['Category Path'] != null ? (row[idx['Category Path']] || '') : '',
        l1: idx['Level 1'] != null ? (row[idx['Level 1']] || '') : '',
        l2: idx['Level 2'] != null ? (row[idx['Level 2']] || '') : '',
        l3: idx['Level 3'] != null ? (row[idx['Level 3']] || '') : ''
      };
    }

    return map;
  } catch (e) {
    Logger.log('loadProductsLookup_ failed: ' + e);
    return {};
  }
}


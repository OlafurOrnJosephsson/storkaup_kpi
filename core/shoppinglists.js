/************************************************************
 * buildShoppingListSheet_(profile, cfg)
 ************************************************************/
function buildShoppingListSheet_(profile, cfg) {
  const innkaupalistarId =
    (cfg.SHEET_IDS && cfg.SHEET_IDS.INNKAUPALISTAR) ||
    (cfg.SHEETS && cfg.SHEETS.INNKAUPALISTAR && cfg.SHEETS.INNKAUPALISTAR.ID) ||
    (cfg.IDS && cfg.IDS.INNKAUPALISTAR); // legacy fallback

  if (!innkaupalistarId) {
    throw new Error('CONFIG: missing INNKAUPALISTAR sheet ID (SHEET_IDS.INNKAUPALISTAR)');
  }

  const ss = SpreadsheetApp.openById(innkaupalistarId);
  // Prefer company name for sheet name, fall back to ID
  const safeName = String(profile.companyName || "")
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .substring(0, 80);
  const sheetName = safeName ? "LISTI_" + safeName : "LISTI_" + profile.customerId;

  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  sh.clear();

  const header = [
    "SKU","Vörulýsing","Level 1","Level 2","Magn","Tekjur",
    "Síðast keypt","Dagar síðan"
  ];
  sh.appendRow(header);

  profile.lines.sort((a,b) =>
    (a.level1||"").localeCompare(b.level1||"") ||
    (a.level2||"").localeCompare(b.level2||"") ||
    (a.name||"").localeCompare(b.name||"")
  );

  const today = new Date();

  const rows = profile.lines.map(line => {
    const days = line.date ? Math.floor((today - line.date)/(1000*3600*24)) : "";
    return [
      line.sku,
      line.name,
      line.level1,
      line.level2,
      line.qty,
      line.revenue,
      line.date ? line.date : "",
      days
    ];
  });

  if (rows.length) {
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  return sheetName;
}

/************************************************************
 * Helper til UI Layer
 ************************************************************/

// Parse "Top 15 Products" string from Customer Analysis: pattern "SKU (qty) | Name | SKU (qty) | Name ..."
function parseTopProducts_(str, prodMap) {
  const out = [];
  const parts = String(str || '').split('|');
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i].trim();
    const m = chunk.match(/^(\d+)\s*\((\d+)\)/);
    if (!m) continue;
    const sku = m[1];
    const qty = Number(m[2]) || 0;
    const namePart = (parts[i + 1] || '').trim();
    const prod = prodMap[sku] || {};
    out.push({
      sku,
      name: namePart || prod.name || sku,
      level1: prod.level1 || "",
      level2: prod.level2 || "",
      qty,
      revenue: 0,
      date: null
    });
  }
  return out;
}

function buildShoppingListForCompany_(companyId, mode, cfg) {
  // Fast path using Customer Analysis pre-aggregated data if available
  try {
    const ca = STORKAUP_SCHEMA.CUSTOMER_ANALYSIS.COLUMNS;
    const caRows = (typeof loadTableCached_ === 'function' ? loadTableCached_('CUSTOMER_ANALYSIS') : loadTableBySchema_('CUSTOMER_ANALYSIS')) || [];
    const caRow = caRows.find(r => String(r[ca.CUSTOMER_ID]) === String(companyId));
    if (caRow) {
      const products = (typeof loadTableCached_ === 'function' ? loadTableCached_('PRODUCTS') : loadTableBySchema_('PRODUCTS')) || [];
      const prodMap = {};
      products.forEach(p => {
        const sku = String(p[STORKAUP_SCHEMA.PRODUCTS.SKU] || p.SKU || "").trim();
        if (!sku) return;
        const name = p[STORKAUP_SCHEMA.PRODUCTS.NAME] || p.NAME || "";
        const level1 = p[STORKAUP_SCHEMA.PRODUCTS.LEVEL1] || p.LEVEL1 || p.level1 || "";
        const level2 = p[STORKAUP_SCHEMA.PRODUCTS.LEVEL2] || p.LEVEL2 || p.level2 || "";
        prodMap[sku] = {
          name,
          level1,
          level2
        };
      });

      const lines = parseTopProducts_(caRow[ca.TOP_PRODUCTS], prodMap);
      if (lines.length) {
        const profileFast = {
          customerId: String(companyId),
          companyName: caRow[ca.CUSTOMER_NAME] || "",
          mode: "auto",
          totalQty: lines.reduce((s, l) => s + (l.qty || 0), 0),
          totalRevenue: lines.reduce((s, l) => s + (l.revenue || 0), 0),
          lastPurchaseDate: null,
          lines
        };
        return buildShoppingListSheet_(profileFast, cfg);
      }
    }
  } catch (e) {
    Logger.log("Customer Analysis fast path failed: " + e);
  }

  let profile = buildCustomerProfileV3_(companyId, mode, cfg);

  // Fallback: if profile failed but we have BC_LINES rows, build a minimal offline profile
  if (!profile) {
    const targetId = String(companyId).trim();
    const bcLines = loadTableCached_('BC_LINES') || [];
    const products = loadTableCached_('PRODUCTS') || [];
    const invoices = loadTableCached_('BC_INVOICES') || [];
    const bcCustomers = loadTableCached_('BC_CUSTOMERS') || [];

    // Map document -> date
    const invoiceDateMap = {};
    invoices.forEach(inv => {
      const docNo = String(inv[STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.DOCUMENT_NO] || "").trim();
      const d = parseDateSafe_(inv[STORKAUP_SCHEMA.BC_INVOICES.COLUMNS.ORDER_DATE]);
      if (docNo && d) invoiceDateMap[docNo] = d;
    });

    // Map SKU -> product info
    const prodMap = {};
    products.forEach(p => {
      const sku = String(p[STORKAUP_SCHEMA.PRODUCTS.SKU] || p.SKU || "").trim();
      if (!sku) return;
      prodMap[sku] = {
        name: p[STORKAUP_SCHEMA.PRODUCTS.NAME] || p.NAME || "",
        level1: p[STORKAUP_SCHEMA.PRODUCTS.LEVEL1] || p.LEVEL1 || p.level1 || "",
        level2: p[STORKAUP_SCHEMA.PRODUCTS.LEVEL2] || p.LEVEL2 || p.level2 || ""
      };
    });

    // Lookup company name from BC_CUSTOMERS if available
    const custRow = bcCustomers.find(c =>
      String(c[STORKAUP_SCHEMA.BC_CUSTOMERS.COLUMNS.COMPANY_ID] || "").trim() === targetId
    );
    const fallbackName = custRow ? (custRow[STORKAUP_SCHEMA.BC_CUSTOMERS.COLUMNS.COMPANY_NAME] || "") : "";

    // Aggregate per SKU
    const agg = {};
    bcLines.forEach(r => {
      const cid = String(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.COMPANY_ID] || "").trim();
      if (cid !== targetId) return;
      const sku = String(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.SKU] || "").trim();
      if (!sku) return;

      if (!agg[sku]) {
        const prod = prodMap[sku] || {};
        agg[sku] = {
          sku,
          name: r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.PRODUCT_NAME] || prod.name || sku,
          level1: prod.level1 || "",
          level2: prod.level2 || "",
          qty: 0,
          revenue: 0,
          lastDate: null
        };
      }

      const qty = Number(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.QTY] || 0);
      const rev = Number(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.AMOUNT_EXCL] || 0);
      const docNo = String(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.DOCUMENT_NO] || "").trim();
      const docDate = docNo && invoiceDateMap[docNo] ? invoiceDateMap[docNo] : null;

      agg[sku].qty += qty;
      agg[sku].revenue += rev;
      if (docDate && (!agg[sku].lastDate || docDate > agg[sku].lastDate)) {
        agg[sku].lastDate = docDate;
      }
    });

    // Top 30 by revenue
    const lines = Object.values(agg)
      .sort((a, b) =>
        (b.revenue - a.revenue) ||
        (b.qty - a.qty) ||
        String(a.name || "").localeCompare(b.name || "")
      )
      .slice(0, 30)
      .map(l => ({
        sku: l.sku,
        name: l.name,
        level1: l.level1,
        level2: l.level2,
        qty: l.qty,
        revenue: l.revenue,
        date: l.lastDate || null
      }));

    if (lines.length) {
      const lastPurchaseDate = lines.reduce((best, l) =>
        (!best || (l.date && l.date > best)) ? l.date : best
      , null);

      profile = {
        customerId: targetId,
        companyName: fallbackName || targetId,
        mode: "offline",
        totalQty: lines.reduce((s, l) => s + l.qty, 0),
        totalRevenue: lines.reduce((s, l) => s + l.revenue, 0),
        lastPurchaseDate,
        lines
      };
    }
  }

  if (!profile) throw new Error("Engar pantanir fundust.");

  const name = buildShoppingListSheet_(profile, cfg);
  return name;
}

function public_buildShoppingListForCompany(companyId, mode, cfg) {
  return buildShoppingListForCompany_(companyId, mode, cfg);
}

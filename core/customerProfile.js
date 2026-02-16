/************************************************************
 * 🟦 buildOnlineCustomerProfile_(companyId, cfg)
 ************************************************************/
function buildOnlineCustomerProfile_(companyId, cfg) {
  const rows = loadTableCached_('NEWWEB')
    .filter(r => String(r[STORKAUP_SCHEMA.NEWWEB.COMPANY_ID]) === String(companyId));

  if (!rows.length) return null;

  const products = loadTableCached_('PRODUCTS');

  const profile = {
    customerId: companyId,
    companyName: rows[0][STORKAUP_SCHEMA.NEWWEB.COMPANY_NAME],
    mode: "online",
    totalQty: 0,
    totalRevenue: 0,
    lastPurchaseDate: null,
    lines: []
  };

  rows.forEach(r => {
    const sku = r[STORKAUP_SCHEMA.NEWWEB.SKU] || "";
    const name = r[STORKAUP_SCHEMA.NEWWEB.PRODUCT_NAME] || sku;

    const qty = Number(r[STORKAUP_SCHEMA.NEWWEB.QTY] || 0);
    const rev = Number(r[STORKAUP_SCHEMA.NEWWEB.GRAND_TOTAL] || 0);
    const date = parseDateSafe_(r[STORKAUP_SCHEMA.NEWWEB.DATE]);

    const prod = products.find(p => p[STORKAUP_SCHEMA.PRODUCTS.SKU] === sku) || {};

    profile.lines.push({
      sku,
      name,
      qty,
      revenue: rev,
      date,
      level1: prod[STORKAUP_SCHEMA.PRODUCTS.LEVEL1] || "",
      level2: prod[STORKAUP_SCHEMA.PRODUCTS.LEVEL2] || "",
      level3: prod[STORKAUP_SCHEMA.PRODUCTS.LEVEL3] || ""
    });

    profile.totalQty += qty;
    profile.totalRevenue += rev;

    if (!profile.lastPurchaseDate || date > profile.lastPurchaseDate) {
      profile.lastPurchaseDate = date;
    }
  });

  return profile;
}

/************************************************************
 * 🟥 buildOfflineCustomerProfile_(companyId, cfg)
 ************************************************************/
function buildOfflineCustomerProfile_(companyId, cfg) {
  const customers = loadTableCached_('BC_CUSTOMERS');
  const customer = customers.find(c =>
    String(c[STORKAUP_SCHEMA.BC_CUSTOMERS.COLUMNS.COMPANY_ID]).trim() === String(companyId).trim()
  );

  const targetId = String(companyId).trim();
  const rows = loadTableCached_('BC_LINES')
    .filter(r => String(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.COMPANY_ID]).trim() === targetId);

  // Allow building a profile even if the customer master row is missing, as long as we have lines.
  if (!rows.length) return null;

  const products = loadTableCached_('PRODUCTS');

  const profile = {
    customerId: companyId,
    companyName: customer ? customer[STORKAUP_SCHEMA.BC_CUSTOMERS.COLUMNS.COMPANY_NAME] : '',
    mode: "offline",
    totalQty: 0,
    totalRevenue: 0,
    lastPurchaseDate: null,
    lines: []
  };

  rows.forEach(r => {
    const sku = r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.SKU];
    const qty = Number(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.QTY] || 0);
    const rev = Number(r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.AMOUNT_EXCL] || 0);

    const prod = products.find(p => p[STORKAUP_SCHEMA.PRODUCTS.SKU] === sku) || {};

    profile.lines.push({
      sku,
      name: r[STORKAUP_SCHEMA.BC_LINES.COLUMNS.PRODUCT_NAME] || sku,
      qty,
      revenue: rev,
      date: null,
      level1: prod[STORKAUP_SCHEMA.PRODUCTS.LEVEL1] || "",
      level2: prod[STORKAUP_SCHEMA.PRODUCTS.LEVEL2] || "",
      level3: prod[STORKAUP_SCHEMA.PRODUCTS.LEVEL3] || ""
    });

    profile.totalQty += qty;
    profile.totalRevenue += rev;
  });

  return profile;
}

/************************************************************
 * 🟪 AUTO profile
 ************************************************************/
function buildCustomerProfileV3_(companyId, mode, cfg) {
  if (mode === "online") return buildOnlineCustomerProfile_(companyId, cfg);
  if (mode === "offline") return buildOfflineCustomerProfile_(companyId, cfg);

  // AUTO:
  const online = buildOnlineCustomerProfile_(companyId, cfg);
  if (online) return online;

  const offline = buildOfflineCustomerProfile_(companyId, cfg);
  return offline;
}

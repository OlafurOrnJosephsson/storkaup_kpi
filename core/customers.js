/***************************************************
 * 👥 customers.gs — Magento Customers (CORE v3)
 * -------------------------------------------------
 * ✔ Uses loadConfig_() + magentoHeaders_()
 * ✔ Full export if empty
 * ✔ Incremental sync via updated_at checkpoint
 * ✔ No duplicates ever
 * ✔ Clean normalized fields
 * ✔ Provides fast lookup map for NEWWEB
 ***************************************************/


/*************** CONFIG ***************/
const MAGENTO_CUSTOMERS_SHEET_NAME    = 'MAGENTO_CUSTOMERS';
const MAGENTO_CUSTOMERS_LAST_SYNC_KEY = 'MAGENTO_CUSTOMERS_LAST_SYNC';
/**************************************/


/************************************************************
 * Spreadsheet helpers
 ************************************************************/
function getCustomersSpreadsheet_() {
  const CONFIG = loadConfig_();
  const ssId   = CONFIG.SHEET_IDS.CUSTOMERS;
  if (!ssId) throw new Error('CONFIG ERROR: Vantar SHEET_IDS.CUSTOMERS í STORKAUP_CONFIG');
  return SpreadsheetApp.openById(ssId);
}

function getMagentoCustomersSheet_() {
  const ss = getCustomersSpreadsheet_();
  let sh = ss.getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(MAGENTO_CUSTOMERS_SHEET_NAME);
  return sh;
}


/************************************************************
 * Header
 ************************************************************/
function ensureMagentoCustomersHeader_() {
  const sh = getMagentoCustomersSheet_();
  const header = [
    'ID',
    'Name',
    'Email',
    'Group',
    'Phone',
    'ZIP',
    'Country',
    'Region',
    'Created At',
    'Updated At',
    'Company Name',
    'Company ID',
    'Real Email',
    'Role',
    'Has Liquor License',
    'Has Toxic License',
    'National ID'
  ];

  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,header.length)
      .setValues([header])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    return header;
  }

  const existing = sh.getRange(1,1,1,header.length).getValues()[0];
  if (existing.join('|') !== header.join('|')) {
    sh.getRange(1,1,1,header.length)
      .setValues([header])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  return header;
}


/************************************************************
 * Fetch from Magento (full or incremental)
 ************************************************************/
function fetchMagentoCustomers_(sinceIso) {
  const CONFIG = loadConfig_();
  const base   = String(CONFIG.ENDPOINTS.Magento.BASE_URL||'').replace(/\/$/,'');
  if (!base) throw new Error('CONFIG ERROR: Vantar ENDPOINTS.Magento.BASE_URL');

  const pageSize = 300;
  let page = 1;
  let all  = [];

  const incremental = !!(sinceIso && !isNaN(Date.parse(sinceIso)));
  if (sinceIso && !incremental) {
    Logger.log('Invalid sinceIso value, running full export instead');
  }
  Logger.log(`📡 Fetch Magento Customers — ${incremental ? 'incremental' : 'full'}`);

  while (true) {
    if (page > 1000) {
      throw new Error('Pagination guard hit (over 1000 pages). Aborting to avoid infinite loop.');
    }
    let search = `searchCriteria[currentPage]=${page}&searchCriteria[pageSize]=${pageSize}`;

    if (incremental) {
      const v = encodeURIComponent(sinceIso);
      search +=
        `&searchCriteria[filter_groups][0][filters][0][field]=updated_at` +
        `&searchCriteria[filter_groups][0][filters][0][value]=${v}` +
        `&searchCriteria[filter_groups][0][filters][0][condition_type]=gt`;
    }

    const url = `${base}/customers/search?${search}`;
    const res = fetchMagentoWithRetry_(url,{
      method:'get',
      headers:magentoHeaders_(),
      contentType:'application/json',
      followRedirects:false,
      validateHttpsCertificates:true,
      muteHttpExceptions:true
    });

    const body = res.getContentText();
    const data  = JSON.parse(body);
    if (!data || !Array.isArray(data.items)) {
      throw new Error('Unexpected Magento response (items missing or not array). Body: ' + truncateBody_(body));
    }
    const items = data.items;
    if (!items.length) break;

    all = all.concat(items);
    if (items.length < pageSize) break;
    page++;
  }

  Logger.log(`📦 Total Magento customers fetched: ${all.length}`);

  return all.map(mapMagentoCustomer_);
}

function fetchMagentoWithRetry_(url, options) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt++;
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();

    if (code === 401 || code === 403) {
      throw new Error(`Magento auth failed (${code}). Clear MAGENTO_ADMIN_TOKEN_CACHE/TS and verify user role.`);
    }

    if (code === 429 || code >= 500) {
      lastError = new Error(`Magento ${code} on ${url}: ${truncateBody_(res.getContentText())}`);
      const backoff = Math.min(60000, 500 * Math.pow(2, attempt - 1));
      Utilities.sleep(backoff);
      continue;
    }

    if (code !== 200) {
      throw new Error(`Magento returned ${code}: ${truncateBody_(res.getContentText())}`);
    }

    return res;
  }

  throw lastError || new Error(`Magento fetch failed after ${maxAttempts} attempts: ${url}`);
}

function truncateBody_(str, maxLen) {
  const limit = maxLen || 400;
  if (!str) return '';
  const s = String(str);
  return s.length > limit ? s.slice(0, limit) + '...' : s;
}


/************************************************************
 * Normalize Magento → Local row object
 ************************************************************/
function mapMagentoCustomer_(c) {
  const ca = c.custom_attributes || [];
  const get = code => {
    const a = ca.find(x => x.attribute_code === code);
    return a ? a.value : '';
  };

  const billing  = (c.addresses||[]).find(a=>a.default_billing)  || {};
  const shipping = (c.addresses||[]).find(a=>a.default_shipping) || {};

  return {
    id:          String(c.id),
    name:        `${c.firstname||''} ${c.lastname||''}`.trim(),
    email:       c.email || '',
    group:       c.group_id || '',
    phone:       get('telephone') || billing.telephone || '',
    zip:         billing.postcode || shipping.postcode || '',
    country:     billing.country_id || shipping.country_id || '',
    region:      (billing.region && billing.region.region) ||
                 (shipping.region && shipping.region.region) || '',
    created:     c.created_at || '',
    updated:     c.updated_at || '',
    company_name: get('company_name') || '',
    company_id:   get('company_id')   || '',
    real_email:   get('real_email')   || '',
    role:         get('role') || '',
    has_liquor:   get('has_liquor_license') || '',
    has_toxic:    get('has_toxic_license')  || '',
    national_id:  get('customer_national_id_number') || ''
  };
}


/************************************************************
 * MAIN SYNC (full or incremental)
 ************************************************************/
function syncMagentoCustomers() {
  const sh     = getMagentoCustomersSheet_();
  const header = ensureMagentoCustomersHeader_();
  const props  = PropertiesService.getScriptProperties();

  const values = sh.getDataRange().getValues();
  const hasData = values.length > 1;

  let lastSync = props.getProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY);
  Logger.log(`🕒 Last sync: ${lastSync || '(none / full)'}`);

  // If first time → full export
  if (!lastSync || !hasData) {
    Logger.log('📄 Running FULL export of customers');
    return syncMagentoCustomersFull_();
  }

  // Build ID → row index map
  const rowById = {};
  values.slice(1).forEach((row,i) => {
    const id = String(row[0]||'').trim();
    if (id) rowById[id] = i+2;
  });

  // Fetch changed customers
  const changed = fetchMagentoCustomers_(lastSync);
  if (!changed.length) {
    Logger.log('ℹ️ No customer changes since last sync');
    props.setProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY,new Date().toISOString());
    return;
  }

  let newCount = 0;
  let updatedCount = 0;
  let lastRow = sh.getLastRow();

  changed.forEach(c => {
    const row = [
      c.id, c.name, c.email, c.group, c.phone, c.zip, c.country, c.region,
      c.created, c.updated, c.company_name, c.company_id, c.real_email,
      c.role, c.has_liquor, c.has_toxic, c.national_id
    ];

    const existingRow = rowById[c.id];
    if (existingRow) {
      sh.getRange(existingRow,1,1,header.length).setValues([row]);
      updatedCount++;
    } else {
      lastRow++;
      sh.getRange(lastRow,1,1,header.length).setValues([row]);
      newCount++;
    }
  });

  applyStylingTo("CUSTOMERS", {
    sortBy: "Updated At",
    zebra: false
  });

  props.setProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY,new Date().toISOString());

  Logger.log(`✅ Customers synced. New: ${newCount}, Updated: ${updatedCount}`);
}


/************************************************************
 * Full export (manual or auto)
 ************************************************************/
function syncMagentoCustomersFull_() {
  const sh     = getMagentoCustomersSheet_();
  const header = ensureMagentoCustomersHeader_();
  const props  = PropertiesService.getScriptProperties();

  // Clear all rows except header
  if (sh.getLastRow() > 1) {
    sh.getRange(2,1,sh.getLastRow()-1,header.length).clearContent();
  }

  const customers = fetchMagentoCustomers_(); // FULL export
  if (customers.length) {
    const body = customers.map(c => [
      c.id, c.name, c.email, c.group, c.phone, c.zip, c.country, c.region,
      c.created, c.updated, c.company_name, c.company_id, c.real_email,
      c.role, c.has_liquor, c.has_toxic, c.national_id
    ]);
    sh.getRange(2,1,body.length,header.length).setValues(body);
  }

  applyStylingTo("CUSTOMERS", {
  sortBy: "Updated At",
  zebra: true
});

  props.setProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY,new Date().toISOString());

  Logger.log(`✅ Full Magento customer export complete: ${customers.length} rows`);
}


/************************************************************
 * Lookup loader (used by NEWWEB)
 ************************************************************/
function loadCustomerLookup_() {
  const CONFIG = loadConfig_();
  const ssId   = CONFIG.SHEET_IDS.CUSTOMERS;
  const ss     = SpreadsheetApp.openById(ssId);
  const sh     = ss.getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  if (!sh) return { byId:{}, byEmail:{} };

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { byId:{}, byEmail:{} };

  const header = data[0];
  const rows   = data.slice(1);

  const idx = {};
  header.forEach((h,i)=>idx[h]=i);

  const byId    = {};
  const byEmail = {};

  rows.forEach(r => {
    const id    = String(r[idx['ID']]||'').trim();
    const email = String(r[idx['Email']]||'').toLowerCase().trim();

    if (!id && !email) return;

    const entry = {
      id         : id,
      email      : email,
      company_name: r[idx['Company Name']] || '',
      company_id  : r[idx['Company ID']]   || '',
      region      : r[idx['Region']]       || '',
      national_id : r[idx['National ID']]  || '',
      real_email  : r[idx['Real Email']]   || ''
    };

    if (id) byId[id] = entry;
    if (email) byEmail[email] = entry;
  });

  return { byId, byEmail };
}

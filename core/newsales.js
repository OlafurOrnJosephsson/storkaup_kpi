/***************************************************
 * 📦 newsales.gs — Stórkaup NEWWEB importer (CORE v3)
 * -------------------------------------------------
 * ✔ No API calls (zero UrlFetch inside poller)
 * ✔ Uses MAGENTO_CUSTOMERS lookup only
 * ✔ One row per order (LITE)
 * ✔ 5-min safePoll + LockService
 * ✔ Duplicate-vörn (checks existing IDs)
 * ✔ Checkpoint á created_at
 * ✔ Fastest + most stable version ever
 ***************************************************/


/*************** CONFIG FOR NEWWEB MODULE ***************/
const NEWWEB_SHEET_NAME     = 'NEWWEB';
const NEWWEB_CHECKPOINT_KEY = 'NEWWEB_lastCreatedAt';
const NEWWEB_DEFAULT_START  = '2025-07-15 00:00:00';
const NEWWEB_STATUS_FILTER  = [];      // e.g. ['processing','complete']
/*********************************************************/


/***********************************************************
 * Spreadsheet helpers
 ************************************************************/
function getNewwebSpreadsheet_() {
  const CONFIG = loadConfig_();
  const ssId = CONFIG.SHEETS.WEBSALES.ID;
  if (!ssId) throw new Error('CONFIG ERROR: Vantar SHEETS.WEBSALES.ID í STORKAUP_CONFIG');
  return SpreadsheetApp.openById(ssId);
}

function getNewwebSheet_() {
  const CONFIG = loadConfig_();
  const ss = getNewwebSpreadsheet_();
  const sheetName = CONFIG.SHEETS.WEBSALES.NAME; 
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  return sh;
}



/************************************************************
 * Logging
 ************************************************************/
function logNewwebEvent_(lvl, msg, extra) {
  lvl = lvl || 'INFO';
  msg = msg || '';

  // Log to execution log with extra context if provided
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  Logger.log(`[NEWWEB][${lvl}] ${msg}${extraStr}`);

  const CONFIG = loadConfig_();
  const logId = CONFIG.SHEET_IDS.LOG_SHEET_ID;
  if (!logId) return;

  try {
    const ss = SpreadsheetApp.openById(logId);
    let sh = ss.getSheetByName('NEWWEB_Logs');
    if (!sh) {
      sh = ss.insertSheet('NEWWEB_Logs');
      sh.appendRow(['Timestamp','Module','Level','Message','Extra JSON']);
    }
    sh.appendRow([
      new Date(),
      'NEWWEB',
      lvl,
      msg,
      extra ? JSON.stringify(extra) : ''
    ]);
  } catch (e) {
    Logger.log(`[NEWWEB][LOG_ERROR] ${e}`);
  }
}


/************************************************************
 * Ensure NEWWEB headers
 ************************************************************/
function ensureHeader_() {
  const sh = getNewwebSheet_();

  const headers = [
    'ID',
    'Purchase Point',
    'Purchase Date',
    'Ship-to Name',
    'Subtotal (Excl Tax)',
    'Subtotal (Incl Tax)',
    'Tax Amount',
    'Grand Total (Purchased)',
    'Customer Name',
    'Company Name',
    'Company ID',
    'Real Email',
    'Region',
    'National ID',
    'Payment Method',
    'Status',
    'SKU',
    'SKU (Normalized)',
    'Product Name',
    'Qty',
    'Items'
  ];

  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return headers;
  }

  const existing = sh.getRange(1,1,1,headers.length).getValues()[0].map(String);
  if (existing.join('|') !== headers.join('|')) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }

  return headers;
}


/************************************************************
 * MAIN POLLER
 ************************************************************/
function pollMagentoNewOrders() {
  const sh      = getNewwebSheet_();
  const headers = ensureHeader_();

  // 🔥 Load lookup ONCE per run
  globalCustomerLookup = loadCustomerLookup_();

  // Format SKU as text
  const skuCol  = headers.indexOf('SKU') + 1;
  const normCol = headers.indexOf('SKU (Normalized)') + 1;

  const maxRows = Math.max(sh.getMaxRows()-1,1);
  if (maxRows > 0) {
    if (skuCol)  sh.getRange(2, skuCol,  maxRows).setNumberFormat('@');
    if (normCol) sh.getRange(2, normCol, maxRows).setNumberFormat('@');
  }

  // Fetch orders
  const orders = fetchNewMagentoOrders_();
  if (!orders.length) {
    logNewwebEvent_('INFO','Engar nýjar pantanir frá Magento');
    return;
  }

  // Status filter (optional)
  let filtered = orders;
  if (NEWWEB_STATUS_FILTER.length) {
    const wanted = new Set(NEWWEB_STATUS_FILTER.map(s=>s.toLowerCase()));
    filtered = orders.filter(o =>
      wanted.has(String(o.status||'').toLowerCase())
    );
  }
  if (!filtered.length) return;

  // Identify existing IDs
  const idCol = headers.indexOf('ID')+1;
  const last  = sh.getLastRow();
  let existingIds = [];
  if (last > 1) {
    existingIds = sh.getRange(2,idCol,last-1,1)
      .getValues().flat().map(String).filter(Boolean);
  }
  const existingSet = new Set(existingIds);

  const newOrders = filtered.filter(
    o => !existingSet.has(String(o.increment_id))
  );
  if (!newOrders.length) {
    logNewwebEvent_('INFO','Allar pantanir þegar til');
    return;
  }

  // Build rows (LITE)
  const rows = mapOrdersToOrderRows_(newOrders, headers);
  if (!rows.length) return;

  // Write
  const startRow = sh.getLastRow()+1;
  sh.insertRowsAfter(sh.getLastRow(), rows.length);
  sh.getRange(startRow,1,rows.length,headers.length).setValues(rows);

 
  // 🎨 Apply styling via CONFIG mapping
    applyStylingTo("WEBSALES", { 
      sortBy: "Purchase Date",
      zebra: true 
    });


  logNewwebEvent_('INFO','NEWWEB import lokið',{
    fetched: orders.length,
    newOrders: rows.length
  });
}


/************************************************************
 * MAP — one row per order (LITE)
 ************************************************************/
function mapOrdersToOrderRows_(orders, headers) {
  const idx = {}; headers.forEach((h,i)=>idx[h]=i);

  const rows = [];
  for (const o of orders) {
    const row = new Array(headers.length).fill('');

    // B2B extension attributes
    const ext  = o.extension_attributes || {};
    const comp = ext.company_order_attributes || {};

    const b2bName = comp.company_name || '';
    const b2bId   = comp.company_id   || '';

    // Items
    const items   = o.items || [];
    const rawSku  = items.map(i=>i.sku||'');
    const normSku = rawSku.map(normalizeSkuGlobal_);
    const names   = items.map(i=>i.name||'');
    const qty     = items.reduce((a,i)=>a+(i.qty_ordered||0),0);

    const customerName =
      [o.customer_firstname, o.customer_lastname].filter(Boolean).join(' ');

    // Lookup info (no API fallback)
    let enriched = null;

    if (globalCustomerLookup) {
      const L = globalCustomerLookup;

      if (o.customer_id) {
        enriched = L.byId[String(o.customer_id)];
      }
      if (!enriched && o.customer_email) {
        enriched = L.byEmail[String(o.customer_email).toLowerCase()];
      }
    }

    const finalCompanyName =
      b2bName || (enriched ? enriched.company_name : '');

    const finalCompanyId =
      b2bId   || (enriched ? enriched.company_id   : '');

    const finalRealEmail =
      enriched && enriched.real_email ? enriched.real_email : (o.customer_email || '');

    const finalRegion      = enriched ? enriched.region      : '';
    const finalNationalId  = enriched ? enriched.national_id : '';


    // Fill row
    row[idx['ID']]                      = o.increment_id || '';
    row[idx['Purchase Point']]          = (o.store_name||'').split('\n')[0] || 'Main Website';
    row[idx['Purchase Date']]           = toDate_(o.created_at);
    row[idx['Ship-to Name']]            = o.customer_firstname || '';
    row[idx['Subtotal (Excl Tax)']]     = Number(o.subtotal)||0;
    row[idx['Subtotal (Incl Tax)']]     = Number(o.subtotal_incl_tax)||0;
    row[idx['Tax Amount']]              = Number(o.tax_amount)||0;
    row[idx['Grand Total (Purchased)']] = Number(o.grand_total)||0;
    row[idx['Customer Name']]           = customerName;

    row[idx['Company Name']] = finalCompanyName;
    row[idx['Company ID']]   = finalCompanyId;
    row[idx['Real Email']]   = finalRealEmail;
    row[idx['Region']]       = finalRegion;
    row[idx['National ID']]  = finalNationalId;

    row[idx['Payment Method']]          = (o.payment && o.payment.method) || '';
    row[idx['Status']]                  = o.status || '';
    row[idx['SKU']]                     = rawSku.join(', ');
    row[idx['SKU (Normalized)']]        = normSku.join(', ');
    row[idx['Product Name']]            = names.join(', ');
    row[idx['Qty']]                     = qty;
    row[idx['Items']]                   = `${items.length} items`;

    rows.push(row);
  }
  return rows;
}


/************************************************************
 * Magento fetch — orders only (FAST)
 ************************************************************/
function fetchNewMagentoOrders_() {
  const CONFIG = loadConfig_();
  const props  = PropertiesService.getScriptProperties();

  let lastCreatedAt = props.getProperty(NEWWEB_CHECKPOINT_KEY) || NEWWEB_DEFAULT_START;
  const base = String(CONFIG.ENDPOINTS.Magento.BASE_URL||'').replace(/\/$/,'');

  const pageSize = 200;
  let page       = 1;
  let all        = [];

  while (true) {
    const url =
      `${base}/orders` +
      `?searchCriteria[filter_groups][0][filters][0][field]=created_at` +
      `&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(lastCreatedAt)}` +
      `&searchCriteria[filter_groups][0][filters][0][condition_type]=gt` +
      `&searchCriteria[pageSize]=${pageSize}` +
      `&searchCriteria[currentPage]=${page}`;

    let res;
    try {
      res = UrlFetchApp.fetch(url,{
        method:'get',
        headers:magentoHeaders_(),
        muteHttpExceptions:true
      });
    } catch (e) {
      // Log full context to understand why UrlFetch failed
      logNewwebEvent_('ERROR','UrlFetch exception',{
        url,
        message: e && e.message,
        stack: e && e.stack
      });
      break;
    }

    let status = res.getResponseCode();
    if (status === 401 || status === 403) {
      const backoffKey = 'MAGENTO_ADMIN_TOKEN_REFRESH_BACKOFF_UNTIL';
      const backoffUntil = Number(props.getProperty(backoffKey) || 0);
      if (backoffUntil && Date.now() < backoffUntil) {
        logNewwebEvent_('WARN','Skipping admin token refresh due to backoff',{
          url,
          status,
          backoffUntil
        });
      } else {
        logNewwebEvent_('WARN','Magento admin token unauthorized; refreshing',{
          url,
          status
        });
        try {
          res = UrlFetchApp.fetch(url,{
            method:'get',
            headers:magentoHeaders_({ forceRefresh: true }),
            muteHttpExceptions:true
          });
          status = res.getResponseCode();
          if (status === 200) {
            props.deleteProperty(backoffKey);
          } else if (status === 401 || status === 403) {
            props.setProperty(backoffKey, String(Date.now() + 30 * 60 * 1000)); // 30 min
          }
        } catch (e) {
          logNewwebEvent_('ERROR','UrlFetch exception on admin refresh retry',{
            url,
            message: e && e.message,
            stack: e && e.stack
          });
          break;
        }
      }
    }

    if (status !== 200) {
      // Surface non-200 responses for debugging (auth, DNS, etc.)
      logNewwebEvent_('ERROR','UrlFetch non-200',{
        url,
        status,
        body: res.getContentText()
      });
      break;
    }

    const json = JSON.parse(res.getContentText());
    const items = json.items || [];
    if (!items.length) break;

    all = all.concat(items);
    if (items.length < pageSize) break;
    if (++page > 20) break;
  }

  if (all.length) {
    const newest = all.reduce(
      (a,b)=>a.created_at > b.created_at ? a : b
    ).created_at;
    props.setProperty(NEWWEB_CHECKPOINT_KEY,newest);
  }

  return all;
}


/************************************************************
 * Safe Poll
 ************************************************************/
function safePoll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logNewwebEvent_('WARN','Another run in progress');
    return;
  }
  try {
    pollMagentoNewOrders();
  } catch(e) {
    logNewwebEvent_('ERROR','safePoll exception',{e});
  } finally {
    lock.releaseLock();
  }
}


/************************************************************
 * Util
 ************************************************************/
function toDate_(v) {
  return v ? new Date(String(v).replace(' ','T')) : null;
}

function normalizeSkuGlobal_(sku) {
  if (!sku) return '';
  sku = String(sku).trim();
  sku = sku.replace(/_.+$/,'');   // remove _KASSI/_STK/etc
  sku = sku.replace(/[^0-9]/g,'');
  return sku;
}

function applyDefaultFormatting_(sh,dateColName) {
  const range = sh.getDataRange();
  sh.setFrozenRows(1);

  try { if (sh.getFilter()) sh.getFilter().remove(); } catch(e){}
  try { range.createFilter(); } catch(e){}

  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf(dateColName)+1;
  if (col>0) {
    try { range.sort({column:col,ascending:false}); } catch(e){}
  }

  try {
    for (let c=1;c<=sh.getLastColumn();c++) sh.autoResizeColumn(c);
  } catch(e){}
}


/************************************************************
 * Clear
 ************************************************************/
function clearNewwebKeepHeader() {
  const sh = getNewwebSheet_();
  if (sh.getLastRow()>1) {
    sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  }
  PropertiesService.getScriptProperties()
    .setProperty(NEWWEB_CHECKPOINT_KEY, NEWWEB_DEFAULT_START);
}


/************************************************************
 * Manual test
 ************************************************************/
function pollOnce() {
  pollMagentoNewOrders();
}

/***************************************************
 * NEWWEB importer v2 — quota friendly + resumable
 * ------------------------------------------------
 * - Uses Magento token (CONFIG.API.Magento.TOKEN) or falls back to admin user/pass
 * - Respects UrlFetch quota by limiting pages per run
 * - Resume via ScriptProperty checkpoint (NEWWEB_V2_LAST_CREATED_AT)
 * - Writes one row per order to the WEBSALES sheet (same schema as newsales.js)
 ***************************************************/

const NEWWEB_V2_SHEET_NAME      = 'NEWWEB';
const NEWWEB_V2_CHECKPOINT_KEY  = 'NEWWEB_V2_LAST_CREATED_AT';
const NEWWEB_V2_DEFAULT_START   = '2025-07-15 00:00:00';
const NEWWEB_V2_STATUS_FILTER   = [];       // e.g. ['processing','complete']
const NEWWEB_V2_MAX_PAGES       = 5;        // limit pages per execution to avoid quota spikes
const NEWWEB_V2_PAGE_SIZE       = 200;
const NEWWEB_V2_LOOKBACK_DAYS   = 5;        // never fetch earlier than (today - N days) to keep window small

/************************************************************
 * Entry point
 ************************************************************/
function pollMagentoOrders_v2() {
  try {
  const sh      = ensureNewwebSheetV2_();
  const headers = ensureNewwebHeaderV2_(sh);
  const props   = PropertiesService.getScriptProperties();
  const checkpoint = props.getProperty(NEWWEB_V2_CHECKPOINT_KEY) || NEWWEB_V2_DEFAULT_START;
  const startAfter = computeEffectiveStartAfter_(checkpoint);
  logNewwebEvent_('INFO', 'NEWWEB v2 start', { checkpoint, startAfter, lookbackDays: NEWWEB_V2_LOOKBACK_DAYS });

  // Load customer lookup once per run (matches v1 behavior)
  globalCustomerLookup = loadCustomerLookup_();

  // Format SKU columns as text
  const skuCol  = headers.indexOf('SKU') + 1;
  const normCol = headers.indexOf('SKU (Normalized)') + 1;
  const maxRows = Math.max(sh.getMaxRows() - 1, 1);
  if (maxRows > 0) {
    if (skuCol)  sh.getRange(2, skuCol,  maxRows).setNumberFormat('@');
    if (normCol) sh.getRange(2, normCol, maxRows).setNumberFormat('@');
  }

  const existingIds = loadExistingOrderIds_(sh, headers);

  const { rows, lastWrittenCreatedAt } = fetchOrdersAndMapRows_(existingIds, headers, startAfter);
  if (!rows.length) {
    logNewwebEvent_('INFO', 'Engar nýjar pantanir frá Magento (v2)');
    return;
  }

  const startRow = sh.getLastRow() + 1;
  sh.insertRowsAfter(sh.getLastRow(), rows.length);
  sh.getRange(startRow, 1, rows.length, headers.length).setValues(rows);

  try {
    upsertNewwebRowsToSupabase_(headers, rows);
    logNewwebEvent_('INFO', 'Supabase upsert ok', { rows: rows.length });
  } catch (e) {
    logNewwebEvent_('ERROR', 'Supabase upsert failed', serializeError_(e));
  }

  if (lastWrittenCreatedAt) {
    const checkpointIso = new Date(lastWrittenCreatedAt).toISOString();
    PropertiesService.getScriptProperties()
      .setProperty(NEWWEB_V2_CHECKPOINT_KEY, checkpointIso);
  }

  applyStylingTo("WEBSALES", { sortBy: "Purchase Date", zebra: true });

  const checkpointValue = lastWrittenCreatedAt || startAfter;
  logNewwebEvent_('INFO', 'NEWWEB v2 import completed', {
    inserted: rows.length,
    checkpoint: checkpointValue
  });
  } catch (e) {
    logNewwebEvent_('ERROR', 'pollMagentoOrders_v2 failed', serializeError_(e));
    throw e;
  }
}

function upsertNewwebRowsToSupabase_(headers, rows) {
  if (!rows || !rows.length) return;

  const cfg = loadConfig_();
  const baseUrlRaw = cfg.ENDPOINTS && cfg.ENDPOINTS.SUPABASE && cfg.ENDPOINTS.SUPABASE.REST_URL;
  const baseUrl = String(baseUrlRaw || '').replace(/\/$/, '');
  const serviceRole = cfg.API && cfg.API.SUPABASE && cfg.API.SUPABASE.SERVICE_ROLE_KEY;
  const apiKey = serviceRole;
  const bearer = serviceRole;

  if (!baseUrl) {
    throw new Error('Supabase config missing ENDPOINTS.SUPABASE.REST_URL');
  }
  if (!serviceRole) {
    throw new Error('Supabase config missing API.SUPABASE.SERVICE_ROLE_KEY (legacy service_role JWT)');
  }

  const i = {};
  headers.forEach((h, idx) => { i[h] = idx; });

  const payload = rows.map(r => {
    const purchaseDate = r[i['Purchase Date']];
    const parsedDate = purchaseDate ? new Date(purchaseDate) : null;
    const iso = (parsedDate && !isNaN(parsedDate.getTime())) ? parsedDate.toISOString() : null;
    return {
      order_id: String(r[i['ID']] || ''),
      purchase_date: iso,
      purchase_point: r[i['Purchase Point']] || null,
      ship_to_name: r[i['Ship-to Name']] || null,
      subtotal_excl: toNum_(r[i['Subtotal (Excl Tax)']]),
      subtotal_incl: toNum_(r[i['Subtotal (Incl Tax)']]),
      tax_amount: toNum_(r[i['Tax Amount']]),
      grand_total: toNum_(r[i['Grand Total (Purchased)']]),
      customer_name: r[i['Customer Name']] || null,
      company_name: r[i['Company Name']] || null,
      company_id: r[i['Company ID']] || null,
      real_email: r[i['Real Email']] || null,
      region: r[i['Region']] || null,
      national_id: r[i['National ID']] || null,
      payment_method: r[i['Payment Method']] || null,
      status: r[i['Status']] || null,
      sku: r[i['SKU']] || null,
      sku_normalized: r[i['SKU (Normalized)']] || null,
      product_name: r[i['Product Name']] || null,
      qty: toNum_(r[i['Qty']]),
      items: r[i['Items']] || null,
      source: 'newsales_v2'
    };
  }).filter(x => x.order_id);

  if (!payload.length) return;

  const endpoint = baseUrl + '/newweb_orders_raw?on_conflict=order_id';
  const chunkSize = 200;

  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const chunk = payload.slice(offset, offset + chunkSize);
    const res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: apiKey,
        Authorization: 'Bearer ' + bearer,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
  }
}

function resetNewwebCheckpoint_v2(start) {
  PropertiesService.getScriptProperties()
    .setProperty(NEWWEB_V2_CHECKPOINT_KEY, start || NEWWEB_V2_DEFAULT_START);
  logNewwebEvent_('INFO', 'Reset NEWWEB v2 checkpoint', { start: start || NEWWEB_V2_DEFAULT_START });
}

function backfillNewwebSheetToSupabase_v2() {
  const sh = ensureNewwebSheetV2_();
  const headers = ensureNewwebHeaderV2_(sh);
  const lastRow = sh.getLastRow();
  const totalRows = Math.max(0, lastRow - 1);

  if (!totalRows) {
    logNewwebEvent_('INFO', 'NEWWEB backfill skipped: no rows in sheet');
    return { totalRows: 0, processed: 0 };
  }

  const allRows = sh.getRange(2, 1, totalRows, headers.length).getValues();
  const batchSize = 1000;
  let processed = 0;

  for (let offset = 0; offset < allRows.length; offset += batchSize) {
    const chunk = allRows.slice(offset, offset + batchSize);
    upsertNewwebRowsToSupabase_(headers, chunk);
    processed += chunk.length;
    logNewwebEvent_('INFO', 'NEWWEB backfill batch uploaded', { processed, totalRows });
  }

  logNewwebEvent_('INFO', 'NEWWEB backfill completed', { totalRows, processed });
  return { totalRows, processed };
}

function debugSupabaseConfig_v2() {
  const cfg = loadConfig_();
  const restUrl = cfg.ENDPOINTS && cfg.ENDPOINTS.SUPABASE && cfg.ENDPOINTS.SUPABASE.REST_URL;
  const serviceRole = cfg.API && cfg.API.SUPABASE && cfg.API.SUPABASE.SERVICE_ROLE_KEY;
  const secretKey = cfg.API && cfg.API.SUPABASE && cfg.API.SUPABASE.SECRET_KEY;

  logNewwebEvent_('INFO', 'Supabase config debug', {
    restUrl: restUrl || '',
    serviceRolePrefix: serviceRole ? String(serviceRole).slice(0, 12) : '',
    secretPrefix: secretKey ? String(secretKey).slice(0, 12) : ''
  });

  return {
    restUrl: restUrl || '',
    serviceRolePrefix: serviceRole ? String(serviceRole).slice(0, 12) : '',
    secretPrefix: secretKey ? String(secretKey).slice(0, 12) : ''
  };
}

/************************************************************
 * Fetch + map
 ************************************************************/
function fetchOrdersAndMapRows_(existingIds, headers, startAfter) {
  const mappedRows = [];
  let lastWrittenCreatedAt = null;
  let currentPage = 1;
  const statusFilter = NEWWEB_V2_STATUS_FILTER.map(s => String(s || '').toLowerCase());

  for (; currentPage <= NEWWEB_V2_MAX_PAGES; currentPage++) {
    const { items, hasMore, newest, headerSource } = fetchMagentoPage_(startAfter, currentPage);
    logNewwebEvent_('INFO', 'NEWWEB v2 page fetched', {
      page: currentPage,
      count: items.length,
      hasMore,
      newest,
      headerSource
    });
    if (!items.length) break;

    // Optional status filter
    const filtered = statusFilter.length
      ? items.filter(o => statusFilter.includes(String(o.status || '').toLowerCase()))
      : items;

    const newOnes = filtered.filter(o => !existingIds.has(String(o.increment_id)));
    if (!newOnes.length && !hasMore) break;

    const { rows, maxCreatedAt } = mapOrdersToOrderRowsWithMax_(newOnes, headers);
    mappedRows.push(...rows);

    if (maxCreatedAt && (!lastWrittenCreatedAt || maxCreatedAt > lastWrittenCreatedAt)) {
      lastWrittenCreatedAt = maxCreatedAt;
    }

    if (!hasMore) break;
  }

  return { rows: mappedRows, lastWrittenCreatedAt };
}

function fetchMagentoPage_(createdAfter, page) {
  const CONFIG = loadConfig_();
  const base = String(CONFIG.ENDPOINTS.Magento.BASE_URL || '').replace(/\/$/, '');
  const pageSize = NEWWEB_V2_PAGE_SIZE;

  const url =
    `${base}/orders` +
    `?searchCriteria[filter_groups][0][filters][0][field]=created_at` +
    `&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(createdAfter)}` +
    `&searchCriteria[filter_groups][0][filters][0][condition_type]=gt` +
    `&searchCriteria[pageSize]=${pageSize}` +
    `&searchCriteria[currentPage]=${page}`;

  const headerInfo = magentoHeaders_v2_();
  let res;
  let status;
  let headersUsed = headerInfo.headers;
  let headerSource = headerInfo.source;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: headersUsed,
      muteHttpExceptions: true
    });
    status = res.getResponseCode();
  } catch (e) {
    logNewwebEvent_('ERROR', 'UrlFetch exception (v2)', { url, message: e && e.message, stack: e && e.stack });
    throw e;
  }

  if ((status === 401 || status === 403) && headerInfo.source === 'configToken') {
    // Retry once with admin token if the configured token lacks permissions.
    try {
      headersUsed = magentoHeaders_();
      headerSource = 'adminToken';
      res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: headersUsed,
        muteHttpExceptions: true
      });
      status = res.getResponseCode();
    } catch (e) {
      logNewwebEvent_('ERROR', 'UrlFetch exception on retry (v2)', { url, message: e && e.message, stack: e && e.stack });
      throw e;
    }
  }

  if ((status === 401 || status === 403) && headerSource === 'adminToken') {
    // Admin tokens commonly expire (often ~4h). Refresh cached token and retry once.
    const props = PropertiesService.getScriptProperties();
    const backoffKey = 'MAGENTO_ADMIN_TOKEN_REFRESH_BACKOFF_UNTIL';
    const backoffUntil = Number(props.getProperty(backoffKey) || 0);
    if (backoffUntil && Date.now() < backoffUntil) {
      logNewwebEvent_('WARN', 'Skipping admin token refresh due to backoff', { status, url, backoffUntil });
    } else {
      logNewwebEvent_('WARN', 'Magento admin token unauthorized; refreshing', { status, url });
      try {
        headersUsed = magentoHeaders_({ forceRefresh: true });
        headerSource = 'adminTokenRefreshed';
        res = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: headersUsed,
          muteHttpExceptions: true
        });
        status = res.getResponseCode();
        if (status === 200) {
          props.deleteProperty(backoffKey);
        } else if (status === 401 || status === 403) {
          props.setProperty(backoffKey, String(Date.now() + 30 * 60 * 1000)); // 30 min
        }
      } catch (e) {
        logNewwebEvent_('ERROR', 'UrlFetch exception on admin refresh retry (v2)', { url, message: e && e.message, stack: e && e.stack });
        throw e;
      }
    }
  }

  if (status !== 200) {
    logNewwebEvent_('ERROR', 'UrlFetch non-200 (v2)', {
      url,
      status,
      body: res.getContentText(),
      headerSource
    });
    return { items: [], hasMore: false, newest: null };
  }

  const json = JSON.parse(res.getContentText());
  const items = json.items || [];
  if (!items.length) {
    logNewwebEvent_('INFO', 'NEWWEB v2 empty page', {
      page,
      createdAfter,
      status,
      body: truncateBody_(res.getContentText()),
      headerSource
    });
  }
  const newest = items.reduce(
    (best, o) => (!best || (o.created_at && o.created_at > best)) ? o.created_at : best,
    null
  );

  const hasMore = items.length === pageSize;
  return { items, hasMore, newest, headerSource };
}

/************************************************************
 * Start-after clamp (checkpoint with rolling lookback)
 ************************************************************/
function computeEffectiveStartAfter_(checkpoint) {
  const parsedCheckpoint = parseDate_(checkpoint) || parseDate_(NEWWEB_V2_DEFAULT_START);
  const now = new Date();
  const floor = new Date(now.getTime() - NEWWEB_V2_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  floor.setHours(0,0,0,0);
  const effective = new Date(Math.max(parsedCheckpoint.getTime(), floor.getTime()));
  return formatMagentoDate_(effective);
}

function parseDate_(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatMagentoDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd HH:mm:ss');
}

function truncateBody_(str, maxLen) {
  const limit = maxLen || 400;
  if (!str) return '';
  const s = String(str);
  return s.length > limit ? s.slice(0, limit) + '...' : s;
}

/************************************************************
 * Build rows + track latest created_at written
 ************************************************************/
function mapOrdersToOrderRowsWithMax_(orders, headers) {
  if (!orders || !orders.length) return { rows: [], maxCreatedAt: null };

  const rows = mapOrdersToOrderRows_(orders, headers);

  const maxDate = orders.reduce((best, o) => {
    const d = new Date(o.created_at);
    if (!d || isNaN(d.getTime())) return best;
    if (!best || d > best) return d;
    return best;
  }, null);

  const maxIso = maxDate ? maxDate.toISOString() : null;
  return { rows, maxCreatedAt: maxIso };
}

/************************************************************
 * Helpers
 ************************************************************/
function ensureNewwebSheetV2_() {
  const CONFIG = loadConfig_();
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS.WEBSALES.ID);
  const sheetName = CONFIG.SHEETS.WEBSALES.NAME || NEWWEB_V2_SHEET_NAME;
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  return sh;
}

function ensureNewwebHeaderV2_(sh) {
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
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return headers;
  }

  const existing = sh.getRange(1, 1, 1, headers.length).getValues()[0].map(String);
  if (existing.join('|') !== headers.join('|')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return headers;
}

function loadExistingOrderIds_(sh, headers) {
  const idCol = headers.indexOf('ID') + 1;
  const last  = sh.getLastRow();
  let existingIds = [];
  if (last > 1) {
    existingIds = sh.getRange(2, idCol, last - 1, 1)
      .getValues().flat().map(String).filter(Boolean);
  }
  return new Set(existingIds);
}

/************************************************************
 * Auth headers v2
 ************************************************************/
function magentoHeaders_v2_() {
  const cfg = loadConfig_();
  const tokenFromConfig = cfg.API && cfg.API.Magento && cfg.API.Magento.TOKEN;
  if (tokenFromConfig) {
    return {
      headers: {
        "Authorization": "Bearer " + tokenFromConfig,
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      source: 'configToken'
    };
  }
  // Fallback to admin token if config token missing
  return { headers: magentoHeaders_(), source: 'adminToken' };
}

/************************************************************
 * Error serialization helper (to get message/stack in logs)
 ************************************************************/
function serializeError_(e) {
  if (!e) return { message: '', stack: '', name: '' };
  return {
    name: e.name || '',
    message: e.message || String(e),
    stack: e.stack || '',
    details: (() => {
      try { return JSON.stringify(e); } catch (_) { return String(e); }
    })()
  };
}

/************************************************************
 * Backward-compatible logging (already enhanced in newsales.js)
 ************************************************************/
function logNewwebEvent_(lvl, msg, extra) {
  lvl = lvl || 'INFO';
  msg = msg || '';
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
 * Safe Poll wrapper (v2)
 ************************************************************/
function safePoll_v2() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logNewwebEvent_('WARN', 'Another v2 run in progress');
    return;
  }
  try {
    pollMagentoOrders_v2();
  } catch (e) {
    logNewwebEvent_('ERROR', 'safePoll_v2 exception', serializeError_(e));
  } finally {
    lock.releaseLock();
  }
}

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

// Status delta sync (catches pending -> paid, cancellations, etc. after first ingest)
const NEWWEB_V2_STATUS_SYNC_KEY           = 'NEWWEB_V2_STATUS_SYNC_AT';
const NEWWEB_V2_STATUS_SYNC_LOOKBACK_DAYS = 7;   // first-run window when no checkpoint exists
const NEWWEB_V2_STATUS_SYNC_MAX_PAGES     = 10;  // 10 * 200 = 2000 changed orders per run

var globalCustomerLookup = null;

// Statuses considered terminal for reconcile purposes. Anything NOT in this set
// (incl. blank) is re-checked against Magento so 'pending'/'processing' -> 'paid'
// transitions that happen after first ingest get picked up.
// Observed Magento order statuses on this store: pending, processing, paid, complete.
// 'pending' and 'processing' are non-terminal (re-checked); 'paid'/'complete' are final.
// closed/canceled kept for forward-compat (refunds/cancellations) though unseen today.
var NEWWEB_FINAL_STATUSES_V2 = ['paid', 'complete', 'closed', 'canceled', 'cancelled'];

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
  sh.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  try {
    sortNewwebByPurchaseDate_v2_(sh, headers);
  } catch (e) {
    logNewwebEvent_('WARN', 'Lightweight sort failed', serializeError_(e));
  }

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

  if (shouldApplyNewwebStyling_v2_()) {
    try {
      applyStylingTo("WEBSALES", { sortBy: "Purchase Date", zebra: true });
    } catch (e) {
      logNewwebEvent_('WARN', 'Skipping styling due to error', serializeError_(e));
    }
  }

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

function reconcileNewwebMissingData_v2() {
  return reconcileNewwebMissingDataWindow_v2_({
    scanRows: 500,
    maxRepairs: 150
  });
}

function reconcileNewwebMissingDataWindow_v2_(options) {
  var opts = options || {};
  var scanRows = Math.max(1, Number(opts.scanRows || 500));
  var maxRepairs = Math.max(1, Number(opts.maxRepairs || 150));

  var sh = ensureNewwebSheetV2_();
  var headers = ensureNewwebHeaderV2_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) {
    logNewwebEvent_('INFO', 'NEWWEB reconcile skipped: no data rows');
    return { scanned: 0, candidates: 0, repaired: 0, statusUpdated: 0, missingInMagento: 0 };
  }

  var idx = {};
  headers.forEach(function(h, i) { idx[h] = i; });
  var required = ['Company Name', 'Company ID', 'Real Email', 'Region', 'National ID'];
  var startRow = 2;
  var rowsAvailable = lastRow - 1;
  var rowsToScan = Math.min(scanRows, rowsAvailable);
  var values = sh.getRange(startRow, 1, rowsToScan, headers.length).getValues();

  var byOrderId = {};
  var candidates = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var orderId = String(row[idx['ID']] || '').trim();
    if (!orderId) continue;
    if (byOrderId[orderId]) continue;
    var missing = rowHasMissingFields_v2_(row, idx, required);
    var staleStatus = rowHasNonFinalStatus_v2_(row, idx);
    if (!missing && !staleStatus) continue;
    byOrderId[orderId] = true;
    candidates.push({
      sheetRow: startRow + i,
      orderId: orderId,
      row: row
    });
    if (candidates.length >= maxRepairs) break;
  }

  if (!candidates.length) {
    logNewwebEvent_('INFO', 'NEWWEB reconcile: no rows with missing enrichment', {
      scanned: values.length,
      startRow: startRow,
      scanDirection: 'top'
    });
    return { scanned: values.length, candidates: 0, repaired: 0, statusUpdated: 0, missingInMagento: 0 };
  }

  logNewwebEvent_('INFO', 'NEWWEB reconcile start', {
    scanned: values.length,
    candidates: candidates.length,
    startRow: startRow,
    scanDirection: 'top'
  });

  var repairedRows = [];
  var repaired = 0;
  var statusUpdated = 0;
  var missingInMagento = 0;
  try {
    globalCustomerLookup = loadCustomerLookup_();
  } catch (e) {
    logNewwebEvent_('WARN', 'NEWWEB reconcile lookup load failed', serializeError_(e));
  }

  for (var c = 0; c < candidates.length; c++) {
    var cand = candidates[c];
    var order = fetchMagentoOrderByIncrementId_v2_(cand.orderId);
    if (!order) {
      missingInMagento++;
      continue;
    }

    var mapped = mapOrdersToOrderRows_([order], headers);
    if (!mapped || !mapped.length) continue;

    var afterMissing = applyMissingFieldsFromRow_v2_(cand.row, mapped[0], idx, required);
    var afterStatus = applyStatusFromRow_v2_(afterMissing.row, mapped[0], idx);
    if (!afterMissing.changed && !afterStatus.changed) continue;
    if (afterStatus.changed) statusUpdated++;

    sh.getRange(cand.sheetRow, 1, 1, headers.length).setValues([afterStatus.row]);
    repairedRows.push(afterStatus.row);
    repaired++;
  }

  if (repairedRows.length) {
    try {
      upsertNewwebRowsToSupabase_(headers, repairedRows);
      logNewwebEvent_('INFO', 'NEWWEB reconcile Supabase upsert ok', { rows: repairedRows.length });
    } catch (e) {
      logNewwebEvent_('ERROR', 'NEWWEB reconcile Supabase upsert failed', serializeError_(e));
    }
  }

  logNewwebEvent_('INFO', 'NEWWEB reconcile completed', {
    scanned: values.length,
    candidates: candidates.length,
    repaired: repaired,
    statusUpdated: statusUpdated,
    missingInMagento: missingInMagento
  });

  return {
    scanned: values.length,
    candidates: candidates.length,
    repaired: repaired,
    statusUpdated: statusUpdated,
    missingInMagento: missingInMagento
  };
}

/************************************************************
 * Full status match — scan the ENTIRE sheet (not a window)
 * --------------------------------------------------------
 * Targets every row that is not in a terminal status (or has
 * missing enrichment), re-fetches it from Magento, and fixes
 * it. Cannot miss a stuck row regardless of age. Self-resuming:
 * a fixed pending->paid row becomes terminal and drops out of
 * the candidate set on the next run, so re-run until done:true.
 * Honours a wall-clock budget to stay under the GAS time limit.
 ************************************************************/
function reconcileNewwebAllStatuses_v2(options) {
  var opts = options || {};
  var maxRepairs = Math.max(1, Number(opts.maxRepairs || 100000));
  var timeBudgetMs = Math.max(30000, Number(opts.timeBudgetMs || 300000)); // ~5 min default
  var startMs = Date.now();

  var sh = ensureNewwebSheetV2_();
  var headers = ensureNewwebHeaderV2_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) {
    logNewwebEvent_('INFO', 'NEWWEB full reconcile skipped: no data rows');
    return { scanned: 0, candidates: 0, processed: 0, repaired: 0, statusUpdated: 0, missingInMagento: 0, remaining: 0, done: true };
  }

  var idx = {};
  headers.forEach(function(h, i) { idx[h] = i; });
  var required = ['Company Name', 'Company ID', 'Real Email', 'Region', 'National ID'];

  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();

  var byOrderId = {};
  var candidates = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var orderId = String(row[idx['ID']] || '').trim();
    if (!orderId || byOrderId[orderId]) continue;
    if (!rowHasMissingFields_v2_(row, idx, required) && !rowHasNonFinalStatus_v2_(row, idx)) continue;
    byOrderId[orderId] = true;
    candidates.push({ sheetRow: 2 + i, orderId: orderId, row: row });
  }

  var totalCandidates = candidates.length;
  if (!totalCandidates) {
    logNewwebEvent_('INFO', 'NEWWEB full reconcile: no candidates (all statuses final, fields present)');
    return { scanned: values.length, candidates: 0, processed: 0, repaired: 0, statusUpdated: 0, missingInMagento: 0, remaining: 0, done: true };
  }

  try {
    globalCustomerLookup = loadCustomerLookup_();
  } catch (e) {
    logNewwebEvent_('WARN', 'NEWWEB full reconcile lookup load failed', serializeError_(e));
  }

  logNewwebEvent_('INFO', 'NEWWEB full reconcile start', {
    scanned: values.length,
    candidates: totalCandidates,
    timeBudgetMs: timeBudgetMs
  });

  var repairedRows = [];
  var repaired = 0, statusUpdated = 0, missingInMagento = 0, processed = 0;
  var pausedByBudget = false;

  for (var c = 0; c < candidates.length; c++) {
    if (processed >= maxRepairs) break;
    if ((Date.now() - startMs) > timeBudgetMs) { pausedByBudget = true; break; }

    var cand = candidates[c];
    var order = fetchMagentoOrderByIncrementId_v2_(cand.orderId);
    processed++;
    if (!order) { missingInMagento++; continue; }

    var mapped = mapOrdersToOrderRows_([order], headers);
    if (!mapped || !mapped.length) continue;

    var afterMissing = applyMissingFieldsFromRow_v2_(cand.row, mapped[0], idx, required);
    var afterStatus = applyStatusFromRow_v2_(afterMissing.row, mapped[0], idx);
    if (!afterMissing.changed && !afterStatus.changed) continue;
    if (afterStatus.changed) statusUpdated++;

    sh.getRange(cand.sheetRow, 1, 1, headers.length).setValues([afterStatus.row]);
    repairedRows.push(afterStatus.row);
    repaired++;
  }

  if (repairedRows.length) {
    try {
      upsertNewwebRowsToSupabase_(headers, repairedRows);
      logNewwebEvent_('INFO', 'NEWWEB full reconcile Supabase upsert ok', { rows: repairedRows.length });
    } catch (e) {
      logNewwebEvent_('ERROR', 'NEWWEB full reconcile Supabase upsert failed', serializeError_(e));
    }
  }

  var remaining = totalCandidates - processed;
  var done = !pausedByBudget && remaining <= 0;

  var result = {
    scanned: values.length,
    candidates: totalCandidates,
    processed: processed,
    repaired: repaired,
    statusUpdated: statusUpdated,
    missingInMagento: missingInMagento,
    remaining: remaining,
    pausedByBudget: pausedByBudget,
    done: done
  };
  logNewwebEvent_('INFO', 'NEWWEB full reconcile completed', result);
  return result;
}

/************************************************************
 * Status delta sync — bulk "what changed since last check"
 * --------------------------------------------------------
 * Asks Magento for every order with updated_at > checkpoint
 * (ascending) and refreshes Status + enrichment on matching
 * sheet rows. O(changed orders), not O(open orders). Catches
 * pending->paid, cancellations, refunds, late B2B fields.
 * Existing rows only; new orders are owned by safePoll_v2.
 ************************************************************/
function syncNewwebOrderStatus_v2() {
  var sh = ensureNewwebSheetV2_();
  var headers = ensureNewwebHeaderV2_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow <= 1) {
    logNewwebEvent_('INFO', 'NEWWEB status sync skipped: no data rows');
    return { fetched: 0, matched: 0, statusUpdated: 0, fieldsRepaired: 0, unseenInSheet: 0 };
  }

  var idx = {};
  headers.forEach(function(h, i) { idx[h] = i; });
  var idCol = idx['ID'];

  // Map increment_id -> { sheetRow, row } from current sheet contents (one read).
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rowByOrderId = {};
  for (var i = 0; i < values.length; i++) {
    var oid = String(values[i][idCol] || '').trim();
    if (oid && !rowByOrderId[oid]) {
      rowByOrderId[oid] = { sheetRow: 2 + i, row: values[i] };
    }
  }

  var props = PropertiesService.getScriptProperties();
  var checkpoint = props.getProperty(NEWWEB_V2_STATUS_SYNC_KEY);
  var startAfter = computeStatusSyncStartAfter_v2_(checkpoint);

  try {
    globalCustomerLookup = loadCustomerLookup_();
  } catch (e) {
    logNewwebEvent_('WARN', 'NEWWEB status sync lookup load failed', serializeError_(e));
  }

  var required = ['Company Name', 'Company ID', 'Real Email', 'Region', 'National ID'];
  var fetched = 0, matched = 0, statusUpdated = 0, fieldsRepaired = 0, unseenInSheet = 0;
  var maxUpdatedAt = null;
  var repairedRows = [];

  logNewwebEvent_('INFO', 'NEWWEB status sync start', { startAfter: startAfter, checkpoint: checkpoint || '(none)' });

  for (var page = 1; page <= NEWWEB_V2_STATUS_SYNC_MAX_PAGES; page++) {
    var out = fetchMagentoOrdersByUpdatedAt_v2_(startAfter, page);
    var items = (out && out.items) || [];
    logNewwebEvent_('INFO', 'NEWWEB status sync page', { page: page, count: items.length });
    if (!items.length) break;

    var mapped = mapOrdersToOrderRows_(items, headers);
    for (var m = 0; m < mapped.length; m++) {
      fetched++;
      var mappedRow = mapped[m];

      // Ascending sort by updated_at => last processed is the safe checkpoint.
      var ua = items[m] && items[m].updated_at;
      if (ua && (!maxUpdatedAt || ua > maxUpdatedAt)) maxUpdatedAt = ua;

      var oid = String(mappedRow[idCol] || '').trim();
      var target = oid ? rowByOrderId[oid] : null;
      if (!target) { unseenInSheet++; continue; }
      matched++;

      var afterMissing = applyMissingFieldsFromRow_v2_(target.row, mappedRow, idx, required);
      var afterStatus = applyStatusFromRow_v2_(afterMissing.row, mappedRow, idx);
      if (!afterMissing.changed && !afterStatus.changed) continue;
      if (afterMissing.changed) fieldsRepaired++;
      if (afterStatus.changed) statusUpdated++;

      sh.getRange(target.sheetRow, 1, 1, headers.length).setValues([afterStatus.row]);
      target.row = afterStatus.row;
      repairedRows.push(afterStatus.row);
    }

    if (items.length < NEWWEB_V2_PAGE_SIZE) break;
  }

  if (repairedRows.length) {
    try {
      upsertNewwebRowsToSupabase_(headers, repairedRows);
      logNewwebEvent_('INFO', 'NEWWEB status sync Supabase upsert ok', { rows: repairedRows.length });
    } catch (e) {
      logNewwebEvent_('ERROR', 'NEWWEB status sync Supabase upsert failed', serializeError_(e));
    }
  }

  if (maxUpdatedAt) {
    var iso = new Date(maxUpdatedAt).toISOString();
    props.setProperty(NEWWEB_V2_STATUS_SYNC_KEY, iso);
  }

  var result = {
    fetched: fetched,
    matched: matched,
    statusUpdated: statusUpdated,
    fieldsRepaired: fieldsRepaired,
    unseenInSheet: unseenInSheet,
    checkpoint: maxUpdatedAt
  };
  logNewwebEvent_('INFO', 'NEWWEB status sync completed', result);
  return result;
}

function fetchMagentoOrdersByUpdatedAt_v2_(updatedAfter, page) {
  var CONFIG = loadConfig_();
  var base = String(CONFIG.ENDPOINTS.Magento.BASE_URL || '').replace(/\/$/, '');
  var url =
    base + '/orders' +
    '?searchCriteria[filter_groups][0][filters][0][field]=updated_at' +
    '&searchCriteria[filter_groups][0][filters][0][value]=' + encodeURIComponent(updatedAfter) +
    '&searchCriteria[filter_groups][0][filters][0][condition_type]=gt' +
    '&searchCriteria[sortOrders][0][field]=updated_at' +
    '&searchCriteria[sortOrders][0][direction]=ASC' +
    '&searchCriteria[pageSize]=' + NEWWEB_V2_PAGE_SIZE +
    '&searchCriteria[currentPage]=' + page;

  var out = fetchMagentoJsonWithRetry_v2_(url);
  if (!out || out.status !== 200 || !out.json) return { items: [] };
  return { items: out.json.items || [] };
}

function computeStatusSyncStartAfter_v2_(checkpoint) {
  var parsed = parseDate_(checkpoint);
  if (parsed) return formatMagentoDate_(parsed); // checkpoint only ever moves forward
  var floor = new Date(Date.now() - NEWWEB_V2_STATUS_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return formatMagentoDate_(floor);
}

function resetNewwebStatusSyncCheckpoint_v2(start) {
  if (start) {
    PropertiesService.getScriptProperties().setProperty(NEWWEB_V2_STATUS_SYNC_KEY, start);
  } else {
    PropertiesService.getScriptProperties().deleteProperty(NEWWEB_V2_STATUS_SYNC_KEY);
  }
  logNewwebEvent_('INFO', 'Reset NEWWEB status sync checkpoint', { start: start || '(default lookback)' });
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

function rowHasMissingFields_v2_(row, idx, fields) {
  for (var i = 0; i < fields.length; i++) {
    var col = idx[fields[i]];
    if (col == null) continue;
    if (isMissingCellValue_v2_(row[col])) return true;
  }
  return false;
}

function applyMissingFieldsFromRow_v2_(targetRow, sourceRow, idx, fields) {
  var out = targetRow.slice();
  var changed = false;
  for (var i = 0; i < fields.length; i++) {
    var key = fields[i];
    var col = idx[key];
    if (col == null) continue;
    if (!isMissingCellValue_v2_(out[col])) continue;
    if (isMissingCellValue_v2_(sourceRow[col])) continue;
    out[col] = sourceRow[col];
    changed = true;
  }
  return { row: out, changed: changed };
}

function isMissingCellValue_v2_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// True when the row's Status is not terminal (blank counts as non-terminal),
// i.e. it may have advanced in Magento (e.g. pending -> paid) since first ingest.
function rowHasNonFinalStatus_v2_(row, idx) {
  var col = idx['Status'];
  if (col == null) return false;
  var s = String(row[col] == null ? '' : row[col]).trim().toLowerCase();
  return NEWWEB_FINAL_STATUSES_V2.indexOf(s) === -1;
}

// Overwrites Status from the freshly fetched Magento row when it differs.
// Unlike applyMissingFieldsFromRow_v2_, this replaces an existing value.
function applyStatusFromRow_v2_(targetRow, sourceRow, idx) {
  var col = idx['Status'];
  if (col == null) return { row: targetRow, changed: false };
  var fresh = String(sourceRow[col] == null ? '' : sourceRow[col]).trim();
  if (!fresh) return { row: targetRow, changed: false };
  var current = String(targetRow[col] == null ? '' : targetRow[col]).trim();
  if (fresh.toLowerCase() === current.toLowerCase()) return { row: targetRow, changed: false };
  var out = targetRow.slice();
  out[col] = sourceRow[col];
  return { row: out, changed: true };
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

function fetchMagentoOrderByIncrementId_v2_(incrementId) {
  var id = String(incrementId || '').trim();
  if (!id) return null;

  var CONFIG = loadConfig_();
  var base = String(CONFIG.ENDPOINTS.Magento.BASE_URL || '').replace(/\/$/, '');
  var url =
    base + '/orders' +
    '?searchCriteria[filter_groups][0][filters][0][field]=increment_id' +
    '&searchCriteria[filter_groups][0][filters][0][value]=' + encodeURIComponent(id) +
    '&searchCriteria[filter_groups][0][filters][0][condition_type]=eq' +
    '&searchCriteria[pageSize]=1' +
    '&searchCriteria[currentPage]=1';

  var out = fetchMagentoJsonWithRetry_v2_(url);
  if (!out || out.status !== 200) return null;
  var items = out.json && out.json.items ? out.json.items : [];
  return items.length ? items[0] : null;
}

function fetchMagentoJsonWithRetry_v2_(url) {
  var headerInfo = magentoHeaders_v2_();
  var res;
  var status;
  var headersUsed = headerInfo.headers;
  var headerSource = headerInfo.source;

  try {
    res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: headersUsed,
      muteHttpExceptions: true
    });
    status = res.getResponseCode();
  } catch (e) {
    logNewwebEvent_('ERROR', 'UrlFetch exception (v2 helper)', { url: url, message: e && e.message, stack: e && e.stack });
    return { status: 0, json: null, headerSource: headerSource };
  }

  if ((status === 401 || status === 403) && headerInfo.source === 'configToken') {
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
      logNewwebEvent_('ERROR', 'UrlFetch exception on retry (v2 helper)', { url: url, message: e && e.message, stack: e && e.stack });
      return { status: 0, json: null, headerSource: headerSource };
    }
  }

  if ((status === 401 || status === 403) && headerSource === 'adminToken') {
    var props = PropertiesService.getScriptProperties();
    var backoffKey = 'MAGENTO_ADMIN_TOKEN_REFRESH_BACKOFF_UNTIL';
    var backoffUntil = Number(props.getProperty(backoffKey) || 0);
    if (!backoffUntil || Date.now() >= backoffUntil) {
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
          props.setProperty(backoffKey, String(Date.now() + 30 * 60 * 1000));
        }
      } catch (e) {
        logNewwebEvent_('ERROR', 'UrlFetch exception on admin refresh retry (v2 helper)', { url: url, message: e && e.message, stack: e && e.stack });
        return { status: 0, json: null, headerSource: headerSource };
      }
    }
  }

  if (status !== 200) {
    logNewwebEvent_('WARN', 'UrlFetch non-200 (v2 helper)', {
      url: url,
      status: status,
      body: res ? truncateBody_(res.getContentText()) : '',
      headerSource: headerSource
    });
    return { status: status, json: null, headerSource: headerSource };
  }

  try {
    return {
      status: status,
      json: JSON.parse(res.getContentText()),
      headerSource: headerSource
    };
  } catch (e) {
    logNewwebEvent_('ERROR', 'JSON parse failed (v2 helper)', { url: url, status: status, message: e && e.message });
    return { status: status, json: null, headerSource: headerSource };
  }
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
function mapOrdersToOrderRows_(orders, headers) {
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const rows = [];
  for (const o of orders) {
    const row = new Array(headers.length).fill('');

    const ext  = o.extension_attributes || {};
    const comp = ext.company_order_attributes || {};
    const b2bName = comp.company_name || '';
    const b2bId   = comp.company_id || '';

    const items   = o.items || [];
    const rawSku  = items.map(i => i.sku || '');
    const normSku = rawSku.map(normalizeSkuGlobal_);
    const names   = items.map(i => i.name || '');
    const qty     = items.reduce((a, i) => a + (i.qty_ordered || 0), 0);
    const customerName = [o.customer_firstname, o.customer_lastname].filter(Boolean).join(' ');

    let enriched = null;
    const lookup = (typeof globalCustomerLookup !== 'undefined' && globalCustomerLookup) ? globalCustomerLookup : null;
    if (lookup) {
      const L = lookup;
      if (o.customer_id) enriched = L.byId[String(o.customer_id)];
      if (!enriched && o.customer_email) enriched = L.byEmail[String(o.customer_email).toLowerCase()];
    }

    const finalCompanyName = b2bName || (enriched ? enriched.company_name : '');
    const finalCompanyId = b2bId || (enriched ? enriched.company_id : '');
    const finalRealEmail = enriched && enriched.real_email ? enriched.real_email : (o.customer_email || '');
    const finalRegion = enriched ? enriched.region : '';
    const finalNationalId = enriched ? enriched.national_id : '';

    row[idx['ID']] = o.increment_id || '';
    row[idx['Purchase Point']] = (o.store_name || '').split('\n')[0] || 'Main Website';
    row[idx['Purchase Date']] = toDate_(o.created_at);
    row[idx['Ship-to Name']] = o.customer_firstname || '';
    row[idx['Subtotal (Excl Tax)']] = Number(o.subtotal) || 0;
    row[idx['Subtotal (Incl Tax)']] = Number(o.subtotal_incl_tax) || 0;
    row[idx['Tax Amount']] = Number(o.tax_amount) || 0;
    row[idx['Grand Total (Purchased)']] = Number(o.grand_total) || 0;
    row[idx['Customer Name']] = customerName;
    row[idx['Company Name']] = finalCompanyName;
    row[idx['Company ID']] = finalCompanyId;
    row[idx['Real Email']] = finalRealEmail;
    row[idx['Region']] = finalRegion;
    row[idx['National ID']] = finalNationalId;
    row[idx['Payment Method']] = (o.payment && o.payment.method) || '';
    row[idx['Status']] = o.status || '';
    row[idx['SKU']] = rawSku.join(', ');
    row[idx['SKU (Normalized)']] = normSku.join(', ');
    row[idx['Product Name']] = names.join(', ');
    row[idx['Qty']] = qty;
    row[idx['Items']] = items.length + ' items';

    rows.push(row);
  }
  return rows;
}

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
  var windowDecision = getNewwebRunWindowDecision_v2_();
  if (!windowDecision.shouldRun) {
    logNewwebEvent_('INFO', 'Skipping run by schedule window', windowDecision);
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logNewwebEvent_('WARN', 'Another v2 run in progress');
    return;
  }
  try {
    pollMagentoOrders_v2();
  } catch (e) {
    var errObj = serializeError_(e);
    logNewwebEvent_('ERROR', 'safePoll_v2 exception', errObj);
    if (typeof notifyTriggerFailure_ === 'function') {
      try {
        notifyTriggerFailure_('safePoll_v2', errObj, { windowDecision: windowDecision });
      } catch (alertErr) {
        Logger.log('[NEWWEB][WARN] Failure alert failed: ' + alertErr);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/************************************************************
 * Scheduled status delta sync wrapper (v2)
 ************************************************************/
function scheduledNewwebStatusSync_v2() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    logNewwebEvent_('WARN', 'Status sync skipped: another run in progress');
    return;
  }
  try {
    return syncNewwebOrderStatus_v2();
  } catch (e) {
    var errObj = serializeError_(e);
    logNewwebEvent_('ERROR', 'scheduledNewwebStatusSync_v2 exception', errObj);
    if (typeof notifyTriggerFailure_ === 'function') {
      try {
        notifyTriggerFailure_('scheduledNewwebStatusSync_v2', errObj, {});
      } catch (alertErr) {
        Logger.log('[NEWWEB][WARN] Failure alert failed: ' + alertErr);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function shouldApplyNewwebStyling_v2_() {
  var props = PropertiesService.getScriptProperties();
  var key = 'NEWWEB_V2_LAST_STYLE_AT_MS';
  var now = Date.now();
  var minIntervalMs = 6 * 60 * 60 * 1000; // Style at most every 6 hours.
  var last = Number(props.getProperty(key) || 0);
  if (last && (now - last) < minIntervalMs) return false;
  props.setProperty(key, String(now));
  return true;
}

function sortNewwebByPurchaseDate_v2_(sh, headers) {
  var dateCol = headers.indexOf('Purchase Date') + 1;
  if (dateCol < 1) return;
  var lastRow = sh.getLastRow();
  if (lastRow <= 2) return;
  sh.getRange(2, 1, lastRow - 1, headers.length).sort([{ column: dateCol, ascending: false }]);
}

function getNewwebRunWindowDecision_v2_() {
  var tz = Session.getScriptTimeZone() || 'GMT';
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, tz, 'H')); // 0..23
  var minute = Number(Utilities.formatDate(now, tz, 'm')); // 0..59

  // Night window OFF: 00:00-06:59
  if (hour >= 0 && hour < 7) {
    return {
      shouldRun: false,
      mode: 'off_night',
      timezone: tz,
      hour: hour,
      minute: minute
    };
  }

  // Business hours: every 5-minute trigger run (07:00-15:59)
  if (hour >= 7 && hour < 16) {
    return {
      shouldRun: true,
      mode: 'business_5m',
      timezone: tz,
      hour: hour,
      minute: minute
    };
  }

  // Evening: run only on quarter-hours (effective 15m on top of 5m trigger).
  var quarter = (minute % 15 === 0);
  return {
    shouldRun: quarter,
    mode: quarter ? 'evening_15m_run' : 'evening_15m_skip',
    timezone: tz,
    hour: hour,
    minute: minute
  };
}

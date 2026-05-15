/**
 * Storkaup KPI CORE - Custom Menu
 * Appears when the KPI spreadsheet is opened.
 */
'use strict';

function onOpen() {
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    Logger.log('Menu onOpen skipped (no UI context): ' + err);
    return;
  }

  const menu = ui.createMenu('Stórkaup KPI');

  menu
    .addItem('Refresh Customer Analysis', 'menu_buildCustomerAnalysis')
    .addItem('Fetch Web Orders (NEWWEB)', 'menu_refreshNEWWEB')
    .addItem('Build Sales Rep Onboarding', 'menu_buildSalesRepOnboarding')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Sales Tools')
        .addItem('Build Daily', 'menu_buildSalesDaily')
        .addItem('Build Weekly', 'menu_buildSalesWeekly')
        .addItem('Build Monthly', 'menu_buildSalesMonthly')
        .addItem('Build All', 'menu_refreshSalesSummaries')
    )
    .addSubMenu(
      ui.createMenu('NEWWEB Tools')
        .addItem('Reset NEWWEB v2 checkpoint', 'menu_resetNewwebCheckpointV2')
        .addItem('Reconcile missing NEWWEB fields', 'menu_reconcileNewwebMissingDataV2')
    )
    .addSubMenu(
      ui.createMenu('Tools')
        .addItem('Test Config', 'menu_testConfig')
        .addItem('Setup SEO Queue', 'menu_setupSeoQueue')
        .addItem('Seed SEO Queue from Cludo', 'menu_buildSeoQueueFromCludo')
        .addItem('Merge Meta SEO → SEO_QUEUE', 'menu_mergeSeoFromSheet')
        .addItem('Import SEO from Excel Sheet', 'menu_importSeoFromExcel')
        .addItem('Generate SEO for Selected Row', 'menu_runSeoSelectedRow')
        .addItem('Revise SEO for Selected Rows', 'menu_runReviseSelectedRows')
        .addItem('Generate SEO Batch', 'menu_runSeoBatch')
        .addItem('Fetch Current Meta from Web', 'menu_fetchCurrentSeoFromWeb')
        .addItem('Deduplicate SEO Queue', 'menu_deduplicateSeoQueue')
        .addItem('Debug Gemini Models', 'menu_debugGeminiModels')
        .addItem('Clear SEO Error Rows', 'menu_clearSeoErrorRows')
        .addItem('Clear Magento Token Cache', 'menu_clearMagentoTokenCache')
        .addItem('Run Klaviyo Sync', 'menu_runKlaviyoSync')
        .addItem('Show Runtime Cache', 'menu_showRuntimeCache')
    )
    .addSubMenu(
      ui.createMenu('Email')
        .addItem('Senda vikulegt yfirlit', 'menu_sendWelcomeEmail')
        .addSeparator()
        .addItem('Rafræn — senda redirect póst', 'menu_sendRafraenRedirect')
        .addItem('Rafræn — TEST redirect póst', 'menu_testRafraenRedirect')
        .addSeparator()
        .addItem('Umsókn — athuga BC stöðu', 'menu_checkUmsokn_BC')
        .addItem('Umsókn — senda email', 'menu_sendUmsokn_Email')
    )
    .addSubMenu(
      ui.createMenu('BC Sync')
        .addItem('📂 Importa BC skrár úr Drive Drop', 'menu_processBcDrop')
        .addItem('▶ Sync BC → Supabase (after manual import)', 'menu_runPostBcImportSync')
    )
    .addSubMenu(
      ui.createMenu('Admin')
        .addItem('Clear Customer Analysis', 'menu_clearCustomerAnalysis')
        .addItem('Clear All Summaries', 'menu_clearAllSummaries')
    )
    .addToUi();
}

/**
 * Installable trigger helper for standalone GAS projects.
 * Run once to attach this menu to the SALES_SUMMARIES spreadsheet.
 */
function installMenuTriggerForSalesSummaries() {
  const cfg = loadConfig_();
  if (!cfg.SHEETS || !cfg.SHEETS.SALES_SUMMARIES || !cfg.SHEETS.SALES_SUMMARIES.ID) {
    throw new Error('Missing SALES_SUMMARIES in config.SHEETS');
  }
  ScriptApp.newTrigger('onOpen')
    .forSpreadsheet(cfg.SHEETS.SALES_SUMMARIES.ID)
    .onOpen()
    .create();
}

function menu_buildCustomerAnalysis() {
  toast_('Building Customer Analysis...', 'KPI CORE');
  buildCustomerAnalysis();
  toast_('Customer Analysis updated.', 'KPI CORE');
}

function menu_refreshNEWWEB() {
  toast_('Fetching NEWWEB orders...', 'KPI CORE');
  if (typeof safePoll_v2 !== 'function') {
    throw new Error('safePoll_v2() not found. Ensure core/newsales_v2.js is deployed.');
  }
  safePoll_v2();

  toast_('NEWWEB updated.', 'KPI CORE');
}

function menu_resetNewwebCheckpointV2() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Reset NEWWEB v2 checkpoint',
    "Enter start date/time (e.g. 2025-07-15 00:00:00). Leave blank to use default.",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const start = String(resp.getResponseText() || '').trim();
  if (typeof resetNewwebCheckpoint_v2 !== 'function') {
    throw new Error('resetNewwebCheckpoint_v2() not found. Ensure core/newsales_v2.js is deployed.');
  }

  resetNewwebCheckpoint_v2(start || undefined);
  toast_('NEWWEB v2 checkpoint reset.', 'KPI CORE');
}

function menu_reconcileNewwebMissingDataV2() {
  toast_('Reconciling missing NEWWEB fields...', 'KPI CORE');
  if (typeof reconcileNewwebMissingData_v2 !== 'function') {
    throw new Error('reconcileNewwebMissingData_v2() not found. Ensure core/newsales_v2.js is deployed.');
  }
  var out = reconcileNewwebMissingData_v2();
  toast_('NEWWEB reconcile done. Repaired: ' + (out && out.repaired || 0), 'KPI CORE');
}

function menu_refreshSalesSummaries() {
  toast_('Rebuilding Sales Summaries...', 'KPI CORE');
  buildAll_v6();
  toast_('Sales Summaries updated.', 'KPI CORE');
}

function menu_buildSalesDaily() {
  toast_('Building Sales - Daily...', 'KPI CORE');
  if (typeof buildDailyReport === 'function') {
    buildDailyReport();
  } else {
    throw new Error('buildDailyReport() not found. Ensure core/salessummaries.js is deployed.');
  }
  toast_('Sales - Daily updated.', 'KPI CORE');
}

function menu_buildSalesWeekly() {
  toast_('Building Sales - Weekly...', 'KPI CORE');
  if (typeof buildWeeklyReport === 'function') {
    buildWeeklyReport();
  } else {
    throw new Error('buildWeeklyReport() not found. Ensure core/salessummaries.js is deployed.');
  }
  toast_('Sales - Weekly updated.', 'KPI CORE');
}

function menu_buildSalesMonthly() {
  toast_('Building Sales - Monthly...', 'KPI CORE');
  if (typeof buildMonthlyReport === 'function') {
    buildMonthlyReport();
  } else {
    throw new Error('buildMonthlyReport() not found. Ensure core/salessummaries.js is deployed.');
  }
  toast_('Sales - Monthly updated.', 'KPI CORE');
}

function menu_buildSalesRepOnboarding() {
  toast_('Building Sales Rep onboarding report...', 'KPI CORE');
  if (typeof buildSalesRepOnboardingReport === 'function') {
    buildSalesRepOnboardingReport();
  } else {
    throw new Error('buildSalesRepOnboardingReport() not found. Ensure core/salessummaries.js is deployed.');
  }
  toast_('Sales Rep onboarding report updated.', 'KPI CORE');
}

function menu_testConfig() {
  const cfg = loadConfig_();
  SpreadsheetApp.getUi().alert('CONFIG OK:\n\n' + JSON.stringify(cfg, null, 2));
}

function menu_setupSeoQueue() {
  if (typeof setupSeoQueueSheet_v1 !== 'function') {
    throw new Error('setupSeoQueueSheet_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  setupSeoQueueSheet_v1();
  toast_('SEO queue sheet ready.', 'KPI CORE');
}

function menu_mergeSeoFromSheet() {
  if (typeof mergeSeoFromSheet_v1 !== 'function') {
    throw new Error('mergeSeoFromSheet_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = mergeSeoFromSheet_v1('Meta SEO');
  toast_(
    'Merged: ' + ((out && out.matched) || 0) + ' rows updated in SEO_QUEUE from Meta SEO tab.',
    'KPI CORE'
  );
}

function menu_importSeoFromExcel() {
  if (typeof importSeoFromExcelSheet_v1 !== 'function') {
    throw new Error('importSeoFromExcelSheet_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Import SEO from Excel Sheet',
    'Enter the sheet name (tab name) of the imported Excel file:',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const sheetName = (resp.getResponseText() || '').trim() || 'Storkaup meta seo v2';
  const out = importSeoFromExcelSheet_v1(sheetName);
  toast_('Imported ' + ((out && out.imported) || 0) + ' rows from "' + sheetName + '"', 'KPI CORE');
}

function menu_buildSeoQueueFromCludo() {
  if (typeof buildSeoQueueFromCludo_v1 !== 'function') {
    throw new Error('buildSeoQueueFromCludo_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = buildSeoQueueFromCludo_v1();
  toast_('SEO queue seeded from Cludo: ' + ((out && out.rows) || 0), 'KPI CORE');
}

function menu_runSeoBatch() {
  if (typeof runSeoAutomationBatch_v1 !== 'function') {
    throw new Error('runSeoAutomationBatch_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = runSeoAutomationBatch_v1();
  toast_('SEO batch done. Generated: ' + ((out && out.successCount) || 0), 'KPI CORE');
}

function menu_runSeoSelectedRow() {
  if (typeof runSeoForSelectedRow_v1 !== 'function') {
    throw new Error('runSeoForSelectedRow_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = runSeoForSelectedRow_v1();
  toast_(
    'SEO generated for row ' + ((out && out.rowNumber) || '?') +
    ': ' + ((out && out.categoryName) || ''),
    'KPI CORE'
  );
}

function menu_runReviseSelectedRows() {
  if (typeof runReviseSeoForSelectedRows_v1 !== 'function') {
    throw new Error('runReviseSeoForSelectedRows_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = runReviseSeoForSelectedRows_v1();
  toast_(
    'SEO revised: ' + ((out && out.successCount) || 0) +
    ' rows. Skipped (approved): ' + ((out && out.skipped) || 0),
    'KPI CORE'
  );
}

function menu_fetchCurrentSeoFromWeb() {
  if (typeof fetchCurrentSeoFromWeb_v1 !== 'function') {
    throw new Error('fetchCurrentSeoFromWeb_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = fetchCurrentSeoFromWeb_v1({ limit: 50 });
  toast_(
    'Fetched: ' + ((out && out.fetched) || 0) +
    ' | Errors: ' + ((out && out.errors) || 0) +
    ' | Remaining: ' + ((out && out.skipped) || 0),
    'KPI CORE'
  );
}

function menu_deduplicateSeoQueue() {
  if (typeof deduplicateSeoQueue_v1 !== 'function') {
    throw new Error('deduplicateSeoQueue_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    'Deduplicate SEO Queue',
    'This will DELETE duplicate rows (same Category Name), keeping the best one per name (Approved > Generated > highest revenue).\n\nRun a dry-run first via the script editor: deduplicateSeoQueue_v1({ dryRun: true })\n\nProceed with deletion?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) {
    toast_('Deduplication cancelled.', 'KPI CORE');
    return;
  }
  var out = deduplicateSeoQueue_v1({});
  toast_('Deduplication done. Removed: ' + ((out && out.duplicates) || 0) + ' rows.', 'KPI CORE');
}

function menu_clearSeoErrorRows() {
  if (typeof clearSeoErrorRows_v1 !== 'function') {
    throw new Error('clearSeoErrorRows_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const out = clearSeoErrorRows_v1();
  toast_('SEO error rows cleared: ' + ((out && out.cleared) || 0), 'KPI CORE');
}

function menu_debugGeminiModels() {
  if (typeof debugAvailableGeminiModels_v1 !== 'function') {
    throw new Error('debugAvailableGeminiModels_v1() not found. Ensure core/seo_manager.js is deployed.');
  }
  const models = debugAvailableGeminiModels_v1();
  SpreadsheetApp.getUi().alert('Gemini models:\n\n' + models.join('\n'));
}

function menu_clearMagentoTokenCache() {
  if (typeof clearMagentoAdminTokenCache_ !== 'function') {
    throw new Error('clearMagentoAdminTokenCache_() not found. Ensure core/auth.js is deployed.');
  }
  clearMagentoAdminTokenCache_();
  toast_('Magento token cache cleared.', 'KPI CORE');
}

function menu_showRuntimeCache() {
  const cache = (typeof RUNTIME_CACHE === 'undefined') ? { note: 'RUNTIME_CACHE is not defined.' } : RUNTIME_CACHE;
  SpreadsheetApp.getUi().alert('RUNTIME CACHE:\n\n' + JSON.stringify(cache, null, 2));
}

function menu_runKlaviyoSync() {
  toast_('Running Klaviyo sync...', 'KPI CORE');
  if (typeof scheduledKlaviyoSync_v1 !== 'function') {
    throw new Error('scheduledKlaviyoSync_v1() not found. Ensure core/utils.js is deployed.');
  }
  var out = scheduledKlaviyoSync_v1();
  toast_('Klaviyo sync complete. Uploaded: ' + (out && out.uploaded || 0), 'KPI CORE');
}

function menu_processBcDrop() {
  if (typeof processBcDrop_v1 !== 'function') {
    throw new Error('processBcDrop_v1() not found. Ensure core/utils.js is deployed.');
  }
  toast_('📂 Les BC skrár úr Drive Drop...', 'KPI CORE');
  var out = processBcDrop_v1();

  if (out.reason === 'no_folder_configured') {
    SpreadsheetApp.getUi().alert(
      'BC_DROP_FOLDER_ID vantar',
      'Bættu við línu í STORKAUP_CONFIG → SETTINGS:\n  Key = BC_DROP_FOLDER_ID\n  Value = <folder ID úr Drive URL>',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }
  if (out.reason === 'no_files') {
    SpreadsheetApp.getUi().alert('Engar XLSX skrár fundust í BC Drop möppunni.', '', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  var r = (out.sync && out.sync.results) || {};
  var lines = (out.processed || []).map(function(p) {
    return '✅ ' + p.file + ' (' + p.rows + ' raðir → ' + p.schema + ')';
  }).concat((out.errors || []).map(function(e) {
    return '❌ ' + e.file + ': ' + e.error;
  }));

  if (out.sync) {
    lines.push('');
    lines.push('Supabase sync:');
    lines.push('  Invoices: ' + ((r.invoices && r.invoices.uploaded) || 0) + ' uploaded' +
      (r.invoices && r.invoices.remaining > 0 ? ' (' + r.invoices.remaining + ' remaining — run sync again)' : ''));
    lines.push('  Credit: ' + ((r.creditInvoices && r.creditInvoices.uploaded) || 0) + ' uploaded');
    lines.push('  Lines: ' + ((r.lines && r.lines.uploaded) || 0) + ' uploaded');
  }

  SpreadsheetApp.getUi().alert('BC Drive Drop\n\n' + lines.join('\n'));
}

function menu_runPostBcImportSync() {
  if (typeof runPostBcImportSync_v1 !== 'function') {
    throw new Error('runPostBcImportSync_v1() not found. Ensure core/utils.js is deployed.');
  }
  var out = runPostBcImportSync_v1();
  var r = out.results || {};
  var lines = [
    'Customers: ' + ((r.customers && r.customers.error) ? 'ERROR' : (r.customers && r.customers.uploaded || 0) + ' uploaded'),
    'Invoices: ' + ((r.invoices && r.invoices.error) ? 'ERROR' : (r.invoices && r.invoices.uploaded || 0) + ' uploaded' + (r.invoices && r.invoices.remaining > 0 ? ' (' + r.invoices.remaining + ' remaining)' : '')),
    'Credit invoices: ' + ((r.creditInvoices && r.creditInvoices.error) ? 'ERROR' : (r.creditInvoices && r.creditInvoices.uploaded || 0) + ' uploaded'),
    'Lines: ' + ((r.lines && r.lines.error) ? 'ERROR' : (r.lines && r.lines.uploaded || 0) + ' uploaded' + (r.lines && r.lines.remaining > 0 ? ' (' + r.lines.remaining + ' remaining — run again)' : ''))
  ].join('\n');
  SpreadsheetApp.getUi().alert('BC → Supabase sync complete\n\n' + lines + (out.runAgain ? '\n\n⚠ Run again to upload remaining rows.' : ''));
}

function menu_clearCustomerAnalysis() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Clear Customer Analysis?',
    'This will remove all data from Customer Analysis sheet.',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  const sh = ss.getSheetByName('Customer Analysis');
  if (sh) sh.clearContents();

  ui.alert('Customer Analysis cleared.');
}

function menu_clearAllSummaries() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Clear ALL Summaries?',
    'This will clear Sales summaries and Customer Analysis.',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);

  const sheetNames = [
    'Sales - Daily',
    'Sales - Monthly',
    'Sales - Top Products (All Time)',
    'Sales - Top Products (7d)',
    'Sales - Top Products (30d)',
    'Sales - Top Products (90d)',
    'Sales - Category (All Time)',
    'Sales - UOM Analysis',
    'Customer Analysis',

    // Legacy names (kept for cleanup / renames)
    'Sales — Daily',
    'Sales — Monthly',
    'Sales — Top Products (All Time)',
    'Sales — Top Products (7d)',
    'Sales — Top Products (30d)',
    'Sales — Top Products (90d)',
    'Sales — Category (All Time)',
    'Sales — UOM Analysis'
  ];

  sheetNames.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) sh.clearContents();
  });

  ui.alert('All summaries cleared.');
}

// ── Umsókn um viðskipti ───────────────────────────────────────────────────────

function menu_checkUmsokn_BC() {
  var cfg = loadConfig_();
  var sheetId = cfg.SHEETS && cfg.SHEETS.UMSOKN_VIDSKIPTI && cfg.SHEETS.UMSOKN_VIDSKIPTI.ID;
  if (!sheetId) { SpreadsheetApp.getUi().alert('UMSOKN_VIDSKIPTI sheet ID vantar í config.'); return; }

  var src = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(src.mainTab);
  if (!sheet || sheet.getLastRow() < 2) { SpreadsheetApp.getUi().alert('Engar umsóknir fundust.'); return; }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var companyKtIdx = headers.indexOf(src.companyKtHeader);
  var companyIdx   = headers.indexOf(src.companyHeader);

  // Get or create "BC staða" column
  var bcColIdx = headers.indexOf('BC staða');
  if (bcColIdx === -1) {
    bcColIdx = headers.length;
    sheet.getRange(1, bcColIdx + 1).setValue('BC staða').setFontWeight('bold');
  }

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  toast_('Athuga BC stöðu fyrir ' + data.length + ' umsóknir...', 'Umsóknir');

  var found = 0;
  data.forEach(function(row, i) {
    var kt = companyKtIdx >= 0 ? String(row[companyKtIdx] || '').trim() : '';
    if (!kt) return;
    var customer = lookupBcCustomerByKt_(kt);
    var statusCell = sheet.getRange(i + 2, bcColIdx + 1);
    if (customer) {
      statusCell.setValue('✓ Til í BC').setBackground('#d4edda').setFontColor('#155724');
      found++;
    } else {
      statusCell.setValue('— Ekki til').setBackground('#fff3cd').setFontColor('#856404');
    }
  });

  toast_(found + ' af ' + data.length + ' fyrirtækjum til í BC', 'BC staða');
}

function menu_sendUmsokn_Email() {
  var cfg = loadConfig_();
  var sheetId = cfg.SHEETS && cfg.SHEETS.UMSOKN_VIDSKIPTI && cfg.SHEETS.UMSOKN_VIDSKIPTI.ID;
  if (!sheetId) { SpreadsheetApp.getUi().alert('UMSOKN_VIDSKIPTI sheet ID vantar í config.'); return; }

  var src = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(src.mainTab);
  if (!sheet || sheet.getLastRow() < 2) { SpreadsheetApp.getUi().alert('Engar umsóknir fundust.'); return; }

  var headers  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var nameIdx    = headers.indexOf(src.nameHeader);
  var emailIdx   = headers.indexOf(src.emailHeader);
  var companyIdx = headers.indexOf(src.companyHeader);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  var pending = [];
  data.forEach(function(row, i) {
    var email = emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '';
    if (!email) return;
    pending.push({
      sheetRow : i + 2,
      email    : email,
      name     : nameIdx    >= 0 ? String(row[nameIdx]    || '').trim() : '',
      company  : companyIdx >= 0 ? String(row[companyIdx] || '').trim() : ''
    });
  });

  if (!pending.length) { SpreadsheetApp.getUi().alert('Engar umsóknir með netfang fundust.'); return; }

  var ui = SpreadsheetApp.getUi();
  var target;

  if (pending.length === 1) {
    target = pending[0];
  } else {
    var listText = pending.map(function(p, i) {
      return (i + 1) + '. ' + (p.company || '—') + ' — ' + (p.name || '—') + '\n   ' + p.email;
    }).join('\n\n');
    var resp = ui.prompt('Umsókn — velja', 'Umsóknir:\n\n' + listText + '\n\nNúmer:', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var idx = parseInt(resp.getResponseText(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= pending.length) { ui.alert('Ógilt val.'); return; }
    target = pending[idx];
  }

  var templateResp = ui.prompt(
    'Velja template',
    'Veldu tegund pósts:\n\n'
      + '1. Einstaklingur ekki með VSK-númer (hafnað)\n'
      + '2. Þarf lánshæfismat (einstaklingur í rekstri)\n'
      + '3. Lánshæfismat uppfyllir ekki skilyrði (staðgreiðsla)\n\n'
      + 'Númer (1–3):',
    ui.ButtonSet.OK_CANCEL
  );
  if (templateResp.getSelectedButton() !== ui.Button.OK) return;
  var tmpl = parseInt(templateResp.getResponseText(), 10);
  if (tmpl < 1 || tmpl > 3) { ui.alert('Ógilt val.'); return; }

  var subjects = [
    'Frekari upplýsingar vegna skráningar hjá Stórkaup',
    'Frekari upplýsingar vegna reikningsviðskipta hjá Stórkaup',
    'Staðgreiðsluviðskipti hjá Stórkaup'
  ];

  var confirm = ui.alert(
    'Staðfesta sendingu',
    'Senda template ' + tmpl + ' til:\n\n'
      + (target.name || target.email) + '\n' + target.email
      + (target.company ? '\nFyrirtæki: ' + target.company : '')
      + '\n\nÁframhald?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var htmlFn   = [buildUmsokn_NoVskHtml_,   buildUmsokn_NeedsCreditHtml_,   buildUmsokn_CashOnlyHtml_]  [tmpl - 1];
  var plainFn  = [buildUmsokn_NoVskPlain_,  buildUmsokn_NeedsCreditPlain_,  buildUmsokn_CashOnlyPlain_] [tmpl - 1];

  GmailApp.sendEmail(
    target.email,
    subjects[tmpl - 1],
    plainFn(target.name),
    { htmlBody: htmlFn(target.name), from: 'vefur@storkaup.is' }
  );

  sheet.getRange(target.sheetRow, 1, 1, headers.length).setBackground('#d4edda');
  toast_('Póst ' + tmpl + ' sendur til ' + target.email, 'Umsóknir');
}

function menu_testRafraenRedirect() {
  var cfg = loadConfig_();
  var testEmail = (cfg.SETTINGS && cfg.SETTINGS.ALERT_EMAILS) || 'oj@storkaup.is';
  GmailApp.sendEmail(
    testEmail,
    'TEST — Umsókn um aðgang að vefverslun Stórkaups',
    buildRafraenRedirectPlain_('Mariel Hilario', 'Skerfloð'),
    { htmlBody: buildRafraenRedirectHtml_('Mariel Hilario', 'Skerfloð'), from: 'vefur@storkaup.is' }
  );
  toast_('Test sent til ' + testEmail, 'Email');
}

function menu_sendRafraenRedirect() {
  var cfg = loadConfig_();
  var sheetId = cfg.SHEETS && cfg.SHEETS.RAFRAEN_INNSKRANING && cfg.SHEETS.RAFRAEN_INNSKRANING.ID;
  if (!sheetId) {
    SpreadsheetApp.getUi().alert('RAFRAEN_INNSKRANING sheet ID vantar í config.');
    return;
  }

  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert('Engar umsóknir fundust í RAFRÆN INNSKRÁNING.');
    return;
  }

  var headers = data[0];
  var emailIdx   = headers.indexOf('Netfang umsækjanda');
  var nameIdx    = headers.indexOf('Fullt nafn umsækjanda');
  var companyIdx = headers.indexOf('Nafn fyrirtækis / Nafn á deild');

  var pending = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var email = emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '';
    if (!email) continue;
    pending.push({
      sheetRow : i + 1,
      email    : email,
      name     : nameIdx    >= 0 ? String(row[nameIdx]    || '').trim() : '',
      company  : companyIdx >= 0 ? String(row[companyIdx] || '').trim() : ''
    });
  }

  if (!pending.length) {
    SpreadsheetApp.getUi().alert('Engar umsóknir með netfang fundust.');
    return;
  }

  var ui = SpreadsheetApp.getUi();
  var target;

  if (pending.length === 1) {
    target = pending[0];
  } else {
    var listText = pending.map(function(p, i) {
      return (i + 1) + '. ' + (p.name || '—') + ' — ' + (p.company || '—') + '\n   ' + p.email;
    }).join('\n\n');
    var resp = ui.prompt(
      'Senda redirect póst',
      'Umsóknir í bið:\n\n' + listText + '\n\nSláðu inn númer (1, 2, …):',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var idx = parseInt(resp.getResponseText(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= pending.length) { ui.alert('Ógilt val.'); return; }
    target = pending[idx];
  }

  var confirm = ui.alert(
    'Staðfesta sendingu',
    'Senda redirect póst til:\n\n'
      + (target.name || target.email) + '\n' + target.email
      + (target.company ? '\nFyrirtæki: ' + target.company : '')
      + '\n\nÁframhald?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  GmailApp.sendEmail(
    target.email,
    'Umsókn um aðgang að vefverslun Stórkaups',
    buildRafraenRedirectPlain_(target.name, target.company),
    { htmlBody: buildRafraenRedirectHtml_(target.name, target.company), from: 'vefur@storkaup.is' }
  );

  // Move row to "Framsent" tab
  var destSheet = ss.getSheetByName('Framsent');
  if (!destSheet) {
    destSheet = ss.insertSheet('Framsent');
    destSheet.appendRow(headers);
    destSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8e8e8');
  }
  var rowValues = sheet.getRange(target.sheetRow, 1, 1, headers.length).getValues()[0];
  destSheet.appendRow(rowValues);
  sheet.deleteRow(target.sheetRow);

  toast_('Redirect póst sendur til ' + target.email + ' — færð í Framsent flipa', 'Email');
}

function toast_(msg, title) {
  try {
    SpreadsheetApp.getActive().toast(String(msg || ''), String(title || ''));
  } catch (err) {
    Logger.log('toast_ skipped: ' + err);
  }
}

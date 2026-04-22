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
        .addItem('Debug Gemini Models', 'menu_debugGeminiModels')
        .addItem('Clear SEO Error Rows', 'menu_clearSeoErrorRows')
        .addItem('Clear Magento Token Cache', 'menu_clearMagentoTokenCache')
        .addItem('Run Klaviyo Sync', 'menu_runKlaviyoSync')
        .addItem('Show Runtime Cache', 'menu_showRuntimeCache')
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

function toast_(msg, title) {
  try {
    SpreadsheetApp.getActive().toast(String(msg || ''), String(title || ''));
  } catch (err) {
    Logger.log('toast_ skipped: ' + err);
  }
}

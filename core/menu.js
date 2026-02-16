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
    )
    .addSubMenu(
      ui.createMenu('Tools')
        .addItem('Test Config', 'menu_testConfig')
        .addItem('Clear Magento Token Cache', 'menu_clearMagentoTokenCache')
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

  if (typeof safePoll_v2 === 'function') {
    safePoll_v2();
  } else if (typeof safePoll === 'function') {
    safePoll();
  } else if (typeof pollMagentoNewOrders === 'function') {
    pollMagentoNewOrders();
  } else if (typeof pollMagentoOrders_v2 === 'function') {
    pollMagentoOrders_v2();
  } else {
    throw new Error('No NEWWEB poller found (expected safePoll_v2/safePoll/pollMagentoNewOrders).');
  }

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

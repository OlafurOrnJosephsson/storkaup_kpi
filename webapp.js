'use strict';

// This deployment is ANYONE_ANONYMOUS, so it only serves the key-protected
// dashboard JSON + the doPost api actions. The umsokn/listaverd HTML apps
// (applicant PII, credit scores) moved to the separate admin-apps project
// (access: DOMAIN + allowlist) — see admin/. Do NOT re-add `?app=` HTML
// routes here; that would put PII behind URL-secrecy again.
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'dashboard';
  if (action === 'dashboard') {
    return jsonResponse_(getDashboardMetrics_(e));
  }
  return jsonResponse_({ error: 'Unknown action' });
}

// POST endpoint. Browser dashboards can't run GmailApp, so the cache-help send
// is triggered here. Note: the request carries customer_id (not a raw "to"
// address) — the server resolves the address from MAGENTO_CUSTOMERS, so this
// endpoint can only ever email an existing customer, never an arbitrary address.
// Dashboard API actions (cache-help, templates, counts). Called from the single
// doPost router in applications.js — there must be only ONE doPost in the project,
// or the definitions collide and one silently overrides the other.
function handleApiAction_(body) {
  var action = String((body && body.action) || '');
  if (action === 'list_templates')      return jsonResponse_(listTemplatesViaApi_(body));
  if (action === 'list_recipients')     return jsonResponse_(listRecipientsViaApi_(body));
  if (action === 'send_template_email') return jsonResponse_(sendTemplateEmailViaApi_(body));
  if (action === 'application_counts')  return jsonResponse_(applicationCountsViaApi_(body));
  // Delegation frá admin-apps projectinu (admin/) — þungar aðgerðir og
  // Script-Properties niðurstöður sem búa hér, kallaðar með Dashboard-lyklinum.
  if (action === 'sync_magento_customers') return jsonResponse_(adminDelegateViaApi_(body, function () { return { ok: true, result: syncMagentoCustomers() }; }));
  if (action === 'prune_applications')     return jsonResponse_(adminDelegateViaApi_(body, function () { pruneCompletedApplications_(); return { ok: true }; }));
  if (action === 'zero_price_result')      return jsonResponse_(adminDelegateViaApi_(body, function () { return getZeroPriceResultForUi(); }));
  if (action === 'pending_orders')         return jsonResponse_(adminDelegateViaApi_(body, function () { return getPendingOrdersForUi(); }));
  if (action === 'run_zero_price_scan')    return jsonResponse_(adminDelegateViaApi_(body, function () { return runZeroPriceScanForUi(); }));
  return jsonResponse_({ error: 'Unknown action' });
}

function adminDelegateViaApi_(body, fn) {
  var cfg = loadConfig_();
  if (!isApiKeyValid_(cfg, body.key)) return { error: 'Unauthorized' };
  try {
    return fn();
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

// Light count of pending applications for the nav badge — counts rows with an
// email in each main tab (matches what the umsokn app lists), no BC lookup.
function applicationCountsViaApi_(body) {
  var cfg = loadConfig_();
  if (!isApiKeyValid_(cfg, body.key)) return { error: 'Unauthorized' };

  var raf = 0, ums = 0;
  var rafSrc = APP_SOURCES.find(function (s) { return s.key === 'RAFRAEN_INNSKRANING'; });
  var umsSrc = APP_SOURCES.find(function (s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  try {
    var rafId = cfg.SHEETS && cfg.SHEETS.RAFRAEN_INNSKRANING && cfg.SHEETS.RAFRAEN_INNSKRANING.ID;
    if (rafId) raf = webapp_countRowsWithEmail_(SpreadsheetApp.openById(rafId).getSheets()[0], rafSrc.emailHeader);
  } catch (e) {}
  try {
    var umsId = cfg.SHEETS && cfg.SHEETS.UMSOKN_VIDSKIPTI && cfg.SHEETS.UMSOKN_VIDSKIPTI.ID;
    if (umsId) {
      var us = SpreadsheetApp.openById(umsId).getSheetByName(umsSrc.mainTab);
      ums = webapp_countRowsWithEmail_(us, umsSrc.emailHeader);
    }
  } catch (e) {}
  return { ok: true, rafraen: raf, umsokn: ums, total: raf + ums };
}

function webapp_countRowsWithEmail_(sheet, emailHeader) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf(emailHeader);
  if (idx === -1) return Math.max(0, sheet.getLastRow() - 1);
  var col = sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < col.length; i++) { if (String(col[i][0] || '').trim()) n++; }
  return n;
}

// Templates available to send — from the registry in email.js (single source).
function listTemplatesViaApi_(body) {
  var cfg = loadConfig_();
  if (!isApiKeyValid_(cfg, body.key)) return { error: 'Unauthorized' };
  return { ok: true, templates: emailTemplateList_() };
}

// Users (Magento accounts) under a customer, so the dashboard can let support pick
// the actual recipient — one kennitala can have several logins. Template-agnostic.
function listRecipientsViaApi_(body) {
  var cfg = loadConfig_();
  if (!isApiKeyValid_(cfg, body.key)) return { error: 'Unauthorized' };
  var customerId = String(body.customer_id || '').trim();
  if (!customerId) return { error: 'missing_customer_id' };
  return { ok: true, users: listCustomerUsersForCacheEmail_(customerId) };
}

function sendTemplateEmailViaApi_(body) {
  var cfg = loadConfig_();
  if (!isApiKeyValid_(cfg, body.key)) return { error: 'Unauthorized' };
  if (isRateLimited_('send_template_email', 20)) return { error: 'rate_limited' };

  var templates = emailTemplates_();
  var tmpl = templates[String(body.template || '')];
  if (!tmpl) return { error: 'unknown_template' };

  var customerId = String(body.customer_id || '').trim();
  if (!customerId) return { error: 'missing_customer_id' };
  var to = String(body.to || '').trim().toLowerCase();
  if (!to) return { error: 'missing_recipient' };
  var lang = String(body.lang || tmpl.langs[0]).toLowerCase();
  if (tmpl.langs.indexOf(lang) === -1) lang = tmpl.langs[0];

  // The client chooses the recipient, but we still verify the address belongs to
  // this customer — so the endpoint can never be used to email an arbitrary one.
  var users = listCustomerUsersForCacheEmail_(customerId);
  var match = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').toLowerCase() === to) { match = users[i]; break; }
  }
  if (!match) return { error: 'recipient_not_in_customer' };

  var greetName = (match.name ? match.name.split(/\s+/)[0] : '') || '';
  var senderName = (tmpl.sender && tmpl.sender[lang]) || '';
  var built = tmpl.build(lang, { name: greetName, sender: senderName });

  GmailApp.sendEmail(match.email, built.subject, built.plain, {
    htmlBody: built.html,
    from: 'vefur@storkaup.is',
    name: 'Stórkaup ehf'
  });
  return { ok: true, sentTo: match.email };
}

function getDashboardMetrics_(e) {
  var cfg = loadConfig_();
  var providedKey = e && e.parameter ? e.parameter.key : '';
  if (!isApiKeyValid_(cfg, providedKey)) {
    return { error: 'Unauthorized' };
  }

  var ss = SpreadsheetApp.openById(cfg.SHEETS.SALES_SUMMARIES.ID);
  var tz = Session.getScriptTimeZone() || 'GMT';
  var now = new Date();

  var todayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  // ✅ monthKey fyrst (og nota requested month ef gefið)
  var monthKey = Utilities.formatDate(now, tz, 'yyyy-MM');
  var requestedMonth = e && e.parameter ? String(e.parameter.month || '').trim() : '';
  if (requestedMonth) {
    monthKey = requestedMonth;
  }

  // ✅ cacheKey verður mánuðarbundið
  var cache = CacheService.getScriptCache();
  var cacheKey = 'dashboard_metrics_v1_' + monthKey;

  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) {}
  }

  var daily = getLiveDailyMetrics_(cfg, tz, todayKey) || readSummaryRow_(ss, 'Sales - Daily', todayKey, 5, tz, 'yyyy-MM-dd');
  var monthly = readMonthlySummaryRow_(ss, monthKey, tz);
  var currentMonthKey = Utilities.formatDate(now, tz, 'yyyy-MM');
  if (monthly && monthKey === currentMonthKey) {
    var live = getLiveBcWebShare_(monthKey);
    if (live) {
      if (typeof live.webOrdersPct === 'number') monthly.webOrdersPct = live.webOrdersPct;
      if (typeof live.webRevenuePct === 'number') monthly.webRevenuePct = live.webRevenuePct;
    }
  }

  var out = {
    generatedAt: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss"),
    timezone: tz,
    day: daily ? {
      date: daily.key,
      revenueIncl: daily.revenueIncl,
      revenueExcl: daily.revenueExcl,
      orders: daily.orders
    } : {
      date: todayKey,
      revenueIncl: 0,
      revenueExcl: 0,
      orders: 0
    },
    dayOrders: daily ? daily.orders : 0,
    dayRevenueExcl: daily ? daily.revenueExcl : 0,
    month: monthly ? {
      month: monthly.key,
      revenueIncl: monthly.revenueIncl,
      revenueExcl: monthly.revenueExcl,
      orders: monthly.orders,
      webOrdersPct: monthly.webOrdersPct,
      webRevenuePct: monthly.webRevenuePct,
      salesRepPct: monthly.salesRepPct,
      selfServePct: monthly.selfServePct,
      aovExcl: monthly.aovExcl,
      bcAovExcl: monthly.bcAovExcl,
      aovWebPct: monthly.aovWebPct,
      aovBcPct: monthly.aovBcPct,
      newWebCustomers: monthly.newWebCustomers,
      newWebCustomersPct: monthly.newWebCustomersPct,
      firstTimeWebBuyers: monthly.newWebCustomers,
      firstTimeWebBuyersPct: monthly.newWebCustomersPct,
      yoyPct: monthly.yoyPct,
      yoyOrdersPct: monthly.yoyOrdersPct
    } : {
      month: monthKey,
      revenueIncl: 0,
      revenueExcl: 0,
      orders: 0,
      webOrdersPct: 0,
      webRevenuePct: 0,
      salesRepPct: 0,
      selfServePct: 0,
      aovExcl: 0,
      bcAovExcl: 0,
      aovWebPct: 0,
      aovBcPct: 0,
      newWebCustomers: 0,
      newWebCustomersPct: 0,
      firstTimeWebBuyers: 0,
      firstTimeWebBuyersPct: 0,
      yoyPct: 0,
      yoyOrdersPct: 0
    }
  };

  // 60 sek cache per month
  cache.put(cacheKey, JSON.stringify(out), 60);
  return out;
}

function getLiveBcWebShare_(monthKey) {
  try {
    var bcWeb = loadBCMonthlyWebStats_();
    var bcOrders = loadBCMonthlyOrderCounts_();
    var bcExcl = loadBCMonthlyTotalsExcl_();
    var m = String(monthKey || '').trim();
    if (!m) return null;

    var webOrders = bcWeb && bcWeb.orders ? (bcWeb.orders[m] || 0) : 0;
    var webExcl = bcWeb && bcWeb.revenueExcl ? (bcWeb.revenueExcl[m] || 0) : 0;
    var totalOrders = bcOrders[m] || 0;
    var totalExcl = bcExcl[m] || 0;

    return {
      webOrdersPct: totalOrders > 0 ? (webOrders / totalOrders) : 0,
      webRevenuePct: totalExcl > 0 ? (webExcl / totalExcl) : 0
    };
  } catch (e) {
    Logger.log('getLiveBcWebShare_ failed: ' + e);
    return null;
  }
}

function getLiveDailyMetrics_(cfg, tz, todayKey) {
  try {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'dashboard_live_day_v1_' + todayKey;
    var cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (err) {}
    }

    var key = todayKey || Utilities.formatDate(new Date(), tz || 'GMT', 'yyyy-MM-dd');
    var orders = new Set();
    var revenueExcl = 0;
    var revenueIncl = 0;

    var addRow = function(row, isOldweb) {
      if (!row) return;
      var rawDate = row.DATE || row.PurchaseDate || row['Purchase Date'];
      var d = parseRowDate_(rawDate, isOldweb);
      if (!d) return;
      var rowKey = Utilities.formatDate(d, tz || 'GMT', 'yyyy-MM-dd');
      if (rowKey !== key) return;

      var orderId = row.ID != null ? String(row.ID) : '';
      if (orderId) orders.add(orderId);

      var excl = toNum_(row.SUBTOTAL_EXCL);
      revenueExcl += excl;
      var incl = toNum_(row.SUBTOTAL_INCL || row.GRAND_TOTAL);
      revenueIncl += incl;
    };

    var newRows = loadTableBySchema_('NEWWEB') || [];
    newRows.forEach(function(r) { addRow(r, false); });

    var oldRows = loadTableBySchema_('OLDWEB') || [];
    oldRows.forEach(function(r) { addRow(r, true); });

    var result = {
      key: key,
      revenueIncl: revenueIncl,
      revenueExcl: revenueExcl,
      orders: orders.size
    };
    cache.put(cacheKey, JSON.stringify(result), 120);
    return result;
  } catch (e) {
    Logger.log('getLiveDailyMetrics_ failed: ' + e);
    return null;
  }
}

function parseRowDate_(raw, isOldweb) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (isOldweb && typeof parseOldwebDate_ === 'function') {
    var dOld = parseOldwebDate_(raw);
    if (dOld) return dOld;
  }
  if (typeof parseDateSafe_ === 'function') {
    var dSafe = parseDateSafe_(raw);
    if (dSafe) return dSafe;
  }
  var d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function readSummaryRow_(ss, sheetName, key, cols, tz, fmt) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return null;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  var numCols = cols || sh.getLastColumn();
  var values = sh.getRange(2, 1, lastRow - 1, numCols).getValues();

  for (var i = 0; i < values.length; i++) {
    var rowKey = values[i][0];
    if (rowKey instanceof Date) {
      rowKey = Utilities.formatDate(rowKey, tz || 'GMT', fmt || 'yyyy-MM-dd');
    }
    if (String(rowKey) === key) {
      return {
        key: key,
        qty: toNum_(values[i][1]),
        revenueIncl: toNum_(values[i][2]),
        revenueExcl: toNum_(values[i][3]),
        orders: Math.round(toNum_(values[i][4]))
      };
    }
  }
  return null;
}

function readMonthlySummaryRow_(ss, key, tz) {
  var sh = ss.getSheetByName('Sales - Monthly');
  if (!sh) return null;

  var lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  var values = sh.getRange(2, 1, lastRow - 1, 21).getValues();
  for (var i = 0; i < values.length; i++) {
    var rowKey = values[i][0];
    if (rowKey instanceof Date) {
      rowKey = Utilities.formatDate(rowKey, tz || 'GMT', 'yyyy-MM');
    }
    if (String(rowKey) === key) {
      return {
        key: key,
        qty: toNum_(values[i][1]),
        revenueIncl: toNum_(values[i][2]),
        revenueExcl: toNum_(values[i][3]),
        orders: Math.round(toNum_(values[i][4])),
        bcRevenueIncl: toNum_(values[i][5]),
        bcRevenueExcl: toNum_(values[i][6]),
        bcOrders: Math.round(toNum_(values[i][7])),
        webOrdersPct: toNum_(values[i][8]),
        webRevenuePct: toNum_(values[i][9]),
        salesRepPct: toNum_(values[i][10]),
        selfServePct: toNum_(values[i][11]),
        aovIncl: toNum_(values[i][12]),
        aovExcl: toNum_(values[i][13]),
        bcAovExcl: toNum_(values[i][14]),
        aovWebPct: toNum_(values[i][15]),
        aovBcPct: toNum_(values[i][16]),
        newWebCustomers: Math.round(toNum_(values[i][17])),
        newWebCustomersPct: toNum_(values[i][18]),
        firstTimeWebBuyers: Math.round(toNum_(values[i][17])),
        firstTimeWebBuyersPct: toNum_(values[i][18]),
        yoyPct: toNum_(values[i][19]),
        yoyOrdersPct: toNum_(values[i][20])
      };
    }
  }
  return null;
}

function jsonResponse_(obj) {
  // (valfrjálst) setja CORS header – stundum hjálpar í dashboard fetch
  var out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    out.setHeader('Access-Control-Allow-Origin', '*');
    out.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  } catch (e) {
    // setHeader er stundum ekki stutt í sumum Apps Script contexts – þá bara ignora
  }

  return out;
}

// Global per-hour cap on an api action, backed by ScriptCache. Not atomic —
// concurrent bursts can slightly overshoot the cap, which is fine for abuse
// throttling. No legitimate user hits 20 sends/hour.
function isRateLimited_(action, maxPerHour) {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + action;
  var count = Number(cache.get(key) || 0);
  if (count >= maxPerHour) {
    console.warn('[SECURITY] rate limit hit for ' + action + ' (' + count + '/' + maxPerHour + ' this hour)');
    return true;
  }
  cache.put(key, String(count + 1), 3600);
  return false;
}

// Fail-closed: missing key config means NO api-action access, not open access.
// Expected key lives in STORKAUP_CONFIG → API tab as `Dashboard | KEY | <value>`
// (cfg.API is always Service → Key nested, so the old cfg.API.DASHBOARD_KEY
// lookup could never be a string — the check was effectively always open).
// Deploy precondition: that config row exists AND Webflow custom code sends
// the same value as STORKAUP_CONFIG.gasKey.
function isApiKeyValid_(cfg, providedKey) {
  var expected = cfg && cfg.API && cfg.API.Dashboard && cfg.API.Dashboard.KEY;
  if (!expected) {
    console.warn('[SECURITY] isApiKeyValid_: API → Dashboard | KEY not configured — rejecting all api actions');
    return false;
  }
  return String(providedKey || '') === String(expected);
}

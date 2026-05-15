'use strict';

function doGet(e) {
  var app = e && e.parameter && e.parameter.app;
  if (app === 'umsokn') {
    return HtmlService.createHtmlOutputFromFile('umsokn_app')
      .setTitle('Stórkaup — Umsóknir')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var action = (e && e.parameter && e.parameter.action) || 'dashboard';
  if (action === 'dashboard') {
    return jsonResponse_(getDashboardMetrics_(e));
  }
  return jsonResponse_({ error: 'Unknown action' });
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
    out.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  } catch (e) {
    // setHeader er stundum ekki stutt í sumum Apps Script contexts – þá bara ignora
  }

  return out;
}

function isApiKeyValid_(cfg, providedKey) {
  var expected = cfg && cfg.API && cfg.API.DASHBOARD_KEY;
  if (!expected) return true;
  return String(providedKey || '') === String(expected);
}

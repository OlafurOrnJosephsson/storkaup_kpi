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
  if (action === 'send_template_bulk')  return jsonResponse_(sendTemplateBulkViaApi_(body));
  if (action === 'application_counts')  return jsonResponse_(applicationCountsViaApi_(body));
  if (action === 'seo_stats')           return jsonResponse_(seoStatsViaApi_(body));
  // Delegation frá admin-apps projectinu (admin/) — þungar aðgerðir og
  // Script-Properties niðurstöður sem búa hér, kallaðar með Dashboard-lyklinum.
  if (action === 'sync_magento_customers') return jsonResponse_(adminDelegateViaApi_(body, function () { return { ok: true, result: syncMagentoCustomers() }; }));
  if (action === 'prune_applications')     return jsonResponse_(adminDelegateViaApi_(body, function () { return Object.assign({ ok: true }, pruneCompletedApplications_()); }));
  if (action === 'zero_price_result')      return jsonResponse_(adminDelegateViaApi_(body, function () { return getZeroPriceResultForUi(); }));
  if (action === 'coming_soon_list')       return jsonResponse_(adminDelegateViaApi_(body, function () { return getComingSoonListForUi(); }));
  if (action === 'pending_orders')        return jsonResponse_(adminDelegateViaApi_(body, function () { return getPendingOrdersForUi(); }));
  if (action === 'start_zero_price_scan')  return jsonResponse_(adminDelegateViaApi_(body, function () { return startZeroPriceScanForUi(); }));
  if (action === 'zero_price_scan_status') return jsonResponse_(adminDelegateViaApi_(body, function () { return getZeroPriceScanStatusForUi(); }));
  if (action === 'run_zero_price_scan')   return jsonResponse_(adminDelegateViaApi_(body, function () { return runZeroPriceScanForUi(); }));
  // AI-drog ad vorulysingu. Keyrir HER thvi Anthropic-lykillinn byr i thessu
  // projecti; admin-appid kallar gegnum admin/delegate.js.
  if (action === 'pim_draft')              return jsonResponse_(adminDelegateViaApi_(body, function () { return pimDraftDescription_(body.ctx || {}); }));
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
  if (!webflowCaller_(cfg, body)) return { error: 'Unauthorized' };

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
  if (!webflowCaller_(cfg, body)) return { error: 'Unauthorized' };
  return { ok: true, templates: emailTemplateList_() };
}

// Users (Magento accounts) under a customer, so the dashboard can let support pick
// the actual recipient — one kennitala can have several logins. Template-agnostic.
function listRecipientsViaApi_(body) {
  var cfg = loadConfig_();
  if (!webflowCaller_(cfg, body)) return { error: 'Unauthorized' };
  var customerId = String(body.customer_id || '').trim();
  if (!customerId) return { error: 'missing_customer_id' };
  return { ok: true, users: listCustomerUsersForCacheEmail_(customerId) };
}

function sendTemplateEmailViaApi_(body) {
  var cfg = loadConfig_();
  var caller = webflowCaller_(cfg, body);
  if (!caller) return { error: 'Unauthorized' };
  // Hver sendi: netfang starfsmanns þegar kallað er með token, annars 'key'.
  console.log('[AUDIT] send_template_email by ' + caller + ' template=' + body.template
              + ' customer=' + body.customer_id);
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

  var greetName = greetFirstName_(match.name);
  var senderName = (tmpl.sender && tmpl.sender[lang]) || '';
  var built = tmpl.build(lang, { name: greetName, sender: senderName });

  GmailApp.sendEmail(match.email, built.subject, built.plain, {
    htmlBody: built.html,
    from: 'vefur@storkaup.is',
    name: 'Stórkaup ehf'
  });
  logTemplateEmails_([{
    customer_id: customerId, template: String(body.template), lang: lang,
    to_email: match.email, sent_by: caller
  }]);
  return { ok: true, sentTo: match.email };
}

// ── MAGNSENDING SNIÐMÁTS (2026-10-15) ──────────────────────────────────
// „Senda vefkynningu“ á /kpi/vidskiptavinur: valdir viðskiptavinir fá
// sniðmátið á ALLA vefnotendur fyrirtækisins (yfirleitt 1–3; enginn veit
// hver þeirra pantar). Ólíkt stakri sendingu velur enginn tengiliðinn, svo
// þjónninn síar sjálfur:
//   * „Sölumaður - X“-reikningar undir viðskiptavini og @storkaup.is-netföng
//     eru starfsmenn, ekki viðskiptavinurinn;
//   * @example.com er innskráningarauðkenni Magento, ekki pósthólf;
//   * viðskiptavinur sem fékk SAMA sniðmát síðustu BULK_DEDUPE_DAYS_ daga er
//     sleppt (raw.customer_email_log), svo endurval sendir ekki tvisvar.
// Eigið dagshámark (Script Property eftir dagsetningu): stakra hámarkið er 20
// á klst sameiginlegt, og Gmail-kvótinn á vefur@ er ~2.000 á dag.
var BULK_MAX_CUSTOMERS_  = 50;
var BULK_DAILY_EMAIL_CAP_ = 300;
var BULK_DEDUPE_DAYS_    = 30;

function sendTemplateBulkViaApi_(body) {
  var cfg = loadConfig_();
  var caller = webflowCaller_(cfg, body);
  if (!caller) return { error: 'Unauthorized' };

  var templateId = String(body.template || '');
  var tmpl = emailTemplates_()[templateId];
  if (!tmpl) return { error: 'unknown_template' };
  var lang = String(body.lang || tmpl.langs[0]).toLowerCase();
  if (tmpl.langs.indexOf(lang) === -1) lang = tmpl.langs[0];

  var ids = [];
  var seenId = {};
  (Array.isArray(body.customer_ids) ? body.customer_ids : []).forEach(function (x) {
    var id = String(x || '').trim();
    if (id && !seenId[id]) { seenId[id] = true; ids.push(id); }
  });
  if (!ids.length) return { error: 'missing_customer_ids' };
  if (ids.length > BULK_MAX_CUSTOMERS_) return { error: 'too_many', max: BULK_MAX_CUSTOMERS_ };

  console.log('[AUDIT] send_template_bulk by ' + caller + ' template=' + templateId + ' customers=' + ids.length);

  var props = PropertiesService.getScriptProperties();
  var dayKey = 'BULK_EMAIL_SENT_' + Utilities.formatDate(new Date(), 'Atlantic/Reykjavik', 'yyyy-MM-dd');
  var sentToday = Number(props.getProperty(dayKey) || 0);

  var usersBy = listCustomerUsersBulk_(ids);
  var recent = recentTemplateSends_(ids, templateId, BULK_DEDUPE_DAYS_);
  var senderName = (tmpl.sender && tmpl.sender[lang]) || '';
  var batchId = Utilities.getUuid();

  var out = { ok: true, customers_sent: 0, emails_sent: 0,
              skipped_recent: [], skipped_no_contact: [], skipped_cap: [], failed: [] };
  var logRows = [];

  ids.forEach(function (id) {
    var fam = String(id).replace(/\D/g, '');
    if (recent[fam]) { out.skipped_recent.push(id); return; }
    var users = (usersBy[id] || []).filter(isBulkRecipient_);
    if (!users.length) { out.skipped_no_contact.push(id); return; }
    if (sentToday + users.length > BULK_DAILY_EMAIL_CAP_) { out.skipped_cap.push(id); return; }

    var sentHere = 0;
    users.forEach(function (u) {
      try {
        var greet = greetFirstName_(u.name);
        var built = tmpl.build(lang, { name: greet, sender: senderName });
        GmailApp.sendEmail(u.email, built.subject, built.plain, {
          htmlBody: built.html, from: 'vefur@storkaup.is', name: 'Stórkaup ehf'
        });
        sentHere++; sentToday++;
        logRows.push({ customer_id: id, template: templateId, lang: lang,
                       to_email: u.email, sent_by: caller, batch_id: batchId });
      } catch (e) {
        out.failed.push({ customer_id: id, email: u.email, error: String(e && e.message || e) });
      }
    });
    if (sentHere) { out.customers_sent++; out.emails_sent += sentHere; }
  });

  props.setProperty(dayKey, String(sentToday));
  logTemplateEmails_(logRows);
  return out;
}

// Fornafn í kveðju — en aðeins ef nafnið er manneskja. Vefnotandi getur heitið
// „Stórkaup …“, „Sölumaður - X“ eða „Efnalaugin Vík ehf“; prufusending
// 2026-10-15 kom út sem „Kæri/Kæra Stórkaup,“. Þá er betra að heilsa án nafns.
function greetFirstName_(fullName) {
  var name = String(fullName || '').trim();
  if (!name) return '';
  if (/st[óo]rkaup|s[öo]luma[ðd]ur|\b(ehf|hf|slf|sf|ses|bs)\b\.?|\d/i.test(name)) return '';
  var first = name.split(/\s+/)[0];
  if (first.length < 2 || first === first.toUpperCase()) return '';
  return first;
}

function isBulkRecipient_(u) {
  var email = String(u && u.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) return false;
  if (/@(storkaup\.is|example\.com)$/.test(email)) return false;
  var name = String(u.name || '').toLowerCase();
  if (/s[oö]luma[ðd]ur/.test(name)) return false;
  return true;
}

// Sama samsvörun og listCustomerUsersForCacheEmail_ (core/customers.js):
// kennitala nákvæmlega EÐA sama fjölskylda (fyrstu 10 stafir), á Company ID
// eða National ID. Les blaðið EINU SINNI fyrir allan hópinn.
function listCustomerUsersBulk_(customerIds) {
  var want = {};
  var addWant = function (key, id) { if (!key) return; (want[key] = want[key] || []).push(id); };
  customerIds.forEach(function (id) {
    var n = String(id).replace(/\D/g, '');
    if (!n) return;
    addWant(n, id);
    addWant(n.length > 10 ? n.slice(0, 10) : n, id);
  });

  var CONFIG = loadConfig_();
  var sh = SpreadsheetApp.openById(CONFIG.SHEET_IDS.CUSTOMERS).getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  var out = {};
  if (!sh) return out;
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return out;
  var idx = {};
  data[0].forEach(function (h, i) { idx[h] = i; });
  var seen = {};

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var login = String(row[idx['Email']] || '').trim();
    var real  = String(row[idx['Real Email']] || '').trim();
    var email = real || login;
    if (!email) continue;
    var name = String(row[idx['Name']] || '').trim();
    [row[idx['Company ID']], row[idx['National ID']]].forEach(function (raw) {
      var v = String(raw || '').replace(/\D/g, '');
      if (!v) return;
      var k = v.length > 10 ? v.slice(0, 10) : v;
      (want[v] || []).concat(want[k] || []).forEach(function (id) {
        var sk = id + '|' + email.toLowerCase();
        if (seen[sk]) return;
        seen[sk] = true;
        (out[id] = out[id] || []).push({ name: name, email: email });
      });
    });
  }
  return out;
}

// customer_family_id-lyklar sem fengu sniðmátið síðustu `days` daga. Falli
// fyrirspurnin (t.d. taflan ekki til) er ENGINN talinn nýlegur — en þá er
// heldur ekki hægt að skrá, svo magnsendingin á ekki að keyra fyrr en SQL-ið
// er komið (customer_email_log_v1.sql).
function recentTemplateSends_(ids, templateId, days) {
  var keys = ids.map(function (id) { return String(id).replace(/\D/g, ''); }).filter(Boolean);
  var out = {};
  if (!keys.length) return out;
  var since = new Date(Date.now() - days * 86400000).toISOString();
  var rows = supabaseRestGetJson_(
    'customer_email_log?select=customer_family_id' +
    '&template=eq.' + encodeURIComponent(templateId) +
    '&sent_at=gte.' + encodeURIComponent(since) +
    '&customer_family_id=in.(' + keys.map(encodeURIComponent).join(',') + ')', 'raw');
  (rows || []).forEach(function (r) { out[r.customer_family_id] = true; });
  return out;
}

// Skrá sendingar í raw.customer_email_log (snertisagan les hana). Bregðist
// skráningin er pósturinn samt farinn: ekki kasta, aðeins skrá í log.
function logTemplateEmails_(rows) {
  if (!rows || !rows.length) return;
  try {
    var conf = getSupabaseRestConfig_();
    var payload = rows.map(function (r) {
      return {
        customer_id: r.customer_id,
        customer_family_id: String(r.customer_id).replace(/\D/g, '') || String(r.customer_id).toLowerCase(),
        template: r.template, lang: r.lang || null, to_email: r.to_email,
        sent_by: r.sent_by || null, batch_id: r.batch_id || null
      };
    });
    var res = UrlFetchApp.fetch(conf.baseUrl + '/customer_email_log', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole, Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw', Prefer: 'return=minimal'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      console.warn('[EMAIL_LOG] skráning mistókst: ' + code + ' ' + res.getContentText());
    }
  } catch (e) {
    console.warn('[EMAIL_LOG] skráning mistókst: ' + e);
  }
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
/**
 * Webflow-aðgerðirnar (list_templates, list_recipients, send_template_email,
 * application_counts, seo_stats) taka við INNSKRÁÐUM starfsmanni (2026-10-09):
 * Webflow/auth.js setur `authToken` (Supabase-token notandans) í body-ið, og
 * hér er hann staðfestur hjá Supabase Auth og netfangið borið við
 * raw.kpi_staff_access — sama aðgangslista og KPI-síðurnar.
 *
 * `key` (Dashboard.KEY) er enn tekinn gildur á meðan gasKey er í page-kóða
 * (áfangi 2 fjarlægir hann). DELEGATION-aðgerðirnar (prune_applications,
 * sync, zero-price, pim_draft) taka AÐEINS við lyklinum — þær kallar aðeins
 * admin-verkefnið, þjónn í þjón. Þegar gasKey hverfur úr síðukóðanum getur
 * enginn vafri lengur eytt umsóknum eða ræst sync.
 *
 * Skilar netfangi starfsmanns, 'key' ef lykillinn dugði, eða null.
 */
function webflowCaller_(cfg, body) {
  if (isApiKeyValid_(cfg, body && body.key)) return 'key';
  return verifyKpiStaffToken_(cfg, body && body.authToken);
}

function verifyKpiStaffToken_(cfg, token) {
  token = String(token || '').trim();
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var ck = 'kpitok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 43);
  var hit = cache.get(ck);
  if (hit) return hit === '-' ? null : hit;

  var email = null;
  try {
    var rest = String(cfg.ENDPOINTS.SUPABASE.REST_URL || '').replace(/\/+$/, '');
    var authUrl = rest.replace(/\/rest\/v1$/, '') + '/auth/v1/user';
    var key = cfg.API.SUPABASE.SERVICE_ROLE_KEY;
    var res = UrlFetchApp.fetch(authUrl, {
      method: 'get',
      headers: { apikey: key, Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      var user = safeJsonParse_(res.getContentText()) || {};
      var e = String(user.email || '').trim().toLowerCase();
      if (e) {
        var rows = supabaseRestGetJson_(
          'kpi_staff_access?select=email&email=eq.' + encodeURIComponent(e), 'raw');
        if (Array.isArray(rows) && rows.length) email = e;
      }
    }
  } catch (err) {
    console.warn('[SECURITY] verifyKpiStaffToken_: ' + err);
    return null;          // ekki cache-að: tímabundin villa á ekki að loka á 5 mín
  }
  cache.put(ck, email || '-', 300);
  if (!email) console.warn('[SECURITY] Webflow-kall með ógildan token eða netfang utan lista');
  return email;
}

function isApiKeyValid_(cfg, providedKey) {
  var expected = cfg && cfg.API && cfg.API.Dashboard && cfg.API.Dashboard.KEY;
  if (!expected) {
    console.warn('[SECURITY] isApiKeyValid_: API → Dashboard | KEY not configured — rejecting all api actions');
    return false;
  }
  return String(providedKey || '') === String(expected);
}

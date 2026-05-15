'use strict';

// ── Data fetch ────────────────────────────────────────────────────────────────

function webapp_getApplications() {
  var cfg = loadConfig_();
  var rafSrc = APP_SOURCES.find(function(s) { return s.key === 'RAFRAEN_INNSKRANING'; });
  var umsSrc = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });

  var rafId = cfg.SHEETS && cfg.SHEETS.RAFRAEN_INNSKRANING && cfg.SHEETS.RAFRAEN_INNSKRANING.ID;
  var umsId = cfg.SHEETS && cfg.SHEETS.UMSOKN_VIDSKIPTI   && cfg.SHEETS.UMSOKN_VIDSKIPTI.ID;

  var rafRows = [];
  var umsRows = [];

  if (rafId) {
    var rafSheet = SpreadsheetApp.openById(rafId).getSheets()[0];
    rafRows = webapp_readRows_(rafSheet, rafSrc);
  }
  if (umsId) {
    var umsSs = SpreadsheetApp.openById(umsId);
    var umsSheet = umsSs.getSheetByName(umsSrc.mainTab);
    if (umsSheet) umsRows = webapp_readRows_(umsSheet, umsSrc);
  }

  // Batch BC lookup
  var allKts = rafRows.concat(umsRows).map(function(r) { return r.companyKt; }).filter(Boolean);
  var bcMap  = webapp_batchBcLookup_(allKts);

  rafRows.forEach(function(r) { r.bcFound = !!bcMap[r.companyKt]; r.bcName = bcMap[r.companyKt] || ''; });
  umsRows.forEach(function(r) { r.bcFound = !!bcMap[r.companyKt]; r.bcName = bcMap[r.companyKt] || ''; });

  return { rafraen: rafRows, umsokn: umsRows };
}

function webapp_readRows_(sheet, src) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  var nameIdx      = headers.indexOf(src.nameHeader);
  var emailIdx     = headers.indexOf(src.emailHeader);
  var companyIdx   = headers.indexOf(src.companyHeader);
  var companyKtIdx = headers.indexOf(src.companyKtHeader || 'Kennitala fyrirtækis');
  var paymentIdx   = src.paymentHeader ? headers.indexOf(src.paymentHeader) : -1;
  var dateIdx      = headers.indexOf('Submitted At');

  return data.map(function(row, i) {
    var email = emailIdx >= 0 ? String(row[emailIdx] || '').trim() : '';
    if (!email) return null;
    var raw = dateIdx >= 0 ? row[dateIdx] : '';
    var dateStr = raw ? String(raw).substring(0, 10) : '';
    return {
      rowIndex  : i + 2,
      date      : dateStr,
      name      : nameIdx      >= 0 ? String(row[nameIdx]      || '').trim() : '',
      email     : email,
      company   : companyIdx   >= 0 ? String(row[companyIdx]   || '').trim() : '',
      companyKt : companyKtIdx >= 0 ? String(row[companyKtIdx] || '').trim() : '',
      payment   : paymentIdx   >= 0 ? String(row[paymentIdx]   || '').trim() : ''
    };
  }).filter(Boolean);
}

function webapp_batchBcLookup_(kennitolur) {
  if (!kennitolur || !kennitolur.length) return {};
  var kts = kennitolur.map(function(kt) { return String(kt).replace(/[^0-9]/g, ''); }).filter(Boolean);
  if (!kts.length) return {};
  var conf = getSupabaseRestConfig_();
  var inList = kts.map(function(kt) { return '"' + kt + '"'; }).join(',');
  var endpoint = conf.baseUrl + '/bc_customers_raw?select=company_id,company_name&company_id=in.(' + encodeURIComponent(inList) + ')';
  var res = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: { apikey: conf.serviceRole, Authorization: 'Bearer ' + conf.serviceRole, 'Accept-Profile': 'raw' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return {};
  var rows = safeJsonParse_(res.getContentText(), []);
  var map = {};
  if (Array.isArray(rows)) rows.forEach(function(r) { map[String(r.company_id)] = r.company_name || ''; });
  return map;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function webapp_sendRafraenRedirect(rowData) {
  var cfg     = loadConfig_();
  var sheetId = cfg.SHEETS.RAFRAEN_INNSKRANING.ID;
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  GmailApp.sendEmail(
    rowData.email,
    'Umsókn um aðgang að vefverslun Stórkaups',
    buildRafraenRedirectPlain_(rowData.name, rowData.company),
    { htmlBody: buildRafraenRedirectHtml_(rowData.name, rowData.company), from: 'vefur@storkaup.is' }
  );

  var dest = ss.getSheetByName('Framsent');
  if (!dest) {
    dest = ss.insertSheet('Framsent');
    dest.appendRow(headers);
    dest.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8e8e8');
  }
  dest.appendRow(sheet.getRange(rowData.rowIndex, 1, 1, headers.length).getValues()[0]);
  sheet.deleteRow(rowData.rowIndex);
  return { ok: true };
}

function webapp_markUmsokn_Done(rowData) {
  var cfg   = loadConfig_();
  var src   = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var sheet = SpreadsheetApp.openById(cfg.SHEETS.UMSOKN_VIDSKIPTI.ID).getSheetByName(src.mainTab);
  sheet.getRange(rowData.rowIndex, 1, 1, sheet.getLastColumn()).setBackground('#d4edda');
  return { ok: true };
}

function webapp_sendUmsokn_Email(rowData, templateId) {
  var subjects = [
    'Frekari upplýsingar vegna skráningar hjá Stórkaup',
    'Frekari upplýsingar vegna reikningsviðskipta hjá Stórkaup',
    'Staðgreiðsluviðskipti hjá Stórkaup'
  ];
  var htmlFns  = [buildUmsokn_NoVskHtml_,   buildUmsokn_NeedsCreditHtml_,   buildUmsokn_CashOnlyHtml_];
  var plainFns = [buildUmsokn_NoVskPlain_,  buildUmsokn_NeedsCreditPlain_,  buildUmsokn_CashOnlyPlain_];
  var tid = Number(templateId) - 1;

  GmailApp.sendEmail(
    rowData.email,
    subjects[tid],
    plainFns[tid](rowData.name),
    { htmlBody: htmlFns[tid](rowData.name), from: 'vefur@storkaup.is' }
  );

  var cfg     = loadConfig_();
  var src     = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var sheet   = SpreadsheetApp.openById(cfg.SHEETS.UMSOKN_VIDSKIPTI.ID).getSheetByName(src.mainTab);
  sheet.getRange(rowData.rowIndex, 1, 1, sheet.getLastColumn()).setBackground('#d4edda');
  return { ok: true };
}

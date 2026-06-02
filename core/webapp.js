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
  var umsSs   = null;

  if (rafId) {
    var rafSheet = SpreadsheetApp.openById(rafId).getSheets()[0];
    rafRows = webapp_readRows_(rafSheet, rafSrc);
  }
  if (umsId) {
    umsSs = SpreadsheetApp.openById(umsId);
    var umsSheet = umsSs.getSheetByName(umsSrc.mainTab);
    if (umsSheet) umsRows = webapp_readRows_(umsSheet, umsSrc);
  }

  // Batch BC lookup (pending rows only)
  var allKts = rafRows.concat(umsRows).map(function(r) { return r.companyKt; }).filter(Boolean);
  var bcMap  = webapp_batchBcLookup_(allKts);

  rafRows.forEach(function(r) { r.bcFound = !!bcMap[r.companyKt]; r.bcName = bcMap[r.companyKt] || ''; });
  umsRows.forEach(function(r) { r.bcFound = !!bcMap[r.companyKt]; r.bcName = bcMap[r.companyKt] || ''; });

  // Archive tabs
  var ARCHIVE = [
    { key: 'noVsk',       tab: 'Ekkert VSK' },
    { key: 'needsCredit', tab: 'Þarf lánshæfismat' },
    { key: 'cashOnly',    tab: 'Staðgreiðsla' }
  ];
  var archives = { noVsk: [], needsCredit: [], cashOnly: [] };
  if (umsSs) {
    ARCHIVE.forEach(function(a) {
      var sh = umsSs.getSheetByName(a.tab);
      if (sh) archives[a.key] = webapp_readRows_(sh, umsSrc);
    });
  }

  return { rafraen: rafRows, umsokn: umsRows, noVsk: archives.noVsk, needsCredit: archives.needsCredit, cashOnly: archives.cashOnly };
}

function webapp_readRows_(sheet, src) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  var nameIdx        = headers.indexOf(src.nameHeader);
  var emailIdx       = headers.indexOf(src.emailHeader);
  var companyIdx     = headers.indexOf(src.companyHeader);
  var companyKtIdx   = headers.indexOf(src.companyKtHeader || 'Kennitala fyrirtækis');
  var companyEmailIdx = src.companyEmailHeader ? headers.indexOf(src.companyEmailHeader) : -1;
  var addressIdx      = src.addressHeader      ? headers.indexOf(src.addressHeader)      : -1;
  var cityIdx         = src.cityHeader         ? headers.indexOf(src.cityHeader)         : -1;
  var postalIdx       = src.postalHeader       ? headers.indexOf(src.postalHeader)       : -1;
  var personKtIdx     = src.ktHeader           ? headers.indexOf(src.ktHeader)           : -1;
  var phoneIdx        = src.phoneHeader        ? headers.indexOf(src.phoneHeader)        : -1;
  var creditScoreIdx  = src.creditScoreHeader  ? headers.indexOf(src.creditScoreHeader)  : -1;
  var paymentIdx      = src.paymentHeader      ? headers.indexOf(src.paymentHeader)      : -1;
  var billingInfoIdx  = src.billingInfoHeader  ? headers.indexOf(src.billingInfoHeader)  : -1;
  var dateIdx        = headers.indexOf('Submitted At');

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
      companyKt    : companyKtIdx    >= 0 ? String(row[companyKtIdx]    || '').trim() : '',
      companyEmail : companyEmailIdx >= 0 ? String(row[companyEmailIdx] || '').trim() : '',
      address      : addressIdx      >= 0 ? String(row[addressIdx]      || '').trim() : '',
      city         : cityIdx         >= 0 ? String(row[cityIdx]         || '').trim() : '',
      postal       : postalIdx       >= 0 ? String(row[postalIdx]       || '').trim() : '',
      personKt     : personKtIdx     >= 0 ? String(row[personKtIdx]     || '').trim() : '',
      phone        : phoneIdx        >= 0 ? String(row[phoneIdx]        || '').trim() : '',
      creditScore  : creditScoreIdx  >= 0 ? String(row[creditScoreIdx]  || '').trim() : '',
      payment      : paymentIdx      >= 0 ? String(row[paymentIdx]      || '').trim() : '',
      billingInfo  : billingInfoIdx  >= 0 ? String(row[billingInfoIdx]  || '').trim() : ''
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

// Re-find a row's current physical index by matching the email column. rowIndex
// from the client can be stale (the list refreshes / rows shift), so trusting it
// for deleteRow risks deleting the wrong row or none. Returns -1 if not found.
function webapp_findRowIndexByEmail_(sheet, emailHeader, email) {
  var target = String(email || '').trim().toLowerCase();
  if (!target || !sheet || sheet.getLastRow() < 2) return -1;
  var headers  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var emailIdx = headers.indexOf(emailHeader);
  if (emailIdx === -1) return -1;
  var col = sheet.getRange(2, emailIdx + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0] || '').trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

function webapp_sendRafraenRedirect(rowData) {
  var cfg     = loadConfig_();
  var src     = APP_SOURCES.find(function(s) { return s.key === 'RAFRAEN_INNSKRANING'; });
  var sheetId = cfg.SHEETS.RAFRAEN_INNSKRANING.ID;
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  GmailApp.sendEmail(
    rowData.email,
    'Umsókn um aðgang að vefverslun Stórkaups',
    buildRafraenRedirectPlain_(rowData.name, rowData.company),
    { htmlBody: buildRafraenRedirectHtml_(rowData.name, rowData.company), from: 'vefur@storkaup.is', name: 'Stórkaup ehf' }
  );

  // Archive + remove by re-found index so a stale rowIndex can't miss the row.
  var idx = webapp_findRowIndexByEmail_(sheet, src.emailHeader, rowData.email);
  if (idx > 0) {
    var dest = ss.getSheetByName('Framsent');
    if (!dest) {
      dest = ss.insertSheet('Framsent');
      dest.appendRow(headers);
      dest.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8e8e8');
    }
    dest.appendRow(sheet.getRange(idx, 1, 1, headers.length).getValues()[0]);
    sheet.deleteRow(idx);
  }
  return { ok: true, removed: idx > 0 };
}

function webapp_saveCreditScore(rowIndex, score) {
  var cfg   = loadConfig_();
  var src   = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var sheet = SpreadsheetApp.openById(cfg.SHEETS.UMSOKN_VIDSKIPTI.ID).getSheetByName(src.mainTab);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colIdx = headers.indexOf('Lánshæfismat');
  if (colIdx === -1) {
    colIdx = headers.length;
    sheet.getRange(1, colIdx + 1).setValue('Lánshæfismat').setFontWeight('bold').setBackground('#e8e8e8');
  }
  sheet.getRange(rowIndex, colIdx + 1).setValue(score || '');
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
    { htmlBody: htmlFns[tid](rowData.name), from: 'vefur@storkaup.is', name: 'Stórkaup ehf', bcc: 'umsokn@storkaup.is' }
  );

  var cfg     = loadConfig_();
  var src     = APP_SOURCES.find(function(s) { return s.key === 'UMSOKN_VIDSKIPTI'; });
  var ss      = SpreadsheetApp.openById(cfg.SHEETS.UMSOKN_VIDSKIPTI.ID);
  var sheet   = ss.getSheetByName(src.mainTab);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Re-find by email so a stale rowIndex can't archive/delete the wrong row.
  var idx = webapp_findRowIndexByEmail_(sheet, src.emailHeader, rowData.email);
  if (idx > 0) {
    var rowVals = sheet.getRange(idx, 1, 1, headers.length).getValues()[0];
    var destNames = ['Ekkert VSK', 'Þarf lánshæfismat', 'Staðgreiðsla'];
    var dest = ss.getSheetByName(destNames[tid]);
    if (!dest) {
      dest = ss.insertSheet(destNames[tid]);
      dest.appendRow(headers);
      dest.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8e8e8');
    }
    dest.appendRow(rowVals);
    sheet.deleteRow(idx);
  }
  return { ok: true, removed: idx > 0 };
}

/************************************************************
 * 📋 applications.js — Umsóknir um viðskipti (CORE v2)
 * ─────────────────────────────────────────────────────────
 * Typeform Webhook → doPost() endpoint (replaces native GS integration).
 * Column mapping is header-name based — safe to reorder cols.
 * Pruning handled by pruneCompletedApplications_() in customers.js.
 *
 * STORKAUP_CONFIG → SETTINGS:
 *   APPLICATION_NOTIFY_EMAIL  (default: oj@storkaup.is)
 ************************************************************/

const APP_SOURCES = [
  {
    key             : 'RAFRAEN_INNSKRANING',
    label           : 'RAFRÆN INNSKRÁNING',
    formId          : 'QUu0PkqX',
    notifyEmailSetting: 'APPLICATION_NOTIFY_EMAIL_RAFRAEN',
    mainTab         : 'Kennitölu skráning',
    nameHeader      : 'Fullt nafn umsækjanda',
    emailHeader     : 'Netfang umsækjanda',
    companyHeader   : 'Nafn fyrirtækis / Nafn á deild',
    ktHeader        : 'Kennitala umsækjanda',
    companyKtHeader : 'Kennitala fyrirtækis',
    cleanHeaders: [
      { header: 'Kennitala fyrirtækis',  pad: 10 },
      { header: 'Kennitala umsækjanda',  pad: 10 },
      { header: 'Sími umsækjanda',       pad: 7, phone: true }
    ]
  },
  {
    key             : 'UMSOKN_VIDSKIPTI',
    label           : 'UMSÓKN VIÐSKIPTI',
    formId          : 'G2ZPwISA',
    notifyEmailSetting: 'APPLICATION_NOTIFY_EMAIL_UMSOKN',
    mainTab         : 'Umsókn um viðskipti',
    nameHeader      : 'Fullt nafn tengiliðar (prókúruhafa)',
    emailHeader     : 'Netfang tengiliðar',
    companyHeader   : 'Heiti fyrirtækis',
    ktHeader        : 'Kennitala tengiliðar (umsækjandi)',
    companyKtHeader : 'Kennitala fyrirtækis',
    phoneHeader       : 'Símanúmer tengiliðar',
    creditScoreHeader : 'Lánshæfismat',
    paymentHeader     : 'Greiðslufyrirkomulag',
    cleanHeaders: [
      { header: 'Kennitala fyrirtækis',              pad: 10 },
      { header: 'Kennitala tengiliðar (umsækjandi)', pad: 10 },
      { header: 'Símanúmer tengiliðar',              pad: 7, phone: true }
    ]
  }
];


/************************************************************
 * Typeform Webhook endpoint
 * Deploy as: Execute as Me, Anyone (even anonymous) can access
 ************************************************************/
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.event_type !== 'form_response') {
      return jsonResponse_({ status: 'ignored', reason: 'not form_response' });
    }

    const response = payload.form_response;
    const formId   = response.form_id;
    // event_id stays the same on Typeform retries — use as dedup key
    // Fall back to submitted_at if event_id missing (older webhook format)
    const eventId  = payload.event_id || response.token || response.submitted_at || '';

    const src = APP_SOURCES.find(s => s.formId === formId);
    if (!src) {
      Logger.log(`⚠️ doPost: unknown formId ${formId}`);
      return jsonResponse_({ status: 'ignored', reason: 'unknown formId' });
    }

    const CONFIG = loadConfig_();
    const ssId   = CONFIG.SHEET_IDS[src.key];
    if (!ssId) throw new Error(`Missing SHEET_IDS.${src.key}`);

    const ss = SpreadsheetApp.openById(ssId);
    let sh   = ss.getSheetByName(src.mainTab);
    if (!sh) {
      sh = ss.insertSheet(src.mainTab);
    }

    // Build normalized-title → answer-value map from Typeform payload
    // normalizeFieldTitle_() strips "/ subtitle" suffixes and lowercases,
    // so "Nafn fyrirtækis / Nafn á deild" matches sheet header "Nafn fyrirtækis"
    const fields    = (response.definition && response.definition.fields) || [];
    const answers   = response.answers || [];
    const answerMap = {};

    answers.forEach(ans => {
      const field = fields.find(f => f.id === ans.field.id);
      if (field) answerMap[normalizeFieldTitle_(field.title)] = extractTypeformValue_(ans);
    });

    // Initialise headers if sheet is brand new
    if (sh.getLastRow() === 0) {
      const headers = ['Submitted At'].concat(fields.map(f => f.title));
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }

    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    // Duplicate guard — event_id is identical on Typeform retries
    if (eventId && isDuplicateSubmission_(sh, headers, eventId)) {
      Logger.log(`⚠️ doPost: duplicate event_id ${eventId} — skipping`);
      return jsonResponse_({ status: 'ok', note: 'duplicate' });
    }

    const row = headers.map(h => {
      if (h === 'Submitted At') return response.submitted_at || new Date().toISOString();
      if (h === '_token')       return eventId;
      return answerMap[normalizeFieldTitle_(h)] !== undefined ? answerMap[normalizeFieldTitle_(h)] : '';
    });

    sh.appendRow(row);

    // Clean kennitölur + símanúmer on the new row only
    cleanSingleRow_(src, sh, sh.getLastRow());

    // Notify staff
    notifyNewApplication_(src, answerMap, response.submitted_at);

    Logger.log(`✅ doPost: ${src.label} — submission appended (row ${sh.getLastRow()})`);
    return jsonResponse_({ status: 'ok' });

  } catch (err) {
    Logger.log(`❌ doPost error: ${err.stack || err.message}`);
    return jsonResponse_({ status: 'error', message: err.message }, 500);
  }
}

// Returns true if this Typeform response token already exists in the sheet or LOKID
function isDuplicateSubmission_(sh, headers, token) {
  const tokenColIdx = headers.indexOf('_token');
  if (tokenColIdx === -1) return false;

  if (sh.getLastRow() >= 2) {
    const col = sh.getRange(2, tokenColIdx + 1, sh.getLastRow() - 1, 1).getValues();
    if (col.some(r => String(r[0]).trim() === token)) return true;
  }

  // Also check LOKID — pruneCompletedApplications_ moves rows there
  const lokid = sh.getParent().getSheetByName('LOKID');
  if (lokid && lokid.getLastRow() >= 1) {
    const lokidHeaders = lokid.getRange(1, 1, 1, lokid.getLastColumn()).getValues()[0];
    const lokidTokenIdx = lokidHeaders.indexOf('_token');
    if (lokidTokenIdx > -1 && lokid.getLastRow() >= 2) {
      const lokidCol = lokid.getRange(2, lokidTokenIdx + 1, lokid.getLastRow() - 1, 1).getValues();
      if (lokidCol.some(r => String(r[0]).trim() === token)) return true;
    }
  }

  return false;
}

function jsonResponse_(obj, code) {
  const out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return out;
}


/************************************************************
 * Clean a single row (used by doPost after append)
 ************************************************************/
function cleanSingleRow_(src, sh, rowNum) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  src.cleanHeaders.forEach(({ header, pad, phone }) => {
    const colIdx = getColIdx_(headers, header);
    if (colIdx === -1) return;

    const cell = sh.getRange(rowNum, colIdx + 1);
    cell.setNumberFormat('@STRING@');
    let v = String(cell.getValue()).replace(/^[\s''​﻿ ]+/, '');
    if (phone) v = v.replace(/^\s*(?:\+|00)?354[\s-]*/i, '');
    v = v.replace(/\s+/g, '').padStart(pad, '0');
    cell.setValue(v);
  });
}


/************************************************************
 * Staff notification
 ************************************************************/
function notifyNewApplication_(src, answerMap, submittedAt) {
  try {
    const CONFIG   = loadConfig_();
    const settings = CONFIG.SETTINGS || {};
    const to = (src.notifyEmailSetting && settings[src.notifyEmailSetting])
            || settings.APPLICATION_NOTIFY_EMAIL
            || 'oj@storkaup.is';

    const name  = answerMap[src.nameHeader]  || '(óþekkt)';
    const email = answerMap[src.emailHeader] || '';
    const kt    = answerMap[src.ktHeader]    || '';

    const subject = `[Stórkaup] Ný umsókn: ${src.label} — ${name}`;
    const body = [
      `Ný umsókn barst: ${submittedAt || new Date().toISOString()}`,
      '',
      `Nafn:    ${name}`,
      email ? `Netfang: ${email}` : '',
      kt    ? `Kt:      ${kt}`    : '',
    ].filter(l => l !== null && l !== undefined).join('\n');

    MailApp.sendEmail(to, subject, body);
  } catch (err) {
    Logger.log(`⚠️ notifyNewApplication_ failed: ${err.message}`);
  }
}


/************************************************************
 * Extract a typed answer value from Typeform payload
 ************************************************************/
// Strips " / subtitle" suffixes and lowercases so sheet headers match
// Typeform field titles even when Typeform appends a description segment.
// e.g. "Nafn fyrirtækis / Nafn á deild" → "nafn fyrirtækis"
function normalizeFieldTitle_(s) {
  return String(s).toLowerCase().trim().split(/\s*\/\s*/)[0].trim();
}

function extractTypeformValue_(ans) {
  switch (ans.type) {
    case 'text':         return ans.text         || '';
    case 'email':        return ans.email        || '';
    case 'phone_number': return ans.phone_number || '';
    case 'number':       return ans.number       !== undefined ? String(ans.number) : '';
    case 'boolean':      return ans.boolean      !== undefined ? String(ans.boolean) : '';
    case 'choice':       return (ans.choice  && ans.choice.label)          || '';
    case 'choices':      return (ans.choices && ans.choices.labels)
                                  ? ans.choices.labels.join(', ') : '';
    case 'date':         return ans.date      || '';
    case 'url':          return ans.url       || '';
    case 'file_url':     return ans.file_url  || '';
    default:             return '';
  }
}


/************************************************************
 * Scheduled clean + onChange handler (kept for fallback)
 ************************************************************/
function cleanApplicationSheets() { cleanApplicationSheets_(); }

function handleApplicationChange_(e) {
  cleanApplicationSheets_();
}

function cleanApplicationSheets_() {
  const CONFIG = loadConfig_();

  APP_SOURCES.forEach(src => {
    const ssId = CONFIG.SHEET_IDS[src.key];
    if (!ssId) {
      Logger.log(`⚠️ cleanApplicationSheets_: vantar SHEET_IDS.${src.key}`);
      return;
    }

    const ss = SpreadsheetApp.openById(ssId);
    const sh = ss.getSheetByName(src.mainTab);
    if (!sh) {
      Logger.log(`⚠️ ${src.label}: tab '${src.mainTab}' not found. Tabs: ${ss.getSheets().map(s=>s.getName()).join(', ')}`);
      return;
    }
    if (sh.getLastRow() < 2) { Logger.log(`ℹ️ ${src.label}: empty`); return; }

    const headers  = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const numRows  = sh.getLastRow() - 1;
    const nameIdx  = getColIdx_(headers, src.nameHeader);

    if (nameIdx === -1) {
      Logger.log(`⚠️ ${src.label}: could not find name header '${src.nameHeader}'`);
      return;
    }

    const nameVals = sh.getRange(2, nameIdx + 1, numRows, 1).getValues();

    nameVals.forEach((n, i) => {
      if (!n[0].toString().trim()) return;
      const rowNum = i + 2;
      cleanSingleRow_(src, sh, rowNum);
    });

    Logger.log(`✅ cleanApplicationSheets_: ${src.label} — ${numRows} rows processed`);
  });
}


/************************************************************
 * One-time trigger setup
 ************************************************************/
// Removes all onChange triggers for application sheets (no longer needed — webhook handles everything)
function removeApplicationChangeTriggers() {
  const removed = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'handleApplicationChange_');
  removed.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log(`✅ removeApplicationChangeTriggers: ${removed.length} trigger(s) removed`);
}


/************************************************************
 * Helper
 ************************************************************/
function getColIdx_(headers, name) {
  const n = name.toLowerCase().trim();
  return headers.findIndex(h => h.toString().toLowerCase().trim() === n);
}

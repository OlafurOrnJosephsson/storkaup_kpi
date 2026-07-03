/************************************************************
 * 🧾 INVOICE COLLECTOR — Gmail → Drive
 * ----------------------------------------------------------
 * Leitar í Gmail að reikninga-/kvittana-póstum frá OpenAI og
 * Google Workspace, vistar PDF-viðhengin í Drive-möppu og
 * skráir hverja færslu í Sheet (dags | uppspretta | efni |
 * upphæð | PDF-hlekk | póst-hlekk | message-id).
 *
 * - Dedup: message-id dálkurinn í log-blaðinu (endurkeyrsla
 *   tvítekur ekki).
 * - Póstar án PDF (t.d. Google sem linkar oft í console) eru
 *   samt skráðir með athugasemd svo ekkert tapist.
 *
 * Keyrðu: collectInvoicesToDrive_v1()
 * Leitarstrengir eru stillanlegir hér að neðan.
 ************************************************************/

var INVOICE_ROOT_FOLDER_NAME = 'Reikningar (sjálfvirkt)';
var INVOICE_FOLDER_PROP      = 'INVOICE_ROOT_FOLDER_ID';
var INVOICE_SHEET_PROP       = 'INVOICE_LOG_SHEET_ID';
var INVOICE_SHEET_NAME       = 'Reikningar – Log';

var INVOICE_SOURCES = [
  {
    key: 'OpenAI',
    // OpenAI-reikningar berast á vefur@ (sér-pósthólf). Til að GAS (umsokn@)
    // sjái þá þarf forward-síu vefur@ → umsokn@ (sjá leiðbeiningar).
    query: '(from:openai.com OR from:stripe.com OR from:invoice+statements@openai.com) ' +
           '(invoice OR receipt OR reikningur OR kvittun)'
  },
  {
    key: 'Google Workspace',
    // Berast á umsokn@ = eigið pósthólf GAS → engin to:-sía þörf.
    query: 'from:payments-noreply@google.com ' +
           '(invoice OR reikningur OR Workspace OR payment)'
  },
  {
    key: 'Webflow',
    // Webflow-áskrift (USD), billing email = vefur@. Reikningarnir þurfa að
    // skila sér inn í umsokn@ (þar sem GAS les) — forward-sía vefur@ → umsokn@.
    // Webflow sendir ýmist frá webflow.com eða webflow.io. Keyrðu
    // debugInvoiceSearch_v1() til að staðfesta raunverulegt sender-address.
    query: '(from:webflow.com OR from:webflow.io) ' +
           '(invoice OR receipt OR reikningur OR kvittun OR subscription OR billing OR payment)'
  }
];

var INVOICE_HEADER = ['Dagsetning', 'Uppspretta', 'Efni', 'Upphæð', 'PDF (Drive)', 'Póstur', 'Message ID', 'Athugasemd'];

/************************************************************
 * Aðalfall
 ************************************************************/
function collectInvoicesToDrive_v1(opts) {
  opts = opts || {};
  var lookbackDays = opts.lookbackDays || 400;
  var maxThreads   = opts.maxThreads || 150;

  var root  = getOrCreateInvoiceFolder_();
  var sheet = getOrCreateInvoiceSheet_(root);
  var seen  = loadSeenInvoiceIds_(sheet);

  var scanned = 0, pdfsSaved = 0, noPdf = 0;
  var newRows = [];
  var bySource = {};

  INVOICE_SOURCES.forEach(function (src) {
    bySource[src.key] = { threads: 0, newPdfs: 0, newNoPdf: 0 };
    var sub = getOrCreateChildFolder_(root, src.key);
    var q = src.query + ' newer_than:' + lookbackDays + 'd';
    var threads = GmailApp.search(q, 0, maxThreads);
    bySource[src.key].threads = threads.length;

    threads.forEach(function (th) {
      var permalink = th.getPermalink();
      th.getMessages().forEach(function (msg) {
        var id = msg.getId();
        scanned++;
        if (seen[id]) return;
        seen[id] = true;

        var date    = msg.getDate();
        var dstr    = Utilities.formatDate(date, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd');
        var subject = msg.getSubject() || '(án efnis)';
        var amount  = extractInvoiceAmount_(subject, msg);

        var pdfs = (msg.getAttachments() || []).filter(function (a) {
          return /pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName());
        });

        if (!pdfs.length) {
          noPdf++;
          bySource[src.key].newNoPdf++;
          newRows.push([date, src.key, subject, amount, '', permalink, id, '(engin PDF — sækja handvirkt úr pósti)']);
          return;
        }

        pdfs.forEach(function (att, i) {
          var safe = subject.replace(/[\\\/:*?"<>|]/g, '_').slice(0, 60).trim();
          var fname = dstr + '_' + src.key + '_' + safe + (pdfs.length > 1 ? ('_' + (i + 1)) : '') + '.pdf';
          var file = sub.createFile(att.copyBlob()).setName(fname);
          newRows.push([date, src.key, subject, amount, file.getUrl(), permalink, id, '']);
          pdfsSaved++;
          bySource[src.key].newPdfs++;
        });
      });
    });
  });

  if (newRows.length) {
    // Elstu efst — röðum eftir dagsetningu áður en við bætum við.
    newRows.sort(function (a, b) { return a[0] - b[0]; });
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, INVOICE_HEADER.length).setValues(newRows);
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat('yyyy-mm-dd');
  }

  var summary = {
    scanned: scanned,
    pdfsSaved: pdfsSaved,
    noPdf: noPdf,
    newRows: newRows.length,
    bySource: bySource,
    folder: root.getUrl(),
    sheet: sheet.getParent().getUrl()
  };
  Logger.log('🧾 Reikninga-safnari: ' + JSON.stringify(summary));
  return summary;
}

/************************************************************
 * 🔎 Debug — hvaða pósthólf + hvað finnst?
 *   Keyrðu þetta til að kvarða leitarstrengina.
 ************************************************************/
function debugInvoiceSearch_v1() {
  var active = '';
  var effective = '';
  try { active = Session.getActiveUser().getEmail(); } catch (e) { active = '(?)'; }
  try { effective = Session.getEffectiveUser().getEmail(); } catch (e) { effective = '(?)'; }
  Logger.log('📬 Pósthólf sem er lesið → activeUser: ' + active + ' | effectiveUser: ' + effective);

  var probes = [
    'from:google.com newer_than:400d',
    'from:payments-noreply@google.com newer_than:400d',
    'from:googleworkspace-noreply@google.com newer_than:400d',
    '"Google Workspace" newer_than:400d',
    'subject:(invoice OR reikningur OR kvittun) newer_than:400d',
    'from:openai.com newer_than:400d',
    'from:stripe.com newer_than:400d',
    'openai newer_than:400d',
    'invoice newer_than:400d',
    'from:webflow.com newer_than:400d',
    'from:webflow.io newer_than:400d',
    'webflow newer_than:400d',
    'to:umsjon@storkaup.is newer_than:60d',
    'to:vefur@storkaup.is newer_than:60d'
  ];

  probes.forEach(function (q) {
    var threads = GmailApp.search(q, 0, 5);
    var sample = '';
    if (threads.length) {
      var m = threads[0].getMessages()[0];
      sample = ' | dæmi: FROM=' + m.getFrom() + ' SUBJ=' + (m.getSubject() || '').slice(0, 60);
    }
    Logger.log('  [' + threads.length + (threads.length === 5 ? '+' : '') + '] ' + q + sample);
  });
}

/************************************************************
 * Drive + Sheet helpers
 ************************************************************/
function getOrCreateInvoiceFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(INVOICE_FOLDER_PROP);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* fell through */ }
  }
  var it = DriveApp.getFoldersByName(INVOICE_ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(INVOICE_ROOT_FOLDER_NAME);
  props.setProperty(INVOICE_FOLDER_PROP, folder.getId());
  return folder;
}

function getOrCreateChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function getOrCreateInvoiceSheet_(folder) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(INVOICE_SHEET_PROP);
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(INVOICE_SHEET_NAME);
    // Færa skjalið í reikninga-möppuna.
    var file = DriveApp.getFileById(ss.getId());
    folder.addFile(file);
    try { DriveApp.getRootFolder().removeFile(file); } catch (e) { /* ok */ }
    props.setProperty(INVOICE_SHEET_PROP, ss.getId());
  }
  var sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, INVOICE_HEADER.length).setValues([INVOICE_HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function loadSeenInvoiceIds_(sheet) {
  var seen = {};
  var last = sheet.getLastRow();
  if (last < 2) return seen;
  var idCol = INVOICE_HEADER.indexOf('Message ID') + 1;
  var ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
  ids.forEach(function (r) { if (r[0]) seen[String(r[0])] = true; });
  return seen;
}

/************************************************************
 * Best-effort upphæðar-lestur úr efni/texta
 ************************************************************/
function extractInvoiceAmount_(subject, msg) {
  var body = '';
  try { body = msg.getPlainBody().slice(0, 3000); } catch (e) { body = ''; }
  var text = subject + '\n' + body;
  var m = text.match(/(?:USD|US\$|\$|€|EUR|ISK|kr\.?)\s?[\d][\d.,]*|[\d][\d.,]*\s?(?:USD|EUR|ISK|kr\.?)/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

/************************************************************
 * (Valfrjálst) mánaðarlegt trigger fyrir sjálfvirkni
 ************************************************************/
function installInvoiceCollectorTrigger_v1() {
  var fn = 'collectInvoicesToDrive_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) return { created: false, existing: existing.length };
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(7).nearMinute(10).create();
  return { created: true, schedule: 'daily ~07:10' };
}

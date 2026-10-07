/************************************************************
 * 📤 plytix_export.js — Vinnusheet → CSV til innflutnings í Plytix
 *
 * Valmynd: Vöruinnihald → Útflutningur í Plytix (Long Description).
 * Skrifar `SKU,Long Description` í undirmöppuna `innflutningur` í
 * PIM_DROP. Óli hleður henni upp í Plytix (Imports → Upload,
 * „Create or update products").
 *
 * ── ÞRJÁR REGLUR SEM VERJA PLYTIX ──────────────────────────────────
 *  1. SKU ER PLYTIX-SKU, STAFRÉTT. Sheetið geymir `9004581`, Plytix
 *     `STO_9004581` (og stundum `STO_9003663_STK`). Í „Create or update"
 *     býr rangt SKU til NÝJA VÖRU. SKU er því flett upp í nýjasta
 *     útdrættinum; finnist það ekki, eða tvö Plytix-SKU falla á sama
 *     sheet-SKU, er röðinni SLEPPT og hún nefnd.
 *  2. EIN EIGIND Á SKRÁ, ENGIR TÓMIR REITIR. Tómur reitur í innflutningi
 *     getur hreinsað eigindina. Skráin tekur aðeins raðir með texta.
 *  3. EKKERT HTML ÚR SHEETINU. Lýsing sem ber `<tag>` var límd inn og er
 *     sleppt — breytingin myndi escape-a hana og vefurinn sýna merkin.
 *
 * Staðan er EKKI færð í „Flutt inn" hér. Að skrá hafi verið búin til
 * segir ekki að hún hafi farið inn. Það segir næsti Plytix-útdráttur.
 *
 * Skráin fer í UNDIRMÖPPU, ekki í drop-möppuna sjálfa: readLatestPlytixCsv_
 * tekur nýjustu .csv þar, og innflutningsskráin myndi annars lesast sem
 * útdráttur við næstu byggingu.
 ************************************************************/

const PIM_EXPORT_SUBFOLDER_ = 'innflutningur';
const PIM_EXPORT_STATUS_    = 'Samþykkt';

function menu_exportPimLongDescription() {
  const r = exportPimLongDescription_();
  const lines = [
    r.count + ' vörur í ' + r.fileName + '.',
    '',
    'Sleppt:',
    '  ' + r.skip.unknown.length + ' SKU finnst ekki í Plytix-útdrættinum',
    '  ' + r.skip.ambiguous.length + ' SKU passar við fleiri en eina Plytix-vöru',
    '  ' + r.skip.html.length + ' lýsingar innihalda HTML',
    '',
    'Upplýsingar um sleppt raðir eru í keyrsluskránni.',
    '',
    r.url
  ];
  Logger.log('[PIM][UTFLUTNINGUR] ' + lines.join(' | '));
  try {
    SpreadsheetApp.getUi().alert('Útflutningur í Plytix', lines.join('\n'),
                                 SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Keyrt úr ritlinum: ekkert UI, keyrsluskráin dugar.
  }
}

function exportPimLongDescription_() {
  const cfg = loadConfig_();
  const sh = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID).getSheetByName(PIM_SHEET_);
  if (!sh || sh.getLastRow() < 2) throw new Error(PIM_SHEET_ + ' fannst ekki eða er tómt.');

  // Eftir KÓLUMNUHEITI, eins og byggingin og appið — sheetið getur verið
  // byggt með eldri kólumnuröð.
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(normHeader_);
  const col = {};
  ['label', 'sku', 'descNew', 'status'].forEach(function (k) {
    const want = normHeader_(PIM_COLS_[pimColNum_(k) - 1].head);
    col[k] = head.indexOf(want);
    if (col[k] === -1) throw new Error('Kólumna „' + PIM_COLS_[pimColNum_(k) - 1].head + '" finnst ekki.');
  });

  const plytixSku = pimPlytixSkuMap_();

  const out = [['SKU', 'Long Description']];
  const skip = { unknown: [], ambiguous: [], html: [] };
  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    if (String(row[col.status]).trim() !== PIM_EXPORT_STATUS_) continue;
    const text = String(row[col.descNew] || '').trim();
    if (!text) continue;

    const key = normSku_(row[col.sku]);
    const who = key + ' ' + String(row[col.label] || '').slice(0, 40);
    const raw = plytixSku[key];
    if (!raw) { skip.unknown.push(who); continue; }
    if (raw === PIM_AMBIGUOUS_) { skip.ambiguous.push(who); continue; }
    if (/<\/?[a-z][^>]*>/i.test(text)) { skip.html.push(who); continue; }

    out.push([raw, pimDescToHtml_(text)]);
  }

  Object.keys(skip).forEach(function (k) {
    if (skip[k].length) Logger.log('[PIM][UTFLUTNINGUR] sleppt (' + k + '): ' + skip[k].join('; '));
  });

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  const fileName = 'plytix_import_long_description_' + stamp + '.csv';
  const file = pimExportFolder_().createFile(fileName, pimToCsv_(out), MimeType.CSV);

  return { count: out.length - 1, fileName: fileName, url: file.getUrl(), skip: skip };
}

const PIM_AMBIGUOUS_ = '\u0000tvírætt';

/** sheet-SKU (normSku_) → Plytix-SKU stafrétt, úr nýjasta útdrættinum. */
function pimPlytixSkuMap_() {
  const grid = Utilities.parseCsv(readLatestPlytixCsv_(),
    (loadConfig_().SETTINGS || {}).PIM_CSV_DELIMITER || ',');
  const heads = grid[0].map(normHeader_);
  const wanted = PIM_HEADER_MAP_.sku.map(normHeader_);
  let c = -1;
  for (let i = 0; i < heads.length && c === -1; i++) if (wanted.indexOf(heads[i]) !== -1) c = i;
  if (c === -1) throw new Error('SKU-kólumna fannst ekki í Plytix-útdrættinum.');

  const map = {};
  for (let r = 1; r < grid.length; r++) {
    const raw = String(grid[r][c] || '').trim();
    if (!raw) continue;
    const k = normSku_(raw);
    map[k] = (map[k] && map[k] !== raw) ? PIM_AMBIGUOUS_ : raw;
  }
  return map;
}

function pimExportFolder_() {
  const parent = DriveApp.getFolderById(pimDropFolderId_());
  const it = parent.getFoldersByName(PIM_EXPORT_SUBFOLDER_);
  return it.hasNext() ? it.next() : parent.createFolder(PIM_EXPORT_SUBFOLDER_);
}

/**
 * Texti úr sheetinu → HTML fyrir Long Description.
 *
 *   `- ` / `• ` / `* ` í byrjun línu → <li>, samfelldar línur → einn <ul>.
 *   AUÐ LÍNA MILLI PUNKTA BRÝTUR EKKI LISTANN — fólk setur þær óvart
 *   (Couscous 2026-10-07: `- Pakkning` / auð lína / `- Geymsluþol`).
 *   Annar texti → <p>; auð lína skiptir í málsgreinar, stök lína → <br>.
 *   Allt escape-að: `&` í „Herbs&Spices" á ekki að brjóta neitt.
 */
function pimDescToHtml_(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const BULLET = /^\s*[-•*]\s+/;
  const html = [];
  let para = [], list = [];

  const flushPara = function () {
    if (para.length) html.push('<p>' + para.join('<br>') + '</p>');
    para = [];
  };
  const flushList = function () {
    if (list.length) html.push('<ul>' + list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>');
    list = [];
  };
  const nextNonBlank = function (i) {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara();
      if (list.length && !BULLET.test(nextNonBlank(i))) flushList();
      continue;
    }
    if (BULLET.test(line)) {
      flushPara();
      list.push(pimEscHtml_(line.replace(BULLET, '').trim()));
    } else {
      flushList();
      para.push(pimEscHtml_(line.trim()));
    }
  }
  flushPara();
  flushList();
  return html.join('');
}

function pimEscHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pimToCsv_(rows) {
  return rows.map(function (r) {
    return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\r\n');
}

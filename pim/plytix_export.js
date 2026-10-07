/************************************************************
 * 📤 plytix_export.js — Vinnusheet → CSV til innflutnings í Plytix
 *
 * Valmynd: Vöruinnihald → Útflutningur í Plytix.
 * Skrifar EINA SKRÁ Á EIGIND (sjá PIM_EXPORT_ATTRS_) í undirmöppuna
 * `innflutningur` í PIM_DROP, allar með sama tímastimpli. Óli hleður þeim
 * upp í Plytix (Imports → Upload, „Only update existing").
 *
 * ── ÞRJÁR REGLUR SEM VERJA PLYTIX ──────────────────────────────────
 *  1. SKU ER PLYTIX-SKU, STAFRÉTT. Sheetið geymir `9004581`, Plytix
 *     `STO_9004581` (og stundum `STO_9003663_STK`). Í „Create or update"
 *     býr rangt SKU til NÝJA VÖRU. SKU er því flett upp í nýjasta
 *     útdrættinum; finnist það ekki, eða tvö Plytix-SKU falla á sama
 *     sheet-SKU, er röðinni SLEPPT og hún nefnd.
 *  2. EIN EIGIND Á SKRÁ, ENGIR TÓMIR REITIR. Tómur reitur í innflutningi
 *     getur hreinsað eigindina ef „Erase existing" er valið. Hver skrá tekur
 *     aðeins raðir með gildi í sinni eigind, svo stillingin skiptir ekki máli.
 *  3. EKKERT HTML ÚR SHEETINU. Lýsing sem ber `<tag>` var límd inn og er
 *     sleppt — breytingin myndi escape-a hana og vefurinn sýna merkin.
 *
 * EKKI MEÐ, VILJANDI (2026-10-07):
 *   Commercial Name    vöruheitin eru í bið hjá markaðsstjóra (2026-10-02).
 *   Related Products   tengsl í Plytix eru vensl, ekki eigind; óprófað hvort
 *                      innflutningur BÆTIR VIÐ eða SKIPTIR ÚT. `relNew` er
 *                      tillaga, og útskipting myndi þurrka núverandi tengsl.
 *
 * Staðan er EKKI færð í „Flutt inn" hér. Það gerir „Merkja síðasta
 * útflutning sem Flutt inn", og byggingin staðfestir úr Plytix-útdrætti.
 *
 * Skrárnar fara í UNDIRMÖPPU, ekki í drop-möppuna sjálfa: readLatestPlytixCsv_
 * tekur nýjustu .csv þar, og innflutningsskrá myndi annars lesast sem
 * útdráttur við næstu byggingu.
 ************************************************************/

const PIM_EXPORT_SUBFOLDER_ = 'innflutningur';
const PIM_EXPORT_STATUS_    = 'Samþykkt';
const PIM_AMBIGUOUS_        = '\u0000tvírætt';
const PIM_IMPORTED_STATUS_  = 'Flutt inn';

// Röðin hér er röð skránna í glugganum. `toPlytix` er það sem fer í skrána
// og það sem merkingin ber saman við — sama fall á báðum stöðum.
const PIM_EXPORT_ATTRS_ = [
  { key: 'descNew',  head: 'Long Description', slug: 'long_description',
    toPlytix: function (t) { return pimDescToHtml_(t); }, noHtml: true },
  { key: 'brandNew', head: 'Brand Name',       slug: 'brand_name',
    toPlytix: function (t) { return t; } }
];

function menu_exportPim() {
  const r = exportPim_();
  const lines = [];
  if (!r.files.length) lines.push('Ekkert samþykkt til að flytja út.');
  r.files.forEach(function (f) { lines.push(f.count + ' vörur → ' + f.name); });
  lines.push('', 'Sleppt:',
    '  ' + r.skip.unknown.length + ' SKU finnst ekki í Plytix-útdrættinum',
    '  ' + r.skip.ambiguous.length + ' SKU passar við fleiri en eina Plytix-vöru',
    '  ' + r.skip.html.length + ' lýsingar innihalda HTML',
    '', 'Upplýsingar um sleppt raðir eru í keyrsluskránni.');
  if (r.files.length) {
    lines.push('', 'Hver skrá sér í Plytix. Mappa: SKU → SKU, og eigindin á sjálfa sig.',
               '', r.folderUrl);
  }
  Logger.log('[PIM][UTFLUTNINGUR] ' + lines.join(' | '));
  try {
    SpreadsheetApp.getUi().alert('Útflutningur í Plytix', lines.join('\n'),
                                 SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Keyrt úr ritlinum: ekkert UI, keyrsluskráin dugar.
  }
}

/** Kólumnur Vinnusheet eftir KÓLUMNUHEITI — sheetið getur verið byggt með
 *  eldri kólumnuröð. Kastar ef skyldukólumna vantar. */
function pimExportOpen_() {
  const cfg = loadConfig_();
  const sh = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID).getSheetByName(PIM_SHEET_);
  if (!sh || sh.getLastRow() < 2) throw new Error(PIM_SHEET_ + ' fannst ekki eða er tómt.');
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(normHeader_);
  const col = {};
  ['label', 'sku', 'status'].concat(PIM_EXPORT_ATTRS_.map(function (a) { return a.key; }))
    .forEach(function (k) {
      col[k] = head.indexOf(normHeader_(PIM_COLS_[pimColNum_(k) - 1].head));
      if (col[k] === -1) throw new Error('Kólumna „' + PIM_COLS_[pimColNum_(k) - 1].head + '" finnst ekki.');
    });
  return { sh: sh, vals: vals, col: col };
}

function exportPim_() {
  const o = pimExportOpen_(), vals = o.vals, col = o.col;
  const plytixSku = pimPlytixSkuMap_();

  const out = {};
  PIM_EXPORT_ATTRS_.forEach(function (a) { out[a.key] = [['SKU', a.head]]; });
  const skip = { unknown: [], ambiguous: [], html: [] };

  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    if (String(row[col.status]).trim() !== PIM_EXPORT_STATUS_) continue;
    const has = PIM_EXPORT_ATTRS_.filter(function (a) { return String(row[col[a.key]] || '').trim(); });
    if (!has.length) continue;

    const key = normSku_(row[col.sku]);
    const who = key + ' ' + String(row[col.label] || '').slice(0, 40);
    const raw = plytixSku[key];
    if (!raw) { skip.unknown.push(who); continue; }
    if (raw === PIM_AMBIGUOUS_) { skip.ambiguous.push(who); continue; }

    has.forEach(function (a) {
      const text = String(row[col[a.key]]).trim();
      if (a.noHtml && /<\/?[a-z][^>]*>/i.test(text)) { skip.html.push(who); return; }
      out[a.key].push([raw, a.toPlytix(text)]);
    });
  }

  Object.keys(skip).forEach(function (k) {
    if (skip[k].length) Logger.log('[PIM][UTFLUTNINGUR] sleppt (' + k + '): ' + skip[k].join('; '));
  });

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmm');
  const folder = pimExportFolder_();
  const files = [];
  PIM_EXPORT_ATTRS_.forEach(function (a) {
    const rows = out[a.key];
    if (rows.length < 2) return;
    const name = 'plytix_import_' + a.slug + '_' + stamp + '.csv';
    folder.createFile(name, pimToCsv_(rows), MimeType.CSV);
    files.push({ name: name, count: rows.length - 1 });
  });

  return { files: files, skip: skip, folderUrl: folder.getUrl() };
}

/**
 * Valmynd: eftir innflutning í Plytix. Les skrár NÝJASTA útflutningsins
 * (sama tímastimpil) og færir vörurnar í þeim úr Samþykkt í Flutt inn.
 * Útflutningurinn tekur aðeins Samþykkt, svo þær fara ekki aftur.
 *
 * Merkt er AÐEINS ef röðin er enn Samþykkt OG hvert gildi sem fór í skrá er
 * enn það sem sheetið gefur. Hafi einhver breytt eftir útflutning er það ekki
 * sá texti sem fór inn, og röðin bíður næsta útflutnings í stað þess að vera
 * merkt þegjandi sem komin.
 *
 * Að skrá hafi verið búin til sannar ekki innflutning — þess vegna spyr
 * glugginn fyrst. Byggingin staðfestir svo úr næsta Plytix-útdrætti.
 */
function menu_markPimExportImported() {
  const ui = SpreadsheetApp.getUi();
  const batch = pimLatestExportBatch_();
  const n = Object.keys(batch.sent).length;
  const ok = ui.alert('Merkja sem Flutt inn',
    batch.names.join('\n') + '\n' + n + ' vörur.\n\n' +
    'Ertu búinn að flytja ' + (batch.names.length > 1 ? 'ALLAR þessar skrár' : 'þessa skrá') +
    ' inn í Plytix?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const r = markPimImported_(batch.sent);
  const lines = [
    r.marked + ' merktar Flutt inn.',
    r.already + ' voru þegar Flutt inn.',
    r.notApproved.length + ' ekki lengur Samþykkt — ekki snertar.',
    r.changed.length + ' með breyttan texta eftir útflutning — ekki snertar.',
    r.missing.length + ' fundust ekki í sheetinu.'
  ];
  Logger.log('[PIM][FLUTT INN] ' + batch.names.join(', ') + ' | ' + lines.join(' | '));
  ['notApproved', 'changed', 'missing'].forEach(function (k) {
    if (r[k].length) Logger.log('[PIM][FLUTT INN] ' + k + ': ' + r[k].join('; '));
  });
  ui.alert('Merkja sem Flutt inn', lines.join('\n'), ui.ButtonSet.OK);
}

/** sent: { sheet-SKU: { attrKey: gildið í skránni } } */
function markPimImported_(sent) {
  const o = pimExportOpen_(), sh = o.sh, vals = o.vals, col = o.col;
  const out = { marked: 0, already: 0, notApproved: [], changed: [], missing: [] };
  const seen = {};
  for (let r = 1; r < vals.length; r++) {
    const key = normSku_(vals[r][col.sku]);
    if (!(key in sent)) continue;
    seen[key] = true;
    const who = key + ' ' + String(vals[r][col.label] || '').slice(0, 40);
    const status = String(vals[r][col.status]).trim();
    if (status === PIM_IMPORTED_STATUS_) { out.already++; continue; }
    if (status !== PIM_EXPORT_STATUS_) { out.notApproved.push(who + ' (' + status + ')'); continue; }
    const same = PIM_EXPORT_ATTRS_.every(function (a) {
      if (!(a.key in sent[key])) return true;
      return a.toPlytix(String(vals[r][col[a.key]] || '').trim()) === sent[key][a.key];
    });
    if (!same) { out.changed.push(who); continue; }
    // Reitur fyrir reit, aldrei spönn: sjá voruinnihald_saveRows um hvernig
    // setValues yfir spönn skrifar til baka yfir það sem aðrir breyttu.
    sh.getRange(r + 1, col.status + 1).setValue(PIM_IMPORTED_STATUS_);
    out.marked++;
  }
  Object.keys(sent).forEach(function (k) { if (!seen[k]) out.missing.push(k); });
  SpreadsheetApp.flush();
  return out;
}

/** Skrár nýjasta útflutnings: allar `plytix_import_<slug>_<stimpill>.csv`
 *  með nýjasta stimplinum. Eldri skrár með eina eigind (fyrir 2026-10-07)
 *  lesast eins. */
function pimLatestExportBatch_() {
  const re = /^plytix_import_(.+)_(\d{4}-\d{2}-\d{2}_\d{4})\.csv$/i;
  const it = pimExportFolder_().getFiles();
  const all = [];
  while (it.hasNext()) {
    const f = it.next(), m = re.exec(f.getName());
    if (m) all.push({ f: f, slug: m[1], stamp: m[2] });
  }
  if (!all.length) throw new Error('Engin útflutningsskrá í ' + PIM_EXPORT_SUBFOLDER_ + '.');
  const latest = all.map(function (x) { return x.stamp; }).sort().pop();

  const sent = {}, names = [];
  all.filter(function (x) { return x.stamp === latest; }).forEach(function (x) {
    const a = PIM_EXPORT_ATTRS_.filter(function (y) { return y.slug === x.slug; })[0];
    if (!a) return;
    names.push(x.f.getName());
    const grid = Utilities.parseCsv(x.f.getBlob().getDataAsString('UTF-8'));
    for (let r = 1; r < grid.length; r++) {
      if (!grid[r][0]) continue;
      const k = normSku_(grid[r][0]);
      (sent[k] = sent[k] || {})[a.key] = String(grid[r][1] || '');
    }
  });
  return { sent: sent, names: names };
}

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

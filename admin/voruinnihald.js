'use strict';

/************************************************************
 * 📝 voruinnihald.js — skrifsýn fyrir vöruheiti og vörulýsingar
 *
 * Þjónshliðin fyrir `?app=voruinnihald`. Les og skrifar VINNUSHEET, sama
 * skjal sem `pim/buildPimWorksheet.js` byggir í aðal-projectinu.
 *
 * ÞRJÁR ÁKVARÐANIR SEM ERU ÞESS VERÐAR AÐ ÞEKKJA
 *
 * 1. KÓLUMNUR ERU LESNAR EFTIR HEITI, ALDREI EFTIR STÖÐU.
 *    Þetta er ANNAÐ GAS-project og sér ekki `PIM_COLS_`. Það er í raun
 *    kostur: kólumnuröðin í VINNUSHEET breyttist tvisvar á tveimur dögum
 *    (Level-lögin þrjú og svo `Á vef`), og hvert lag hliðraði öllu til
 *    hægri. Lestur eftir stöðu hefði skrifað í ranga kólumnu í þögn.
 *
 * 2. SKRÁNINGIN ER `Eigandi`-KÓLUMNAN SJÁLF.
 *    Ekkert sérstakt geymslulag fyrir hver-tók-hvað. Að taka flokk er að
 *    setja nafnið á raðir hans, sem sheetið var hannað fyrir og sýnir
 *    þegar. Endurbygging varðveitir kólumnuna (hún er `edit`), svo
 *    skráningin lifir hana.
 *
 * 3. VISTUN LEYSIR RÖÐINA UPP EFTIR SKU, EKKI EFTIR RAÐARTÖLU FRÁ VAFRANUM.
 *    Sé sheetið endurbyggt milli þess að síðan hleðst og starfsmaður
 *    vistar, þá er raðartala frá vafranum gengin úr gildi og myndi skrifa
 *    lýsingu á ranga vöru. SKU er einkvæmt á öllum 4.477 (mælt 2026-09-09).
 *
 * ÞAÐ SEM ER ALDREI SKRIFAÐ: `Orðafjöldi` og `Fullbúið` eru ARRAYFORMULU-
 * kólumnur. Skrif í þær eyðir formúlunni fyrir ALLAR raðir, ekki bara eina.
 ************************************************************/

var VI_SHEET_ = 'Vinnusheet';
var VI_LOCK_MS_ = 20000;

/** Kólumnuheiti eins og buildPimWorksheet.js skrifar þau. Breytist heiti
 *  þar verður að breyta því hér — `vi_open_` kastar ef kólumna finnst ekki,
 *  svo það kemur fram sem villa og ekki sem þögul eyða. */
var VI_H_ = {
  label:  'Label (BC)',          sku:      'SKU',
  cat1:   'Yfirflokkur',         cat2:     'Flokkur',        cat3: 'Undirflokkur',
  owner:  'Eigandi',
  nameOld:'Vöruheiti (núv.)',    nameNew:  'Vöruheiti (nýtt)',
  descOld:'Löng lýsing (núv.)',  descNew:  'Löng lýsing (ný)',
  brandOld:'Vörumerki (núv.)',   brandNew: 'Vörumerki (nýtt)',
  datasheet:'Gagnablað',         sds:      'Öryggisblað',
  status: 'Staða',               note:     'Athugasemd',
  onWeb:  'Á vef',               framework:'Rammasamningur',  url: 'Vefslóð'
};

/** Aðeins þessar má skrifa. `Orðafjöldi` og `Fullbúið` eru formúlur, og
 *  allt annað kemur úr Plytix eða PRODUCTS og yfirskrifast við endurbyggingu.
 *  Listinn er hvítlisti af ásettu ráði: nýr reitur í vafranum getur ekki
 *  skrifað í læsta kólumnu fyrir slysni. */
var VI_WRITABLE_ = ['owner', 'brandNew', 'nameNew', 'descNew',
                    'datasheet', 'sds', 'status', 'note'];

/** Orðamark á langri lýsingu. VERÐUR að vera það sama sem PIM_WORDS_MIN_/MAX_
 *  í `pim/buildPimWorksheet.js` — lækkað úr 60 í 20 þann 2026-09-10 eftir
 *  raunprófun (þrjár lýsingar lentu á 40, 29 og 24 orðum). */
var VI_WORDS_MIN_ = 20;
var VI_WORDS_MAX_ = 150;

// ---------------------------------------------------------------------------
// Grunnur
// ---------------------------------------------------------------------------

/** Opnar VINNUSHEET og kortleggur hausröðina eftir HEITI. */
function vi_open_() {
  var cfg = loadConfig_();
  var id = cfg.SHEETS && cfg.SHEETS.PIM && cfg.SHEETS.PIM.ID;
  if (!id) {
    throw new Error('Vantar SHEET_IDS-röð „PIM“ í STORKAUP_CONFIG.');
  }
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(VI_SHEET_);
  if (!sh) throw new Error('Flipinn „' + VI_SHEET_ + '“ finnst ekki í VINNUSHEET.');
  if (sh.getLastRow() < 2) throw new Error('VINNUSHEET er tómt — byggðu það fyrst.');

  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(function (h) {
    return String(h || '').toLowerCase().replace(/[\s_\-]/g, '');
  });
  var idx = {}, missing = [];
  Object.keys(VI_H_).forEach(function (k) {
    var want = VI_H_[k].toLowerCase().replace(/[\s_\-]/g, '');
    var j = head.indexOf(want);
    if (j === -1) missing.push(VI_H_[k]);
    else idx[k] = j;
  });
  if (missing.length) {
    throw new Error('Kólumnur finnast ekki á ' + VI_SHEET_ + ': ' + missing.join(', ') +
                    '. Hafa heitin breyst í buildPimWorksheet.js?');
  }
  return { sh: sh, idx: idx, vals: vals };
}

function vi_words_(t) {
  var m = String(t == null ? '' : t).trim().match(/\S+/g);
  return m ? m.length : 0;
}

function vi_isDone_(descNew) {
  var n = vi_words_(descNew);
  return n >= VI_WORDS_MIN_ && n <= VI_WORDS_MAX_;
}

// ---------------------------------------------------------------------------
// Lestur
// ---------------------------------------------------------------------------

/**
 * Flokkatréð: einn hlutur per Undirflokk, með vinnu, eiganda og framvindu.
 *
 * `w` er LÝSINGAR AÐ SKRIFA, ekki vörufjöldi. Sá greinarmunur er ekki
 * smáatriði: flokkur með 441 vöru getur haft 108 lýsingar og flokkur með 209
 * vörum 125. Vörufjöldi á borðinu lætur fólk taka rangt.
 */
function voruinnihald_getTree() {
  var user = adminGuard_('voruinnihald');
  var o = vi_open_(), idx = o.idx, vals = o.vals;
  var map = {};

  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var sku = String(row[idx.sku] || '').trim();
    if (!sku) continue;
    var c3 = String(row[idx.cat3] || '').trim();
    var key = c3 || '(ekkert undirlag)';
    var g = map[key];
    if (!g) {
      g = map[key] = {
        cat3: c3,
        cat1: String(row[idx.cat1] || '').trim(),
        cat2: String(row[idx.cat2] || '').trim(),
        n: 0, w: 0, done: 0, owners: {}
      };
    }
    g.n++;

    var descOld = String(row[idx.descOld] || '').trim();
    var label = String(row[idx.label] || '').trim();
    if (!descOld || descOld === label) g.w++;
    if (vi_isDone_(row[idx.descNew])) g.done++;

    var own = String(row[idx.owner] || '').trim();
    if (own) g.owners[own] = (g.owners[own] || 0) + 1;
  }

  var out = Object.keys(map).map(function (k) {
    var g = map[k];
    // Flokkur telst tekinn af þeim sem á flestar raðir í honum. Ein kólumna
    // per röð þýðir að hún getur verið blönduð; meirihlutinn er svarið og
    // `mixed` segir frá því í stað þess að fela það.
    var names = Object.keys(g.owners);
    var top = '', best = 0;
    names.forEach(function (n) { if (g.owners[n] > best) { best = g.owners[n]; top = n; } });
    return {
      cat1: g.cat1, cat2: g.cat2, cat3: g.cat3,
      n: g.n, w: g.w, done: g.done,
      owner: top, mixed: names.length > 1
    };
  });

  return { user: user, groups: out, wordsMin: VI_WORDS_MIN_, wordsMax: VI_WORDS_MAX_ };
}

/** Raðirnar í einum Undirflokki, í þeirri röð sem sheetið hefur þær. */
function voruinnihald_getGroup(cat3) {
  adminGuard_('voruinnihald');
  var want = String(cat3 == null ? '' : cat3).trim();
  var o = vi_open_(), idx = o.idx, vals = o.vals;
  var items = [];

  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var sku = String(row[idx.sku] || '').trim();
    if (!sku) continue;
    if (String(row[idx.cat3] || '').trim() !== want) continue;

    var descOld = String(row[idx.descOld] || '').trim();
    var label = String(row[idx.label] || '').trim();
    items.push({
      sku: sku, label: label,
      cat1: String(row[idx.cat1] || '').trim(),
      cat2: String(row[idx.cat2] || '').trim(),
      cat3: String(row[idx.cat3] || '').trim(),
      brandOld: String(row[idx.brandOld] || '').trim(),
      nameOld: String(row[idx.nameOld] || '').trim(),
      descOld: descOld,
      descWords: vi_words_(descOld),
      descIsName: !!descOld && descOld === label,
      onWeb: String(row[idx.onWeb] || '').trim(),
      framework: String(row[idx.framework] || '').trim() === 'Já',
      url: String(row[idx.url] || '').trim(),
      // Það sem starfsfólk hefur þegar skrifað
      owner: String(row[idx.owner] || '').trim(),
      brandNew: String(row[idx.brandNew] || '').trim(),
      nameNew: String(row[idx.nameNew] || '').trim(),
      descNew: String(row[idx.descNew] || '').trim(),
      datasheet: String(row[idx.datasheet] || '').trim(),
      sds: String(row[idx.sds] || '').trim(),
      status: String(row[idx.status] || '').trim(),
      note: String(row[idx.note] || '').trim()
    });
  }
  if (!items.length) throw new Error('Enginn flokkur með undirflokkinn „' + want + '“.');
  return items;
}

// ---------------------------------------------------------------------------
// Skrif
// ---------------------------------------------------------------------------

/**
 * Vistar raðir. `rows` er fylki af `{sku, ...reitir}` — aðeins reitir í
 * VI_WRITABLE_ eru skrifaðir og aðeins þeir sem eru SENDIR (undefined lætur
 * gildið í sheetinu í friði, svo tveir sem vinna á sama flokki þurrka ekki
 * út hvor annars vinnu í reitum sem hvorugur snerti).
 *
 * Röðin er leyst upp eftir SKU. Sjá hausinn um hvers vegna raðartala frá
 * vafranum er ekki nothæf.
 */
function voruinnihald_saveRows(rows) {
  var user = adminGuard_('voruinnihald');
  if (!Array.isArray(rows) || !rows.length) return { saved: 0 };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(VI_LOCK_MS_)) {
    throw new Error('Annar er að vista núna. Bíddu í nokkrar sekúndur og reyndu aftur.');
  }
  try {
    var o = vi_open_(), sh = o.sh, idx = o.idx, vals = o.vals;

    var rowBySku = {};
    for (var r = 1; r < vals.length; r++) {
      var s = String(vals[r][idx.sku] || '').trim();
      if (s) rowBySku[s] = r;            // 0-basað í vals, +1 fyrir getRange
    }

    // EITT KALL PER KÓLUMNU, EKKI PER REIT.
    //
    // setValue í lykkju gefur 100 API-köll á 25 vörur og fjórar breytingar,
    // sem tekur tugi sekúndna. Það myndi láta appið tapa fyrir töflureikni
    // á hraða þótt það ynni á þægindum — og þá mælir prófið útfærsluna í
    // stað hugmyndarinnar.
    //
    // Raðir flokks eru SAMFELLDAR í sheetinu því buildPimWorksheet raðar
    // eftir Level 1 → 2 → 3, svo hver kólumna er eitt setValues-kall
    // óháð fjölda raða. Sé eitthvað ósamfellt (blandaður bunki) nær spönnin
    // yfir bilið og ósnertar raðir eru skrifaðar með sínu eigin gildi.
    var saved = 0, unknown = [], touched = {}, lo = null, hi = null;
    rows.forEach(function (inRow) {
      var sku = String((inRow && inRow.sku) || '').trim();
      var r0 = rowBySku[sku];
      if (!sku || r0 === undefined) { if (sku) unknown.push(sku); return; }
      touched[r0] = inRow;
      if (lo === null || r0 < lo) lo = r0;
      if (hi === null || r0 > hi) hi = r0;
      saved++;
    });

    if (saved) {
      var span = hi - lo + 1;
      VI_WRITABLE_.forEach(function (k) {
        var col = idx[k] + 1;
        var out = [], changed = false;
        for (var r = lo; r <= hi; r++) {
          var inRow = touched[r];
          var cur = vals[r][idx[k]];
          if (inRow && (k in inRow) && inRow[k] !== null && inRow[k] !== undefined) {
            var v = String(inRow[k]);
            if (v !== String(cur == null ? '' : cur)) changed = true;
            out.push([v]);
          } else {
            out.push([cur == null ? '' : cur]);
          }
        }
        // Sleppum kólumnu sem engin röð breytti — annars skrifum við sömu
        // gildi til baka og eyðum kvóta á ekkert.
        if (changed) sh.getRange(lo + 1, col, span, 1).setValues(out);
      });
    }

    if (unknown.length) {
      console.warn('[VORUINNIHALD][AUDIT] ' + user + ' sendi ' + unknown.length +
                   ' óþekkt SKU: ' + unknown.slice(0, 10).join(', '));
    }
    SpreadsheetApp.flush();
    return { saved: saved, unknown: unknown.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Tekur flokk: setur `Eigandi` á allar raðir hans.
 *
 * Undir læsingu og með lestri á eftir, svo tveir sem ýta samtímis fái ekki
 * báðir flokkinn. Sá sem kemur seinni fær nafn þess sem var á undan til
 * baka og skilaboð, í stað þess að skrifa yfir hann.
 */
function voruinnihald_claim(cat3) {
  var user = adminGuard_('voruinnihald');
  var want = String(cat3 == null ? '' : cat3).trim();
  if (!want) throw new Error('Enginn undirflokkur gefinn.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(VI_LOCK_MS_)) {
    throw new Error('Einhver annar er að taka flokk núna. Reyndu aftur.');
  }
  try {
    var o = vi_open_(), sh = o.sh, idx = o.idx, vals = o.vals;
    var rowsToSet = [], held = {};

    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][idx.cat3] || '').trim() !== want) continue;
      var own = String(vals[r][idx.owner] || '').trim();
      if (own && own !== user) held[own] = (held[own] || 0) + 1;
      rowsToSet.push(r);
    }
    if (!rowsToSet.length) throw new Error('Flokkurinn „' + want + '“ finnst ekki.');

    var holders = Object.keys(held);
    if (holders.length) {
      return { ok: false, takenBy: holders.join(', '), rows: 0 };
    }

    rowsToSet.forEach(function (r) {
      sh.getRange(r + 1, idx.owner + 1).setValue(user);
    });
    SpreadsheetApp.flush();
    console.log('[VORUINNIHALD][AUDIT] ' + user + ' tok „' + want + '“ (' +
                rowsToSet.length + ' radir)');
    return { ok: true, owner: user, rows: rowsToSet.length };
  } finally {
    lock.releaseLock();
  }
}

/** Sleppir flokki: tæmir `Eigandi` á röðum sem ÞESSI notandi á. Raðir sem
 *  annar á eru látnar í friði, svo „sleppa“ getur ekki tekið flokk af öðrum. */
function voruinnihald_release(cat3) {
  var user = adminGuard_('voruinnihald');
  var want = String(cat3 == null ? '' : cat3).trim();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(VI_LOCK_MS_)) throw new Error('Reyndu aftur eftir smá stund.');
  try {
    var o = vi_open_(), sh = o.sh, idx = o.idx, vals = o.vals;
    var n = 0;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][idx.cat3] || '').trim() !== want) continue;
      if (String(vals[r][idx.owner] || '').trim() !== user) continue;
      sh.getRange(r + 1, idx.owner + 1).setValue('');
      n++;
    }
    SpreadsheetApp.flush();
    console.log('[VORUINNIHALD][AUDIT] ' + user + ' slepti „' + want + '“ (' + n + ' radir)');
    return { ok: true, rows: n };
  } finally {
    lock.releaseLock();
  }
}

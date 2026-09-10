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

/**
 * Hver er innskráður. NETFANGIÐ er auðkennið, alla leið.
 *
 * ÞETTA VAR VILLA OG HÚN HAFÐI EINA RÓT: `adminGuard_` skilar netfangi en
 * `Eigandi`-kólumnan hafði gagnaprófun úr lista sem geymdi FORNÖFN. Appið
 * skrifaði netfang í reit sem tók aðeins „Óli" og Sheets kastaði
 * „violates the data validation rules". Sama ósamræmi lét „Mitt" aldrei
 * finna eigin flokka og „Sleppa" sleppa engu.
 *
 * Lagað með því að fjarlægja annað auðkennisrýmið, ekki með því að þýða á
 * milli þeirra. Nafn er birtingarmerki sem getur stangast á (tveir Jónar);
 * netfangið er það sem Google-innskráningin, `adminGuard_` og allowlistarnir
 * vinna öll með hvort sem er.
 *
 * EIN RÖÐ: `VORUINNIHALD_APP_EMAILS` bæði fyrir aðgang og fellilista, svo
 * `pimOwners_` í aðal-projectinu les hana líka. Þess vegna er athugunin hér
 * næstum óþörf — hleypti `adminGuard_` þér inn ertu í listanum og því í
 * fellilistanum. Hún er samt eftir af EINNI ástæðu: eigandinn (deployerinn)
 * sleppur alltaf gegnum `adminGuard_`, líka þótt hann sé ekki í listanum, og
 * myndi þá skrifa gildi sem gagnaprófunin hafnar. Skýr villa hér er betri en
 * Sheets-undantekning sem segir ekkert um hvað eigi að gera.
 */
function vi_me_() {
  var email = adminGuard_('voruinnihald');
  var cfg = loadConfig_();
  var sets = cfg.SETTINGS || {};
  var raw = String(sets.VORUINNIHALD_APP_EMAILS || sets.PIM_OWNERS || '');
  var list = raw.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  if (list.indexOf(email) === -1) {
    var msg = 'Netfangið ' + email + ' er ekki í VORUINNIHALD_APP_EMAILS.';
    var near = vi_nearest_(email, list);
    if (near) {
      msg += ' Í listanum stendur ' + near + ' — er það innsláttarvilla?';
    }
    throw new Error(msg + ' Eigandi-kólumnan tekur aðeins netföngin úr þeim ' +
      'lista, svo bættu réttu við STORKAUP_CONFIG → SETTINGS og byggðu ' +
      'vinnusheetið aftur (gagnaprófunin er sett við byggingu).');
  }
  return email;
}

/**
 * Næsta netfang í listanum, ef það er nógu líkt til að vera innsláttarvilla.
 *
 * HVERS VEGNA: fyrsta tilraunin til að opna appið féll á því að aðgangurinn er
 * `umsokn@storkaup.is` (umsókn, með k) en í config stóð `umsjon@storkaup.is`
 * (umsjón, með j). Villan nefndi bæði netfangið og röðina, en ekki að svarið
 * væri í listanum með tveimur stöfum víxlað. Sá sem les hana á ekki að þurfa
 * að bera saman tvo næstum eins strengi með augunum.
 *
 * Levenshtein á local-part, aðeins innan sama domains, og aðeins ef fjarlægðin
 * er 1 eða 2 — þá er það villa, ekki annar maður.
 */
function vi_nearest_(email, list) {
  var at = email.indexOf('@');
  if (at < 1) return '';
  var me = email.slice(0, at), dom = email.slice(at);
  var best = '', bestD = 3;
  list.forEach(function (cand) {
    if (cand.slice(cand.indexOf('@')) !== dom) return;
    var d = vi_lev_(me, cand.slice(0, cand.indexOf('@')));
    // d > 0: fjarlaegd 0 vaeri sami strengur, og bending um innslattarvillu
    // a sjalfan sig er vitleysa. Getur ekki gerst i raun (fallid er adeins
    // kallad thegar netfangid er EKKI i listanum) en er utilokad her samt.
    if (d > 0 && d < bestD) { bestD = d; best = cand; }
  });
  return best;
}

function vi_lev_(a, b) {
  if (a === b) return 0;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                        prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    prev = cur.slice();
  }
  return prev[b.length];
}

/**
 * Raðir sem valari nær yfir. `{cat3: x}` er einn undirflokkur, `{cat2: y}`
 * allur flokkurinn.
 *
 * SKRÁNING ER Á LEVEL 2, SKRIFAÐ ER Á LEVEL 3. Level 2 er úthlutunarbúturinn
 * — mælt á útdrættinum: 39 flokkar, allir undir 92 skrifum nema `Ryksugur`
 * með 172, svo hann er sá eini sem verður að klofna. Level 3 er verkbúturinn
 * innan hans, 1 til 14 per flokk. Að opna Level 2 til skrifta hefði gefið
 * `Ræstiáhöldum` 441 röð í einni beit.
 */
function vi_rows_(vals, idx, sel) {
  // Strengur er skilinn sem undirflokkur, svo kall ur Apps Script-ritlinum
  // (voruinnihald_claim('Kokosmjolk')) virki eins og vaenta ma. Hann er
  // TVIRAEDUR thar sem heitid endurtekur sig — sja hausinn a vi_key_.
  if (typeof sel === 'string') sel = { cat3: sel };
  var c1 = String((sel && sel.cat1) || '').trim();
  var c2 = String((sel && sel.cat2) || '').trim();
  var c3 = String((sel && sel.cat3) || '').trim();
  if (!c2 && !c3) throw new Error('Enginn flokkur gefinn.');

  // ÖLL LÖG SEM ERU GEFIN VERÐA AÐ STEMMA. Áður var aðeins það dýpsta
  // borið saman, og þá tók `{cat3:'Hanskar'}` 61 röð yfir TVO Yfirflokka.
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    if (!String(vals[r][idx.sku] || '').trim()) continue;
    if (c1 && String(vals[r][idx.cat1] || '').trim() !== c1) continue;
    if (c2 && String(vals[r][idx.cat2] || '').trim() !== c2) continue;
    if (c3 && String(vals[r][idx.cat3] || '').trim() !== c3) continue;
    out.push(r);
  }
  return out;
}

/**
 * Lykill hops: FULL SLOÐ, ekki undirflokksheitid eitt.
 *
 * MÆLT Í SHEETINU 2026-09-10 (`voruinnihald_diagnoseTree`): 77 undirflokks-
 * heiti liggja undir fleiri en einni slóð. `Hanskar` er bæði
 * `Heilbrigðisvörur > Heilbrigðisrekstrarvara` (22 vörur) og
 * `Rekstrarvörur > Einnota rekstrarvörur` (39). `Hlífðarfatnaður` er á fimm
 * slóðum, `Yfirborðshreinsar` á fjórum.
 *
 * Í PLYTIX eru heitin einkvæm — 213 heiti á 213 slóðum — svo þetta sést ekki
 * þar. Sheetið blandar tveimur trjám: kólumnurnar koma úr PRODUCTS
 * (brauðmylsna Cludo) þar sem röð er til og úr Plytix-slóðinni annars.
 *
 * Lyklun á heitið eitt lét þessa 77 renna saman í einn hóp sem tók Yfirflokk
 * frá fyrstu röð sem sást. Borðið sýndi þá 746 vörur undir `Rekstrarvörum`
 * þar sem sheetið hefur 1.598, og þrjá undirflokka undir `Einnota
 * rekstrarvörum` þar sem vefurinn hefur sjö. Verra: `getGroup` og `claim`
 * völdu eftir sama lykli, svo skráning á `Hanskar` hefði tekið raðir í tveimur
 * Yfirflokkum.
 */
function vi_key_(a, b, c) {
  return [a || '', b || '', c || ''].join('\u0000');
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
  var user = vi_me_();
  var o = vi_open_(), idx = o.idx, vals = o.vals;
  var map = {};

  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var sku = String(row[idx.sku] || '').trim();
    if (!sku) continue;
    var a1 = String(row[idx.cat1] || '').trim();
    var a2 = String(row[idx.cat2] || '').trim();
    var c3 = String(row[idx.cat3] || '').trim();
    var key = vi_key_(a1, a2, c3);        // FULL SLOÐ — sja vi_key_
    var g = map[key];
    if (!g) {
      g = map[key] = { cat1: a1, cat2: a2, cat3: c3, n: 0, w: 0, done: 0, owners: {} };
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

  // `user` er NETFANGIÐ, sama gildi sem stendur i Eigandi-kolumnunni.
  return { user: user, groups: out,
           wordsMin: VI_WORDS_MIN_, wordsMax: VI_WORDS_MAX_ };
}

/**
 * Raðirnar í einum Undirflokki, í þeirri röð sem sheetið hefur þær.
 *
 * `sel` er FULL SLOÐ (`{cat1, cat2, cat3}`), ekki heitið eitt: 77 heiti
 * liggja undir fleiri en einni slóð og heitið eitt hefði skilað röðum úr
 * tveimur Yfirflokkum. Sjá `vi_key_`.
 */
function voruinnihald_getGroup(sel) {
  adminGuard_('voruinnihald');
  if (typeof sel === 'string') sel = { cat3: sel };
  var o = vi_open_(), idx = o.idx, vals = o.vals;
  var want = vi_rows_(vals, idx, sel);
  var items = [];

  for (var q = 0; q < want.length; q++) {
    var r = want[q];
    var row = vals[r];

    var sku = String(row[idx.sku] || '').trim();
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
  if (!items.length) {
    throw new Error('Enginn flokkur með slóðina ' +
      [sel.cat1, sel.cat2, sel.cat3].filter(Boolean).join(' › ') + '.');
  }
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
  var user = adminGuard_('voruinnihald');   // netfang naegir hér — engin
                                            // skrif i Eigandi-kolumnuna

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
function voruinnihald_claim(sel) {
  var user = vi_me_();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(VI_LOCK_MS_)) {
    throw new Error('Einhver annar er að taka flokk núna. Reyndu aftur.');
  }
  try {
    var o = vi_open_(), sh = o.sh, idx = o.idx, vals = o.vals;
    var rows = vi_rows_(vals, idx, sel);
    if (!rows.length) {
      throw new Error('Flokkurinn finnst ekki: ' +
        [sel.cat1, sel.cat2, sel.cat3].filter(Boolean).join(' › '));
    }

    // Hver a rodh sem er thegar tekin? Skilum theim til baka i stad thess ad
    // skrifa yfir. Blandadur flokkur (tveir eigendur) er lika svar.
    var held = {};
    rows.forEach(function (r) {
      var own = String(vals[r][idx.owner] || '').trim();
      if (own && own !== user) held[own] = (held[own] || 0) + 1;
    });
    var holders = Object.keys(held);
    if (holders.length) {
      return { ok: false, takenBy: holders.join(', '), rows: 0 };
    }

    // Samfelldar radir -> eitt setValues. Sama rok sem i saveRows.
    var lo = rows[0], hi = rows[rows.length - 1];
    var col = [], set = {};
    rows.forEach(function (r) { set[r] = true; });
    for (var r2 = lo; r2 <= hi; r2++) {
      col.push([set[r2] ? user : (vals[r2][idx.owner] || '')]);
    }
    sh.getRange(lo + 1, idx.owner + 1, hi - lo + 1, 1).setValues(col);
    SpreadsheetApp.flush();
    console.log('[VORUINNIHALD][AUDIT] ' + user + ' tok ' + JSON.stringify(sel) +
                ' (' + rows.length + ' radir)');
    return { ok: true, owner: user, rows: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/** Sleppir flokki: tæmir `Eigandi` á röðum sem ÞESSI notandi á. Raðir sem
 *  annar á eru látnar í friði, svo „sleppa" getur ekki tekið flokk af öðrum. */
function voruinnihald_release(sel) {
  var user = vi_me_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(VI_LOCK_MS_)) throw new Error('Reyndu aftur eftir smá stund.');
  try {
    var o = vi_open_(), sh = o.sh, idx = o.idx, vals = o.vals;
    var rows = vi_rows_(vals, idx, sel).filter(function (r) {
      return String(vals[r][idx.owner] || '').trim() === user;
    });
    if (!rows.length) return { ok: true, rows: 0 };
    var lo = rows[0], hi = rows[rows.length - 1], set = {};
    rows.forEach(function (r) { set[r] = true; });
    var col = [];
    for (var r2 = lo; r2 <= hi; r2++) {
      col.push([set[r2] ? '' : (vals[r2][idx.owner] || '')]);
    }
    sh.getRange(lo + 1, idx.owner + 1, hi - lo + 1, 1).setValues(col);
    SpreadsheetApp.flush();
    console.log('[VORUINNIHALD][AUDIT] ' + user + ' slepti ' + JSON.stringify(sel) +
                ' (' + rows.length + ' radir)');
    return { ok: true, rows: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Greining
// ---------------------------------------------------------------------------

/**
 * Hvernig flokkarnir liggja í VINNUSHEET, í raun.
 *
 * TIL AÐ SVARA EINNI SPURNINGU: borðið sýndi 746 vörur undir `Rekstrarvörum`
 * en Plytix-útdrátturinn hefur 1.717. Ég giskaði á að hópar rynnu saman af
 * því ég lykla þá á undirflokksheiti, en það var rangt — í Plytix eru heitin
 * einkvæm (213 heiti, 213 slóðir).
 *
 * Eftir stendur að sheetið blandar TVEIMUR flokkatrjám: kólumnurnar koma úr
 * PRODUCTS (brauðmylsna Cludo) þar sem röð er til, og úr Plytix-slóðinni
 * annars. Þau tvö þurfa ekki að vera samhljóða, og hvorugt er þar að auki
 * einkvæmt: vara getur verið í mörgum flokkum og bæði kerfin velja EINN.
 *
 * Þetta fall mælir það í stað þess að giska: hvað er í hvorum Yfirflokki,
 * hversu margar raðir hafa tómt lag, og hvort sama undirflokksheiti liggi
 * undir fleiri en einum flokki (sem myndi renna saman í `getTree`).
 *
 * Keyrt handvirkt úr Apps Script-ritlinum. Skrifar í keyrsluskrá.
 */
function voruinnihald_diagnoseTree() {
  var o = vi_open_(), idx = o.idx, vals = o.vals;
  var l1 = {}, byName = {}, empty = { cat1: 0, cat2: 0, cat3: 0 }, total = 0;

  for (var r = 1; r < vals.length; r++) {
    if (!String(vals[r][idx.sku] || '').trim()) continue;
    total++;
    var a = String(vals[r][idx.cat1] || '').trim();
    var b = String(vals[r][idx.cat2] || '').trim();
    var c = String(vals[r][idx.cat3] || '').trim();
    if (!a) empty.cat1++;
    if (!b) empty.cat2++;
    if (!c) empty.cat3++;

    var k1 = a || '(tomt)';
    l1[k1] = l1[k1] || { n: 0, l2: {}, l3: {} };
    l1[k1].n++;
    l1[k1].l2[b || '(tomt)'] = true;
    l1[k1].l3[c || '(tomt)'] = true;

    if (c) {
      byName[c] = byName[c] || {};
      byName[c][a + ' > ' + b] = (byName[c][a + ' > ' + b] || 0) + 1;
    }
  }

  Logger.log('[VI][DIAG] radir med SKU: ' + total);
  Logger.log('[VI][DIAG] tomt Yfirflokkur=' + empty.cat1 +
             ' Flokkur=' + empty.cat2 + ' Undirflokkur=' + empty.cat3);

  Object.keys(l1).sort().forEach(function (k) {
    Logger.log('[VI][DIAG] ' + k + ': ' + l1[k].n + ' vorur, ' +
               Object.keys(l1[k].l2).length + ' flokkar, ' +
               Object.keys(l1[k].l3).length + ' undirflokkar');
  });

  // Undirflokksheiti undir fleiri en einni slod -> getTree rennur thau saman
  var merged = [];
  Object.keys(byName).forEach(function (c) {
    var paths = Object.keys(byName[c]);
    if (paths.length > 1) {
      merged.push(c + ' -> ' + paths.map(function (p2) {
        return p2 + ' (' + byName[c][p2] + ')';
      }).join(' | '));
    }
  });
  Logger.log('[VI][DIAG] undirflokksheiti undir fleiri en einni slod: ' + merged.length);
  merged.slice(0, 25).forEach(function (m) { Logger.log('[VI][DIAG]   ' + m); });

  return { total: total, empty: empty, mergedNames: merged.length, merged: merged };
}

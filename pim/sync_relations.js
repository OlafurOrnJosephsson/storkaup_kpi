/************************************************************
 * 🔗 SAMSTILLING TENGSLA — vefur + flipi → raw.product_relations
 *
 * Tvær uppsprettur, ein tafla:
 *   getProductsV2.relatedProductSkus  tengslin sem ERU á vefnum → 'live'
 *   TENGSL_TILLOGUR (flipi)           tillögur úr körfugreiningu → 'suggested'
 *
 * Krefst core/sql/product_relations_v1.sql í Supabase fyrst.
 * Keyrt úr scheduledCludoSync_v1 (12h) og má keyra í höndunum.
 *
 * ── LIVE-TENGSLIN KOMA EKKI LENGUR ÚR FLIPA ─────────────────────────
 * Fyrsta útgáfa las TENGSL_HRA, sem `pimRelatedFetch_v1` fyllir með því
 * að spyrja getSingleProductV2 um hverja vöru fyrir sig — margra tíma
 * keyrsla í skömmtum. Mælt 2026-09-21: `relatedProductSkus` fæst beint á
 * LISTAfyrirspurninni sem við keyrum hvort eð er, og hún er bæði ferskari
 * og HEILLI:
 *
 *   listafyrirspurn : 12.490 tengslapör, 2.068 vörur
 *   TENGSL_HRA      :  9.941 tengslapör  (frá 16.9., náði aldrei yfir allt)
 *
 * 2.549 tengsl vantaði því í flipann. Live-hliðin kostar nú engar
 * aukabeiðnir og endurnýjast sjálfkrafa á 12 tíma fresti.
 *
 * TENGSL_HRA er EKKI lagður niður: `pimRelatedSuggest_v1` les hann til að
 * vita hvað er þegar tengt, svo tillöguvélin dettur út ef hann tæmist.
 * Hann er bara ekki lengur heimild þessarar samstillingar.
 *
 * ── RITHÆTTIRNIR ERU ÓLÍKIR EFTIR UPPSPRETTU ────────────────────────
 * Mælt 2026-09-21:
 *   relatedProductSkus  STO_113282   — og EKKI endilega sami rithátturinn
 *                       og varan sjálf ber: STO_9003663_STK vísar á
 *                       STO_136437 þótt sú vara heiti STO_136437_STK.
 *   TENGSL_TILLOGUR  A  9004596                   ber tala
 *                    D  104924 EÐA 9001525_KASSI  BLANDAÐ
 *
 * Allt fer gegnum normStorkaupSku_, sem skilar BC-forminu stafréttu með
 * forleiðandi núllum. Það er TENGILYKILL. Að nota fyrirspurnarlykil hér
 * — þann sem gerir parseInt — er villan sem kostaði 2.036 BC-línur fyrr
 * í dag. Hún er skjalfest í core/web_catalog.js og á jafnt við hér.
 *
 * ── SJÁLFSSKOÐUN Í STAÐ TRAUSTS ─────────────────────────────────────
 * Fallið telur og skilar: raðir sem normalíseruðust í tómt, tengsl á
 * sjálfa sig, og hve mörg SKU eru ekki í vefvörulistanum. Ekkert af því
 * stöðvar keyrsluna — tillöguflipinn nær yfir vörur sem eru ekki í
 * birtingu og á að gera það — en tölur sem hlaupa til milli keyrslna eru
 * merki um að eitthvað hafi breyst.
 *
 * ── EYÐING ER VARIN, EINS OG Í WEB_CATALOG ──────────────────────────
 * Raðir sem keyrslan snerti ekki eru fjarlægðar, svo tengsl sem hafa
 * verið slitin á storkaup.is hverfi líka hér. En EKKI nema BÁÐAR
 * uppsprettur hafi skilað einhverju: tómt svar þýðir nær alltaf bilun
 * eða endurbyggingu, ekki að öll tengsl hafi verið slitin.
 ************************************************************/

const REL_TABLE_      = 'product_relations';
const REL_SHEET_SUGG_ = 'TENGSL_TILLOGUR';


function syncProductRelationsToSupabase_v1() {
  const startedIso = new Date().toISOString();
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);

  const live = buildLiveRelations_();
  const sugg = readSuggestedRelations_(ss);

  if (!live.rows.length && !sugg.rows.length) {
    throw new Error('Hvorki vefurinn ne TENGSL_TILLOGUR skiladu tengslum — engu breytt.');
  }

  // Afritahreinsun a frumlyklinum (sku, related_sku, kind). Upsert med
  // tveimur eins lyklum i SAMA bunka fellur i Postgres med
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" —
  // villa sem segir ekkert um raunverulegu orsokina.
  const seen = {};
  const payload = [];
  const kept = { live: 0, suggested: 0 };
  let afrit = 0;
  live.rows.concat(sugg.rows).forEach(function (r) {
    const k = r.kind + '|' + r.sku + '|' + r.related_sku;
    if (seen[k]) { afrit++; return; }
    seen[k] = true;
    r.synced_at = startedIso;
    kept[r.kind]++;
    payload.push(r);
  });

  const conf = getSupabaseRestConfig_();
  const endpoint = conf.baseUrl + '/' + REL_TABLE_ +
                   '?on_conflict=sku,related_sku,kind';

  const CHUNK = 500;
  let uploaded = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    if (i > 0) Utilities.sleep(250);

    let code = 0, body = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: conf.serviceRole,
          Authorization: 'Bearer ' + conf.serviceRole,
          'Content-Profile': 'raw',
          'Accept-Profile': 'raw',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        payload: JSON.stringify(chunk),
        muteHttpExceptions: true
      });
      code = res.getResponseCode();
      body = res.getContentText() || '';
      if (code >= 200 && code < 300) break;
      if (attempt === 3) break;
      Logger.log('[REL][WARN] Bunki ' + (Math.floor(i / CHUNK) + 1) +
                 ' tilraun ' + attempt + '/3: ' + code + ' ' + body.slice(0, 200));
      Utilities.sleep(3000 * attempt);
    }
    if (code < 200 || code >= 300) {
      throw new Error('product_relations upsert failed: ' + code + ' ' + body.slice(0, 300));
    }
    uploaded += chunk.length;
  }

  // Eyding thess sem keyrslan snerti ekki. Bádir flipar urdu ad skila
  // einhverju — sja hausinn.
  let deleted = null;
  if (live.rows.length && sugg.rows.length) {
    deleted = deleteStaleRelations_(conf, startedIso);
  } else {
    Logger.log('[REL][VARUD] Slepp eydingu: ' + (live.rows.length ? '' : 'vefurinn skiladi engum tengslum. ') +
               (sugg.rows.length ? '' : 'TENGSL_TILLOGUR tomur. ') +
               'Urelt tengsl eru odyrari villa en tom tafla.');
  }

  // TALNINGIN ER EFTIR AFRITAHREINSUN. Fyrsta utgafa taldi live/suggested
  // FYRIR hana og skiladi live:12349 + suggested:5874 = 18.223 vid hlidina
  // a uploaded:17.301. Sa sem leggur saman faer 922 tyndar radir sem voru
  // aldrei til. Samantekt sem gengur ekki upp sendir folk i leit ad
  // villu sem er ekki thar.
  const out = {
    live: kept.live,
    suggested: kept.suggested,
    afrit: afrit,
    uploaded: uploaded,
    deleted: deleted,
    skipped: {
      tomtSku:   live.skipped.empty + sugg.skipped.empty,
      sjalfaSig: live.skipped.self + sugg.skipped.self
    },
    ekkiAVef: countNotOnWeb_(payload)
  };
  Logger.log('[REL][INFO] Sync lokid: ' + JSON.stringify(out));
  return out;
}


/**
 * Live-tengslin beint af vefnum. Engar aukabeiðnir: sami listi og
 * web_catalog notar, með relatedProductSkus í sömu ferð.
 *
 * `fetched_at` er DAGURINN Í DAG, ekki dagsetning úr flipa. Það er satt
 * hér þar sem það var ágiskun áður: gildið kemur úr fyrirspurn sem var
 * að keyra, ekki úr skömmtum sem dreifðust yfir daga.
 */
function buildLiveRelations_() {
  const skipped = { empty: 0, self: 0 };
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const fetched = fetchWebCatalogRows_();
  const rows = [];

  fetched.rows.forEach(function (r) {
    if (!r.sku) return;
    (r.related || []).forEach(function (rel) {
      if (!rel) { skipped.empty++; return; }
      if (rel === r.sku) { skipped.self++; return; }
      rows.push({
        sku: r.sku, related_sku: rel, kind: 'live',
        score: null, reason: null, fetched_at: today
      });
    });
  });

  Logger.log('[REL][INFO] Vefurinn: ' + rows.length + ' live tengsl a ' +
             fetched.rows.filter(function (r) { return (r.related || []).length; }).length +
             ' vorum.');
  return { rows: rows, skipped: skipped };
}


/**
 * TENGSL_TILLOGUR: SKU | Vöruheiti | Flokkur | Tillaga SKU |
 *                  Tillaga heiti | Tillaga flokkur | Stig | Rök
 * Heiti og flokkar eru EKKI afrituð — þau koma úr web_catalog í RPC-inu.
 * Að geyma þau hér væri þriðja afritið af vöruheiti í kerfinu.
 */
function readSuggestedRelations_(ss) {
  const sh = ss.getSheetByName(REL_SHEET_SUGG_);
  const skipped = { empty: 0, self: 0 };
  if (!sh || sh.getLastRow() < 2) return { rows: [], skipped: skipped };

  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  const rows = [];

  vals.forEach(function (v) {
    const sku = normStorkaupSku_(v[0]);
    const rel = normStorkaupSku_(v[3]);
    if (!sku || !rel) {
      if (String(v[0] || '').trim() || String(v[3] || '').trim()) skipped.empty++;
      return;
    }
    if (rel === sku) { skipped.self++; return; }

    const score = Number(v[6]);
    rows.push({
      sku: sku, related_sku: rel, kind: 'suggested',
      score: isFinite(score) ? score : null,
      reason: String(v[7] === null || v[7] === undefined ? '' : v[7]).trim() || null,
      fetched_at: null
    });
  });

  Logger.log('[REL][INFO] ' + REL_SHEET_SUGG_ + ': ' + rows.length + ' tillogur.');
  return { rows: rows, skipped: skipped };
}


/** Hve mörg SKU í álaginu eru ekki í birta vörulistanum. Upplýsandi, ekki villa. */
function countNotOnWeb_(payload) {
  let idx;
  try {
    idx = loadWebCatalogIndex_();
  } catch (err) {
    Logger.log('[REL][VARUD] Gat ekki lesid vefvorulistann til samanburdar: ' + err);
    return null;
  }
  const seen = {};
  let missing = 0;
  payload.forEach(function (r) {
    if (seen[r.sku]) return;
    seen[r.sku] = true;
    if (!idx.bySku[normLookupKey_(r.sku)]) missing++;
  });
  return missing;
}


/** Eyðir öllu sem keyrslan snerti ekki. Kallað eingöngu úr syncProductRelationsToSupabase_v1. */
function deleteStaleRelations_(conf, startedIso) {
  const url = conf.baseUrl + '/' + REL_TABLE_ +
              '?synced_at=lt.' + encodeURIComponent(startedIso);
  const res = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'raw',
      'Accept-Profile': 'raw',
      Prefer: 'return=representation,count=exact'
    },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('product_relations delete failed: ' + code +
                    ' ' + res.getContentText().slice(0, 300));
  }
  let n = 0;
  try { n = (JSON.parse(res.getContentText() || '[]') || []).length; } catch (_) { n = 0; }
  Logger.log('[REL][INFO] Eyddi ' + n + ' urellum tengslum.');
  return n;
}

// Utgafumerki: 2026-09-21, fyrsta utgafa.

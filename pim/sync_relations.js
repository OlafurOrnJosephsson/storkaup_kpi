/************************************************************
 * 🔗 SAMSTILLING TENGSLA — flipar → raw.product_relations
 *
 * Les tvo flipa í PIM-skjalinu og skrifar þá í eina Supabase-töflu svo
 * vöruportalinn komist í þá:
 *   TENGSL_HRA       tengslin sem ERU á storkaup.is   → kind='live'
 *   TENGSL_TILLOGUR  tillögur úr körfugreiningu       → kind='suggested'
 *
 * Krefst core/sql/product_relations_v1.sql í Supabase fyrst.
 * Keyrt í höndunum: syncProductRelationsToSupabase_v1().
 *
 * ── ÞRÍR RITHÆTTIR, HVER NORMALÍSERAÐUR FYRIR SIG ───────────────────
 * Mælt á raunverulegum flipum 2026-09-21:
 *   TENGSL_HRA      A  STO_9003174_KASSI
 *                   B  STO_A,STO_B,STO_C      KOMMUAÐSKILINN LISTI
 *                   C  Sótt (dagsetning)
 *   TENGSL_TILLOGUR A  9004596                 ber tala
 *                   D  104924 EÐA 9001525_KASSI  BLANDAÐ
 *
 * Allt fer gegnum normStorkaupSku_, sem skilar BC-forminu stafréttu með
 * forleiðandi núllum. Það er TENGILYKILL. Að nota fyrirspurnarlykil hér
 * — þann sem gerir parseInt — er villan sem kostaði 2.036 BC-línur fyrr
 * í dag. Hún er skjalfest í core/web_catalog.js og á jafnt við hér.
 *
 * ── SJÁLFSSKOÐUN Í STAÐ TRAUSTS ─────────────────────────────────────
 * Fallið telur og skilar: raðir sem normalíseruðust í tómt, tengsl á
 * sjálfa sig, og hve mörg SKU eru ekki í vefvörulistanum. Ekkert af því
 * stöðvar keyrsluna — flipinn nær yfir archived vörur og á að gera það —
 * en tölur sem hlaupa til milli keyrslna eru merki um að eitthvað hafi
 * breyst í flipunum.
 *
 * ── EYÐING ER VARIN, EINS OG Í WEB_CATALOG ──────────────────────────
 * Raðir sem keyrslan snerti ekki eru fjarlægðar, svo tengsl sem hafa
 * verið slitin á storkaup.is hverfi líka hér. En EKKI nema báðir flipar
 * hafi skilað einhverju: tómur flipi þýðir nær alltaf að einhver var að
 * endurbyggja hann, ekki að öll tengsl hafi verið slitin.
 ************************************************************/

const REL_TABLE_      = 'product_relations';
const REL_SHEET_LIVE_ = 'TENGSL_HRA';
const REL_SHEET_SUGG_ = 'TENGSL_TILLOGUR';


function syncProductRelationsToSupabase_v1() {
  const startedIso = new Date().toISOString();
  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PIM.ID);

  const live = readLiveRelations_(ss);
  const sugg = readSuggestedRelations_(ss);

  if (!live.rows.length && !sugg.rows.length) {
    throw new Error('Badir tengslaflipar tomir — engu breytt. ' +
                    'Keyrdu pimRelatedFetch_v1 / pimRelatedSuggest_v1 fyrst.');
  }

  // Afritahreinsun a frumlyklinum (sku, related_sku, kind). Upsert med
  // tveimur eins lyklum i SAMA bunka fellur i Postgres med
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" —
  // villa sem segir ekkert um raunverulegu orsokina.
  const seen = {};
  const payload = [];
  live.rows.concat(sugg.rows).forEach(function (r) {
    const k = r.kind + '|' + r.sku + '|' + r.related_sku;
    if (seen[k]) return;
    seen[k] = true;
    r.synced_at = startedIso;
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
    Logger.log('[REL][VARUD] Slepp eydingu: ' + (live.rows.length ? '' : 'TENGSL_HRA tomur. ') +
               (sugg.rows.length ? '' : 'TENGSL_TILLOGUR tomur. ') +
               'Urelt tengsl eru odyrari villa en tom tafla.');
  }

  const out = {
    live: live.rows.length,
    suggested: sugg.rows.length,
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
 * TENGSL_HRA: SKU | Tengd SKU (kommuaðskilið) | Sótt
 * Ein röð í flipanum verður N raðir í töflunni, ein á hvert tengsl.
 */
function readLiveRelations_(ss) {
  const sh = ss.getSheetByName(REL_SHEET_LIVE_);
  const skipped = { empty: 0, self: 0 };
  if (!sh || sh.getLastRow() < 2) return { rows: [], skipped: skipped };

  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const rows = [];

  vals.forEach(function (v) {
    const sku = normStorkaupSku_(v[0]);
    if (!sku) { if (String(v[0] || '').trim()) skipped.empty++; return; }

    const raw = String(v[1] === null || v[1] === undefined ? '' : v[1]).trim();
    if (!raw) return;                       // vara an tengsla — eðlilegt

    const fetched = relDateOnly_(v[2]);
    raw.split(',').forEach(function (part) {
      const rel = normStorkaupSku_(part);
      if (!rel) { if (part.trim()) skipped.empty++; return; }
      if (rel === sku) { skipped.self++; return; }
      rows.push({
        sku: sku, related_sku: rel, kind: 'live',
        score: null, reason: null, fetched_at: fetched
      });
    });
  });

  Logger.log('[REL][INFO] ' + REL_SHEET_LIVE_ + ': ' + rows.length + ' tengsl.');
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


/** Dagsetning án tíma, eða null. Sheets skilar Date fyrir dagsetningarreiti. */
function relDateOnly_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  return s ? s : null;
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

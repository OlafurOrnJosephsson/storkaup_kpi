/************************************************************
 * 🗂️ WEB_CATALOG — birti vörulistinn á storkaup.is sem gagnatafla
 *
 * Ein uppspretta fyrir þrennt sem áður hefði verið þrjú afrit:
 *   fetchWebCatalogRows_()        hrá lína á vöru, beint úr GraphQL
 *   buildWebCatalogIndex_()       uppflettivísir í minni (pim/lookup_sku.js)
 *   syncWebCatalogToSupabase_v1() raw.web_catalog fyrir Webflow-leitina
 *
 * ── AF HVERJU TAFLA Í SUPABASE YFIRHÖFUÐ ────────────────────────────
 * Vafrinn kemst ekki í storkaup.is/api/graphql. Mælt 2026-09-18:
 * POST með `Origin: https://storkaup.webflow.io` skilar 200 — en það er
 * ENGINN `Access-Control-Allow-Origin` haus í svarinu, og preflight-ið
 * fær 400 frá CSRF-vörn Apollo. Það virkar úr GAS eingöngu af því að
 * þar er enginn vafri að framfylgja neinu. Leitarreitur á /kpi/ þarf því
 * millilið, og GAS doPost er hann ekki: vísirinn er 509 KB (kemst ekki í
 * 100 KB CacheService-lykil) og tekur ~30 sek að byggja. Supabase svarar
 * í millisekúndum og er þegar leiðin sem síðurnar lesa um.
 *
 * ── LYKILLINN: `sku` ER EKKI `web_sku` ──────────────────────────────
 * GraphQL skilar `STO_117268_STK`. BC skrifar `117268_STK`. Cludo og
 * PRODUCTS skrifa `117268`. Taflan geymir hvort tveggja:
 *   web_sku  óbreytt úr GraphQL, frumlykill (einkvæmt, 4.473 gildi)
 *   sku      normalíserað í berja töluna — TENGILYKILLINN við BC
 * 3.608 af 4.473 SKU bera sölueiningarviðskeyti, svo án þessa tengist
 * ekkert. `sku` er VÍSVITANDI ekki einkvæmt: STO_9004599_STK og
 * STO_9004599_KASSI eru sama Brúsapumpan í tveimur sölueiningum, báðar
 * í birtingu, og báðar eiga að vera í töflunni.
 *
 * ── EYÐING ER VARIN ─────────────────────────────────────────────────
 * Vara sem hverfur af vefnum þarf að hverfa úr töflunni, annars svarar
 * uppflettingin „já, á vefnum" um vöru sem er farin. Það er gert með því
 * að eyða öllu sem ekki var snert í keyrslunni. Sú aðgerð er hættuleg í
 * réttu hlutfalli við gagnsemi sína: brotni pagineringin í miðju kafi
 * eyðir hún vörulistanum. Þess vegna keyrir hún EKKI nema sóttar raðir
 * séu ≥95% af `totalCount` sem vefurinn sjálfur gaf upp. Undir því marki
 * er upsertið látið standa og eyðingunni sleppt með viðvörun — úrelt lína
 * er miklu ódýrari villa en tóm tafla.
 ************************************************************/

const WEB_CATALOG_TABLE_ = 'web_catalog';
const WEB_CATALOG_PAGE_  = 200;


/************************************************************
 * 🌐 fetchWebCatalogRows_ — allur birti vörulistinn
 * Skilar { rows, totalCount, complete }.
 *   rows       [{ webSku, sku, brandSku, name, brand, slug }]
 *   totalCount talan sem vefurinn gaf upp, til að meta heilleika
 *   complete   satt ef pagineringin kláraðist eðlilega
 * getProductsV2 er OPINBERT — enginn Bearer (sbr. storkaup_pricing.js).
 ************************************************************/
function fetchWebCatalogRows_() {
  const query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug' +
    '      attributes { brand_sku BrandName } } }' +
    '  }' +
    '}';

  const rows = [];
  let offset = 0;
  let total = 0;
  let complete = false;

  while (true) {
    const res = UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        query: query,
        variables: { pagination: { first: WEB_CATALOG_PAGE_, offset: offset } },
        operationName: 'getProductsV2'
      })
    });

    if (res.getResponseCode() !== 200) {
      throw new Error('getProductsV2 ' + res.getResponseCode() + ': ' +
                      res.getContentText().slice(0, 300));
    }
    const data = JSON.parse(res.getContentText());
    if (data.errors) {
      throw new Error('getProductsV2 errors: ' + JSON.stringify(data.errors).slice(0, 300));
    }

    const conn = (data.data && data.data.getProductsV2) || {};
    total = Number(conn.totalCount || 0);

    (conn.edges || []).forEach(function (e) {
      const node = (e && e.node) || null;
      if (!node || !node.sku) return;
      const attrs = node.attributes || {};
      rows.push({
        webSku:   String(node.sku),
        sku:      normStorkaupSku_(node.sku),
        brandSku: normBrandSku_(attrs.brand_sku),
        name:     node.name || '',
        brand:    attrs.BrandName || '',
        slug:     node.slug || ''
      });
    });

    offset += WEB_CATALOG_PAGE_;
    if (!(conn.pageInfo && conn.pageInfo.hasNextPage)) { complete = true; break; }
    if (offset > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
  }

  Logger.log('[WEBCAT][INFO] Sotti ' + rows.length + ' vorur af ' + total + '.');
  return { rows: rows, totalCount: total, complete: complete };
}


/************************************************************
 * 🔑 buildWebCatalogIndex_ — uppflettivísir í minni
 *   bySku    normalíserað Stórkaups-SKU  (STO_117268_STK → 117268)
 *   byBrand  normalíserað birgjanúmer
 *   byLoose  aðeins bókstafir og tölustafir — ÞRAUTALENDING
 * Hvert gildi er FYLKI. Hvorki birgjanúmer né `sku` er einkvæmt.
 ************************************************************/
function buildWebCatalogIndex_() {
  const out = fetchWebCatalogRows_();
  const bySku = {}, byBrand = {}, byLoose = {};
  let withBrand = 0;

  const add = function (map, key, rec) {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(rec);
  };

  out.rows.forEach(function (r) {
    const rec = {
      sku: r.webSku, name: r.name, slug: r.slug,
      brand: r.brand, brandSku: r.brandSku
    };
    add(bySku, r.sku, rec);
    add(byLoose, looseKey_(r.webSku), rec);
    if (r.brandSku) {
      withBrand++;
      add(byBrand, normLookupKey_(r.brandSku), rec);
      add(byLoose, looseKey_(r.brandSku), rec);
    }
  });

  Logger.log('[WEBCAT][INFO] Visir: ' + out.rows.length + ' vorur, ' +
             withBrand + ' med birgjanumer.');
  return { bySku: bySku, byBrand: byBrand, byLoose: byLoose };
}


/************************************************************
 * ⬆️ syncWebCatalogToSupabase_v1 — raw.web_catalog
 * Keyrt úr scheduledCludoSync_v1 (12h) og má keyra í höndunum.
 * Krefst core/sql/web_catalog_v1.sql í Supabase fyrst.
 ************************************************************/
function syncWebCatalogToSupabase_v1() {
  const startedIso = new Date().toISOString();
  const fetched = fetchWebCatalogRows_();
  const rows = fetched.rows;

  if (!rows.length) {
    throw new Error('web_catalog: vefurinn skilaði engum vörum — engu breytt.');
  }

  const conf = getSupabaseRestConfig_();
  const endpoint = conf.baseUrl + '/' + WEB_CATALOG_TABLE_ + '?on_conflict=web_sku';

  const payload = rows.map(function (r) {
    return {
      web_sku:      r.webSku,
      sku:          r.sku,
      brand_sku:    r.brandSku || null,
      product_name: r.name || null,
      brand_name:   r.brand || null,
      slug:         r.slug || null,
      synced_at:    startedIso
    };
  });

  const CHUNK = 200;
  let uploaded = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    if (i > 0) Utilities.sleep(300);

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
      Logger.log('[WEBCAT][WARN] Upsert bunki ' + (Math.floor(i / CHUNK) + 1) +
                 ' tilraun ' + attempt + '/3: ' + code + ' ' + body.slice(0, 200));
      Utilities.sleep(3000 * attempt);
    }
    if (code < 200 || code >= 300) {
      throw new Error('web_catalog upsert failed: ' + code + ' ' + body.slice(0, 300));
    }
    uploaded += chunk.length;
  }

  // Eyðing á því sem hvarf af vefnum — sjá hausinn. Þröskuldurinn er
  // varnagli gegn hálfsóttum lista, ekki snyrtimennska.
  let deleted = null;
  const coverage = fetched.totalCount > 0 ? (rows.length / fetched.totalCount) : 0;
  if (fetched.complete && coverage >= 0.95) {
    deleted = deleteStaleWebCatalogRows_(conf, startedIso);
  } else {
    Logger.log('[WEBCAT][VARUD] Slepp eydingu: sotti ' + rows.length + ' af ' +
               fetched.totalCount + ' (' + Math.round(coverage * 100) + '%), complete=' +
               fetched.complete + '. Urelt lina er odyrari villa en tom tafla.');
  }

  const out = {
    totalCount: fetched.totalCount,
    uploaded: uploaded,
    deleted: deleted,
    withBrandSku: rows.filter(function (r) { return !!r.brandSku; }).length,
    complete: fetched.complete
  };
  Logger.log('[WEBCAT][INFO] Sync lokid: ' + JSON.stringify(out));
  return out;
}


/** Eyðir öllu sem keyrslan snerti ekki. Kallað eingöngu úr syncWebCatalogToSupabase_v1. */
function deleteStaleWebCatalogRows_(conf, startedIso) {
  const url = conf.baseUrl + '/' + WEB_CATALOG_TABLE_ +
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
    throw new Error('web_catalog delete failed: ' + code + ' ' + res.getContentText().slice(0, 300));
  }
  let n = 0;
  try { n = (JSON.parse(res.getContentText() || '[]') || []).length; } catch (_) { n = 0; }
  Logger.log('[WEBCAT][INFO] Eyddi ' + n + ' urellum linum.');
  return n;
}


// ---------------------------------------------------------------------------
// Normalíserun — sameiginleg öllum sem lesa vefvörulistann
// ---------------------------------------------------------------------------

/**
 * brand_sku er `[String]` eða `null` í GraphQL-svarinu — ALDREI strengur.
 * Mælt á öllum 4.473 vörum 2026-09-18: 4.408 fylki af lengd 1, 65 null.
 * `String()` beint á reitinn gefur rétta útkomu fyrir slysni á eins staks
 * fylki en þegjandi ranga á lengra. Fyrsta gildið er tekið vísvitandi.
 */
function normBrandSku_(v) {
  if (v === null || v === undefined) return '';
  const first = Array.isArray(v) ? (v.length ? v[0] : '') : v;
  return String(first === null || first === undefined ? '' : first).trim();
}

/**
 * Almennur samanburðarlykill: hástafir, bil felld saman, forleiðandi núll
 * af hreinum tölum. "007276" og "7276" eru sama númerið.
 */
function normLookupKey_(v) {
  const s = String(v === null || v === undefined ? '' : v)
    .trim().replace(/\s+/g, ' ').toUpperCase();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

/**
 * Stórkaups-SKU á fjóra rithætti í kerfunum:
 *   STO_114112      STO_117268_STK      STO_9002572_KASSI      114112
 * Sölueiningarviðskeytið er ekki hluti af auðkenninu — sama vara, önnur
 * pökkun — svo það er skorið af.
 *
 * ATH: þetta er VÍSVITANDI ekki normSku_ úr pim/buildPimWorksheet.js. Það
 * fall sker ekki viðskeytið, af því að þar er matchað á Plytix/Cludo þar
 * sem það er ekki til. Hér er matchað á GraphQL og BC, þar sem 3.608 af
 * 4.473 SKU bera það. Að sameina föllin myndi brjóta annað hvort.
 */
function normStorkaupSku_(v) {
  let s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (!s) return '';
  s = s.replace(/^STO[_\-\s]+/, '');
  s = s.replace(/[_\-](STK|KASSI|BRETTI|PK|PAKKI)$/, '');
  return normLookupKey_(s);
}

/** Aðeins bókstafir og tölustafir. Notað eingöngu í lausa treffið. */
function looseKey_(v) {
  return normLookupKey_(v).replace(/[^A-Z0-9ÁÉÍÓÚÝÐÞÆÖ]/g, '');
}

// Utgafumerki: 2026-09-18, fyrsta utgafa.

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
 *   sku      BC-formið — TENGILYKILLINN, STAFRÉTT eins og BC skrifar
 *            hann. Forleiðandi núll haldast: STO_01015_STK → `01015`,
 *            EKKI `1015`. Sjá normStorkaupSku_ um hvað það kostaði.
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
 *   rows       [{ webSku, sku, brandSku, name, brand, slug, related[],
 *                descLen, descIsName }]
 *   totalCount talan sem vefurinn gaf upp, til að meta heilleika
 *   complete   satt ef pagineringin kláraðist eðlilega
 * getProductsV2 er OPINBERT — enginn Bearer (sbr. storkaup_pricing.js).
 ************************************************************/
function fetchWebCatalogRows_() {
  const query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug relatedProductSkus longDescription' +
    '      featuredImage { url }' +
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
      // relatedProductSkus kemur a STO_-formi, en EKKI endilega i sama
      // rithaetti og varan sjalf: STO_9003663_STK getur visad a
      // STO_136437 thott sú vara heiti STO_136437_STK i listanum. Bædi
      // normaliserast i BC-formid, svo tengingin heldur — en ad bera
      // gildin saman OBREYTT myndi missa af theim.
      const related = [];
      (node.relatedProductSkus || []).forEach(function (rs) {
        const n = normStorkaupSku_(rs);
        if (n) related.push(n);
      });

      // ── INNIHALDSMERKI, EKKI INNIHALDIÐ SJÁLFT ──────────────────
      // Lýsingarnar eru 828 KB samtals og eru þegar til á tveimur
      // stöðum: í Plytix og á vefnum. Þriðja afritið í Supabase væri
      // texti sem fúnar og enginn les — portalinn tengir á vöruna til
      // að lesa hana. Geymd eru MERKIN: lengd og hvort „lýsingin" sé
      // orðrétt vöruheitið.
      //
      // Mælt 2026-09-21 á öllum 4.474: 4 án lýsingar, 470 þar sem
      // lýsingin ER vöruheitið, miðgildi 114 stafir. Þau 470 eru tómur
      // reitur í dulargervi og eru raunverulega merkið sem vantaði.
      //
      // Mynd er EKKI geymd sem merki: 1 vara af 4.474 er án myndar.
      // Panel sem flaggar einu tilviki af 4.474 kennir fólki að hunsa
      // hann.
      const descRaw = String(node.longDescription === null ||
                             node.longDescription === undefined ? '' : node.longDescription).trim();
      const nameRaw = String(node.name || '').trim();

      rows.push({
        webSku:   String(node.sku),
        descLen:  descRaw.length,
        descIsName: descRaw !== '' && descRaw === nameRaw,
        sku:      normStorkaupSku_(node.sku),
        brandSku: normBrandSku_(attrs.brand_sku),
        name:     node.name || '',
        brand:    attrs.BrandName || '',
        slug:     node.slug || '',
        related:  related
      });
    });

    offset += WEB_CATALOG_PAGE_;
    if (!(conn.pageInfo && conn.pageInfo.hasNextPage)) { complete = true; break; }
    if (offset > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
  }

  // ── SJÁLFSPRÓFUN Á TENGILYKLINUM ──────────────────────────────────
  // Óháð normStorkaupSku_ VILJANDI: að keyra sama fallið aftur sannar
  // ekkert. Hér er fullyrðingin sú að `web_sku` verði að vera
  // 'STO_' + sku, með eða án sölueiningarviðskeytis. Sú fullyrðing er
  // strengjasamanburður, ekki umritun, svo hún fellur um leið og
  // normalíserunin fer að breyta gildinu — sem er nákvæmlega það sem
  // gerðist með forleiðandi núllin (14 vörur, 2.036 BC-línur sem hittu
  // ekki, þögult, mælt 2026-09-21).
  const drift = rows.filter(function (r) {
    const expect = 'STO_' + r.sku;
    return r.webSku !== expect && r.webSku.indexOf(expect + '_') !== 0;
  });
  if (drift.length) {
    Logger.log('[WEBCAT][VILLA] ' + drift.length + ' SKU thar sem tengilykillinn ' +
               'er ekki BC-form af web_sku — join vid bc_lines_raw mun hitta a tomt. ' +
               'Daemi: ' + drift.slice(0, 5).map(function (r) {
                 return r.webSku + ' -> ' + r.sku;
               }).join(', '));
  }

  Logger.log('[WEBCAT][INFO] Sotti ' + rows.length + ' vorur af ' + total +
             (drift.length ? ' (' + drift.length + ' MED LYKILREKI)' : '') + '.');
  return { rows: rows, totalCount: total, complete: complete, drift: drift.length };
}


/************************************************************
 * 🔑 indexWebCatalogRows_ — byggir uppflettivísi úr röðum
 *   bySku    normalíserað Stórkaups-SKU  (STO_117268_STK → 117268)
 *   byBrand  normalíserað birgjanúmer
 *   byLoose  aðeins bókstafir og tölustafir — ÞRAUTALENDING
 * Hvert gildi er FYLKI. Hvorki birgjanúmer né `sku` er einkvæmt.
 *
 * Tekur við röðum hvaðan sem þær koma — GraphQL eða raw.web_catalog —
 * svo lyklareglan sé ein og söm hvor leiðin sem er farin. Væri hún
 * afrituð gæti Supabase-leiðin lyklað öðruvísi en GraphQL-leiðin og
 * uppflettingin svarað ólíkt eftir því hvor var í gangi.
 ************************************************************/
function indexWebCatalogRows_(rows) {
  const bySku = {}, byBrand = {}, byLoose = {};
  let withBrand = 0;

  const add = function (map, key, rec) {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(rec);
  };

  (rows || []).forEach(function (r) {
    const rec = {
      sku: r.webSku, name: r.name, slug: r.slug,
      brand: r.brand, brandSku: r.brandSku
    };
    // bySku er FYRIRSPURNARhlid: lykillinn er normaliseradur svo bædi
    // "1015" og "01015" hitti. Gildid `rec.sku` heldur afram ad bera
    // hraa web_sku-id, og `r.sku` i toflunni ber BC-formid.
    add(bySku, normLookupKey_(r.sku), rec);
    add(byLoose, looseKey_(r.webSku), rec);
    if (r.brandSku) {
      withBrand++;
      add(byBrand, normLookupKey_(r.brandSku), rec);
      add(byLoose, looseKey_(r.brandSku), rec);
    }
  });

  return { bySku: bySku, byBrand: byBrand, byLoose: byLoose,
           count: (rows || []).length, withBrand: withBrand };
}


/************************************************************
 * 🔑 buildWebCatalogIndex_ — vísir beint úr GraphQL (LIFANDI)
 * ~30 sek, 23 beiðnir. Notað þegar svarið verður að vera af vefnum
 * sjálfum þessa stundina. Fyrir venjulega uppflettingu er
 * loadWebCatalogIndex_ réttari — sjá þar.
 ************************************************************/
function buildWebCatalogIndex_() {
  const out = fetchWebCatalogRows_();
  const idx = indexWebCatalogRows_(out.rows);
  idx.source = 'graphql';
  idx.syncedAt = null;
  Logger.log('[WEBCAT][INFO] Visir ur GraphQL: ' + idx.count + ' vorur, ' +
             idx.withBrand + ' med birgjanumer.');
  return idx;
}


/************************************************************
 * ⚡ loadWebCatalogIndex_ — vísir úr raw.web_catalog, GraphQL til vara
 *
 * Sömu gögn og buildWebCatalogIndex_ en úr töflunni: fimm REST-beiðnir
 * í stað 23 GraphQL-beiðna, og svarið kemur á sekúndubroti í stað ~30
 * sekúndna. Taflan er endurnýjuð á 12 tíma fresti í scheduledCludoSync_v1.
 *
 * ── FERSKLEIKINN ER MÁLAMIÐLUN, OG HÚN Á AÐ SJÁST ───────────────────
 * Upphaflega sótti uppflettingin beint úr GraphQL með þeim rökum að
 * spurningin væri „er þetta á vefnum NÚNA". Þau rök stóðust á meðan
 * taflan var ekki til. Nú er hún til, og hálf mínúta á hverja uppflettingu
 * er of hátt verð fyrir 12 tíma nákvæmni. Þess vegna skilar fallið
 * `syncedAt` með — kallandinn á að BIRTA hann, ekki fela hann.
 *
 * ── TÓM TAFLA MÁ ALDREI LESAST SEM „EKKI TIL" ───────────────────────
 * Þetta er hættan sem fylgir því að lesa afrit. Hafi samstillingin aldrei
 * keyrt, fallið á miðri leið eða taflan verið tæmd, þá skilar hún engum
 * röðum — og uppfletting á tómum vísi svarar „fannst ekki" um hverja
 * einustu vöru. Það er þögult rangt svar af verstu gerð: það lítur
 * nákvæmlega eins út og rétt svar.
 *
 * Þess vegna er fallbakkinn ekki þægindi heldur varnagli. Skili taflan
 * engu, eða falli REST-kallið, er farið í GraphQL og það SAGT í
 * keyrsluskránni og í `source`.
 ************************************************************/
function loadWebCatalogIndex_() {
  let rows = [];
  let syncedAt = null;

  try {
    const PAGE = 1000;   // PostgREST skilar mest 1000 röðum í senn
    let offset = 0;
    while (true) {
      const path = WEB_CATALOG_TABLE_ +
        '?select=web_sku,sku,brand_sku,product_name,brand_name,slug,synced_at' +
        '&order=web_sku&limit=' + PAGE + '&offset=' + offset;
      const batch = supabaseRestGetJson_(path, 'raw') || [];
      batch.forEach(function (r) {
        rows.push({
          webSku:   r.web_sku,
          sku:      r.sku,
          brandSku: r.brand_sku || '',
          name:     r.product_name || '',
          brand:    r.brand_name || '',
          slug:     r.slug || ''
        });
        if (r.synced_at && (!syncedAt || r.synced_at > syncedAt)) syncedAt = r.synced_at;
      });
      if (batch.length < PAGE) break;
      offset += PAGE;
      if (offset > 50000) throw new Error('web_catalog pagination guard (>50000).');
    }
  } catch (err) {
    Logger.log('[WEBCAT][VARUD] Les ekki raw.web_catalog (' + err +
               ') — fer i GraphQL. Uppfletting ma ALDREI keyra a tomum visi.');
    return buildWebCatalogIndex_();
  }

  if (!rows.length) {
    Logger.log('[WEBCAT][VARUD] raw.web_catalog er TOM — fer i GraphQL. ' +
               'Keyrdu syncWebCatalogToSupabase_v1; tom tafla svarar annars ' +
               '"fannst ekki" um hverja voru.');
    return buildWebCatalogIndex_();
  }

  const idx = indexWebCatalogRows_(rows);
  idx.source = 'supabase';
  idx.syncedAt = syncedAt;
  Logger.log('[WEBCAT][INFO] Visir ur raw.web_catalog: ' + idx.count + ' vorur, ' +
             idx.withBrand + ' med birgjanumer, samstillt ' + syncedAt + '.');
  return idx;
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
      description_length:  r.descLen,
      description_is_name: !!r.descIsName,
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
 * FYRIRSPURNARLYKILL — það sem notandinn sló inn, borið við auðkenni.
 * Hástafir, bil felld saman, forleiðandi núll af hreinum tölum.
 * "007276" og "7276" eru sama númerið FYRIR ÞANN SEM LEITAR.
 *
 * Þessi regla á EKKI við um tengilykla — sjá normStorkaupSku_.
 */
function normLookupKey_(v) {
  const s = String(v === null || v === undefined ? '' : v)
    .trim().replace(/\s+/g, ' ').toUpperCase();
  if (!s) return '';
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

/**
 * TENGILYKILL — auðkennið eins og BC skrifar það.
 *   STO_114112 → 114112      STO_117268_STK → 117268
 *   STO_01015_STK → 01015    (FORLEIÐANDI NÚLLIN HALDAST)
 * Sölueiningarviðskeytið er ekki hluti af auðkenninu — sama vara, önnur
 * pökkun — svo það er skorið af.
 *
 * ── FORLEIÐANDI NÚLL ERU EKKI SKREYTING ─────────────────────────────
 * Fyrsta útgáfa endaði á normLookupKey_, sem gerir parseInt á hreinum
 * tölum og skilaði því `1015` fyrir `STO_01015_STK`. BC heldur núllinu,
 * svo `web_catalog.sku` og `bc_lines_raw.sku` hættu að hittast.
 *
 * Mælt 2026-09-21: 14 vörur bera forleiðandi núll, og join-ið hitti
 * ENGA línu fyrir neina þeirra — á meðan hráa formið hitti 2.036 línur.
 * Þar á meðal `STO_02672` (550 línur) og `STO_01015_STK` (555), sem eru
 * hvorugar jaðartilvik. Einkennið var ekki villa heldur `0 pantanir /
 * 0 kr`, sem les eins og „hefur ekki selst".
 *
 * Villan var að steypa saman tveimur ólíkum störfum. Fyrirspurnarlykill
 * MÁ fyrirgefa forleiðandi núll — sá sem slær inn 1015 og sá sem slær
 * inn 01015 á við sama hlutinn. Tengilykill má það ALDREI: hann verður
 * að vera stafrétt eins og hinum megin við join-ið. normLookupKey_ er
 * hitt starfið og er ekki kallað hér lengur.
 *
 * ATH: þetta er líka vísvitandi ekki normSku_ úr buildPimWorksheet.js.
 * Það fall sker ekki viðskeytið, því þar er matchað á Plytix/Cludo þar
 * sem það er ekki til. Þrjú lík föll, þrjú ólík störf.
 */
function normStorkaupSku_(v) {
  let s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (!s) return '';
  s = s.replace(/^STO[_\-\s]+/, '');
  s = s.replace(/[_\-](STK|KASSI|BRETTI|PK|PAKKI)$/, '');
  return s.replace(/\s+/g, ' ');
}

/** Aðeins bókstafir og tölustafir. Notað eingöngu í lausa treffið. */
function looseKey_(v) {
  return normLookupKey_(v).replace(/[^A-Z0-9ÁÉÍÓÚÝÐÞÆÖ]/g, '');
}

// Utgafumerki: 2026-09-18, fyrsta utgafa.

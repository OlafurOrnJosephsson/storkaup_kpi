/************************************************************
 * 🏷️ STÓRKAUP PRICING — verðheilsa virkra vara
 * ----------------------------------------------------------
 * Finnur vörur sem ERU Í BIRTINGU á storkaup.is en eru annaðhvort
 * með listaverð 0 eða ekkert verð ("Vara ekki fáanleg").
 *
 * Tvær uppsprettur (báðar GraphQL á https://www.storkaup.is/api/graphql):
 *
 *   getProductsV2     → virki vörulistinn sem vefurinn birtir.
 *                       OPINBER — enginn token. Réttur alheimur
 *                       (archived/draft eru EKKI með). SKU á formi
 *                       STO_<sku> → strippað í parent-SKU.
 *
 *   getProductsPricing → verð per vöru. KREFST Bearer accessToken.
 *
 * AUTH (sjálfvirkt):
 *   Geymt session-cookie (STORKAUP_SESSION_COOKIE, lifir ~30 daga) →
 *   GAS sækir ferskan accessToken úr /api/auth/session sjálfkrafa
 *   (cache ~50 mín, endurnýjar við 401). Sjá getStorkaupAccessToken_.
 *   Fallback: handvirkur STORKAUP_GQL_BEARER.
 *   Cookie endurnýjað á nokkurra vikna fresti (eða þegar 401 kemur).
 *
 * Flokkun virkra vara:
 *   basePrice > 0          → í lagi (líka "Væntanlegt" — þær hafa verð)
 *   basePrice === 0 / null → "LISTAVERÐ 0"
 *   engin verðlína         → "VARA EKKI FÁANLEG" (hangir inni án verðs)
 ************************************************************/

var STORKAUP_GQL_URL_ = 'https://www.storkaup.is/api/graphql';

/************************************************************
 * 🔑 getStorkaupAccessToken_ — sjálfvirkur Bearer
 *   Sækir ferskan accessToken úr /api/auth/session með
 *   geymdu session-cookie (STORKAUP_SESSION_COOKIE). Cookie
 *   lifir ~30 daga; accessToken er cache-að í ~50 mín.
 *   Fallback: handvirkur STORKAUP_GQL_BEARER ef cookie vantar.
 ************************************************************/
function getStorkaupAccessToken_(forceRefresh) {
  const props = PropertiesService.getScriptProperties();
  const CK = 'STORKAUP_ACCESS_TOKEN', TS = 'STORKAUP_ACCESS_TOKEN_TS';
  const TTL = 50 * 60 * 1000;

  if (!forceRefresh) {
    const cached = props.getProperty(CK);
    const ts = Number(props.getProperty(TS) || 0);
    if (cached && (Date.now() - ts) < TTL) return cached;
  }

  const cookie = props.getProperty('STORKAUP_SESSION_COOKIE');
  if (cookie) {
    const res = UrlFetchApp.fetch('https://www.storkaup.is/api/auth/session', {
      method: 'get',
      headers: { Accept: '*/*', Cookie: cookie },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText() || '{}');
      const tok = data && data.user && data.user.accessToken;
      if (tok) {
        props.setProperty(CK, tok);
        props.setProperty(TS, String(Date.now()));
        return tok;
      }
    }
    throw new Error(
      'Storkaup session cookie útrunnið/ógilt. Sæktu nýtt: innskráð(ur) → ' +
      'Network → /api/auth/session → Copy as cURL → afritaðu Cookie-hausinn í ' +
      'Script Property STORKAUP_SESSION_COOKIE.'
    );
  }

  // Fallback: handvirkur Bearer
  const raw = props.getProperty('STORKAUP_GQL_BEARER');
  if (raw) return String(raw).replace(/^Bearer\s+/i, '').trim();

  throw new Error(
    'Vantar STORKAUP_SESSION_COOKIE (sjálfvirkt, mælt með) eða STORKAUP_GQL_BEARER (handvirkt).'
  );
}

function storkaupParentSku_(rawSku) {
  // STO_9002691 → 9002691 ; STO_116309_STK → 116309 ; 103406_KASSI → 103406
  return String(rawSku || '').replace(/^STO_/i, '').split('_')[0];
}

function storkaupProductUrl_(slug) {
  return slug ? ('https://www.storkaup.is/vara/' + slug) : '';
}

/************************************************************
 * 🌐 fetchActiveProducts_ — allur virki vörulistinn (OPINBER)
 *   Pagear í gegnum getProductsV2 (first/offset).
 *   Skilar fylki af { parent, name, qty, slug } — dedupað á parent.
 ************************************************************/
function fetchActiveProducts_() {
  const PAGE = 200;
  const query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name totalQuantity slug featuredImage { url fileName } attributes { isFrameworkAgreementProduct isSpecialOrderProduct } } }' +
    '  }' +
    '}';

  let offset = 0;
  let total = null;
  const seen = {};
  const out = [];

  while (true) {
    const res = UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        query: query,
        variables: { pagination: { first: PAGE, offset: offset } },
        operationName: 'getProductsV2'
      })
    });

    if (res.getResponseCode() !== 200) {
      throw new Error('getProductsV2 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    const data = JSON.parse(res.getContentText());
    if (data.errors) throw new Error('getProductsV2 errors: ' + JSON.stringify(data.errors).slice(0, 300));

    const conn = (data.data && data.data.getProductsV2) || {};
    total = conn.totalCount;
    const edges = conn.edges || [];
    if (!edges.length) break;

    edges.forEach(e => {
      const node = e && e.node;
      if (!node) return;
      const parent = storkaupParentSku_(node.sku);
      if (!parent || seen[parent]) return;
      seen[parent] = true;
      const fimg = node.featuredImage || {};
      const noImage = !fimg.url || /myndvantar/i.test((fimg.url || '') + ' ' + (fimg.fileName || ''));
      out.push({
        parent: parent,
        name: node.name || '',
        qty: node.totalQuantity,
        slug: node.slug || '',
        framework: !!(node.attributes && node.attributes.isFrameworkAgreementProduct),
        specialOrder: !!(node.attributes && node.attributes.isSpecialOrderProduct),
        noImage: noImage
      });
    });

    offset += PAGE;
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    if (offset > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
    Utilities.sleep(120);
  }

  Logger.log('🌐 getProductsV2: ' + out.length + ' einstök parent-SKU (totalCount ' + total + ')');
  return out;
}

/************************************************************
 * 🌐 fetchStorkaupPricing_ — verð fyrir lista af parent-SKU (KREFST token)
 ************************************************************/
function fetchStorkaupPricing_(skus) {
  const query =
    'query getProductsPricing($productSkus: [String!]!) {' +
    '  getProductsPricing(productSkus: $productSkus) {' +
    '    sku unitPrices { sku finalPrice priceGroupId unitOfMeasure basePrice }' +
    '  }' +
    '}';
  const payload = JSON.stringify({ query: query, variables: { productSkus: skus }, operationName: 'getProductsPricing' });

  function call_(token) {
    return UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, Accept: '*/*', Origin: 'https://www.storkaup.is' },
      muteHttpExceptions: true,
      payload: payload
    });
  }

  let res = call_(getStorkaupAccessToken_(false));
  let code = res.getResponseCode();
  if (code === 401 || code === 403) {
    // Token útrunninn → endurnýja úr session-cookie og reyna aftur
    res = call_(getStorkaupAccessToken_(true));
    code = res.getResponseCode();
  }
  if (code !== 200) throw new Error('Storkaup GraphQL ' + code + ': ' + res.getContentText().slice(0, 300));

  const data = JSON.parse(res.getContentText());
  if (data.errors) throw new Error('GraphQL errors: ' + JSON.stringify(data.errors).slice(0, 400));
  return (data.data && data.data.getProductsPricing) || [];
}

/************************************************************
 * 🔬 probeStorkaupPricing — sannreyna báðar uppsprettur
 ************************************************************/
function probeStorkaupPricing() {
  const active = fetchActiveProducts_();
  Logger.log('Fyrstu 3 virkar vörur: ' + JSON.stringify(active.slice(0, 3)));

  const r = fetchStorkaupPricing_(['9002691', '103406']);
  Logger.log('Verð-dæmi: ' + JSON.stringify(r));
}

/************************************************************
 * 🧾 findZeroListPriceProducts_v1 — aðalskönnun
 *  - Alheimur = virkar vörur úr getProductsV2 (á vef)
 *  - Verð úr getProductsPricing
 *  - Flaggar: LISTAVERÐ 0  /  VARA EKKI FÁANLEG
 *  - Skrifar í flipa ZERO_PRICE_PRODUCTS + vistar cache fyrir hnapp
 *  - Skilar { totalActive, zeroPrice, notAvailable, flagged }
 ************************************************************/
function findZeroListPriceProducts_v1() {
  const cfg = loadConfig_();

  // 1) Virki vörulistinn (réttur alheimur)
  const products = fetchActiveProducts_();
  const meta = {};
  const skus = [];
  products.forEach(p => { meta[p.parent] = p; skus.push(p.parent); });

  // 2) Verð í lotum
  const BATCH = 50;
  const rows = [];
  const frameworkRows = [];   // rammasamningsvörur án almenns verðs (til heilbrigðis-eftirlits)
  let checked = 0, zeroPrice = 0, notAvailable = 0, frameworkExcluded = 0, specialOrderExcluded = 0;

  for (let i = 0; i < skus.length; i += BATCH) {
    const batch = skus.slice(i, i + BATCH);
    const result = fetchStorkaupPricing_(batch);

    const bySku = {};
    result.forEach(p => { bySku[storkaupParentSku_(p.sku)] = p; });

    batch.forEach(sku => {
      checked++;
      const m = meta[sku] || {};
      const p = bySku[sku];
      const unitPrices = (p && p.unitPrices) || [];

      if (!unitPrices.length) {
        // Rammasamningsvörur eru verðlagðar per samning → engin almenn verðlína
        // er eðlileg, ekki vandamál. Útilokum frá hreinsunarlista.
        // Sérpöntunarvörur: verðlausar að hönnun (þegar UT setur flaggið).
        // Núna alltaf false → engin áhrif fyrr en virknin er komin inn.
        if (m.specialOrder) { specialOrderExcluded++; return; }
        if (m.framework) {
          frameworkExcluded++;
          frameworkRows.push([sku, m.name || '', m.qty, storkaupProductUrl_(m.slug)]);
          return;
        }
        notAvailable++;
        rows.push([sku, m.name || '', m.qty, '', 'VARA EKKI FÁANLEG', storkaupProductUrl_(m.slug)]);
        return;
      }

      let flaggedZero = false;
      unitPrices.forEach(u => {
        const base = u.basePrice;
        if (base === 0 || base === null || base === undefined) {
          flaggedZero = true;
          rows.push([sku, m.name || '', m.qty, (u.unitOfMeasure || u.sku || ''), 'LISTAVERÐ 0', storkaupProductUrl_(m.slug)]);
        }
      });
      if (flaggedZero) zeroPrice++;
    });

    Logger.log('  …' + Math.min(i + BATCH, skus.length) + '/' + skus.length + ' (flögg: ' + rows.length + ')');
    Utilities.sleep(250);
  }

  // 2b) Mynd-eftirlit (óháð verði) — featuredImage null eða "myndvantar*"
  const imageRows = [];
  products.forEach(p => {
    if (p.noImage) imageRows.push([p.parent, p.name || '', p.qty, storkaupProductUrl_(p.slug)]);
  });
  const missingImage = imageRows.length;

  // 3) Skrifa flipa
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);
  const sheetName = 'ZERO_PRICE_PRODUCTS';
  let sh = ss.getSheetByName(sheetName);
  if (sh) sh.clear();
  else sh = ss.insertSheet(sheetName);

  const HEADER = ['SKU', 'Product Name', 'Lager', 'Eining', 'Vandamál', 'URL'];
  sh.appendRow(HEADER);
  if (rows.length) {
    rows.sort((a, b) =>
      String(a[4]).localeCompare(String(b[4])) ||
      String(a[0]).localeCompare(String(b[0]))
    );
    sh.getRange(2, 1, rows.length, HEADER.length).setValues(rows);
  }
  sh.getRange(1, 1, sh.getLastRow(), 1).setNumberFormat('@');

  // 3b) Rammasamningar án verðs í sérflipa (heilbrigðis-eftirlit)
  let fsh = ss.getSheetByName('RAMMASAMNINGAR');
  if (fsh) fsh.clear();
  else fsh = ss.insertSheet('RAMMASAMNINGAR');
  const FHEADER = ['SKU', 'Product Name', 'Lager', 'URL'];
  fsh.appendRow(FHEADER);
  if (frameworkRows.length) {
    frameworkRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    fsh.getRange(2, 1, frameworkRows.length, FHEADER.length).setValues(frameworkRows);
  }
  fsh.getRange(1, 1, fsh.getLastRow(), 1).setNumberFormat('@');

  // 3c) Vörur sem vantar mynd í sérflipa
  let ish = ss.getSheetByName('VANTAR_MYND');
  if (ish) ish.clear();
  else ish = ss.insertSheet('VANTAR_MYND');
  const IHEADER = ['SKU', 'Product Name', 'Lager', 'URL'];
  ish.appendRow(IHEADER);
  if (imageRows.length) {
    imageRows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    ish.getRange(2, 1, imageRows.length, IHEADER.length).setValues(imageRows);
  }
  ish.getRange(1, 1, ish.getLastRow(), 1).setNumberFormat('@');

  // 4) Cache fyrir hnapp / web-app
  const sample = rows.slice(0, 25).map(r => ({ sku: r[0], name: r[1], qty: r[2], issue: r[4], url: r[5] }));
  const cache = {
    lastRun: new Date().toISOString(),
    totalActive: checked,
    zeroPrice: zeroPrice,
    notAvailable: notAvailable,
    frameworkExcluded: frameworkExcluded,
    specialOrderExcluded: specialOrderExcluded,
    missingImage: missingImage,
    imageSample: imageRows.slice(0, 25).map(r => ({ sku: r[0], name: r[1], qty: r[2], url: r[3] })),
    flagged: rows.length,
    sample: sample
  };
  PropertiesService.getScriptProperties().setProperty('ZERO_PRICE_LAST_RESULT', JSON.stringify(cache));

  const summary = { totalActive: checked, zeroPrice: zeroPrice, notAvailable: notAvailable, frameworkExcluded: frameworkExcluded, specialOrderExcluded: specialOrderExcluded, missingImage: missingImage, flagged: rows.length };
  Logger.log('✅ Verðheilsa: ' + JSON.stringify(summary));
  return summary;
}

/************************************************************
 * 📤 getZeroPriceResultForUi — opinbert (fyrir google.script.run hnapp)
 *   Skilar nýjustu vistuðu skönnun (keyrir EKKI nýja).
 ************************************************************/
function getZeroPriceResultForUi() {
  const raw = PropertiesService.getScriptProperties().getProperty('ZERO_PRICE_LAST_RESULT');
  if (!raw) return { status: 'no_data' };
  try {
    return Object.assign({ status: 'ok' }, JSON.parse(raw));
  } catch (e) {
    return { status: 'error', message: 'cache ólæsileg' };
  }
}

/************************************************************
 * 🔁 runZeroPriceScanForUi — keyrir FERSKA skönnun og skilar
 *   niðurstöðu (fyrir "Keyra aftur" hnappinn). Tekur ~1 mín.
 *   Krefst gilds token; kastar 401 ef útrunninn.
 ************************************************************/
function runZeroPriceScanForUi() {
  findZeroListPriceProducts_v1();
  return getZeroPriceResultForUi();
}

/************************************************************
 * ⏰ scheduledZeroPriceScan_v1 — dagleg sjálfvirk keyrsla
 *   Wrapper með villumeðhöndlun (sama mynstur og aðrir scheduled-jobs).
 ************************************************************/
function scheduledZeroPriceScan_v1() {
  try {
    return findZeroListPriceProducts_v1();
  } catch (e) {
    notifyTriggerFailure_('scheduledZeroPriceScan_v1', e, {});
    throw e;
  }
}

/************************************************************
 * 🔧 installZeroPriceScanTrigger_v1 — idempotent installer
 *   Daglega ~06:50. Keyrðu einu sinni (eða gegnum reset-fallið).
 ************************************************************/
function installZeroPriceScanTrigger_v1() {
  var fn = 'scheduledZeroPriceScan_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[ZEROPRICE][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(6).nearMinute(50).create();
  Logger.log('[ZEROPRICE][INFO] Created trigger for ' + fn + ' (every 1 day at ~06:50)');
  return { created: true, schedule: 'everyDays(1).atHour(6).nearMinute(50)' };
}

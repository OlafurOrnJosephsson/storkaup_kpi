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

  const cookie = normalizeStorkaupCookie_(props.getProperty('STORKAUP_SESSION_COOKIE'));
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
      'Network → /api/auth/session → Copy as cURL (bash) → afritaðu ' +
      'authjs.storkaup.session-token=… í Script Property STORKAUP_SESSION_COOKIE. ' +
      '(HTTP ' + res.getResponseCode() + ')'
    );
  }

  // Fallback: handvirkur Bearer
  const raw = props.getProperty('STORKAUP_GQL_BEARER');
  if (raw) return String(raw).replace(/^Bearer\s+/i, '').trim();

  throw new Error(
    'Vantar STORKAUP_SESSION_COOKIE (sjálfvirkt, mælt með) eða STORKAUP_GQL_BEARER (handvirkt).'
  );
}

/************************************************************
 * 🍪 normalizeStorkaupCookie_
 *   Chrome "Copy as cURL (cmd)" escapar með ^ (^%^7C, ^$, ^" aftast) —
 *   eitt ^ aftan á session-token og /api/auth/session skilar null.
 *   Tekur líka við "-b ..." og "Cookie: ..." eins og það er límt.
 ************************************************************/
function normalizeStorkaupCookie_(raw) {
  return String(raw || '')
    .trim()
    .replace(/^-b\s+/i, '')
    .replace(/^cookie:\s*/i, '')
    .replace(/\^(.)/g, '$1')
    .replace(/\^$/, '')
    .replace(/^"+|"+$/g, '');
}

/************************************************************
 * 🍪 setStorkaupSessionCookie_ — vista nýtt cookie með kóða
 *   Script Properties-ritillinn vistar stundum ekki (gildið
 *   hrekkur til baka við refresh, engin villa). Hér er það
 *   skrifað beint, token-cache hreinsað og cookie-ið prófað.
 ************************************************************/
function setStorkaupSessionCookie_(raw) {
  const cookie = normalizeStorkaupCookie_(raw);
  if (!/session-token/.test(cookie)) {
    return { ok: false, message: 'Fann ekki session-token í því sem var límt inn.' };
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('STORKAUP_SESSION_COOKIE', cookie);
  props.deleteProperty('STORKAUP_ACCESS_TOKEN');
  props.deleteProperty('STORKAUP_ACCESS_TOKEN_TS');
  return checkStorkaupAuth();
}

function storkaupParentSku_(rawSku) {
  // STO_9002691 → 9002691 ; STO_116309_STK → 116309 ; 103406_KASSI → 103406
  return String(rawSku || '').replace(/^STO_/i, '').split('_')[0];
}

function storkaupProductUrl_(slug) {
  return slug ? ('https://www.storkaup.is/vara/' + slug) : '';
}

/************************************************************
 * 📦 storkaupBaseQty_ — raunlager i grunneiningu
 *
 *   totalQuantity er EKKI lager, thott nafnid segi thad. Maelt
 *   2026-09-14 yfir allan listann (4.477 faerslur):
 *     1.264 med totalQuantity = 0 — 621 theirra med JAKVAEDAN lager
 *        84 med totalQuantity < 0 — 64 theirra med JAKVAEDAN lager
 *   Reiturinn hegdar ser eins og teljari sem vefurinn dregur nidur vid
 *   pontun en BC-samstillingin endurstillir aldrei; mest neikvaett er
 *   einfaldlega mest selda varan, ekki versta gagnavillan.
 *
 *   Rett tala er SOLUEININGARLINAN margfoldud upp i grunneiningar:
 *     quantityPerLocation a theim variant sem hefur
 *     salesUnitOfMeasure === attributes.salesUnitOfMeasure,
 *     sinnum attributes.salesUnitOfMeasureValue (stk i solueiningu).
 *   Faerslur an variants (3.613 talsins) eru sjalfar solueiningin.
 *
 *   Sannreynt gegn BC 2026-09-14, nakvaemt i ollum thremur:
 *     106268  KASSI 213 × 50 = 10.650   BC ytri birgdir 10.650
 *     107652  STK   123 ×  1 =    123   BC 123
 *     9002572 KASSI  43 ×  6 =    258   BC 258
 *
 *   GRUNNEININGARLINAN (_STK) er EKKI rett fyrir vorur seldar i
 *   kassa: hun er teljari sem tharf ekki ad standa a nullu thegar
 *   varan liggur oll i kossum. 106268 stendur i -2.576 thar medan
 *   solueiningarlinan segir 10.650 — sama vara, nog til.
 *
 *   Skilar null ef ekkert nothaeft gildi finnst — OTHEKKT, ekki 0.
 *   Threkja maeld 2026-09-14: allar 4.477 faerslur hafa
 *   salesUnitOfMeasureValue og allar 864 med variants eiga
 *   solueiningarbarn, svo fallbakkarnir eru belti og axlabond.
 ************************************************************/
function storkaupBaseQty_(node) {
  if (!node) return null;

  const sumLocations_ = function (list) {
    if (!list || !list.length) return null;
    let total = 0, any = false;
    list.forEach(q => {
      // Number(null) === 0 — tomt gildi ma ekki laumast inn sem nuII.
      if (!q || q.quantity === null || q.quantity === undefined || q.quantity === '') return;
      const n = Number(q.quantity);
      if (isFinite(n)) { total += n; any = true; }
    });
    return any ? total : null;
  };

  const attrs = node.attributes || {};
  const salesUnit = attrs.salesUnitOfMeasure || node.salesUnitOfMeasure;
  const perUnit = Number(attrs.salesUnitOfMeasureValue);
  const factor = (isFinite(perUnit) && perUnit > 0) ? perUnit : 1;

  let qty = null;
  const variants = node.variants || [];
  if (variants.length) {
    const sold = variants.filter(v => v && v.salesUnitOfMeasure === salesUnit)[0];
    if (sold) qty = sumLocations_(sold.quantityPerLocation);
  }
  if (qty === null) qty = sumLocations_(node.quantityPerLocation);

  return qty === null ? null : qty * factor;
}

/************************************************************
 * 🌐 fetchActiveProducts_ — allur virki vörulistinn (OPINBER)
 *   Pagear í gegnum getProductsV2 (first/offset).
 *   Skilar fylki af { parent, name, qty, slug } — dedupað á parent.
 *   qty kemur ur storkaupBaseQty_, EKKI totalQuantity — sja thar.
 ************************************************************/
function fetchActiveProducts_() {
  const PAGE = 200;
  const query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug baseUnitOfMeasure salesUnitOfMeasure' +
    '      quantityPerLocation { quantity }' +
    '      variants { sku salesUnitOfMeasure quantityPerLocation { quantity } }' +
    '      featuredImage { url fileName }' +
    '      attributes { isFrameworkAgreementProduct isSpecialOrderProduct' +
    '                   salesUnitOfMeasure salesUnitOfMeasureValue } } }' +
    '  }' +
    '}';

  let total = null;
  let rawCount = 0;
  const seen = {};
  const out = [];

  const request_ = (offset, first) => ({
    url: STORKAUP_GQL_URL_,
    method: 'post',
    contentType: 'application/json',
    headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      query: query,
      variables: { pagination: { first: first || PAGE, offset: offset } },
      operationName: 'getProductsV2'
    })
  });
  const parse_ = res => {
    if (res.getResponseCode() !== 200) {
      throw new Error('getProductsV2 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    const data = JSON.parse(res.getContentText());
    if (data.errors) throw new Error('getProductsV2 errors: ' + JSON.stringify(data.errors).slice(0, 300));
    return (data.data && data.data.getProductsV2) || {};
  };

  const handleEdges_ = edges => edges.forEach(e => {
      const node = e && e.node;
      if (!node) return;
      rawCount++;
      const parent = storkaupParentSku_(node.sku);
      if (!parent) return;

      const fimg = node.featuredImage || {};
      const noImage = !fimg.url || /myndvantar/i.test((fimg.url || '') + ' ' + (fimg.fileName || ''));
      const row = {
        parent: parent,
        name: node.name || '',
        qty: storkaupBaseQty_(node),
        slug: node.slug || '',
        framework: !!(node.attributes && node.attributes.isFrameworkAgreementProduct),
        specialOrder: !!(node.attributes && node.attributes.isSpecialOrderProduct),
        noImage: noImage,
        // Faerslan sjalf i grunneiningu (eda foreldri med variants) — raedur
        // hvor vinnur thegar tvaer faerslur strippast i sama parent-SKU.
        isBase: !!(node.variants && node.variants.length) ||
                node.salesUnitOfMeasure ===
                  ((node.attributes && node.attributes.salesUnitOfMeasure) || node.salesUnitOfMeasure)
      };

      // Tvaer faerslur geta strippast i sama parent-SKU (maelt 2026-09-14:
      // 9003517 KASSI+KG, 117102 KASSI+STK). Fyrstur-vinnur letur tha
      // hendinguna velja eininguna; grunneiningin a ad vinna.
      const at = seen[parent];
      if (at === undefined) { seen[parent] = out.length; out.push(row); return; }
      if (row.isBase && !out[at].isBase) out[at] = row;
  });

  // Fyrsta sidhan gefur totalCount; restin er sott SAMHLIDA (fetchAll).
  // Maelt 2026-10-01: 23 sidhur i rodh 9,2 s, samhlida 3,2 s.
  const first = parse_(UrlFetchApp.fetch(STORKAUP_GQL_URL_, request_(0)));
  total = first.totalCount;
  handleEdges_(first.edges || []);
  let lastConn = first;

  if (first.pageInfo && first.pageInfo.hasNextPage && total) {
    if (total > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
    const offsets = [];
    for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
    const PAR = 6;
    for (let i = 0; i < offsets.length; i += PAR) {
      const group = offsets.slice(i, i + PAR);
      const resps = UrlFetchApp.fetchAll(group.map(o => request_(o)));
      resps.forEach((res, k) => {
        const conn = parse_(res);
        const edges = conn.edges || [];
        handleEdges_(edges);
        lastConn = conn;
        // Fast skref (PAGE) i stad "fjoldi sem kom" — skili sidha faerri
        // rodhum en bedid var um (og hun er ekki su sidasta) er gatid fyllt
        // med einni fyrirspurn. Tviteknar radhir hverfa i seen{}.
        const o = group[k];
        if (edges.length < PAGE && o + PAGE < total) {
          handleEdges_(parse_(UrlFetchApp.fetch(STORKAUP_GQL_URL_, request_(o + edges.length, PAGE - edges.length))).edges || []);
        }
      });
    }
    // totalCount ox medan a sotti stodh: halda afram i rodh fra enda.
    let offset = offsets.length ? offsets[offsets.length - 1] + PAGE : PAGE;
    while (lastConn.pageInfo && lastConn.pageInfo.hasNextPage && offset < 50000) {
      lastConn = parse_(UrlFetchApp.fetch(STORKAUP_GQL_URL_, request_(offset)));
      const edges = lastConn.edges || [];
      if (!edges.length) break;
      handleEdges_(edges);
      offset += edges.length;
    }
  }

  // Offset-sidhuflakk her er slembid ostodugt (sja fetchUncategorizedProducts_).
  // Vorulistinn er grunnur ALLRA maelinga i thessari skra, svo hljod tap er
  // thad versta sem getur gerst — vid segjum fra i stad thess ad thegja.
  if (total !== null && total !== undefined && rawCount < total) {
    Logger.log('⚠️ getProductsV2: sotti ' + rawCount + ' rodhur af ' + total +
               ' — sidhuflakkid slapp, maelingar ithessari keyrslu eru ekki ' +
               'yfir allan vorulistann.');
  }
  Logger.log('🌐 getProductsV2: ' + out.length + ' einstök parent-SKU (totalCount ' + total + ')');
  return out;
}

/************************************************************
 * 🗂️ fetchTopCategoryPaths_ — toppflokkar vefsins (OPINBER)
 *   getProductCategoriesV2 skilar flokkatrenu. url_path er audkennid
 *   sem getProductsV2(categories:) tekur vid — ekki id.
 ************************************************************/
function fetchTopCategoryPaths_() {
  const res = UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
    muteHttpExceptions: true,
    payload: JSON.stringify({ query: '{ getProductCategoriesV2 { items { url_path } } }' })
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('getProductCategoriesV2 ' + res.getResponseCode());
  }
  const data = JSON.parse(res.getContentText());
  if (data.errors) {
    throw new Error('getProductCategoriesV2 errors: ' + JSON.stringify(data.errors).slice(0, 200));
  }
  const root = (data.data && data.data.getProductCategoriesV2) || {};
  const paths = (root.items || []).map(i => i && i.url_path).filter(x => !!x);
  if (!paths.length) throw new Error('getProductCategoriesV2 skiladi engum toppflokki');
  return paths;
}


/************************************************************
 * 🗂️ fetchUncategorizedProducts_ — vorur i ENGUM flokki
 *
 *   Spyr BEINT med excludedCategories i stad thess ad saekja allan
 *   flokkada listann og draga hann fra. Thad er ekki bara odyrara
 *   (1 fyrirspurn i stad ~23) heldur EINA retta leidin:
 *
 *   Offset-sidhuflakk a thessum endapunkti er slembid ostodugt. I maelingu
 *   2026-09-08 skiladi flakk yfir 4.468 rodhur adeins 4.436 einstokum —
 *   32 komu tvisvar og 32 aldrei — og thad endurtok sig. Adrar 12 keyrslur
 *   sama dag voru hnokkralausar. Diff-nalgun byr thvi til DRAUGA: vara sem
 *   flakkid missti virdist flokkslaus. Sú villa birti 20 flokkslausar vorur
 *   sem allar attu flokk.
 *
 *   excludedCategories er sannreynt: fyrir alla fimm toppflokka gildir
 *   categories + excludedCategories === totalCount upp a eininguna.
 *   Toppflokkar erfa born, svo fimm slodhir naegja fyrir allt tredh.
 *
 *   Skilar { rows, total } eda kastar ef sidhuflakkid slapp — hringjandi
 *   skrair tha OMAELT (null) i stad thess ad birta ohaldbaeran lista.
 ************************************************************/
function fetchUncategorizedProducts_(paths) {
  const PAGE = 200;
  const query =
    'query Q($pagination: PaginationInput, $excludedCategories: [String!]) {' +
    '  getProductsV2(pagination: $pagination, excludedCategories: $excludedCategories) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug baseUnitOfMeasure salesUnitOfMeasure' +
    '      quantityPerLocation { quantity }' +
    '      attributes { salesUnitOfMeasure salesUnitOfMeasureValue }' +
    '      variants { sku salesUnitOfMeasure quantityPerLocation { quantity } } } }' +
    '  }' +
    '}';

  const rawSkus = {};
  const seenParent = {};
  const rows = [];
  let offset = 0;
  let total = null;
  let rawCount = 0;

  while (true) {
    const res = UrlFetchApp.fetch(STORKAUP_GQL_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: { Accept: '*/*', Origin: 'https://www.storkaup.is' },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        query: query,
        variables: { pagination: { first: PAGE, offset: offset }, excludedCategories: paths }
      })
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('getProductsV2(excludedCategories) ' + res.getResponseCode());
    }
    const data = JSON.parse(res.getContentText());
    if (data.errors) {
      throw new Error('getProductsV2(excludedCategories) errors: ' + JSON.stringify(data.errors).slice(0, 200));
    }
    const conn = (data.data && data.data.getProductsV2) || {};
    total = conn.totalCount;
    const edges = conn.edges || [];
    if (!edges.length) break;

    edges.forEach(e => {
      const node = e && e.node;
      if (!node) return;
      rawCount++;
      rawSkus[node.sku] = true;
      const parent = storkaupParentSku_(node.sku);
      if (!parent || seenParent[parent]) return;
      seenParent[parent] = true;
      rows.push([parent, node.name || '', storkaupBaseQty_(node), storkaupProductUrl_(node.slug)]);
    });

    // Skref = fjoldi rada sem KOM, ekki fast PAGE.
    offset += edges.length;
    if (!conn.pageInfo || !conn.pageInfo.hasNextPage) break;
    if (offset > 50000) throw new Error('getProductsV2(excludedCategories) pagination guard (>50000).');
    Utilities.sleep(120);
  }

  // Sjalfsprof: serfarinn segir sjalfur hvad thau eiga ad vera margar.
  // Naum vid faerri einstokum SKU en thad, slapp flakkid og listinn er
  // ohaldbaer — betra ad segja OMAELT en ad birta drauga.
  const uniqueRaw = Object.keys(rawSkus).length;
  if (total !== null && total !== undefined && uniqueRaw < total) {
    throw new Error('sidhuflakk slapp — ' + uniqueRaw + ' einstok af ' + total +
                    ' (' + rawCount + ' rodhur sottar)');
  }

  return { rows: rows, total: total };
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
 * 🧾 fetchSalesActivity_ — sölusaga úr BC fyrir lista af SKU
 *   public.product_sales_activity_v1 (core/sql/product_sales_activity_v1.sql).
 *   Skilar { sku: { lastSale, invoices12m, customers12m, invoicesAll } }.
 *   Kastar ef kallið bilar — hringjandi ákveður hvað það kostar.
 ************************************************************/
function fetchSalesActivity_(skus) {
  const out = {};
  const CHUNK = 300;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const body = callSupabaseRpc_('product_sales_activity_v1', { p_skus: skus.slice(i, i + CHUNK) });
    (safeJsonParse_(body, []) || []).forEach(r => {
      out[String(r.sku)] = {
        lastSale: r.last_sale || null,
        invoices12m: Number(r.invoices_12m || 0),
        customers12m: Number(r.customers_12m || 0),
        invoicesAll: Number(r.invoices_all || 0)
      };
    });
  }
  return out;
}

/************************************************************
 * 📥 storeBcSpecialOrderList_ — sérpöntunarlisti úr BC
 *   Kallað úr processBcDrop_v1 þegar skrá með "serpontun" í nafninu
 *   liggur í BC_DROP. BC-vörulisti síaður á Innkaupakóða = SÉRPÖNTUN.
 *
 *   Af hverju: merkingin á að fara BC → Plytix → vefur, en 2026-10-01
 *   voru 50 af 125 SÉRPÖNTUN-vörum á vef ómerktar (allar með Senda í
 *   PIM = Já) — 47 sýndu "Vara væntanleg". Hér er BC sannleikurinn sem
 *   skönnunin ber vefinn saman við.
 *
 *   Flipi BC_SERPONTUN í PRODUCTS-skjalinu, ekki Supabase: ~180 vörur,
 *   skipt út í heild í hvert sinn. Ekki Script Property heldur — listinn
 *   er ~13 KB, yfir 9 KB mörkunum á gildi. Aðeins dagsetningin býr þar
 *   (BC_SPECIAL_ORDER_META). Gögnin eru jafn gömul og síðasti
 *   útflutningur — asOf er sýnt í appinu svo það sjáist.
 ************************************************************/
function storeBcSpecialOrderList_(values, fileName, asOf) {
  if (!values || values.length < 2) throw new Error('Sérpöntunarlisti tómur');
  const head = values[0].map(h => normalizeHeaderKeyLocal_(h));
  const find = re => head.findIndex(h => re.test(h));
  const iNr = head.indexOf('nr');
  const iName = find(/^lysing/);
  const iPurch = find(/^innkaupak/);
  const iPim = find(/^sendaipim/);
  if (iNr === -1) throw new Error('Dálkinn "Nr." vantar í sérpöntunarlista');
  if (iPurch === -1) throw new Error('Dálkinn "Innkaupakóði" vantar í sérpöntunarlista');

  const items = [];
  values.slice(1).forEach(r => {
    const sku = String(r[iNr] == null ? '' : r[iNr]).trim();
    if (!sku) return;
    if (normalizeHeaderKeyLocal_(r[iPurch]).indexOf('serpont') === -1) return;
    items.push({
      sku: sku,
      name: iName === -1 ? '' : String(r[iName] || '').slice(0, 80),
      pim: iPim === -1 ? null : /^j/i.test(String(r[iPim] || '').trim())
    });
  });

  const cfg = loadConfig_();
  const ss = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID);
  let sh = ss.getSheetByName('BC_SERPONTUN');
  if (sh) sh.clear();
  else sh = ss.insertSheet('BC_SERPONTUN');
  const HEADER = ['SKU', 'Lýsing', 'Senda í PIM'];
  // Textasnið FYRIR skrif: annars verður 08405 að 8405.
  sh.getRange(1, 1, items.length + 1, 1).setNumberFormat('@');
  sh.getRange(1, 1, items.length + 1, HEADER.length).setValues(
    [HEADER].concat(items.map(it => [it.sku, it.name, it.pim === null ? '' : (it.pim ? 'Já' : 'Nei')]))
  );

  PropertiesService.getScriptProperties().setProperty('BC_SPECIAL_ORDER_META', JSON.stringify({
    asOf: (asOf instanceof Date ? asOf : new Date()).toISOString(),
    fileName: fileName || '',
    count: items.length
  }));
  return { total: values.length - 1, kept: items.length };
}

// Skilar { asOf, fileName, items } eða null ef enginn listi hefur verið lesinn inn.
function loadBcSpecialOrderList_(ss) {
  const meta = safeJsonParse_(PropertiesService.getScriptProperties().getProperty('BC_SPECIAL_ORDER_META') || '', null);
  if (!meta) return null;
  const sh = ss.getSheetByName('BC_SERPONTUN');
  if (!sh) return null;
  const vals = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues();
  return {
    asOf: meta.asOf,
    fileName: meta.fileName,
    items: vals.filter(r => r[0]).map(r => ({
      sku: String(r[0]).trim(), name: r[1], pim: r[2] === '' ? null : r[2] === 'Já'
    }))
  };
}

/************************************************************
 * 🏷️ comingSoonVerdict_ — sérpöntun eða raunverulega væntanleg?
 *   Gróf flokkun úr sölusögu einni (engin innkaupagögn í Supabase):
 *     Aldrei selt / ekkert í 12 mán  → LÍKLEGA SÉRPÖNTUN
 *     >= 3 reikningar 12 mán og sala
 *        innan 90 daga               → SELST REGLULEGA
 *     annað                          → SKOÐA
 *   a === null þýðir að sölusagan náðist ekki — engin tillaga.
 ************************************************************/
function comingSoonVerdict_(a) {
  if (!a) return '';
  if (!a.lastSale || a.invoices12m === 0) return 'LÍKLEGA SÉRPÖNTUN';
  const days = Math.floor((Date.now() - new Date(a.lastSale).getTime()) / 86400000);
  if (a.invoices12m >= 3 && days <= 90) return 'SELST REGLULEGA';
  return 'SKOÐA';
}

/************************************************************
 * ⚡ fetchStorkaupPricingMany_ — margar verðlotur SAMHLIÐA
 *   Sama fyrirspurn og fetchStorkaupPricing_, en PAR lotur í einu með
 *   UrlFetchApp.fetchAll. Áður ~90 lotur í röð með 250 ms hléi — stærsti
 *   einstaki tímaþjófur skönnunarinnar.
 *   401/403 → token endurnýjaður EINU SINNI og lotan reynd aftur.
 *   429/5xx → beðið og reynt aftur (3 umferðir), svo kastað.
 *   Skilar fylki í sömu röð og batches.
 ************************************************************/
function fetchStorkaupPricingMany_(batches, onProgress) {
  const PAR = 8;
  const query =
    'query getProductsPricing($productSkus: [String!]!) {' +
    '  getProductsPricing(productSkus: $productSkus) {' +
    '    sku unitPrices { sku finalPrice priceGroupId unitOfMeasure basePrice }' +
    '  }' +
    '}';
  const request_ = (skus, token) => ({
    url: STORKAUP_GQL_URL_,
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: '*/*', Origin: 'https://www.storkaup.is' },
    muteHttpExceptions: true,
    payload: JSON.stringify({ query: query, variables: { productSkus: skus }, operationName: 'getProductsPricing' })
  });

  let token = getStorkaupAccessToken_(false);
  let refreshed = false;
  const out = new Array(batches.length);

  for (let i = 0; i < batches.length; i += PAR) {
    let pending = [];
    for (let j = i; j < Math.min(i + PAR, batches.length); j++) pending.push(j);

    for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
      const resps = UrlFetchApp.fetchAll(pending.map(j => request_(batches[j], token)));
      const retry = [];
      let authFail = false;
      resps.forEach((res, k) => {
        const j = pending[k];
        const code = res.getResponseCode();
        if (code === 200) {
          const data = JSON.parse(res.getContentText());
          if (data.errors) throw new Error('GraphQL errors: ' + JSON.stringify(data.errors).slice(0, 400));
          out[j] = (data.data && data.data.getProductsPricing) || [];
        } else if (code === 401 || code === 403) {
          authFail = true; retry.push(j);
        } else if (code === 429 || code >= 500) {
          retry.push(j);
        } else {
          throw new Error('Storkaup GraphQL ' + code + ': ' + res.getContentText().slice(0, 300));
        }
      });
      if (authFail) {
        if (refreshed) throw new Error('Storkaup GraphQL 401 eftir endurnýjun token');
        token = getStorkaupAccessToken_(true);
        refreshed = true;
      } else if (retry.length) {
        Utilities.sleep(1500 * (attempt + 1));
      }
      pending = retry;
    }
    if (pending.length) throw new Error('Verðlotur mistókust eftir 3 tilraunir: ' + pending.length);
    if (onProgress) onProgress(Math.min(i + PAR, batches.length), batches.length);
  }
  return out;
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
 * 🩺 checkStorkaupAuth — sannreyna SESSION COOKIE (ekki cache)
 *   Keyrðu þetta eftir að hafa sett nýtt STORKAUP_SESSION_COOKIE.
 *   ÞVINGAR refresh → prófar cookie-ið sjálft, ekki cache-aða
 *   token-ið (sem lifir 50 mín og gæti gefið falskt grænt ljós).
 *   Leakar ekki cookie/token — bara lengd og staðfestingu.
 ************************************************************/
function checkStorkaupAuth() {
  const props = PropertiesService.getScriptProperties();
  const cookie = props.getProperty('STORKAUP_SESSION_COOKIE');

  if (!cookie) {
    const out = { ok: false, source: 'none', message: 'STORKAUP_SESSION_COOKIE vantar í Script Properties.' };
    Logger.log('❌ ' + JSON.stringify(out));
    return out;
  }
  Logger.log('🍪 Cookie til staðar (' + cookie.length + ' stafir).');

  let token;
  try {
    token = getStorkaupAccessToken_(true);   // ← þvingaður refresh úr cookie
  } catch (e) {
    const out = { ok: false, source: 'cookie', message: String(e && e.message || e) };
    Logger.log('❌ ' + JSON.stringify(out));
    return out;
  }
  Logger.log('🔑 Nýr accessToken sóttur (' + String(token).length + ' stafir).');

  // Sannreyna að token-ið virki í raun á getProductsPricing
  const r = fetchStorkaupPricing_(['9002691']);
  const out = {
    ok: true,
    source: 'cookie',
    tokenLength: String(token).length,
    pricingRows: r.length,
    message: 'Cookie gilt — accessToken sóttur og verðfyrirspurn skilaði ' + r.length + ' línu(m).'
  };
  Logger.log('✅ ' + JSON.stringify(out));
  return out;
}

/************************************************************
 * 🧾 findZeroListPriceProducts_v1 — aðalskönnun (vöruheilsa)
 *  - Alheimur = virkar vörur úr getProductsV2 (á vef)
 *  - Verð úr getProductsPricing
 *  - Flaggar: LISTAVERÐ 0  /  VARA EKKI FÁANLEG
 *
 *  Fjögur eftirlit til viðbótar, öll ÓHÁÐ verði. Þau ríða á sama
 *  vörulistanum, svo þau kosta nær ekkert:
 *    VANTAR_MYND        featuredImage null eða "myndvantar"
 *    UPPSELT            qty <= 0            (kostar 0 fyrirspurnir)
 *    NEIKVAEDUR_LAGER   qty < 0             (hlutmengi uppselt; gagnavilla)
 *    VARA_VAENTANLEG    qty <= 0 og ekki sérpöntun (vefurinn: "Vara væntanleg")
 *    AN_FLOKKS          engum flokki        (+2 fyrirspurnir)
 *
 *  Birgðatalan kemur með vörulistanum. Hún er VILJANDI ekki skrifuð í
 *  PRODUCTS: það skjal endurnýjast 50 raðir í hverri Cludo-keyrslu, svo
 *  ferskt gildi þar myndi frjósa. Hér er flipinn hreinsaður og skrifaður
 *  í heild í hverri keyrslu.
 *
 *  - Skrifar flipa + vistar cache fyrir hnapp
 *  - Skilar { totalActive, zeroPrice, notAvailable, missingImage,
 *             outOfStock, negativeStock, noCategory, flagged }
 *    noCategory === null þýðir ÓMÆLT (flokkalesturinn bilaði), ekki 0.
 ************************************************************/
function findZeroListPriceProducts_v1(opts) {
  const cfg = loadConfig_();
  // progress(skref, gert, alls) — skrifar stöðu fyrir appið (sjá runZeroPriceScanLocked_).
  const progress = (opts && opts.progress) || function () {};
  // Tími hvers skrefs í ms — vistaður með niðurstöðunni og sýndur í appinu.
  const timings = {};
  let tMark = Date.now();
  const lap = name => { const now = Date.now(); timings[name] = now - tMark; tMark = now; };

  // 1) Virki vörulistinn (réttur alheimur)
  progress('Vörulisti', 0, 0);
  const products = fetchActiveProducts_();
  const meta = {};
  const skus = [];
  products.forEach(p => { meta[p.parent] = p; skus.push(p.parent); });
  lap('catalog');

  // 2) Verð í lotum — sótt samhliða (fetchStorkaupPricingMany_)
  const BATCH = 50;
  const rows = [];
  const frameworkRows = [];   // rammasamningsvörur án almenns verðs (til heilbrigðis-eftirlits)
  let checked = 0, zeroPrice = 0, notAvailable = 0, frameworkExcluded = 0, specialOrderExcluded = 0;

  const batches = [];
  for (let i = 0; i < skus.length; i += BATCH) batches.push(skus.slice(i, i + BATCH));
  progress('Verð', 0, batches.length);
  let lastPct = -1;
  const priceResults = fetchStorkaupPricingMany_(batches, (done, all) => {
    // Ekki skrifa stöðu í hverri lotu — Script Properties eru hæg.
    const pct = Math.floor(10 * done / all);
    if (pct !== lastPct) { lastPct = pct; progress('Verð', done, all); }
  });
  lap('pricing');

  batches.forEach((batch, bi) => {
    const result = priceResults[bi];

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
        // Sérpöntunarvörur: verðlausar að hönnun (flaggið er í notkun —
        // 75 vörur 2026-10-01).
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
  });
  Logger.log('  verð: ' + skus.length + ' vörur í ' + batches.length + ' lotum (flögg: ' + rows.length + ')');

  // 2b) Mynd-eftirlit (óháð verði) — featuredImage null eða "myndvantar*"
  const imageRows = [];
  products.forEach(p => {
    if (p.noImage) imageRows.push([p.parent, p.name || '', p.qty, storkaupProductUrl_(p.slug)]);
  });
  const missingImage = imageRows.length;

  // 2c) Birgdaeftirlit (ohad verdi) — talan fylgir vorulistanum, svo thetta
  // kostar engar nyjar fyrirspurnir. qty === null thydir OTHEKKT, ekki 0.
  // Talan kemur ur storkaupBaseQty_ (quantityPerLocation i grunneiningu).
  // Hun var adur totalQuantity, sem er teljari en ekki lager — sja
  // storkaupBaseQty_ um hvers vegna sa reitur skilar ~70 folskum
  // neikvaedum vorum og felur thaer verstu raunverulegu.
  //
  // VARA_VAENTANLEG: vefurinn synir "Vara vaentanleg" a ollu sem er med
  // stodu <= 0 i BC og er EKKI sérpöntun. Margar theirra aettu i raun ad
  // vera sérpöntun — listinn er til ad fara yfir thad.
  const outOfStockRows = [];
  const negativeRows = [];
  const comingRows = [];
  products.forEach(p => {
    if (p.qty === null || p.qty === undefined || p.qty === '') return;
    const n = Number(p.qty);
    if (!isFinite(n)) return;
    const row = [p.parent, p.name || '', n, storkaupProductUrl_(p.slug)];
    if (n <= 0) outOfStockRows.push(row);
    if (n < 0) negativeRows.push(row);
    if (n <= 0 && !p.specialOrder) comingRows.push(row);
  });
  const outOfStock = outOfStockRows.length;
  const negativeStock = negativeRows.length;
  const comingSoon = comingRows.length;

  // 2c') Sölusaga á væntanlegu vörurnar. Sér-try: bili Supabase verða
  // söludálkarnir tómir (ÓMÆLT), en listinn sjálfur stendur.
  progress('Sölusaga', 0, 0);
  let activity = null;
  try {
    activity = fetchSalesActivity_(comingRows.map(r => r[0]));
  } catch (e) {
    Logger.log('⚠️ Sölusaga mistókst — væntanlegar vörur án söludálka: ' + e.message);
  }
  lap('sales');

  // 2c'') Sérpöntunarlisti úr BC (storeBcSpecialOrderList_). null = enginn
  // listi lesinn inn enn → samanburðurinn er ÓMÆLDUR, ekki 0.
  let bcSo = null;
  try {
    bcSo = loadBcSpecialOrderList_(SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID));
  } catch (e) {
    Logger.log('⚠️ Sérpöntunarlisti úr BC ólæsilegur — samanburður ÓMÆLDUR: ' + e.message);
  }
  const bcSoMap = {};
  if (bcSo && bcSo.items) bcSo.items.forEach(it => { bcSoMap[it.sku] = it; });

  const NO_SALES = { lastSale: null, invoices12m: 0, customers12m: 0, invoicesAll: 0 };
  const VERDICT_ORDER = { 'SÉRPÖNTUN Í BC': 0, 'LÍKLEGA SÉRPÖNTUN': 1, 'SKOÐA': 2, 'SELST REGLULEGA': 3, '': 4 };
  const comingFull = comingRows.map(r => {
    const a = activity ? (activity[r[0]] || NO_SALES) : null;
    return {
      sku: r[0], name: r[1], qty: r[2], url: r[3],
      lastSale: a ? a.lastSale : null,
      invoices12m: a ? a.invoices12m : null,
      customers12m: a ? a.customers12m : null,
      // BC segir það beint — trompar ágiskun úr sölusögu.
      verdict: bcSoMap[r[0]] ? 'SÉRPÖNTUN Í BC' : comingSoonVerdict_(a)
    };
  });
  // BC-staðfestar efst, svo líklegustu; innan flokks elsta sala fyrst.
  comingFull.sort((x, y) =>
    (VERDICT_ORDER[x.verdict] - VERDICT_ORDER[y.verdict]) ||
    String(x.lastSale || '').localeCompare(String(y.lastSale || '')) ||
    String(x.sku).localeCompare(String(y.sku))
  );
  const likelySpecial = activity
    ? comingFull.filter(c => c.verdict === 'LÍKLEGA SÉRPÖNTUN').length
    : null;

  // 2c''') Misræmi BC ↔ vefur í báðar áttir.
  //   Í BC, EKKI Á VEF   SÉRPÖNTUN í BC, í birtingu, vefurinn ómerktur
  //   Á VEF, EKKI Í BC   vefurinn merktur sérpöntun, BC ekki
  //   EKKI Í BIRTINGU    SÉRPÖNTUN + Senda í PIM = Já, en ekki á vef
  const soRows = [];   // [sku, nafn, misræmi, staða á vef, lager, senda í PIM, url]
  let soMissingOnWeb = null, soExtraOnWeb = null, soNotPublished = null;
  if (bcSo) {
    const onWeb = {};
    products.forEach(p => {
      onWeb[p.parent] = true;
      const it = bcSoMap[p.parent];
      const webState = p.specialOrder ? 'Sérpöntun'
        : ((p.qty !== null && p.qty !== undefined && Number(p.qty) <= 0) ? 'Vara væntanleg' : 'Á lager');
      const url = storkaupProductUrl_(p.slug);
      if (it && !p.specialOrder) {
        soRows.push([p.parent, p.name || it.name, 'Í BC, EKKI Á VEF', webState, p.qty, it.pim === null ? '' : (it.pim ? 'Já' : 'Nei'), url]);
      } else if (!it && p.specialOrder) {
        soRows.push([p.parent, p.name || '', 'Á VEF, EKKI Í BC', webState, p.qty, '', url]);
      }
    });
    bcSo.items.forEach(it => {
      if (!onWeb[it.sku] && it.pim === true) {
        soRows.push([it.sku, it.name, 'EKKI Í BIRTINGU', '—', '', 'Já', '']);
      }
    });
    const SO_ORDER = { 'Í BC, EKKI Á VEF': 0, 'Á VEF, EKKI Í BC': 1, 'EKKI Í BIRTINGU': 2 };
    soRows.sort((a, b) => (SO_ORDER[a[2]] - SO_ORDER[b[2]]) || String(a[0]).localeCompare(String(b[0])));
    soMissingOnWeb = soRows.filter(r => r[2] === 'Í BC, EKKI Á VEF').length;
    soExtraOnWeb   = soRows.filter(r => r[2] === 'Á VEF, EKKI Í BC').length;
    soNotPublished = soRows.filter(r => r[2] === 'EKKI Í BIRTINGU').length;
  }

  // 2d) Flokkaeftirlit — vorur i birtingu sem tilheyra engum flokki.
  // Spurt BEINT (excludedCategories), ekki reiknad ut fra mismun: sja
  // fetchUncategorizedProducts_ um hvers vegna diff byr til drauga.
  // Sér-try: bili flokkalesturinn kostar thad EINA maelingu, ekki alla
  // skonnunina. null = OMAELT, sem er annad en 0.
  progress('Flokkar', 0, 0);
  let noCategoryRows = [];
  let noCategory = null;
  try {
    const uncat = fetchUncategorizedProducts_(fetchTopCategoryPaths_());
    noCategoryRows = uncat.rows;
    noCategory = noCategoryRows.length;
  } catch (e) {
    noCategoryRows = [];
    Logger.log('⚠️ Flokkaeftirlit mistokst — skrad OMAELT: ' + e.message);
  }

  lap('categories');

  // 3) Skrifa flipa
  progress('Skrifa flipa', 0, 0);
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

  // 3d) Nyju eftirlitsflipar
  const NEW_HEADER = ['SKU', 'Product Name', 'Lager', 'URL'];
  const writeTab_ = function (name, rows, cmp) {
    let s2 = ss.getSheetByName(name);
    if (s2) s2.clear();
    else s2 = ss.insertSheet(name);
    s2.appendRow(NEW_HEADER);
    if (rows.length) {
      rows.sort(cmp || function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
      s2.getRange(2, 1, rows.length, NEW_HEADER.length).setValues(rows);
    }
    s2.getRange(1, 1, s2.getLastRow(), 1).setNumberFormat('@');
  };

  writeTab_('UPPSELT', outOfStockRows);

  // VARA_VAENTANLEG hefur fleiri dálka (sölusaga + tillaga) og eigin röðun.
  let csh = ss.getSheetByName('VARA_VAENTANLEG');
  if (csh) csh.clear();
  else csh = ss.insertSheet('VARA_VAENTANLEG');
  const CHEADER = ['SKU', 'Product Name', 'Lager', 'Síðasta sala', 'Reikningar 12 mán', 'Viðskiptavinir 12 mán', 'Tillaga', 'URL'];
  csh.appendRow(CHEADER);
  if (comingFull.length) {
    csh.getRange(2, 1, comingFull.length, CHEADER.length).setValues(comingFull.map(c => [
      c.sku, c.name, c.qty, c.lastSale || (activity ? 'Aldrei' : ''),
      c.invoices12m === null ? '' : c.invoices12m,
      c.customers12m === null ? '' : c.customers12m,
      c.verdict, c.url
    ]));
  }
  csh.getRange(1, 1, csh.getLastRow(), 1).setNumberFormat('@');

  // SERPONTUN_MISRAEMI — aðeins ef BC-listi hefur verið lesinn inn.
  if (bcSo) {
    let msh = ss.getSheetByName('SERPONTUN_MISRAEMI');
    if (msh) msh.clear();
    else msh = ss.insertSheet('SERPONTUN_MISRAEMI');
    const MHEADER = ['SKU', 'Product Name', 'Misræmi', 'Staða á vef', 'Lager', 'Senda í PIM', 'URL'];
    msh.appendRow(MHEADER);
    if (soRows.length) msh.getRange(2, 1, soRows.length, MHEADER.length).setValues(soRows);
    msh.getRange(1, 1, msh.getLastRow(), 1).setNumberFormat('@');
  }

  // Mest neikvaett fyrst — thad er versta gagnavillan.
  writeTab_('NEIKVAEDUR_LAGER', negativeRows, function (a, b) { return a[2] - b[2]; });
  if (noCategory !== null) writeTab_('AN_FLOKKS', noCategoryRows);

  lap('sheets');

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
    outOfStock: outOfStock,
    negativeStock: negativeStock,
    comingSoon: comingSoon,
    likelySpecial: likelySpecial,
    comingSample: comingFull.slice(0, 25),
    // null = enginn BC-sérpöntunarlisti lesinn inn (ÓMÆLT).
    bcSpecial: bcSo ? {
      asOf: bcSo.asOf, total: bcSo.items.length,
      missingOnWeb: soMissingOnWeb, extraOnWeb: soExtraOnWeb, notPublished: soNotPublished
    } : null,
    specialMismatchSample: soRows.slice(0, 25).map(r => ({
      sku: r[0], name: r[1], issue: r[2], webState: r[3], qty: r[4], pim: r[5], url: r[6]
    })),
    negativeSample: negativeRows.slice(0, 25).map(r => ({ sku: r[0], name: r[1], qty: r[2], url: r[3] })),
    noCategory: noCategory,
    noCategorySample: noCategoryRows.slice(0, 25).map(r => ({ sku: r[0], name: r[1], qty: r[2], url: r[3] })),
    flagged: rows.length,
    sample: sample,
    timings: timings
  };
  PropertiesService.getScriptProperties().setProperty('ZERO_PRICE_LAST_RESULT', JSON.stringify(cache));

  const summary = { totalActive: checked, zeroPrice: zeroPrice, notAvailable: notAvailable, frameworkExcluded: frameworkExcluded, specialOrderExcluded: specialOrderExcluded, missingImage: missingImage, outOfStock: outOfStock, negativeStock: negativeStock, comingSoon: comingSoon, likelySpecial: likelySpecial, soMissingOnWeb: soMissingOnWeb, soExtraOnWeb: soExtraOnWeb, noCategory: noCategory, flagged: rows.length };
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
 * 📋 getComingSoonListForUi — allur VARA_VAENTANLEG flipinn
 *   Cache-inn í Script Properties ber aðeins 25 raðir (stærðarmörk);
 *   allur listinn er lesinn beint úr flipanum sem skönnunin skrifaði.
 *   getDisplayValues: Sheets breytir 'YYYY-MM-DD' í Date við skrif,
 *   birtingargildið er það sem við viljum aftur.
 ************************************************************/
function getComingSoonListForUi() {
  const cfg = loadConfig_();
  const sh = SpreadsheetApp.openById(cfg.SHEETS.PRODUCTS.ID).getSheetByName('VARA_VAENTANLEG');
  if (!sh || sh.getLastRow() < 2) return { status: 'ok', rows: [] };
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getDisplayValues();
  const num = v => (v === '' ? null : Number(String(v).replace(/[^\d.-]/g, '')));
  return {
    status: 'ok',
    rows: vals.map(r => ({
      sku: r[0], name: r[1], qty: num(r[2]), lastSale: r[3] || null,
      invoices12m: num(r[4]), customers12m: num(r[5]), verdict: r[6], url: r[7]
    }))
  };
}

/************************************************************
 * 🔒 runZeroPriceScanLocked_ — EINA leiðin inn í skönnunina
 *   Script-lás: tvær skannanir samtímis (tveir smella, eða dagleg
 *   keyrsla rekst á handvirka) myndu skrifa sömu flipa hvor ofan í
 *   aðra. Sú sem nær ekki lásnum hættir strax.
 *
 *   Staða í ZERO_PRICE_SCAN_STATE fyrir appið:
 *     { state: queued|running|done|error|busy, startedAt, finishedAt,
 *       phase, done, total, message }
 ************************************************************/
var ZERO_PRICE_STATE_KEY_ = 'ZERO_PRICE_SCAN_STATE';
// Apps Script drepur keyrslu eftir 6 mín. "running" eldra en þetta er dautt.
var ZERO_PRICE_STALE_MS_ = 8 * 60 * 1000;

function setZeroPriceScanState_(patch) {
  const props = PropertiesService.getScriptProperties();
  const cur = safeJsonParse_(props.getProperty(ZERO_PRICE_STATE_KEY_) || '', null) || {};
  const next = Object.assign(cur, patch);
  props.setProperty(ZERO_PRICE_STATE_KEY_, JSON.stringify(next));
  return next;
}

function runZeroPriceScanLocked_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) {
    Logger.log('[ZEROPRICE] Önnur skönnun í gangi — hætti.');
    return { status: 'busy' };
  }
  try {
    setZeroPriceScanState_({ state: 'running', startedAt: new Date().toISOString(),
                             finishedAt: null, phase: 'Ræsi', done: 0, total: 0, message: '' });
    const summary = findZeroListPriceProducts_v1({
      progress: (phase, done, total) => setZeroPriceScanState_({ phase: phase, done: done, total: total })
    });
    setZeroPriceScanState_({ state: 'done', finishedAt: new Date().toISOString(), phase: '' });
    return summary;
  } catch (e) {
    setZeroPriceScanState_({ state: 'error', finishedAt: new Date().toISOString(),
                             message: String(e && e.message || e) });
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/************************************************************
 * 🚀 startZeroPriceScanForUi — "Keyra aftur" hnappurinn
 *   Ræsir skönnunina í BAKGRUNNI (einskiptis-trigger) og svarar strax.
 *   Áður keyrði hnappurinn hana beint: admin → doPost → UrlFetch sem
 *   gefst upp eftir ~1 mín, og skönnun yfir 6 mín dó án þess að nokkur
 *   frétti. Nú spyr appið getZeroPriceScanStatusForUi á meðan.
 ************************************************************/
function startZeroPriceScanForUi() {
  const st = getZeroPriceScanStatusForUi();
  if (st.state === 'running' || st.state === 'queued') return st;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'zeroPriceScanFromTrigger_v1')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('zeroPriceScanFromTrigger_v1').timeBased().after(1000).create();
  return setZeroPriceScanState_({ state: 'queued', startedAt: new Date().toISOString(),
                                  finishedAt: null, phase: 'Í biðröð', done: 0, total: 0, message: '' });
}

// Handler einskiptis-triggersins. Eyðir sjálfum sér fyrst — after() trigger
// hverfur ekki sjálfkrafa úr listanum og auditTriggers_v1 myndi telja hann.
function zeroPriceScanFromTrigger_v1() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'zeroPriceScanFromTrigger_v1')
    .forEach(t => ScriptApp.deleteTrigger(t));
  try {
    runZeroPriceScanLocked_();
  } catch (e) {
    notifyTriggerFailure_('zeroPriceScanFromTrigger_v1', e, {});
  }
}

function getZeroPriceScanStatusForUi() {
  const raw = PropertiesService.getScriptProperties().getProperty(ZERO_PRICE_STATE_KEY_);
  const st = safeJsonParse_(raw || '', null) || { state: 'idle' };
  if ((st.state === 'running' || st.state === 'queued') && st.startedAt &&
      Date.now() - new Date(st.startedAt).getTime() > ZERO_PRICE_STALE_MS_) {
    st.message = st.state === 'queued'
      ? 'Skönnunin fór aldrei af stað.'
      : 'Skönnunin hætti án svars (líklega 6 mín hámark Apps Script).';
    st.state = 'error';
  }
  return st;
}

// Eldri samstillta leiðin — haldið fyrir handvirka keyrslu úr ritlinum.
function runZeroPriceScanForUi() {
  runZeroPriceScanLocked_();
  return getZeroPriceResultForUi();
}

/************************************************************
 * ⏰ scheduledZeroPriceScan_v1 — dagleg sjálfvirk keyrsla
 *   Wrapper með villumeðhöndlun (sama mynstur og aðrir scheduled-jobs).
 *   Fer í gegnum lásinn eins og hnappurinn.
 ************************************************************/
function scheduledZeroPriceScan_v1() {
  try {
    return runZeroPriceScanLocked_();
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

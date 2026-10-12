/************************************************************
 * 📦 LAGERSALA — hvað hefur farið af storkaup.is/lagersala
 * ----------------------------------------------------------
 * Salan opnaði 2026-10-12. /lagersala er handvalinn listi (~136
 * vörur) — ekki flokkur, ekki merki á vörunni — svo eina heimildin
 * um hvað er á henni er síðan sjálf. Hún er birt á þjóninum og hver
 * vara er <a href="/vara/<slug>">.
 *
 * Daglega (~06:40, opnunarstaða dagsins):
 *   1. lesa slóðirnar af /lagersala
 *   2. fletta hverri upp í vörulistanum (getProductsV2, OPINBERT)
 *      eftir slug og lesa birgðir með storkaupBaseQty_
 *   3. skrifa eina línu á vöru í raw.lagersala_snapshot
 * public.lagersala_summary_v1() reiknar kortið á /kpi/dashboard.
 * Sjá core/sql/lagersala_v1.sql um af hverju birgðir en ekki sala.
 *
 * Flett er eftir SLUG, ekki vörunúmeri: slóðin er ekki á föstu
 * formi (`/vara/124724stk`, `/vara/bakki-1000ml-4x-75stk-123996`)
 * og sama vörunúmer getur verið tvær færslur (STK og KASSI). Slug
 * er það sem síðan vísar á, og það er einkvæmt.
 *
 * Þegar lagersölunni lýkur: fjarlægja scheduledLagersalaSync_v1 úr
 * requiredTimeTriggers_ og eyða triggernum. Annars kemur villupóstur
 * daglega þegar síðan hverfur — sem er réttara en þögn.
 ************************************************************/

var LAGERSALA_URL_ = 'https://www.storkaup.is/lagersala';

function fetchLagersalaSlugs_() {
  const res = UrlFetchApp.fetch(LAGERSALA_URL_, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Storkaup KPI)' }
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('/lagersala svaraði HTTP ' + res.getResponseCode());
  }
  const html = res.getContentText();
  const seen = {};
  const re = /href="\/vara\/([^"?#\/]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) seen[decodeURIComponent(m[1])] = true;
  return Object.keys(seen);
}

// Allur vörulistinn lyklaður eftir slug. Sama fyrirspurnarform og
// fetchActiveProducts_ (storkaup_pricing.js) en EKKI dedupað á vörunúmer —
// hér þarf nákvæmlega þá færslu sem slóðin vísar á.
function fetchCatalogBySlug_() {
  const PAGE = 200;
  const query =
    'query getProductsV2($pagination: PaginationInput) {' +
    '  getProductsV2(pagination: $pagination) {' +
    '    totalCount pageInfo { hasNextPage }' +
    '    edges { node { sku name slug salesUnitOfMeasure' +
    '      quantityPerLocation { quantity }' +
    '      variants { sku salesUnitOfMeasure quantityPerLocation { quantity } }' +
    '      attributes { salesUnitOfMeasure salesUnitOfMeasureValue } } }' +
    '  }' +
    '}';
  const request_ = offset => ({
    url: STORKAUP_GQL_URL_,
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
  const parse_ = res => {
    if (res.getResponseCode() !== 200) {
      throw new Error('getProductsV2 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    }
    const data = JSON.parse(res.getContentText());
    if (data.errors) throw new Error('getProductsV2 errors: ' + JSON.stringify(data.errors).slice(0, 300));
    return (data.data && data.data.getProductsV2) || {};
  };

  const bySlug = {};
  const take_ = edges => (edges || []).forEach(e => {
    const node = e && e.node;
    if (!node || !node.slug || !node.sku) return;
    bySlug[node.slug] = { webSku: String(node.sku), name: node.name || '', qty: storkaupBaseQty_(node) };
  });

  const first = parse_(UrlFetchApp.fetch(STORKAUP_GQL_URL_, request_(0)));
  take_(first.edges);
  const total = Number(first.totalCount || 0);
  if (total > 50000) throw new Error('getProductsV2 pagination guard (>50000).');
  const offsets = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  for (let i = 0; i < offsets.length; i += 6) {
    UrlFetchApp.fetchAll(offsets.slice(i, i + 6).map(request_)).forEach(res => take_(parse_(res).edges));
  }
  return bySlug;
}

function syncLagersala_v1() {
  const slugs = fetchLagersalaSlugs_();
  // Síða sem svarar 200 en ber engar vörur er breytt síða, ekki tóm sala.
  if (!slugs.length) throw new Error('/lagersala: engar /vara/-slóðir fundust — hefur síðunni verið breytt?');

  let catalog = fetchCatalogBySlug_();
  // Offset-síðuflakkið á getProductsV2 er óstöðugt (sjá storkaup_pricing.js):
  // vara getur dottið á milli síðna. Ein umferð í viðbót áður en gefist er upp.
  if (slugs.some(s => !catalog[s])) {
    const again = fetchCatalogBySlug_();
    Object.keys(again).forEach(k => { if (!catalog[k]) catalog[k] = again[k]; });
  }

  const snapDate = Utilities.formatDate(new Date(), 'Atlantic/Reykjavik', 'yyyy-MM-dd');
  const nowIso = new Date().toISOString();
  const missing = [];
  const payload = [];
  slugs.forEach(slug => {
    const p = catalog[slug];
    if (!p) { missing.push(slug); return; }
    payload.push({
      snap_date: snapDate,
      web_sku: p.webSku,
      sku: normStorkaupSku_(p.webSku),
      slug: slug,
      product_name: p.name || null,
      qty: p.qty,
      captured_at: nowIso
    });
  });

  if (payload.length) {
    const conf = getSupabaseRestConfig_();
    const res = UrlFetchApp.fetch(conf.baseUrl + '/lagersala_snapshot?on_conflict=snap_date,web_sku', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('lagersala_snapshot upsert ' + code + ': ' + res.getContentText().slice(0, 300));
    }
  }

  const out = { snapDate: snapDate, onPage: slugs.length, written: payload.length, missing: missing };
  Logger.log('[LAGERSALA][INFO] ' + JSON.stringify(out));
  // Vara á síðunni sem finnst ekki í vörulistanum er líklega afvirkjuð en
  // stendur enn á síðunni. Hún er ekki talin — sagt frá frekar en þagað.
  if (missing.length) {
    Logger.log('[LAGERSALA][VARUD] ' + missing.length + ' slóðir fundust ekki í vörulistanum: ' + missing.join(', '));
  }
  return out;
}

function scheduledLagersalaSync_v1() {
  try {
    return syncLagersala_v1();
  } catch (e) {
    Logger.log('[LAGERSALA][ERROR] ' + (e && e.message || e));
    notifyTriggerFailure_('scheduledLagersalaSync_v1', e, {});
    throw e;
  }
}

function installLagersalaSyncTrigger_v1() {
  var fn = 'scheduledLagersalaSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[LAGERSALA][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(6).nearMinute(40).create();
  Logger.log('[LAGERSALA][INFO] Created trigger for ' + fn + ' (every 1 day at ~06:40)');
  return { created: true, schedule: 'everyDays(1).atHour(6).nearMinute(40)' };
}

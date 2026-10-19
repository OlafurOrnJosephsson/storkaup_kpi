/***************************************************
 * 👥 customers.gs — Magento Customers (CORE v3)
 * -------------------------------------------------
 * ✔ Uses loadConfig_() + magentoHeaders_()
 * ✔ Full export if empty
 * ✔ Incremental sync via updated_at checkpoint
 * ✔ No duplicates ever
 * ✔ Clean normalized fields
 * ✔ Provides fast lookup map for NEWWEB
 ***************************************************/


/*************** CONFIG ***************/
const MAGENTO_CUSTOMERS_SHEET_NAME    = 'MAGENTO_CUSTOMERS';
const MAGENTO_CUSTOMERS_LAST_SYNC_KEY = 'MAGENTO_CUSTOMERS_LAST_SYNC';
/**************************************/


/************************************************************
 * Spreadsheet helpers
 ************************************************************/

function getCustomersSpreadsheet_() {
  const CONFIG = loadConfig_();
  const ssId   = CONFIG.SHEET_IDS.CUSTOMERS;
  if (!ssId) throw new Error('CONFIG ERROR: Vantar SHEET_IDS.CUSTOMERS í STORKAUP_CONFIG');
  return SpreadsheetApp.openById(ssId);
}

function getMagentoCustomersSheet_() {
  const ss = getCustomersSpreadsheet_();
  let sh = ss.getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(MAGENTO_CUSTOMERS_SHEET_NAME);
  return sh;
}


/************************************************************
 * Header
 ************************************************************/
function ensureMagentoCustomersHeader_() {
  const sh = getMagentoCustomersSheet_();
  const header = [
    'ID',
    'Name',
    'Email',
    'Group',
    'Phone',
    'ZIP',
    'Country',
    'Region',
    'Created At',
    'Updated At',
    'Company Name',
    'Company ID',
    'Real Email',
    'Role',
    'Has Liquor License',
    'Has Toxic License',
    'National ID'
  ];

  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,header.length)
      .setValues([header])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    return header;
  }

  const existing = sh.getRange(1,1,1,header.length).getValues()[0];
  if (existing.join('|') !== header.join('|')) {
    sh.getRange(1,1,1,header.length)
      .setValues([header])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  return header;
}


/************************************************************
 * Fetch from Magento (full or incremental)
 ************************************************************/
function fetchMagentoCustomers_(sinceIso) {
  const CONFIG = loadConfig_();
  const base   = String(CONFIG.ENDPOINTS.Magento.BASE_URL||'').replace(/\/$/,'');
  if (!base) throw new Error('CONFIG ERROR: Vantar ENDPOINTS.Magento.BASE_URL');

  const pageSize = 300;
  let page = 1;
  let all  = [];

  const incremental = !!(sinceIso && !isNaN(Date.parse(sinceIso)));
  if (sinceIso && !incremental) {
    Logger.log('Invalid sinceIso value, running full export instead');
  }
  Logger.log(`📡 Fetch Magento Customers — ${incremental ? 'incremental' : 'full'}`);

  while (true) {
    if (page > 1000) {
      throw new Error('Pagination guard hit (over 1000 pages). Aborting to avoid infinite loop.');
    }
    let search = `searchCriteria[currentPage]=${page}&searchCriteria[pageSize]=${pageSize}`;

    if (incremental) {
      const v = encodeURIComponent(sinceIso);
      search +=
        `&searchCriteria[filter_groups][0][filters][0][field]=updated_at` +
        `&searchCriteria[filter_groups][0][filters][0][value]=${v}` +
        `&searchCriteria[filter_groups][0][filters][0][condition_type]=gt`;
    }

    const url = `${base}/customers/search?${search}`;
    const res = fetchMagentoWithRetry_(url,{
      method:'get',
      headers:magentoHeaders_(),
      contentType:'application/json',
      followRedirects:false,
      validateHttpsCertificates:true,
      muteHttpExceptions:true
    });

    const body = res.getContentText();
    const data  = JSON.parse(body);
    if (!data || !Array.isArray(data.items)) {
      throw new Error('Unexpected Magento response (items missing or not array). Body: ' + truncateBody_(body));
    }
    const items = data.items;
    if (!items.length) break;

    all = all.concat(items);
    if (items.length < pageSize) break;
    page++;
  }

  Logger.log(`📦 Total Magento customers fetched: ${all.length}`);

  return all.map(mapMagentoCustomer_);
}

function fetchMagentoWithRetry_(url, options) {
  const maxAttempts = 3;
  let attempt = 0;
  let lastError = null;
  let didForceRefresh = false;

  while (attempt < maxAttempts) {
    attempt++;
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();

    if (code === 401 || code === 403) {
      if (!didForceRefresh) {
        didForceRefresh = true;
        clearMagentoAdminTokenCache_();
        options = Object.assign({}, options, {
          headers: magentoHeaders_({ forceRefresh: true })
        });
        continue;
      }
      throw new Error(`Magento auth failed (${code}). Clear MAGENTO_ADMIN_TOKEN_CACHE/TS and verify 2FA credentials/user role.`);
    }

    if (code === 429 || code >= 500) {
      lastError = new Error(`Magento ${code} on ${url}: ${truncateBody_(res.getContentText())}`);
      const backoff = Math.min(60000, 500 * Math.pow(2, attempt - 1));
      Utilities.sleep(backoff);
      continue;
    }

    if (code !== 200) {
      throw new Error(`Magento returned ${code}: ${truncateBody_(res.getContentText())}`);
    }

    return res;
  }

  throw lastError || new Error(`Magento fetch failed after ${maxAttempts} attempts: ${url}`);
}

function truncateBody_(str, maxLen) {
  const limit = maxLen || 400;
  if (!str) return '';
  const s = String(str);
  return s.length > limit ? s.slice(0, limit) + '...' : s;
}


/************************************************************
 * Normalize Magento → Local row object
 ************************************************************/
function mapMagentoCustomer_(c) {
  const ca = c.custom_attributes || [];
  const get = code => {
    const a = ca.find(x => x.attribute_code === code);
    return a ? a.value : '';
  };

  const billing  = (c.addresses||[]).find(a=>a.default_billing)  || {};
  const shipping = (c.addresses||[]).find(a=>a.default_shipping) || {};

  return {
    id:          String(c.id),
    name:        `${c.firstname||''} ${c.lastname||''}`.trim(),
    email:       c.email || '',
    group:       c.group_id || '',
    phone:       get('telephone') || billing.telephone || '',
    zip:         billing.postcode || shipping.postcode || '',
    country:     billing.country_id || shipping.country_id || '',
    region:      (billing.region && billing.region.region) ||
                 (shipping.region && shipping.region.region) || '',
    created:     c.created_at || '',
    updated:     c.updated_at || '',
    company_name: get('company_name') || '',
    company_id:   get('company_id')   || '',
    real_email:   get('real_email')   || '',
    role:         get('role') || '',
    has_liquor:   get('has_liquor_license') || '',
    has_toxic:    get('has_toxic_license')  || '',
    national_id:  get('customer_national_id_number') || ''
  };
}


/************************************************************
 * MAIN SYNC (full or incremental)
 ************************************************************/
function syncMagentoCustomers() {
  // Áætluðu kallararnir athuga rofann sjálfir; þetta grípur handvirku leiðina
  // („Samstilla“ í umsóknarappinu, gegnum sync_magento_customers).
  if (!isMagentoApiEnabled_()) {
    Logger.log('[MAGENTO][INFO] syncMagentoCustomers skipped: Magento API lokað');
    return { skipped: true, reason: 'magento_disabled' };
  }
  const sh     = getMagentoCustomersSheet_();
  const header = ensureMagentoCustomersHeader_();
  const props  = PropertiesService.getScriptProperties();

  const values = sh.getDataRange().getValues();
  const hasData = values.length > 1;

  let lastSync = props.getProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY);
  Logger.log(`🕒 Last sync: ${lastSync || '(none / full)'}`);

  // If first time → full export
  if (!lastSync || !hasData) {
    Logger.log('📄 Running FULL export of customers');
    return syncMagentoCustomersFull_();
  }

  // Næsti gluggi byrjar þegar ÞESSI sækir hefst (mínus mínúta fyrir klukkumun),
  // ekki þegar hann endar. Áður var stimpillinn settur eftir á, svo aðgangur sem
  // breyttist á meðan síðurnar voru sóttar lenti á milli glugga og sást aldrei.
  // Skörunin er hættulaus — raðir eru uppfærðar eftir ID.
  const nextSyncIso = new Date(Date.now() - 60 * 1000).toISOString();

  // Build ID → row index map
  const rowById = {};
  values.slice(1).forEach((row,i) => {
    const id = String(row[0]||'').trim();
    if (id) rowById[id] = i+2;
  });

  // Fetch changed customers
  const changed = fetchMagentoCustomers_(lastSync);
  if (!changed.length) {
    Logger.log('ℹ️ No customer changes since last sync');
    props.setProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY, nextSyncIso);
    return;
  }

  let newCount = 0;
  let updatedCount = 0;
  let lastRow = sh.getLastRow();

  changed.forEach(c => {
    const row = [
      c.id, c.name, c.email, c.group, c.phone, c.zip, c.country, c.region,
      c.created, c.updated, c.company_name, c.company_id, c.real_email,
      c.role, c.has_liquor, c.has_toxic, c.national_id
    ];

    const existingRow = rowById[c.id];
    if (existingRow) {
      sh.getRange(existingRow,1,1,header.length).setValues([row]);
      updatedCount++;
    } else {
      lastRow++;
      sh.getRange(lastRow,1,1,header.length).setValues([row]);
      newCount++;
    }
  });

  applyStylingTo("CUSTOMERS", {
    sortBy: "Updated At",
    zebra: false
  });

  props.setProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY, nextSyncIso);

  Logger.log(`✅ Customers synced. New: ${newCount}, Updated: ${updatedCount}`);
}


/************************************************************
 * Full export (manual or auto)
 ************************************************************/
function syncMagentoCustomersFull_() {
  const sh     = getMagentoCustomersSheet_();
  const header = ensureMagentoCustomersHeader_();
  const props  = PropertiesService.getScriptProperties();
  const nextSyncIso = new Date(Date.now() - 60 * 1000).toISOString(); // sjá syncMagentoCustomers

  // Clear all rows except header
  if (sh.getLastRow() > 1) {
    sh.getRange(2,1,sh.getLastRow()-1,header.length).clearContent();
  }

  const customers = fetchMagentoCustomers_(); // FULL export
  if (customers.length) {
    const body = customers.map(c => [
      c.id, c.name, c.email, c.group, c.phone, c.zip, c.country, c.region,
      c.created, c.updated, c.company_name, c.company_id, c.real_email,
      c.role, c.has_liquor, c.has_toxic, c.national_id
    ]);
    sh.getRange(2,1,body.length,header.length).setValues(body);
  }

  applyStylingTo("CUSTOMERS", {
  sortBy: "Updated At",
  zebra: true
});

  props.setProperty(MAGENTO_CUSTOMERS_LAST_SYNC_KEY, nextSyncIso);

  Logger.log(`✅ Full Magento customer export complete: ${customers.length} rows`);
}


/************************************************************
 * Lookup loader (used by NEWWEB)
 ************************************************************/
function loadCustomerLookup_() {
  const CONFIG = loadConfig_();
  const ssId   = CONFIG.SHEET_IDS.CUSTOMERS;
  const ss     = SpreadsheetApp.openById(ssId);
  const sh     = ss.getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  if (!sh) return { byId:{}, byEmail:{} };

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { byId:{}, byEmail:{} };

  const header = data[0];
  const rows   = data.slice(1);

  const idx = {};
  header.forEach((h,i)=>idx[h]=i);

  const byId    = {};
  const byEmail = {};

  rows.forEach(r => {
    const id    = String(r[idx['ID']]||'').trim();
    const email = String(r[idx['Email']]||'').toLowerCase().trim();

    if (!id && !email) return;

    const entry = {
      id         : id,
      email      : email,
      company_name: r[idx['Company Name']] || '',
      company_id  : r[idx['Company ID']]   || '',
      region      : r[idx['Region']]       || '',
      national_id : r[idx['National ID']]  || '',
      real_email  : r[idx['Real Email']]   || ''
    };

    if (id) byId[id] = entry;
    if (email) byEmail[email] = entry;
  });

  return { byId, byEmail };
}


/************************************************************
 * Cache-help email — customer lookup + send
 *
 * Looks a customer up in MAGENTO_CUSTOMERS by email / ID / name /
 * company, resolves their real contact address, and sends the
 * cache-clearing troubleshooting email (see generateCacheEmail_ /
 * buildCacheEmailHtml_ in email.js). Kept server-side in GAS so it
 * sends via GmailApp from vefur@storkaup.is — no browser endpoint.
 ************************************************************/

// Returns up to `limit` matches: { id, name, email, company } where email is
// the best contact address (real_email preferred over the Magento login email).
function findCustomersForCacheEmail_(term, limit) {
  const needle = String(term || '').toLowerCase().trim();
  if (!needle) return [];
  limit = limit || 15;

  const CONFIG = loadConfig_();
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_IDS.CUSTOMERS);
  const sh = ss.getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  if (!sh) return [];

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  const idx = {};
  data[0].forEach((h, i) => { idx[h] = i; });

  const out = [];
  for (let i = 1; i < data.length && out.length < limit; i++) {
    const r = data[i];
    const id      = String(r[idx['ID']]          || '').trim();
    const name    = String(r[idx['Name']]        || '').trim();
    const login   = String(r[idx['Email']]       || '').trim();
    const real    = String(r[idx['Real Email']]  || '').trim();
    const company = String(r[idx['Company Name']] || '').trim();
    const email   = real || login;          // prefer the real contact address
    if (!email) continue;                   // can't email without an address

    const hay = (id + ' ' + name + ' ' + login + ' ' + real + ' ' + company).toLowerCase();
    if (hay.indexOf(needle) === -1) continue;

    out.push({ id: id, name: name, email: email, company: company });
  }
  return out;
}

// First name for a friendlier greeting; falls back to company, then ''.
function cacheEmailGreetingName_(match) {
  const nm = String((match && match.name) || '').trim();
  if (nm) return nm.split(/\s+/)[0];
  return String((match && match.company) || '').trim();
}

// Lists every user (Magento account) under a dashboard customer_id. The dashboard
// customer_id is a kennitala (see customer_last_orders.sql). For a COMPANY customer
// that kennitala is the company's — which lives in the Company ID column, while each
// user row's National ID is that person's own kennitala. For an individual-in-business
// the customer_id IS their National ID. So we match against BOTH columns and return
// ALL matching users, letting support pick the actual person rather than guessing one.
// Returns [{ name, email }] de-duplicated by email (Real Email preferred over login).
function listCustomerUsersForCacheEmail_(customerId) {
  const norm = String(customerId || '').replace(/\D/g, '');
  if (!norm) return [];
  const famKey = norm.length > 10 ? norm.slice(0, 10) : norm;

  const CONFIG = loadConfig_();
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_IDS.CUSTOMERS);
  const sh = ss.getSheetByName(MAGENTO_CUSTOMERS_SHEET_NAME);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  const idx = {};
  data[0].forEach((h, i) => { idx[h] = i; });

  const matchesCustomer = function(rawId) {
    const v = String(rawId || '').replace(/\D/g, '');
    if (!v) return false;
    const k = v.length > 10 ? v.slice(0, 10) : v;
    return v === norm || k === famKey;
  };

  const seen = {};
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    // Company customer → matches via Company ID; individual → via National ID.
    if (!matchesCustomer(r[idx['Company ID']]) && !matchesCustomer(r[idx['National ID']])) continue;

    const login = String(r[idx['Email']] || '').trim();
    const real  = String(r[idx['Real Email']] || '').trim();
    const email = real || login;
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;

    out.push({ name: String(r[idx['Name']] || '').trim(), email: email });
  }
  return out;
}

// Generic "send a templated email to a customer" flow, driven by the registry in
// email.js (emailTemplates_). Pick template → find customer → pick user → language
// → confirm → send. Adding a template makes it appear here automatically.
function menu_sendTemplateEmail() {
  const ui = SpreadsheetApp.getUi();

  // 1) Pick template
  const templates = emailTemplateList_();
  if (!templates.length) { ui.alert('Engin template skilgreind.'); return; }
  let tmplMeta = templates[0];
  if (templates.length > 1) {
    const tlist = templates.map(function(t, i) {
      return (i + 1) + '. ' + t.label + ' (' + t.langs.join('/') + ')';
    }).join('\n');
    const tResp = ui.prompt('Veldu template', tlist + '\n\nSláðu inn númer (1–' + templates.length + '):', ui.ButtonSet.OK_CANCEL);
    if (tResp.getSelectedButton() !== ui.Button.OK) return;
    const tn = parseInt(String(tResp.getResponseText() || '').trim(), 10);
    if (!(tn >= 1 && tn <= templates.length)) { ui.alert('Ógilt númer.'); return; }
    tmplMeta = templates[tn - 1];
  }

  // 2) Find the customer
  const searchResp = ui.prompt(
    'Senda póst — finna viðskiptavin',
    'Leitaðu eftir netfangi, ID, nafni eða fyrirtæki:',
    ui.ButtonSet.OK_CANCEL
  );
  if (searchResp.getSelectedButton() !== ui.Button.OK) return;
  const term = String(searchResp.getResponseText() || '').trim();
  if (!term) { ui.alert('Engin leit slegin inn.'); return; }

  const matches = findCustomersForCacheEmail_(term, 15);
  if (!matches.length) { ui.alert('Enginn viðskiptavinur með netfang fannst fyrir „' + term + '“.'); return; }

  // 3) Pick one if several
  let chosen = matches[0];
  if (matches.length > 1) {
    const list = matches.map(function(m, i) {
      const who = (m.name || m.company || '(nafnlaus)') + ' — ' + m.email + (m.id ? ' [' + m.id + ']' : '');
      return (i + 1) + '. ' + who;
    }).join('\n');
    const pickResp = ui.prompt(
      matches.length + ' niðurstöður — veldu númer',
      list + '\n\nSláðu inn númer (1–' + matches.length + '):',
      ui.ButtonSet.OK_CANCEL
    );
    if (pickResp.getSelectedButton() !== ui.Button.OK) return;
    const n = parseInt(String(pickResp.getResponseText() || '').trim(), 10);
    if (!(n >= 1 && n <= matches.length)) { ui.alert('Ógilt númer.'); return; }
    chosen = matches[n - 1];
  }

  // 4) Language (constrained to the template's supported langs)
  let lang = tmplMeta.langs[0];
  if (tmplMeta.langs.length > 1) {
    const langResp = ui.prompt('Tungumál', 'Tungumál (' + tmplMeta.langs.join('/') + '):', ui.ButtonSet.OK_CANCEL);
    if (langResp.getSelectedButton() !== ui.Button.OK) return;
    const lreq = String(langResp.getResponseText() || tmplMeta.langs[0]).trim().toLowerCase();
    lang = tmplMeta.langs.indexOf(lreq) !== -1 ? lreq : tmplMeta.langs[0];
  }

  // 5) Build via registry, confirm, send
  const tmpl = emailTemplates_()[tmplMeta.id];
  const greetName = cacheEmailGreetingName_(chosen);
  const senderName = (tmpl.sender && tmpl.sender[lang]) || '';
  const built = tmpl.build(lang, { name: greetName, sender: senderName });

  const confirm = ui.alert(
    'Senda „' + tmplMeta.label + '“ á ' + (chosen.name || chosen.company || chosen.email) + '?',
    'Til: ' + chosen.email + '\nEfni: ' + built.subject + '\n\n' + built.plain,
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  GmailApp.sendEmail(chosen.email, built.subject, built.plain, {
    htmlBody: built.html,
    from: 'vefur@storkaup.is',
    name: 'Stórkaup ehf'
  });
  toast_('Póstur („' + tmplMeta.label + '“) sendur til ' + chosen.email, 'Email');
}


/************************************************************
 * Move completed applications from MAIN → LOKID
 * Moves rows whose email or kennitala belongs to a Magento account.
 *
 * Fyrst er borið saman við MAGENTO_CUSTOMERS-afritið, svo er Magento
 * spurt BEINT um þær umsóknir sem eftir standa. Afritið eitt dugði
 * ekki: umsóknir sátu fastar þótt aðgangurinn væri kominn í Magento.
 * Tvær ástæður fundust, og fleiri geta verið til:
 *   - Sheets geymir "0811902089" sem töluna 811902089, svo kennitala
 *     sem byrjar á 0 passaði aldrei (umsóknarblaðið geymir texta).
 *   - Afritið fær aðeins aðganga með updated_at eftir síðustu keyrslu;
 *     aðgangur sem það missir af sést aldrei aftur.
 * Beina spurningin kostar 1–4 köll og aðeins ef eitthvað stendur eftir.
 ************************************************************/
function pruneCompletedApplications() { return pruneCompletedApplications_(); }

// Kennitala í samanburðarhæft form: aðeins tölustafir, 10 stafir. Níu stafir =
// fremsta 0 týnd í Sheets (dagur 01–09). Annað er ekki kennitala.
function normKt_(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length !== 9 && d.length !== 10) return '';
  const kt = d.padStart(10, '0');
  return kt === '0000000000' ? '' : kt;
}

function normEmail_(v) {
  return String(v || '').toLowerCase().trim();
}

function addMagentoKeys_(keys, c) {
  [c.email, c.real_email].map(normEmail_).filter(Boolean).forEach(e => keys.emails.add(e));
  const nat = normKt_(c.national_id);
  const co  = normKt_(c.company_id);
  if (nat) keys.kts.add(nat);
  if (co)  keys.companyIds.add(co);
}

function magentoKeysFromSheet_() {
  const keys = { emails: new Set(), kts: new Set(), companyIds: new Set() };
  const sh = getMagentoCustomersSheet_();
  if (sh.getLastRow() < 2) return keys;
  sh.getRange(2, 1, sh.getLastRow() - 1, 17).getValues().forEach(r => addMagentoKeys_(keys, {
    email: r[2], real_email: r[12], company_id: r[11], national_id: r[16]
  }));
  return keys;
}

// Spyr Magento beint: eitt kall á hvern reit, hvert í sinni try svo að reitur
// sem Magento neitar að sía á (t.d. sérsniðinn attribute) felli ekki hina.
// Svarið er aðeins notað í gegnum sama samanburð og afritið, svo þó Magento
// hunsaði síuna og skilaði öðrum aðgöngum myndi ekkert færast að ósekju.
function fetchMagentoKeysLive_(emails, kts) {
  const keys = { emails: new Set(), kts: new Set(), companyIds: new Set() };
  // Lokað API → aðeins afritið í sheetinu gildir. Tóm lyklamengi færa ekkert
  // að ósekju; þau geta aðeins orðið til þess að umsókn bíði lengur.
  if (!isMagentoApiEnabled_()) return keys;
  const base = String(loadConfig_().ENDPOINTS.Magento.BASE_URL || '').replace(/\/$/, '');
  if (!base) return keys;

  // Magento geymir kennitölu sem streng og stundum með bandstriki.
  const ktValues = [];
  kts.forEach(kt => ktValues.push(kt, kt.slice(0, 6) + '-' + kt.slice(6)));

  const queries = [
    ['email', emails], ['real_email', emails],
    ['company_id', ktValues], ['national_id', ktValues]
  ];
  queries.forEach(([field, values]) => {
    if (!values.length) return;
    const url = `${base}/customers/search?` +
      `searchCriteria[filter_groups][0][filters][0][field]=${field}` +
      `&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(values.join(','))}` +
      `&searchCriteria[filter_groups][0][filters][0][condition_type]=in` +
      `&searchCriteria[pageSize]=100&searchCriteria[currentPage]=1`;
    try {
      const res = fetchMagentoWithRetry_(url, {
        method: 'get', headers: magentoHeaders_(), contentType: 'application/json',
        followRedirects: false, muteHttpExceptions: true
      });
      const items = (JSON.parse(res.getContentText()) || {}).items || [];
      items.map(mapMagentoCustomer_).forEach(c => addMagentoKeys_(keys, c));
    } catch (e) {
      Logger.log(`⚠️ fetchMagentoKeysLive_ (${field}): ${e && e.message || e}`);
    }
  });
  return keys;
}

function applicationMatchesMagento_(app, keys) {
  return (app.email     && keys.emails.has(app.email)) ||
         (app.kt        && keys.kts.has(app.kt)) ||
         (app.companyKt && keys.companyIds.has(app.companyKt));
}

function pruneCompletedApplications_() {
  const CONFIG = loadConfig_();
  const summary = { moved: [], pending: 0, liveChecked: 0 };

  const sources = typeof APP_SOURCES !== 'undefined' ? APP_SOURCES : [];
  if (!sources.length) { Logger.log('⚠️ pruneCompletedApplications_: APP_SOURCES not found'); return summary; }

  const findCol = (headers, name) => name
    ? headers.findIndex(h => h.toString().toLowerCase().trim() === name.toLowerCase().trim())
    : -1;

  // 1) Lesa allar biðraðir
  const work = [];
  sources.forEach(src => {
    const ssId = CONFIG.SHEET_IDS[src.key];
    if (!ssId) { Logger.log(`⚠️ pruneCompletedApplications_: vantar SHEET_IDS.${src.key}`); return; }

    const ss     = SpreadsheetApp.openById(ssId);
    const mainSh = ss.getSheetByName(src.mainTab || 'MAIN');
    if (!mainSh || mainSh.getLastRow() < 2) return;

    const lastCol = mainSh.getLastColumn();
    const headers = mainSh.getRange(1, 1, 1, lastCol).getValues()[0];
    const emailIdx     = findCol(headers, src.emailHeader);
    const ktIdx        = findCol(headers, src.ktHeader);
    const companyKtIdx = findCol(headers, src.companyKtHeader);
    const companyIdx   = findCol(headers, src.companyHeader);

    const apps = mainSh.getRange(2, 1, mainSh.getLastRow() - 1, lastCol).getValues().map((row, i) => ({
      rowNum:    i + 2,
      data:      row,
      email:     emailIdx     > -1 ? normEmail_(row[emailIdx])  : '',
      kt:        ktIdx        > -1 ? normKt_(row[ktIdx])        : '',
      companyKt: companyKtIdx > -1 ? normKt_(row[companyKtIdx]) : '',
      company:   companyIdx   > -1 ? String(row[companyIdx] || '').trim() : ''
    })).filter(a => a.email || a.kt || a.companyKt);

    work.push({ src, ss, mainSh, headers, lastCol, emailIdx, apps });
  });

  // 2) Afritið fyrst, svo Magento beint fyrir það sem eftir stendur
  const sheetKeys = magentoKeysFromSheet_();
  const all = [].concat(...work.map(w => w.apps));
  all.forEach(a => { a.done = applicationMatchesMagento_(a, sheetKeys); });

  const left = all.filter(a => !a.done);
  if (left.length) {
    const emails = [...new Set(left.map(a => a.email).filter(Boolean))];
    const kts    = [...new Set([].concat(...left.map(a => [a.kt, a.companyKt])).filter(Boolean))];
    const liveKeys = fetchMagentoKeysLive_(emails, kts);
    summary.liveChecked = left.length;
    left.forEach(a => {
      a.done = applicationMatchesMagento_(a, liveKeys);
      if (a.done) Logger.log(`ℹ️ ${a.company || a.email}: fannst í Magento en ekki í MAGENTO_CUSTOMERS-afritinu`);
    });
  }

  // 3) Færa í LOKID. Neðst upp, og hver röð lesin aftur rétt áður en henni er
  //    eytt: admin-appið er sér project og ScriptLock nær ekki yfir það, svo
  //    röðin gæti hafa færst síðan í skrefi 1.
  work.forEach(w => {
    const toMove = w.apps.filter(a => a.done).sort((a, b) => b.rowNum - a.rowNum);
    summary.pending += w.apps.length - toMove.length;
    if (!toMove.length) return;

    let doneSh = w.ss.getSheetByName('LOKID');
    if (!doneSh) doneSh = w.ss.insertSheet('LOKID');
    if (doneSh.getLastRow() === 0) {
      doneSh.getRange(1, 1, 1, w.headers.length).setValues([w.headers]).setFontWeight('bold');
      doneSh.setFrozenRows(1);
    }

    let moved = 0;
    toMove.forEach(a => {
      const now = w.mainSh.getRange(a.rowNum, 1, 1, w.lastCol).getValues()[0];
      if (w.emailIdx > -1 && normEmail_(now[w.emailIdx]) !== a.email) {
        Logger.log(`⚠️ ${w.src.label}: röð ${a.rowNum} breyttist á meðan — sleppt, næsta keyrsla tekur hana`);
        summary.pending++;
        return;
      }
      doneSh.appendRow(a.data);
      w.mainSh.deleteRow(a.rowNum);
      summary.moved.push(a.company || a.email);
      moved++;
    });

    Logger.log(`✅ ${w.src.label}: ${moved} rows moved to LOKID`);
  });

  Logger.log(`✅ pruneCompletedApplications_: ${JSON.stringify(summary)}`);
  return summary;
}

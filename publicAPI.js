/************************************************************
 * 📣 STORKAUP KPI CORE — OFFICIAL PUBLIC API (V2)
 ************************************************************/

/***********************
 * 🔧 CONFIG
 ***********************/
function loadConfig() {
  return loadConfig_();
}

var UI = {
  open: function() { throw new Error('Deprecated: Sheet UI search was removed. Use Webflow/Supabase frontend.'); },
  searchCustomers: function() { throw new Error('Deprecated: customer search API was removed. Use Webflow/Supabase frontend.'); },
  buildShoppingList: function() { throw new Error('Deprecated: sheet shopping list API was removed. Use Webflow/Supabase frontend.'); }
};

/***********************
 * 🔍 CUSTOMER SEARCH
 ***********************/
function searchCustomers(query, debug) {
  throw new Error('Deprecated: searchCustomers() was removed. Use Webflow/Supabase frontend.');
}


/***********************
 * 🛒 BUILD SHOPPING LIST
 ***********************/
function buildShoppingList(companyId, mode) {
  throw new Error('Deprecated: buildShoppingList() was removed. Use Webflow/Supabase frontend.');
}


/***********************
 * 👤 GET CUSTOMER PROFILE
 ***********************/
function getCustomerProfile(companyId, mode) {
  throw new Error('Deprecated: getCustomerProfile() was removed. Use Webflow/Supabase frontend.');
}


/***********************
 * 🧠 FUZZY HELPERS (optional)
 ***********************/
function similarityPublic(a, b) {
  return similarity_(a, b);
}

function extractRawDigitsPublic(s) {
  return extractRawDigits_(s);
}

function looksLikeKennitalaPublic(v) {
  return looksLikeKennitala_(v);
}

function resolveCompanyPublic(rawId, rawName, rawGroup, customerName) {
  const cfg = loadConfig_();
  const resolver = buildCompanyResolver_(cfg);
  return resolveCompanyInfo_(resolver, rawId, rawName, rawGroup, customerName);
}


/***********************
 * 📗 TABLE LOADERS (optional)
 ***********************/
function loadTablePublic(schemaKey) {
  return loadTableCached_(schemaKey);
}

function loadTableFullPublic(schemaKey) {
  return loadTableBySchemaFull_(schemaKey);
}

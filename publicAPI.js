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
  open: openCompanySearchUI,
  searchCustomers: searchCustomersUI,
  buildShoppingList: buildShoppingListUI
};

/***********************
 * 🔍 CUSTOMER SEARCH
 ***********************/
function searchCustomers(query, debug) {
  const cfg = loadConfig_();
  const res = searchCustomersV3_(query, cfg);

  if (debug) {
    Logger.log("🔍 DEBUG SEARCH INPUT: " + query);
    Logger.log("🔍 DEBUG RESULTS:\n" + JSON.stringify(res, null, 2));
  }
  return res;
}


/***********************
 * 🛒 BUILD SHOPPING LIST
 ***********************/
function buildShoppingList(companyId, mode) {
  const cfg = loadConfig_();
  return buildShoppingListForCompany_(companyId, mode, cfg);
}


/***********************
 * 👤 GET CUSTOMER PROFILE
 ***********************/
function getCustomerProfile(companyId, mode) {
  const cfg = loadConfig_();
  return buildCustomerProfileV3_(companyId, mode, cfg);
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

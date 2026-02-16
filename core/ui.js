function openCompanySearchUI() {
  const html = HtmlService.createHtmlOutputFromFile("core/uicompanySearch")
    .setTitle("Leita ad fyrirtaeki")
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

/***************************************************
 *  Wrapper functions sem UI kallar
 ***************************************************/
function searchCustomersUI(query) {
  const cfg = loadConfig_();
  return searchCustomersV3_(query, cfg);
}

// Legacy alias for older UI callers
function searchCustomersUI_(query) {
  return searchCustomersUI(query);
}

function buildShoppingListUI(companyId, mode) {
  const cfg = loadConfig_();
  return buildShoppingListForCompany_(companyId, mode, cfg);
}

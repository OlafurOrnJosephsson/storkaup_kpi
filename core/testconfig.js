function testConfig() {
  const cfg = loadConfig_();
  Logger.log(JSON.stringify(cfg, null, 2));
}
function debugMagento() {
  const cfg = loadConfig_();
  const url = cfg.ENDPOINTS.Magento.ORDERS +
    '?searchCriteria[pageSize]=5';

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + cfg.API.Magento.TOKEN
    },
    muteHttpExceptions: true
  });

  Logger.log('STATUS: ' + res.getResponseCode());
  Logger.log(res.getContentText());
}
function testMagentoOrders() {
  ensureValidMagentoToken_();
  const cfg = loadConfig_();
  const url = cfg.ENDPOINTS.Magento.ORDERS + '?searchCriteria[currentPage]=1';

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: magentoHeaders_(),
    muteHttpExceptions: true
  });

  Logger.log("CODE: " + res.getResponseCode());
  Logger.log(res.getContentText().slice(0, 500));
}
function testMagentoOrdersSafe() {
  ensureValidMagentoToken_();
  const cfg = loadConfig_();

  // Tryggja filter á dagsetningu (sækjum 20 nýjustu)
  const url = cfg.ENDPOINTS.Magento.ORDERS +
    '?searchCriteria[filter_groups][0][filters][0][field]=created_at' +
    '&searchCriteria[filter_groups][0][filters][0][value]=2025-07-15 00:00:00' +
    '&searchCriteria[filter_groups][0][filters][0][condition_type]=gt' +
    '&searchCriteria[currentPage]=1' +
    '&searchCriteria[pageSize]=20';

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: magentoHeaders_(),
    muteHttpExceptions: true
  });

  Logger.log('CODE: ' + res.getResponseCode());
  Logger.log(res.getContentText());
}
function resetNewwebToJul15() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('NEWWEB_lastCreatedAt', '2025-07-15 00:00:00');
  Logger.log('Checkpoint reset to 2025-07-15.');
}
function resetNewwebCheckpointDebug() {
  PropertiesService.getScriptProperties()
    .setProperty('NEWWEB_lastCreatedAt', '2025-07-15 00:00:00');
  Logger.log('Checkpoint reset!');
}
function debugMagentoRaw() {
  const CONFIG = loadConfig_();
  const token = CONFIG.API.Magento.TOKEN;

  const url = CONFIG.ENDPOINTS.Magento.BASE_URL +
    "/orders?searchCriteria[pageSize]=10";

  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  });

  Logger.log(res.getResponseCode());
  Logger.log(res.getContentText());
}

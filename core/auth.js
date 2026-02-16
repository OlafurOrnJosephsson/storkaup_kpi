/************************************************************
 * MAGENTO ADMIN AUTH — cached token
 * - Caches admin token in Script Properties with a conservative TTL
 * - Supports forced refresh after 401/403
 ************************************************************/

function clearMagentoAdminTokenCache_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('MAGENTO_ADMIN_TOKEN_CACHE');
  props.deleteProperty('MAGENTO_ADMIN_TOKEN_TS');
}

function getMagentoAdminToken_(opts) {
  opts = opts || {};
  const forceRefresh = !!opts.forceRefresh;

  const props  = PropertiesService.getScriptProperties();
  const cacheKey   = 'MAGENTO_ADMIN_TOKEN_CACHE';
  const cacheTsKey = 'MAGENTO_ADMIN_TOKEN_TS';
  const ttlMs = 3.5 * 60 * 60 * 1000; // 3h 30m (Magento tokens often expire ~4h)

  if (!forceRefresh) {
    const cached = props.getProperty(cacheKey);
    const cachedTs = Number(props.getProperty(cacheTsKey) || 0);
    if (cached && cachedTs && (Date.now() - cachedTs) < ttlMs) {
      return cached;
    }
  } else {
    clearMagentoAdminTokenCache_();
  }

  const CONFIG = loadConfig_();
  const username = props.getProperty('MAGENTO_ADMIN_USERNAME');
  const password = props.getProperty('MAGENTO_ADMIN_PASSWORD');

  if (!username || !password) {
    throw new Error("Missing Magento admin credentials in Script Properties");
  }

  const url = CONFIG.ENDPOINTS.Magento.BASE_URL.replace(/\/$/, '') + "/integration/admin/token";

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ username, password }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error("Magento token fetch failed: " + res.getContentText());
  }

  const token = res.getContentText().replace(/"/g, "");
  props.setProperty(cacheKey, token);
  props.setProperty(cacheTsKey, Date.now().toString());
  return token;
}

function magentoHeaders_(opts) {
  return {
    "Authorization": "Bearer " + getMagentoAdminToken_(opts),
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
}

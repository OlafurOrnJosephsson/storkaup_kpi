/************************************************************
 * 🌐 STORKAUP CONFIG CORE (v2 – MATCHES NEW CONFIG SHEET)
 ************************************************************/

const CONFIG_SPREADSHEET_ID = '1Df-0Kdo-Nont5fEONLgWxy9YWbcadG_LOOU2urzu2Bw';

/************************************************************
 * 🔧 PUBLIC API
 ************************************************************/
function loadConfig_() {
  
  const CACHE_KEY = 'STORKAUP_CONFIG_CACHE_V2';
  const CACHE_TS  = CACHE_KEY + '_TS';
  const TTL_MINUTES = 5;

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();

  const cached = props.getProperty(CACHE_KEY);
  const ts = Number(props.getProperty(CACHE_TS) || 0);

  if (cached && ts && now - ts < TTL_MINUTES * 60 * 1000) {
    try { return JSON.parse(cached); }
    catch (e) {
      Logger.log('⚠️ CONFIG cache skemmt, hleð upp á nýtt…');
    }
  }

  const ss = SpreadsheetApp.openById(CONFIG_SPREADSHEET_ID);

  const cfg = {
    SHEET_IDS : loadSheetIds_(ss),       // service → sheetId
    SHEETS    : loadSheetBindings_(ss),  // service → {id,name}
    API       : loadApiConfig_(ss),
    ENDPOINTS : loadEndpointsConfig_(ss),
    SETTINGS  : loadSettingsConfig_(ss)
  };

  resolveEndpointTemplates_(cfg);
  validateConfig_(cfg);

  props.setProperty(CACHE_KEY, JSON.stringify(cfg));
  props.setProperty(CACHE_TS, now.toString());

  return cfg;
}

function clearConfigCache() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('STORKAUP_CONFIG_CACHE_V2');
  props.deleteProperty('STORKAUP_CONFIG_CACHE_V2_TS');
  Logger.log("🧹 CONFIG cache cleared");
}

/************************************************************
 * 📄 LOADERS
 ************************************************************/

// Reads from: Service | Sheet Name | ID
function loadSheetIds_(ss) {
  const sh = ss.getSheetByName('SHEET_IDS');
  if (!sh) throw new Error("CONFIG ERROR: fann ekki SHEET_IDS");

  const vals = sh.getDataRange().getValues();
  const out = {};

  for (let r = 1; r < vals.length; r++) {
    const service   = String(vals[r][0] || '').trim();
    const sheetName = String(vals[r][1] || '').trim();
    const sheetId   = String(vals[r][2] || '').trim();
    if (!service || !sheetId) continue;
    out[service] = sheetId;
  }
  return out;
}

// Builds: SHEETS → service → { ID, NAME }
function loadSheetBindings_(ss) {
  const sh = ss.getSheetByName('SHEET_IDS');
  const vals = sh.getDataRange().getValues();

  const out = {};
  for (let r = 1; r < vals.length; r++) {
    const service   = String(vals[r][0] || '').trim();
    const sheetName = String(vals[r][1] || '').trim();
    const sheetId   = String(vals[r][2] || '').trim();
    if (!service || !sheetId) continue;

    out[service] = { ID: sheetId, NAME: sheetName };
  }
  return out;
}

function loadApiConfig_(ss) {
  const sh = ss.getSheetByName('API');
  const vals = sh.getDataRange().getValues();

  const out = {};
  for (let r = 1; r < vals.length; r++) {
    const service = String(vals[r][0] || '').trim();
    const key     = String(vals[r][1] || '').trim();
    const val     = String(vals[r][2] || '').trim();
    if (!service || !key) continue;

    if (!out[service]) out[service] = {};
    out[service][key] = val;
  }
  return out;
}

function loadEndpointsConfig_(ss) {
  const sh = ss.getSheetByName('ENDPOINTS');
  const vals = sh.getDataRange().getValues();

  const out = {};
  for (let r = 1; r < vals.length; r++) {
    const service = String(vals[r][0] || '').trim();
    const endpointKey = String(vals[r][1] || '').trim();
    const val = String(vals[r][2] || '').trim();

    if (!service || !endpointKey) continue;

    if (!out[service]) out[service] = {};
    out[service][endpointKey] = val;
  }
  return out;
}

function loadSettingsConfig_(ss) {
  const sh = ss.getSheetByName('SETTINGS');
  const vals = sh.getDataRange().getValues();
  const out = {};

  for (let r = 1; r < vals.length; r++) {
    const key = String(vals[r][0] || '').trim();
    let val   = vals[r][1];

    if (!key) continue;

    if (typeof val === "string") {
      const lo = val.toLowerCase();
      if (lo === "true") val = true;
      else if (lo === "false") val = false;
      else if (!isNaN(Number(val))) val = Number(val);
    }
    out[key] = val;
  }
  return out;
}

/************************************************************
 * 🧩 Placeholder template engine
 ************************************************************/
function resolveEndpointTemplates_(cfg) {
  const map = buildPlaceholderMap_(cfg);
  Object.keys(cfg.ENDPOINTS).forEach(service => {
    Object.keys(cfg.ENDPOINTS[service]).forEach(key => {
      const raw = cfg.ENDPOINTS[service][key];
      cfg.ENDPOINTS[service][key] =
        resolveTemplateString_(raw, map);
    });
  });
}

function buildPlaceholderMap_(obj) {
  const map = {};

  function walk(node) {
    if (node && typeof node === "object") {
      for (const k in node) {
        const val = node[k];
        if (val && typeof val === "object") walk(val);
        else map[k] = String(val);
      }
    }
  }
  walk(obj);
  return map;
}

function resolveTemplateString_(str, map) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (_, key) =>
    map[key.trim()] || `{{${key}}}`
  );
}

/************************************************************
 * 🛡 Validation – matches your exact setup ⭐
 ************************************************************/
function validateConfig_(cfg) {
  const required = [
    // Sheets
    'SHEET_IDS.WEBSALES',
    'SHEET_IDS.OLDWEB',
    'SHEET_IDS.BC_CUSTOMERS',
    'SHEET_IDS.BC_INVOICES',
    'SHEET_IDS.BC_LINES',

    'SHEET_IDS.PRODUCTS',
    'SHEET_IDS.CUSTOMERS',
    'SHEET_IDS.SALES_SUMMARIES',

    // API keys
    'API.Magento.TOKEN',
    'API.Cludo.API_KEY',
    'API.Cludo.SITE_KEY',
    'API.Cludo.CUSTOMER_ID',
    'API.Cludo.ENGINE_ID',
    'API.Cludo.HOST',

    // Endpoints
    'ENDPOINTS.Magento.BASE_URL',
    'ENDPOINTS.Magento.ORDERS',
    'ENDPOINTS.Magento.PRODUCTS',
    'ENDPOINTS.Magento.CATEGORIES',
    'ENDPOINTS.Cludo.SEARCH',

    // Settings
    'SETTINGS.NEWWEB_REFRESH_MIN',
    'SETTINGS.ENABLE_LOGGING'
  ];

  const missing = [];
  required.forEach(path => {
    const parts = path.split('.');
    let ref = cfg;

    for (const p of parts) {
      if (ref && p in ref) ref = ref[p];
      else { missing.push(path); break; }
    }
  });

  if (missing.length) {
    throw new Error(
      'CONFIG ERROR – Vantar eftirfarandi lykla í STORKAUP_CONFIG:\n' +
      missing.join('\n')
    );
  }
}
/**
 * PUBLIC API WRAPPER FOR LIBRARY USERS
 */
function loadConfig() {
  return loadConfig_();
}

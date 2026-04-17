/************************************************************
 * ðŸ“¦ StÃ³rkaup KPI CORE â€” utils.gs (V6 Enterprise)
 * ----------------------------------------------------------
 * - Universal loader (Schema + Config Driven)
 * - SKU + Category helpers
 * - Date helpers
 * - String helpers
 * - Sheet formatting
 * - Runtime cache
 * - Company resolver (BC + Magento)
 * - OLDWEB Company ID normalizer
 ************************************************************/

function normalizeHeaderKeyLocal_(s) {
  const str = String(s || '').trim().toLowerCase()
    // Icelandic chars need explicit transliteration before stripping non-ascii.
    .replace(/ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/ö/g, 'o')
    .replace(/Ã°/g, 'd')
    .replace(/Ã¾/g, 'th')
    .replace(/Ã¦/g, 'ae')
    .replace(/Ã¶/g, 'o');

  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}


/************************************************************
 * ðŸ§© loadTableBySchema_(schemaKey)
 * - Les gÃ¶gn Ãºt frÃ¡ STORKAUP_SCHEMA
 * - Skilar ALWAYS Array<Object> (lyklar = schema fields)
 * - NotaÃ° af Sales Summaries + fleiri mÃ³dÃºlum
 ************************************************************/
function loadTableBySchema_(schemaKey) {
  const schema = STORKAUP_SCHEMA[schemaKey];
  if (!schema) {
    throw new Error('Schema not found: ' + schemaKey);
  }

  // FILE = service key Ã­ CONFIG.SHEETS (t.d. "WEBSALES", "OLDWEB", "PRODUCTS")
  const cfg = loadConfig_();
  const fileKey = schema.FILE;          // t.d. 'WEBSALES' eÃ°a 'BC_SALES'
  const binding = cfg.SHEETS[fileKey];

  if (!binding) {
    throw new Error('CONFIG.SHEETS missing binding for: ' + fileKey);
  }

  const ss = SpreadsheetApp.openById(binding.ID);

  // Sum schema Ã¾urfa sÃ©r flipaname (t.d. "BÃ³kaÃ°ar sÃ¶lureikningslÃ­nur"), annars notum viÃ° FILE
  const sheetName = schema.SHEET || binding.NAME || fileKey;
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    const wanted = normalizeHeaderKeyLocal_(sheetName);
    sh = (ss.getSheets() || []).find(function(s) {
      return normalizeHeaderKeyLocal_(s.getName()) === wanted;
    }) || null;
  }
  if (!sh) {
    throw new Error('Sheet not found: ' + sheetName + ' (service ' + fileKey + ')');
  }

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(String);
  const colIndex = {};
  const colIndexNorm = {};
  header.forEach((name, i) => { colIndex[name] = i; });
  header.forEach((name, i) => {
    const n = normalizeHeaderKeyLocal_(name);
    if (n && !(n in colIndexNorm)) colIndexNorm[n] = i;
  });

  function resolveColIndex_(colName) {
    if (colName in colIndex) return colIndex[colName];
    const n = normalizeHeaderKeyLocal_(colName);
    if (n && n in colIndexNorm) return colIndexNorm[n];
    return -1;
  }

  const rows = [];

  for (let r = 1; r < values.length; r++) {
    const rowVals = values[r];
    const obj = {};

    // Fyrir hvert field Ã­ schema (nema FILE, PK, SHEET) nÃ¡um viÃ° viÃ°eigandi dÃ¡lk
    Object.keys(schema).forEach(key => {
      if (key === 'FILE' || key === 'PK' || key === 'SHEET') return;

      // SÃ©rmeÃ°ferÃ° fyrir nested COLUMNS object (t.d. BC_LINES.COLUMNS)
      if (key === 'COLUMNS' && schema.COLUMNS && typeof schema.COLUMNS === 'object') {
        Object.keys(schema.COLUMNS).forEach(subKey => {
          const colName = schema.COLUMNS[subKey];
          const idx = resolveColIndex_(colName);
          obj[subKey] = (idx != null && idx >= 0) ? rowVals[idx] : '';
        });
        return;
      }

      const colName = schema[key];
      const idx = resolveColIndex_(colName);

      obj[key] = (idx != null && idx >= 0) ? rowVals[idx] : '';
    });

    rows.push(obj);
  }

  return rows;
}


/************************************************************
 * ðŸ§© loadTableBySchemaFull_(schemaKey)
 * - Skilar { sheet, header, rows }
 * - rows = 2D array (Ã¡n header)
 * - NotaÃ° fyrir normalization / batch-writing
 ************************************************************/
function loadTableBySchemaFull_(schemaKey) {
  const schema = STORKAUP_SCHEMA[schemaKey];
  if (!schema) {
    throw new Error('Schema not found: ' + schemaKey);
  }

  const cfg = loadConfig_();
  const fileKey = schema.FILE;
  const binding = cfg.SHEETS[fileKey];

  if (!binding) {
    throw new Error('CONFIG.SHEETS missing binding for: ' + fileKey);
  }

  const ss = SpreadsheetApp.openById(binding.ID);
  const sheetName = schema.SHEET || binding.NAME || fileKey;
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    const wanted = normalizeHeaderKeyLocal_(sheetName);
    sh = (ss.getSheets() || []).find(function(s) {
      return normalizeHeaderKeyLocal_(s.getName()) === wanted;
    }) || null;
  }
  if (!sh) {
    throw new Error('Sheet not found: ' + sheetName + ' (service ' + fileKey + ')');
  }

  const values = sh.getDataRange().getValues();
  if (!values.length) {
    return { sheet: sh, header: [], rows: [] };
  }

  const header = values[0].map(String);
  const rows = values.slice(1);

  return { sheet: sh, header, rows };
}
/************************************************************
 * ðŸ§© Compatibility wrappers (legacy support)
 * - Eldri modules kalla loadTableBySchema() â†’ vÃ­saÃ° yfir Ã­ loadTableBySchema_()
 ************************************************************/
function loadTableBySchema(schemaKey) {
  return loadTableBySchema_(schemaKey);
}

function loadTableBySchemaFull(schemaKey) {
  return loadTableBySchemaFull_(schemaKey);
}

function applyDefaultFormatting_(sh, dateHeaderName) {
  applySheetStyling_(sh, {});

  if (!sh || !dateHeaderName) return;

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;

  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) {
    return String(v || '').trim();
  });
  var idx = header.indexOf(String(dateHeaderName).trim());
  if (idx === -1) return;

  sh.getRange(2, idx + 1, lastRow - 1, 1).setNumberFormat('yyyy-mm-dd');
}

/************************************************************
 * Cached loader to avoid repeated sheet reads in one execution
 ************************************************************/
function loadTableCached_(schemaKey) {
  const key = 'TABLE_' + schemaKey;
  const hit = cacheGet_(key);
  if (hit) return hit;
  const rows = loadTableBySchema_(schemaKey);
  return cacheSet_(key, rows);
}

/************************************************************
 * ðŸŽ¨ applySheetStyling_(sh, options)
 ************************************************************/
function applySheetStyling_(sh, options) {
  if (!sh) return;

  const opts = options || {};
  const sortBy = opts.sortBy || null;
  const zebra = opts.zebra || false;
  const headerBg = opts.headerBg || '#f5f5f5';
  const headerBold = opts.headerBold !== false;

  const range = sh.getDataRange();
  const vals = range.getValues();
  if (vals.length < 1) return;

  try { sh.setFrozenRows(1); } catch (_) {}
  try {
    const f = sh.getFilter();
    if (f) f.remove();
    range.createFilter();
  } catch (_) {}

  if (sortBy) {
    const headers = vals[0].map(String);
    const idx = headers.indexOf(sortBy);
    if (idx !== -1) {
      try { range.sort({ column: idx + 1, ascending: false }); } catch (_) {}
    }
  }

  try {
    for (let c = 1; c <= sh.getLastColumn(); c++) {
      sh.autoResizeColumn(c);
    }
  } catch (_) {}

  try {
    const headerRange = sh.getRange(1, 1, 1, sh.getLastColumn());
    headerRange.setBackground(headerBg);
    if (headerBold) headerRange.setFontWeight('bold');
  } catch (_) {}

  if (zebra && vals.length > 2) {
    for (let r = 2; r <= sh.getLastRow(); r++) {
      const bg = (r % 2 === 0) ? '#fafafa' : '#ffffff';
      sh.getRange(r, 1, 1, sh.getLastColumn()).setBackground(bg);
    }
  }
}


/************************************************************
 * ðŸ”— applyStylingTo(serviceKey)
 ************************************************************/
function applyStylingTo(serviceKey, options) {
  const cfg = loadConfig_();
  const svc = cfg.SHEETS[serviceKey];
  if (!svc) throw new Error(`Unknown service "${serviceKey}"`);

  const ss = SpreadsheetApp.openById(svc.ID);
  const sh = ss.getSheetByName(svc.NAME);
  if (!sh) return;

  applySheetStyling_(sh, options || {});
}


/************************************************************
 * ðŸ“š makeColumnMap_
 ************************************************************/
function makeColumnMap_(headers) {
  const map = {};
  headers.forEach((h, i) => map[h] = i);
  return map;
}


/************************************************************
 * ðŸ“… DATE HELPERS
 ************************************************************/
function toDate_(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  } catch (_) {
    return null;
  }
}

function parseDateSafe_(v) {
  return toDate_(v);
}

function formatDateYMD_(d) {
  if (!(d instanceof Date)) return '';
  return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
}

function formatDateDMY_(d) {
  if (!(d instanceof Date)) return '';
  return Utilities.formatDate(d, 'GMT', 'dd.MM.yyyy');
}


/************************************************************
 * ðŸ”¤ STRING HELPERS
 ************************************************************/
function cleanString_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Small alias til aÃ° vera backwards compatible (ef eitthvaÃ° kallar Ã¡ cleanString())
function cleanString(s) {
  return cleanString_(s);
}

function normalizeName_(s) {
  return cleanString_(s).toLowerCase();
}

function safeJsonParse_(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

/************************************************************
 * ðŸ§  NAME NORMALIZATION + FUZZY HELPERS
 ************************************************************/

function normalizeNameAdvanced_(s) {
  let out = cleanString_(s || '').toLowerCase();

  // Remove legal suffixes like ehf/hf/ohf etc.
  out = out.replace(/\b(ehf|hf|ohf|ltd|inc|corp|co|company)\.?/g, '');

  // Remove punctuation
  out = out.replace(/[.,]/g, ' ');

  // Normalize Icelandic letters to ASCII
  out = out
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00f0/g, 'd')  // eth -> d
    .replace(/\u00fe/g, 'th') // thorn -> th
    .replace(/\u00e6/g, 'ae') // ae ligature -> ae
    .replace(/\u00f6/g, 'o')  // o-umlaut -> o
    .replace(/\u00e1/g, 'a')  // a-acute -> a
    .replace(/\u00e9/g, 'e')  // e-acute -> e
    .replace(/\u00ed/g, 'i')  // i-acute -> i
    .replace(/\u00f3/g, 'o')  // o-acute -> o
    .replace(/\u00fa/g, 'u')  // u-acute -> u
    .replace(/\u00fd/g, 'y'); // y-acute -> y

  // Collapse whitespace
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

function tokenizeCompanyName_(s) {
  var base = normalizeNameAdvanced_(s || '');
  if (!base) return [];
  return base.split(' ').filter(function(t){ return t && t.length > 1; });
}

// LÃ©tt kennitÃ¶lutÃ©k â€“ leyfir lÃ­ka â€œundirkennitÃ¶lurâ€
function isLikelyKennitala_(v) {
  if (!v) return false;
  var s = String(v).replace(/\D/g, '');
  return s.length >= 7 && s.length <= 12;
}

/************************************************************
 * ðŸ§® LEVENSHTEIN + STRING SIMILARITY
 ************************************************************/
function levenshteinDistance_(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  a = String(a);
  b = String(b);

  var m = a.length;
  var n = b.length;
  var dp = [];

  for (var i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (var j = 1; j <= n; j++) {
    dp[0][j] = j;
  }

  for (var i2 = 1; i2 <= m; i2++) {
    for (var j2 = 1; j2 <= n; j2++) {
      var cost = a[i2 - 1] === b[j2 - 1] ? 0 : 1;
      dp[i2][j2] = Math.min(
        dp[i2 - 1][j2] + 1,         // delete
        dp[i2][j2 - 1] + 1,         // insert
        dp[i2 - 1][j2 - 1] + cost   // substitute
      );
    }
  }
  return dp[m][n];
}

function stringSimilarity_(a, b) {
  if (!a || !b) return 0;
  a = String(a);
  b = String(b);
  var maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  var dist = levenshteinDistance_(a, b);
  return 1 - dist / maxLen; // 0â€“1
}

/************************************************************
 * ðŸ”¢ NUMBERS
 ************************************************************/
function toNum_(v) {
  if (!v && v !== 0) return 0;
  if (typeof v === 'number') {
    return isNaN(v) ? 0 : v;
  }

  var s = String(v).trim();
  if (!s) return 0;

  s = s.replace(/\s+/g, '');
  s = s.replace(/[^0-9,.\-]/g, '');
  if (!s) return 0;

  var hasComma = s.indexOf(',') !== -1;
  var hasDot = s.indexOf('.') !== -1;

  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Icelandic/European style: 27.710,00 -> 27710.00
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // English style with thousands commas: 27,710.00 -> 27710.00
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    var commaParts = s.split(',');
    if (commaParts.length === 2 && commaParts[1].length <= 2) {
      s = commaParts[0].replace(/\./g, '') + '.' + commaParts[1];
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasDot) {
    var dotParts = s.split('.');
    if (dotParts.length > 2) {
      s = s.replace(/\./g, '');
    } else if (dotParts.length === 2 && dotParts[1].length === 3) {
      // Treat single dot with 3 trailing digits as thousands separator.
      s = dotParts[0] + dotParts[1];
    }
  }

  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

// Alias (ef eitthvaÃ° kallar Ã¡ toNum())
function toNum(v) {
  return toNum_(v);
}


/************************************************************
 * ðŸ” SKU HELPERS
 ************************************************************/
function normalizeSkuGlobal_(sku) {
  if (!sku) return '';
  sku = String(sku).trim();
  sku = sku.split(',')[0].trim();
  sku = sku.replace(/_[A-Za-z0-9]+$/i, '');
  sku = sku.replace(/[^0-9]/g, '');
  return sku;
}

function splitSkuList_(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map(s => normalizeSkuGlobal_(s))
    .filter(Boolean);
}

function extractBaseSku_(rawSku) {
  if (!rawSku) return "";
  return String(rawSku)
    .replace(/[_-](STK|KASSI|KS|KRT|BRETTI|BOX|PKG|UNIT|CTN)$/i, "")
    .trim();
}

function extractUom_(rawSku) {
  if (!rawSku) return "UNKNOWN";
  const m = String(rawSku).match(/(?:[_-])(STK|KASSI|KS|KRT|BRETTI|BOX|PKG|UNIT|CTN)$/i);
  return m ? m[1].toUpperCase() : "UNKNOWN";
}



/************************************************************
 * ðŸ—‚ RANGE HELPERS
 ************************************************************/
function clearSheetKeepHeader_(sh) {
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
}

function writeRows_(sh, rows, row, col) {
  if (!rows || !rows.length) return;
  sh.getRange(row, col, rows.length, rows[0].length).setValues(rows);
}


/************************************************************
 * ðŸ“ LOG HELPERS
 ************************************************************/
function log_(msg, obj) {
  if (obj !== undefined) Logger.log(msg + ' ' + JSON.stringify(obj, null, 2));
  else Logger.log(msg);
}


/************************************************************
 * âš¡ RUNTIME CACHE
 ************************************************************/
var RUNTIME_CACHE = {};

function cacheGet_(key) {
  return RUNTIME_CACHE[key];
}

function cacheSet_(key, value) {
  RUNTIME_CACHE[key] = value;
  return value;
}


/************************************************************
 * ðŸ§° loadSheetObjects_
 * - Les heilt sheet og skilar Array<Object> meÃ° raw header labels
 ************************************************************/
function loadSheetObjects_(ssId, sheetName) {
  if (!ssId) throw new Error("loadSheetObjects_: Missing ssId");
  if (!sheetName) throw new Error("loadSheetObjects_: Missing sheetName");

  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`loadSheetObjects_: Sheet not found: ${sheetName}`);

  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];

  const headers = vals[0].map(h => String(h).trim());

  return vals.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}


/************************************************************
 * (Legacy helper â€“ ef Ã¾Ãº vilt enn nota Ã¾etta annars staÃ°ar)
 ************************************************************/
function loadBcSalesCustomers_(cfg) {
  const binding = cfg.SHEETS['BC_SALES'];
  if (!binding) return [];

  const ss = SpreadsheetApp.openById(binding.ID);
  const sh = ss.getSheetByName('ViÃ°skiptamenn');
  if (!sh) return [];

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(String);
  const map = {};
  header.forEach((h,i) => map[h] = i);

  const out = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const id = cleanString_(row[map['Nr.']] || '');
    const name = cleanString_(row[map['Heiti']] || '');
    if (!id && !name) continue;

    out.push({
      id,
      name,
      phone: row[map['SÃ­mi']] || '',
      balance: row[map['Hreyfing (SGM)']] || '',
      lastModified: row[map['SÃ­Ã°ast breytt, dags.']] || ''
    });
  }
  return out;
}


/************************************************************
 * ðŸ§© COMPANY RESOLVER (v9)
 * - Sameinar BC_CUSTOMERS + MAGENTO_CUSTOMERS
 * - Primary key: Company ID (kennitala / nr.)
 * - Alias: normalizeNameAdvanced_(Company Name)
 * - BÃ¦tir viÃ° tokenIndex fyrir fuzzy leit
 ************************************************************/
function buildCompanyResolver_(cfg) {
  const cached = cacheGet_('RESOLVER_V1');
  if (cached) return cached;

  var bcMapById   = {};   // id -> entry
  var bcMapByName = {};   // normName -> entry
  var tokenIndex  = {};   // token -> Array<entry>

  function indexTokens_(entry) {
    if (!entry.normName) return;
    var tokens = tokenizeCompanyName_(entry.companyName);
    entry.tokens = tokens;
    tokens.forEach(function(t) {
      if (!tokenIndex[t]) tokenIndex[t] = [];
      tokenIndex[t].push(entry);
    });
  }

  function registerCompany_(source, rawId, rawName, region, realEmail) {
    var id   = String(rawId || '').trim();
    var name = cleanString_(rawName || '');
    if (!id && !name) return;

    var norm = normalizeNameAdvanced_(name);
    var existing = id ? bcMapById[id] : null;

    if (!existing) {
      existing = {
        companyId:   id || '',
        companyName: name || '',
        normName:    norm || '',
        region:      region || '',
        realEmail:   realEmail || '',
        source:      source
      };
      if (id) bcMapById[id] = existing;
      if (norm) {
        if (!bcMapByName[norm]) {
          bcMapByName[norm] = existing;
        } else {
          // BC fÃ¦r forgang ef conflict
          if (source === 'BC' && bcMapByName[norm].source !== 'BC') {
            bcMapByName[norm] = existing;
          }
        }
      }
      indexTokens_(existing);
    } else {
      // Merge inn Ã­ tilverandi entry
      if (name && !existing.companyName) existing.companyName = name;
      if (norm && !existing.normName)    existing.normName    = norm;
      if (region && !existing.region)    existing.region      = region;
      if (realEmail && !existing.realEmail) existing.realEmail = realEmail;
      if (existing.source.indexOf(source) === -1) {
        existing.source += '+' + source;
      }
    }
  }

  /***********************
   * 1) BC_CUSTOMERS (master)
   ***********************/
  try {
    var svcBC = cfg.SHEETS.BC_CUSTOMERS;
    if (svcBC) {
      var bcRows = loadSheetObjects_(svcBC.ID, svcBC.NAME); // 'ViÃ°skiptamenn'
      bcRows.forEach(function(r) {
        var id   = r['Nr.'];
        var name = r['Heiti'];
        registerCompany_('BC', id, name, '', '');
      });
      log_('ðŸ¢ buildCompanyResolver_: BC_CUSTOMERS loaded: ' + bcRows.length + ' rows');
    }
  } catch (e) {
    log_('âš ï¸ buildCompanyResolver_: Gat ekki hlaÃ°iÃ° BC_CUSTOMERS: ' + e);
  }

  /***********************
   * 1b) BC_SALES customers (legacy)
   ***********************/
  try {
    var svcBCSales = cfg.SHEETS.BC_SALES;
    if (svcBCSales) {
      var bcSalesRows = loadSheetObjects_(svcBCSales.ID, svcBCSales.NAME); // 'ViÃ°skiptamenn'
      bcSalesRows.forEach(function(r) {
        var id   = r['Nr.'];
        var name = r['Heiti'];
        registerCompany_('BC_SALES', id, name, '', '');
      });
      log_('ðŸ¢ buildCompanyResolver_: BC_SALES loaded: ' + bcSalesRows.length + ' rows');
    }
  } catch (e) {
    log_('âš ï¸ buildCompanyResolver_: Gat ekki hlaÃ°iÃ° BC_SALES: ' + e);
  }

  /***********************
   * 2) MAGENTO_CUSTOMERS (vefur)
   ***********************/
  try {
    var svcMC = cfg.SHEETS.CUSTOMERS;
    if (svcMC) {
      var mcRows = loadSheetObjects_(svcMC.ID, svcMC.NAME); // 'MAGENTO_CUSTOMERS'
      mcRows.forEach(function(r) {
        var id        = r['Company ID'];
        var name      = r['Company Name'] || r['Name'];
        var region    = r['Region'] || '';
        var realEmail = r['Real Email'] || r['Email'] || '';
        registerCompany_('MAGENTO', id, name, region, realEmail);
      });
      log_('ðŸ›’ buildCompanyResolver_: MAGENTO_CUSTOMERS loaded: ' + mcRows.length + ' rows');
    }
  } catch (e) {
    log_('âš ï¸ buildCompanyResolver_: Gat ekki hlaÃ°iÃ° CUSTOMERS (MAGENTO_CUSTOMERS): ' + e);
  }

  return cacheSet_('RESOLVER_V1', {
    bcMapById:   bcMapById,
    bcMapByName: bcMapByName,
    tokenIndex:  tokenIndex
  });
}

/************************************************************
 * ðŸ” fuzzy helper: leita aÃ° besta company Ãºt frÃ¡ nafni
 ************************************************************/
function fuzzyCompanyLookupByName_(resolver, rawName, threshold) {
  threshold = threshold || 0.88;
  if (!rawName) return null;

  var base = normalizeNameAdvanced_(rawName);
  if (!base) return null;

  var tokens = tokenizeCompanyName_(rawName);
  if (!tokens.length) return null;

  var tokenIndex = resolver.tokenIndex || {};
  var candidatesMap = {};
  var key;

  // Safna mÃ¶gulegum candidates Ãºt frÃ¡ tokenum
  tokens.forEach(function(t) {
    var list = tokenIndex[t];
    if (!list) return;
    list.forEach(function(entry) {
      key = entry.companyId + '|' + entry.companyName;
      if (!candidatesMap[key]) {
        candidatesMap[key] = entry;
      }
    });
  });

  var candidates = Object.keys(candidatesMap).map(function(k){ return candidatesMap[k]; });
  if (!candidates.length) return null;

  var best = null;
  var bestScore = 0;

  candidates.forEach(function(entry) {
    var ref = entry.normName || normalizeNameAdvanced_(entry.companyName);
    var score = stringSimilarity_(base, ref);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  });

  return (best && bestScore >= threshold) ? best : null;
}

/************************************************************
 * ðŸ” resolveCompanyInfo_ (v9)
 * - Same regla og Ã¡Ã°ur + fuzzy name match
 ************************************************************/
function resolveCompanyInfo_(resolver, rawId, rawName, rawGroup, customerName, allowFuzzy) {
  resolver = resolver || {};
  var bcMapById   = resolver.bcMapById   || {};
  var bcMapByName = resolver.bcMapByName || {};

  var idRaw  = String(rawId || '').trim();
  var group  = String(rawGroup || '').trim();
  var name   = cleanString_(rawName || '');
  var cust   = cleanString_(customerName || '');

  if (allowFuzzy === undefined || allowFuzzy === null) allowFuzzy = true;

  var best = null;

  // RULE 1 â€” Company ID (NEWWEB) ef til Ã­ master
  if (idRaw && bcMapById[idRaw]) {
    best = bcMapById[idRaw];
  }

  // RULE 2 â€” Customer Group (OLDWEB) ef lÃ­tur Ãºt eins og kennitala
  if (!best && group && isLikelyKennitala_(group) && bcMapById[group]) {
    best = bcMapById[group];
    if (!idRaw) idRaw = group;
  }

  // RULE 3 â€” Exact match Ã¡ Company Name
  if (!best && name) {
    var normName = normalizeNameAdvanced_(name);
    if (bcMapByName[normName]) {
      best = bcMapByName[normName];
    }
  }

  // RULE 4 â€” Exact match Ã¡ Customer Name
  if (!best && cust) {
    var normCust = normalizeNameAdvanced_(cust);
    if (bcMapByName[normCust]) {
      best = bcMapByName[normCust];
    }
  }

  // RULE 5 â€” Fuzzy match (Company Name fyrst, svo Customer Name)
  if (allowFuzzy) {
    if (!best && name) {
      best = fuzzyCompanyLookupByName_(resolver, name, 0.88);
    }
    if (!best && cust) {
      best = fuzzyCompanyLookupByName_(resolver, cust, 0.88);
    }
  }

  // RULE 6 â€” Fallback: notum bara order-gÃ¶gn (og mÃ¶gulegt group sem kt)
  if (!best) {
    // If we have a valid ID, keep it and don't override with fuzzy matches.
    var fallbackId = idRaw;
    if (!fallbackId && isLikelyKennitala_(group)) {
      fallbackId = group;
    }
    return {
      companyId:   fallbackId || '',
      companyName: name || cust || '',
      region:      '',
      realEmail:   ''
    };
  }

  // Final samsetning
  return {
    companyId:   best.companyId   || idRaw || '',
    companyName: best.companyName || name || cust || '',
    region:      best.region      || '',
    realEmail:   best.realEmail   || ''
  };
}


/************************************************************
 * ðŸ§® ID HELPERS
 ************************************************************/
function looksLikeKennitala_(v) {
  if (!v) return false;
  const s = String(v).replace(/\D/g, '');  // tÃ¶kum bara tÃ¶lur
  // Leyfum 7â€“12 stafi: 10 fyrir venjulega kt, 11â€“12 fyrir undirkennitÃ¶lur o.fl.
  return s.length >= 7 && s.length <= 12;
}

function extractRawDigits_(s) {
  if (!s) return "";
  return String(s).replace(/\D/g, "");
}

function similarity_(a, b) {
  if (!a || !b) return 0;
  let matches = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / Math.max(a.length, b.length);
}


/************************************************************
 * ðŸ”§ normalizeOldwebCompanyIds_
 * - Fyllir Ãºt/leiÃ°rÃ©ttir Company ID dÃ¡lk Ã­ OLDWEB
 * - Notar NÃJA buildCompanyResolver_ + resolveCompanyInfo_
 ************************************************************/
function normalizeOldwebCompanyIds() {
  Logger.log('ðŸ”§ normalizeOldwebCompanyIds_: startingâ€¦');

  var cfg = loadConfig_();
  var resolver = buildCompanyResolver_(cfg);

  var binding = cfg.SHEETS.OLDWEB;
  if (!binding) {
    throw new Error('CONFIG.SHEETS vantar OLDWEB binding');
  }

  var ss = SpreadsheetApp.openById(binding.ID);
  var sh = ss.getSheetByName(binding.NAME); // 'OLDWEB'
  if (!sh) {
    throw new Error('OLDWEB sheet not found: ' + binding.NAME);
  }

  var range = sh.getDataRange();
  var values = range.getValues();
  if (values.length < 2) {
    Logger.log('âš ï¸ OLDWEB hefur engar raÃ°ir');
    return { updated: 0, unresolvedCount: 0, unresolved: [] };
  }

  var header = values[0].map(String);
  var idxCID   = header.indexOf('Company ID');
  var idxCust  = header.indexOf('Customer Name');
  var idxComp  = header.indexOf('Company Name');
  var idxBill  = header.indexOf('Bill-to Name');
  var idxShip  = header.indexOf('Ship-to Name');
  var idxGroup = header.indexOf('Customer Group');

  if (idxCID === -1) throw new Error("âŒ OLDWEB vantar 'Company ID' dÃ¡lk!");
  if (idxCust === -1) throw new Error("âŒ OLDWEB vantar 'Customer Name' dÃ¡lk!");
  if (idxComp === -1) throw new Error("âŒ OLDWEB vantar 'Company Name' dÃ¡lk!");

  var updated = 0;
  var unresolved = [];
  var outCol = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var oldVal    = String(row[idxCID] || '').trim();
    var custName  = row[idxCust] || '';
    var compName  = row[idxComp] || '';
    var groupVal  = idxGroup !== -1 ? (row[idxGroup] || '') : '';

    // Gild Company ID (kennitala) â†’ sleppum
    if (oldVal && isLikelyKennitala_(oldVal)) {
      outCol.push([oldVal]);
      continue;
    }

    var info = resolveCompanyInfo_(
      resolver,
      null,          // OLDWEB hefur ekki companyId Ã­ sÃ©r dÃ¡lki (fyrir normalization)
      compName,
      groupVal,
      custName
    );

    if (info && info.companyId && isLikelyKennitala_(info.companyId)) {
      outCol.push([info.companyId]);
      updated++;
    } else {
      outCol.push([oldVal]); // viÃ°heldum gÃ¶mlu gildi
      unresolved.push({
        row: r + 1, // 1-based Ã­ Sheet
        companyName: compName,
        customerName: custName,
        oldValue: oldVal
      });
    }
  }

  // Skrifum bara Company ID dÃ¡lkinn aftur (hraÃ°virkt & safe)
  if (outCol.length) {
    sh.getRange(2, idxCID + 1, outCol.length, 1).setValues(outCol);
  }

  Logger.log('âœ… normalizeOldwebCompanyIds_: updated ' + updated + ' rows.');
  Logger.log('âš ï¸ unresolved: ' + unresolved.length);
  Logger.log(JSON.stringify(unresolved.slice(0, 50), null, 2));

  return {
    updated: updated,
    unresolvedCount: unresolved.length,
    unresolved: unresolved
  };
}

function testNormalizeOldweb() {
  var res = normalizeOldwebCompanyIds();
  Logger.log(res);
}

/************************************************************
 * ðŸ”§ normalizeOldwebCompanyIdsAndNames_
 * - Overwrites OLDWEB Company ID + Company Name when matched
 * - Uses BC_CUSTOMERS + BC_SALES + MAGENTO_CUSTOMERS resolver
 * - Matches by exact name or strong fuzzy; keeps original if no match
 ************************************************************/
function normalizeOldwebCompanyIdsAndNames() {
  Logger.log('ðŸ”§ normalizeOldwebCompanyIdsAndNames_: startingâ€¦');

  var cfg = loadConfig_();
  var resolver = buildCompanyResolver_(cfg);

  var binding = cfg.SHEETS.OLDWEB;
  if (!binding) throw new Error('CONFIG.SHEETS vantar OLDWEB binding');

  var ss = SpreadsheetApp.openById(binding.ID);
  var sh = ss.getSheetByName(binding.NAME);
  if (!sh) throw new Error('OLDWEB sheet not found: ' + binding.NAME);

  var range = sh.getDataRange();
  var values = range.getValues();
  if (values.length < 2) {
    Logger.log('âš ï¸ OLDWEB hefur engar raÃ°ir');
    return { updated: 0, unresolvedCount: 0, unresolved: [] };
  }

  var header = values[0].map(String);
  var idxCID   = header.indexOf('Company ID');
  var idxCust  = header.indexOf('Customer Name');
  var idxComp  = header.indexOf('Company Name');
  var idxBill  = header.indexOf('Bill-to Name');
  var idxShip  = header.indexOf('Ship-to Name');
  var idxGroup = header.indexOf('Customer Group');

  if (idxCID === -1) throw new Error("âŒ OLDWEB vantar 'Company ID' dÃ¡lk!");
  if (idxCust === -1) throw new Error("âŒ OLDWEB vantar 'Customer Name' dÃ¡lk!");
  if (idxComp === -1) throw new Error("âŒ OLDWEB vantar 'Company Name' dÃ¡lk!");

  var bcById = resolver.bcMapById || {};
  var bcByName = resolver.bcMapByName || {};

  var updated = 0;
  var unresolved = [];
  var outCID = [];
  var outComp = [];
  var report = [['Row', 'Old Company ID', 'Old Company Name', 'Customer Name', 'Suggested Company ID', 'Suggested Company Name', 'Match Type', 'Changed?']];
  var unresolvedReport = [['Row', 'Old Company ID', 'Old Company Name', 'Customer Name', 'Customer Group']];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var oldId   = String(row[idxCID] || '').trim();
    var custName = row[idxCust] || '';
    var compName = row[idxComp] || '';
    var billName = idxBill !== -1 ? (row[idxBill] || '') : '';
    var shipName = idxShip !== -1 ? (row[idxShip] || '') : '';
    var groupVal = idxGroup !== -1 ? (row[idxGroup] || '') : '';

    var oldIdNorm = oldId.replace(/\s+/g, '').toLowerCase();
    if (oldIdNorm.indexOf('customergroups') === 0) oldId = '';
    var compNorm = normalizeNameAdvanced_(compName || '');
    if (!compNorm || compNorm === 'storkaup' || compNorm === 'storkaup company') {
      compName = '';
    }

    var candidates = [compName, custName, billName, shipName].filter(function(v){ return v && String(v).trim(); });

    var match = null;
    var matchType = '';

    // 1) Keep valid ID if it exists in resolver
    if (oldId && isLikelyKennitala_(oldId) && bcById[oldId]) {
      match = bcById[oldId];
      matchType = 'ID';
    }

    // 2) Exact name match on any candidate
    if (!match && candidates.length) {
      for (var i = 0; i < candidates.length; i++) {
        var normName = normalizeNameAdvanced_(candidates[i]);
        if (bcByName[normName]) {
          match = bcByName[normName];
          matchType = (i === 0 ? 'CompanyName' : 'AltName');
          break;
        }
      }
    }

    // 3) Token containment match (handles "Tokyo ehf." vs "Tokyo veitingar ehf.")
    if (!match && candidates.length) {
      var tokenIndex = resolver.tokenIndex || {};
      for (var j = 0; j < candidates.length && !match; j++) {
        var cand = candidates[j];
        var tokens = tokenizeCompanyName_(cand);
        if (!tokens.length) continue;
        var list = tokenIndex[tokens[0]] || [];
        var best = null;
        var bestScore = 0;
        list.forEach(function(entry) {
          var ok = true;
          for (var k = 0; k < tokens.length; k++) {
            if (!entry.tokens || entry.tokens.indexOf(tokens[k]) === -1) { ok = false; break; }
          }
          if (!ok) return;
          var ref = entry.normName || normalizeNameAdvanced_(entry.companyName);
          var score = stringSimilarity_(normalizeNameAdvanced_(cand), ref);
          if (score > bestScore) { bestScore = score; best = entry; }
        });
        if (best && bestScore >= 0.85) {
          match = best;
          matchType = 'Token(0.85)';
        }
      }
    }

    // 4) Fuzzy match (strong threshold)
    if (!match && candidates.length) {
      var base = candidates[0];
      match = fuzzyCompanyLookupByName_(resolver, base, 0.88);
      if (match) matchType = 'Fuzzy(0.88)';
    }

    if (match && match.companyId && isLikelyKennitala_(match.companyId)) {
      var newId = match.companyId;
      var newName = match.companyName || compName || custName || '';
      outCID.push([newId]);
      outComp.push([newName]);
      var changed = (String(oldId || '') !== String(newId || '')) || (String(compName || '') !== String(newName || ''));
      if (changed) updated++;
      report.push([r + 1, oldId, compName, custName, newId, match.companyName || '', matchType, changed ? 'Y' : 'N']);
    } else {
      outCID.push([oldId]);
      outComp.push([compName]);
      unresolved.push({ row: r + 1, companyName: compName, customerName: custName, oldValue: oldId });
      unresolvedReport.push([r + 1, oldId, compName, custName, groupVal]);
    }
  }

  if (outCID.length) sh.getRange(2, idxCID + 1, outCID.length, 1).setValues(outCID);
  if (outComp.length) sh.getRange(2, idxComp + 1, outComp.length, 1).setValues(outComp);

  // Write report sheet
  var reportName = 'OLDWEB - ID Fix Report';
  var rep = ss.getSheetByName(reportName) || ss.insertSheet(reportName);
  rep.clear();
  rep.getRange(1, 1, report.length, report[0].length).setValues(report);
  rep.setFrozenRows(1);
  rep.autoResizeColumns(1, report[0].length);

  var unresolvedName = 'OLDWEB - ID Fix Unresolved';
  var repUn = ss.getSheetByName(unresolvedName) || ss.insertSheet(unresolvedName);
  repUn.clear();
  repUn.getRange(1, 1, unresolvedReport.length, unresolvedReport[0].length).setValues(unresolvedReport);
  repUn.setFrozenRows(1);
  repUn.autoResizeColumns(1, unresolvedReport[0].length);

  Logger.log('âœ… normalizeOldwebCompanyIdsAndNames_: updated ' + updated + ' rows.');
  Logger.log('âš ï¸ unresolved: ' + unresolved.length);

  return {
    updated: updated,
    unresolvedCount: unresolved.length,
    unresolved: unresolved
  };
}

// Backwards-compatible wrapper (older name with underscore)
function normalizeOldwebCompanyIdsAndNames_() {
  return normalizeOldwebCompanyIdsAndNames();
}

/************************************************************
 * SUPABASE MIGRATION: OLDWEB (one-time/backfill)
 ************************************************************/
function getSupabaseRestConfig_() {
  const cfg = loadConfig_();
  const baseUrlRaw = cfg.ENDPOINTS && cfg.ENDPOINTS.SUPABASE && cfg.ENDPOINTS.SUPABASE.REST_URL;
  const serviceRole = cfg.API && cfg.API.SUPABASE && cfg.API.SUPABASE.SERVICE_ROLE_KEY;
  const baseUrl = String(baseUrlRaw || '').replace(/\/$/, '');

  if (!baseUrl) {
    throw new Error('Supabase config missing ENDPOINTS.SUPABASE.REST_URL');
  }
  if (!serviceRole) {
    throw new Error('Supabase config missing API.SUPABASE.SERVICE_ROLE_KEY');
  }

  return { baseUrl: baseUrl, serviceRole: serviceRole };
}

function parseOldwebDateForSupabase_(raw) {
  var d = null;

  if (typeof parseOldwebDate_ === 'function') {
    d = parseOldwebDate_(raw);
    if (d && !isNaN(d.getTime())) return d.toISOString();
  }

  d = parseDateSafe_(raw);
  if (d && !isNaN(d.getTime())) return d.toISOString();

  d = new Date(raw);
  if (d && !isNaN(d.getTime())) return d.toISOString();

  return null;
}

function upsertOldwebRowsToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/oldweb_orders_raw?on_conflict=order_id';
  var payload = rows.map(function(r) {
    return {
      order_id: String(r.ID || ''),
      purchase_date: parseOldwebDateForSupabase_(r.DATE),
      customer_name: r.CUSTOMER_NAME || null,
      bill_to_name: r.BILL_TO || null,
      ship_to_name: r.SHIP_TO || null,
      company_name: r.COMPANY_NAME || null,
      company_id: r.COMPANY_ID || null,
      customer_email: r.CUSTOMER_EMAIL || null,
      subtotal_excl: toNum_(r.SUBTOTAL_EXCL),
      subtotal_incl: toNum_(r.SUBTOTAL_INCL),
      subtotal_base: toNum_(r.SUBTOTAL_BASE),
      shipping_amount: toNum_(r.SHIPPING),
      ls_order_id: r.LS_ORDER_ID || null,
      sku_list: r.SKU_LIST || null,
      product_name_list: r.NAME_LIST || null,
      qty_list: r.QTY_LIST || null,
      items_block: r.ITEMS_BLOCK || null,
      source: 'oldweb_backfill'
    };
  }).filter(function(x) { return x.order_id; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 500;
  var uploaded = 0;

  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('OLDWEB Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillOldwebToSupabase_v1() {
  var rows = loadTableBySchema_('OLDWEB') || [];
  if (!rows.length) {
    Logger.log('[OLDWEB][INFO] No OLDWEB rows found for backfill.');
    return { totalRows: 0, uploaded: 0 };
  }

  var batchSize = 2000;
  var uploaded = 0;

  for (var i = 0; i < rows.length; i += batchSize) {
    var batch = rows.slice(i, i + batchSize);
    var out = upsertOldwebRowsToSupabase_(batch);
    uploaded += out.uploaded || 0;
    Logger.log('[OLDWEB][INFO] Backfill batch uploaded: ' + uploaded + '/' + rows.length);
  }

  Logger.log('[OLDWEB][INFO] Backfill completed. Uploaded: ' + uploaded);
  return { totalRows: rows.length, uploaded: uploaded };
}

/************************************************************
 * SUPABASE MIGRATION: BC_INVOICES (one-time + repeatable)
 ************************************************************/
function parseBcDateForSupabase_(raw) {
  if (raw == null || raw === '') return null;

  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString();
  }

  if (typeof raw === 'number') {
    var epoch = new Date(Date.UTC(1899, 11, 30));
    var excelDate = new Date(epoch.getTime() + raw * 24 * 60 * 60 * 1000);
    return isNaN(excelDate.getTime()) ? null : excelDate.toISOString();
  }

  var s = String(raw || '').trim();
  if (!s) return null;

  // ISO-like first (safe and unambiguous)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    var isoDate = new Date(s);
    return isNaN(isoDate.getTime()) ? null : isoDate.toISOString();
  }

  // dd.mm.yyyy or dd-mm-yyyy (optionally with time)
  var mDot = s.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mDot) {
    var dd = Number(mDot[1]);
    var mm = Number(mDot[2]);
    var yyyy = Number(mDot[3]);
    var hh = Number(mDot[4] || 0);
    var mi = Number(mDot[5] || 0);
    var ss = Number(mDot[6] || 0);
    var dDot = new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss));
    return isNaN(dDot.getTime()) ? null : dDot.toISOString();
  }

  // Slash format: prefer Icelandic/European dd/mm/yyyy.
  var mSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (mSlash) {
    var a = Number(mSlash[1]);
    var b = Number(mSlash[2]);
    var y = Number(mSlash[3]);
    var h = Number(mSlash[4] || 0);
    var m = Number(mSlash[5] || 0);
    var sec = Number(mSlash[6] || 0);

    var day = a;
    var month = b;
    if (a <= 12 && b > 12) {
      // Clearly mm/dd/yyyy
      day = b;
      month = a;
    }
    // If both <= 12, keep dd/mm (intentional).

    var dSlash = new Date(Date.UTC(y, month - 1, day, h, m, sec));
    return isNaN(dSlash.getTime()) ? null : dSlash.toISOString();
  }

  var fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function parseIsoToDate_(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (!d || isNaN(d.getTime())) return null;
  return d;
}

function toIsoNow_() {
  return new Date().toISOString();
}

function getBcSyncState_() {
  var props = getScriptProperties_();
  return {
    invoicesWatermarkIso: props.getProperty('BC_INVOICES_LAST_SYNC_ISO') || '',
    invoicesRowCount: Number(props.getProperty('BC_INVOICES_LAST_ROW_COUNT') || 0) || 0,
    creditInvoicesWatermarkIso: props.getProperty('BC_CREDIT_INVOICES_LAST_SYNC_ISO') || '',
    linesWatermarkIso: props.getProperty('BC_LINES_LAST_SYNC_ISO') || '',
    linesRowCount: Number(props.getProperty('BC_LINES_LAST_ROW_COUNT') || 0) || 0,
    linesFullCursor: Number(props.getProperty('BC_LINES_FULL_CURSOR') || 0) || 0
  };
}

function setBcSyncState_(next) {
  var props = getScriptProperties_();
  if (next && Object.prototype.hasOwnProperty.call(next, 'invoicesWatermarkIso')) {
    props.setProperty('BC_INVOICES_LAST_SYNC_ISO', String(next.invoicesWatermarkIso || ''));
  }
  if (next && Object.prototype.hasOwnProperty.call(next, 'invoicesRowCount')) {
    props.setProperty('BC_INVOICES_LAST_ROW_COUNT', String(Number(next.invoicesRowCount || 0) || 0));
  }
  if (next && Object.prototype.hasOwnProperty.call(next, 'creditInvoicesWatermarkIso')) {
    props.setProperty('BC_CREDIT_INVOICES_LAST_SYNC_ISO', String(next.creditInvoicesWatermarkIso || ''));
  }
  if (next && Object.prototype.hasOwnProperty.call(next, 'linesWatermarkIso')) {
    props.setProperty('BC_LINES_LAST_SYNC_ISO', String(next.linesWatermarkIso || ''));
  }
  if (next && Object.prototype.hasOwnProperty.call(next, 'linesRowCount')) {
    props.setProperty('BC_LINES_LAST_ROW_COUNT', String(Number(next.linesRowCount || 0) || 0));
  }
  if (next && Object.prototype.hasOwnProperty.call(next, 'linesFullCursor')) {
    var cursor = Number(next.linesFullCursor || 0) || 0;
    props.setProperty('BC_LINES_FULL_CURSOR', String(cursor));
  }
}

function shouldIncludeByWatermark_(rowIso, watermarkIso, lookbackDays) {
  if (!watermarkIso) return true;

  var rowDate = parseIsoToDate_(rowIso);
  var watermarkDate = parseIsoToDate_(watermarkIso);
  if (!rowDate || !watermarkDate) return true;

  var lookback = Number(lookbackDays || 0);
  if (lookback > 0) {
    watermarkDate = new Date(watermarkDate.getTime() - (lookback * 24 * 60 * 60 * 1000));
  }
  return rowDate >= watermarkDate;
}

function getAppendedRowsSinceCount_(rows, previousRowCount) {
  var list = Array.isArray(rows) ? rows : [];
  var prev = Math.max(0, Number(previousRowCount || 0) || 0);
  if (prev <= 0 || prev >= list.length) return [];
  return list.slice(prev);
}

function dedupeRowsByKey_(rows, keyFn) {
  var list = Array.isArray(rows) ? rows : [];
  var out = [];
  var seen = {};

  list.forEach(function(row, idx) {
    var rawKey = keyFn ? keyFn(row, idx) : idx;
    var key = String(rawKey || '');
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(row);
  });

  return out;
}

function upsertBcInvoicesToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/bc_invoices_raw?on_conflict=document_no';
  var payload = rows.map(function(r) {
    var documentNo = String(r.DOCUMENT_NO || '').trim();
    return {
      document_no: documentNo,
      company_id: r.COMPANY_ID || null,
      external_doc_no: r.EXTERNAL_DOC_NO || null,
      company_name: r.COMPANY_NAME || null,
      currency: r.CURRENCY || null,
      due_date: parseBcDateForSupabase_(r.DUE_DATE),
      booking_date: parseBcDateForSupabase_(r.BOOKING_DATE) || parseBcDateForSupabase_(r.ORDER_DATE),
      order_date: parseBcDateForSupabase_(r.ORDER_DATE) || parseBcDateForSupabase_(r.BOOKING_DATE),
      email: r.EMAIL || null,
      amount_excl: toNum_(r.AMOUNT_EXCL),
      amount_incl: toNum_(r.AMOUNT_INCL),
      salesperson_code: r.SALESPERSON_CODE || null,
      remaining_amount: toNum_(r.REMAINING),
      location_code: r.LOCATION_CODE || null,
      printed: r.PRINTED || null,
      closed: r.CLOSED || null,
      canceled: r.CANCELED || null,
      corrective: r.CORRECTIVE || null,
      rsm_provider: r.RSM_PROVIDER || null,
      rsm_date: parseBcDateForSupabase_(r.RSM_DATE),
      source: 'bc_invoices_backfill'
    };
  }).filter(function(x) { return x.document_no; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 500;
  var uploaded = 0;

  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('BC_INVOICES Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillBcInvoicesToSupabase_v1(options) {
  var opts = options || {};
  var full = !!opts.full;
  var lookbackDays = Number(opts.lookbackDays != null ? opts.lookbackDays : 2);
  var state = getBcSyncState_();
  var previousIso = full ? '' : (state.invoicesWatermarkIso || '');
  var runStartedIso = toIsoNow_();

  var rows = loadTableBySchema_('BC_INVOICES') || [];
  if (!rows.length) {
    Logger.log('[BC_INVOICES][INFO] No rows found for backfill.');
    return { totalRows: 0, selectedRows: 0, uploaded: 0, mode: full ? 'full' : 'incremental' };
  }

  var selected = rows;
  if (!full) {
    var selectedByDate = rows.filter(function(r) {
      var rowIso = parseBcDateForSupabase_(r.BOOKING_DATE) || parseBcDateForSupabase_(r.ORDER_DATE);
      return shouldIncludeByWatermark_(rowIso, previousIso, lookbackDays);
    });
    var appendedRows = getAppendedRowsSinceCount_(rows, state.invoicesRowCount);
    selected = dedupeRowsByKey_(selectedByDate.concat(appendedRows), function(r) {
      return String(r && r.DOCUMENT_NO || '').trim();
    });
  }

  if (!selected.length) {
    Logger.log('[BC_INVOICES][INFO] No incremental rows to upload.');
    setBcSyncState_({ invoicesWatermarkIso: runStartedIso, invoicesRowCount: rows.length });
    return {
      totalRows: rows.length,
      selectedRows: 0,
      uploaded: 0,
      mode: full ? 'full' : 'incremental',
      previousIso: previousIso || '',
      nextIso: runStartedIso
    };
  }

  var batchSize = 2000;
  var uploaded = 0;

  for (var i = 0; i < selected.length; i += batchSize) {
    var batch = selected.slice(i, i + batchSize);
    var out = upsertBcInvoicesToSupabase_(batch);
    uploaded += out.uploaded || 0;
    Logger.log('[BC_INVOICES][INFO] Backfill batch uploaded: ' + uploaded + '/' + selected.length);
  }

  setBcSyncState_({ invoicesWatermarkIso: runStartedIso, invoicesRowCount: rows.length });
  Logger.log('[BC_INVOICES][INFO] Backfill completed. Uploaded: ' + uploaded);
  return {
    totalRows: rows.length,
    selectedRows: selected.length,
    uploaded: uploaded,
    mode: full ? 'full' : 'incremental',
    previousIso: previousIso || '',
    nextIso: runStartedIso
  };
}

function upsertBcCreditInvoicesToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/bc_credit_invoices_raw?on_conflict=document_no';
  var payload = rows.map(function(r) {
    var documentNo = String(r.DOCUMENT_NO || '').trim();
    return {
      document_no: documentNo,
      company_id: r.COMPANY_ID || null,
      external_doc_no: null,
      company_name: r.COMPANY_NAME || null,
      currency: r.CURRENCY || null,
      due_date: parseBcDateForSupabase_(r.DUE_DATE),
      booking_date: parseBcDateForSupabase_(r.BOOKING_DATE) || parseBcDateForSupabase_(r.DOCUMENT_DATE),
      order_date: parseBcDateForSupabase_(r.DOCUMENT_DATE) || parseBcDateForSupabase_(r.BOOKING_DATE),
      email: null,
      amount_excl: toNum_(r.AMOUNT_EXCL),
      amount_incl: toNum_(r.AMOUNT_INCL),
      salesperson_code: r.SALESPERSON_CODE || null,
      remaining_amount: toNum_(r.REMAINING),
      location_code: r.LOCATION_CODE || null,
      printed: r.PRINTED || null,
      closed: null,
      canceled: r.CANCELED || null,
      corrective: r.CORRECTIVE || null,
      rsm_provider: r.RSM_PROVIDER || null,
      rsm_date: parseBcDateForSupabase_(r.RSM_DATE),
      source: 'bc_credit_invoices_backfill'
    };
  }).filter(function(x) { return x.document_no; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 500;
  var uploaded = 0;

  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('BC_CREDIT_INVOICES Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillBcCreditInvoicesToSupabase_v1(options) {
  var opts = options || {};
  var full = !!opts.full;
  var lookbackDays = Number(opts.lookbackDays != null ? opts.lookbackDays : 2);
  var state = getBcSyncState_();
  var previousIso = full ? '' : (state.creditInvoicesWatermarkIso || state.invoicesWatermarkIso || '');
  var runStartedIso = toIsoNow_();

  var rows = loadTableBySchema_('BC_CREDIT_INVOICES') || [];
  if (!rows.length) {
    Logger.log('[BC_CREDIT_INVOICES][INFO] No rows found for backfill.');
    return { totalRows: 0, selectedRows: 0, uploaded: 0, mode: full ? 'full' : 'incremental' };
  }

  var selected = full ? rows : rows.filter(function(r) {
    var rowIso = parseBcDateForSupabase_(r.BOOKING_DATE) || parseBcDateForSupabase_(r.DOCUMENT_DATE);
    return shouldIncludeByWatermark_(rowIso, previousIso, lookbackDays);
  });

  if (!selected.length) {
    Logger.log('[BC_CREDIT_INVOICES][INFO] No incremental rows to upload.');
    setBcSyncState_({ creditInvoicesWatermarkIso: runStartedIso });
    return {
      totalRows: rows.length,
      selectedRows: 0,
      uploaded: 0,
      mode: full ? 'full' : 'incremental',
      previousIso: previousIso || '',
      nextIso: runStartedIso
    };
  }

  var batchSize = 2000;
  var uploaded = 0;

  for (var i = 0; i < selected.length; i += batchSize) {
    var batch = selected.slice(i, i + batchSize);
    var out = upsertBcCreditInvoicesToSupabase_(batch);
    uploaded += out.uploaded || 0;
    Logger.log('[BC_CREDIT_INVOICES][INFO] Backfill batch uploaded: ' + uploaded + '/' + selected.length);
  }

  setBcSyncState_({ creditInvoicesWatermarkIso: runStartedIso });
  Logger.log('[BC_CREDIT_INVOICES][INFO] Backfill completed. Uploaded: ' + uploaded);
  return {
    totalRows: rows.length,
    selectedRows: selected.length,
    uploaded: uploaded,
    mode: full ? 'full' : 'incremental',
    previousIso: previousIso || '',
    nextIso: runStartedIso
  };
}

/************************************************************
 * SUPABASE MIGRATION: BC_LINES (one-time + repeatable)
 ************************************************************/
function upsertBcLinesToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/bc_lines_raw?on_conflict=document_no,sku,product_name,qty,amount_excl';
  var payload = rows.map(function(r) {
    var documentNo = String(r.DOCUMENT_NO || '').trim();
    var sku = r.SKU != null ? String(r.SKU).trim() : '';
    return {
      document_no: documentNo,
      company_id: r.COMPANY_ID || null,
      line_type: r.TYPE || null,
      sku: sku || null,
      product_name: r.PRODUCT_NAME || null,
      qty: toNum_(r.QTY),
      uom: r.UOM || null,
      unit_price_excl: toNum_(r.UNIT_PRICE_EXCL),
      amount_excl: toNum_(r.AMOUNT_EXCL),
      discount_pct: toNum_(r.DISCOUNT),
      source: 'bc_lines_backfill'
    };
  }).filter(function(x) {
    return x.document_no && x.sku;
  });

  if (!payload.length) return { uploaded: 0 };

  // Deduplicate within the payload to avoid Postgres ON CONFLICT "affect row a second time".
  var dedupedMap = {};
  payload.forEach(function(p) {
    var key = [
      p.document_no || '',
      p.sku || '',
      p.product_name || '',
      String(p.qty || 0),
      String(p.amount_excl || 0)
    ].join('|');
    dedupedMap[key] = p;
  });
  payload = Object.keys(dedupedMap).map(function(k) { return dedupedMap[k]; });

  var chunkSize = 500;
  var uploaded = 0;

  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('BC_LINES Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillBcLinesToSupabase_v1(options) {
  var opts = options || {};
  var full = !!opts.full;
  var lookbackDays = Number(opts.lookbackDays != null ? opts.lookbackDays : 2);
  var maxRows = Number(opts.maxRows != null ? opts.maxRows : 0);
  if (maxRows < 0) maxRows = 0;
  var state = getBcSyncState_();
  var previousIso = full ? '' : (state.linesWatermarkIso || state.invoicesWatermarkIso || '');
  var runStartedIso = toIsoNow_();

  var rows = loadTableBySchema_('BC_LINES') || [];
  if (!rows.length) {
    Logger.log('[BC_LINES][INFO] No rows found for backfill.');
    return { totalRows: 0, selectedRows: 0, uploaded: 0, mode: full ? 'full' : 'incremental' };
  }

  var selected = rows;
  if (!full && previousIso) {
    var invoiceRows = loadTableBySchema_('BC_INVOICES') || [];
    var changedDocNos = {};
    invoiceRows.forEach(function(inv) {
      var rowIso = parseBcDateForSupabase_(inv.BOOKING_DATE) || parseBcDateForSupabase_(inv.ORDER_DATE);
      if (!shouldIncludeByWatermark_(rowIso, previousIso, lookbackDays)) return;
      var doc = String(inv.DOCUMENT_NO || '').trim();
      if (doc) changedDocNos[doc] = true;
    });

    var selectedByDoc = rows.filter(function(line) {
      var docNo = String(line.DOCUMENT_NO || '').trim();
      return !!changedDocNos[docNo];
    });
    var appendedRows = getAppendedRowsSinceCount_(rows, state.linesRowCount);
    selected = dedupeRowsByKey_(selectedByDoc.concat(appendedRows), function(line) {
      return [
        String(line && line.DOCUMENT_NO || '').trim(),
        String(line && line.SKU || '').trim(),
        String(line && line.PRODUCT_NAME || '').trim(),
        String(line && line.QTY || '').trim(),
        String(line && line.AMOUNT_EXCL || '').trim()
      ].join('|');
    });
  }

  var totalSelected = selected.length;
  var startIndex = 0;
  if (full) {
    startIndex = Math.max(0, Number(opts.startAt != null ? opts.startAt : state.linesFullCursor) || 0);
    if (startIndex > totalSelected) startIndex = totalSelected;
    if (maxRows > 0) {
      selected = selected.slice(startIndex, startIndex + maxRows);
    } else {
      selected = selected.slice(startIndex);
    }
  }

  if (!selected.length) {
    Logger.log('[BC_LINES][INFO] No incremental rows to upload.');
    setBcSyncState_({ linesWatermarkIso: runStartedIso, linesRowCount: rows.length });
    return {
      totalRows: rows.length,
      totalSelectedRows: totalSelected,
      selectedRows: 0,
      uploaded: 0,
      mode: full ? 'full' : 'incremental',
      previousIso: previousIso || '',
      nextIso: runStartedIso,
      startIndex: startIndex,
      nextCursor: full ? startIndex : 0
    };
  }

  var batchSize = 2500;
  var uploaded = 0;
  var processedRows = 0;

  for (var i = 0; i < selected.length; i += batchSize) {
    var batch = selected.slice(i, i + batchSize);
    var out = upsertBcLinesToSupabase_(batch);
    uploaded += out.uploaded || 0;
    processedRows += batch.length;
    Logger.log('[BC_LINES][INFO] Backfill batch uploaded: ' + uploaded + '/' + selected.length);
    if (full) {
      setBcSyncState_({ linesFullCursor: startIndex + processedRows });
    }
  }

  setBcSyncState_({
    linesWatermarkIso: runStartedIso,
    linesRowCount: rows.length,
    linesFullCursor: full ? (startIndex + selected.length) : state.linesFullCursor
  });
  if (full && (startIndex + selected.length) >= totalSelected) {
    setBcSyncState_({ linesFullCursor: 0 });
  }
  Logger.log('[BC_LINES][INFO] Backfill completed. Uploaded: ' + uploaded);
  return {
    totalRows: rows.length,
    totalSelectedRows: totalSelected,
    selectedRows: selected.length,
    uploaded: uploaded,
    mode: full ? 'full' : 'incremental',
    previousIso: previousIso || '',
    nextIso: runStartedIso,
    startIndex: startIndex,
    nextCursor: full ? (startIndex + selected.length) : 0
  };
}

function syncBcToSupabaseIncremental_v1(options) {
  var opts = options || {};
  var invoices = backfillBcInvoicesToSupabase_v1({
    full: !!opts.full,
    lookbackDays: opts.lookbackDays
  });
  var creditInvoices = backfillBcCreditInvoicesToSupabase_v1({
    full: !!opts.full,
    lookbackDays: opts.lookbackDays
  });
  var lines = backfillBcLinesToSupabase_v1({
    full: !!opts.full,
    lookbackDays: opts.lookbackDays
  });
  var customers = backfillBcCustomersToSupabase_v1();
  return {
    invoices: invoices,
    creditInvoices: creditInvoices,
    lines: lines,
    customers: customers
  };
}

function resetBcSupabaseSyncState_v1() {
  setBcSyncState_({
    invoicesWatermarkIso: '',
    invoicesRowCount: 0,
    creditInvoicesWatermarkIso: '',
    linesWatermarkIso: '',
    linesRowCount: 0,
    linesFullCursor: 0
  });
  return { ok: true };
}

// UI-friendly wrappers (Apps Script Run menu cannot pass function args)
function runBcLinesFullBackfill_v1() {
  return backfillBcLinesToSupabase_v1({ full: true, lookbackDays: 0 });
}

function runBcInvoicesFullBackfill_v1() {
  return backfillBcInvoicesToSupabase_v1({ full: true, lookbackDays: 0 });
}

function runBcCreditInvoicesFullBackfill_v1() {
  return backfillBcCreditInvoicesToSupabase_v1({ full: true, lookbackDays: 0 });
}

function runBcIncrementalSync_v1() {
  return syncBcToSupabaseIncremental_v1({ lookbackDays: 2 });
}

function runBcLinesFullBackfillChunk_v1() {
  // Safer for Apps Script URL Fetch quotas: process one chunked window per run.
  return backfillBcLinesToSupabase_v1({ full: true, lookbackDays: 0, maxRows: 50000 });
}

function resetBcLinesFullBackfillCursor_v1() {
  setBcSyncState_({ linesFullCursor: 0 });
  return { ok: true };
}

/************************************************************
 * SUPABASE MIGRATION: BC_CUSTOMERS
 ************************************************************/
function upsertBcCustomersToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/bc_customers_raw?on_conflict=company_id';
  var payload = rows.map(function(r) {
    return {
      company_id: String(r.COMPANY_ID || '').trim(),
      company_name: r.COMPANY_NAME || null,
      credit_limit: toNum_(r.CREDIT_LIMIT),
      phone: r.PHONE || null,
      balance: toNum_(r.BALANCE),
      payments: toNum_(r.PAYMENTS),
      sales: toNum_(r.SALES),
      modified_date: parseBcDateForSupabase_(r.MODIFIED_DATE),
      source: 'bc_customers_backfill'
    };
  }).filter(function(x) { return x.company_id; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 500;
  var uploaded = 0;
  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('BC_CUSTOMERS Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillBcCustomersToSupabase_v1() {
  var rows = loadTableBySchema_('BC_CUSTOMERS') || [];
  if (!rows.length) {
    Logger.log('[BC_CUSTOMERS][INFO] No rows found for backfill.');
    return { totalRows: 0, uploaded: 0 };
  }

  var out = upsertBcCustomersToSupabase_(rows);
  Logger.log('[BC_CUSTOMERS][INFO] Backfill completed. Uploaded: ' + out.uploaded);
  return { totalRows: rows.length, uploaded: out.uploaded || 0 };
}

/************************************************************
 * SUPABASE MIGRATION: MAGENTO CUSTOMERS
 ************************************************************/
function upsertMagentoCustomersToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/magento_customers_raw?on_conflict=customer_id';
  var payload = rows.map(function(r) {
    return {
      customer_id: String(r.ID || '').trim(),
      name: r.NAME || null,
      email: r.EMAIL || null,
      real_email: r.REAL_EMAIL || null,
      role: r.ROLE || null,
      company_name: r.COMPANY_NAME || null,
      company_id: r.COMPANY_ID || null,
      region: r.REGION || null,
      updated_at_source: parseBcDateForSupabase_(r.UPDATED),
      source: 'magento_customers_backfill'
    };
  }).filter(function(x) { return x.customer_id; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 500;
  var uploaded = 0;
  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('MAGENTO_CUSTOMERS Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillMagentoCustomersToSupabase_v1() {
  var rows = loadTableBySchema_('CUSTOMERS') || [];
  if (!rows.length) {
    Logger.log('[MAGENTO_CUSTOMERS][INFO] No rows found for backfill.');
    return { totalRows: 0, uploaded: 0 };
  }

  var out = upsertMagentoCustomersToSupabase_(rows);
  Logger.log('[MAGENTO_CUSTOMERS][INFO] Backfill completed. Uploaded: ' + out.uploaded);
  return { totalRows: rows.length, uploaded: out.uploaded || 0 };
}

function backfillMagentoCustomersToSupabaseIncremental_v1(sinceIso) {
  var rows = loadTableBySchema_('CUSTOMERS') || [];
  if (!rows.length) {
    Logger.log('[MAGENTO_CUSTOMERS][INFO] No rows found for incremental backfill.');
    return { totalRows: 0, filteredRows: 0, uploaded: 0, mode: 'incremental' };
  }

  var since = sinceIso ? new Date(sinceIso) : null;
  var hasValidSince = since && !isNaN(since.getTime());
  if (!hasValidSince) {
    Logger.log('[MAGENTO_CUSTOMERS][INFO] Invalid/missing sinceIso, falling back to full backfill.');
    var full = backfillMagentoCustomersToSupabase_v1();
    full.mode = 'full_fallback';
    return full;
  }

  var filtered = rows.filter(function(r) {
    var d = parseBcDateForSupabase_(r.UPDATED);
    if (!d) return false;
    var updated = new Date(d);
    if (isNaN(updated.getTime())) return false;
    return updated > since;
  });

  if (!filtered.length) {
    Logger.log('[MAGENTO_CUSTOMERS][INFO] Incremental backfill found no changed rows.');
    return { totalRows: rows.length, filteredRows: 0, uploaded: 0, mode: 'incremental' };
  }

  var out = upsertMagentoCustomersToSupabase_(filtered);
  Logger.log('[MAGENTO_CUSTOMERS][INFO] Incremental backfill completed. Uploaded: ' + out.uploaded);
  return {
    totalRows: rows.length,
    filteredRows: filtered.length,
    uploaded: out.uploaded || 0,
    mode: 'incremental'
  };
}

function normalizeSalesRepRefName_(value) {
  var base = normalizeNameAdvanced_(value || '');
  if (!base) return '';
  return String(base).replace(/[^a-z0-9]+/g, '');
}

function normalizeSalesRepRefEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeSalesRepLabelForRef_(value) {
  var norm = normalizeSalesRepRefName_(value || '');
  if (!norm) return false;
  if (norm.indexOf('veftest') !== -1 || norm.indexOf('test') !== -1) return false;
  return (
    norm.indexOf('solumadur') !== -1 ||
    norm.indexOf('salesman') !== -1 ||
    norm.indexOf('storkaup') !== -1
  );
}

function collectSalesRepsRefRows_() {
  var byName = {};
  var byEmail = {};
  var dropped = 0;

  function mergeNotes_(target, sourceTag, noteRaw) {
    var parts = [];
    if (target.notes) parts = String(target.notes).split(' | ').filter(function(x) { return x; });
    if (sourceTag) parts.push(String(sourceTag));
    if (noteRaw) {
      var note = String(noteRaw).trim();
      if (note) parts.push(note);
    }
    var seen = {};
    var unique = [];
    parts.forEach(function(p) {
      if (seen[p]) return;
      seen[p] = true;
      unique.push(p);
    });
    target.notes = unique.join(' | ');
  }

  function addRef_(nameRaw, emailRaw, sourceTag, noteRaw) {
    var nameNorm = normalizeSalesRepRefName_(nameRaw || '');
    var emailNorm = normalizeSalesRepRefEmail_(emailRaw || '');
    if (!nameNorm && !emailNorm) return;

    var rec = null;
    if (nameNorm && byName[nameNorm]) rec = byName[nameNorm];
    if (!rec && emailNorm && byEmail[emailNorm]) rec = byEmail[emailNorm];

    if (!rec) {
      rec = {
        name_norm: nameNorm,
        email_norm: emailNorm,
        active: true,
        notes: ''
      };
    } else {
      if (!rec.name_norm && nameNorm) rec.name_norm = nameNorm;
      if (!rec.email_norm && emailNorm) rec.email_norm = emailNorm;
      if (rec.name_norm && nameNorm && rec.name_norm !== nameNorm) dropped += 1;
      if (rec.email_norm && emailNorm && rec.email_norm !== emailNorm) dropped += 1;
    }

    mergeNotes_(rec, sourceTag, noteRaw);

    if (rec.name_norm) byName[rec.name_norm] = rec;
    if (rec.email_norm) byEmail[rec.email_norm] = rec;
  }

  var customerRows = loadTableBySchema_('CUSTOMERS') || [];
  customerRows.forEach(function(r) {
    if (!(looksLikeSalesRepLabelForRef_(r.ROLE) || looksLikeSalesRepLabelForRef_(r.NAME))) return;
    addRef_(r.NAME || '', r.REAL_EMAIL || r.EMAIL || '', 'CUSTOMERS', r.ROLE || '');
  });

  var webRows = loadTableBySchema_('NEWWEB') || [];
  webRows.forEach(function(r) {
    if (!looksLikeSalesRepLabelForRef_(r.CUSTOMER_NAME)) return;
    addRef_(r.CUSTOMER_NAME || '', r.REAL_EMAIL || '', 'NEWWEB', '');
  });

  var out = [];
  var seen = {};
  Object.keys(byName).forEach(function(k) {
    var rec = byName[k];
    if (!rec) return;
    var key = (rec.name_norm || '') + '|' + (rec.email_norm || '');
    if (seen[key]) return;
    seen[key] = true;
    out.push(rec);
  });
  Object.keys(byEmail).forEach(function(k) {
    var rec = byEmail[k];
    if (!rec) return;
    var key = (rec.name_norm || '') + '|' + (rec.email_norm || '');
    if (seen[key]) return;
    seen[key] = true;
    out.push(rec);
  });

  Logger.log('[SALES_REPS_REF][INFO] Candidates=' + out.length + ' dropped_conflicts=' + dropped);
  return out;
}

function replaceSalesRepsRefInSupabase_(rows) {
  var conf = getSupabaseRestConfig_();
  var endpointBase = conf.baseUrl + '/sales_reps_ref';

  var delRes = UrlFetchApp.fetch(endpointBase + '?id=gt.0', {
    method: 'delete',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'raw',
      'Accept-Profile': 'raw',
      Prefer: 'return=minimal'
    },
    muteHttpExceptions: true
  });
  var delCode = delRes.getResponseCode();
  if (delCode < 200 || delCode >= 300) {
    throw new Error('sales_reps_ref delete failed: ' + delCode + ' ' + delRes.getContentText());
  }

  if (!rows || !rows.length) return { uploaded: 0, replaced: true };

  var uploaded = 0;
  var chunkSize = 500;
  for (var i = 0; i < rows.length; i += chunkSize) {
    var chunk = rows.slice(i, i + chunkSize);
    var insRes = UrlFetchApp.fetch(endpointBase, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
    var insCode = insRes.getResponseCode();
    if (insCode < 200 || insCode >= 300) {
      throw new Error('sales_reps_ref insert failed: ' + insCode + ' ' + insRes.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded, replaced: true };
}

function syncSalesRepsRefToSupabase_v1() {
  var refs = collectSalesRepsRefRows_();
  var out = replaceSalesRepsRefInSupabase_(refs);
  Logger.log('[SALES_REPS_REF][INFO] Sync completed. Uploaded: ' + out.uploaded);
  return {
    totalCandidates: refs.length,
    uploaded: out.uploaded || 0,
    replaced: !!out.replaced
  };
}

function backfillSalesRepsRefToSupabase_v1() {
  return syncSalesRepsRefToSupabase_v1();
}

/************************************************************
 * SUPABASE MIGRATION: PRODUCTS
 ************************************************************/
function upsertProductsToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/products_raw?on_conflict=sku';
  var payload = rows.map(function(r) {
    return {
      sku: String(r.SKU || '').trim(),
      product_name: r.NAME || null,
      product_url: r.URL || null,
      category_path: r.CATEGORY_PATH || null,
      level1: r.LEVEL1 || null,
      level2: r.LEVEL2 || null,
      level3: r.LEVEL3 || null,
      source_timestamp: parseBcDateForSupabase_(r.TIMESTAMP),
      source: 'products_backfill'
    };
  }).filter(function(x) { return x.sku; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 200;
  var uploaded = 0;
  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var attempts = 3;
    var code = 0;
    var body = '';
    for (var attempt = 1; attempt <= attempts; attempt += 1) {
      var res = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: conf.serviceRole,
          Authorization: 'Bearer ' + conf.serviceRole,
          'Content-Profile': 'raw',
          'Accept-Profile': 'raw',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        payload: JSON.stringify(chunk),
        muteHttpExceptions: true
      });
      code = res.getResponseCode();
      body = res.getContentText() || '';
      if (code >= 200 && code < 300) break;

      var shouldRetry = attempt < attempts && isTransientSyncError_('PRODUCTS Supabase upsert failed: ' + code + ' ' + body);
      Logger.log(
        '[PRODUCTS][WARN] Upsert chunk ' + (Math.floor(i / chunkSize) + 1) +
        ' attempt ' + attempt + '/' + attempts +
        ' failed: ' + code + ' ' + body.slice(0, 300) +
        (shouldRetry ? ' (retrying)' : ' (no retry)')
      );
      if (!shouldRetry) {
        throw new Error('PRODUCTS Supabase upsert failed: ' + code + ' ' + body);
      }
      Utilities.sleep(4000 * attempt);
    }
    if (code < 200 || code >= 300) {
      throw new Error('PRODUCTS Supabase upsert failed: ' + code + ' ' + body);
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillProductsToSupabase_v1() {
  var rows = loadTableBySchema_('PRODUCTS') || [];
  if (!rows.length) {
    Logger.log('[PRODUCTS][INFO] No rows found for backfill.');
    return { totalRows: 0, uploaded: 0 };
  }

  var out = upsertProductsToSupabase_(rows);
  Logger.log('[PRODUCTS][INFO] Backfill completed. Uploaded: ' + out.uploaded);
  return { totalRows: rows.length, uploaded: out.uploaded || 0 };
}

/************************************************************
 * SUPABASE MIGRATION: CUSTOMER_ANALYSIS (Sales Summaries)
 ************************************************************/
function toBoolish_(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'ja';
}

function upsertCustomerAnalysisToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/customer_analysis_raw?on_conflict=customer_id';
  var nowIso = new Date().toISOString();

  var payload = rows.map(function(r) {
    var customerId = String(r.CUSTOMER_ID || '').trim();
    return {
      customer_id: customerId,
      customer_name: r.CUSTOMER_NAME || null,
      webshop_active: toBoolish_(r.WEBSHOP_ACTIVE),
      webshop_added_date: parseBcDateForSupabase_(r.WEBSHOP_ADDED_DATE),
      phone: r.PHONE || null,
      credit_limit: toNum_(r.CREDIT_LIMIT),
      primary_email: r.PRIMARY_EMAIL || null,

      lifetime_bc_sales: toNum_(r.LIFETIME_BC_SALES),
      total_bc_orders: toNum_(r.TOTAL_BC_ORDERS),
      average_bc_order_value: toNum_(r.AVG_BC_ORDER_VALUE),
      last_bc_order_date: parseBcDateForSupabase_(r.LAST_BC_ORDER_DATE),
      orders_bc_90d: toNum_(r.ORDERS_BC_90D),
      orders_bc_365d: toNum_(r.ORDERS_BC_365D),

      webshop_orders: toNum_(r.WEBSHOP_ORDERS),
      webshop_sales: toNum_(r.WEBSHOP_SALES),
      webshop_aov: toNum_(r.WEBSHOP_AOV),
      webshop_last_order: parseBcDateForSupabase_(r.WEBSHOP_LAST_ORDER),
      webshop_share_lifetime_pct: toNum_(r.WEBSHOP_SHARE_LIFETIME),

      total_value: toNum_(r.TOTAL_VALUE),
      total_orders: toNum_(r.TOTAL_ORDERS),
      frequency_score: toNum_(r.FREQUENCY_SCORE),
      recency_score: toNum_(r.RECENCY_SCORE),
      product_fit_score: toNum_(r.PRODUCT_FIT_SCORE),
      value_score: toNum_(r.VALUE_SCORE),
      readiness_score: toNum_(r.READINESS_SCORE),
      category_fit_score: toNum_(r.CATEGORY_FIT_SCORE),
      potential_score: toNum_(r.POTENTIAL_SCORE),
      low_hanging_fruit_score: toNum_(r.LOW_HANGING_FRUIT_SCORE),
      recommended_action: r.RECOMMENDED_ACTION || null,

      total_sku_count: toNum_(r.TOTAL_SKU_COUNT),
      top_products: r.TOP_PRODUCTS || null,
      cat_rekstrarvorur_pct: toNum_(r.CAT_REKSTRARVORUR),
      cat_heilbrigdisvorur_pct: toNum_(r.CAT_HEILBRIGDISVORUR),
      cat_matvorur_pct: toNum_(r.CAT_MATVORUR),
      cat_velar_taeki_pct: toNum_(r.CAT_VELAR_TAEKI),
      cat_afengi_pct: toNum_(r.CAT_AFENGI),
      primary_category: r.PRIMARY_CATEGORY || null,

      source: 'customer_analysis_backfill',
      snapshot_at: nowIso
    };
  }).filter(function(x) { return x.customer_id; });

  if (!payload.length) return { uploaded: 0 };

  var chunkSize = 250;
  var uploaded = 0;
  for (var i = 0; i < payload.length; i += chunkSize) {
    var chunk = payload.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('CUSTOMER_ANALYSIS Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function backfillCustomerAnalysisToSupabase_v1() {
  var rows = loadTableBySchema_('CUSTOMER_ANALYSIS') || [];
  if (!rows.length) {
    Logger.log('[CUSTOMER_ANALYSIS][INFO] No rows found for backfill.');
    return { totalRows: 0, uploaded: 0 };
  }

  var out = upsertCustomerAnalysisToSupabase_(rows);
  Logger.log('[CUSTOMER_ANALYSIS][INFO] Backfill completed. Uploaded: ' + out.uploaded);
  return { totalRows: rows.length, uploaded: out.uploaded || 0 };
}

function backfillReferenceDataToSupabase_v1() {
  var bc = backfillBcCustomersToSupabase_v1();
  var mc = backfillMagentoCustomersToSupabase_v1();
  var pr = backfillProductsToSupabase_v1();
  var ca = backfillCustomerAnalysisToSupabase_v1();
  return {
    bc_customers: bc,
    magento_customers: mc,
    products: pr,
    customer_analysis: ca
  };
}

/************************************************************
 * SCHEDULED REFERENCE SYNC (Magento customers + Cludo products)
 ************************************************************/
function getAlertRecipients_() {
  var cfg = null;
  try { cfg = loadConfig_(); } catch (_) {}

  var fromSettings = cfg && cfg.SETTINGS && cfg.SETTINGS.ALERT_EMAILS;
  var fromApi = cfg && cfg.API && cfg.API.ALERTS && cfg.API.ALERTS.EMAILS;
  var fromProps = PropertiesService.getScriptProperties().getProperty('ALERT_EMAILS');
  var raw = fromSettings || fromApi || fromProps || '';

  return String(raw)
    .split(/[;,]/)
    .map(function(s) { return String(s || '').trim(); })
    .filter(function(s) { return !!s; });
}

function shouldSendAlertNow_(dedupeKey, minIntervalMinutes) {
  var props = PropertiesService.getScriptProperties();
  var key = 'ALERT_LAST_SENT_' + String(dedupeKey || 'generic').replace(/[^A-Za-z0-9_]/g, '_');
  var now = Date.now();
  var minMs = Math.max(1, Number(minIntervalMinutes || 15)) * 60 * 1000;
  var last = Number(props.getProperty(key) || 0);
  if (last && (now - last) < minMs) return false;
  props.setProperty(key, String(now));
  return true;
}

function sendOpsAlert_(subject, body, dedupeKey, minIntervalMinutes) {
  var recipients = getAlertRecipients_();
  if (!recipients.length) {
    Logger.log('[ALERT][WARN] No ALERT_EMAILS configured; skipping alert: ' + subject);
    return { sent: false, reason: 'no_recipients' };
  }
  if (!shouldSendAlertNow_(dedupeKey || subject, minIntervalMinutes || 15)) {
    Logger.log('[ALERT][INFO] Suppressed duplicate alert: ' + subject);
    return { sent: false, reason: 'throttled' };
  }

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subject,
    body: body
  });
  Logger.log('[ALERT][INFO] Alert sent: ' + subject + ' to ' + recipients.join(','));
  return { sent: true, recipients: recipients.length };
}

function getAlertThrottleMinutes_(jobName, fallbackMinutes) {
  var props = PropertiesService.getScriptProperties();
  var globalRaw = props.getProperty('ALERT_MIN_INTERVAL_MINUTES');
  var globalMinutes = Number(globalRaw || fallbackMinutes || 15);
  if (!isFinite(globalMinutes) || globalMinutes <= 0) globalMinutes = Number(fallbackMinutes || 15) || 15;

  if (!jobName) return globalMinutes;

  var jobKey = String(jobName).replace(/[^A-Za-z0-9_]/g, '_');
  var perJobRaw = props.getProperty('ALERT_MIN_INTERVAL_MINUTES__' + jobKey);
  var perJobMinutes = Number(perJobRaw || '');
  if (isFinite(perJobMinutes) && perJobMinutes > 0) return perJobMinutes;

  return globalMinutes;
}

function isTransientSyncError_(errorObj) {
  var raw = String(
    (errorObj && (errorObj.message || errorObj.toString && errorObj.toString())) || errorObj || ''
  ).toLowerCase();

  if (!raw) return false;
  return (
    raw.indexOf('http 429') !== -1 ||
    raw.indexOf('http 500') !== -1 ||
    raw.indexOf('http 502') !== -1 ||
    raw.indexOf('http 503') !== -1 ||
    raw.indexOf('http 504') !== -1 ||
    raw.indexOf(' 429 ') !== -1 ||
    raw.indexOf(' 500 ') !== -1 ||
    raw.indexOf(' 502 ') !== -1 ||
    raw.indexOf(' 503 ') !== -1 ||
    raw.indexOf(' 504 ') !== -1 ||
    raw.indexOf('429 too many requests') !== -1 ||
    raw.indexOf('500 internal server error') !== -1 ||
    raw.indexOf('502 bad gateway') !== -1 ||
    raw.indexOf('503 service unavailable') !== -1 ||
    raw.indexOf('504 gateway timeout') !== -1 ||
    raw.indexOf('cloudflare') !== -1 ||
    raw.indexOf('timed out') !== -1 ||
    raw.indexOf('timeout') !== -1 ||
    raw.indexOf('service invoked too many times') !== -1 ||
    raw.indexOf('internal error') !== -1
  );
}

function runWithRetries_(label, fn, opts) {
  var options = opts || {};
  var attempts = Math.max(1, Number(options.attempts || 2));
  var delayMs = Math.max(0, Number(options.delayMs || 5000));
  var retryIf = typeof options.retryIf === 'function' ? options.retryIf : isTransientSyncError_;
  var lastErr = null;

  for (var i = 1; i <= attempts; i += 1) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      var shouldRetry = i < attempts && retryIf(e);
      Logger.log(
        '[RETRY][WARN] ' + label + ' attempt ' + i + '/' + attempts +
        ' failed: ' + (e && e.message ? e.message : e) +
        (shouldRetry ? ' (retrying)' : ' (no retry)')
      );
      if (!shouldRetry) break;
      Utilities.sleep(delayMs);
    }
  }

  throw lastErr || new Error(label + ' failed');
}

function notifyTriggerFailure_(jobName, errorObj, contextObj) {
  var name = String(jobName || 'unknown_job');
  var err = errorObj || {};
  var msg = err.message || String(err || '');
  var stack = err.stack || '';
  var when = new Date().toISOString();
  var body =
    'KPI trigger failure detected.\n\n' +
    'Job: ' + name + '\n' +
    'Time: ' + when + '\n' +
    'Message: ' + msg + '\n\n' +
    'Stack:\n' + stack + '\n\n' +
    'Context:\n' + JSON.stringify(contextObj || {}, null, 2);

  return sendOpsAlert_(
    '[KPI ALERT] Trigger failure: ' + name,
    body,
    name,
    getAlertThrottleMinutes_(name, 15)
  );
}

function startIngestionRun_(jobName, sourceName, details) {
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/ingestion_runs';
  var payload = {
    job_name: String(jobName || ''),
    source_name: String(sourceName || ''),
    status: 'running',
    started_at: new Date().toISOString(),
    details: details || null
  };

  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'raw',
      'Accept-Profile': 'raw',
      Prefer: 'return=representation'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('startIngestionRun_ failed: ' + code + ' ' + res.getContentText());
  }

  var body = JSON.parse(res.getContentText() || '[]');
  var row = body && body[0] ? body[0] : null;
  if (!row || !row.id) {
    throw new Error('startIngestionRun_ failed: no id returned');
  }
  return row.id;
}

function finishIngestionRun_(runId, status, rowsProcessed, details, errorMessage) {
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/ingestion_runs?id=eq.' + encodeURIComponent(runId);
  var payload = {
    ended_at: new Date().toISOString(),
    status: status || 'success',
    rows_processed: typeof rowsProcessed === 'number' ? rowsProcessed : null,
    details: details || null,
    error_message: errorMessage || null
  };

  var res = UrlFetchApp.fetch(endpoint, {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'raw',
      'Accept-Profile': 'raw',
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('finishIngestionRun_ failed: ' + code + ' ' + res.getContentText());
  }
}

function callSupabaseRpc_(rpcName, payloadObj) {
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/rpc/' + encodeURIComponent(String(rpcName || ''));
  var payload = payloadObj || {};

  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('RPC ' + rpcName + ' failed: ' + code + ' ' + body);
  }

  return body;
}

function bulkSetCustomerPriorityFlagsInSupabase_v1(customerIds, status, note) {
  var ids = [];
  if (Array.isArray(customerIds)) {
    ids = customerIds;
  } else if (customerIds !== null && customerIds !== undefined) {
    ids = String(customerIds).split(/[\s,;\n\r\t]+/);
  }

  var clean = ids.map(function(x) {
    return String(x || '').trim();
  }).filter(function(x) { return !!x; });

  var payload = {
    p_customer_ids: clean,
    p_status: String(status || 'priority').trim().toLowerCase(),
    p_note: note == null ? null : String(note)
  };

  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/rpc/bulk_set_customer_priority_flags';
  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'api',
      'Accept-Profile': 'api'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var raw = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('RPC bulk_set_customer_priority_flags failed: ' + code + ' ' + raw);
  }

  var parsed = safeJsonParse_(raw);
  var out = (parsed && typeof parsed === 'object') ? parsed : { ok: true };
  Logger.log('[PRIORITY_FLAGS][INFO] bulkSetCustomerPriorityFlagsInSupabase_v1 result: ' + JSON.stringify(out));
  return out;
}

function clearAllCustomerPriorityFlagsRawInSupabase_() {
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/customer_priority_flags_raw?customer_family_id=neq.__none__';
  var res = UrlFetchApp.fetch(endpoint, {
    method: 'delete',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'raw',
      'Accept-Profile': 'raw',
      Prefer: 'return=minimal'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('clear customer_priority_flags_raw failed: ' + code + ' ' + res.getContentText());
  }
  return true;
}

function readPriorityImportSheetRows_(sheetName) {
  var cfg = loadConfig_();
  var bcBinding = cfg && cfg.SHEETS ? cfg.SHEETS.BC_INVOICES : null;
  if (!bcBinding || !bcBinding.ID) {
    throw new Error('CONFIG ERROR: missing SHEET_IDS.BC_INVOICES');
  }

  var ss = SpreadsheetApp.openById(bcBinding.ID);
  var sh = ss.getSheetByName(String(sheetName || 'PRIORITY_IMPORT'));
  if (!sh) {
    throw new Error('Sheet not found: ' + String(sheetName || 'PRIORITY_IMPORT'));
  }

  var values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  var header = values[0].map(function(h) { return String(h || '').trim(); });
  var idxByNorm = {};
  for (var i = 0; i < header.length; i++) {
    var n = normalizeHeaderKeyLocal_(header[i]);
    if (n && !(n in idxByNorm)) idxByNorm[n] = i;
  }

  function getIdx_(names) {
    for (var k = 0; k < names.length; k++) {
      var n = normalizeHeaderKeyLocal_(names[k]);
      if (n in idxByNorm) return idxByNorm[n];
    }
    return -1;
  }

  var idIdx = getIdx_(['customer_id', 'customerid', 'kt', 'kennitala']);
  var nameIdx = getIdx_(['customer_name', 'customername', 'name', 'nafn']);
  if (idIdx < 0) {
    throw new Error('PRIORITY_IMPORT requires customer_id (or kt/kennitala) column');
  }

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rawId = String(row[idIdx] || '').trim();
    if (!rawId) continue;
    var rawName = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
    out.push({ customer_id: rawId, customer_name: rawName });
  }
  return out;
}

function importPriorityFlagsFromSheet_v1(options) {
  var opts = options || {};
  var sheetName = String(opts.sheetName || 'PRIORITY_IMPORT');
  var status = String(opts.status || 'priority').trim().toLowerCase();
  var replaceAll = opts.replaceAll !== false;
  var note = opts.note == null ? null : String(opts.note);
  var chunkSize = Math.max(100, Number(opts.chunkSize || 1000));

  var rows = readPriorityImportSheetRows_(sheetName);
  var ids = rows.map(function(r) { return String(r.customer_id || '').trim(); }).filter(function(x) { return !!x; });
  if (!ids.length) {
    Logger.log('[PRIORITY_FLAGS][INFO] importPriorityFlagsFromSheet_v1: no ids found.');
    return { ok: true, sheetName: sheetName, replaceAll: replaceAll, totalRows: 0, upserted: 0 };
  }

  if (replaceAll) {
    clearAllCustomerPriorityFlagsRawInSupabase_();
  }

  var upserted = 0;
  for (var i = 0; i < ids.length; i += chunkSize) {
    var chunk = ids.slice(i, i + chunkSize);
    var out = bulkSetCustomerPriorityFlagsInSupabase_v1(chunk, status, note);
    upserted += Number((out && out.upserted) || 0);
  }

  var result = {
    ok: true,
    sheetName: sheetName,
    replaceAll: replaceAll,
    status: status,
    totalRows: ids.length,
    upserted: upserted
  };
  Logger.log('[PRIORITY_FLAGS][INFO] importPriorityFlagsFromSheet_v1: ' + JSON.stringify(result));
  return result;
}

function supabaseRestGetJson_(pathWithQuery, profile) {
  var conf = getSupabaseRestConfig_();
  var path = String(pathWithQuery || '').replace(/^\/+/, '');
  var endpoint = conf.baseUrl + '/' + path;
  var headers = {
    apikey: conf.serviceRole,
    Authorization: 'Bearer ' + conf.serviceRole,
    accept: 'application/json'
  };
  if (profile) {
    headers['Accept-Profile'] = String(profile);
  }

  var res = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('REST GET failed (' + path + '): ' + code + ' ' + body);
  }

  var parsed = safeJsonParse_(body);
  if (parsed == null) {
    throw new Error('REST GET invalid JSON (' + path + '): ' + body);
  }
  return parsed;
}

function isoDateUtcDaysAgo_(days) {
  var d = new Date(Date.now() - (Number(days || 0) * 24 * 60 * 60 * 1000));
  return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
}

function parseDashboardCompatPayload_(rawText) {
  var data = safeJsonParse_(rawText || '');
  if (Array.isArray(data)) data = data[0];
  if (data && data.dashboard_compat) data = data.dashboard_compat;
  return data || null;
}

function runDailySanityChecks_v1() {
  var lock = null;
  var runId = null;
  var startedAt = new Date();
  var nowMs = startedAt.getTime();
  var result = {
    startedAt: startedAt.toISOString(),
    checks: [],
    failedCount: 0,
    warningCount: 0,
    passed: true,
    finishedAt: null
  };

  function addCheck_(name, passed, details, severity) {
    var level = severity || 'error';
    result.checks.push({
      name: String(name || 'unknown'),
      passed: !!passed,
      severity: level,
      details: details || ''
    });
    if (!passed) {
      if (level === 'warning') result.warningCount += 1;
      else result.failedCount += 1;
    }
  }

  function checkDashboardShares_() {
    try {
      var raw = callSupabaseRpc_('dashboard_compat', { p_month: null });
      var data = parseDashboardCompatPayload_(raw);
      if (!data || !data.month) {
        addCheck_('dashboard_compat_payload', false, 'Missing month payload from dashboard_compat RPC');
        return;
      }

      var month = data.month || {};
      var fields = ['webOrdersPct', 'webRevenuePct', 'salesRepPct', 'selfServePct'];
      var outOfRange = [];

      fields.forEach(function(k) {
        var v = Number(month[k]);
        if (!isFinite(v) || v < 0 || v > 1) {
          outOfRange.push(k + '=' + month[k]);
        }
      });

      addCheck_(
        'dashboard_share_bounds',
        outOfRange.length === 0,
        outOfRange.length ? ('Out of bounds: ' + outOfRange.join(', ')) : 'All dashboard share metrics in [0..1]'
      );
    } catch (e) {
      addCheck_('dashboard_share_bounds', false, String(e && e.message ? e.message : e));
    }
  }

  function checkIngestionRuns_() {
    var jobs = [
      'safePoll_v2',
      'scheduledMagentoSync_v1',
      'scheduledBcSync_v1',
      'scheduledCludoSync_v1',
      'scheduledCustomerAnalysisSync_v1',
      'scheduledKlaviyoSync_v1'
    ];
    var since24Iso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    var path = 'ingestion_runs?select=job_name,status,started_at,rows_processed'
      + '&job_name=in.(' + jobs.join(',') + ')'
      + '&started_at=gte.' + encodeURIComponent(since24Iso)
      + '&order=started_at.desc'
      + '&limit=500';

    try {
      var rows = supabaseRestGetJson_(path, 'raw');
      var list = Array.isArray(rows) ? rows : [];

      var errorRows = list.filter(function(r) { return String(r && r.status || '') === 'error'; });
      addCheck_(
        'ingestion_errors_24h',
        errorRows.length === 0,
        errorRows.length
          ? ('Error runs: ' + errorRows.slice(0, 8).map(function(r) { return r.job_name + '@' + r.started_at; }).join(', '))
          : 'No ingestion run errors in last 24h'
      );

      var expectedWindowsHours = {
        safePoll_v2: 4,
        scheduledMagentoSync_v1: 6,
        scheduledBcSync_v1: 36,
        scheduledCludoSync_v1: 24,
        scheduledCustomerAnalysisSync_v1: 36,
        scheduledKlaviyoSync_v1: 4
      };
      var stale = [];
      Object.keys(expectedWindowsHours).forEach(function(job) {
        var windowMs = expectedWindowsHours[job] * 60 * 60 * 1000;
        var cutoff = nowMs - windowMs;
        var hasRecentSuccess = list.some(function(r) {
          if (String(r && r.job_name || '') !== job) return false;
          if (String(r && r.status || '') !== 'success') return false;
          var t = Date.parse(String(r && r.started_at || ''));
          return isFinite(t) && t >= cutoff;
        });
        if (!hasRecentSuccess) stale.push(job + ' (> ' + expectedWindowsHours[job] + 'h)');
      });

      addCheck_(
        'ingestion_freshness',
        stale.length === 0,
        stale.length ? ('Missing recent success: ' + stale.join(', ')) : 'All key jobs have recent success'
      );
    } catch (e) {
      addCheck_('ingestion_checks', false, String(e && e.message ? e.message : e));
    }
  }

  function checkKlaviyoAttributionBound_() {
    var fromIso = isoDateUtcDaysAgo_(29);
    var toIso = isoDateUtcDaysAgo_(0);
    try {
      var klRows = supabaseRestGetJson_(
        'mv_klaviyo_attribution_daily_nobot?select=order_date,attributed_orders'
        + '&order_date=gte.' + fromIso
        + '&order_date=lte.' + toIso
        + '&limit=5000',
        'mart'
      );
      var webRows = supabaseRestGetJson_(
        'v_web_daily_unified?select=day,orders'
        + '&day=gte.' + fromIso
        + '&day=lte.' + toIso
        + '&limit=5000',
        'mart'
      );

      var klSum = (Array.isArray(klRows) ? klRows : []).reduce(function(sum, r) {
        return sum + toNum_(r && r.attributed_orders);
      }, 0);
      var webSum = (Array.isArray(webRows) ? webRows : []).reduce(function(sum, r) {
        return sum + toNum_(r && r.orders);
      }, 0);

      var ok = klSum <= webSum;
      addCheck_(
        'klaviyo_orders_le_web_orders_30d',
        ok,
        'klaviyo_orders_30d=' + klSum + ', web_orders_30d=' + webSum
      );
    } catch (e) {
      addCheck_('klaviyo_orders_le_web_orders_30d', false, String(e && e.message ? e.message : e));
    }
  }

  function checkBcSyncRowsWarning_() {
    var since48Iso = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();
    var path = 'ingestion_runs?select=job_name,status,started_at,rows_processed'
      + '&job_name=eq.scheduledBcSync_v1'
      + '&status=eq.success'
      + '&started_at=gte.' + encodeURIComponent(since48Iso)
      + '&order=started_at.desc'
      + '&limit=1';
    try {
      var rows = supabaseRestGetJson_(path, 'raw');
      var last = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!last) {
        addCheck_('bc_rows_processed_recent', false, 'No successful scheduledBcSync_v1 in last 48h', 'warning');
        return;
      }
      var rp = toNum_(last.rows_processed);
      addCheck_(
        'bc_rows_processed_recent',
        rp > 0,
        'last_rows_processed=' + rp + ', started_at=' + last.started_at,
        'warning'
      );
    } catch (e) {
      addCheck_('bc_rows_processed_recent', false, String(e && e.message ? e.message : e), 'warning');
    }
  }

  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      Logger.log('[SANITY][WARN] Skipping runDailySanityChecks_v1: another run is in progress.');
      return { skipped: true, reason: 'lock_not_acquired', startedAt: startedAt.toISOString() };
    }

    try {
      runId = startIngestionRun_('runDailySanityChecks_v1', 'sanity_checks', {
        trigger_type: 'time_based'
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[SANITY][WARN] Could not start ingestion run log: ' + logErr);
    }

    checkDashboardShares_();
    checkIngestionRuns_();
    checkKlaviyoAttributionBound_();
    checkBcSyncRowsWarning_();

    result.passed = result.failedCount === 0;
    result.finishedAt = new Date().toISOString();

    if (!result.passed) {
      var body =
        'Daily KPI sanity checks failed.\n\n' +
        'Started: ' + result.startedAt + '\n' +
        'Finished: ' + result.finishedAt + '\n' +
        'Failed checks: ' + result.failedCount + '\n' +
        'Warning checks: ' + result.warningCount + '\n\n' +
        result.checks.map(function(c) {
          return '[' + (c.passed ? 'PASS' : (c.severity === 'warning' ? 'WARN' : 'FAIL')) + '] ' + c.name + ' - ' + c.details;
        }).join('\n');

      sendOpsAlert_(
        '[KPI ALERT] Daily sanity checks failed',
        body,
        'runDailySanityChecks_v1',
        getAlertThrottleMinutes_('runDailySanityChecks_v1', 720)
      );
    }

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          result.passed ? 'success' : 'error',
          result.checks.length,
          result,
          result.passed ? null : 'One or more sanity checks failed'
        );
      } catch (logErr2) {
        Logger.log('[SANITY][WARN] Could not finish ingestion run log: ' + logErr2);
      }
    }

    Logger.log('[SANITY][INFO] runDailySanityChecks_v1 result: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.passed = false;
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    if (runId) {
      try {
        finishIngestionRun_(runId, 'error', result.checks.length, result, result.error.message);
      } catch (logErr3) {
        Logger.log('[SANITY][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('runDailySanityChecks_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[SANITY][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[SANITY][ERROR] runDailySanityChecks_v1 failed: ' + JSON.stringify(result));
    throw e;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function installDailySanityChecksTrigger_v1() {
  var fn = 'runDailySanityChecks_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[SANITY][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(40)
    .create();

  Logger.log('[SANITY][INFO] Created trigger for ' + fn + ' (every 1 day at ~07:40)');
  return { created: true, schedule: 'everyDays(1).atHour(7).nearMinute(40)' };
}

/**
 * Refreshes materialized marts used by Webflow product widgets.
 * Expected RPCs in Supabase:
 * - public.refresh_mv_top_products_30d()
 * - public.refresh_mv_top_products_all()
 */
function refreshSupabaseMarts_v1(options) {
  var opts = options || {};
  var strict = !!opts.strict;
  // Iceland is always UTC+0. Off-peak = before 07:00 or at/after 19:00.
  var utcHour = new Date().getUTCHours();
  var offPeak = utcHour < 7 || utcHour >= 19;
  var out = {
    top_products_30d: 'skipped',
    top_products_all: 'skipped',
    top_products_master: 'skipped',
    error: null
  };

  try {
    callSupabaseRpc_('refresh_mv_top_products_30d', {});
    out.top_products_30d = 'ok';
  } catch (e30) {
    out.top_products_30d = 'error';
    out.error = String(e30);
    Logger.log('[MART_REFRESH][WARN] refresh_mv_top_products_30d failed: ' + e30);
    if (strict) throw e30;
  }

  if (!offPeak) {
    out.top_products_all = 'skipped_peak_hours';
    out.top_products_master = 'skipped_peak_hours';
    Logger.log('[MART_REFRESH][INFO] Skipping heavy mart refreshes (peak hours, UTC ' + utcHour + ':xx)');
  } else {
    try {
      callSupabaseRpc_('refresh_mv_top_products_all', {});
      out.top_products_all = 'ok';
    } catch (eAll) {
      out.top_products_all = 'error';
      out.error = out.error || String(eAll);
      Logger.log('[MART_REFRESH][WARN] refresh_mv_top_products_all failed: ' + eAll);
      if (strict) throw eAll;
    }

    try {
      callSupabaseRpc_('refresh_mv_top_products_master', {});
      out.top_products_master = 'ok';
    } catch (eMaster) {
      out.top_products_master = 'error';
      out.error = out.error || String(eMaster);
      Logger.log('[MART_REFRESH][WARN] refresh_mv_top_products_master failed: ' + eMaster);
      if (strict) throw eMaster;
    }
  }

  Logger.log('[MART_REFRESH][INFO] refreshSupabaseMarts_v1 result: ' + JSON.stringify(out));
  return out;
}

function refreshKlaviyoAttributionMart_v1() {
  try {
    callSupabaseRpc_('refresh_mv_klaviyo_attribution_daily', {});
    Logger.log('[MART_REFRESH][INFO] refresh_mv_klaviyo_attribution_daily ok');
    return { klaviyo_attribution_daily: 'ok' };
  } catch (e) {
    Logger.log('[MART_REFRESH][WARN] refresh_mv_klaviyo_attribution_daily failed: ' + e);
    return { klaviyo_attribution_daily: 'error', error: String(e) };
  }
}

function scheduledReferenceSync_v1() {
  var startedAt = new Date();
  var runId = null;
  var previousMagentoSyncIso = PropertiesService.getScriptProperties().getProperty('MAGENTO_CUSTOMERS_LAST_SYNC');
  Logger.log('[REFSYNC][INFO] Started scheduledReferenceSync_v1 at ' + startedAt.toISOString());

  var result = {
    startedAt: startedAt.toISOString(),
    previousMagentoSyncIso: previousMagentoSyncIso || '',
    magentoSync: 'skipped',
    magentoBackfill: null,
    salesRepsSync: null,
    cludoSync: 'skipped',
    productsBackfill: null,
    customerAnalysisBackfill: null,
    martRefresh: null,
    finishedAt: null
  };

  try {
    try {
      runId = startIngestionRun_('scheduledReferenceSync_v1', 'reference_data', {
        trigger_type: 'time_based'
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[REFSYNC][WARN] Could not start ingestion run log: ' + logErr);
    }

    if (typeof syncMagentoCustomers === 'function') {
      runWithRetries_('syncMagentoCustomers', function() { syncMagentoCustomers(); }, { attempts: 2, delayMs: 7000 });
      result.magentoSync = 'ok';
    } else {
      result.magentoSync = 'missing_function';
    }

    if (typeof backfillMagentoCustomersToSupabaseIncremental_v1 === 'function') {
      result.magentoBackfill = runWithRetries_(
        'backfillMagentoCustomersToSupabaseIncremental_v1',
        function() { return backfillMagentoCustomersToSupabaseIncremental_v1(previousMagentoSyncIso); },
        { attempts: 2, delayMs: 7000 }
      );
    } else if (typeof backfillMagentoCustomersToSupabase_v1 === 'function') {
      result.magentoBackfill = runWithRetries_(
        'backfillMagentoCustomersToSupabase_v1',
        function() { return backfillMagentoCustomersToSupabase_v1(); },
        { attempts: 2, delayMs: 7000 }
      );
    }

    if (typeof syncSalesRepsRefToSupabase_v1 === 'function') {
      result.salesRepsSync = runWithRetries_(
        'syncSalesRepsRefToSupabase_v1',
        function() { return syncSalesRepsRefToSupabase_v1(); },
        { attempts: 2, delayMs: 7000 }
      );
    }

    if (typeof runCludoFullSync === 'function') {
      runWithRetries_('runCludoFullSync', function() { runCludoFullSync(); }, { attempts: 2, delayMs: 7000 });
      result.cludoSync = 'ok';
    } else if (typeof syncCludoToSalesSheets === 'function') {
      runWithRetries_('syncCludoToSalesSheets', function() { syncCludoToSalesSheets(); }, { attempts: 2, delayMs: 7000 });
      result.cludoSync = 'ok_fallback';
    } else {
      result.cludoSync = 'missing_function';
    }

    if (typeof backfillProductsToSupabase_v1 === 'function') {
      result.productsBackfill = runWithRetries_(
        'backfillProductsToSupabase_v1',
        function() { return backfillProductsToSupabase_v1(); },
        { attempts: 2, delayMs: 7000 }
      );
    }

    if (typeof backfillCustomerAnalysisToSupabase_v1 === 'function') {
      result.customerAnalysisBackfill = backfillCustomerAnalysisToSupabase_v1();
    }

    if (typeof refreshSupabaseMarts_v1 === 'function') {
      result.martRefresh = refreshSupabaseMarts_v1({ strict: false });
    }

    result.finishedAt = new Date().toISOString();

    var rowsProcessed =
      toNum_(result.magentoBackfill && result.magentoBackfill.uploaded) +
      toNum_(result.salesRepsSync && result.salesRepsSync.uploaded) +
      toNum_(result.productsBackfill && result.productsBackfill.uploaded) +
      toNum_(result.customerAnalysisBackfill && result.customerAnalysisBackfill.uploaded);

    if (runId) {
      try {
        finishIngestionRun_(runId, 'success', rowsProcessed, result, null);
      } catch (logErr2) {
        Logger.log('[REFSYNC][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[REFSYNC][INFO] Completed scheduledReferenceSync_v1: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    var rowsProcessedErr =
      toNum_(result.magentoBackfill && result.magentoBackfill.uploaded) +
      toNum_(result.salesRepsSync && result.salesRepsSync.uploaded) +
      toNum_(result.productsBackfill && result.productsBackfill.uploaded) +
      toNum_(result.customerAnalysisBackfill && result.customerAnalysisBackfill.uploaded);

    if (runId) {
      try {
        finishIngestionRun_(runId, 'error', rowsProcessedErr, result, result.error.message);
      } catch (logErr3) {
        Logger.log('[REFSYNC][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('scheduledReferenceSync_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[REFSYNC][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[REFSYNC][ERROR] scheduledReferenceSync_v1 failed: ' + JSON.stringify(result));
    throw e;
  }
}

function installScheduledReferenceSyncTrigger_v1() {
  var fn = 'scheduledReferenceSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });

  if (existing.length) {
    Logger.log('[REFSYNC][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyHours(6)
    .nearMinute(50)
    .create();

  Logger.log('[REFSYNC][INFO] Created trigger for ' + fn + ' (every 6 hours, near :50)');
  return { created: true, schedule: 'everyHours(6).nearMinute(50)' };
}

/************************************************************
 * SPLIT SCHEDULES: Magento-only and Cludo-only
 ************************************************************/
function scheduledMagentoSync_v1() {
  var lock = null;
  var startedAt = new Date();
  var runId = null;
  Logger.log('[MAGSYNC][INFO] Started scheduledMagentoSync_v1 at ' + startedAt.toISOString());

  var previousMagentoSyncIso = PropertiesService.getScriptProperties().getProperty('MAGENTO_CUSTOMERS_LAST_SYNC');
  var result = {
    startedAt: startedAt.toISOString(),
    previousMagentoSyncIso: previousMagentoSyncIso || '',
    magentoSync: 'skipped',
    magentoBackfill: null,
    salesRepsSync: null,
    finishedAt: null
  };

  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      Logger.log('[MAGSYNC][WARN] Skipping scheduledMagentoSync_v1: another run is in progress.');
      return { skipped: true, reason: 'lock_not_acquired', startedAt: startedAt.toISOString() };
    }

    try {
      runId = startIngestionRun_('scheduledMagentoSync_v1', 'magento_customers', {
        trigger_type: 'time_based'
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[MAGSYNC][WARN] Could not start ingestion run log: ' + logErr);
    }

    if (typeof syncMagentoCustomers === 'function') {
      syncMagentoCustomers();
      result.magentoSync = 'ok';
    } else {
      result.magentoSync = 'missing_function';
    }

    if (typeof backfillMagentoCustomersToSupabaseIncremental_v1 === 'function') {
      result.magentoBackfill = backfillMagentoCustomersToSupabaseIncremental_v1(previousMagentoSyncIso);
    } else if (typeof backfillMagentoCustomersToSupabase_v1 === 'function') {
      result.magentoBackfill = backfillMagentoCustomersToSupabase_v1();
    }

    if (typeof syncSalesRepsRefToSupabase_v1 === 'function') {
      result.salesRepsSync = syncSalesRepsRefToSupabase_v1();
    }

    result.finishedAt = new Date().toISOString();

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'success',
          toNum_(result.magentoBackfill && result.magentoBackfill.uploaded) +
            toNum_(result.salesRepsSync && result.salesRepsSync.uploaded),
          result,
          null
        );
      } catch (logErr2) {
        Logger.log('[MAGSYNC][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[MAGSYNC][INFO] Completed scheduledMagentoSync_v1: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'error',
          toNum_(result.magentoBackfill && result.magentoBackfill.uploaded) +
            toNum_(result.salesRepsSync && result.salesRepsSync.uploaded),
          result,
          result.error.message
        );
      } catch (logErr3) {
        Logger.log('[MAGSYNC][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('scheduledMagentoSync_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[MAGSYNC][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[MAGSYNC][ERROR] scheduledMagentoSync_v1 failed: ' + JSON.stringify(result));
    throw e;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function scheduledCludoSync_v1() {
  var lock = null;
  var startedAt = new Date();
  var runId = null;
  Logger.log('[CLUDOSYNC][INFO] Started scheduledCludoSync_v1 at ' + startedAt.toISOString());

  var result = {
    startedAt: startedAt.toISOString(),
    cludoSync: 'skipped',
    productsBackfill: null,
    martRefresh: null,
    finishedAt: null
  };

  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      Logger.log('[CLUDOSYNC][WARN] Skipping scheduledCludoSync_v1: another run is in progress.');
      return { skipped: true, reason: 'lock_not_acquired', startedAt: startedAt.toISOString() };
    }

    try {
      runId = startIngestionRun_('scheduledCludoSync_v1', 'products_cludo', {
        trigger_type: 'time_based'
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[CLUDOSYNC][WARN] Could not start ingestion run log: ' + logErr);
    }

    if (typeof runCludoFullSync === 'function') {
      runCludoFullSync();
      result.cludoSync = 'ok';
    } else if (typeof syncCludoToSalesSheets === 'function') {
      syncCludoToSalesSheets();
      result.cludoSync = 'ok_fallback';
    } else {
      result.cludoSync = 'missing_function';
    }

    if (typeof backfillProductsToSupabase_v1 === 'function') {
      result.productsBackfill = backfillProductsToSupabase_v1();
    }

    if (typeof refreshSupabaseMarts_v1 === 'function') {
      result.martRefresh = refreshSupabaseMarts_v1({ strict: false });
    }

    result.finishedAt = new Date().toISOString();

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'success',
          toNum_(result.productsBackfill && result.productsBackfill.uploaded),
          result,
          null
        );
      } catch (logErr2) {
        Logger.log('[CLUDOSYNC][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[CLUDOSYNC][INFO] Completed scheduledCludoSync_v1: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'error',
          toNum_(result.productsBackfill && result.productsBackfill.uploaded),
          result,
          result.error.message
        );
      } catch (logErr3) {
        Logger.log('[CLUDOSYNC][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('scheduledCludoSync_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[CLUDOSYNC][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[CLUDOSYNC][ERROR] scheduledCludoSync_v1 failed: ' + JSON.stringify(result));
    throw e;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function scheduledCustomerAnalysisSync_v1() {
  var lock = null;
  var startedAt = new Date();
  var runId = null;
  Logger.log('[CASYNC][INFO] Started scheduledCustomerAnalysisSync_v1 at ' + startedAt.toISOString());

  var result = {
    startedAt: startedAt.toISOString(),
    customerAnalysisBuild: 'skipped',
    customerAnalysisBackfill: null,
    finishedAt: null
  };

  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      Logger.log('[CASYNC][WARN] Skipping scheduledCustomerAnalysisSync_v1: another run is in progress.');
      return { skipped: true, reason: 'lock_not_acquired', startedAt: startedAt.toISOString() };
    }

    try {
      runId = startIngestionRun_('scheduledCustomerAnalysisSync_v1', 'customer_analysis', {
        trigger_type: 'time_based'
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[CASYNC][WARN] Could not start ingestion run log: ' + logErr);
    }

    if (typeof buildCustomerAnalysis === 'function') {
      runWithRetries_('buildCustomerAnalysis', function() { buildCustomerAnalysis(); }, { attempts: 2, delayMs: 7000 });
      result.customerAnalysisBuild = 'ok';
    } else {
      result.customerAnalysisBuild = 'missing_function';
    }

    if (typeof backfillCustomerAnalysisToSupabase_v1 === 'function') {
      result.customerAnalysisBackfill = runWithRetries_(
        'backfillCustomerAnalysisToSupabase_v1',
        function() { return backfillCustomerAnalysisToSupabase_v1(); },
        { attempts: 2, delayMs: 7000 }
      );
    }

    try {
      callSupabaseRpc_('refresh_mv_customer_profiles_labeled_trends', {});
      result.profilesMvRefresh = 'ok';
      Logger.log('[CASYNC][INFO] Refreshed mv_customer_profiles_labeled_trends');
    } catch (mvErr) {
      result.profilesMvRefresh = 'error';
      Logger.log('[CASYNC][WARN] mv_customer_profiles_labeled_trends refresh failed: ' + mvErr);
    }

    result.finishedAt = new Date().toISOString();

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'success',
          toNum_(result.customerAnalysisBackfill && result.customerAnalysisBackfill.uploaded),
          result,
          null
        );
      } catch (logErr2) {
        Logger.log('[CASYNC][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[CASYNC][INFO] Completed scheduledCustomerAnalysisSync_v1: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'error',
          toNum_(result.customerAnalysisBackfill && result.customerAnalysisBackfill.uploaded),
          result,
          result.error.message
        );
      } catch (logErr3) {
        Logger.log('[CASYNC][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('scheduledCustomerAnalysisSync_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[CASYNC][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[CASYNC][ERROR] scheduledCustomerAnalysisSync_v1 failed: ' + JSON.stringify(result));
    throw e;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function installScheduledMagentoSyncTrigger_v1() {
  var fn = 'scheduledMagentoSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[MAGSYNC][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyHours(1)
    .nearMinute(20)
    .create();

  Logger.log('[MAGSYNC][INFO] Created trigger for ' + fn + ' (every 1 hour, near :20)');
  return { created: true, schedule: 'everyHours(1).nearMinute(20)' };
}

function installScheduledCludoSyncTrigger_v1() {
  var fn = 'scheduledCludoSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[CLUDOSYNC][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyHours(12)
    .nearMinute(55)
    .create();

  Logger.log('[CLUDOSYNC][INFO] Created trigger for ' + fn + ' (every 12 hours, near :55)');
  return { created: true, schedule: 'everyHours(12).nearMinute(55)' };
}

function installScheduledCustomerAnalysisSyncTrigger_v1() {
  var fn = 'scheduledCustomerAnalysisSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[CASYNC][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .nearMinute(25)
    .create();

  Logger.log('[CASYNC][INFO] Created trigger for ' + fn + ' (every 1 day at ~05:25)');
  return { created: true, schedule: 'everyDays(1).atHour(5).nearMinute(25)' };
}

/************************************************************
 * KLAVIYO incremental sync (events -> Supabase raw)
 ************************************************************/
function getKlaviyoConfig_() {
  var cfg = loadConfig_();
  var api = cfg && cfg.API && cfg.API.Klaviyo ? cfg.API.Klaviyo : {};
  var key = api.PRIVATE_API_KEY || api.API_KEY || '';
  var baseUrl = String((cfg && cfg.ENDPOINTS && cfg.ENDPOINTS.Klaviyo && cfg.ENDPOINTS.Klaviyo.BASE_URL) || 'https://a.klaviyo.com/api').replace(/\/$/, '');
  var tz = String(api.TIMEZONE || 'UTC');

  if (!key) {
    throw new Error('Klaviyo config missing API.Klaviyo.PRIVATE_API_KEY');
  }
  return {
    apiKey: String(key).trim(),
    baseUrl: baseUrl,
    timezone: tz
  };
}

function klaviyoHeaders_(apiKey) {
  return {
    Authorization: 'Klaviyo-API-Key ' + String(apiKey || ''),
    accept: 'application/json',
    revision: '2024-02-15'
  };
}

function getKlaviyoCheckpoint_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('KLAVIYO_LAST_EVENT_TS') || '';
}

function setKlaviyoCheckpoint_(iso) {
  if (!iso) return;
  PropertiesService.getScriptProperties().setProperty('KLAVIYO_LAST_EVENT_TS', String(iso));
}

function toIsoUtc_(d) {
  if (!d) return '';
  var dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString();
}

function buildKlaviyoEventsUrl_(baseUrl, sinceIso, pageSize) {
  var since = toIsoUtc_(sinceIso) || toIsoUtc_(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  var size = Math.max(1, Math.min(100, Number(pageSize || 100)));
  return (
    baseUrl + '/events' +
    '?filter=' + encodeURIComponent('greater-than(datetime,' + since + ')') +
    '&include=' + encodeURIComponent('profile,metric') +
    '&sort=' + encodeURIComponent('datetime') +
    '&page[size]=' + encodeURIComponent(String(size))
  );
}

function fetchKlaviyoEventsPage_(url, apiKey) {
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: klaviyoHeaders_(apiKey),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Klaviyo events fetch failed: ' + code + ' ' + truncateText_(body, 500));
  }
  return JSON.parse(body || '{}');
}

function getObjPath_(obj, path) {
  if (!obj || !path) return null;
  var ref = obj;
  var parts = String(path).split('.');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!ref || typeof ref !== 'object' || !(p in ref)) return null;
    ref = ref[p];
  }
  return ref == null ? null : ref;
}

function pickFirstValue_(arr) {
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return null;
}

function truncateText_(raw, maxLen) {
  var s = String(raw || '');
  var n = Math.max(16, Number(maxLen || 300));
  return s.length > n ? (s.slice(0, n) + '...') : s;
}

function buildKlaviyoIncludedIndex_(payload) {
  var index = {
    profilesById: {},
    metricsById: {}
  };
  var included = payload && payload.included ? payload.included : [];
  if (!Array.isArray(included)) return index;

  for (var i = 0; i < included.length; i++) {
    var node = included[i] || {};
    var id = String(node.id || '').trim();
    var type = String(node.type || '').toLowerCase().trim();
    var attrs = node.attributes || {};
    if (!id) continue;

    if (type.indexOf('profile') >= 0) {
      var email = pickFirstValue_([
        attrs && attrs.email,
        getObjPath_(attrs, 'properties.$email'),
        getObjPath_(attrs, 'properties.email')
      ]);
      if (email) index.profilesById[id] = String(email).toLowerCase().trim();
    } else if (type.indexOf('metric') >= 0) {
      var metricName = pickFirstValue_([
        attrs && attrs.name,
        attrs && attrs.display_name
      ]);
      if (metricName) index.metricsById[id] = String(metricName).toLowerCase().trim();
    }
  }
  return index;
}

function mapKlaviyoEventToRawRow_(event, includedIndex) {
  var attributes = event && event.attributes ? event.attributes : {};
  var relationships = event && event.relationships ? event.relationships : {};
  var idx = includedIndex || {};
  var profilesById = idx.profilesById || {};
  var metricsById = idx.metricsById || {};
  var profileRel = getObjPath_(relationships, 'profile.data.id');
  var campaignRel = pickFirstValue_([
    getObjPath_(relationships, 'campaign.data.id'),
    getObjPath_(relationships, 'campaign.data.0.id')
  ]);
  var flowRel = pickFirstValue_([
    getObjPath_(relationships, 'flow.data.id'),
    getObjPath_(relationships, 'flow.data.0.id')
  ]);
  var metricRel = getObjPath_(relationships, 'metric.data.id');
  var messageRel = getObjPath_(relationships, 'message.data.id');

  var eventId = String(
    pickFirstValue_([
      event && event.id,
      attributes && attributes.uuid,
      attributes && attributes.event_id
    ]) || ''
  ).trim();

  var eventType = String(
    pickFirstValue_([
      metricsById[String(metricRel || '')],
      getObjPath_(attributes, 'metric.name'),
      attributes && attributes.event_type,
      attributes && attributes.type,
      event && event.type
    ]) || ''
  ).trim();

  var eventTs = toIsoUtc_(pickFirstValue_([
    attributes && attributes.datetime,
    attributes && attributes.timestamp,
    attributes && attributes.time
  ]));

  var email = pickFirstValue_([
    profilesById[String(profileRel || '')],
    attributes && attributes.email,
    getObjPath_(attributes, 'profile.email'),
    getObjPath_(attributes, 'customer_properties.$email'),
    getObjPath_(attributes, 'properties.$email'),
    getObjPath_(attributes, 'properties.email')
  ]);

  var campaignId = pickFirstValue_([
    campaignRel,
    getObjPath_(attributes, 'campaign_id'),
    getObjPath_(attributes, 'campaign.id'),
    getObjPath_(attributes, 'attribution.campaign_id'),
    getObjPath_(attributes, 'properties.campaign_id'),
    getObjPath_(attributes, 'event_properties.$campaign'),
    getObjPath_(attributes, 'event_properties.campaign_id')
  ]);

  var flowId = pickFirstValue_([
    flowRel,
    getObjPath_(attributes, 'flow_id'),
    getObjPath_(attributes, 'flow.id'),
    getObjPath_(attributes, 'attribution.flow_id'),
    getObjPath_(attributes, 'properties.flow_id')
  ]);

  var metricId = pickFirstValue_([
    metricRel,
    getObjPath_(attributes, 'metric_id'),
    getObjPath_(attributes, 'metric.id')
  ]);

  var messageId = pickFirstValue_([
    messageRel,
    getObjPath_(attributes, 'message_id'),
    getObjPath_(attributes, 'message.id'),
    getObjPath_(attributes, 'event_properties.$message'),
    getObjPath_(attributes, 'event_properties.message_id'),
    getObjPath_(attributes, 'event_properties.$message_interaction')
  ]);

  if (!eventId || !eventTs) return null;

  return {
    event_id: eventId,
    event_type: eventType || null,
    event_ts: eventTs,
    profile_id: profileRel ? String(profileRel) : null,
    email: email ? String(email).toLowerCase().trim() : null,
    message_id: messageId ? String(messageId) : null,
    campaign_id: campaignId ? String(campaignId) : null,
    flow_id: flowId ? String(flowId) : null,
    metric_id: metricId ? String(metricId) : null,
    source: 'klaviyo_events_sync_v1',
    payload: event
  };
}

function upsertKlaviyoEventsToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/raw_klaviyo_events?on_conflict=event_id';
  var chunkSize = 200;
  var uploaded = 0;

  for (var i = 0; i < rows.length; i += chunkSize) {
    var chunk = rows.slice(i, i + chunkSize);
    var res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: conf.serviceRole,
        Authorization: 'Bearer ' + conf.serviceRole,
        'Content-Profile': 'raw',
        'Accept-Profile': 'raw',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error('KLAVIYO Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function scheduledKlaviyoSync_v1(options) {
  var opts = options || {};
  var maxPages = Math.max(1, Math.min(20, Number(opts.maxPages || 10)));
  var pageSize = Math.max(1, Math.min(100, Number(opts.pageSize || 100)));
  var startedAt = new Date();
  var runId = null;
  var previousCheckpoint = getKlaviyoCheckpoint_();
  Logger.log('[KLAVIYO][INFO] Started scheduledKlaviyoSync_v1 at ' + startedAt.toISOString());

  var result = {
    startedAt: startedAt.toISOString(),
    previousCheckpoint: previousCheckpoint || '',
    fetched: 0,
    mapped: 0,
    uploaded: 0,
    martRefresh: null,
    pages: 0,
    latestEventTs: null,
    finishedAt: null
  };

  try {
    var kcfg = getKlaviyoConfig_();
    var nextUrl = buildKlaviyoEventsUrl_(kcfg.baseUrl, previousCheckpoint, pageSize);

    try {
      runId = startIngestionRun_('scheduledKlaviyoSync_v1', 'klaviyo_events', {
        trigger_type: 'time_based',
        page_size: pageSize,
        max_pages: maxPages
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[KLAVIYO][WARN] Could not start ingestion run log: ' + logErr);
    }

    var mappedRows = [];
    for (var p = 0; p < maxPages && nextUrl; p++) {
      var payload = fetchKlaviyoEventsPage_(nextUrl, kcfg.apiKey);
      var events = payload && payload.data ? payload.data : [];
      var includedIndex = buildKlaviyoIncludedIndex_(payload);
      result.pages += 1;
      result.fetched += events.length;

      for (var e = 0; e < events.length; e++) {
        var mapped = mapKlaviyoEventToRawRow_(events[e], includedIndex);
        if (!mapped) continue;
        mappedRows.push(mapped);
        result.mapped += 1;

        if (!result.latestEventTs || mapped.event_ts > result.latestEventTs) {
          result.latestEventTs = mapped.event_ts;
        }
      }

      nextUrl = getObjPath_(payload, 'links.next');
      if (nextUrl) nextUrl = String(nextUrl);
      if (!events.length) break;
    }

    if (mappedRows.length) {
      var up = upsertKlaviyoEventsToSupabase_(mappedRows);
      result.uploaded = up.uploaded || 0;
    }

    result.martRefresh = refreshKlaviyoAttributionMart_v1();

    if (result.latestEventTs) {
      setKlaviyoCheckpoint_(result.latestEventTs);
    }

    result.finishedAt = new Date().toISOString();

    if (runId) {
      try {
        finishIngestionRun_(runId, 'success', Number(result.uploaded || 0), result, null);
      } catch (logErr2) {
        Logger.log('[KLAVIYO][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[KLAVIYO][INFO] Completed scheduledKlaviyoSync_v1: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    if (runId) {
      try {
        finishIngestionRun_(runId, 'error', Number(result.uploaded || 0), result, result.error.message);
      } catch (logErr3) {
        Logger.log('[KLAVIYO][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('scheduledKlaviyoSync_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[KLAVIYO][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[KLAVIYO][ERROR] scheduledKlaviyoSync_v1 failed: ' + JSON.stringify(result));
    throw e;
  }
}

function resetKlaviyoCheckpoint_v1(startIso) {
  var fallback = '2020-01-01T00:00:00.000Z';
  var next = String(startIso || '').trim() || fallback;
  setKlaviyoCheckpoint_(next);
  Logger.log('[KLAVIYO][INFO] Reset checkpoint to ' + next);
  return { checkpoint: next };
}

function installScheduledKlaviyoSyncTrigger_v1() {
  var fn = 'scheduledKlaviyoSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[KLAVIYO][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('[KLAVIYO][INFO] Created trigger for ' + fn + ' (every 15 minutes)');
  return { created: true, schedule: 'everyMinutes(15)' };
}

function installSafePollTrigger_v2() {
  var fn = 'safePoll_v2';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[NEWWEB][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('[NEWWEB][INFO] Created trigger for ' + fn + ' (every 5 minutes)');
  return { created: true, schedule: 'everyMinutes(5)' };
}

function removeTriggersByHandler_v1(handlerFn) {
  var fn = String(handlerFn || '').trim();
  if (!fn) return { removed: 0, handler: '' };
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });

  triggers.forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  Logger.log('[TRIGGERS][INFO] Removed ' + triggers.length + ' trigger(s) for ' + fn);
  return { removed: triggers.length, handler: fn };
}

/************************************************************
 * BC incremental sync schedule
 ************************************************************/
function scheduledBcSync_v1() {
  var lock = null;
  var runId = null;
  var startedAt = new Date();
  var result = {
    startedAt: startedAt.toISOString(),
    bcSync: null,
    finishedAt: null
  };

  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      Logger.log('[BCSYNC][WARN] Skipping scheduledBcSync_v1: another run is in progress.');
      return { skipped: true, reason: 'lock_not_acquired', startedAt: startedAt.toISOString() };
    }

    try {
      runId = startIngestionRun_('scheduledBcSync_v1', 'bc_data', {
        trigger_type: 'time_based'
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[BCSYNC][WARN] Could not start ingestion run log: ' + logErr);
    }

    result.bcSync = runBcIncrementalSync_v1();
    result.finishedAt = new Date().toISOString();

    var rowsProcessed =
      toNum_(result.bcSync && result.bcSync.invoices && result.bcSync.invoices.uploaded) +
      toNum_(result.bcSync && result.bcSync.creditInvoices && result.bcSync.creditInvoices.uploaded) +
      toNum_(result.bcSync && result.bcSync.lines && result.bcSync.lines.uploaded) +
      toNum_(result.bcSync && result.bcSync.customers && result.bcSync.customers.uploaded);

    if (runId) {
      try {
        finishIngestionRun_(runId, 'success', rowsProcessed, result, null);
      } catch (logErr2) {
        Logger.log('[BCSYNC][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[BCSYNC][INFO] Completed scheduledBcSync_v1: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = {
      name: e && e.name ? e.name : '',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : ''
    };

    var rowsProcessedErr =
      toNum_(result.bcSync && result.bcSync.invoices && result.bcSync.invoices.uploaded) +
      toNum_(result.bcSync && result.bcSync.creditInvoices && result.bcSync.creditInvoices.uploaded) +
      toNum_(result.bcSync && result.bcSync.lines && result.bcSync.lines.uploaded) +
      toNum_(result.bcSync && result.bcSync.customers && result.bcSync.customers.uploaded);

    if (runId) {
      try {
        finishIngestionRun_(runId, 'error', rowsProcessedErr, result, result.error.message);
      } catch (logErr3) {
        Logger.log('[BCSYNC][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    try {
      notifyTriggerFailure_('scheduledBcSync_v1', result.error, result);
    } catch (alertErr) {
      Logger.log('[BCSYNC][WARN] Failure alert failed: ' + alertErr);
    }

    Logger.log('[BCSYNC][ERROR] scheduledBcSync_v1 failed: ' + JSON.stringify(result));
    throw e;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function installScheduledBcSyncTrigger_v1() {
  var fn = 'scheduledBcSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length >= 2) {
    Logger.log('[BCSYNC][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .nearMinute(10)
    .create();

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyDays(1)
    .atHour(13)
    .nearMinute(10)
    .create();

  Logger.log('[BCSYNC][INFO] Created trigger for ' + fn + ' (every 1 day at ~06:10 and ~13:10)');
  return { created: true, schedule: ['everyDays(1).atHour(6).nearMinute(10)', 'everyDays(1).atHour(13).nearMinute(10)'] };
}

function removeScheduledBcSyncTrigger_v1() {
  var fn = 'scheduledBcSync_v1';
  var out = removeTriggersByHandler_v1(fn);
  Logger.log('[BCSYNC][INFO] Removed ' + out.removed + ' trigger(s) for ' + fn);
  return { removed: out.removed };
}

/**
 * auditTriggers_v1()
 * Logs all project triggers with handler, type, and schedule info.
 * Run manually from Apps Script IDE to verify trigger state.
 * Returns array of trigger descriptors; also writes to Logger.
 */
function auditTriggers_v1() {
  var EXPECTED = {
    safePoll_v2:                    'every 5 min',
    runDailySanityChecks_v1:        'daily ~02:xx',
    scheduledReferenceSync_v1:      'daily ~03:xx',
    scheduledMagentoSync_v1:        'daily ~04:xx',
    scheduledCludoSync_v1:          'daily ~04:xx',
    scheduledCustomerAnalysisSync_v1: 'daily ~05:xx',
    scheduledKlaviyoSync_v1:        'daily ~05:xx',
    scheduledBcSync_v1:             'twice daily ~06:xx + ~13:xx'
  };

  var triggers = ScriptApp.getProjectTriggers();
  var rows = triggers.map(function(t) {
    var handler = t.getHandlerFunction();
    var type    = t.getTriggerSource().toString();
    var evtType = t.getEventType().toString();
    return {
      handler:  handler,
      type:     type,
      eventType: evtType,
      expected: EXPECTED[handler] || '(unrecognised)'
    };
  });

  // Group by handler for summary
  var counts = {};
  rows.forEach(function(r) {
    counts[r.handler] = (counts[r.handler] || 0) + 1;
  });

  Logger.log('[AUDIT][TRIGGERS] Total triggers: ' + triggers.length);
  rows.forEach(function(r) {
    Logger.log('[AUDIT][TRIGGERS] ' + r.handler +
      ' | type=' + r.type +
      ' | event=' + r.eventType +
      ' | expected=' + r.expected);
  });

  // Warn about unexpected handlers
  Object.keys(counts).forEach(function(handler) {
    if (!EXPECTED[handler]) {
      Logger.log('[AUDIT][WARN] Unknown handler: ' + handler + ' (' + counts[handler] + ' trigger(s))');
    }
  });

  // Warn about missing expected handlers
  Object.keys(EXPECTED).forEach(function(handler) {
    if (!counts[handler]) {
      Logger.log('[AUDIT][WARN] Missing trigger for: ' + handler + ' (expected ' + EXPECTED[handler] + ')');
    }
  });

  return { total: triggers.length, byHandler: counts, triggers: rows };
}

function resetRecommendedTimeTriggers_v1() {
  var handlers = [
    'safePoll_v2',
    'runDailySanityChecks_v1',
    'scheduledReferenceSync_v1',
    'scheduledMagentoSync_v1',
    'scheduledCludoSync_v1',
    'scheduledCustomerAnalysisSync_v1',
    'scheduledKlaviyoSync_v1',
    'scheduledBcSync_v1'
  ];

  handlers.forEach(function(fn) {
    removeTriggersByHandler_v1(fn);
  });

  var installed = [
    installSafePollTrigger_v2(),
    installDailySanityChecksTrigger_v1(),
    installScheduledReferenceSyncTrigger_v1(),
    installScheduledMagentoSyncTrigger_v1(),
    installScheduledCludoSyncTrigger_v1(),
    installScheduledCustomerAnalysisSyncTrigger_v1(),
    installScheduledKlaviyoSyncTrigger_v1(),
    installScheduledBcSyncTrigger_v1()
  ];

  Logger.log('[TRIGGERS][INFO] Recommended trigger schedule reset completed.');
  return {
    removedHandlers: handlers,
    installed: installed
  };
}


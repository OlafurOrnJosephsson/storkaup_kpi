/************************************************************
 * SEO MANAGER (PHASE 1)
 * - Reads SEO queue rows from Google Sheets
 * - Generates Icelandic SEO copy with OpenAI
 * - Writes suggestions back for manual review and Prismic copy/paste
 ************************************************************/

const SEO_QUEUE_SHEET_NAME = 'SEO_QUEUE';
const SEO_QUEUE_HEADER = [
  'Category Name',
  'Current Meta Title',
  'Current Meta Description',
  'Suggested Meta Title',
  'Suggested Meta Description',
  'Category Path',
  'Level 1',
  'Level 2',
  'Level 3',
  'Keyword Hints',
  'Unique SKUs',
  'Top Products',
  'Revenue Incl',
  'Context',
  'Status',
  'Approved',
  'Reviewed By',
  'Last Generated At',
  'Notes'
];

function getSeoManagerEnv_(opts) {
  opts = opts || {};
  const cfg = loadConfig_();
  const openAiApi = cfg.API.OpenAI || {};
  const openAiEndpoints = cfg.ENDPOINTS.OpenAI || {};
  const geminiApi = cfg.API.Gemini || {};

  const env = {
    cfg: cfg,
    spreadsheetId:
      (cfg.SHEETS && cfg.SHEETS.SALES_SUMMARIES && cfg.SHEETS.SALES_SUMMARIES.ID) || '',
    queueSheetName:
      cfg.SETTINGS.SEO_QUEUE_SHEET_NAME ||
      SEO_QUEUE_SHEET_NAME,
    provider:
      String(cfg.SETTINGS.SEO_PROVIDER || 'Gemini').trim().toLowerCase(),
    openAiUrl:
      openAiEndpoints.CHAT_COMPLETIONS ||
      openAiEndpoints.RESPONSES ||
      'https://api.openai.com/v1/chat/completions',
    openAiKey:
      openAiApi.API_KEY ||
      openAiApi.KEY ||
      '',
    openAiModel:
      cfg.SETTINGS.SEO_OPENAI_MODEL ||
      openAiApi.MODEL ||
      'gpt-4o',
    geminiApiKey:
      geminiApi.API_KEY ||
      geminiApi.KEY ||
      '',
    geminiModel:
      cfg.SETTINGS.SEO_GEMINI_MODEL ||
      geminiApi.MODEL ||
      'gemini-2.5-flash',
    geminiFallbackModels: parseCsvList_(
      cfg.SETTINGS.SEO_GEMINI_FALLBACK_MODELS ||
      geminiApi.FALLBACK_MODELS ||
      'gemini-2.5-flash-lite,gemini-2.0-flash-lite'
    ),
    batchSize: Number(cfg.SETTINGS.SEO_BATCH_SIZE || 10),
    sleepMs: Number(cfg.SETTINGS.SEO_BATCH_SLEEP_MS || 600)
  };

  const missing = [];
  if (!env.spreadsheetId) missing.push('SHEETS.SALES_SUMMARIES.ID');
  if (opts.requireAi) {
    if (env.provider === 'gemini' && !env.geminiApiKey) missing.push('API.Gemini.API_KEY');
    if (env.provider === 'openai' && !env.openAiKey) missing.push('API.OpenAI.API_KEY');
  }

  if (missing.length) {
    throw new Error(
      'SEO_MANAGER CONFIG ERROR - missing keys:\n' + missing.join('\n')
    );
  }

  return env;
}

function normalizeGeminiModelName_(model) {
  const value = String(model || '').trim();
  if (!value) return '';
  return value.replace(/^models\//i, '');
}

function isDeprecatedGeminiModel_(model) {
  const value = normalizeGeminiModelName_(model).toLowerCase();
  return (
    value === 'gemini-1.5-flash' ||
    value === 'gemini-1.5-pro' ||
    value === 'gemini-1.0-pro'
  );
}

function getSafeGeminiModelChain_(env) {
  const configured = [env.geminiModel].concat(env.geminiFallbackModels || [])
    .map(normalizeGeminiModelName_)
    .filter(Boolean)
    .filter(function(model, idx, arr) { return arr.indexOf(model) === idx; });

  const safeDefaults = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite'
  ];

  const cleaned = configured.filter(function(model) {
    return !isDeprecatedGeminiModel_(model);
  });

  if (!cleaned.length) return safeDefaults.slice();
  return cleaned.concat(safeDefaults).filter(function(model, idx, arr) {
    return arr.indexOf(model) === idx;
  });
}

function debugAvailableGeminiModels_v1() {
  const env = getSeoManagerEnv_({ requireAi: true });
  if (env.provider !== 'gemini') {
    throw new Error('Current SEO provider is not Gemini.');
  }

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models?key=' +
    encodeURIComponent(env.geminiApiKey);

  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gemini models list failed (' + code + '): ' + body);
  }

  const parsed = safeJsonParse_(body) || {};
  const models = Array.isArray(parsed.models) ? parsed.models : [];
  const names = models
    .map(function(item) { return normalizeGeminiModelName_(item && item.name); })
    .filter(Boolean)
    .filter(function(name, idx, arr) { return arr.indexOf(name) === idx; })
    .sort();

  Logger.log('Gemini available models: ' + JSON.stringify(names));
  return names;
}

function ensureSeoQueueSheet_() {
  const env = getSeoManagerEnv_();
  const ss = SpreadsheetApp.openById(env.spreadsheetId);
  let sh = ss.getSheetByName(env.queueSheetName);

  if (!sh) {
    sh = ss.insertSheet(env.queueSheetName);
  }

  const values = sh.getDataRange().getValues();
  const needsHeader =
    !values.length ||
    values[0].length < SEO_QUEUE_HEADER.length ||
    SEO_QUEUE_HEADER.some(function(col, idx) {
      return String(values[0][idx] || '').trim() !== col;
    });

  if (needsHeader) {
    sh.clearContents();
    sh.getRange(1, 1, 1, SEO_QUEUE_HEADER.length).setValues([SEO_QUEUE_HEADER]);
  }

  applySheetStyling_(sh, { zebra: true });
  return sh;
}

function getSeoQueueSheet_() {
  return ensureSeoQueueSheet_();
}

function getSeoQueueData_() {
  const sh = getSeoQueueSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    return {
      sheet: sh,
      header: SEO_QUEUE_HEADER.slice(),
      rows: []
    };
  }

  const header = values[0].map(function(v) { return String(v || '').trim(); });
  const rows = values.slice(1).map(function(row, idx) {
    const obj = {};
    header.forEach(function(key, colIdx) {
      obj[key] = row[colIdx];
    });
    obj.__rowNumber = idx + 2;
    return obj;
  });

  return { sheet: sh, header: header, rows: rows };
}


function generateSEOTitles(categoryName, context, keywordHints, currentMetaTitle, currentMetaDescription) {
  const env = getSeoManagerEnv_({ requireAi: true });
  const prompt = buildSeoPromptV2_(
    categoryName,
    context,
    keywordHints,
    currentMetaTitle,
    currentMetaDescription
  );

  const seo = env.provider === 'gemini'
    ? generateSeoWithGemini_(prompt, env)
    : generateSeoWithOpenAi_(prompt, env);

  if (!seo.title || !seo.description) {
    throw new Error('AI SEO response missing title/description: ' + JSON.stringify(seo));
  }

  const cleaned = {
    title: enforceMaxLength_(sanitizeSeoText_(seo.title), 59),
    description: enforceMaxLength_(sanitizeSeoText_(seo.description), 154)
  };

  Logger.log(
    'SEO Manager: generated SEO copy for "' + categoryName + '" -> ' +
    JSON.stringify(cleaned)
  );

  return cleaned;
}

function buildSeoPromptV2_(categoryName, context, keywordHints, currentMetaTitle, currentMetaDescription) {
  const compact = compactSeoInputs_(context, keywordHints);
  return [
    'Thu ert SEO serfraedingur fyrir Storkaup.is.',
    'Skrifadu Meta Title og Meta Description fyrir voruflokk.',
    'Flokkur: ' + categoryName,
    'Samhengi: ' + (compact.context || 'Engin frekari samantekt tiltæk.'),
    compact.keywordHints ? ('Keyword hints: ' + compact.keywordHints) : '',
    currentMetaTitle ? ('Nuverandi Meta Title: ' + currentMetaTitle) : '',
    currentMetaDescription ? ('Nuverandi Meta Description: ' + currentMetaDescription) : '',
    'Leggdu aherslu a heildsolu, rekstrartharfir fyrirtækja, gaedi og traust.',
    'Tungumal: Islenska.',
    'Still: professional B2B, beinn og truverdugur.',
    'Strict limit: Title must be between 40-55 characters. Description must be between 130-150 characters.',
    'Ef samhengid inniheldur vinsael vorumerki eda soluhaestu vorur, ma nefna thad ef thad passar edlilega og styrkir truverdugleika.',
    'Fordastu keyword stuffing, of almennan texta og auglysingalegan ton.',
    'Ekki nota setningar eins og "pantaudu i dag", "faudu sent hratt", "skjot afhending", "mikid urval" eda sambærilegan solukjaft.',
    'Ekki lofa hradri afhendingu nema thad se beinlinis studd af samhenginu.',
    'Skrifadu eins og fyrir islenskan fyrirtækjamarkad, ekki eins og fyrir neytendaauglysingu.',
    'Ekki baeta vid inngangi, skyringum eda texta eins og "Here is the JSON requested".',
    'Return only raw JSON with this exact shape: {"title":"...","description":"..."}'
  ].filter(Boolean).join('\n');
}

function runSeoAutomationBatch_v1(opts) {
  opts = opts || {};
  const env = getSeoManagerEnv_({ requireAi: true });
  const props = PropertiesService.getScriptProperties();
  const stateKey = 'SEO_MANAGER_LAST_ROW';
  const queue = getSeoQueueData_();
  const rows = queue.rows;

  if (!rows.length) {
    Logger.log('SEO Manager: queue is empty.');
    return {
      ok: true,
      processed: 0,
      nextRow: 0,
      total: 0
    };
  }

  const batchSize = Math.max(1, Number(opts.batchSize || env.batchSize || 10));
  const eligible = rows.filter(function(row) {
    const categoryName = String(row['Category Name'] || '').trim();
    if (!categoryName) return false;

    const approved = normalizeBooleanFlag_(row.Approved);
    if (approved) return false;

    const status = normalizeStatus_(row.Status);
    if (opts.forceRegenerate) return true;

    return !status || status === 'PENDING' || status === 'ERROR';
  });

  if (!eligible.length) {
    Logger.log('SEO Manager: no eligible queue rows found.');
    props.setProperty(stateKey, '0');
    return {
      ok: true,
      processed: 0,
      nextRow: 0,
      total: rows.length
    };
  }

  let startIndex = Number(
    opts.startIndex != null ? opts.startIndex : props.getProperty(stateKey) || 0
  );
  if (startIndex >= eligible.length) startIndex = 0;

  const batch = eligible.slice(startIndex, startIndex + batchSize);
  const results = [];

  Logger.log(
    'SEO Manager: starting queue batch ' + startIndex + '-' +
    (startIndex + batch.length - 1) + ' of ' + eligible.length
  );

  batch.forEach(function(row, idx) {
    const rowNumber = row.__rowNumber;
    try {
      const categoryName = String(row['Category Name'] || '').trim();
      const context = String(row.Context || '').trim();
      const keywordHints = String(row['Keyword Hints'] || '').trim();
      const currentMetaTitle = String(row['Current Meta Title'] || '').trim();
      const currentMetaDescription = String(row['Current Meta Description'] || '').trim();

      const seoData = generateSEOTitles(
        categoryName,
        context,
        keywordHints,
        currentMetaTitle,
        currentMetaDescription
      );

      writeSeoQueueResult_(queue.sheet, rowNumber, {
        suggestedTitle: seoData.title,
        suggestedDescription: seoData.description,
        status: 'GENERATED',
        lastGeneratedAt: new Date(),
        notes: ''
      });

      results.push({
        ok: true,
        rowNumber: rowNumber,
        categoryName: categoryName,
        seoData: seoData
      });
    } catch (err) {
      const errMessage = err && err.message ? err.message : String(err || 'Unknown error');
      writeSeoQueueResult_(queue.sheet, rowNumber, {
        status: isQuotaOrTemporaryAiError_(errMessage) ? 'RETRY' : 'ERROR',
        lastGeneratedAt: new Date(),
        notes: errMessage
      });

      Logger.log(
        'SEO Manager ERROR [row ' + rowNumber + '] ' +
        row['Category Name'] + ': ' + errMessage
      );

      results.push({
        ok: false,
        rowNumber: rowNumber,
        categoryName: String(row['Category Name'] || ''),
        error: errMessage
      });

      if (isQuotaOrTemporaryAiError_(errMessage)) {
        throw new Error('SEO_BATCH_STOPPED_RATE_LIMIT: ' + errMessage);
      }
    }

    if (idx < batch.length - 1 && env.sleepMs > 0) {
      Utilities.sleep(env.sleepMs);
    }
  });

  const nextIndex = startIndex + batch.length < eligible.length
    ? startIndex + batch.length
    : 0;
  props.setProperty(stateKey, String(nextIndex));

  applySheetStyling_(queue.sheet, { zebra: true });

  const summary = {
    ok: true,
    processed: batch.length,
    nextRow: nextIndex,
    total: rows.length,
    eligible: eligible.length,
    successCount: results.filter(function(item) { return item.ok; }).length,
    errorCount: results.filter(function(item) { return !item.ok; }).length,
    results: results
  };

  Logger.log('SEO Manager summary: ' + JSON.stringify(summary));
  return summary;
}

function runSeoForSelectedRow_v1() {
  const queue = getSeoQueueData_();
  const sheet = queue.sheet;
  const activeSheet = SpreadsheetApp.getActiveSheet();
  if (!activeSheet || activeSheet.getName() !== sheet.getName()) {
    throw new Error('Open SEO_QUEUE sheet and select a data row first.');
  }

  const rowNumber = activeSheet.getActiveCell().getRow();
  if (rowNumber < 2) {
    throw new Error('Select a queue data row, not the header row.');
  }

  return runSeoForRowNumber_v1(rowNumber);
}

function runSeoForRowNumber_v1(rowNumber) {
  const env = getSeoManagerEnv_({ requireAi: true });
  const queue = getSeoQueueData_();
  const row = queue.rows.find(function(item) {
    return item.__rowNumber === Number(rowNumber);
  });

  if (!row) {
    throw new Error('SEO queue row not found: ' + rowNumber);
  }

  const categoryName = String(row['Category Name'] || '').trim();
  if (!categoryName) {
    throw new Error('Selected row has no Category Name.');
  }

  const currentStatus = normalizeStatus_(row.Status);
  if (normalizeBooleanFlag_(row.Approved)) {
    throw new Error('Selected row is already approved.');
  }

  const context = String(row.Context || '').trim();
  const keywordHints = String(row['Keyword Hints'] || '').trim();
  const currentMetaTitle = String(row['Current Meta Title'] || '').trim();
  const currentMetaDescription = String(row['Current Meta Description'] || '').trim();

  Logger.log(
    'SEO Manager: generating selected row ' + rowNumber +
    ' (' + categoryName + ', status=' + currentStatus + ')'
  );

  try {
    const seoData = generateSEOTitles(
      categoryName,
      context,
      keywordHints,
      currentMetaTitle,
      currentMetaDescription
    );

    writeSeoQueueResult_(queue.sheet, rowNumber, {
      suggestedTitle: seoData.title,
      suggestedDescription: seoData.description,
      status: 'GENERATED',
      lastGeneratedAt: new Date(),
      notes: ''
    });

    return {
      ok: true,
      rowNumber: rowNumber,
      categoryName: categoryName,
      provider: env.provider,
      seoData: seoData
    };
  } catch (err) {
    const errMessage = err && err.message ? err.message : String(err || 'Unknown error');
    writeSeoQueueResult_(queue.sheet, rowNumber, {
      status: isQuotaOrTemporaryAiError_(errMessage) ? 'RETRY' : 'ERROR',
      lastGeneratedAt: new Date(),
      notes: errMessage
    });
    throw err;
  }
}

function clearSeoErrorRows_v1(opts) {
  opts = opts || {};
  const queue = getSeoQueueData_();
  const sheet = queue.sheet;
  const statusesToClear = (opts.statuses || ['ERROR', 'RETRY']).map(function(status) {
    return normalizeStatus_(status);
  });

  const header = SEO_QUEUE_HEADER;
  const clearCols = [
    'Suggested Meta Title',
    'Suggested Meta Description',
    'Status',
    'Last Generated At',
    'Notes'
  ].map(function(name) { return header.indexOf(name); }).filter(function(i) { return i !== -1; });

  const a1s = [];
  let cleared = 0;

  queue.rows.forEach(function(row) {
    const status = normalizeStatus_(row.Status);
    if (statusesToClear.indexOf(status) === -1) return;
    clearCols.forEach(function(colIdx) {
      a1s.push(sheet.getRange(row.__rowNumber, colIdx + 1).getA1Notation());
    });
    cleared += 1;
  });

  if (a1s.length) {
    sheet.getRangeList(a1s).clearContent();
  }

  Logger.log(
    'SEO Manager: cleared error rows -> ' + cleared +
    ' (' + statusesToClear.join(', ') + ')'
  );

  return {
    ok: true,
    cleared: cleared,
    statuses: statusesToClear
  };
}

function writeSeoQueueResult_(sheet, rowNumber, updates) {
  const header = SEO_QUEUE_HEADER;
  const range = sheet.getRange(rowNumber, 1, 1, header.length);
  const row = range.getValues()[0];

  function setCol(columnName, value) {
    const idx = header.indexOf(columnName);
    if (idx !== -1) row[idx] = value;
  }

  if ('suggestedTitle' in updates)       setCol('Suggested Meta Title', updates.suggestedTitle);
  if ('suggestedDescription' in updates) setCol('Suggested Meta Description', updates.suggestedDescription);
  if ('status' in updates)               setCol('Status', updates.status);
  if ('lastGeneratedAt' in updates)      setCol('Last Generated At', updates.lastGeneratedAt);
  if ('notes' in updates)                setCol('Notes', updates.notes);

  range.setValues([row]);
}

function seedSeoQueueRows_(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('seedSeoQueueRows_ requires a non-empty items array.');
  }

  const sh = getSeoQueueSheet_();
  const rows = items.map(function(item) {
    return [
      item.categoryName || '',
      item.currentMetaTitle || '',
      item.currentMetaDescription || '',
      '',
      '',
      item.categoryPath || '',
      item.level1 || '',
      item.level2 || '',
      item.level3 || '',
      item.keywordHints || '',
      item.uniqueSkus || '',
      item.topProducts || '',
      item.revenueIncl || '',
      item.context || '',
      item.status || 'PENDING',
      item.approved || '',
      item.reviewedBy || '',
      '',
      item.notes || ''
    ];
  });

  const startRow = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(startRow, 1, rows.length, SEO_QUEUE_HEADER.length).setValues(rows);
  applySheetStyling_(sh, { zebra: true });

  Logger.log('SEO Manager: seeded ' + rows.length + ' SEO queue rows.');
}

function resetSeoAutomationCursor_() {
  PropertiesService.getScriptProperties().deleteProperty('SEO_MANAGER_LAST_ROW');
  Logger.log('SEO Manager cursor reset.');
}

function setupSeoQueueSheet_v1() {
  const sh = ensureSeoQueueSheet_();
  Logger.log('SEO Manager: queue sheet ready -> ' + sh.getName());
}

function testGenerateSeoTitle_() {
  return generateSEOTitles(
    'Hanskar',
    'Einnota hanskar og vinnuhanskar fyrir faglega notkun í eldhúsum, ræstingum og heilbrigðisrekstri.',
    'hanskar, einnota hanskar, nitril hanskar, vinnuhanskar',
    'Hanskar',
    'Hanskar'
  );
}

function buildSeoQueueFromCludo_v1(opts) {
  opts = opts || {};
  const products = loadTableBySchema_('PRODUCTS') || [];
  if (!products.length) {
    throw new Error('No PRODUCTS rows found. Run Cludo sync first.');
  }

  const salesMap = loadSeoCategorySalesMap_();
  const grouped = {};
  let rowsWithCategory = 0;

  products.forEach(function(row) {
    const level1 = String(row.LEVEL1 || '').trim();
    const level2 = String(row.LEVEL2 || '').trim();
    const level3 = String(row.LEVEL3 || '').trim();
    const categoryPath = String(row.CATEGORY_PATH || '').trim();
    const productName = String(row.NAME || '').trim();
    const sku = String(row.SKU || '').trim();

    const categoryName = level3 || level2 || level1;
    if (!categoryName) return;
    rowsWithCategory += 1;

    const key = [level1, level2, level3, categoryPath].join('||');
    if (!grouped[key]) {
      grouped[key] = {
        categoryName: categoryName,
        categoryPath: categoryPath,
        level1: level1,
        level2: level2,
        level3: level3,
        uniqueSkus: {},
        productNames: {},
        keywordHints: {},
        contextParts: []
      };
    }

    const entry = grouped[key];
    if (sku) entry.uniqueSkus[sku] = true;
    if (productName) {
      entry.productNames[productName] = true;
      buildKeywordHintsFromText_(productName).forEach(function(term) {
        entry.keywordHints[term] = true;
      });
    }

    [level1, level2, level3].filter(Boolean).forEach(function(term) {
      entry.keywordHints[term] = true;
    });
  });

  const items = Object.keys(grouped).map(function(key) {
    const entry = grouped[key];
    const sales = salesMap[key] || {};
    const uniqueSkuCount = Object.keys(entry.uniqueSkus).length;
    const topProducts = Object.keys(entry.productNames).slice(0, 8);
    const keywordHints = Object.keys(entry.keywordHints).slice(0, 12).join(', ');

    const contextParts = [
      entry.categoryPath ? ('Flokkaslóð: ' + entry.categoryPath) : '',
      uniqueSkuCount ? ('Fjöldi vara í Cludo master: ' + uniqueSkuCount) : '',
      topProducts.length ? ('Dæmi um vörur: ' + topProducts.join(', ')) : '',
      sales.revenueIncl ? ('Sala alls tíma: ' + formatIskApprox_(sales.revenueIncl)) : '',
      sales.orders ? ('Pantanir alls tíma: ' + sales.orders) : '',
      sales.topSku ? ('Vinsælasta SKU: ' + sales.topSku) : ''
    ].filter(Boolean).join('. ');

    return {
      categoryName: entry.categoryName,
      categoryPath: entry.categoryPath,
      level1: entry.level1,
      level2: entry.level2,
      level3: entry.level3,
      keywordHints: keywordHints,
      uniqueSkus: uniqueSkuCount,
      topProducts: topProducts.join(', '),
      revenueIncl: sales.revenueIncl || '',
      context: contextParts,
      status: 'PENDING'
    };
  }).sort(function(a, b) {
    return Number(b.revenueIncl || 0) - Number(a.revenueIncl || 0);
  });

  const finalItems = opts.limit ? items.slice(0, Number(opts.limit)) : items;
  Logger.log(
    'SEO Manager seed diagnostics: products=' + products.length +
    ', rowsWithCategory=' + rowsWithCategory +
    ', groupedCategories=' + items.length
  );
  replaceSeoQueueRows_(finalItems);
  Logger.log('SEO Manager: built SEO queue from Cludo categories (' + finalItems.length + ' rows).');
  return { ok: true, rows: finalItems.length };
}

function replaceSeoQueueRows_(items) {
  const sh = getSeoQueueSheet_();
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }
  if (!items.length) return;
  seedSeoQueueRows_(items);
}

function loadSeoCategorySalesMap_() {
  const env = getSeoManagerEnv_();
  const ss = SpreadsheetApp.openById(env.spreadsheetId);
  const sh = ss.getSheetByName('Sales - Category (All Time)');
  if (!sh) return {};

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return {};

  const header = values[0].map(function(v) { return String(v || '').trim(); });
  const idx = {};
  header.forEach(function(name, i) { idx[name] = i; });

  const out = {};
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const level1 = idx['Level 1'] != null ? String(row[idx['Level 1']] || '').trim() : '';
    const level2 = idx['Level 2'] != null ? String(row[idx['Level 2']] || '').trim() : '';
    const level3 = idx['Level 3'] != null ? String(row[idx['Level 3']] || '').trim() : '';
    const categoryPath = idx['Category Path'] != null ? String(row[idx['Category Path']] || '').trim() : '';
    const key = [level1, level2, level3, categoryPath].join('||');
    if (!key.replace(/\|/g, '')) continue;

    out[key] = {
      orders: idx['Orders'] != null ? Number(row[idx['Orders']] || 0) : 0,
      revenueIncl: idx['Revenue Incl'] != null ? Number(row[idx['Revenue Incl']] || 0) : 0,
      topSku: idx['Top SKU'] != null ? String(row[idx['Top SKU']] || '').trim() : ''
    };
  }

  return out;
}

function buildKeywordHintsFromText_(text) {
  return String(text || '')
    .split(/[\s,\/\-\(\)]+/)
    .map(function(term) { return String(term || '').trim(); })
    .filter(function(term) {
      return term && term.length >= 3 && !/^\d+$/.test(term);
    });
}

function formatIskApprox_(value) {
  const num = Number(value || 0);
  if (!num) return '';
  return Math.round(num).toLocaleString('is-IS') + ' kr.';
}

function generateSeoWithOpenAi_(prompt, env) {
  const payload = {
    model: env.openAiModel,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Þú skrifar stuttan, sannfærandi og hnitmiðaðan SEO texta á íslensku.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  const res = UrlFetchApp.fetch(env.openAiUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + env.openAiKey,
      Accept: 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('OpenAI SEO generation failed (' + code + '): ' + body);
  }

  const parsed = safeJsonParse_(body);
  const content = extractOpenAiMessageContent_(parsed);
  return parseSeoJson_(content);
}

function generateSeoWithGemini_(prompt, env) {
  const models = getSafeGeminiModelChain_(env);

  let lastError = '';
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return generateSeoWithGeminiModel_(prompt, env, model);
    } catch (err) {
      lastError = err && err.message ? err.message : String(err || 'Unknown Gemini error');
      Logger.log('SEO Manager Gemini fallback miss [' + model + ']: ' + lastError);

      if ((!isQuotaOrTemporaryAiError_(lastError) && !isGeminiJsonFormattingError_(lastError)) || i === models.length - 1) {
        throw err;
      }
    }
  }

  throw new Error(lastError || 'Gemini SEO generation failed with all configured models.');
}

function generateSeoWithGeminiModel_(prompt, env, model) {
  if (isDeprecatedGeminiModel_(model)) {
    throw new Error(
      'Gemini model is deprecated or shut down: ' + model +
      '. Use gemini-2.5-flash, gemini-2.5-flash-lite or gemini-2.0-flash-lite.'
    );
  }

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(normalizeGeminiModelName_(model)) +
    ':generateContent';

  const payload = {
    systemInstruction: {
      parts: [
        {
          text: 'Þú skrifar stuttan, sannfærandi og hnitmiðaðan SEO texta á íslensku.'
        },
        {
          text: 'Skrifaðu á kjarnyrtri íslensku án þess að nota ofnotuð orð eins og "upplifðu", "kannaðu" eða "fáðu þér". Notaðu beint og hvetjandi mál sem hentar íslenskum fyrirtækjamarkaði.'
        }
      ]
    },
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 140,
      topP: 0.8,
      topK: 40,
      responseMimeType: 'application/json',
      responseSchema: buildGeminiSeoSchema_()
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': env.geminiApiKey,
      Accept: 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gemini SEO generation failed [' + model + '] (' + code + '): ' + body);
  }

  const parsed = safeJsonParse_(body) || {};
  const content = extractGeminiText_(parsed);
  const seo = parseSeoJson_(content);
  if (seo.title && seo.description) return seo;

  const simplifiedPrompt = buildSimplifiedSeoPrompt_(prompt);
  const retrySeo = generateSeoWithGeminiPlainJsonV2_(simplifiedPrompt, env, model);
  if (retrySeo.title && retrySeo.description) return retrySeo;

  throw new Error(
    'Gemini returned no usable JSON [' + model + ']. Raw text: ' +
    truncateForLog_(content || extractGeminiDiagnostics_(parsed), 600)
  );
}


function generateSeoWithGeminiPlainJsonV2_(prompt, env, model) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(normalizeGeminiModelName_(model)) +
    ':generateContent';

  const payload = {
    contents: [
      {
        parts: [
          { text: buildGeminiPlainJsonPrompt_(prompt) }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 120,
      topP: 0.8,
      topK: 20,
      responseMimeType: 'application/json',
      responseSchema: buildGeminiSeoSchema_()
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': env.geminiApiKey,
      Accept: 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gemini plain JSON retry failed [' + model + '] (' + code + '): ' + body);
  }

  const parsed = safeJsonParse_(body) || {};
  const content = extractGeminiText_(parsed);
  return parseSeoJson_(content);
}

function debugSeoSourceData_v1() {
  const env = getSeoManagerEnv_();
  const products = loadTableBySchema_('PRODUCTS') || [];
  const ss = SpreadsheetApp.openById(env.spreadsheetId);
  const salesSh = ss.getSheetByName('Sales - Category (All Time)');

  let rowsWithLevel1 = 0;
  let rowsWithLevel2 = 0;
  let rowsWithLevel3 = 0;
  let rowsWithPath = 0;
  let rowsWithAnyCategory = 0;

  products.forEach(function(row) {
    const l1 = String(row.LEVEL1 || '').trim();
    const l2 = String(row.LEVEL2 || '').trim();
    const l3 = String(row.LEVEL3 || '').trim();
    const path = String(row.CATEGORY_PATH || '').trim();

    if (l1) rowsWithLevel1 += 1;
    if (l2) rowsWithLevel2 += 1;
    if (l3) rowsWithLevel3 += 1;
    if (path) rowsWithPath += 1;
    if (l1 || l2 || l3 || path) rowsWithAnyCategory += 1;
  });

  const preview = products.slice(0, 10).map(function(row) {
    return {
      sku: row.SKU || '',
      name: row.NAME || '',
      path: row.CATEGORY_PATH || '',
      l1: row.LEVEL1 || '',
      l2: row.LEVEL2 || '',
      l3: row.LEVEL3 || ''
    };
  });

  const out = {
    productsTotal: products.length,
    rowsWithLevel1: rowsWithLevel1,
    rowsWithLevel2: rowsWithLevel2,
    rowsWithLevel3: rowsWithLevel3,
    rowsWithCategoryPath: rowsWithPath,
    rowsWithAnyCategorySignal: rowsWithAnyCategory,
    salesCategorySheetExists: !!salesSh,
    salesCategorySheetRows: salesSh ? salesSh.getLastRow() : 0,
    preview: preview
  };

  Logger.log('SEO source debug: ' + JSON.stringify(out));
  return out;
}

function normalizeStatus_(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeBooleanFlag_(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === 'já' || text === 'ja' || text === 'yes' || text === '1' || text === 'approved';
}

function extractOpenAiMessageContent_(payload) {
  try {
    return payload.choices[0].message.content || '';
  } catch (_) {
    return '';
  }
}

function extractGeminiText_(payload) {
  try {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = candidates[0] || {};
    const parts = first.content && Array.isArray(first.content.parts)
      ? first.content.parts
      : [];

    return parts.map(function(part) {
      return part && part.text ? String(part.text) : '';
    }).join('\n').trim();
  } catch (_) {
    return '';
  }
}

function extractGeminiDiagnostics_(payload) {
  try {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = candidates[0] || {};
    const feedback = payload.promptFeedback || {};
    return JSON.stringify({
      finishReason: first.finishReason || '',
      safetyRatings: first.safetyRatings || [],
      promptFeedback: feedback
    });
  } catch (_) {
    return '';
  }
}

function isQuotaOrTemporaryAiError_(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.indexOf('resource_exhausted') !== -1 ||
    text.indexOf('insufficient_quota') !== -1 ||
    text.indexOf('quota exceeded') !== -1 ||
    text.indexOf('retrydelay') !== -1 ||
    text.indexOf('currently experiencing high demand') !== -1 ||
    text.indexOf('status\": \"unavailable\"') !== -1 ||
    text.indexOf('status\": \"resource_exhausted\"') !== -1
  );
}

function isGeminiJsonFormattingError_(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.indexOf('returned no usable json') !== -1 ||
    text.indexOf('response missing title/description') !== -1 ||
    text.indexOf('here is the json') !== -1
  );
}

function parseSeoJson_(content) {
  const cleaned = normalizeJsonishText_(content);
  const parsed = safeJsonParse_(cleaned);
  if (parsed) return parsed;

  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? (safeJsonParse_(match[0]) || {}) : {};
}

function sanitizeSeoText_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

function enforceMaxLength_(value, maxLen) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;

  const sliced = text.slice(0, maxLen + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const safe = lastSpace > Math.floor(maxLen * 0.6)
    ? sliced.slice(0, lastSpace)
    : text.slice(0, maxLen);

  return safe.trim().replace(/[.,;:!?-]+$/, '');
}

function buildGeminiSeoSchema_() {
  return {
    type: 'OBJECT',
    required: ['title', 'description'],
    properties: {
      title: { type: 'STRING' },
      description: { type: 'STRING' }
    }
  };
}

function normalizeJsonishText_(content) {
  let text = String(content || '').trim();
  if (!text) return text;

  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  text = text.replace(/\s*```$/i, '').trim();
  text = text.replace(/^Here is the JSON requested:?\s*/i, '').trim();
  text = text.replace(/^Here is the JSON:?\s*/i, '').trim();
  text = text.replace(/^JSON:?\s*/i, '').trim();

  return text;
}

function compactSeoInputs_(context, keywordHints) {
  const cleanedContext = truncateForLog_(
    compactContextText_(context),
    420
  );
  const cleanedKeywords = String(keywordHints || '')
    .split(',')
    .map(function(item) { return String(item || '').trim(); })
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');

  return {
    context: cleanedContext,
    keywordHints: cleanedKeywords
  };
}

function compactContextText_(text) {
  let out = String(text || '');
  out = out.replace(/Dæmi um vörur:\s*/i, 'Top vörur: ');
  out = out.replace(/Fjöldi vara í Cludo master:\s*/i, 'Vörufjöldi: ');
  out = out.replace(/Sala alls tíma:\s*/i, 'Sala: ');
  out = out.replace(/Pantanir alls tíma:\s*/i, 'Pantanir: ');
  out = out.replace(/Vinsælasta SKU:\s*/i, 'Top SKU: ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function buildSimplifiedSeoPrompt_(prompt) {
  return truncateForLog_(String(prompt || '').replace(/\s+/g, ' ').trim(), 700);
}

function truncateForLog_(text, maxLen) {
  const str = String(text || '').trim();
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 3)).trim() + '...';
}

function buildGeminiPlainJsonPrompt_(prompt) {
  return [
    'Return only one raw JSON object.',
    'Do not include prose.',
    'Do not include markdown.',
    'Do not include code fences.',
    'Do not say "Here is the JSON".',
    'Use exactly this shape: {"title":"...","description":"..."}',
    'Input:',
    truncateForLog_(prompt, 550)
  ].join('\n');
}

function parseCsvList_(value) {
  return String(value || '')
    .split(',')
    .map(function(item) { return String(item || '').trim(); })
    .filter(Boolean);
}

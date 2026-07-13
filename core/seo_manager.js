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
  'Notes',
  'Live URL',
  'Current OG Image',
  'Image Status',
  'Image Prompt',
  'Suggested Image URL',
  'Image Approved',
  'Image Notes'
];

function getSeoManagerEnv_(opts) {
  opts = opts || {};
  const cfg = loadConfig_();
  const openAiApi = cfg.API.OpenAI || {};
  const openAiEndpoints = cfg.ENDPOINTS.OpenAI || {};
  const geminiApi = cfg.API.Gemini || {};
  const anthropicApi = cfg.API.Anthropic || cfg.API.Claude || {};

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
    claudeApiKey:
      anthropicApi.API_KEY ||
      anthropicApi.KEY ||
      '',
    claudeModel:
      cfg.SETTINGS.SEO_CLAUDE_MODEL ||
      anthropicApi.MODEL ||
      'claude-sonnet-4-6',
    batchSize: Number(cfg.SETTINGS.SEO_BATCH_SIZE || 10),
    sleepMs: Number(cfg.SETTINGS.SEO_BATCH_SLEEP_MS || 600),
    // Image generation always goes through OpenAI (gpt-image) regardless of
    // SEO_PROVIDER, which only governs the text (title/description) model.
    imageModel: cfg.SETTINGS.SEO_IMAGE_MODEL || 'gpt-image-2',
    imageModelFallbacks: parseCsvList_(
      cfg.SETTINGS.SEO_IMAGE_MODEL_FALLBACKS || 'gpt-image-1'
    ),
    imageSize: cfg.SETTINGS.SEO_IMAGE_SIZE || '1536x1024',
    imageQuality: cfg.SETTINGS.SEO_IMAGE_QUALITY || 'medium',
    imageBatchSize: Number(cfg.SETTINGS.SEO_IMAGE_BATCH_SIZE || 8)
  };

  const missing = [];
  if (!env.spreadsheetId) missing.push('SHEETS.SALES_SUMMARIES.ID');
  if (opts.requireAi) {
    if (env.provider === 'gemini' && !env.geminiApiKey) missing.push('API.Gemini.API_KEY');
    if (env.provider === 'openai' && !env.openAiKey) missing.push('API.OpenAI.API_KEY');
    if (env.provider === 'claude' && !env.claudeApiKey) missing.push('API.Anthropic.API_KEY');
  }
  if (opts.requireImage && !env.openAiKey) missing.push('API.OpenAI.API_KEY (needed for image generation)');

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
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash'
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
  const hasData = values.length > 1;
  const currentHeader = values.length
    ? values[0].map(function(v) { return String(v || '').trim(); })
    : [];
  const headerMatches = SEO_QUEUE_HEADER.every(function(col, idx) {
    return currentHeader[idx] === col;
  });

  if (!headerMatches) {
    // Columns get appended over time (e.g. Live URL). An existing header that is
    // a prefix of the expected one is extended in place — NEVER clear a sheet
    // that already holds queue rows.
    const existingCols = currentHeader.filter(Boolean);
    const isPrefix = existingCols.every(function(col, idx) {
      return SEO_QUEUE_HEADER[idx] === col;
    });
    if (hasData && !isPrefix) {
      throw new Error(
        'SEO_QUEUE header does not match expected columns — fix the header row manually to avoid data loss. Expected: ' +
        SEO_QUEUE_HEADER.join(' | ')
      );
    }
    if (!hasData) sh.clearContents();
    sh.getRange(1, 1, 1, SEO_QUEUE_HEADER.length).setValues([SEO_QUEUE_HEADER]);
    if (!hasData) applySheetStyling_(sh, { zebra: true });
  }

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


function generateSEOTitles(categoryName, context, keywordHints, currentMetaTitle, currentMetaDescription, opts) {
  opts = opts || {};
  const env = getSeoManagerEnv_({ requireAi: true });
  const prompt = opts.useV3
    ? buildSeoPromptV3_(categoryName, context, keywordHints, currentMetaTitle, currentMetaDescription, opts)
    : buildSeoPromptV2_(categoryName, context, keywordHints, currentMetaTitle, currentMetaDescription);

  let seo = generateSeoWithProvider_(prompt, env, opts);
  if (!seo.title || !seo.description) {
    throw new Error('AI SEO response missing title/description: ' + JSON.stringify(seo));
  }

  let violations = validateSeoCopy_(seo, opts.level);
  if (violations.length) {
    Logger.log(
      'SEO Manager: "' + categoryName + '" failed validation, retrying -> ' +
      violations.join(' | ')
    );
    try {
      const retry = generateSeoWithProvider_(buildSeoRetryPrompt_(prompt, seo, violations), env, opts);
      if (retry.title && retry.description) {
        const retryViolations = validateSeoCopy_(retry, opts.level);
        if (retryViolations.length <= violations.length) {
          seo = retry;
          violations = retryViolations;
        }
      }
    } catch (retryErr) {
      Logger.log('SEO Manager: validation retry failed for "' + categoryName + '": ' + retryErr);
    }
  }

  const cleaned = {
    title: enforceMaxLength_(sanitizeSeoText_(seo.title), 59),
    description: enforceMaxLength_(sanitizeSeoText_(seo.description), 154),
    warnings: violations
  };

  Logger.log(
    'SEO Manager: generated SEO copy for "' + categoryName + '" -> ' +
    JSON.stringify(cleaned)
  );

  return cleaned;
}

function generateSeoWithProvider_(prompt, env, opts) {
  return env.provider === 'gemini'
    ? generateSeoWithGemini_(prompt, env, opts)
    : env.provider === 'claude'
      ? generateSeoWithClaude_(prompt, env, opts)
      : generateSeoWithOpenAi_(prompt, env, opts);
}

/**
 * Deterministic checks against the SEO title rules (V3, Apr 2025 review).
 * Returns an array of Icelandic violation messages; empty array = valid.
 */
/** Catches package quantity/unit fragments leaking into a LVL3 title hook
 * (e.g. "4stk einingar", "1kg einingum", "24x 500g", "í magni") — these come
 * straight off product pack sizes in Context and aren't search terms. */
var SEO_QTY_HOOK_PATTERN_ = /\d+\s*(stk|x|kg|g|ml|l)\b|\beiningum\b|\beiningar\b|í magni\b/i;

function validateSeoCopy_(seo, level) {
  var title = sanitizeSeoText_(seo && seo.title);
  var description = sanitizeSeoText_(seo && seo.description);
  var lvl = Number(level || 0);
  var violations = [];
  var bannedPhrases = /pantaðu (?:í dag|hér|á storkaup)|fáðu sent hratt|skjót(?:ri)? afhending|mikið úrval/i;

  if (!title) violations.push('Vantar title');
  else {
    if (!/\|\s*Stórkaup$/.test(title)) violations.push('Title verður að enda á "| Stórkaup"');
    if (title.length > 60) violations.push('Title of langur (' + title.length + ' stafir, hámark 60)');
    if (lvl === 1 && !/í heildsölu/i.test(title)) violations.push('LVL1 title á að innihalda "í heildsölu"');
    if (lvl >= 2 && /í heildsölu/i.test(title)) violations.push('"í heildsölu" má aðeins vera á LVL1');
    if (lvl === 3) {
      var titleParts = title.split('|');
      if (titleParts.length < 3) violations.push('LVL3 title vantar hook ("Vara | Hook | Stórkaup")');
      else if (SEO_QTY_HOOK_PATTERN_.test(titleParts[1])) {
        violations.push('LVL3 hook er pakkningastærð/magn ("' + titleParts[1].trim() + '") í stað vörutegundar/notkunarsviðs');
      }
    }
  }

  if (!description) violations.push('Vantar description');
  else {
    if (description.length < 110) violations.push('Description of stutt (' + description.length + ' stafir, mark 130-150)');
    if (description.length > 158) violations.push('Description of löng (' + description.length + ' stafir, mark 130-150)');
  }

  if (bannedPhrases.test(title + ' ' + description)) {
    violations.push('Bannaður frasi ("pantaðu hér/í dag", "skjót afhending", "mikið úrval" o.þ.h.)');
  }

  return violations;
}

function buildSeoRetryPrompt_(prompt, seo, violations) {
  return prompt + '\n\n' + [
    'FYRRI TILRAUN stóðst ekki kröfurnar:',
    'Title: "' + sanitizeSeoText_(seo.title) + '"',
    'Description: "' + sanitizeSeoText_(seo.description) + '"',
    'Vandamál:',
    violations.map(function(v) { return '- ' + v; }).join('\n'),
    'Skilaðu leiðréttri útgáfu sem uppfyllir allar kröfurnar.'
  ].join('\n');
}

/** Level 3 > Level 2 > Level 1 columns decide the category depth of a queue row. */
function seoRowLevel_(row) {
  if (String(row['Level 3'] || '').trim()) return 3;
  if (String(row['Level 2'] || '').trim()) return 2;
  if (String(row['Level 1'] || '').trim()) return 1;
  return 0;
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
        currentMetaDescription,
        { useV3: true, level: seoRowLevel_(row) }
      );

      const hasWarnings = seoData.warnings && seoData.warnings.length;
      writeSeoQueueResult_(queue.sheet, rowNumber, {
        suggestedTitle: seoData.title,
        suggestedDescription: seoData.description,
        status: hasWarnings ? 'NEEDS_REVIEW' : 'GENERATED',
        lastGeneratedAt: new Date(),
        notes: hasWarnings ? 'Validator: ' + seoData.warnings.join(' | ') : ''
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
      currentMetaDescription,
      { useV3: true, level: seoRowLevel_(row) }
    );

    const hasWarnings = seoData.warnings && seoData.warnings.length;
    writeSeoQueueResult_(queue.sheet, rowNumber, {
      suggestedTitle: seoData.title,
      suggestedDescription: seoData.description,
      status: hasWarnings ? 'NEEDS_REVIEW' : 'GENERATED',
      lastGeneratedAt: new Date(),
      notes: hasWarnings ? 'Validator: ' + seoData.warnings.join(' | ') : ''
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

/**
 * Re-runs validateSeoCopy_ on already-GENERATED suggestions and resets failing
 * rows to PENDING (with violations in Notes) so the next batch regenerates them.
 * Pass { dryRun: true } to only report.
 */
function revalidateGeneratedSeoRows_v1(opts) {
  opts = opts || {};
  var queue = getSeoQueueData_();
  var checked = 0;
  var flagged = 0;
  var details = [];

  queue.rows.forEach(function(row) {
    if (normalizeBooleanFlag_(row.Approved)) return;
    if (normalizeStatus_(row.Status) !== 'GENERATED') return;

    var title = String(row['Suggested Meta Title'] || '').trim();
    var description = String(row['Suggested Meta Description'] || '').trim();
    if (!title && !description) return;

    checked++;
    var violations = validateSeoCopy_({ title: title, description: description }, seoRowLevel_(row));
    if (!violations.length) return;

    flagged++;
    details.push({
      rowNumber: row.__rowNumber,
      categoryName: String(row['Category Name'] || ''),
      violations: violations
    });

    if (!opts.dryRun) {
      writeSeoQueueResult_(queue.sheet, row.__rowNumber, {
        status: 'PENDING',
        notes: 'Revalidate: ' + violations.join(' | ')
      });
    }
  });

  var summary = { ok: true, checked: checked, flagged: flagged, dryRun: !!opts.dryRun, details: details };
  Logger.log('[SEO_REVALIDATE] checked=' + checked + ' flagged=' + flagged + ' dryRun=' + !!opts.dryRun);
  return summary;
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
      item.notes || '',
      item.liveUrl || '',
      '', // Current OG Image — filled by fetchCurrentSeoFromWeb_v1
      '', // Image Status
      '', // Image Prompt
      '', // Suggested Image URL
      '', // Image Approved
      ''  // Image Notes
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

function testGeminiSpeed() {
  var env = getSeoManagerEnv_({ requireAi: true });
  var modelsToTest = [
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-flash'
  ];

  modelsToTest.forEach(function(model) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent';

    var start = Date.now();
    Logger.log('[testGeminiSpeed] Calling: ' + model);

    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': env.geminiApiKey },
      payload: JSON.stringify({
        contents: [{ parts: [{ text: 'Return JSON: {"title":"Hanskar | Stórkaup","description":"Einnota hanskar fyrir fyrirtæki."}' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 100 }
      }),
      muteHttpExceptions: true
    });

    var elapsed = Date.now() - start;
    Logger.log('[testGeminiSpeed] ' + model +
      ' → status=' + res.getResponseCode() +
      ', time=' + elapsed + 'ms');
  });
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

/************************************************************
 * SEO IMAGE GENERATION (PHASE 2)
 * - Detects category rows still on a shared/generic OG image
 * - Generates a bespoke OG image per category via OpenAI gpt-image,
 *   using the live product list already crawled into Context
 * - Saves to Drive, human reviews Suggested Image URL before uploading
 *   the approved image into Prismic (same manual-paste pattern as text)
 ************************************************************/

var SEO_IMAGE_STYLE_BY_LEVEL1_ = {
  'Matvörur': 'Top-down flatlay food photography on a cool grey concrete surface, soft natural daylight, appetizing commercial catalogue style.',
  'Áfengir drykkir': 'Lifestyle photography — glassware and bottles in a modern hospitality/lounge setting, warm ambient lighting.',
  'Heilbrigðisvörur': 'Clean clinical flatlay on a white or light-grey surface, bright even lighting, medical/healthcare supply catalogue style.',
  'Rekstrarvörur': 'Top-down flatlay of operational/cleaning supplies on a cool grey concrete surface, soft natural daylight, professional catalogue style.',
  'Vélar og tæki': 'Lifestyle photography of professional cleaning or facility work in progress, modern commercial interior, natural lighting.'
};
var SEO_IMAGE_STYLE_DEFAULT_ = 'Professional flatlay product photography on a neutral grey surface, soft natural daylight, clean commercial catalogue style.';

function buildSeoImagePrompt_(categoryName, level1, liveProductsText) {
  var style = SEO_IMAGE_STYLE_BY_LEVEL1_[String(level1 || '').trim()] || SEO_IMAGE_STYLE_DEFAULT_;
  var productLine = liveProductsText
    ? ('Feature an assortment representative of: ' + liveProductsText +
       '. Show the products themselves (unwrapped/unbranded where sensible), not sealed retail packaging with logos.')
    : ('Feature a representative assortment of products from this category: ' + categoryName + '.');

  return [
    'Professional commercial photography for a B2B wholesale website category image.',
    style,
    productLine,
    'Natural, true-to-life colors — nothing neon, cartoonish, or overly staged.',
    'Leave the top-left quadrant of the frame relatively open and uncluttered (plain surface/background, no props) so a logo can be composited there afterward.',
    'No visible brand logos, no readable text or packaging labels anywhere in the image.',
    'Landscape composition, high resolution, photorealistic.'
  ].join(' ');
}

/** Pulls the live/Cludo product-example line already written into Context by
 * fetchLiveCategoryProductsFromWeb_v1 / buildSeoQueueFromCludo_v1, for reuse
 * in the image prompt. Returns '' if neither is present (prompt then falls
 * back to the bare category name). */
function extractProductNamesFromContext_(context) {
  var text = String(context || '');
  var m = text.match(/Vörur á síðunni núna:\s*([^.]*)\./) || text.match(/Dæmi um vörur:\s*([^.]*)\./);
  return m ? m[1].trim() : '';
}

function getSeoImageModelChain_(env) {
  var configured = [env.imageModel].concat(env.imageModelFallbacks || [])
    .map(function(m) { return String(m || '').trim(); })
    .filter(Boolean);
  return configured.length ? configured : ['gpt-image-2', 'gpt-image-1'];
}

function generateSeoImageWithOpenAi_(prompt, env) {
  if (!env.openAiKey) {
    throw new Error('SEO_IMAGE CONFIG ERROR — missing API.OpenAI.API_KEY (image generation always uses OpenAI, regardless of SEO_PROVIDER).');
  }
  var models = getSeoImageModelChain_(env);
  var size = env.imageSize || '1536x1024';
  var quality = env.imageQuality || 'medium';
  var lastErr = null;

  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    try {
      var res = UrlFetchApp.fetch('https://api.openai.com/v1/images/generations', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + env.openAiKey },
        payload: JSON.stringify({
          model: model,
          prompt: prompt,
          size: size,
          quality: quality,
          output_format: 'jpeg',
          n: 1
        }),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = safeJsonParse_(res.getContentText()) || {};
      if (code === 200 && body.data && body.data[0] && body.data[0].b64_json) {
        return { base64: body.data[0].b64_json, model: model };
      }
      lastErr = new Error('HTTP ' + code + ': ' + truncateForLog_(res.getContentText(), 300));
      Logger.log('[SEO_IMAGE] model ' + model + ' failed: ' + lastErr.message);
    } catch (err) {
      lastErr = err;
      Logger.log('[SEO_IMAGE] model ' + model + ' threw: ' + (err && err.message ? err.message : err));
    }
  }
  throw lastErr || new Error('OpenAI image generation failed for all configured models.');
}

function getOrCreateSeoImageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty('SEO_IMAGE_DRIVE_FOLDER_ID');
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); } catch (e) { /* recreate below */ }
  }
  var folder = DriveApp.createFolder('Stórkaup SEO — Generated OG Images');
  props.setProperty('SEO_IMAGE_DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function saveSeoImageToDrive_(base64Data, filename) {
  var folder = getOrCreateSeoImageFolder_();
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, 'image/jpeg', filename);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    fileId: file.getId(),
    url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200'
  };
}

/**
 * Classifies queue rows by whether their Current OG Image is shared by many
 * other categories (>= threshold occurrences → generic fallback, needs a
 * bespoke image) or is unique-ish (already has a custom photo — skip).
 * No hardcoded fallback filenames: genericness is inferred from reuse count,
 * so it keeps working as Stórkaup adds more bespoke images over time.
 * Only touches rows with no/PENDING/HAS_CUSTOM status — leaves
 * GENERATED/ERROR/NEEDS_REVIEW rows alone. Run after a full
 * fetchCurrentSeoFromWeb_v1 pass so 'Current OG Image' is populated.
 */
function flagCategoriesNeedingImage_v1(opts) {
  opts = opts || {};
  var threshold = opts.threshold != null ? Number(opts.threshold) : 3;
  var queue = getSeoQueueData_();
  var header = SEO_QUEUE_HEADER;
  var imgColIdx = header.indexOf('Current OG Image');
  var statusColIdx = header.indexOf('Image Status');
  if (imgColIdx === -1 || statusColIdx === -1) {
    throw new Error('SEO_QUEUE missing Current OG Image / Image Status columns — run Setup SEO Queue first.');
  }

  var counts = {};
  queue.rows.forEach(function(row) {
    var img = String(row['Current OG Image'] || '').trim();
    if (img) counts[img] = (counts[img] || 0) + 1;
  });

  var pending = 0;
  var hasCustom = 0;
  queue.rows.forEach(function(row) {
    if (normalizeBooleanFlag_(row['Image Approved'])) return;
    var currentStatus = String(row['Image Status'] || '').trim().toUpperCase();
    if (currentStatus && currentStatus !== 'PENDING' && currentStatus !== 'HAS_CUSTOM') return;

    var img = String(row['Current OG Image'] || '').trim();
    var isShared = !img || (counts[img] || 0) >= threshold;
    var newStatus = isShared ? 'PENDING' : 'HAS_CUSTOM';
    if (currentStatus === newStatus) return;
    queue.sheet.getRange(row.__rowNumber, statusColIdx + 1).setValue(newStatus);
    if (newStatus === 'PENDING') pending++; else hasCustom++;
  });

  var summary = { ok: true, pending: pending, hasCustom: hasCustom, threshold: threshold, total: queue.rows.length };
  Logger.log('[SEO_IMAGE_FLAG] ' + JSON.stringify(summary));
  return summary;
}

function writeSeoQueueImageResult_(sheet, rowNumber, updates) {
  var header = SEO_QUEUE_HEADER;
  var range = sheet.getRange(rowNumber, 1, 1, header.length);
  var row = range.getValues()[0];
  function setCol(name, value) {
    var idx = header.indexOf(name);
    if (idx !== -1) row[idx] = value;
  }
  if ('imagePrompt' in updates) setCol('Image Prompt', updates.imagePrompt);
  if ('imageUrl' in updates) setCol('Suggested Image URL', updates.imageUrl);
  if ('imageStatus' in updates) setCol('Image Status', updates.imageStatus);
  if ('imageNotes' in updates) setCol('Image Notes', updates.imageNotes);
  range.setValues([row]);
}

/** ~$/image at medium quality, 1536x1024 (OpenAI pricing, mid-2026) — informational only, shown in batch summaries so cost stays visible. */
var SEO_IMAGE_APPROX_COST_ = 0.06;

/**
 * Zero-cost alternative to runSeoImageAutomationBatch_v1: writes the image
 * prompt into 'Image Prompt' (status PROMPT_READY) without calling any paid
 * API. Human copies the prompt into the ChatGPT app, generates/picks the
 * image there, and uploads it straight into Prismic — no OpenAI billing
 * needed. Set 'Image Approved' once done so the row drops out of future runs.
 */
function runSeoImagePromptOnlyBatch_v1(opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var stateKey = 'SEO_IMAGE_PROMPT_ONLY_LAST_ROW';
  var queue = getSeoQueueData_();
  var rows = queue.rows;

  var batchSize = Math.max(1, Number(opts.batchSize || 40));
  var eligible = rows.filter(function(row) {
    if (normalizeBooleanFlag_(row['Image Approved'])) return false;
    var status = String(row['Image Status'] || '').trim().toUpperCase();
    if (opts.forceRegenerate) return status !== 'HAS_CUSTOM';
    return status === 'PENDING' || status === 'ERROR';
  });

  if (!eligible.length) {
    Logger.log('[SEO_IMAGE_PROMPT_ONLY] no eligible rows.');
    return { ok: true, processed: 0, eligible: 0, total: rows.length };
  }

  var startIndex = Number(opts.startIndex != null ? opts.startIndex : props.getProperty(stateKey) || 0);
  if (startIndex >= eligible.length) startIndex = 0;

  var batch = eligible.slice(startIndex, startIndex + batchSize);
  var results = [];

  batch.forEach(function(row) {
    var rowNumber = row.__rowNumber;
    try {
      var categoryName = String(row['Category Name'] || '').trim();
      if (!categoryName) throw new Error('Row has no Category Name.');
      var level1 = String(row['Level 1'] || '').trim();
      var liveProducts = extractProductNamesFromContext_(row.Context);
      var prompt = buildSeoImagePrompt_(categoryName, level1, liveProducts);

      writeSeoQueueImageResult_(queue.sheet, rowNumber, {
        imagePrompt: prompt,
        imageStatus: 'PROMPT_READY',
        imageNotes: ''
      });
      results.push({ ok: true, rowNumber: rowNumber, categoryName: categoryName });
    } catch (err) {
      var msg = err && err.message ? err.message : String(err || 'Unknown error');
      writeSeoQueueImageResult_(queue.sheet, rowNumber, { imageStatus: 'ERROR', imageNotes: msg });
      results.push({ ok: false, rowNumber: rowNumber, error: msg });
    }
  });

  var nextIndex = startIndex + batch.length < eligible.length ? startIndex + batch.length : 0;
  props.setProperty(stateKey, String(nextIndex));

  var summary = {
    ok: true,
    processed: batch.length,
    eligible: eligible.length,
    nextRow: nextIndex,
    total: rows.length,
    successCount: results.filter(function(r) { return r.ok; }).length,
    errorCount: results.filter(function(r) { return !r.ok; }).length
  };
  Logger.log('[SEO_IMAGE_PROMPT_ONLY] summary: ' + JSON.stringify(summary));
  return summary;
}

function runSeoImagePromptForSelectedRow_v1() {
  var queue = getSeoQueueData_();
  var sheet = queue.sheet;
  var activeSheet = SpreadsheetApp.getActiveSheet();
  if (!activeSheet || activeSheet.getName() !== sheet.getName()) {
    throw new Error('Open SEO_QUEUE sheet and select a data row first.');
  }
  var rowNumber = activeSheet.getActiveCell().getRow();
  if (rowNumber < 2) {
    throw new Error('Select a queue data row, not the header row.');
  }

  var row = queue.rows.find(function(item) { return item.__rowNumber === Number(rowNumber); });
  if (!row) throw new Error('SEO queue row not found: ' + rowNumber);
  var categoryName = String(row['Category Name'] || '').trim();
  if (!categoryName) throw new Error('Selected row has no Category Name.');

  var level1 = String(row['Level 1'] || '').trim();
  var liveProducts = extractProductNamesFromContext_(row.Context);
  var prompt = buildSeoImagePrompt_(categoryName, level1, liveProducts);

  writeSeoQueueImageResult_(queue.sheet, rowNumber, {
    imagePrompt: prompt,
    imageStatus: 'PROMPT_READY',
    imageNotes: ''
  });
  return { ok: true, rowNumber: rowNumber, categoryName: categoryName, prompt: prompt };
}

function runSeoImageAutomationBatch_v1(opts) {
  opts = opts || {};
  var env = getSeoManagerEnv_({ requireImage: true });
  var props = PropertiesService.getScriptProperties();
  var stateKey = 'SEO_IMAGE_MANAGER_LAST_ROW';
  var queue = getSeoQueueData_();
  var rows = queue.rows;

  var batchSize = Math.max(1, Number(opts.batchSize || env.imageBatchSize || 8));
  var eligible = rows.filter(function(row) {
    if (normalizeBooleanFlag_(row['Image Approved'])) return false;
    var status = String(row['Image Status'] || '').trim().toUpperCase();
    if (opts.forceRegenerate) return status !== 'HAS_CUSTOM';
    return status === 'PENDING' || status === 'ERROR' || status === 'NEEDS_REVIEW';
  });

  if (!eligible.length) {
    Logger.log('[SEO_IMAGE_BATCH] no eligible rows.');
    return { ok: true, processed: 0, eligible: 0, total: rows.length, estimatedCost: 0 };
  }

  var startIndex = Number(opts.startIndex != null ? opts.startIndex : props.getProperty(stateKey) || 0);
  if (startIndex >= eligible.length) startIndex = 0;

  var batch = eligible.slice(startIndex, startIndex + batchSize);
  var results = [];

  Logger.log('[SEO_IMAGE_BATCH] starting ' + startIndex + '-' + (startIndex + batch.length - 1) + ' of ' + eligible.length);

  batch.forEach(function(row, idx) {
    var rowNumber = row.__rowNumber;
    try {
      var categoryName = String(row['Category Name'] || '').trim();
      if (!categoryName) throw new Error('Row has no Category Name.');
      var level1 = String(row['Level 1'] || '').trim();
      var liveProducts = extractProductNamesFromContext_(row.Context);
      var prompt = buildSeoImagePrompt_(categoryName, level1, liveProducts);

      var gen = generateSeoImageWithOpenAi_(prompt, env);
      var slug = categoryPathToSlug_(String(row['Category Path'] || categoryName)) || 'category';
      var saved = saveSeoImageToDrive_(gen.base64, 'seo-og-' + slug + '.jpg');

      writeSeoQueueImageResult_(queue.sheet, rowNumber, {
        imagePrompt: prompt,
        imageUrl: saved.url,
        imageStatus: 'GENERATED',
        imageNotes: 'model=' + gen.model
      });
      results.push({ ok: true, rowNumber: rowNumber, categoryName: categoryName });
    } catch (err) {
      var msg = err && err.message ? err.message : String(err || 'Unknown error');
      writeSeoQueueImageResult_(queue.sheet, rowNumber, { imageStatus: 'ERROR', imageNotes: msg });
      Logger.log('[SEO_IMAGE_BATCH] ERROR row ' + rowNumber + ': ' + msg);
      results.push({ ok: false, rowNumber: rowNumber, error: msg });
    }
    if (idx < batch.length - 1 && env.sleepMs > 0) Utilities.sleep(env.sleepMs);
  });

  var nextIndex = startIndex + batch.length < eligible.length ? startIndex + batch.length : 0;
  props.setProperty(stateKey, String(nextIndex));

  var successCount = results.filter(function(r) { return r.ok; }).length;
  var summary = {
    ok: true,
    processed: batch.length,
    eligible: eligible.length,
    nextRow: nextIndex,
    total: rows.length,
    successCount: successCount,
    errorCount: results.length - successCount,
    estimatedCost: Math.round(successCount * SEO_IMAGE_APPROX_COST_ * 100) / 100,
    results: results
  };
  Logger.log('[SEO_IMAGE_BATCH] summary: ' + JSON.stringify(summary));
  return summary;
}

function runSeoImageForSelectedRow_v1() {
  var queue = getSeoQueueData_();
  var sheet = queue.sheet;
  var activeSheet = SpreadsheetApp.getActiveSheet();
  if (!activeSheet || activeSheet.getName() !== sheet.getName()) {
    throw new Error('Open SEO_QUEUE sheet and select a data row first.');
  }
  var rowNumber = activeSheet.getActiveCell().getRow();
  if (rowNumber < 2) {
    throw new Error('Select a queue data row, not the header row.');
  }
  return runSeoImageForRowNumber_v1(rowNumber);
}

function runSeoImageForRowNumber_v1(rowNumber) {
  var env = getSeoManagerEnv_({ requireImage: true });
  var queue = getSeoQueueData_();
  var row = queue.rows.find(function(item) { return item.__rowNumber === Number(rowNumber); });
  if (!row) throw new Error('SEO queue row not found: ' + rowNumber);

  var categoryName = String(row['Category Name'] || '').trim();
  if (!categoryName) throw new Error('Selected row has no Category Name.');
  if (normalizeBooleanFlag_(row['Image Approved'])) throw new Error('Selected row image is already approved.');

  var level1 = String(row['Level 1'] || '').trim();
  var liveProducts = extractProductNamesFromContext_(row.Context);
  var prompt = buildSeoImagePrompt_(categoryName, level1, liveProducts);

  try {
    var gen = generateSeoImageWithOpenAi_(prompt, env);
    var slug = categoryPathToSlug_(String(row['Category Path'] || categoryName)) || 'category';
    var saved = saveSeoImageToDrive_(gen.base64, 'seo-og-' + slug + '.jpg');

    writeSeoQueueImageResult_(queue.sheet, rowNumber, {
      imagePrompt: prompt,
      imageUrl: saved.url,
      imageStatus: 'GENERATED',
      imageNotes: 'model=' + gen.model
    });
    return { ok: true, rowNumber: rowNumber, categoryName: categoryName, imageUrl: saved.url };
  } catch (err) {
    var msg = err && err.message ? err.message : String(err || 'Unknown error');
    writeSeoQueueImageResult_(queue.sheet, rowNumber, { imageStatus: 'ERROR', imageNotes: msg });
    throw err;
  }
}

function generateSeoWithOpenAi_(prompt, env, opts) {
  opts = opts || {};
  const payload = {
    model: env.openAiModel,
    temperature: opts.temperature != null ? Number(opts.temperature) : 0.4,
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

function generateSeoWithGemini_(prompt, env, opts) {
  opts = opts || {};
  const models = getSafeGeminiModelChain_(env);

  let lastError = '';
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return generateSeoWithGeminiModel_(prompt, env, model, opts);
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

function generateSeoWithGeminiModel_(prompt, env, model, opts) {
  opts = opts || {};
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
      temperature: opts.temperature != null ? Number(opts.temperature) : 0.3,
      maxOutputTokens: 256,
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
  const retrySeo = generateSeoWithGeminiPlainJsonV2_(simplifiedPrompt, env, model, opts);
  if (retrySeo.title && retrySeo.description) return retrySeo;

  throw new Error(
    'Gemini returned no usable JSON [' + model + ']. Raw text: ' +
    truncateForLog_(content || extractGeminiDiagnostics_(parsed), 600)
  );
}


function generateSeoWithGeminiPlainJsonV2_(prompt, env, model, opts) {
  opts = opts || {};
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
      temperature: opts.temperature != null ? Number(opts.temperature) : 0.1,
      maxOutputTokens: 256,
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

/**
 * Counts SEO_QUEUE rows by text-meta Status/Approved and image Status/Approved,
 * so "what's left to do" is a glance instead of manually scanning 260+ rows.
 */
function seoQueueStatusSummary_v1() {
  var queue = getSeoQueueData_();
  var textByStatus = {};
  var imageByStatus = {};
  var textApproved = 0;
  var imageApproved = 0;

  queue.rows.forEach(function(row) {
    var approved = normalizeBooleanFlag_(row.Approved);
    if (approved) textApproved++;
    else {
      var status = normalizeStatus_(row.Status) || '(tómt)';
      textByStatus[status] = (textByStatus[status] || 0) + 1;
    }

    var imageApprovedFlag = normalizeBooleanFlag_(row['Image Approved']);
    if (imageApprovedFlag) imageApproved++;
    else {
      var imgStatus = normalizeStatus_(row['Image Status']) || '(tómt)';
      imageByStatus[imgStatus] = (imageByStatus[imgStatus] || 0) + 1;
    }
  });

  return {
    ok: true,
    total: queue.rows.length,
    textApproved: textApproved,
    textByStatus: textByStatus,
    imageApproved: imageApproved,
    imageByStatus: imageByStatus
  };
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

/************************************************************
 * SEO PROMPT V3 + REVISE FLOW
 ************************************************************/

var SEO_KNOWN_BRANDS_ = [
  'Tork', 'Katla', 'Lavazza', 'Diversey', 'Tena', 'Leifheit', 'Vileda',
  'Scotch-Brite', 'Flash', 'Fairy', 'Ariel', 'Lenor', 'Persil', 'Vanish',
  'Kimberly-Clark', '3M', 'Dettol', 'Domestos', 'Rubbermaid', 'Brabantia'
];

var SEO_KNOWN_ATTRIBUTES_ = [
  'Svanurinn', 'Svansmerktur', 'Umhverfisvænt', 'Umhverfisvænn',
  'Nitril', 'Latex', 'Vinyl', 'Einnota', 'Lífrænt',
  'Hitaþolið', 'Vatnsþétt', 'Sýklalæsing', 'FDA', 'HACCP'
];

function detectBrandsFromText_(text) {
  var lower = String(text || '').toLowerCase();
  var fromWhitelist = SEO_KNOWN_BRANDS_.filter(function(brand) {
    return lower.indexOf(brand.toLowerCase()) !== -1;
  });
  // Live-crawled product brands (see fetchLiveCategoryProductsFromWeb_v1) are
  // written into Context as "Name (Brand)" — this catches real brands that
  // aren't in the static SEO_KNOWN_BRANDS_ whitelist above.
  var fromParens = extractParentheticalBrands_(text);
  return fromWhitelist.concat(fromParens).filter(function(b, i, arr) {
    return arr.indexOf(b) === i;
  });
}

function extractParentheticalBrands_(text) {
  var found = {};
  var re = /\(([A-ZÁÉÍÓÚÝÞÆÖÐ][^()]{1,30})\)/g;
  var m;
  while ((m = re.exec(String(text || ''))) !== null) {
    found[m[1].trim()] = true;
  }
  return Object.keys(found);
}

function detectAttributesFromText_(text) {
  var lower = String(text || '').toLowerCase();
  return SEO_KNOWN_ATTRIBUTES_.filter(function(attr) {
    return lower.indexOf(attr.toLowerCase()) !== -1;
  });
}

function buildSeoPromptV3_(categoryName, context, keywordHints, currentMetaTitle, currentMetaDescription, opts) {
  opts = opts || {};
  var compact = compactSeoInputs_(context, keywordHints);
  var searchText = (compact.context || '') + ' ' + (compact.keywordHints || '');
  var brands = detectBrandsFromText_(searchText);
  var attributes = detectAttributesFromText_(searchText);

  var level = Number(opts.level || 0);

  // Title structure rules from SEO review (Atli, Apr 2025)
  var titleRule = level === 1
    ? 'Title form: "X í heildsölu | Stórkaup" — broad landing page, "í heildsölu" is justified here.'
    : level === 2
      ? 'Title form: "Flokkur | Undirflokkur | Stórkaup" — context separates the subcategory, no "í heildsölu".'
      : 'Title form: "Vara | Hook | Stórkaup" — specific, direct, no "í heildsölu".';

  var levelGuidance = level === 1
    ? 'LVL1 aðalflokkur: heildarúrval og lausnir fyrir fyrirtæki.'
    : 'LVL2/3 undirflokkur: vertu sértækur — nefndu vörumerki, eiginleika eða notkunarsvið ef við á.\n' +
      'Hook-hlutinn í title (milli fyrsta og seinasta "|") á að vera 1-3 orð sem lýsa ' +
      'vörutegund, afbrigði eða notkunarsviði — t.d. "Hvítvín og rauðvín", "Nítríl og latex", ' +
      '"Fyrir sjúkrahús og hjúkrunarheimili". ALDREI pakkningastærð, magn eða einingafjölda ' +
      '(slæm dæmi: "4stk einingar", "1kg einingum", "24x 500g", "í magni") — þetta eru ekki ' +
      'leitarorð sem fólk notar og bæta engu SEO-gildi við. Ef samhengið inniheldur bara ' +
      'vörulista með pakkningastærðum, dragðu vörutegundina/afbrigðið út úr vöruheitunum ' +
      'sjálfum í staðinn fyrir að endurtaka magntöluna.';

  var brandNote = brands.length
    ? 'Vörumerki sem finnast í gögnum: ' + brands.join(', ') + ' — SKAL nota ef þau passa náttúrulega.'
    : '';
  var attrNote = attributes.length
    ? 'Eiginleikar: ' + attributes.join(', ') + ' — SKAL nefna ef við á.'
    : '';

  return [
    'Þú ert SEO sérfræðingur fyrir Stórkaup.is.',
    'Skrifaðu Meta Title og Meta Description fyrir vöruflokkinn.',
    'Flokkur: ' + categoryName,
    levelGuidance,
    titleRule,
    'MIKILVÆGT um title: Notaðu NAFNORÐ og notkunarsamband — ENGIN lýsingarorð (ekki "faglegar", "gæðamikið", "úrvalsleg").',
    '"í heildsölu" má AÐEINS vera í LVL1 titles — aldrei í LVL2 eða LVL3.',
    'Samhengi: ' + (compact.context || 'Engin frekari samantekt tiltæk.'),
    compact.keywordHints ? ('Keyword hints: ' + compact.keywordHints) : '',
    brandNote,
    attrNote,
    currentMetaTitle ? ('Núverandi Meta Title: ' + currentMetaTitle) : '',
    currentMetaDescription ? ('Núverandi Meta Description: ' + currentMetaDescription) : '',
    'Description: endaðu gjarnan á mjúku CTA, t.d. "Skoðaðu vöruúrvalið hér.", "Kynntu þér úrvalið." eða "Fáðu tilboð hjá okkur." — veldu það sem passar flokknum, ekki alltaf sama frasann. ALDREI "Pantaðu hér" eða "Pantaðu í dag". "í magni" hentar í description sem longtail keyword.',
    'Leggðu áherslu á rekstrarþarfir fyrirtækja, gæði og traust.',
    'Tungumál: Íslenska.',
    'Stíll: professional B2B, beinn og trúverðugur.',
    'Strict limit: Title must be between 40-55 characters. Description must be between 130-150 characters.',
    'Forðastu keyword stuffing, of almennan texta og auglýsingalegan tón.',
    'Ekki nota "pantaðu í dag", "pantaðu hér", "fáðu sent hratt", "skjót afhending", "mikið úrval".',
    'Ekki lofa hraðri afhendingu nema það sé beinlínis studd af samhenginu.',
    'Skrifaðu eins og fyrir íslenskan fyrirtækjamarkað, ekki eins og fyrir neytendaauglýsingu.',
    'Ekki bæta við inngangI, skýringum eða texta eins og "Here is the JSON requested".',
    'Return only raw JSON with this exact shape: {"title":"...","description":"..."}'
  ].filter(Boolean).join('\n');
}

function buildSeoRevisePrompt_(categoryName, suggestedTitle, suggestedDescription, notes) {
  return [
    'Þú ert SEO sérfræðingur fyrir Stórkaup.is.',
    'Endurskoðaðu og bættu eftirfarandi Meta Title og Meta Description fyrir vöruflokkinn: ' + categoryName,
    '',
    'Núverandi tillaga:',
    'Meta Title: ' + (suggestedTitle || '(engin tillaga)'),
    'Meta Description: ' + (suggestedDescription || '(engin tillaga)'),
    '',
    notes
      ? 'Athugasemdir til að taka tillit til:\n' + notes
      : 'Engar sérstakar athugasemdir — gerðu textann ennþá grípandi og sannfærandi.',
    '',
    'Tungumál: Íslenska.',
    'Stíll: professional B2B, beinn og trúverðugur.',
    'Strict limit: Title must be between 40-55 characters. Description must be between 130-150 characters.',
    'Forðastu keyword stuffing, of almennan texta og auglýsingalegan tón.',
    'Ekki nota setningar eins og "pantaðu í dag", "pantaðu hér", "fáðu sent hratt", "skjót afhending", "mikið úrval".',
    'Skrifaðu eins og fyrir íslenskan fyrirtækjamarkað, ekki eins og fyrir neytendaauglýsingu.',
    'Ekki bæta við inngangI, skýringum eða texta eins og "Here is the JSON requested".',
    'Return only raw JSON with this exact shape: {"title":"...","description":"..."}'
  ].filter(Boolean).join('\n');
}

function reviseSEOTitles(categoryName, suggestedTitle, suggestedDescription, notes) {
  var opts = { temperature: 0.5 };
  var env = getSeoManagerEnv_({ requireAi: true });
  var prompt = buildSeoRevisePrompt_(categoryName, suggestedTitle, suggestedDescription, notes);

  var seo = generateSeoWithProvider_(prompt, env, opts);

  if (!seo.title || !seo.description) {
    throw new Error('AI SEO revise response missing title/description: ' + JSON.stringify(seo));
  }

  var cleaned = {
    title: enforceMaxLength_(sanitizeSeoText_(seo.title), 59),
    description: enforceMaxLength_(sanitizeSeoText_(seo.description), 154)
  };

  Logger.log(
    'SEO Manager: revised SEO copy for "' + categoryName + '" -> ' +
    JSON.stringify(cleaned)
  );

  return cleaned;
}

function runReviseSeoForSelectedRows_v1() {
  var queue = getSeoQueueData_();
  var sheet = queue.sheet;
  var activeSheet = SpreadsheetApp.getActiveSheet();

  if (!activeSheet || activeSheet.getName() !== sheet.getName()) {
    throw new Error('Open SEO_QUEUE sheet and select one or more data rows first.');
  }

  var activeRange = SpreadsheetApp.getActiveRange();
  if (!activeRange) {
    throw new Error('No range selected. Select one or more data rows first.');
  }

  var startRow = activeRange.getRow();
  var endRow = activeRange.getLastRow();

  if (startRow < 2) {
    throw new Error('Select data rows only — not the header row.');
  }

  var env = getSeoManagerEnv_({ requireAi: true });
  var results = [];

  for (var rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
    var row = null;
    for (var r = 0; r < queue.rows.length; r++) {
      if (queue.rows[r].__rowNumber === rowNumber) {
        row = queue.rows[r];
        break;
      }
    }
    if (!row) continue;

    var categoryName = String(row['Category Name'] || '').trim();
    if (!categoryName) continue;

    if (normalizeBooleanFlag_(row.Approved)) {
      Logger.log('SEO Manager: skipping approved row ' + rowNumber + ' (' + categoryName + ')');
      results.push({ ok: true, rowNumber: rowNumber, categoryName: categoryName, skipped: true });
      continue;
    }

    var suggestedTitle = String(row['Suggested Meta Title'] || '').trim();
    var suggestedDescription = String(row['Suggested Meta Description'] || '').trim();
    var notes = String(row.Notes || '').trim();

    try {
      var seoData = reviseSEOTitles(categoryName, suggestedTitle, suggestedDescription, notes);

      writeSeoQueueResult_(queue.sheet, rowNumber, {
        suggestedTitle: seoData.title,
        suggestedDescription: seoData.description,
        status: 'REVISED',
        lastGeneratedAt: new Date()
      });

      results.push({ ok: true, rowNumber: rowNumber, categoryName: categoryName, seoData: seoData });

    } catch (err) {
      var errMessage = err && err.message ? err.message : String(err || 'Unknown error');
      writeSeoQueueResult_(queue.sheet, rowNumber, {
        status: 'ERROR',
        lastGeneratedAt: new Date(),
        notes: errMessage
      });
      results.push({ ok: false, rowNumber: rowNumber, categoryName: categoryName, error: errMessage });
      Logger.log('SEO Manager REVISE ERROR [row ' + rowNumber + ']: ' + errMessage);
    }

    if (rowNumber < endRow && env.sleepMs > 0) {
      Utilities.sleep(env.sleepMs);
    }
  }

  var summary = {
    ok: true,
    processed: results.filter(function(r) { return !r.skipped; }).length,
    skipped: results.filter(function(r) { return r.skipped; }).length,
    successCount: results.filter(function(r) { return r.ok && !r.skipped; }).length,
    errorCount: results.filter(function(r) { return !r.ok; }).length,
    results: results
  };

  Logger.log('SEO Manager revise summary: ' + JSON.stringify(summary));
  return summary;
}

/************************************************************
 * CLAUDE (ANTHROPIC) PROVIDER
 ************************************************************/

function generateSeoWithClaude_(prompt, env, opts) {
  opts = opts || {};
  if (!env.claudeApiKey) {
    throw new Error('Claude API key not configured. Add API.Anthropic.API_KEY to config.');
  }

  const payload = {
    model: env.claudeModel,
    max_tokens: 256,
    temperature: opts.temperature != null ? Number(opts.temperature) : 0.3,
    system: [
      'Þú skrifar stuttan, sannfærandi og hnitmiðaðan SEO texta á íslensku.',
      'Skrifaðu á kjarnyrtri íslensku. Notaðu nafnorð og notkunarsamband — engin lýsingarorð.',
      'Hentar íslenskum B2B fyrirtækjamarkaði, ekki neytendaauglýsingum.'
    ].join(' '),
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': env.claudeApiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Claude SEO generation failed (' + code + '): ' + body);
  }

  const parsed = safeJsonParse_(body) || {};
  const content = extractClaudeMessageContent_(parsed);
  return parseSeoJson_(content);
}

function extractClaudeMessageContent_(payload) {
  try {
    const blocks = Array.isArray(payload.content) ? payload.content : [];
    return blocks
      .filter(function(b) { return b && b.type === 'text'; })
      .map(function(b) { return b.text || ''; })
      .join('');
  } catch (_) {
    return '';
  }
}

/************************************************************
 * IMPORT SEO FROM EXCEL SHEET
 * importSeoFromExcelSheet_v1(sheetName) — reads an imported
 * Excel tab and seeds matching rows into SEO_QUEUE as GENERATED
 ************************************************************/

function importSeoFromExcelSheet_v1(sheetName) {
  sheetName = sheetName || 'Storkaup meta seo v2';
  const env = getSeoManagerEnv_();
  const ss = SpreadsheetApp.openById(env.spreadsheetId);
  const src = ss.getSheetByName(sheetName);
  if (!src) {
    throw new Error('Sheet not found: "' + sheetName + '". Import the Excel file first.');
  }

  const values = src.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('Sheet "' + sheetName + '" has no data rows.');
  }

  // Normalise header names for flexible column matching
  const rawHeader = values[0].map(function(v) { return String(v || '').trim(); });
  function findCol(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var needle = candidates[i].toLowerCase();
      for (var j = 0; j < rawHeader.length; j++) {
        if (rawHeader[j].toLowerCase().indexOf(needle) !== -1) return j;
      }
    }
    return -1;
  }

  const colCategory    = findCol(['category', 'flokkur', 'category name']);
  const colTitle       = findCol(['meta title', 'title']);
  const colDesc        = findCol(['meta description', 'description', 'lýsing']);
  const colKeywords    = findCol(['keyword', 'leitarorð']);
  const colLevel       = findCol(['lvl', 'level', 'stig']);
  const colPath        = findCol(['path', 'slóð']);

  if (colCategory === -1 || colTitle === -1 || colDesc === -1) {
    throw new Error(
      'Could not find required columns (Category, Meta Title, Meta Description) in "' +
      sheetName + '". Headers found: ' + rawHeader.join(', ')
    );
  }

  const items = [];
  for (var r = 1; r < values.length; r++) {
    const row = values[r];
    const categoryName = String(row[colCategory] || '').trim();
    const title        = String(row[colTitle] || '').trim();
    const description  = String(row[colDesc] || '').trim();
    if (!categoryName || !title) continue;

    const levelRaw = colLevel !== -1 ? String(row[colLevel] || '').trim().toUpperCase() : '';
    const level    = levelRaw === 'LVL1' || levelRaw === '1' ? 1
                   : levelRaw === 'LVL2' || levelRaw === '2' ? 2
                   : levelRaw === 'LVL3' || levelRaw === '3' ? 3
                   : 0;

    items.push({
      categoryName:        categoryName,
      categoryPath:        colPath !== -1 ? String(row[colPath] || '').trim() : '',
      level1:              level === 1 ? categoryName : '',
      level2:              level === 2 ? categoryName : '',
      level3:              level === 3 ? categoryName : '',
      keywordHints:        colKeywords !== -1 ? String(row[colKeywords] || '').trim() : '',
      currentMetaTitle:    '',
      currentMetaDescription: '',
      suggestedMetaTitle:  title,
      suggestedDescription: description,
      status:              'GENERATED',
      notes:               'Imported from ' + sheetName
    });
  }

  if (!items.length) {
    throw new Error('No importable rows found in "' + sheetName + '".');
  }

  // Seed into queue — items already have suggested values so we write directly
  const sh = getSeoQueueSheet_();
  const header = SEO_QUEUE_HEADER;
  const startRow = Math.max(sh.getLastRow() + 1, 2);

  const rowData = items.map(function(item) {
    const r = new Array(header.length).fill('');
    function set(col, val) {
      const idx = header.indexOf(col);
      if (idx !== -1) r[idx] = val;
    }
    set('Category Name',           item.categoryName);
    set('Category Path',           item.categoryPath);
    set('Level 1',                 item.level1);
    set('Level 2',                 item.level2);
    set('Level 3',                 item.level3);
    set('Keyword Hints',           item.keywordHints);
    set('Suggested Meta Title',    item.suggestedMetaTitle);
    set('Suggested Meta Description', item.suggestedDescription);
    set('Status',                  item.status);
    set('Last Generated At',       new Date());
    set('Notes',                   item.notes);
    return r;
  });

  sh.getRange(startRow, 1, rowData.length, header.length).setValues(rowData);
  applySheetStyling_(sh, { zebra: true });

  Logger.log('SEO Manager: imported ' + items.length + ' rows from "' + sheetName + '".');
  return { ok: true, imported: items.length, sheetName: sheetName };
}

/************************************************************
 * MERGE SEO FROM SHEET INTO SEO_QUEUE
 * mergeSeoFromSheet_v1(sheetName) — matches rows by category name,
 * writes titles/descriptions into existing SEO_QUEUE rows as GENERATED.
 * Rows in SEO_QUEUE with no match are left untouched (still PENDING).
 ************************************************************/

function mergeSeoFromSheet_v1(sheetName) {
  sheetName = sheetName || 'Meta SEO';
  const env = getSeoManagerEnv_();
  const ss = SpreadsheetApp.openById(env.spreadsheetId);
  const src = ss.getSheetByName(sheetName);
  if (!src) {
    throw new Error('Sheet not found: "' + sheetName + '".');
  }

  const srcValues = src.getDataRange().getValues();
  if (srcValues.length < 2) throw new Error('No data in "' + sheetName + '".');

  const srcHeader = srcValues[0].map(function(v) { return String(v || '').trim(); });
  function findCol(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var needle = candidates[i].toLowerCase();
      for (var j = 0; j < srcHeader.length; j++) {
        if (srcHeader[j].toLowerCase().indexOf(needle) !== -1) return j;
      }
    }
    return -1;
  }

  const colCat   = findCol(['vöruflokkur', 'category name', 'category', 'flokkur']);
  const colTitle = findCol(['meta title', 'title']);
  const colDesc  = findCol(['meta description', 'description', 'lýsing']);

  if (colCat === -1 || colTitle === -1 || colDesc === -1) {
    throw new Error(
      'Could not find required columns in "' + sheetName +
      '". Headers: ' + srcHeader.join(', ')
    );
  }

  // Build lookup: normalised category name → { title, description }
  const lookup = {};
  for (var r = 1; r < srcValues.length; r++) {
    const row = srcValues[r];
    const name  = String(row[colCat]   || '').trim();
    const title = String(row[colTitle] || '').trim();
    const desc  = String(row[colDesc]  || '').trim();
    if (!name || !title) continue;
    lookup[name.toLowerCase()] = { title: title, description: desc };
  }

  const queue = getSeoQueueData_();
  const header = SEO_QUEUE_HEADER;

  let matched = 0;
  let skipped = 0;

  queue.rows.forEach(function(row) {
    const categoryName = String(row['Category Name'] || '').trim();
    if (!categoryName) return;

    if (normalizeBooleanFlag_(row.Approved)) { skipped++; return; }

    const key = categoryName.toLowerCase();
    const found = lookup[key];
    if (!found) return;

    writeSeoQueueResult_(queue.sheet, row.__rowNumber, {
      suggestedTitle:       found.title,
      suggestedDescription: found.description,
      status:               'GENERATED',
      lastGeneratedAt:      new Date(),
      notes:                'Merged from ' + sheetName
    });
    matched++;
  });

  Logger.log(
    'SEO merge: matched=' + matched +
    ', skipped(approved)=' + skipped +
    ', sourceRows=' + Object.keys(lookup).length
  );
  return { ok: true, matched: matched, skipped: skipped, sourceRows: Object.keys(lookup).length };
}

/************************************************************
 * Scheduled SEO automation
 * installSeoAutomationTrigger_v1()  — set up every-30-min trigger
 * runScheduledSeoAutomation_v1()    — called by trigger; self-removes when done
 * removeSeoAutomationTrigger_v1()   — manual cleanup
 ************************************************************/

function runScheduledSeoAutomation_v1() {
  var result;
  try {
    result = runSeoAutomationBatch_v1({});
  } catch (err) {
    var msg = err && err.message ? err.message : String(err || '');
    Logger.log('[SEO_AUTO][ERROR] batch failed: ' + msg);
    // Rate limit / quota — leave trigger running, retry next interval
    if (isQuotaOrTemporaryAiError_(msg)) {
      Logger.log('[SEO_AUTO][INFO] Rate limit hit — will retry next interval.');
      return;
    }
    throw err;
  }

  Logger.log(
    '[SEO_AUTO][INFO] batch done — processed=' + result.processed +
    ', eligible=' + result.eligible +
    ', nextRow=' + result.nextRow +
    ', total=' + result.total
  );

  // All eligible rows done (cursor reset to 0 AND no eligible rows remain)
  var allDone = result.eligible === 0 ||
    (result.nextRow === 0 && result.processed > 0 && result.eligible <= result.processed);

  if (allDone) {
    Logger.log('[SEO_AUTO][INFO] All eligible SEO rows processed — removing trigger.');
    removeSeoAutomationTrigger_v1();
  }
}

function installSeoAutomationTrigger_v1() {
  var fn = 'runScheduledSeoAutomation_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[SEO_AUTO][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }

  ScriptApp.newTrigger(fn)
    .timeBased()
    .everyMinutes(30)
    .create();

  Logger.log('[SEO_AUTO][INFO] Created trigger for ' + fn + ' (every 30 min)');
  return { created: true, schedule: 'everyMinutes(30)' };
}

function removeSeoAutomationTrigger_v1() {
  var fn = 'runScheduledSeoAutomation_v1';
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('[SEO_AUTO][INFO] Removed ' + triggers.length + ' trigger(s) for ' + fn);
  return { removed: triggers.length };
}

/************************************************************
 * FETCH LIVE META TAGS FROM STORKAUP.IS
 * fetchCurrentSeoFromWeb_v1(opts)
 *   - Reads SEO_QUEUE rows where Current Meta Title is empty
 *   - Converts Category Path → URL slug → fetches storkaup.is
 *   - Writes <title> and <meta name="description"> back to sheet
 *   opts.limit      — max rows per run (default 50)
 *   opts.sleepMs    — delay between requests in ms (default 1500)
 *   opts.forceRefetch — overwrite rows that already have a value
 ************************************************************/

function fetchCurrentSeoFromWeb_v1(opts) {
  opts = opts || {};
  // Category pages live under /flokkur/<slug> — without the prefix the site
  // redirects to the nearest parent category and we scrape the wrong meta.
  var BASE_URL = 'https://www.storkaup.is/flokkur';
  var SLEEP_MS = opts.sleepMs != null ? Number(opts.sleepMs) : 1500;
  var BATCH_LIMIT = opts.limit != null ? Number(opts.limit) : 50;
  var forceRefetch = !!opts.forceRefetch;

  var queue = getSeoQueueData_();
  var header = SEO_QUEUE_HEADER;
  var titleColIdx = header.indexOf('Current Meta Title');
  var descColIdx = header.indexOf('Current Meta Description');
  var imageColIdx = header.indexOf('Current OG Image');

  if (titleColIdx === -1 || descColIdx === -1) {
    throw new Error('SEO_QUEUE sheet is missing Current Meta Title or Current Meta Description columns.');
  }

  var eligible = queue.rows.filter(function(row) {
    var categoryPath = String(row['Category Path'] || '').trim();
    var liveUrl = String(row['Live URL'] || '').trim();
    if (!categoryPath && !liveUrl) return false;
    if (forceRefetch) return true;
    var hasTitle = !!String(row['Current Meta Title'] || '').trim();
    // Rows fetched before the 'Current OG Image' column existed have a title
    // but no image — still eligible once, so the image backfills without a
    // full force re-fetch.
    var hasImage = imageColIdx === -1 || !!String(row['Current OG Image'] || '').trim();
    return !hasTitle || !hasImage;
  });

  if (!eligible.length) {
    Logger.log('[SEO_FETCH_META] No eligible rows found.');
    return { ok: true, fetched: 0, skipped: 0, errors: 0, total: queue.rows.length };
  }

  // In force mode every row stays eligible between runs, so advance via cursor.
  var props = PropertiesService.getScriptProperties();
  var cursorKey = 'SEO_FETCH_META_CURSOR';
  var startIndex = 0;
  if (forceRefetch) {
    startIndex = Number(props.getProperty(cursorKey) || 0);
    if (startIndex >= eligible.length) startIndex = 0;
  }

  var batch = eligible.slice(startIndex, startIndex + BATCH_LIMIT);
  var fetched = 0;
  var errors = 0;

  Logger.log('[SEO_FETCH_META] Fetching meta for ' + batch.length + ' rows (eligible=' + eligible.length + ')');

  batch.forEach(function(row, idx) {
    var categoryPath = String(row['Category Path'] || '').trim();
    // Live URL (from sitemap sync) is authoritative; slug transliteration is
    // only the fallback for rows that have not been linked yet.
    var url = String(row['Live URL'] || '').trim() ||
      (BASE_URL + '/' + categoryPathToSlug_(categoryPath));

    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StorkaupBot/1.0)' }
      });

      var code = res.getResponseCode();
      if (code === 200) {
        var html = res.getContentText();
        var title = extractHtmlTitle_(html);
        var description = extractHtmlMetaDescription_(html);
        var ogImage = extractHtmlOgImage_(html);

        var sheetRange = queue.sheet.getRange(row.__rowNumber, 1, 1, header.length);
        var values = sheetRange.getValues()[0];
        values[titleColIdx] = title || '';
        values[descColIdx] = description || '';
        if (imageColIdx !== -1) values[imageColIdx] = ogImage || '';
        sheetRange.setValues([values]);

        Logger.log(
          '[SEO_FETCH_META] Row ' + row.__rowNumber +
          ' (' + categoryPath + ') → "' + title + '"'
        );
        fetched++;
      } else {
        Logger.log('[SEO_FETCH_META] Row ' + row.__rowNumber + ' HTTP ' + code + ': ' + url);
        errors++;
      }
    } catch (err) {
      var msg = err && err.message ? err.message : String(err || '');
      Logger.log('[SEO_FETCH_META] Row ' + row.__rowNumber + ' ERROR: ' + msg);
      errors++;
    }

    if (idx < batch.length - 1) {
      Utilities.sleep(SLEEP_MS);
    }
  });

  if (forceRefetch) {
    var nextIndex = startIndex + batch.length < eligible.length ? startIndex + batch.length : 0;
    props.setProperty(cursorKey, String(nextIndex));
  }

  var summary = {
    ok: true,
    fetched: fetched,
    skipped: Math.max(0, eligible.length - (startIndex + batch.length)),
    errors: errors,
    total: queue.rows.length
  };
  Logger.log('[SEO_FETCH_META] Done: ' + JSON.stringify(summary));
  return summary;
}

/**
 * Syncs SEO_QUEUE against the live categories sitemap (source of truth for
 * which category pages exist and their real URLs):
 * - links existing rows to their live URL (Live URL column)
 * - seeds rows for sitemap categories missing from the queue, pulling proper
 *   Icelandic names from the page's BreadcrumbList JSON-LD plus current meta
 * - flags queue rows whose category is no longer in the sitemap
 * Cludo seeding stays as the enrichment source (SKUs, top products, revenue).
 */
function syncSeoQueueFromSitemap_v1(opts) {
  opts = opts || {};
  var SITEMAP_URL = 'https://www.storkaup.is/sitemaps/categories';
  var FETCH_LIMIT = opts.limit != null ? Number(opts.limit) : 40;
  var SLEEP_MS = opts.sleepMs != null ? Number(opts.sleepMs) : 400;

  var res = UrlFetchApp.fetch(SITEMAP_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Categories sitemap fetch failed: HTTP ' + res.getResponseCode());
  }
  var sitemapUrls = [];
  var re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  var xml = res.getContentText();
  var m;
  while ((m = re.exec(xml)) !== null) sitemapUrls.push(m[1]);
  if (!sitemapUrls.length) throw new Error('No URLs found in categories sitemap.');

  var queue = getSeoQueueData_();
  var urlColIdx = SEO_QUEUE_HEADER.indexOf('Live URL');
  var notesColIdx = SEO_QUEUE_HEADER.indexOf('Notes');

  function rowUrlKey_(row) {
    var liveUrl = String(row['Live URL'] || '').trim();
    if (liveUrl) return normalizeCategoryUrl_(liveUrl);
    var path = String(row['Category Path'] || '').trim();
    if (!path) return '';
    return normalizeCategoryUrl_('https://www.storkaup.is/flokkur/' + categoryPathToSlug_(path));
  }

  var byUrl = {};
  queue.rows.forEach(function(row) {
    var key = rowUrlKey_(row);
    if (key && !byUrl[key]) byUrl[key] = row;
  });

  var sitemapSet = {};
  var missing = [];
  var linked = 0;
  sitemapUrls.forEach(function(url) {
    var norm = normalizeCategoryUrl_(url);
    sitemapSet[norm] = true;
    var row = byUrl[norm];
    if (row) {
      if (!String(row['Live URL'] || '').trim()) {
        queue.sheet.getRange(row.__rowNumber, urlColIdx + 1).setValue(url);
        linked++;
      }
    } else {
      missing.push(url);
    }
  });

  var toFetch = missing.slice(0, FETCH_LIMIT);
  var seeded = [];
  toFetch.forEach(function(url, idx) {
    try {
      var page = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StorkaupBot/1.0)' }
      });
      if (page.getResponseCode() !== 200) throw new Error('HTTP ' + page.getResponseCode());
      var html = page.getContentText();
      var names = extractJsonLdBreadcrumbNames_(html);
      if (!names.length) {
        names = url.replace(/^.*\/flokkur\//, '').split('/');
      }
      seeded.push({
        categoryName: names[names.length - 1],
        currentMetaTitle: extractHtmlTitle_(html),
        currentMetaDescription: extractHtmlMetaDescription_(html),
        categoryPath: names.join(' / '),
        level1: names[0] || '',
        level2: names[1] || '',
        level3: names.slice(2).join(' / '),
        keywordHints: names.join(', '),
        context: 'Flokkaslóð: ' + names.join(' / '),
        status: 'PENDING',
        notes: 'Seeded from sitemap',
        liveUrl: url
      });
    } catch (err) {
      Logger.log('[SEO_SITEMAP_SYNC] ' + url + ' ERROR: ' + (err && err.message ? err.message : err));
    }
    if (idx < toFetch.length - 1 && SLEEP_MS > 0) Utilities.sleep(SLEEP_MS);
  });
  if (seeded.length) seedSeoQueueRows_(seeded);

  var flaggedGone = 0;
  queue.rows.forEach(function(row) {
    var key = rowUrlKey_(row);
    if (!key || sitemapSet[key]) return;
    var notes = String(row.Notes || '');
    if (notes.indexOf('EKKI Í SITEMAP') !== -1) return;
    queue.sheet.getRange(row.__rowNumber, notesColIdx + 1)
      .setValue(('EKKI Í SITEMAP. ' + notes).trim());
    flaggedGone++;
  });

  var summary = {
    ok: true,
    sitemapUrls: sitemapUrls.length,
    linked: linked,
    added: seeded.length,
    addedRemaining: Math.max(0, missing.length - toFetch.length),
    flaggedGone: flaggedGone
  };
  Logger.log('[SEO_SITEMAP_SYNC] ' + JSON.stringify(summary));
  return summary;
}

/**
 * Deletes queue rows flagged 'EKKI Í SITEMAP' by syncSeoQueueFromSitemap_v1.
 * Approved rows are never deleted — they may hold copy that belongs on a
 * renamed category's new row — they are returned in `keptApproved` instead.
 * Pass { dryRun: true } to only report.
 */
function purgeSeoQueueNotInSitemap_v1(opts) {
  opts = opts || {};
  var queue = getSeoQueueData_();
  var toDelete = [];
  var keptApproved = [];

  queue.rows.forEach(function(row) {
    if (String(row.Notes || '').indexOf('EKKI Í SITEMAP') === -1) return;
    if (normalizeBooleanFlag_(row.Approved)) {
      keptApproved.push({
        rowNumber: row.__rowNumber,
        categoryName: String(row['Category Name'] || '')
      });
    } else {
      toDelete.push(row.__rowNumber);
    }
  });

  if (!opts.dryRun && toDelete.length) {
    // Bottom-up so earlier deletions don't shift the remaining row numbers.
    toDelete.sort(function(a, b) { return b - a; }).forEach(function(rowNumber) {
      queue.sheet.deleteRow(rowNumber);
    });
  }

  var summary = {
    ok: true,
    deleted: opts.dryRun ? 0 : toDelete.length,
    wouldDelete: opts.dryRun ? toDelete.length : 0,
    keptApproved: keptApproved,
    dryRun: !!opts.dryRun
  };
  Logger.log('[SEO_PURGE] ' + JSON.stringify(summary));
  return summary;
}

var SEO_LIVE_PRODUCTS_MARKER_ = 'Vörur á síðunni núna:';

/**
 * Category pages render an ItemList (up to ~8 products, with brand) inside
 * the CollectionPage JSON-LD's mainEntity — server-rendered, no JS needed.
 * This is real, current inventory (unlike Cludo's snapshot from whatever
 * sync last ran) and it carries brand names the static SEO_KNOWN_BRANDS_
 * whitelist doesn't cover. Run this before a big generation batch to
 * refresh/enrich Context and Keyword Hints with what's actually on the page.
 * Rows seeded from the sitemap (which have no Cludo context at all) benefit
 * most — this is their only source of product-level detail.
 */
function fetchLiveCategoryProductsFromWeb_v1(opts) {
  opts = opts || {};
  var BASE_URL = 'https://www.storkaup.is/flokkur';
  var SLEEP_MS = opts.sleepMs != null ? Number(opts.sleepMs) : 400;
  var BATCH_LIMIT = opts.limit != null ? Number(opts.limit) : 40;
  var forceRefresh = !!opts.forceRefresh;

  var queue = getSeoQueueData_();
  var header = SEO_QUEUE_HEADER;
  var contextColIdx = header.indexOf('Context');
  var hintsColIdx = header.indexOf('Keyword Hints');
  if (contextColIdx === -1) throw new Error('SEO_QUEUE sheet is missing Context column.');

  var eligible = queue.rows.filter(function(row) {
    var url = String(row['Live URL'] || '').trim();
    var path = String(row['Category Path'] || '').trim();
    if (!url && !path) return false;
    if (!forceRefresh && String(row.Context || '').indexOf(SEO_LIVE_PRODUCTS_MARKER_) !== -1) return false;
    return true;
  });

  if (!eligible.length) {
    Logger.log('[SEO_LIVE_PRODUCTS] No eligible rows found.');
    return { ok: true, updated: 0, errors: 0, remaining: 0, total: queue.rows.length };
  }

  var props = PropertiesService.getScriptProperties();
  var cursorKey = 'SEO_LIVE_PRODUCTS_CURSOR';
  var startIndex = 0;
  if (forceRefresh) {
    startIndex = Number(props.getProperty(cursorKey) || 0);
    if (startIndex >= eligible.length) startIndex = 0;
  }

  var batch = eligible.slice(startIndex, startIndex + BATCH_LIMIT);
  var updated = 0;
  var errors = 0;

  batch.forEach(function(row, idx) {
    var url = String(row['Live URL'] || '').trim() ||
      (BASE_URL + '/' + categoryPathToSlug_(String(row['Category Path'] || '')));

    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StorkaupBot/1.0)' }
      });
      if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());

      var products = extractCollectionPageProducts_(res.getContentText());
      if (!products.length) {
        Logger.log('[SEO_LIVE_PRODUCTS] Row ' + row.__rowNumber + ' — no products in JSON-LD: ' + url);
        return;
      }

      var liveLine = SEO_LIVE_PRODUCTS_MARKER_ + ' ' + products.slice(0, 8).map(function(p) {
        return p.brand ? (p.name + ' (' + p.brand + ')') : p.name;
      }).join('; ') + '.';

      var existingContext = String(row.Context || '');
      var markerRe = new RegExp(SEO_LIVE_PRODUCTS_MARKER_.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^.]*\\.?');
      var newContext = existingContext.indexOf(SEO_LIVE_PRODUCTS_MARKER_) !== -1
        ? existingContext.replace(markerRe, liveLine)
        : (existingContext ? existingContext + ' ' + liveLine : liveLine);
      queue.sheet.getRange(row.__rowNumber, contextColIdx + 1).setValue(newContext);

      var liveBrands = products.map(function(p) { return p.brand; }).filter(Boolean);
      if (liveBrands.length && hintsColIdx !== -1) {
        var existingHints = String(row['Keyword Hints'] || '')
          .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var mergedHints = existingHints.concat(liveBrands).filter(function(v, i, arr) {
          return v && arr.indexOf(v) === i;
        });
        queue.sheet.getRange(row.__rowNumber, hintsColIdx + 1).setValue(mergedHints.slice(0, 15).join(', '));
      }

      updated++;
    } catch (err) {
      Logger.log('[SEO_LIVE_PRODUCTS] Row ' + row.__rowNumber + ' ERROR: ' + (err && err.message ? err.message : err));
      errors++;
    }

    if (idx < batch.length - 1 && SLEEP_MS > 0) Utilities.sleep(SLEEP_MS);
  });

  if (forceRefresh) {
    var nextIndex = startIndex + batch.length < eligible.length ? startIndex + batch.length : 0;
    props.setProperty(cursorKey, String(nextIndex));
  }

  var summary = {
    ok: true,
    updated: updated,
    errors: errors,
    remaining: Math.max(0, eligible.length - (startIndex + batch.length)),
    total: queue.rows.length
  };
  Logger.log('[SEO_LIVE_PRODUCTS] ' + JSON.stringify(summary));
  return summary;
}

function extractCollectionPageProducts_(html) {
  var products = [];
  var re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var parsed = safeJsonParse_(m[1]);
    if (!parsed || parsed['@type'] !== 'CollectionPage') continue;
    var list = parsed.mainEntity;
    if (!list || list['@type'] !== 'ItemList' || !Array.isArray(list.itemListElement)) continue;
    list.itemListElement.forEach(function(el) {
      var item = el && el.item;
      if (!item || !item.name) return;
      products.push({
        name: String(item.name).trim(),
        brand: (item.brand && item.brand.name) ? String(item.brand.name).trim() : ''
      });
    });
    break;
  }
  return products;
}

function normalizeCategoryUrl_(url) {
  return String(url || '').trim().toLowerCase()
    .replace(/^http:\/\//, 'https://')
    .replace(/^https:\/\/storkaup\.is/, 'https://www.storkaup.is')
    .replace(/\/+$/, '');
}

function extractJsonLdBreadcrumbNames_(html) {
  var names = [];
  var re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var parsed = safeJsonParse_(m[1]);
    if (!parsed || parsed['@type'] !== 'BreadcrumbList' || !Array.isArray(parsed.itemListElement)) continue;
    parsed.itemListElement
      .slice()
      .sort(function(a, b) { return Number(a.position || 0) - Number(b.position || 0); })
      .forEach(function(item) {
        var name = String((item && item.name) || '').trim();
        if (name && name.toLowerCase() !== 'forsíða') names.push(name);
      });
    break;
  }
  return names;
}

function categoryPathToSlug_(categoryPath) {
  return categoryPath
    .split(/\s*\/\s*/)
    .map(function(segment) {
      return transliterateIcelandic_(segment.trim())
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}

function transliterateIcelandic_(text) {
  return String(text || '')
    .replace(/[Þþ]/g, 'th')
    .replace(/[Ææ]/g, 'ae')
    .replace(/[Áá]/g, 'a')
    .replace(/[Éé]/g, 'e')
    .replace(/[Íí]/g, 'i')
    .replace(/[Óó]/g, 'o')
    .replace(/[Úú]/g, 'u')
    .replace(/[Ýý]/g, 'y')
    .replace(/[Ðð]/g, 'd')
    .replace(/[Öö]/g, 'o');
}

function extractHtmlTitle_(html) {
  var match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeHtmlEntities_(match[1]).replace(/\s+/g, ' ').trim();
}

function extractHtmlOgImage_(html) {
  var match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)[^>]+property=["']og:image["']/i);
  if (!match) return '';
  return decodeHtmlEntities_(match[1]).trim();
}

function extractHtmlMetaDescription_(html) {
  var match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)[^>]+name=["']description["']/i);
  if (!match) return '';
  return decodeHtmlEntities_(match[1]).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities_(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/************************************************************
 * DEDUPLICATE SEO_QUEUE BY CATEGORY NAME
 * deduplicateSeoQueue_v1(opts)
 *   - Groups rows by Category Name (case-insensitive)
 *   - Keeps best row per group: Approved > GENERATED > Revenue Incl > first
 *   - opts.markOnly: true  → sets Status='DUPLICATE' instead of deleting
 *   - opts.dryRun: true    → logs what would happen, no writes
 ************************************************************/

function deduplicateSeoQueue_v1(opts) {
  opts = opts || {};
  var markOnly = !!opts.markOnly;
  var dryRun = !!opts.dryRun;

  var queue = getSeoQueueData_();
  var rows = queue.rows;

  var groups = {};
  rows.forEach(function(row) {
    var key = String(row['Category Name'] || '').trim().toLowerCase();
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  var toKeep = [];
  var toDrop = [];

  Object.keys(groups).forEach(function(key) {
    var group = groups[key];
    if (group.length <= 1) return;

    // Priority: Approved > GENERATED status > Revenue Incl desc > earliest row
    group.sort(function(a, b) {
      var aApproved = normalizeBooleanFlag_(a.Approved) ? 2 : 0;
      var bApproved = normalizeBooleanFlag_(b.Approved) ? 2 : 0;
      if (aApproved !== bApproved) return bApproved - aApproved;

      var STATUS_RANK = { APPROVED: 3, GENERATED: 2, REVISED: 2, PENDING: 1, ERROR: 0, RETRY: 0, DUPLICATE: -1 };
      var aStatus = STATUS_RANK[normalizeStatus_(a.Status)] || 0;
      var bStatus = STATUS_RANK[normalizeStatus_(b.Status)] || 0;
      if (aStatus !== bStatus) return bStatus - aStatus;

      var aRevenue = Number(a['Revenue Incl'] || 0);
      var bRevenue = Number(b['Revenue Incl'] || 0);
      if (aRevenue !== bRevenue) return bRevenue - aRevenue;

      return a.__rowNumber - b.__rowNumber;
    });

    toKeep.push(group[0].__rowNumber);
    group.slice(1).forEach(function(row) { toDrop.push(row); });
  });

  if (!toDrop.length) {
    Logger.log('[SEO_DEDUP] No duplicates found.');
    return { ok: true, duplicates: 0, action: 'none' };
  }

  Logger.log(
    '[SEO_DEDUP] Found ' + toDrop.length + ' duplicate rows. ' +
    (dryRun ? '(dry run)' : markOnly ? 'Marking.' : 'Deleting.')
  );
  toDrop.forEach(function(row) {
    Logger.log(
      '[SEO_DEDUP] ' + (dryRun ? '[DRY] ' : '') +
      'Drop row ' + row.__rowNumber + ': ' + row['Category Name'] +
      ' (Level2=' + (row['Level 2'] || '') + ')'
    );
  });

  if (dryRun) {
    return { ok: true, duplicates: toDrop.length, action: 'dry_run' };
  }

  if (markOnly) {
    toDrop.forEach(function(row) {
      writeSeoQueueResult_(queue.sheet, row.__rowNumber, {
        status: 'DUPLICATE',
        notes: 'Duplicate of row kept at earlier/higher-priority position'
      });
    });
    return { ok: true, duplicates: toDrop.length, action: 'marked' };
  }

  // Delete rows from bottom to top so row numbers stay valid
  var rowsToDelete = toDrop.map(function(row) { return row.__rowNumber; });
  rowsToDelete.sort(function(a, b) { return b - a; });
  rowsToDelete.forEach(function(rowNumber) {
    queue.sheet.deleteRow(rowNumber);
  });

  Logger.log('[SEO_DEDUP] Deleted ' + rowsToDelete.length + ' duplicate rows.');
  return { ok: true, duplicates: rowsToDelete.length, action: 'deleted' };
}

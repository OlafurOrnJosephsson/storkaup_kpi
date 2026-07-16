/************************************************************
 * SOLUTION PAGES — cross-category lausnasíður (SEO/AEO)
 * ----------------------------------------------------------
 * Generates full-page copy briefs for segment-driven solution
 * pages (kaffistofan template): H1, meta, inngangur, section
 * copy per subcategory, FAQ and FAQPage JSON-LD.
 *
 * Data sources:
 *   - api.v_solution_page_themes_v1        (prioritized themes)
 *   - api.get_solution_page_products_v1    (sections + top products)
 *   - 'SC Queries 90d' tab                 (real search demand, question flag)
 *
 * Flow (same review model as SEO_QUEUE):
 *   1. seedSolutionPagesFromThemes_v1()  → rows in SOLUTION_PAGES tab
 *   2. runSolutionPageForSelectedRow_v1() → AI draft into the row
 *   3. Human review, Approved = TRUE, paste into Prismic
 *
 * Reuses seo_manager globals: getSeoManagerEnv_, validateSeoCopy_,
 * extractClaudeMessageContent_, extractGeminiText_,
 * extractOpenAiMessageContent_, normalizeJsonishText_.
 ************************************************************/

var SOLUTION_PAGES_SHEET_NAME_ = 'SOLUTION_PAGES';
var SOLUTION_PAGES_HEADER_ = [
  'Theme', 'Segment', 'Audience Segments', 'Category L1', 'Cross Category',
  'Revenue 365d', 'Status', 'Approved', 'Slug tillaga',
  'Meta Title', 'Meta Description', 'H1',
  'Page Markdown', 'FAQ JSON-LD',
  'Sections Data', 'Target Queries', 'Error', 'Generated At'
];

/************ Supabase (api schema) helpers ************/

function supabaseApiGet_(pathAndQuery) {
  var conf = getSupabaseRestConfig_();
  var res = UrlFetchApp.fetch(conf.baseUrl + '/' + pathAndQuery, {
    method: 'get',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Accept-Profile': 'api'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Supabase GET ' + pathAndQuery + ' failed (' + code + '): ' + truncateForLog_(res.getContentText(), 300));
  }
  return safeJsonParse_(res.getContentText()) || [];
}

function supabaseApiRpc_(rpcName, payloadObj) {
  var conf = getSupabaseRestConfig_();
  var res = UrlFetchApp.fetch(conf.baseUrl + '/rpc/' + encodeURIComponent(rpcName), {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: conf.serviceRole,
      Authorization: 'Bearer ' + conf.serviceRole,
      'Content-Profile': 'api'
    },
    payload: JSON.stringify(payloadObj || {}),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase RPC ' + rpcName + ' failed (' + code + '): ' + truncateForLog_(res.getContentText(), 300));
  }
  return safeJsonParse_(res.getContentText()) || [];
}

/************ Sheet plumbing ************/

function ensureSolutionPagesSheet_() {
  var env = getSeoManagerEnv_({});
  var ss = SpreadsheetApp.openById(env.spreadsheetId);
  var sh = ss.getSheetByName(SOLUTION_PAGES_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(SOLUTION_PAGES_SHEET_NAME_);
    sh.getRange(1, 1, 1, SOLUTION_PAGES_HEADER_.length).setValues([SOLUTION_PAGES_HEADER_]);
    sh.setFrozenRows(1);
    applySheetStyling_(sh, { zebra: true });
  }
  return sh;
}

function solutionColIndex_(name) {
  var idx = SOLUTION_PAGES_HEADER_.indexOf(name);
  if (idx < 0) throw new Error('SOLUTION_PAGES header missing column: ' + name);
  return idx + 1;
}

function writeSolutionPageCells_(sh, rowNumber, updates) {
  Object.keys(updates).forEach(function(col) {
    sh.getRange(rowNumber, solutionColIndex_(col)).setValue(updates[col]);
  });
}

/************ 1) Seed rows from prioritized themes ************/

/**
 * One sheet row per page theme (grouped by suggested_h1 — the same H1
 * across segments is one page with several audiences). at_risk_declining
 * is excluded: that segment is a reactivation campaign target, not SEO.
 */
function seedSolutionPagesFromThemes_v1() {
  var themes = supabaseApiGet_('v_solution_page_themes_v1?select=*');
  var groups = {};
  themes.forEach(function(t) {
    if (t.segment_id === 'at_risk_declining') return;
    var key = String(t.suggested_h1 || '').trim();
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  var sh = ensureSolutionPagesSheet_();
  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r) {
      if (r[0]) existing[String(r[0]).trim()] = true;
    });
  }

  var added = 0;
  Object.keys(groups).forEach(function(theme) {
    if (existing[theme]) return;
    var rows = groups[theme].slice().sort(function(a, b) {
      return (b.solution_fit_score || 0) - (a.solution_fit_score || 0);
    });
    var top = rows[0];
    var audiences = rows.map(function(r) { return r.segment_id; })
      .filter(function(v, i, arr) { return arr.indexOf(v) === i; });
    var revenue = rows.reduce(function(sum, r) { return sum + (Number(r.revenue_365d) || 0); }, 0);

    sh.appendRow([
      theme,
      top.segment_id,
      audiences.join(', '),
      top.primary_category,
      top.suggested_cross_category || '',
      Math.round(revenue),
      'NEW', '', '', '', '', '', '', '', '', '', '', ''
    ]);
    added++;
  });

  Logger.log('[SOLUTION_PAGES] Seeded ' + added + ' new theme rows (' + Object.keys(groups).length + ' themes total).');
  return { added: added, themes: Object.keys(groups).length };
}

/************ 2) Build inputs for one page ************/

/**
 * Sections = subcategories with broad enough demand for a public page.
 * Filters out narrow clinical/equipment groups (e.g. 1-6 customer Masimo
 * sensors on the heilbrigðis theme) via SETTINGS.SOLUTION_MIN_PRODUCT_CUSTOMERS.
 */
function buildSolutionSections_(segmentId, categoryL1, opts) {
  opts = opts || {};
  var minCustomers = Number(opts.minCustomers || 8);
  var maxSections = Number(opts.maxSections || 6);
  var rows = supabaseApiRpc_('get_solution_page_products_v1', {
    p_segment_id: segmentId,
    p_category_l1: categoryL1,
    p_days_back: 365,
    p_per_group: 12
  });

  var byL2 = {};
  (rows || []).forEach(function(r) {
    var l2 = String(r.category_l2 || '').trim();
    if (!l2 || l2 === 'Unknown') return;
    if (!byL2[l2]) byL2[l2] = { heading: l2, revenue: 0, maxCustomers: 0, products: [] };
    byL2[l2].revenue += Number(r.revenue_excl) || 0;
    byL2[l2].maxCustomers = Math.max(byL2[l2].maxCustomers, Number(r.customers) || 0);
    if (byL2[l2].products.length < 6 && (Number(r.customers) || 0) >= 3) {
      byL2[l2].products.push(String(r.product_name || r.sku));
    }
  });

  return Object.keys(byL2)
    .map(function(k) { return byL2[k]; })
    .filter(function(s) { return s.maxCustomers >= minCustomers && s.products.length; })
    .sort(function(a, b) { return b.revenue - a.revenue; })
    .slice(0, maxSections);
}

/** Icelandic-friendly stems (≥5 chars, 7-char prefix) for query matching. */
function solutionQueryStems_(texts) {
  var stems = {};
  texts.join(' ').toLowerCase().split(/[^a-záðéíóúýþæö]+/i).forEach(function(w) {
    if (w.length < 5) return;
    var stem = w.replace(/(vörur|vara|efni)$/i, '');
    if (stem.length < 4) stem = w;
    stems[stem.slice(0, 7)] = true;
  });
  return Object.keys(stems);
}

/** Pulls matching real search queries (and question queries) from the
 * 'SC Queries 90d' tab kept fresh by syncScQueryStats_v1. */
function collectScQueriesForSolutionPage_(matchTexts) {
  var env = getSeoManagerEnv_({});
  var ss = SpreadsheetApp.openById(env.spreadsheetId);
  var sh = ss.getSheetByName(SC_QUERIES_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return { queries: [], questions: [] };

  var stems = solutionQueryStems_(matchTexts);
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  var matched = [];
  data.forEach(function(r) {
    var q = String(r[0] || '').toLowerCase();
    if (!q) return;
    var hit = stems.some(function(s) { return q.indexOf(s) !== -1; });
    if (!hit) return;
    matched.push({
      query: String(r[0]),
      impressions: Number(r[2]) || 0,
      position: Number(r[4]) || 0,
      isQuestion: String(r[5] || '') === 'já'
    });
  });
  matched.sort(function(a, b) { return b.impressions - a.impressions; });
  return {
    queries: matched.slice(0, 15),
    questions: matched.filter(function(m) { return m.isQuestion; }).slice(0, 5)
  };
}

/************ 3) Prompt + AI call ************/

function buildSolutionPagePrompt_(theme, categoryL1, crossCategory, audiences, sections, crossSections, sc) {
  var sectionLines = sections.concat(crossSections).map(function(s) {
    return '- ' + s.heading + (s.cross ? ' (cross-category: ' + crossCategory + ')' : '') +
      ': topp vörur: ' + s.products.slice(0, 6).join('; ');
  });
  var queryLines = sc.queries.map(function(q) {
    return '- "' + q.query + '" (' + q.impressions + ' birtingar, staða ' + q.position + ')';
  });
  var questionLines = sc.questions.map(function(q) { return '- "' + q.query + '"'; });

  return [
    'Þú skrifar heildstæða íslenska B2B lausnasíðu fyrir Stórkaup (stórkaup.is), heildsölu fyrir fyrirtæki og stofnanir.',
    'Þemað: "' + theme + '" — aðalflokkur: ' + categoryL1 + (crossCategory ? ', cross-category: ' + crossCategory : '') + '.',
    'Markhópar (innri gögn): ' + audiences + '.',
    '',
    'SEKTIONIR (byggðar á raunverulegri sölu til þessara hópa — notaðu nákvæmlega þessar):',
    sectionLines.join('\n'),
    '',
    queryLines.length ? 'RAUNVERULEG LEITARORÐ sem síðan á að grípa (úr Search Console):\n' + queryLines.join('\n') : '',
    questionLines.length ? 'SPURNINGAR sem fólk leitar að (nýttu í FAQ):\n' + questionLines.join('\n') : '',
    '',
    'REGLUR:',
    '- Kjarnyrt íslenska, nafnorð og notkunarsamhengi — engin auglýsingalýsingarorð.',
    '- Bannað: "pantaðu í dag/hér", "skjót afhending", "mikið úrval", upphrópanir.',
    '- meta_title endar á "| Stórkaup", hámark 60 stafir.',
    '- meta_description 130–155 stafir.',
    '- intro: 150–220 orð sem ramma inn vandamálið (innkaupastreita, birgðastýring, endurpöntun) og lausnina.',
    '- sections: fyrir hverja sektion 50–90 orð um notkunarsamhengið; ekki telja upp pakkningastærðir.',
    '- faq: 5 spurningar með 40–80 orða svörum; nýttu raunverulegu leitarspurningarnar ef þær eiga við, annars innkaupaspurningar (afhending, lágmarkspöntun, reikningsviðskipti, endurpöntun á vef, staðgönguvörur).',
    '- slug: stutt íslensk slóð, byrjar á "/", engin séríslensk tákn (t.d. "/hreinlaeti-fagrekstur").',
    '',
    'Skilaðu EINGÖNGU gildu JSON á þessu formi:',
    '{',
    '  "meta_title": "...",',
    '  "meta_description": "...",',
    '  "h1": "...",',
    '  "slug": "/...",',
    '  "intro": "...",',
    '  "sections": [{"heading": "...", "copy": "..."}],',
    '  "faq": [{"q": "...", "a": "..."}]',
    '}'
  ].filter(String).join('\n');
}

function callSolutionAiJson_(prompt, env) {
  var content;
  if (env.provider === 'claude') {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': env.claudeApiKey,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json'
      },
      payload: JSON.stringify({
        model: env.claudeModel,
        max_tokens: 4096,
        temperature: 0.4,
        system: 'Þú skrifar íslenskt B2B efni fyrir vefsíður. Skilaðu alltaf eingöngu gildu JSON.',
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      throw new Error('Claude solution page failed (' + res.getResponseCode() + '): ' + truncateForLog_(res.getContentText(), 300));
    }
    content = extractClaudeMessageContent_(safeJsonParse_(res.getContentText()) || {});
  } else if (env.provider === 'gemini') {
    var models = [env.geminiModel].concat(env.geminiFallbackModels || []);
    var lastErr = null;
    for (var i = 0; i < models.length && !content; i++) {
      try {
        var gRes = UrlFetchApp.fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + normalizeGeminiModelName_(models[i]) + ':generateContent?key=' + env.geminiApiKey,
          {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: 'application/json' }
            }),
            muteHttpExceptions: true
          }
        );
        if (gRes.getResponseCode() !== 200) {
          throw new Error('Gemini ' + models[i] + ' HTTP ' + gRes.getResponseCode() + ': ' + truncateForLog_(gRes.getContentText(), 200));
        }
        content = extractGeminiText_(safeJsonParse_(gRes.getContentText()) || {});
      } catch (e) {
        lastErr = e;
        Logger.log('[SOLUTION_PAGES] Gemini model ' + models[i] + ' failed: ' + e.message);
      }
    }
    if (!content) throw (lastErr || new Error('Gemini solution page generation failed.'));
  } else {
    var oRes = UrlFetchApp.fetch(env.openAiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + env.openAiKey },
      payload: JSON.stringify({
        model: env.openAiModel,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Þú skrifar íslenskt B2B efni. Skilaðu alltaf eingöngu gildu JSON.' },
          { role: 'user', content: prompt }
        ]
      }),
      muteHttpExceptions: true
    });
    if (oRes.getResponseCode() < 200 || oRes.getResponseCode() >= 300) {
      throw new Error('OpenAI solution page failed (' + oRes.getResponseCode() + '): ' + truncateForLog_(oRes.getContentText(), 300));
    }
    content = extractOpenAiMessageContent_(safeJsonParse_(oRes.getContentText()) || {});
  }

  var parsed = safeJsonParse_(normalizeJsonishText_(content));
  if (!parsed || !parsed.h1 || !parsed.intro || !Array.isArray(parsed.sections) || !Array.isArray(parsed.faq)) {
    throw new Error('AI solution page response missing fields: ' + truncateForLog_(String(content), 300));
  }
  return parsed;
}

/************ 4) Assembly ************/

function buildSolutionPageMarkdown_(page, sections) {
  var productByHeading = {};
  sections.forEach(function(s) { productByHeading[s.heading] = s.products || []; });

  var lines = ['# ' + page.h1, '', page.intro, ''];
  (page.sections || []).forEach(function(s) {
    lines.push('## ' + s.heading, '', s.copy, '');
    var prods = productByHeading[s.heading] || [];
    if (prods.length) {
      lines.push('Vörur í þessari sektion:');
      prods.forEach(function(p) { lines.push('- ' + p); });
      lines.push('');
    }
  });
  lines.push('## Algengar spurningar', '');
  (page.faq || []).forEach(function(f) {
    lines.push('### ' + f.q, '', f.a, '');
  });
  return lines.join('\n');
}

function buildFaqJsonLd_(faq) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (faq || []).map(function(f) {
      return {
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      };
    })
  }, null, 2);
}

/************ 5) Generate for a row ************/

function generateSolutionPageForRowNumber_v1(rowNumber) {
  var env = getSeoManagerEnv_({ requireAi: true });
  var sh = ensureSolutionPagesSheet_();
  if (rowNumber < 2 || rowNumber > sh.getLastRow()) {
    throw new Error('Röð ' + rowNumber + ' er ekki til í ' + SOLUTION_PAGES_SHEET_NAME_ + '.');
  }
  var row = sh.getRange(rowNumber, 1, 1, SOLUTION_PAGES_HEADER_.length).getValues()[0];
  var theme = String(row[solutionColIndex_('Theme') - 1] || '').trim();
  var segment = String(row[solutionColIndex_('Segment') - 1] || '').trim();
  var audiences = String(row[solutionColIndex_('Audience Segments') - 1] || segment);
  var categoryL1 = String(row[solutionColIndex_('Category L1') - 1] || '').trim();
  var crossCategory = String(row[solutionColIndex_('Cross Category') - 1] || '').trim();
  if (!theme || !segment || !categoryL1) {
    throw new Error('Röð ' + rowNumber + ' vantar Theme/Segment/Category L1.');
  }

  try {
    var minCustomers = Number(env.cfg.SETTINGS.SOLUTION_MIN_PRODUCT_CUSTOMERS || 8);
    var sections = buildSolutionSections_(segment, categoryL1, { minCustomers: minCustomers, maxSections: 6 });
    if (!sections.length) {
      throw new Error('Engar sektionir stóðust síu (min customers ' + minCustomers + ') fyrir ' + segment + ' / ' + categoryL1);
    }
    var crossSections = [];
    if (crossCategory) {
      crossSections = buildSolutionSections_(segment, crossCategory, { minCustomers: minCustomers, maxSections: 2 })
        .map(function(s) { s.cross = true; return s; });
    }

    var sc = collectScQueriesForSolutionPage_(
      [theme, categoryL1, crossCategory].concat(sections.map(function(s) { return s.heading; }))
    );

    var prompt = buildSolutionPagePrompt_(theme, categoryL1, crossCategory, audiences, sections, crossSections, sc);
    var page = callSolutionAiJson_(prompt, env);

    var metaWarnings = validateSeoCopy_(
      { title: page.meta_title, description: page.meta_description }, 0
    );

    writeSolutionPageCells_(sh, rowNumber, {
      'Status': 'GENERATED',
      'Slug tillaga': page.slug || '',
      'Meta Title': enforceMaxLength_(sanitizeSeoText_(page.meta_title), 60),
      'Meta Description': enforceMaxLength_(sanitizeSeoText_(page.meta_description), 158),
      'H1': sanitizeSeoText_(page.h1),
      'Page Markdown': buildSolutionPageMarkdown_(page, sections.concat(crossSections)),
      'FAQ JSON-LD': buildFaqJsonLd_(page.faq),
      'Sections Data': JSON.stringify(sections.concat(crossSections).map(function(s) {
        return { heading: s.heading, revenue: Math.round(s.revenue), products: s.products, cross: !!s.cross };
      })),
      'Target Queries': sc.queries.map(function(q) { return q.query + ' (' + q.impressions + ')'; }).join(', '),
      'Error': metaWarnings.length ? 'ATH: ' + metaWarnings.join(' | ') : '',
      'Generated At': new Date().toISOString()
    });

    Logger.log('[SOLUTION_PAGES] Generated "' + theme + '" (' + sections.length + '+' + crossSections.length + ' sektionir, ' + sc.queries.length + ' leitarorð).');
    return { ok: true, theme: theme, sections: sections.length + crossSections.length, queries: sc.queries.length };
  } catch (err) {
    writeSolutionPageCells_(sh, rowNumber, {
      'Status': 'ERROR',
      'Error': String(err && err.message || err),
      'Generated At': new Date().toISOString()
    });
    throw err;
  }
}

function runSolutionPageForSelectedRow_v1() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (!sh || sh.getName() !== SOLUTION_PAGES_SHEET_NAME_) {
    throw new Error('Veldu röð í ' + SOLUTION_PAGES_SHEET_NAME_ + ' flipanum fyrst.');
  }
  var rowNumber = sh.getActiveRange().getRow();
  return generateSolutionPageForRowNumber_v1(rowNumber);
}

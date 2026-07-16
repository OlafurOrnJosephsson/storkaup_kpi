/************************************************************
 * SEARCH CONSOLE — /flokkur/ CTR mæling + query-level demand data
 * Measures the payoff of the SEO_QUEUE meta overhaul: pulls daily
 * clicks/impressions/CTR/position for category pages (/flokkur/)
 * from the Search Console API into two tabs for before/after
 * comparison. Also pulls the site-wide query corpus and page×query
 * detail for solution pages (SC_SOLUTION_PAGES) to validate demand
 * for cross-category SEO pages. Requires the webmasters.readonly OAuth scope
 * (appsscript.json) and that the script owner has access to the
 * storkaup.is property in Search Console.
 ************************************************************/

var SC_DAILY_SHEET_NAME_ = 'SC Flokkur Daily';
var SC_PAGES_SHEET_NAME_ = 'SC Flokkur Pages';
var SC_QUERIES_SHEET_NAME_ = 'SC Queries 90d';
var SC_SOLUTION_SHEET_NAME_ = 'SC Solution Pages';

// Icelandic question starters — flags AEO/FAQ-relevant queries in the corpus.
var SC_QUESTION_PREFIXES_ = ['hvað', 'hvernig', 'hver', 'hvar', 'hvenær', 'af hverju', 'hversu', 'má ', 'er hægt'];

function isIcelandicQuestionQuery_(q) {
  var s = String(q || '').toLowerCase();
  return SC_QUESTION_PREFIXES_.some(function(p) { return s.indexOf(p) === 0; });
}

function getScEnv_() {
  var cfg = loadConfig_();
  return {
    property:
      (cfg.SETTINGS && cfg.SETTINGS.SC_PROPERTY) ||
      'sc-domain:storkaup.is',
    spreadsheetId:
      (cfg.SHEETS && cfg.SHEETS.SALES_SUMMARIES && cfg.SHEETS.SALES_SUMMARIES.ID) || '',
    // Baseline start — far enough back to show pre-overhaul performance.
    startDate:
      (cfg.SETTINGS && cfg.SETTINGS.SC_START_DATE) ||
      '2026-06-01'
  };
}

function scApiFetch_(path, payload) {
  var url = 'https://www.googleapis.com/webmasters/v3/' + path;
  var params = {
    method: payload ? 'post' : 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (payload) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  var body = safeJsonParse_(res.getContentText()) || {};
  if (code !== 200) {
    throw new Error('Search Console API HTTP ' + code + ': ' + truncateForLog_(res.getContentText(), 300));
  }
  return body;
}

/** Debug: lists the Search Console properties the script owner can read —
 * run this first to confirm access and find the right SC_PROPERTY value. */
function listSearchConsoleSites_v1() {
  var body = scApiFetch_('sites');
  var sites = (body.siteEntry || []).map(function(s) {
    return s.siteUrl + ' (' + s.permissionLevel + ')';
  });
  Logger.log('[SC_SITES] ' + (sites.length ? sites.join('\n') : 'No properties visible to this account.'));
  return sites;
}

function queryScSearchAnalytics_(env, body) {
  var path = 'sites/' + encodeURIComponent(env.property) + '/searchAnalytics/query';
  return scApiFetch_(path, body).rows || [];
}

function formatScDate_(d) {
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/**
 * Pulls two datasets for pages containing /flokkur/:
 * 1) daily aggregate trend since SC_START_DATE → 'SC Flokkur Daily'
 * 2) per-page snapshot for the last 28 full days → 'SC Flokkur Pages'
 * Both tabs are fully rewritten on each run (idempotent).
 */
function syncScFlokkurStats_v1() {
  var env = getScEnv_();
  if (!env.spreadsheetId) {
    throw new Error('SC sync: missing SHEETS.SALES_SUMMARIES.ID in config.');
  }

  var today = new Date();
  // SC data for the most recent ~2 days is incomplete (arrives with a lag) —
  // including it makes the trend tail crash toward 0% and skews the 14d
  // deltas on the dashboard, so the daily trend ends 2 days back.
  var endDate = formatScDate_(new Date(today.getTime() - 2 * 24 * 3600 * 1000));
  var flokkurFilter = {
    filters: [{ dimension: 'page', operator: 'contains', expression: '/flokkur/' }]
  };

  // 1) Daily trend
  var dailyRows = queryScSearchAnalytics_(env, {
    startDate: env.startDate,
    endDate: endDate,
    dimensions: ['date'],
    dimensionFilterGroups: [flokkurFilter],
    rowLimit: 5000,
    dataState: 'all'
  });

  // 2) Per-page snapshot, last 28 full days (ending 3 days ago — SC data lags)
  var snapEnd = new Date(today.getTime() - 3 * 24 * 3600 * 1000);
  var snapStart = new Date(snapEnd.getTime() - 27 * 24 * 3600 * 1000);
  var pageRows = queryScSearchAnalytics_(env, {
    startDate: formatScDate_(snapStart),
    endDate: formatScDate_(snapEnd),
    dimensions: ['page'],
    dimensionFilterGroups: [flokkurFilter],
    rowLimit: 25000,
    dataState: 'all'
  });

  var ss = SpreadsheetApp.openById(env.spreadsheetId);

  writeScTab_(ss, SC_DAILY_SHEET_NAME_,
    ['Date', 'Clicks', 'Impressions', 'CTR %', 'Avg Position'],
    dailyRows.map(function(r) {
      return [r.keys[0], r.clicks, r.impressions, Math.round(r.ctr * 10000) / 100, Math.round(r.position * 10) / 10];
    })
  );

  pageRows.sort(function(a, b) { return b.impressions - a.impressions; });
  writeScTab_(ss, SC_PAGES_SHEET_NAME_,
    ['Page', 'Clicks (28d)', 'Impressions (28d)', 'CTR %', 'Avg Position'],
    pageRows.map(function(r) {
      return [r.keys[0], r.clicks, r.impressions, Math.round(r.ctr * 10000) / 100, Math.round(r.position * 10) / 10];
    })
  );

  var summary = {
    ok: true,
    property: env.property,
    dailyDays: dailyRows.length,
    pages: pageRows.length,
    totalClicks28d: pageRows.reduce(function(sum, r) { return sum + r.clicks; }, 0)
  };
  Logger.log('[SC_SYNC] ' + JSON.stringify(summary));
  return summary;
}

/**
 * Query-level demand validation for cross-category solution pages.
 * Pulls two datasets over the last 90 full days (ending 3 days back — SC lags):
 * 1) site-wide query corpus → 'SC Queries 90d', with a question-query flag
 *    (AEO/FAQ planning: which questions do people actually ask?)
 * 2) page×query detail for the solution pages listed in
 *    SETTINGS.SC_SOLUTION_PAGES (comma-separated paths, default '/kaffistofan')
 *    → 'SC Solution Pages' — measures live pilots like /kaffistofan, which
 *    sit outside /flokkur/ and are invisible to syncScFlokkurStats_v1.
 * Both tabs are fully rewritten on each run (idempotent).
 */
function syncScQueryStats_v1() {
  var env = getScEnv_();
  if (!env.spreadsheetId) {
    throw new Error('SC sync: missing SHEETS.SALES_SUMMARIES.ID in config.');
  }
  var cfg = loadConfig_();
  var pageList = String((cfg.SETTINGS && cfg.SETTINGS.SC_SOLUTION_PAGES) || '/kaffistofan')
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(String);

  var today = new Date();
  var end = new Date(today.getTime() - 3 * 24 * 3600 * 1000);
  var start = new Date(end.getTime() - 89 * 24 * 3600 * 1000);
  var startDate = formatScDate_(start);
  var endDate = formatScDate_(end);

  // 1) Site-wide query corpus
  var queryRows = queryScSearchAnalytics_(env, {
    startDate: startDate,
    endDate: endDate,
    dimensions: ['query'],
    rowLimit: 5000,
    dataState: 'all'
  });
  queryRows.sort(function(a, b) { return b.impressions - a.impressions; });

  // 2) Page × query per solution page (one call per page — list is short)
  var solutionRows = [];
  pageList.forEach(function(path) {
    var rows = queryScSearchAnalytics_(env, {
      startDate: startDate,
      endDate: endDate,
      dimensions: ['page', 'query'],
      dimensionFilterGroups: [{
        filters: [{ dimension: 'page', operator: 'contains', expression: path }]
      }],
      rowLimit: 5000,
      dataState: 'all'
    });
    solutionRows = solutionRows.concat(rows);
  });
  solutionRows.sort(function(a, b) { return b.impressions - a.impressions; });

  var ss = SpreadsheetApp.openById(env.spreadsheetId);

  writeScTab_(ss, SC_QUERIES_SHEET_NAME_,
    ['Query', 'Clicks (90d)', 'Impressions (90d)', 'CTR %', 'Avg Position', 'Spurning?'],
    queryRows.map(function(r) {
      return [
        r.keys[0], r.clicks, r.impressions,
        Math.round(r.ctr * 10000) / 100, Math.round(r.position * 10) / 10,
        isIcelandicQuestionQuery_(r.keys[0]) ? 'já' : ''
      ];
    })
  );

  writeScTab_(ss, SC_SOLUTION_SHEET_NAME_,
    ['Page', 'Query', 'Clicks (90d)', 'Impressions (90d)', 'CTR %', 'Avg Position'],
    solutionRows.map(function(r) {
      return [
        r.keys[0], r.keys[1], r.clicks, r.impressions,
        Math.round(r.ctr * 10000) / 100, Math.round(r.position * 10) / 10
      ];
    })
  );

  var summary = {
    ok: true,
    queries: queryRows.length,
    questionQueries: queryRows.filter(function(r) { return isIcelandicQuestionQuery_(r.keys[0]); }).length,
    solutionPages: pageList.length,
    solutionRows: solutionRows.length
  };
  Logger.log('[SC_QUERY_SYNC] ' + JSON.stringify(summary));
  return summary;
}

/** Daily trigger wrapper — never throws so the trigger doesn't email errors
 * for transient SC API hiccups; failures land in the log. */
function scheduledSearchConsoleSync_v1() {
  try {
    var out = syncScFlokkurStats_v1();
    try {
      out.querySync = syncScQueryStats_v1();
    } catch (qErr) {
      Logger.log('[SC_SCHEDULED][QUERY_SYNC_ERROR] ' + (qErr && qErr.message ? qErr.message : qErr));
      out.querySync = { ok: false, error: String(qErr && qErr.message || qErr) };
    }
    Logger.log('[SC_SCHEDULED] ' + JSON.stringify(out));
    return out;
  } catch (err) {
    Logger.log('[SC_SCHEDULED][ERROR] ' + (err && err.message ? err.message : err));
    return { ok: false, error: String(err && err.message || err) };
  }
}

/**
 * Key-protected JSON for the website dashboard (doPost action 'seo_stats').
 * Reads the two SC tabs (kept fresh by scheduledSearchConsoleSync_v1) and
 * caches the payload for 30 min — the dashboard never hits the SC API itself.
 */
function seoStatsViaApi_(body) {
  var cfg = loadConfig_();
  if (!isApiKeyValid_(cfg, body && body.key)) return { error: 'Unauthorized' };

  var cache = CacheService.getScriptCache();
  var cacheKey = 'seo_stats_v1';
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  var env = getScEnv_();
  var ss = SpreadsheetApp.openById(env.spreadsheetId);
  var out = { ok: true, generatedAt: new Date().toISOString(), daily: [], pages: [] };

  function isoDate_(v) {
    return v instanceof Date ? Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd') : String(v || '');
  }

  var dailySh = ss.getSheetByName(SC_DAILY_SHEET_NAME_);
  if (dailySh && dailySh.getLastRow() > 1) {
    var rows = dailySh.getRange(2, 1, dailySh.getLastRow() - 1, 5).getValues();
    out.daily = rows.slice(-90).map(function(r) {
      return {
        date: isoDate_(r[0]),
        clicks: Number(r[1]) || 0,
        impressions: Number(r[2]) || 0,
        ctr: Number(r[3]) || 0,
        position: Number(r[4]) || 0
      };
    });
  }

  var pagesSh = ss.getSheetByName(SC_PAGES_SHEET_NAME_);
  if (pagesSh && pagesSh.getLastRow() > 1) {
    var pRows = pagesSh.getRange(2, 1, Math.min(10, pagesSh.getLastRow() - 1), 5).getValues();
    out.pages = pRows.map(function(r) {
      return {
        page: String(r[0] || ''),
        clicks: Number(r[1]) || 0,
        impressions: Number(r[2]) || 0,
        ctr: Number(r[3]) || 0,
        position: Number(r[4]) || 0
      };
    });
  }

  try { cache.put(cacheKey, JSON.stringify(out), 1800); } catch (e) {}
  return out;
}

function writeScTab_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name);
  var created = false;
  if (!sh) {
    sh = ss.insertSheet(name);
    created = true;
  }
  sh.clearContents();
  var data = [header].concat(rows.length ? rows : []);
  sh.getRange(1, 1, data.length, header.length).setValues(data);
  if (created) {
    applySheetStyling_(sh, { zebra: true });
  }
}

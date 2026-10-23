function testGa4Connection_v1() {
  var propertyId = '313322071';
  var propertyPath = 'properties/' + propertyId;

  var request = {
    dateRanges: [
      { startDate: '7daysAgo', endDate: 'yesterday' }
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'screenPageViews' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'eventCount' }
    ]
  };

  var response = AnalyticsData.Properties.runReport(request, propertyPath);
  var row = response && response.rows && response.rows[0] ? response.rows[0] : null;
  var metricValues = row && row.metricValues ? row.metricValues : [];

  var out = {
    propertyId: propertyId,
    dateRange: '7daysAgo:yesterday',
    sessions: metricValues[0] ? metricValues[0].value : '0',
    totalUsers: metricValues[1] ? metricValues[1].value : '0',
    screenPageViews: metricValues[2] ? metricValues[2].value : '0',
    engagedSessions: metricValues[3] ? metricValues[3].value : '0',
    engagementRate: metricValues[4] ? metricValues[4].value : '0',
    eventCount: metricValues[5] ? metricValues[5].value : '0'
  };

  Logger.log('[GA4][TEST] ' + JSON.stringify(out));
  return out;
}

function getGa4PropertyId_() {
  return '313322071';
}

function formatGa4DateToIso_(raw) {
  var s = String(raw || '').trim();
  var m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return s;
  return m[1] + '-' + m[2] + '-' + m[3];
}

function runGa4Report_(request) {
  return AnalyticsData.Properties.runReport(request, 'properties/' + getGa4PropertyId_());
}

function fetchGa4DailyMetrics_(startDate, endDate) {
  var request = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'screenPageViews' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'eventCount' }
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    keepEmptyRows: false,
    limit: 10000
  };

  var response = runGa4Report_(request);
  var rows = response && response.rows ? response.rows : [];
  return rows.map(function(row) {
    var dims = row.dimensionValues || [];
    var vals = row.metricValues || [];
    return {
      day: formatGa4DateToIso_(dims[0] ? dims[0].value : ''),
      sessions: Number(vals[0] ? vals[0].value : 0) || 0,
      total_users: Number(vals[1] ? vals[1].value : 0) || 0,
      screen_page_views: Number(vals[2] ? vals[2].value : 0) || 0,
      engaged_sessions: Number(vals[3] ? vals[3].value : 0) || 0,
      engagement_rate: Number(vals[4] ? vals[4].value : 0) || 0,
      event_count: Number(vals[5] ? vals[5].value : 0) || 0
    };
  }).filter(function(row) { return !!row.day; });
}

function fetchGa4DailyEventCounts_(startDate, endDate) {
  var request = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: {
          values: ['add_to_cart', 'begin_checkout', 'purchase']
        }
      }
    },
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    keepEmptyRows: false,
    limit: 10000
  };

  var response = runGa4Report_(request);
  var rows = response && response.rows ? response.rows : [];
  var out = {};

  rows.forEach(function(row) {
    var dims = row.dimensionValues || [];
    var day = formatGa4DateToIso_(dims[0] ? dims[0].value : '');
    var eventName = String(dims[1] ? dims[1].value : '').trim();
    var count = Number(row.metricValues && row.metricValues[0] ? row.metricValues[0].value : 0) || 0;
    if (!day || !eventName) return;
    if (!out[day]) {
      out[day] = {
        add_to_cart: 0,
        begin_checkout: 0,
        purchases: 0
      };
    }
    if (eventName === 'add_to_cart') out[day].add_to_cart = count;
    if (eventName === 'begin_checkout') out[day].begin_checkout = count;
    if (eventName === 'purchase') out[day].purchases = count;
  });

  return out;
}

function fetchGa4ChannelDaily_(startDate, endDate) {
  var request = {
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'engagedSessions' },
      { name: 'eventCount' }
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    keepEmptyRows: false,
    limit: 10000
  };

  var response = runGa4Report_(request);
  var rows = response && response.rows ? response.rows : [];
  return rows.map(function(row) {
    var dims = row.dimensionValues || [];
    var vals = row.metricValues || [];
    return {
      day: formatGa4DateToIso_(dims[0] ? dims[0].value : ''),
      channel_group: String(dims[1] ? dims[1].value : '').trim() || '(unassigned)',
      sessions: Number(vals[0] ? vals[0].value : 0) || 0,
      total_users: Number(vals[1] ? vals[1].value : 0) || 0,
      engaged_sessions: Number(vals[2] ? vals[2].value : 0) || 0,
      event_count: Number(vals[3] ? vals[3].value : 0) || 0
    };
  }).filter(function(row) { return !!row.day && !!row.channel_group; });
}

/************************************************************
 * GA4 umferð frá gervigreindarspjalli → raw.ga4_ai_referrals_daily (2026-10-23)
 *
 * AEO-mæling, fyrsta skref: hvaða síður ChatGPT, Perplexity, Copilot o.fl.
 * vísa á og hvort sú umferð kaupir. Í channel-skiptingunni hér að ofan lendir
 * hún í „Referral“ og sést ekki, svo hér er síað á sessionSource.
 *
 * Lágmarkstala: öpp sem senda engan referrer lenda í „Direct“. Pantanir fyrir
 * 2026-10-01 eru ekki sambærilegar (GTM v96/v97, .claude/rules/ga4-gtm.md).
 * Flokkun eftir aðstoðarmanni er í SQL (core/sql/ga4_ai_referrals_v1.sql).
 ************************************************************/
var GA4_AI_SOURCE_REGEX_ = 'chatgpt\\.com|openai\\.com|perplexity|copilot\\.microsoft|gemini\\.google|bard\\.google' +
  '|claude\\.ai|you\\.com|meta\\.ai|deepseek|grok\\.com|chat\\.mistral|phind\\.com';

function fetchGa4AiReferralsDaily_(startDate, endDate) {
  var response = runGa4Report_({
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'landingPage' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagedSessions' },
      { name: 'transactions' },
      { name: 'purchaseRevenue' }
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionSource',
        stringFilter: { value: GA4_AI_SOURCE_REGEX_, matchType: 'PARTIAL_REGEXP', caseSensitive: false }
      }
    },
    keepEmptyRows: false,
    limit: 100000
  });
  var rows = response && response.rows ? response.rows : [];
  var syncedAt = new Date().toISOString();
  return rows.map(function(row) {
    var dims = row.dimensionValues || [];
    var vals = row.metricValues || [];
    return {
      day: formatGa4DateToIso_(dims[0] ? dims[0].value : ''),
      session_source: String(dims[1] ? dims[1].value : '').trim().toLowerCase(),
      session_medium: String(dims[2] ? dims[2].value : '').trim() || '(not set)',
      landing_page: String(dims[3] ? dims[3].value : '').trim() || '(not set)',
      sessions: Number(vals[0] ? vals[0].value : 0) || 0,
      engaged_sessions: Number(vals[1] ? vals[1].value : 0) || 0,
      transactions: Number(vals[2] ? vals[2].value : 0) || 0,
      purchase_revenue: Number(vals[3] ? vals[3].value : 0) || 0,
      synced_at: syncedAt
    };
  }).filter(function(row) { return !!row.day && !!row.session_source; });
}

function upsertGa4AiReferralsToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/ga4_ai_referrals_daily?on_conflict=day,session_source,session_medium,landing_page';
  var chunkSize = 500;
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
      throw new Error('GA4 AI referrals Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function syncGa4AiReferrals_v1(options) {
  var opts = options || {};
  var startDate = String(opts.startDate || '35daysAgo');
  var endDate = String(opts.endDate || 'today');
  var rows = fetchGa4AiReferralsDaily_(startDate, endDate);
  var out = upsertGa4AiReferralsToSupabase_(rows);
  var result = {
    startDate: startDate,
    endDate: endDate,
    fetched: rows.length,
    uploaded: out.uploaded,
    sessions: rows.reduce(function(s, r) { return s + r.sessions; }, 0),
    transactions: rows.reduce(function(s, r) { return s + r.transactions; }, 0)
  };
  Logger.log('[GA4][AI] ' + JSON.stringify(result));
  return result;
}

// Fyllir töfluna aftur í tímann. Keyra einu sinni eftir ga4_ai_referrals_v1.sql.
function backfillGa4AiReferrals_v1() {
  return syncGa4AiReferrals_v1({ startDate: '2025-01-01', endDate: 'today' });
}

/**
 * Að hverju leitar gervigreindin fyrir notandann á storkaup.is? (2026-10-23)
 *
 * Lendingar á /leit frá ChatGPT o.fl. með fyrirspurnarstrengnum, utm_* fjarlægt.
 * Les eingöngu, skrifar í log. Keyra í ritlinum: ga4AiSearchQueries_v1()
 */
function ga4AiSearchQueries_v1(startDate) {
  var resp = runGa4Report_({
    dateRanges: [{ startDate: startDate || '2025-01-01', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }, { name: 'landingPagePlusQueryString' }],
    metrics: [{ name: 'sessions' }, { name: 'transactions' }],
    dimensionFilter: {
      andGroup: { expressions: [
        { filter: { fieldName: 'sessionSource',
                    stringFilter: { value: GA4_AI_SOURCE_REGEX_, matchType: 'PARTIAL_REGEXP', caseSensitive: false } } },
        { filter: { fieldName: 'landingPagePlusQueryString',
                    stringFilter: { value: '/leit', matchType: 'BEGINS_WITH' } } }
      ] }
    },
    limit: 10000
  });

  var byQuery = {};
  (resp && resp.rows || []).forEach(function(r) {
    var page = String(r.dimensionValues[1].value || '');
    var qs = page.indexOf('?') >= 0 ? page.slice(page.indexOf('?') + 1) : '';
    var params = qs.split('&').filter(function(p) {
      return p && !/^utm_/i.test(p);
    }).map(function(p) {
      try { return decodeURIComponent(p.replace(/\+/g, ' ')); } catch (e) { return p; }
    });
    var key = params.join(' & ') || '(enginn strengur)';
    var o = byQuery[key] || (byQuery[key] = { sessions: 0, transactions: 0, sources: {} });
    o.sessions += Number(r.metricValues[0].value) || 0;
    o.transactions += Number(r.metricValues[1].value) || 0;
    o.sources[r.dimensionValues[0].value] = true;
  });

  var rows = Object.keys(byQuery).map(function(k) {
    return { query: k, sessions: byQuery[k].sessions, transactions: byQuery[k].transactions,
             sources: Object.keys(byQuery[k].sources).join(',') };
  }).sort(function(a, b) { return b.sessions - a.sessions; });

  Logger.log('[GA4][AI][LEIT] ' + rows.length + ' ólíkar leitir, ' +
             rows.reduce(function(s, r) { return s + r.sessions; }, 0) + ' lotur');
  rows.forEach(function(r) {
    Logger.log(r.sessions + '\t' + r.transactions + '\t' + r.query + '\t' + r.sources);
  });
  return rows;
}

/**
 * Eru „AI-lotur“ raunverulegir smellir úr spjalli? (2026-10-23)
 *
 * GA4 gefur beinni lotu (direct) síðasta þekkta uppruna notandans, svo
 * fastakúnni sem kom einu sinni úr ChatGPT getur haldið chatgpt.com sem
 * sessionSource í seinni heimsóknum. ChatGPT bætir utm_source=chatgpt.com
 * við tengla sína; erfð lota hefur hann ekki í lendingarslóðinni.
 * Skiptir AI-lotum eftir miðli × utm í slóð × nýr/endurkominn.
 * Les eingöngu. Keyra í ritlinum: ga4AiClickCheck_v1()
 */
function ga4AiClickCheck_v1(startDate) {
  var resp = runGa4Report_({
    dateRanges: [{ startDate: startDate || '2025-01-01', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' },
                 { name: 'landingPagePlusQueryString' }, { name: 'newVsReturning' }],
    metrics: [{ name: 'sessions' }, { name: 'transactions' }, { name: 'purchaseRevenue' }],
    dimensionFilter: {
      filter: { fieldName: 'sessionSource',
                stringFilter: { value: GA4_AI_SOURCE_REGEX_, matchType: 'PARTIAL_REGEXP', caseSensitive: false } }
    },
    limit: 100000
  });

  var agg = {};
  (resp && resp.rows || []).forEach(function(r) {
    var d = r.dimensionValues;
    var page = String(d[2].value || '');
    var path = page.split('?')[0];
    var kind = path === '/' ? 'forsíða' : (path.indexOf('/leit') === 0 ? 'leit' : 'önnur');
    var key = [d[1].value, /utm_source=/i.test(page) ? 'utm' : 'án utm', d[3].value || '?', kind].join(' | ');
    var o = agg[key] || (agg[key] = { sessions: 0, transactions: 0, revenue: 0 });
    o.sessions += Number(r.metricValues[0].value) || 0;
    o.transactions += Number(r.metricValues[1].value) || 0;
    o.revenue += Number(r.metricValues[2].value) || 0;
  });

  var keys = Object.keys(agg).sort(function(a, b) { return agg[b].sessions - agg[a].sessions; });
  Logger.log('[GA4][AI][CLICK] miðill | utm í slóð | nýr/endurkominn | lending -> lotur, pantanir, velta');
  keys.forEach(function(k) {
    Logger.log(k + ' -> ' + agg[k].sessions + ', ' + agg[k].transactions + ', ' + Math.round(agg[k].revenue));
  });
  return agg;
}

/**
 * Referrer í upphafi AI-lotu (2026-10-23). utm-prófunin í ga4AiClickCheck_v1
 * greindi ekki á milli (engin lending bar utm_source). Hér er pageReferrer á
 * session_start: smellur úr spjalli ber chatgpt.com o.s.frv., lota sem hófst
 * eftir hlé á vefnum ber storkaup.is, og erfð bein lota er tóm.
 * Les eingöngu. Keyra í ritlinum: ga4AiReferrerCheck_v1()
 */
function ga4AiReferrerCheck_v1(startDate) {
  var resp = runGa4Report_({
    dateRanges: [{ startDate: startDate || '2025-01-01', endDate: 'today' }],
    dimensions: [{ name: 'sessionMedium' }, { name: 'newVsReturning' }, { name: 'pageReferrer' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: { expressions: [
        { filter: { fieldName: 'sessionSource',
                    stringFilter: { value: GA4_AI_SOURCE_REGEX_, matchType: 'PARTIAL_REGEXP', caseSensitive: false } } },
        { filter: { fieldName: 'eventName', stringFilter: { value: 'session_start', matchType: 'EXACT' } } }
      ] }
    },
    limit: 100000
  });

  var agg = {};
  (resp && resp.rows || []).forEach(function(r) {
    var d = r.dimensionValues;
    var ref = String(d[2].value || '').trim();
    var host = (ref.match(/^https?:\/\/([^\/?#]+)/i) || [])[1] || '';
    host = host.toLowerCase().replace(/^www\./, '');
    var refKind = !ref || ref === '(not set)' ? '(tómur)' : host;
    var key = [d[0].value, d[1].value || '?', refKind].join(' | ');
    agg[key] = (agg[key] || 0) + (Number(r.metricValues[0].value) || 0);
  });

  var keys = Object.keys(agg).sort(function(a, b) { return agg[b] - agg[a]; });
  Logger.log('[GA4][AI][REF] miðill | nýr/endurkominn | referrer -> session_start');
  keys.forEach(function(k) { Logger.log(k + ' -> ' + agg[k]); });
  return agg;
}

function upsertGa4DailyMetricsToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/ga4_daily_metrics_raw?on_conflict=day';
  var chunkSize = 500;
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
      throw new Error('GA4 daily metrics Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function upsertGa4ChannelDailyToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/ga4_channel_daily_raw?on_conflict=day,channel_group';
  var chunkSize = 500;
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
      throw new Error('GA4 channel daily Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function syncGa4ToSupabase_v1(options) {
  var opts = options || {};
  var startDate = String(opts.startDate || '35daysAgo');
  var endDate = String(opts.endDate || 'today');
  var baseRows = fetchGa4DailyMetrics_(startDate, endDate);
  var eventCountsByDay = fetchGa4DailyEventCounts_(startDate, endDate);
  var dailyRows = baseRows.map(function(row) {
    var extras = eventCountsByDay[row.day] || {};
    return {
      day: row.day,
      sessions: row.sessions,
      total_users: row.total_users,
      screen_page_views: row.screen_page_views,
      engaged_sessions: row.engaged_sessions,
      engagement_rate: row.engagement_rate,
      event_count: row.event_count,
      add_to_cart: Number(extras.add_to_cart || 0) || 0,
      begin_checkout: Number(extras.begin_checkout || 0) || 0,
      purchases: Number(extras.purchases || 0) || 0,
      source: 'ga4_sync_v1'
    };
  });
  var channelRows = fetchGa4ChannelDaily_(startDate, endDate).map(function(row) {
    return {
      day: row.day,
      channel_group: row.channel_group,
      sessions: row.sessions,
      total_users: row.total_users,
      engaged_sessions: row.engaged_sessions,
      event_count: row.event_count,
      source: 'ga4_sync_v1'
    };
  });

  var dailyOut = upsertGa4DailyMetricsToSupabase_(dailyRows);
  var channelOut = upsertGa4ChannelDailyToSupabase_(channelRows);

  // AEO-mælingin má ekki fella aðal-GA4-syncið (t.d. ef taflan er ekki komin).
  var aiOut = null;
  try {
    aiOut = syncGa4AiReferrals_v1({ startDate: startDate, endDate: endDate });
  } catch (aiErr) {
    aiOut = { error: aiErr && aiErr.message ? aiErr.message : String(aiErr) };
    Logger.log('[GA4][AI][WARN] ' + aiOut.error);
  }

  return {
    propertyId: getGa4PropertyId_(),
    startDate: startDate,
    endDate: endDate,
    dailyRowsFetched: dailyRows.length,
    channelRowsFetched: channelRows.length,
    dailyUploaded: dailyOut.uploaded || 0,
    channelUploaded: channelOut.uploaded || 0,
    aiReferrals: aiOut
  };
}

function scheduledGa4Sync_v1(options) {
  var opts = options || {};
  var startedAt = new Date();
  var runId = null;
  var result = {
    startedAt: startedAt.toISOString(),
    ga4Sync: null,
    finishedAt: null
  };

  try {
    try {
      runId = startIngestionRun_('scheduledGa4Sync_v1', 'ga4_website', {
        trigger_type: 'time_based',
        start_date: String(opts.startDate || '35daysAgo'),
        end_date: String(opts.endDate || 'today')
      });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[GA4][WARN] Could not start ingestion run log: ' + logErr);
    }

    result.ga4Sync = syncGa4ToSupabase_v1(opts);
    result.finishedAt = new Date().toISOString();

    if (runId) {
      try {
        finishIngestionRun_(
          runId,
          'success',
          Number((result.ga4Sync && result.ga4Sync.dailyUploaded) || 0) + Number((result.ga4Sync && result.ga4Sync.channelUploaded) || 0),
          result,
          null
        );
      } catch (logErr2) {
        Logger.log('[GA4][WARN] Could not finish ingestion run log (success): ' + logErr2);
      }
    }

    Logger.log('[GA4][INFO] Completed scheduledGa4Sync_v1: ' + JSON.stringify(result));
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
          Number((result.ga4Sync && result.ga4Sync.dailyUploaded) || 0) + Number((result.ga4Sync && result.ga4Sync.channelUploaded) || 0),
          result,
          result.error.message
        );
      } catch (logErr3) {
        Logger.log('[GA4][WARN] Could not finish ingestion run log (error): ' + logErr3);
      }
    }

    Logger.log('[GA4][ERROR] scheduledGa4Sync_v1 failed: ' + JSON.stringify(result));
    throw e;
  }
}

function runGa4Sync_v1() {
  return scheduledGa4Sync_v1({ startDate: '35daysAgo', endDate: 'today' });
}

/************************************************************
 * GA4 pantanir → raw.ga4_purchases_raw (2026-10-21)
 *
 * Brú fyrir vefsöluna á mælaborðinu eftir að Magento API lokaðist. Ein röð á
 * pöntun (transaction_id), upphæðin = grand_total m/VSK (kvörðun 1.–20. okt:
 * 721 af 721 pörðum pöntunum stemmdu upp á krónu). GA4 nær ~89% pantana;
 * uppreikningur og síun á gömlum pöntunarnúmerum fer fram í SQL
 * (core/sql/ga4_purchases_v1.sql), ekki hér — hér er geymt það sem GA4 sagði.
 *
 * GA4 bætir við gögnum fyrir liðna daga í nokkra klukkutíma, svo hver keyrsla
 * sækir síðustu 3 daga aftur. Sama pöntun getur birst í fleiri en einni
 * klukkustund; sú fyrsta gildir.
 ************************************************************/
function fetchGa4Purchases_(startDate, endDate) {
  var resp = runGa4Report_({
    dateRanges: [{ startDate: startDate, endDate: endDate }],
    dimensions: [{ name: 'date' }, { name: 'hour' }, { name: 'transactionId' }],
    metrics: [{ name: 'purchaseRevenue' }],
    limit: 100000
  });
  var byId = {};
  (resp && resp.rows || []).forEach(function(r) {
    var id = String(r.dimensionValues[2].value || '').trim();
    if (!id || id === '(not set)') return;
    var day = formatGa4DateToIso_(r.dimensionValues[0].value);
    var hour = Number(r.dimensionValues[1].value);
    if (isNaN(hour)) hour = null;
    var prev = byId[id];
    if (prev && (prev.purchase_day < day || (prev.purchase_day === day && prev.purchase_hour <= hour))) return;
    byId[id] = {
      transaction_id: id,
      purchase_day: day,
      purchase_hour: hour,
      revenue_incl: Number(r.metricValues[0].value) || 0,
      synced_at: new Date().toISOString()
    };
  });
  return Object.keys(byId).map(function(k) { return byId[k]; });
}

function upsertGa4PurchasesToSupabase_(rows) {
  if (!rows || !rows.length) return { uploaded: 0 };
  var conf = getSupabaseRestConfig_();
  var endpoint = conf.baseUrl + '/ga4_purchases_raw?on_conflict=transaction_id';
  var chunkSize = 500;
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
      throw new Error('GA4 purchases Supabase upsert failed: ' + code + ' ' + res.getContentText());
    }
    uploaded += chunk.length;
  }

  return { uploaded: uploaded };
}

function scheduledGa4PurchaseSync_v1(options) {
  var opts = options || {};
  var startDate = String(opts.startDate || '3daysAgo');
  var endDate = String(opts.endDate || 'today');
  try {
    var rows = fetchGa4Purchases_(startDate, endDate);
    var out = upsertGa4PurchasesToSupabase_(rows);
    var result = { startDate: startDate, endDate: endDate, fetched: rows.length, uploaded: out.uploaded };
    Logger.log('[GA4][PURCHASES] ' + JSON.stringify(result));
    return result;
  } catch (e) {
    var errObj = serializeError_(e);
    Logger.log('[GA4][PURCHASES][ERROR] ' + JSON.stringify(errObj));
    if (!opts.manual && typeof notifyTriggerFailure_ === 'function') {
      try { notifyTriggerFailure_('scheduledGa4PurchaseSync_v1', errObj, {}); } catch (alertErr) {}
    }
    throw e;
  }
}

// Fyllir töfluna frá 1. okt — skörunin við Magento (1.–21. okt) er það sem
// SQL-ið kvarðar á og sannreynir. Keyra einu sinni eftir ga4_purchases_v1.sql.
function backfillGa4Purchases_v1() {
  return scheduledGa4PurchaseSync_v1({ startDate: '2026-10-01', endDate: 'today', manual: true });
}

// Purchase-sync á ekki eigin trigger lengur (2026-10-22): verkefnið var komið í
// 20 triggera hámark Apps Script og „Keyra aftur“ í vöruvöktun gat ekki búið
// til einskiptis-trigger. 10 mín realtime-triggerinn keyrir hana í staðinn,
// einu sinni á hverri klukkustund. Fari realtime-tilraunin, þarf purchase-sync
// aftur eigin trigger.
var GA4_PURCHASE_LAST_HOUR_KEY_ = 'GA4_PURCHASE_SYNC_LAST_HOUR';

function runGa4PurchaseSyncIfDue_() {
  var hourKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd HH');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(GA4_PURCHASE_LAST_HOUR_KEY_) === hourKey) return null;
  // Merkt fyrir keyrslu: villa fær sína einu viðvörun þessa klukkustund og
  // reynt aftur á þeirri næstu, ekki á 10 mín fresti.
  props.setProperty(GA4_PURCHASE_LAST_HOUR_KEY_, hourKey);
  return scheduledGa4PurchaseSync_v1();
}

/************************************************************
 * GA4 Realtime → raw.ga4_realtime_purchases_raw (2026-10-21, tilraun)
 *
 * Venjulega Data API-ið skilar deginum í dag nokkrum klukkutímum of seint.
 * Realtime API sér síðustu 30 mínútur innan 1–2 mín, en gefur aðeins FJÖLDA
 * purchase-atburða á mínútu — enga upphæð, ekkert transactionId. Upphæð er
 * því áætluð í SQL (fjöldi × meðalpöntun) og realtime-mínútur gilda aðeins
 * þar til venjulega API-ið hefur náð þeirri klukkustund
 * (core/sql/ga4_realtime_v1.sql).
 *
 * minutesAgo miðast við klukkumínútur („00“ = mínútan sem er að líða), svo
 * mínúta = núverandi klukkumínúta − minutesAgo. Hver keyrsla skrifar yfir
 * mínútur gluggans með nýjustu talningu. Keyrir á 10 mín fresti — oftar en
 * 30 mín glugginn, annars týnast mínútur.
 *
 * Sami trigger keyrir purchase-sync einu sinni á klukkustund
 * (runGa4PurchaseSyncIfDue_). Villa í öðru stoppar ekki hitt.
 ************************************************************/
function scheduledGa4RealtimeSync_v1() {
  var realtimeErr = null, result = null;
  try {
    result = syncGa4Realtime_();
  } catch (e) {
    realtimeErr = e;
  }
  try {
    runGa4PurchaseSyncIfDue_();
  } catch (e) {
    // scheduledGa4PurchaseSync_v1 hefur þegar loggað og sent viðvörun.
  }
  if (realtimeErr) throw realtimeErr;
  return result;
}

function syncGa4Realtime_() {
  try {
    var resp = AnalyticsData.Properties.runRealtimeReport({
      dimensions: [{ name: 'minutesAgo' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { value: 'purchase', matchType: 'EXACT' } }
      },
      minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }],
      limit: 100
    }, 'properties/' + getGa4PropertyId_());

    var nowMinute = Math.floor(Date.now() / 60000) * 60000;
    var syncedAt = new Date().toISOString();
    var rows = (resp && resp.rows || []).map(function(r) {
      var ago = Number(r.dimensionValues[0].value);
      return {
        minute_ts: new Date(nowMinute - ago * 60000).toISOString(),
        purchases: Number(r.metricValues[0].value) || 0,
        synced_at: syncedAt
      };
    }).filter(function(r) { return r.purchases > 0; });

    if (rows.length) {
      var conf = getSupabaseRestConfig_();
      var res = UrlFetchApp.fetch(conf.baseUrl + '/ga4_realtime_purchases_raw?on_conflict=minute_ts', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: conf.serviceRole,
          Authorization: 'Bearer ' + conf.serviceRole,
          'Content-Profile': 'raw',
          'Accept-Profile': 'raw',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        payload: JSON.stringify(rows),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error('GA4 realtime Supabase upsert failed: ' + code + ' ' + res.getContentText());
      }
    }
    var result = { minutesWithPurchases: rows.length, purchases: rows.reduce(function(s, r) { return s + r.purchases; }, 0) };
    Logger.log('[GA4][REALTIME] ' + JSON.stringify(result));
    return result;
  } catch (e) {
    var errObj = serializeError_(e);
    Logger.log('[GA4][REALTIME][ERROR] ' + JSON.stringify(errObj));
    if (typeof notifyTriggerFailure_ === 'function') {
      try { notifyTriggerFailure_('scheduledGa4RealtimeSync_v1', errObj, {}); } catch (alertErr) {}
    }
    throw e;
  }
}

function installGa4RealtimeSyncTrigger_v1() {
  var fn = 'scheduledGa4RealtimeSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[GA4][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(10).create();
  Logger.log('[GA4][INFO] Created trigger for ' + fn + ' (every 10 min)');
  return { created: true, schedule: 'everyMinutes(10)' };
}

/**
 * Kvörðun: nær GA4 vefpöntunum? (2026-10-21)
 *
 * Magento API lokaðist 2026-10-21 og GA4 á að brúa vefsöluna á mælaborðinu.
 * Purchase-taggið (GTM) sendir transaction_id, value og currency=ISK, svo GA4
 * telur bæði pantanir og veltu. Þetta ber það saman við raw.newweb_orders_raw
 * dag fyrir dag á tímabili þar sem báðar uppsprettur voru virkar. Byrjar
 * 1. okt: GTM v96/v97 breytti talningunni þann dag, eldri dagar eru ekki
 * sambærilegir (.claude/rules/ga4-gtm.md).
 *
 * Les eingöngu. Keyra í ritlinum: ga4PurchaseCalibration_v1()
 */
function ga4PurchaseCalibration_v1(startIso, endIso) {
  var start = startIso || '2026-10-01';
  var end = endIso || '2026-10-20';

  // GA4 dag fyrir dag
  var resp = runGa4Report_({
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'transactions' }, { name: 'purchaseRevenue' }],
    limit: 1000
  });
  var ga = {};
  (resp && resp.rows || []).forEach(function(r) {
    ga[formatGa4DateToIso_(r.dimensionValues[0].value)] = {
      tx: Number(r.metricValues[0].value) || 0,
      rev: Number(r.metricValues[1].value) || 0
    };
  });

  // GA4 á hverja pöntun — til að sjá hvort value = grand_total
  var txResp = runGa4Report_({
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'transactionId' }],
    metrics: [{ name: 'purchaseRevenue' }],
    limit: 10000
  });
  var gaTx = {};
  (txResp && txResp.rows || []).forEach(function(r) {
    gaTx[String(r.dimensionValues[0].value || '').trim()] = Number(r.metricValues[0].value) || 0;
  });

  // Magento úr Supabase, síðað (PostgREST skilar mest 1000 í einu)
  var mag = {};
  var magById = {};
  for (var offset = 0; offset < 50000; offset += 1000) {
    var page = supabaseRestGetJson_(
      'newweb_orders_raw?select=order_id,purchase_date,grand_total'
        + '&purchase_date=gte.' + start + 'T00:00:00Z'
        + '&purchase_date=lte.' + end + 'T23:59:59Z'
        + '&order=purchase_date.asc&limit=1000&offset=' + offset,
      'raw'
    );
    page = Array.isArray(page) ? page : [];
    page.forEach(function(r) {
      var id = String(r.order_id || '').trim();
      if (!id || magById[id] != null) return;
      magById[id] = Number(r.grand_total) || 0;
      var d = String(r.purchase_date || '').slice(0, 10);
      if (!mag[d]) mag[d] = { orders: 0, rev: 0 };
      mag[d].orders += 1;
      mag[d].rev += magById[id];
    });
    if (page.length < 1000) break;
  }

  function pct(a, b) { return b ? Math.round(1000 * a / b) / 10 : null; }

  var days = Object.keys(mag).concat(Object.keys(ga))
    .filter(function(d, i, arr) { return arr.indexOf(d) === i; }).sort();
  var tot = { magOrders: 0, gaTx: 0, magRev: 0, gaRev: 0 };
  var lines = ['dagur       | mag_pant | ga4_pant | %     | mag_velta   | ga4_velta   | %'];
  days.forEach(function(d) {
    var m = mag[d] || { orders: 0, rev: 0 };
    var g = ga[d] || { tx: 0, rev: 0 };
    tot.magOrders += m.orders; tot.gaTx += g.tx; tot.magRev += m.rev; tot.gaRev += g.rev;
    lines.push([d, m.orders, g.tx, pct(g.tx, m.orders), Math.round(m.rev), Math.round(g.rev), pct(g.rev, m.rev)].join(' | '));
  });

  // Pöntun fyrir pöntun: finnast transaction_id-in í Magento og stemmir upphæðin?
  var ids = Object.keys(gaTx).filter(function(k) { return k && k !== '(not set)'; });
  var matched = 0, sameAmount = 0;
  ids.forEach(function(k) {
    if (magById[k] == null) return;
    matched += 1;
    if (Math.abs(gaTx[k] - magById[k]) <= 1) sameAmount += 1;
  });

  var out = {
    period: start + '..' + end,
    magentoOrders: tot.magOrders,
    ga4Transactions: tot.gaTx,
    ordersCapturedPct: pct(tot.gaTx, tot.magOrders),
    magentoRevenue: Math.round(tot.magRev),
    ga4Revenue: Math.round(tot.gaRev),
    revenueCapturedPct: pct(tot.gaRev, tot.magRev),
    ga4TransactionIds: ids.length,
    idsFoundInMagento: matched,
    idsSameAmountAsGrandTotal: sameAmount,
    sampleGa4Ids: ids.slice(0, 5),
    sampleMagentoIds: Object.keys(magById).slice(0, 5)
  };
  Logger.log('[GA4][CALIBRATION] dag fyrir dag:\n' + lines.join('\n'));
  Logger.log('[GA4][CALIBRATION] ' + JSON.stringify(out));
  return out;
}

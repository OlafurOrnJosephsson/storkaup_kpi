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
  return {
    propertyId: getGa4PropertyId_(),
    startDate: startDate,
    endDate: endDate,
    dailyRowsFetched: dailyRows.length,
    channelRowsFetched: channelRows.length,
    dailyUploaded: dailyOut.uploaded || 0,
    channelUploaded: channelOut.uploaded || 0
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

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

/************************************************************
 * KLAVIYO PROFILE SYNC — okkar gögn → eiginleikar á Klaviyo-prófílum
 * ----------------------------------------------------------
 * Les mart.v_klaviyo_profiles_v1 (core/sql/klaviyo_profiles_v1.sql) og sendir
 * í Klaviyo með bulk import. Klaviyo sér hvorki BC né vefinn; þessir
 * eiginleikar eru það sem segment og flow byggja á (staða, síðasta pöntun,
 * pöntunarbil, flokkar, sölumaður).
 *
 * Hvað fer EKKI út, viljandi:
 *   - upphæðir (velta, lánamörk) — Klaviyo er þriðji aðili
 *   - kennitala — company_key fellur aftur á national_id, sem er persónuleg
 *     kennitala hjá einstaklingum í rekstri
 *   - skráning á póstlista — bulk import breytir ekki samþykki, og lykillinn
 *     hefur ekki Subscriptions-heimild
 *
 * Ný netföng: aðeins netföng sem Klaviyo þekkir nú þegar (known_to_klaviyo)
 * eru send, nema SETTINGS.KLAVIYO_PROFILE_SYNC_INCLUDE_NEW = true. Prófíll sem
 * verður til hér lendir í segmentum og getur fengið markpóst, og samþykki
 * fyrir þeim netföngum er óútkljáð.
 *
 * Lykill: API.Klaviyo.PROFILES_API_KEY (Custom key: Profiles + Lists).
 * Atburða-syncið (scheduledKlaviyoSync_v1) notar annan lykil — hvor má
 * afturkalla án þess að hinn stöðvist.
 *
 * Fyrsta keyrsla: previewKlaviyoProfileSync_v1() (sendir ekkert), svo
 * runKlaviyoProfileSyncNow_v1(), svo checkKlaviyoProfileImport_v1().
 * Trigger fer inn í requiredTimeTriggers_() þegar það hefur sannað sig.
 ************************************************************/

var KLAVIYO_PROFILES_REVISION = '2024-10-15';
var KLAVIYO_PROFILES_PAGE = 1000;   // PostgREST max rows
var KLAVIYO_PROFILES_CHUNK = 1000;  // Klaviyo leyfir 10.000 / 5 MB per job

function getKlaviyoProfilesConfig_() {
  var cfg = loadConfig_();
  var api = cfg && cfg.API && cfg.API.Klaviyo ? cfg.API.Klaviyo : {};
  var key = String(api.PROFILES_API_KEY || '').trim();
  if (!key) {
    throw new Error('Klaviyo config missing API.Klaviyo.PROFILES_API_KEY');
  }
  var settings = (cfg && cfg.SETTINGS) || {};
  return {
    apiKey: key,
    baseUrl: String((cfg.ENDPOINTS && cfg.ENDPOINTS.Klaviyo && cfg.ENDPOINTS.Klaviyo.BASE_URL) || 'https://a.klaviyo.com/api').replace(/\/$/, ''),
    includeNew: String(settings.KLAVIYO_PROFILE_SYNC_INCLUDE_NEW || '').toLowerCase().trim() === 'true'
  };
}

function fetchKlaviyoProfileRows_() {
  var rows = [];
  for (var offset = 0; ; offset += KLAVIYO_PROFILES_PAGE) {
    var page = supabaseRestGetJson_(
      'v_klaviyo_profiles_v1?select=*&order=email.asc'
        + '&limit=' + KLAVIYO_PROFILES_PAGE + '&offset=' + offset,
      'mart'
    );
    if (!Array.isArray(page) || !page.length) break;
    rows = rows.concat(page);
    if (page.length < KLAVIYO_PROFILES_PAGE) break;
  }
  return rows;
}

// Eitt prófílobjekt fyrir bulk import. Tóm gildi eru skilin eftir — Klaviyo
// heldur þá gamla gildinu, og þess vegna eru þau gildi sem flow ræsast á
// (reorder_due, web_state, priority) alltaf fyllt.
function mapKlaviyoProfile_(row, syncedAt) {
  var props = {
    stk_web_account:   !!row.has_web_account,
    stk_web_state:     String(row.web_state || 'no_web_account'),           // vefurinn einn
    stk_customer_state: String(row.customer_state || 'never_ordered'),     // allar rásir — win-back les þetta
    stk_orders_365d:   toNum_(row.orders_365d),
    stk_reorder_due:   !!row.reorder_due,
    stk_priority_list: !!row.on_priority_list,
    stk_multi_company: toNum_(row.companies_for_email) > 1,
    stk_categories:    Array.isArray(row.categories_365d) ? row.categories_365d : [],
    stk_synced_at:     syncedAt
  };

  var optional = {
    stk_company:                 row.company_name,
    stk_last_order_date:         row.last_order_date,
    stk_last_web_order_date:     row.last_web_order_date,
    stk_last_offline_order_date: row.last_offline_order_date,
    stk_web_share_pct:           row.web_order_share_pct_365d,
    stk_order_interval_days:     row.order_interval_days,
    stk_next_order_expected:     row.expected_next_order_date,
    stk_primary_category:        row.primary_category,
    stk_sales_rep:               row.sales_rep_code
  };
  Object.keys(optional).forEach(function(k) {
    var v = optional[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') props[k] = v;
  });

  return {
    type: 'profile',
    attributes: {
      email: String(row.email || '').toLowerCase().trim(),
      properties: props
    }
  };
}

function maskEmail_(email) {
  var s = String(email || '');
  var at = s.indexOf('@');
  return at > 0 ? s.charAt(0) + '***' + s.slice(at) : '***';
}

function buildKlaviyoProfilePayloads_() {
  var conf = getKlaviyoProfilesConfig_();
  var rows = fetchKlaviyoProfileRows_();
  var syncedAt = new Date().toISOString();
  var profiles = [];
  var skippedNew = 0;

  rows.forEach(function(r) {
    if (!r || !r.email) return;
    if (!conf.includeNew && !r.known_to_klaviyo) { skippedNew++; return; }
    profiles.push(mapKlaviyoProfile_(r, syncedAt));
  });

  return {
    conf: conf,
    rows: rows.length,
    skippedNew: skippedNew,
    profiles: profiles
  };
}

function postKlaviyoProfileImport_(profiles, conf) {
  var res = UrlFetchApp.fetch(conf.baseUrl + '/profile-bulk-import-jobs', {
    method: 'post',
    contentType: 'application/vnd.api+json',
    headers: {
      Authorization: 'Klaviyo-API-Key ' + conf.apiKey,
      accept: 'application/vnd.api+json',
      revision: KLAVIYO_PROFILES_REVISION
    },
    payload: JSON.stringify({
      data: {
        type: 'profile-bulk-import-job',
        attributes: { profiles: { data: profiles } }
      }
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('Klaviyo profile import failed: ' + code + ' ' + truncateText_(body, 800));
  }
  var parsed = safeJsonParse_(body) || {};
  return parsed.data && parsed.data.id ? String(parsed.data.id) : '';
}

/** Sendir ekkert. Sýnir fjölda og þrjú dæmi (netföng hulin) í loggnum. */
function previewKlaviyoProfileSync_v1() {
  var built = buildKlaviyoProfilePayloads_();
  var counts = {
    rows: built.rows,
    toSend: built.profiles.length,
    skippedNotInKlaviyo: built.skippedNew,
    includeNew: built.conf.includeNew,
    reorderDue: built.profiles.filter(function(p) { return p.attributes.properties.stk_reorder_due; }).length,
    priority: built.profiles.filter(function(p) { return p.attributes.properties.stk_priority_list; }).length
  };
  var tally = function(prop) {
    var out = {};
    built.profiles.forEach(function(p) {
      var s = p.attributes.properties[prop];
      out[s] = (out[s] || 0) + 1;
    });
    return out;
  };
  counts.byWebState = tally('stk_web_state');
  counts.byCustomerState = tally('stk_customer_state');
  Logger.log('[KLAVIYO_PROFILES][PREVIEW] ' + JSON.stringify(counts));

  built.profiles.slice(0, 3).forEach(function(p) {
    var sample = JSON.parse(JSON.stringify(p));
    sample.attributes.email = maskEmail_(sample.attributes.email);
    Logger.log('[KLAVIYO_PROFILES][SAMPLE] ' + JSON.stringify(sample));
  });
  return counts;
}

function scheduledKlaviyoProfileSync_v1() {
  var startedAt = new Date();
  var runId = null;
  var result = { startedAt: startedAt.toISOString(), rows: 0, sent: 0, skippedNew: 0, jobs: [] };
  Logger.log('[KLAVIYO_PROFILES][INFO] Started scheduledKlaviyoProfileSync_v1');

  try {
    try {
      runId = startIngestionRun_('scheduledKlaviyoProfileSync_v1', 'klaviyo_profiles', { trigger_type: 'time_based' });
      result.runId = runId;
    } catch (logErr) {
      Logger.log('[KLAVIYO_PROFILES][WARN] Could not start ingestion run log: ' + logErr);
    }

    var built = buildKlaviyoProfilePayloads_();
    result.rows = built.rows;
    result.skippedNew = built.skippedNew;
    result.includeNew = built.conf.includeNew;

    for (var i = 0; i < built.profiles.length; i += KLAVIYO_PROFILES_CHUNK) {
      var chunk = built.profiles.slice(i, i + KLAVIYO_PROFILES_CHUNK);
      var jobId = postKlaviyoProfileImport_(chunk, built.conf);
      result.jobs.push(jobId);
      result.sent += chunk.length;
      if (i + KLAVIYO_PROFILES_CHUNK < built.profiles.length) Utilities.sleep(500);
    }

    PropertiesService.getScriptProperties().setProperty(
      'KLAVIYO_PROFILE_IMPORT_JOBS', JSON.stringify({ at: startedAt.toISOString(), jobs: result.jobs })
    );

    result.finishedAt = new Date().toISOString();
    if (runId) {
      try { finishIngestionRun_(runId, 'success', result.sent, result, null); }
      catch (logErr2) { Logger.log('[KLAVIYO_PROFILES][WARN] Could not finish ingestion run log: ' + logErr2); }
    }
    Logger.log('[KLAVIYO_PROFILES][INFO] Completed: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.finishedAt = new Date().toISOString();
    result.error = { message: e && e.message ? e.message : String(e), stack: e && e.stack ? e.stack : '' };
    if (runId) {
      try { finishIngestionRun_(runId, 'error', result.sent, result, result.error.message); }
      catch (logErr3) { Logger.log('[KLAVIYO_PROFILES][WARN] Could not finish ingestion run log (error): ' + logErr3); }
    }
    try { notifyTriggerFailure_('scheduledKlaviyoProfileSync_v1', result.error, result); }
    catch (alertErr) { Logger.log('[KLAVIYO_PROFILES][WARN] Failure alert failed: ' + alertErr); }
    Logger.log('[KLAVIYO_PROFILES][ERROR] ' + JSON.stringify(result));
    throw e;
  }
}

/** Handkeyrsla — sama og trigger-keyrslan. */
function runKlaviyoProfileSyncNow_v1() {
  return scheduledKlaviyoProfileSync_v1();
}

/** Staða síðustu import-jobba: hve mörg tókust og hvað mistókst. */
function checkKlaviyoProfileImport_v1() {
  var conf = getKlaviyoProfilesConfig_();
  var saved = safeJsonParse_(PropertiesService.getScriptProperties().getProperty('KLAVIYO_PROFILE_IMPORT_JOBS') || '') || {};
  var jobs = saved.jobs || [];
  if (!jobs.length) {
    Logger.log('[KLAVIYO_PROFILES][CHECK] No saved import jobs.');
    return [];
  }

  var headers = {
    Authorization: 'Klaviyo-API-Key ' + conf.apiKey,
    accept: 'application/vnd.api+json',
    revision: KLAVIYO_PROFILES_REVISION
  };
  var out = jobs.map(function(id) {
    var res = UrlFetchApp.fetch(conf.baseUrl + '/profile-bulk-import-jobs/' + encodeURIComponent(id), {
      method: 'get', headers: headers, muteHttpExceptions: true
    });
    var parsed = safeJsonParse_(res.getContentText() || '') || {};
    var a = (parsed.data && parsed.data.attributes) || {};
    var row = {
      id: id,
      http: res.getResponseCode(),
      status: a.status || '',
      total: a.total_count,
      completed: a.completed_count,
      failed: a.failed_count
    };

    if (toNum_(a.failed_count) > 0) {
      var errRes = UrlFetchApp.fetch(conf.baseUrl + '/profile-bulk-import-jobs/' + encodeURIComponent(id) + '/import-errors', {
        method: 'get', headers: headers, muteHttpExceptions: true
      });
      var errs = (safeJsonParse_(errRes.getContentText() || '') || {}).data || [];
      row.firstErrors = errs.slice(0, 5).map(function(x) {
        var ea = x.attributes || {};
        return { code: ea.code, detail: ea.detail, email: maskEmail_(ea.original_payload && ea.original_payload.email) };
      });
    }
    return row;
  });

  Logger.log('[KLAVIYO_PROFILES][CHECK] ' + saved.at + ' ' + JSON.stringify(out));
  return out;
}

function installScheduledKlaviyoProfileSyncTrigger_v1() {
  var fn = 'scheduledKlaviyoProfileSync_v1';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log('[KLAVIYO_PROFILES][INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(6).nearMinute(10).create();
  Logger.log('[KLAVIYO_PROFILES][INFO] Created trigger for ' + fn + ' (every day at ~06:10)');
  return { created: true, schedule: 'everyDays(1).atHour(6).nearMinute(10)' };
}

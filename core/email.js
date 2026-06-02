'use strict';

var EMAIL_LOG_ = '[EMAIL]';
var ICE_MONTHS_ = ['jan.', 'feb.', 'mar.', 'apr.', 'maí', 'jún.', 'júl.', 'ágú.', 'sep.', 'okt.', 'nóv.', 'des.'];
var ICE_MONTHS_FULL_ = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];

// ── Config ────────────────────────────────────────────────────────────────────

function getDigestRecipients_() {
  var cfg;
  try { cfg = loadConfig_(); } catch (_) {}
  var raw = (cfg && cfg.SETTINGS && cfg.SETTINGS.DIGEST_EMAILS)
         || PropertiesService.getScriptProperties().getProperty('DIGEST_EMAILS')
         || '';
  return String(raw).split(/[;,]/).map(function(s) { return s.trim(); }).filter(Boolean);
}

// ── Scheduled weekly digest ───────────────────────────────────────────────────

function scheduledWeeklyDigest() {
  var startedAt = new Date();
  Logger.log(EMAIL_LOG_ + '[INFO] Started scheduledWeeklyDigest at ' + startedAt.toISOString());

  var result = { startedAt: startedAt.toISOString(), sent: false };
  try {
    // Last 7 complete days ending at today UTC midnight (Iceland = UTC+0 always)
    var weekEnd = new Date(startedAt);
    weekEnd.setUTCHours(0, 0, 0, 0);
    var weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);

    var weekStartIso = digestIso_(weekStart);
    var stats = fetchWeeklyDigestStats_(weekStartIso);
    var recipients = getDigestRecipients_();

    if (!recipients.length) {
      Logger.log(EMAIL_LOG_ + '[WARN] No DIGEST_EMAILS configured; skipping');
      result.reason = 'no_recipients';
      return result;
    }

    var weekEndDisplay = new Date(weekEnd.getTime() - 86400000);
    var subject = 'Vikulegt yfirlit — '
      + digestPeriodLabel_(weekStart, weekEndDisplay, true);

    GmailApp.sendEmail(recipients.join(','), subject, buildWeeklyDigestPlain_(stats), {
      htmlBody: buildWeeklyDigestHtml_(stats),
      from: 'vefur@storkaup.is',
      name: 'Stórkaup ehf'
    });

    result.sent = true;
    result.recipients = recipients.length;
    result.weekStart = weekStartIso;
    result.finishedAt = new Date().toISOString();
    Logger.log(EMAIL_LOG_ + '[INFO] Completed scheduledWeeklyDigest: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.error = { message: e.message || String(e), stack: e.stack || '' };
    result.finishedAt = new Date().toISOString();
    try { notifyTriggerFailure_('scheduledWeeklyDigest', e, result); } catch (_) {}
    Logger.log(EMAIL_LOG_ + '[ERROR] scheduledWeeklyDigest failed: ' + JSON.stringify(result));
    throw e;
  }
}

// ── Menu: send weekly digest now ──────────────────────────────────────────────

// NOTE: Named menu_sendWelcomeEmail per spec but sends the weekly digest.
// Separate welcome onboarding email is in buildWelcomeEmailHtml_() below.
function menu_sendWelcomeEmail() {
  var ui = SpreadsheetApp.getUi();
  var choice = ui.alert(
    'Senda tölvupóst',
    'Viltu senda:\n  [Já] Vikulegt yfirlit (til DIGEST_EMAILS)\n  [Nei] Velkomin-tölvupóst til nýs notanda',
    ui.ButtonSet.YES_NO_CANCEL
  );

  if (choice === ui.Button.CANCEL) return;

  if (choice === ui.Button.YES) {
    // Weekly digest — prompt for recipients (pre-filled from config)
    var defaultRcpts = getDigestRecipients_().join(', ');
    var resp = ui.prompt(
      'Vikulegt yfirlit',
      'Senda á (aðskilið með kommu):',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var input = String(resp.getResponseText() || defaultRcpts).trim() || defaultRcpts;
    var rcpts = input.split(/[;,]/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (!rcpts.length) { ui.alert('Ekkert gilt netfang.'); return; }

    toast_('Sends vikulegt yfirlit...', 'Email');
    var weekEnd = new Date();
    weekEnd.setUTCHours(0, 0, 0, 0);
    var weekStart = new Date(weekEnd);
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    var stats = fetchWeeklyDigestStats_(digestIso_(weekStart));
    var weekEndDisplay = new Date(weekEnd.getTime() - 86400000);
    var subject = 'Vikulegt yfirlit — ' + digestPeriodLabel_(weekStart, weekEndDisplay, true);
    GmailApp.sendEmail(rcpts.join(','), subject, buildWeeklyDigestPlain_(stats), {
      htmlBody: buildWeeklyDigestHtml_(stats),
      from: 'vefur@storkaup.is',
      name: 'Stórkaup ehf'
    });
    toast_('Sent til ' + rcpts.join(', '), 'Email');
  } else {
    // Welcome email — prompt for recipient
    var resp = ui.prompt(
      'Velkomin-tölvupóstur',
      'Netfang móttakanda (eða fleiri, aðskilin með kommu):',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var input = String(resp.getResponseText() || '').trim();
    var rcpts = input.split(/[;,]/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (!rcpts.length) { ui.alert('Ekkert gilt netfang.'); return; }

    GmailApp.sendEmail(rcpts.join(','), 'Velkomin á KPI yfirlit Stórkaups',
      'Við höfum sett upp gagnvirkar KPI síður.\n\nAðgangsorð: Stortkaup_2026\n\nDashboard: https://storkaup.webflow.io/kpi/dashboard', {
      htmlBody: buildWelcomeEmailHtml_(),
      from: 'vefur@storkaup.is',
      name: 'Stórkaup ehf'
    });
    toast_('Velkomin-tölvupóstur sendur til ' + rcpts.join(', '), 'Email');
  }
}

// ── Data fetch ────────────────────────────────────────────────────────────────

function fetchWeeklyDigestStats_(weekStartIso) {
  var raw = callSupabaseRpc_('weekly_digest_stats', { p_week_start: weekStartIso });
  var parsed = safeJsonParse_(raw, null);
  // Scalar jsonb — PostgREST may or may not wrap in array
  if (Array.isArray(parsed) && parsed.length) return parsed[0];
  return parsed || {};
}

// ── HTML: weekly digest ───────────────────────────────────────────────────────

function buildWeeklyDigestHtml_(s) {
  var ws = s.week_start ? new Date(s.week_start) : null;
  var weRaw = s.week_end ? new Date(s.week_end) : null;
  var we = weRaw ? new Date(weRaw.getTime() - 86400000) : null;
  var prevWs = ws ? new Date(ws.getTime() - 7 * 86400000) : null;
  var prevWe = ws ? new Date(ws.getTime() - 86400000) : null;

  var period     = ws && we      ? digestPeriodLabel_(ws,     we,      true)  : '?';
  var prevPeriod = prevWs && prevWe ? digestPeriodLabel_(prevWs, prevWe, false) : '?';

  // BC fields intentionally not shown — weekly digest is pure web-sales data
  // (BC ingestion on hold pending DataBricks/Power BI).
  var webRev        = emailNum_(s.web_revenue_excl);
  var webOrd        = emailNum_(s.web_orders);
  var prevWebRev    = emailNum_(s.prev_web_revenue_excl);
  var prevWebOrd    = emailNum_(s.prev_web_orders);

  var newCust      = emailNum_(s.new_customers);
  var newCust30d   = emailNum_(s.new_customers_30d);
  var newCustList  = emailParseArr_(s.new_customers_list);
  var topCust      = emailParseArr_(s.top_customers);
  var klOrd        = emailNum_(s.klaviyo_orders);
  var klRevExcl    = emailNum_(s.klaviyo_revenue_excl);

  var newCustRows = newCustList.length
    ? newCustList.map(function(c) {
        return '<div class="sk-row">'
          + '<span style="font-weight:600;">' + emailEsc_(c.name || '?')
          + ' <span class="sk-new">Nýr</span></span>'
          + '<span style="color:#3B6D11;font-size:12px;">Fyrsta pöntun: '
          + emailIskShort_(c.revenue) + '</span></div>';
      }).join('')
    : '<div class="sk-row"><span style="color:#888;">Engir nýir viðskiptavinir þessa viku.</span></div>';

  var topRows = topCust.length
    ? topCust.map(function(c) {
        return '<div class="sk-row">'
          + '<span style="font-weight:600;">' + emailEsc_(c.name || '?') + '</span>'
          + '<span style="color:#1a1a6e;font-weight:600;">' + emailIskShort_(c.revenue_excl) + '</span>'
          + '</div>';
      }).join('')
    : '<div class="sk-row"><span style="color:#888;">–</span></div>';

  var CSS = '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#1a1a2e}'
    + '.sk-header{background:#ffffff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e0e0e0;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e0e0e0;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e8e8e8;margin:20px 0}'
    + '.sk-lbl{margin:0 0 12px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.8px}'
    + '.sk-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}'
    + '.sk-kpi{background:#f8f8fb;border:1px solid #e8e8e8;border-radius:8px;padding:14px 16px}'
    + '.sk-kpi-lbl{font-size:11px;color:#888;margin:0 0 4px}'
    + '.sk-kpi-val{font-size:22px;font-weight:700;color:#1a1a6e;margin:0 0 4px}'
    + '.up{font-size:12px;color:#1a7a4a;font-weight:600}'
    + '.dn{font-size:12px;color:#c0392b;font-weight:600}'
    + '.ne{font-size:12px;color:#888}'
    + '.sk-list{background:#f8f8fb;border:1px solid #e8e8e8;border-radius:8px;padding:4px 16px;margin-bottom:10px}'
    + '.sk-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px}'
    + '.sk-row:last-child{border-bottom:none}'
    + '.sk-badge{background:#eaf3de;border-radius:6px;padding:10px 14px;font-size:12px;color:#3B6D11;font-weight:600}'
    + '.sk-new{display:inline-block;background:#eaf3de;color:#3B6D11;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;margin-left:6px;vertical-align:middle}'
    + '.sk-btn{display:inline-block;background:#1a1a6e;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';

  function kpi(label, value, pctHtml) {
    return '<div class="sk-kpi">'
      + '<p class="sk-kpi-lbl">' + label + '</p>'
      + '<p class="sk-kpi-val">' + value + '</p>'
      + pctHtml + '</div>';
  }

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + CSS + '</head><body>'
    + '<div class="sk-email">'

    // Header
    + '<div class="sk-header">'
    + emailLogoImg_()
    + '</div>'

    // Body
    + '<div class="sk-body">'
    + '<div style="font-size:18px;font-weight:700;color:#282828;margin:4px 0 10px;">Vikulegt yfirlit — ' + period + '</div>'
    + '<p style="margin:0 0 12px;color:#444;line-height:1.6;font-size:13px;">Yfirlit yfir helstu tölur vikunnar hjá Stórkaup. Allar tölur eru sjálfvirkt sóttar úr kerfinu.</p>'
    + '<p style="margin:0 0 20px;font-size:13px;background:#f5f6ff;border:1px solid #e9e9e9;border-radius:6px;padding:10px 14px;color:#5b5b5b;">Aðgangsorð: <strong style="color:#282828;">Stortkaup_2026</strong></p>'

    // Vefsala
    + '<p class="sk-lbl">Vefsala</p>'
    + '<div class="sk-grid">'
    + kpi('Vefvelta vikuna',   emailIskShort_(webRev),    emailPctSpan_(webRev,    prevWebRev))
    + kpi('Vefpantanir',       String(webOrd),             emailPctSpan_(webOrd,    prevWebOrd))
    + '</div>'
    + '<hr class="sk-divider">'

    // Nýir viðskiptavinir
    + '<p class="sk-lbl">Nýir viðskiptavinir vikuna</p>'
    + '<div class="sk-list">' + newCustRows + '</div>'
    + '<div class="sk-badge">' + newCust + ' nýir viðskiptavinir þessa viku — ' + newCust30d + ' síðustu 30 daga</div>'
    + '<hr class="sk-divider">'

    // Stærstu viðskiptavinir
    + '<p class="sk-lbl">Stærstu viðskiptavinir vikuna</p>'
    + '<div class="sk-list">' + topRows + '</div>'
    + '<hr class="sk-divider">'

    // Klaviyo
    + '<p class="sk-lbl">Markaðsherferðir (Klaviyo)</p>'
    + '<div class="sk-grid">'
    + kpi('Pantanir frá Klaviyo', String(klOrd),              '<span class="ne">30 daga gluggi</span>')
    + kpi('Sala frá Klaviyo',     emailIskShort_(klRevExcl),  '<span class="ne">án VSK &middot; 30 dagar</span>')
    + '</div>'
    + '<hr class="sk-divider">'

    // CTA
    + '<div style="text-align:center;padding:8px 0 4px;">'
    + '<a class="sk-btn" href="https://storkaup.webflow.io/kpi/dashboard">Sjá allar tölur á mælaborðinu</a>'
    + '</div>'
    + '</div>' // sk-body

    // Footer
    + '<div class="sk-footer">'
    + '<p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. &middot; Sent sjálfvirkt á mánudögum kl. 08:00 &middot; '
    + '<a href="https://storkaup.webflow.io/kpi/dashboard" style="color:#888;">storkaup.webflow.io</a></p>'
    + '</div>'

    + '</div></body></html>';

  return html;
}

// ── HTML: welcome / onboarding email ─────────────────────────────────────────

function buildWelcomeEmailHtml_() {
  var CSS = '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#1a1a2e}'
    + '.sk-header{background:#ffffff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e0e0e0;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e0e0e0;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-card{border:1px solid #e8e8e8;border-radius:8px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:14px;background:#fafafa}'
    + '.sk-card-text{flex:1}'
    + '.sk-card-title{font-weight:600;font-size:13px;color:#1a1a2e;margin:0 0 2px}'
    + '.sk-card-desc{font-size:12px;color:#666;margin:0}'
    + '.sk-btn{display:inline-block;background:#1a1a6e;color:#fff!important;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}'
    + '.sk-divider{border:none;border-top:1px solid #e8e8e8;margin:20px 0}'
    + '.sk-lbl{margin:0 0 12px;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px}'
    + '</style>';

  function card(title, desc, url) {
    return '<div class="sk-card">'
      + '<div class="sk-card-text">'
      + '<p class="sk-card-title">' + title + '</p>'
      + '<p class="sk-card-desc">' + desc + '</p>'
      + '</div>'
      + '<a class="sk-btn" href="https://storkaup.webflow.io' + url + '">Opna</a>'
      + '</div>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + CSS + '</head><body>'
    + '<div class="sk-email">'
    + '<div class="sk-header">'
    + '<div style="font-size:22px;font-weight:700;color:#282828;letter-spacing:0.5px;">STÓRKAUP</div>'
    + '<div style="color:#5b5b5b;font-size:13px;margin-top:4px;">Verkfærakistan</div>'
    + '</div>'
    + '<div class="sk-body">'
    + '<p style="margin:0 0 6px;font-size:15px;font-weight:600;">Kæru starfsmenn Stórkaups</p>'
    + '<p style="margin:0 0 12px;color:#444;line-height:1.6;">Við höfum sett upp gagnvirkar síður þar sem hægr er að fylgjast með sölu, viðskiptavinum og vefumferð. Hér eru tenglar beint á þær síður sem eru í boði.</p>'
    + '<p style="margin:0 0 16px;font-size:13px;background:#f5f6ff;border:1px solid #e9e9e9;border-radius:6px;padding:10px 14px;color:#5b5b5b;">Aðgangsorð: <strong style="color:#282828;">Stortkaup_2026</strong></p>'
    + '<hr class="sk-divider">'
    + '<p class="sk-lbl">Yfirlit</p>'
    + card('Mælaborð', 'Dagleg KPI yfirlit – pantanir, sala, samanbuður við meðaltal', '/kpi/dashboard')
    + card('Sölutölur', 'Söluþróun, BC velta og vefpantanir', '/kpi/solutolur')
    + '<hr class="sk-divider">'
    + '<p class="sk-lbl">Viðskiptavinir</p>'
    + card('Viðskiptavinakort', 'Fletttu upp viðskiptavinum – pantanasaga, veltuþróun, innkaupalisti', '/kpi/vidskiptavinur')
    + card('Forgangslisti', 'Viðskiptavinir sem eru í onboarding á vef', '/kpi/forgangslisti')
    + '<hr class="sk-divider">'
    + '<p class="sk-lbl">Markaðssetning og vörur</p>'
    + card('Markaðsherferðir', 'Tölvupóstar, pantanir og tekjur frá markaðsherferðum', '/kpi/klaviyo')
    + card('Vinsælar vörur', 'Mest seldu vörurnar og flokkar á vef og BC', '/kpi/top-products')
    + card('Vefmælaborð', 'Heimsóknir, notendur, körfusetning og kaup á vef', '/kpi/vefur-kpi')
    + '<hr class="sk-divider">'
    + '<p class="sk-lbl">Pantanir</p>'
    + card('Pantanir', 'Flettu upp pöntunum á fyrirtæki eða pöntunarnúmer', '/kpi/pantanir')
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Ef þú hefur spurningar eða ábendingar varðandi uppsetningu eða notkun, hafðu þá samband við <a href="mailto:vefur@storkaup.is" style="color:#10069f;">vefur@storkaup.is</a></p>'
    + '</div>'
    + '<div class="sk-footer">'
    + '<p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. &middot; Innanhús KPI kerfi &middot; Þetta eru gögn í rauntíma</p>'
    + '</div>'
    + '</div></body></html>';
}

// ── Plain-text fallback ───────────────────────────────────────────────────────

function buildWeeklyDigestPlain_(s) {
  var ws = s.week_start ? new Date(s.week_start) : null;
  var we = s.week_end ? new Date(new Date(s.week_end).getTime() - 86400000) : null;
  var period = ws && we ? digestPeriodLabel_(ws, we, true) : '?';

  var lines = [
    'Vikulegt yfirlit — ' + period, '',
    'VEFSALA',
    'Vefvelta  : ' + emailIskShort_(emailNum_(s.web_revenue_excl)) + ' (án VSK)',
    'Vefpant.  : ' + emailNum_(s.web_orders), '',
    'NÝIR VIÐSKIPTAVINIR',
    'Þessa viku    : ' + emailNum_(s.new_customers),
    'Síðustu 30 d. : ' + emailNum_(s.new_customers_30d)
  ];
  emailParseArr_(s.new_customers_list).forEach(function(c, i) {
    lines.push((i + 1) + '. ' + (c.name || '?') + ' — ' + emailIskShort_(c.revenue));
  });
  lines.push('', 'TOP 3 VIÐSKIPTAVINIR');
  emailParseArr_(s.top_customers).forEach(function(c, i) {
    lines.push((i + 1) + '. ' + (c.name || '?') + ' — ' + emailIskShort_(c.revenue_excl));
  });
  lines.push('', 'KLAVIYO (30 dagar, no-bot)',
    'Pantanir : ' + emailNum_(s.klaviyo_orders),
    'Sala     : ' + emailIskShort_(emailNum_(s.klaviyo_revenue_excl)) + ' (án VSK)',
    '',
    'Aðgangsorð: Stortkaup_2026',
    'KPI: https://storkaup.webflow.io/kpi/dashboard'
  );
  return lines.join('\n');
}

// ── Trigger installer ─────────────────────────────────────────────────────────

function installWeeklyDigestTrigger_v1() {
  var fn = 'scheduledWeeklyDigest';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log(EMAIL_LOG_ + '[INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .nearMinute(0)
    .create();
  Logger.log(EMAIL_LOG_ + '[INFO] Created weekly digest trigger (Mondays at ~08:00 UTC)');
  return { created: true, schedule: 'MONDAY.atHour(8).nearMinute(0)' };
}

// ── Scheduled monthly digest ──────────────────────────────────────────────────

function scheduledMonthlyDigest() {
  var startedAt = new Date();
  Logger.log(EMAIL_LOG_ + '[INFO] Started scheduledMonthlyDigest at ' + startedAt.toISOString());

  var result = { startedAt: startedAt.toISOString(), sent: false };
  try {
    // Previous full calendar month relative to today (Iceland = UTC+0)
    var prevMonthStart = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth() - 1, 1));
    var monthStartIso = digestIso_(prevMonthStart);

    var stats = fetchMonthlyDigestStats_(monthStartIso);
    var recipients = getDigestRecipients_();

    if (!recipients.length) {
      Logger.log(EMAIL_LOG_ + '[WARN] No DIGEST_EMAILS configured; skipping');
      result.reason = 'no_recipients';
      return result;
    }

    var subject = 'Mánaðaryfirlit — ' + digestMonthLabel_(stats.month);

    GmailApp.sendEmail(recipients.join(','), subject, buildMonthlyDigestPlain_(stats), {
      htmlBody: buildMonthlyDigestHtml_(stats),
      from: 'vefur@storkaup.is',
      name: 'Stórkaup ehf'
    });

    result.sent = true;
    result.recipients = recipients.length;
    result.monthStart = monthStartIso;
    result.finishedAt = new Date().toISOString();
    Logger.log(EMAIL_LOG_ + '[INFO] Completed scheduledMonthlyDigest: ' + JSON.stringify(result));
    return result;
  } catch (e) {
    result.error = { message: e.message || String(e), stack: e.stack || '' };
    result.finishedAt = new Date().toISOString();
    try { notifyTriggerFailure_('scheduledMonthlyDigest', e, result); } catch (_) {}
    Logger.log(EMAIL_LOG_ + '[ERROR] scheduledMonthlyDigest failed: ' + JSON.stringify(result));
    throw e;
  }
}

// ── Menu: send monthly digest now ─────────────────────────────────────────────

function menu_sendMonthlyDigest() {
  var ui = SpreadsheetApp.getUi();
  var defaultRcpts = getDigestRecipients_().join(', ');
  var resp = ui.prompt(
    'Mánaðaryfirlit',
    'Senda á (aðskilið með kommu):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var input = String(resp.getResponseText() || defaultRcpts).trim() || defaultRcpts;
  var rcpts = input.split(/[;,]/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (!rcpts.length) { ui.alert('Ekkert gilt netfang.'); return; }

  toast_('Sendi mánaðaryfirlit...', 'Email');
  var now = new Date();
  var prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  var stats = fetchMonthlyDigestStats_(digestIso_(prevMonthStart));
  var subject = 'Mánaðaryfirlit — ' + digestMonthLabel_(stats.month);
  GmailApp.sendEmail(rcpts.join(','), subject, buildMonthlyDigestPlain_(stats), {
    htmlBody: buildMonthlyDigestHtml_(stats),
    from: 'vefur@storkaup.is',
    name: 'Stórkaup ehf'
  });
  toast_('Sent til ' + rcpts.join(', '), 'Email');
}

// Safe test — sends the monthly digest only to oj@storkaup.is (no risk of mailing all staff).
function menu_testMonthlyDigest() {
  var to = 'oj@storkaup.is';
  toast_('Sendi TEST mánaðaryfirlit til ' + to + '...', 'Email');
  var now = new Date();
  var prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  var stats = fetchMonthlyDigestStats_(digestIso_(prevMonthStart));
  var subject = 'TEST — Mánaðaryfirlit — ' + digestMonthLabel_(stats.month);
  GmailApp.sendEmail(to, subject, buildMonthlyDigestPlain_(stats), {
    htmlBody: buildMonthlyDigestHtml_(stats),
    from: 'vefur@storkaup.is',
    name: 'Stórkaup ehf'
  });
  toast_('TEST sent til ' + to, 'Email');
}

// ── Data fetch: monthly ───────────────────────────────────────────────────────

function fetchMonthlyDigestStats_(monthStartIso) {
  var raw = callSupabaseRpc_('monthly_digest_stats', { p_month_start: monthStartIso });
  var parsed = safeJsonParse_(raw, null);
  if (Array.isArray(parsed) && parsed.length) return parsed[0];
  return parsed || {};
}

// ── HTML: monthly digest ──────────────────────────────────────────────────────

function buildMonthlyDigestHtml_(s) {
  var monthLabel = digestMonthLabel_(s.month);
  var prevLabel  = digestMonthLabel_(s.prev_month);

  // BC fields (incl. web-share %) intentionally not shown — monthly digest is
  // pure web-sales data while BC ingestion is on hold (pending DataBricks/Power BI).
  // Web-share of total BC sales returns when DataBricks is the governed source.
  var webRev       = emailNum_(s.web_revenue_excl);
  var webOrd       = emailNum_(s.web_orders);
  var prevWebRev   = emailNum_(s.prev_web_revenue_excl);
  var prevWebOrd   = emailNum_(s.prev_web_orders);

  var newCust     = emailNum_(s.new_customers);
  var prevNewCust = emailNum_(s.prev_new_customers);
  var newCustList = emailParseArr_(s.new_customers_list);
  var topCust     = emailParseArr_(s.top_customers);
  var topProd     = emailParseArr_(s.top_products);

  var rr = s.runrate || {};
  var rrDaysElapsed = emailNum_(rr.days_elapsed);
  var rrMtdOrders   = emailNum_(rr.mtd_orders);
  var showRunRate   = rrDaysElapsed >= 5 && rrMtdOrders > 0;

  var newCustRows = newCustList.length
    ? newCustList.map(function(c) {
        return '<div class="sk-row">'
          + '<span style="font-weight:600;">' + emailEsc_(c.name || '?')
          + ' <span class="sk-new">Nýr</span></span>'
          + '<span style="color:#3B6D11;font-size:12px;">Fyrsta pöntun: '
          + emailIskShort_(c.revenue) + '</span></div>';
      }).join('')
    : '<div class="sk-row"><span style="color:#888;">Engir nýir viðskiptavinir þennan mánuð.</span></div>';

  var topRows = topCust.length
    ? topCust.map(function(c) {
        return '<div class="sk-row">'
          + '<span style="font-weight:600;">' + emailEsc_(c.name || '?') + '</span>'
          + '<span style="color:#1a1a6e;font-weight:600;">' + emailIskShort_(c.revenue_excl) + '</span>'
          + '</div>';
      }).join('')
    : '<div class="sk-row"><span style="color:#888;">–</span></div>';

  var prodRows = topProd.length
    ? topProd.map(function(p) {
        return '<div class="sk-row">'
          + '<span style="font-weight:600;">' + emailEsc_(p.name || '?') + '</span>'
          + '<span style="color:#1a1a6e;font-weight:600;">' + emailIskShort_(p.revenue_excl) + '</span>'
          + '</div>';
      }).join('')
    : '<div class="sk-row"><span style="color:#888;">–</span></div>';

  var CSS = '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#1a1a2e}'
    + '.sk-header{background:#ffffff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e0e0e0;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e0e0e0;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e8e8e8;margin:20px 0}'
    + '.sk-lbl{margin:0 0 12px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.8px}'
    + '.sk-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}'
    + '.sk-kpi{background:#f8f8fb;border:1px solid #e8e8e8;border-radius:8px;padding:14px 16px}'
    + '.sk-kpi-lbl{font-size:11px;color:#888;margin:0 0 4px}'
    + '.sk-kpi-val{font-size:22px;font-weight:700;color:#1a1a6e;margin:0 0 4px}'
    + '.sk-share{background:#10069f;border-radius:8px;padding:16px 18px;color:#fff}'
    + '.sk-share-lbl{font-size:11px;color:#b0b8e0;margin:0 0 4px}'
    + '.sk-share-val{font-size:26px;font-weight:700;color:#fff;margin:0}'
    + '.up{font-size:12px;color:#1a7a4a;font-weight:600}'
    + '.dn{font-size:12px;color:#c0392b;font-weight:600}'
    + '.ne{font-size:12px;color:#888}'
    + '.sk-list{background:#f8f8fb;border:1px solid #e8e8e8;border-radius:8px;padding:4px 16px;margin-bottom:10px}'
    + '.sk-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px}'
    + '.sk-row:last-child{border-bottom:none}'
    + '.sk-badge{background:#eaf3de;border-radius:6px;padding:10px 14px;font-size:12px;color:#3B6D11;font-weight:600}'
    + '.sk-new{display:inline-block;background:#eaf3de;color:#3B6D11;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;margin-left:6px;vertical-align:middle}'
    + '.sk-note{font-size:11px;color:#999;margin:2px 0 0;line-height:1.5}'
    + '.sk-btn{display:inline-block;background:#1a1a6e;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';

  function kpi(label, value, pctHtml) {
    return '<div class="sk-kpi">'
      + '<p class="sk-kpi-lbl">' + label + '</p>'
      + '<p class="sk-kpi-val">' + value + '</p>'
      + pctHtml + '</div>';
  }
  function share(label, value) {
    return '<div class="sk-share">'
      + '<p class="sk-share-lbl">' + label + '</p>'
      + '<p class="sk-share-val">' + value + '</p></div>';
  }

  var runRateHtml = '';
  if (showRunRate) {
    runRateHtml = '<p class="sk-lbl">Þessi mánuður hingað til ('
      + rrDaysElapsed + ' af ' + emailNum_(rr.days_in_month) + ' dögum)</p>'
      + '<div class="sk-grid">'
      + kpi('Vefpantanir hingað til', String(rrMtdOrders),
          (rr.projected_orders != null ? '<span class="ne">spá mánaðar: ' + emailNum_(rr.projected_orders) + '</span>' : '<span class="ne">–</span>'))
      + kpi('Vefvelta hingað til', emailIskShort_(emailNum_(rr.mtd_revenue_excl)),
          (rr.projected_revenue_excl != null ? '<span class="ne">spá: ' + emailIskShort_(emailNum_(rr.projected_revenue_excl)) + '</span>' : '<span class="ne">–</span>'))
      + '</div>'
      + '<p class="sk-note">Spá er einföld hlutfallsleg framreikning (run-rate) og er aðeins til viðmiðunar.</p>'
      + '<hr class="sk-divider">';
  }

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' + CSS + '</head><body>'
    + '<div class="sk-email">'

    // Header
    + '<div class="sk-header">'
    + emailLogoImg_()
    + '</div>'

    // Body
    + '<div class="sk-body">'
    + '<div style="font-size:18px;font-weight:700;color:#282828;margin:4px 0 10px;">Mánaðaryfirlit — ' + monthLabel + '</div>'
    + '<p style="margin:0 0 12px;color:#444;line-height:1.6;font-size:13px;">Yfirlit yfir helstu tölur mánaðarins hjá Stórkaup. Allar tölur eru sjálfvirkt sóttar úr kerfinu.</p>'
    + '<p style="margin:0 0 20px;font-size:13px;background:#f5f6ff;border:1px solid #e9e9e9;border-radius:6px;padding:10px 14px;color:#5b5b5b;">Aðgangsorð: <strong style="color:#282828;">Stortkaup_2026</strong></p>'

    // Vefsala
    + '<p class="sk-lbl">Vefsala</p>'
    + '<div class="sk-grid">'
    + kpi('Vefvelta mánaðar', emailIskShort_(webRev),   emailPctSpan_(webRev,   prevWebRev,   'fyrri mánuð'))
    + kpi('Vefpantanir',      String(webOrd),            emailPctSpan_(webOrd,   prevWebOrd,   'fyrri mánuð'))
    + '</div>'
    + '<hr class="sk-divider">'

    // Nýir viðskiptavinir
    + '<p class="sk-lbl">Nýir viðskiptavinir mánaðar</p>'
    + '<div class="sk-list">' + newCustRows + '</div>'
    + '<div class="sk-badge">' + newCust + ' nýir viðskiptavinir í ' + monthLabel + ' — ' + prevNewCust + ' í ' + prevLabel + '</div>'
    + '<hr class="sk-divider">'

    // Stærstu viðskiptavinir
    + '<p class="sk-lbl">Stærstu viðskiptavinir mánaðar (vefur)</p>'
    + '<div class="sk-list">' + topRows + '</div>'
    + '<hr class="sk-divider">'

    // Vinsælustu vörur
    + '<p class="sk-lbl">Vinsælustu vörur (síðustu 30 daga)</p>'
    + '<div class="sk-list">' + prodRows + '</div>'
    + '<hr class="sk-divider">'

    // Run-rate (conditional)
    + runRateHtml

    // CTA
    + '<div style="text-align:center;padding:8px 0 4px;">'
    + '<a class="sk-btn" href="https://storkaup.webflow.io/kpi/dashboard">Sjá allar tölur á mælaborðinu</a>'
    + '</div>'
    + '</div>' // sk-body

    // Footer
    + '<div class="sk-footer">'
    + '<p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. &middot; Sent sjálfvirkt 1. hvers mánaðar &middot; '
    + '<a href="https://storkaup.webflow.io/kpi/dashboard" style="color:#888;">storkaup.webflow.io</a></p>'
    + '</div>'

    + '</div></body></html>';

  return html;
}

// ── Plain-text fallback: monthly ──────────────────────────────────────────────

function buildMonthlyDigestPlain_(s) {
  var monthLabel = digestMonthLabel_(s.month);
  var lines = [
    'Mánaðaryfirlit — ' + monthLabel, '',
    'VEFSALA (vs ' + digestMonthLabel_(s.prev_month) + ')',
    'Vefvelta  : ' + emailIskShort_(emailNum_(s.web_revenue_excl)) + ' (án VSK)',
    'Vefpant.  : ' + emailNum_(s.web_orders), '',
    'NÝIR VIÐSKIPTAVINIR',
    'Í ' + monthLabel + ' : ' + emailNum_(s.new_customers),
    'Í ' + digestMonthLabel_(s.prev_month) + ' : ' + emailNum_(s.prev_new_customers)
  ];
  emailParseArr_(s.new_customers_list).forEach(function(c, i) {
    lines.push((i + 1) + '. ' + (c.name || '?') + ' — ' + emailIskShort_(c.revenue));
  });
  lines.push('', 'STÆRSTU VIÐSKIPTAVINIR (vefur)');
  emailParseArr_(s.top_customers).forEach(function(c, i) {
    lines.push((i + 1) + '. ' + (c.name || '?') + ' — ' + emailIskShort_(c.revenue_excl));
  });
  lines.push('', 'VINSÆLUSTU VÖRUR (síðustu 30 daga)');
  emailParseArr_(s.top_products).forEach(function(p, i) {
    lines.push((i + 1) + '. ' + (p.name || '?') + ' — ' + emailIskShort_(p.revenue_excl));
  });
  var rr = s.runrate || {};
  if (emailNum_(rr.days_elapsed) >= 5 && emailNum_(rr.mtd_orders) > 0) {
    lines.push('', 'ÞESSI MÁNUÐUR HINGAÐ TIL (' + emailNum_(rr.days_elapsed) + '/' + emailNum_(rr.days_in_month) + ' dagar)',
      'Vefpantanir : ' + emailNum_(rr.mtd_orders) + (rr.projected_orders != null ? ' (spá: ' + emailNum_(rr.projected_orders) + ')' : ''),
      'Vefvelta    : ' + emailIskShort_(emailNum_(rr.mtd_revenue_excl)) + (rr.projected_revenue_excl != null ? ' (spá: ' + emailIskShort_(emailNum_(rr.projected_revenue_excl)) + ')' : ''));
  }
  lines.push('', 'Aðgangsorð: Stortkaup_2026', 'KPI: https://storkaup.webflow.io/kpi/dashboard');
  return lines.join('\n');
}

// ── Trigger installer: monthly ────────────────────────────────────────────────

function installMonthlyDigestTrigger_v1() {
  var fn = 'scheduledMonthlyDigest';
  var existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === fn;
  });
  if (existing.length) {
    Logger.log(EMAIL_LOG_ + '[INFO] Trigger already exists for ' + fn + ' (' + existing.length + ')');
    return { created: false, existing: existing.length };
  }
  ScriptApp.newTrigger(fn)
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .nearMinute(0)
    .create();
  Logger.log(EMAIL_LOG_ + '[INFO] Created monthly digest trigger (1st of month at ~08:00 UTC)');
  return { created: true, schedule: 'onMonthDay(1).atHour(8).nearMinute(0)' };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function digestIso_(d) {
  return d.getUTCFullYear() + '-'
    + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(d.getUTCDate()).padStart(2, '0');
}

function digestPeriodLabel_(ws, we, showYear) {
  var d1 = ws.getUTCDate();
  var d2 = we.getUTCDate();
  var m1 = ws.getUTCMonth();
  var m2 = we.getUTCMonth();
  var y  = we.getUTCFullYear();
  var ySuffix = showYear ? ' ' + y : '';
  if (m1 === m2) {
    return d1 + '.–' + d2 + '. ' + ICE_MONTHS_[m2] + ySuffix;
  }
  return d1 + '. ' + ICE_MONTHS_[m1] + ' – ' + d2 + '. ' + ICE_MONTHS_[m2] + ySuffix;
}

// 'YYYY-MM' -> 'maí 2026' (full Icelandic month name)
function digestMonthLabel_(ym) {
  if (!ym) return '?';
  var parts = String(ym).split('-');
  var mi = parseInt(parts[1], 10) - 1;
  if (isNaN(mi) || mi < 0 || mi > 11) return String(ym);
  return ICE_MONTHS_FULL_[mi] + ' ' + parts[0];
}

function digestDateIce_(d) {
  return String(d.getUTCDate()).padStart(2, '0') + '.'
    + String(d.getUTCMonth() + 1).padStart(2, '0') + '.'
    + d.getUTCFullYear();
}

function emailNum_(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : Math.round(n);
}

function emailIskShort_(v) {
  var n = Number(v);
  if (isNaN(n)) return '–';
  var abs = Math.abs(n);
  var sign = n < 0 ? '-' : '';
  if (abs >= 1000000) {
    return sign + (abs / 1000000).toFixed(1).replace('.', ',') + ' m.kr.';
  }
  var s = String(Math.round(abs));
  var out = '';
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '.';
    out += s[i];
  }
  return sign + out + ' kr.';
}

// Alias used by plain-text fallback
function fmtIsk_(v) { return emailIskShort_(v); }

function emailPctSpan_(current, prev, label) {
  label = label || 'síðasta vika';
  if (!prev || prev === 0) return '<span class="ne">–</span>';
  var p = ((current - prev) / Math.abs(prev)) * 100;
  var abs = Math.abs(p).toFixed(1).replace('.', ',');
  return p >= 0
    ? '<span class="up">↑ ' + abs + '% vs ' + label + '</span>'
    : '<span class="dn">↓ ' + abs + '% vs ' + label + '</span>';
}

// Format a 0..1 fraction as an Icelandic percentage, e.g. 0.364 -> "36,4%"
function emailPctVal_(v) {
  var n = Number(v);
  if (isNaN(n)) return '–';
  return (n * 100).toFixed(1).replace('.', ',') + '%';
}

// Stórkaup logo <img> for email headers (same asset as umsókn/rafræn templates)
function emailLogoImg_() {
  return '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="Stórkaup" style="height:64px;width:auto;">';
}

function emailEsc_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Rafræn Innskráning redirect ───────────────────────────────────────────────

function buildRafraenRedirectHtml_(recipientName, companyName) {
  var name    = emailEsc_(recipientName || '');
  var company = emailEsc_(companyName  || '');
  var greeting = name ? 'Góðan dag ' + name : 'Góðan dag';
  var notFoundLine = company
    ? 'Við innslátt fannst hins vegar <strong>' + company + '</strong> ekki í viðskiptum hjá Stórkaup.'
    : 'Við innslátt fannst hins vegar ekki fyrirtæki sem er nú þegar í viðskiptum hjá Stórkaup.';
  var CSS = '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#282828}'
    + '.sk-header{background:#fff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e9e9e9;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e9e9e9;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e9e9e9;margin:24px 0}'
    + '.sk-btn{display:inline-block;background:#10069f;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + CSS + '</head><body>'
    + '<div class="sk-email">'
    + '<div class="sk-header">'
    + '<div style="display:flex;align-items:center;">'
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="Stórkaup logo" style="height:64px;width:auto;vertical-align:middle;">'
    + '</div>'
    + '</div>'
    + '<div class="sk-body">'
    + '<p style="margin:0 0 12px;font-size:18px;font-weight:700;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Takk fyrir að skrá upplýsingar fyrir innskráningu með rafrænum skilríkjum í vefverslun Stórkaups.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">' + notFoundLine + '</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Til þess að sækja um viðskipti þarf að fylla út þetta form:</p>'
    + '<a class="sk-btn" href="https://storkaup.typeform.com/umsoknvidskipti">Sækja um viðskipti</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Ef þú hefur spurningar, hafðu samband við <a href="mailto:vefur@storkaup.is" style="color:#10069f;text-decoration:none;">vefur@storkaup.is</a></p>'
    + '</div>'
    + '<div class="sk-footer">'
    + '<p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. | Vefverslun</p>'
    + '</div>'
    + '</div></body></html>';
}

function buildRafraenRedirectPlain_(recipientName, companyName) {
  var greeting = recipientName ? 'Góðan dag ' + recipientName : 'Góðan dag';
  var notFoundLine = companyName
    ? 'Við innslátt fannst hins vegar ' + companyName + ' ekki í viðskiptum hjá Stórkaup.'
    : 'Við innslátt fannst hins vegar ekki fyrirtæki sem er nú þegar í viðskiptum hjá Stórkaup.';
  return greeting + '\n\n'
    + 'Takk fyrir að skrá upplýsingar fyrir innskráningu með rafrænum skilríkjum í vefverslun Stórkaups.\n\n'
    + notFoundLine + '\n\n'
    + 'Til þess að sækja um viðskipti þarf að fylla út þetta form hér:\n'
    + 'https://storkaup.typeform.com/umsoknvidskipti\n\n'
    + 'Kveðja,\nStórkaup';
}

// ── Umsókn um viðskipti — email templates ────────────────────────────────────

function umsokn_CSS_() {
  return '<style>'
    + '.sk-email{max-width:600px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#282828}'
    + '.sk-header{background:#fff;border:1px solid #e9e9e9;border-bottom:none;padding:28px 32px;border-radius:8px 8px 0 0}'
    + '.sk-body{background:#fff;border:1px solid #e9e9e9;border-top:none;padding:28px 32px}'
    + '.sk-footer{background:#f5f5f5;border:1px solid #e9e9e9;border-top:none;padding:16px 32px;border-radius:0 0 8px 8px}'
    + '.sk-divider{border:none;border-top:1px solid #e9e9e9;margin:24px 0}'
    + '.sk-btn{display:inline-block;background:#10069f;color:#fff!important;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none}'
    + '</style>';
}

function umsokn_wrap_(bodyHtml) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + umsokn_CSS_() + '</head><body>'
    + '<div class="sk-email">'
    + '<div class="sk-header"><div style="display:flex;align-items:center;">'
    + '<img src="https://images.prismic.io/storkaup/agbVeKYofJOwHQ9Y_klavyio-storkauplogo.jpg" alt="Stórkaup" style="height:64px;width:auto;">'
    + '</div></div>'
    + '<div class="sk-body">' + bodyHtml + '</div>'
    + '<div class="sk-footer"><p style="margin:0;font-size:11px;color:#888;">Stórkaup ehf. | Vefverslun</p></div>'
    + '</div></body></html>';
}

// Template 1 — Einstaklingur ekki með VSK-númer
function buildUmsokn_NoVskHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'Kæri/Kæra ' + emailEsc_(recipientName) : 'Kæri móttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Við vinnslu upplýsinga á skráningu kom í ljós að kennitala á umsókn er ekki á fyrirtækjaskrá og því ekki með VSK-númer.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Stórkaup ehf. selur einungis til fyrirtækja, stofnana og einstaklinga í rekstri sem hafa VSK-númer. <strong>Umsókn um viðskipti við Stórkaup er því hafnað.</strong></p>'
    + '<p style="margin:0 0 0;line-height:1.6;">Sé um mistök að ræða við innslátt á vefnum, biðjum við þig um að senda inn leiðrétta skráningu í gegnum vefinn hjá okkur.</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Bestu kveðjur,<br>Stórkaup ehf.</p>'
  );
}
function buildUmsokn_NoVskPlain_(recipientName) {
  var greeting = recipientName ? 'Kæri/Kæra ' + recipientName : 'Kæri móttakandi';
  return greeting + '\n\n'
    + 'Við vinnslu upplýsinga á skráningu kom í ljós að kennitala á umsókn er ekki á fyrirtækjaskrá og því ekki með VSK-númer.\n\n'
    + 'Stórkaup ehf. selur einungis til fyrirtækja, stofnana og einstaklinga í rekstri sem hafa VSK-númer. Umsókn um viðskipti við Stórkaup er því hafnað.\n\n'
    + 'Sé um mistök að ræða við innslátt á vefnum, biðjum við þig um að senda inn leiðrétta skráningu í gegnum vefinn hjá okkur.\n\n'
    + 'Bestu kveðjur,\nStórkaup ehf.';
}

// Template 2 — Þarf lánshæfismat (einstaklingur í rekstri)
function buildUmsokn_NeedsCreditHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'Kæri/Kæra ' + emailEsc_(recipientName) : 'Kæri móttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Takk fyrir skráninguna hjá Stórkaup. Þar sem þú ert einstaklingur í rekstri á eigin kennitölu höfum við ekki aðgang að lánshæfismati Creditinfo.</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Til að geta fullunnið umsóknina þarft þú að fara inn á <a href="https://www.creditinfo.is" style="color:#10069f;">creditinfo.is</a>, sækja lánshæfismat þitt og senda á <a href="mailto:bokhald@storkaup.is" style="color:#10069f;">bokhald@storkaup.is</a>. Í framhaldinu er hægt að ljúka við skráninguna.</p>'
    + '<p style="margin:0 0 0;line-height:1.6;color:#555;font-size:13px;">Mikilvægt: nafn umsækjanda þarf að koma fram á lánshæfismatinu — skjáskot af skori nægir ekki ef nafnið er ekki sýnilegt.</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">Bestu kveðjur,<br>Stórkaup ehf.</p>'
  );
}
function buildUmsokn_NeedsCreditPlain_(recipientName) {
  var greeting = recipientName ? 'Kæri/Kæra ' + recipientName : 'Kæri móttakandi';
  return greeting + '\n\n'
    + 'Takk fyrir skráninguna hjá Stórkaup. Þar sem þú ert einstaklingur í rekstri á eigin kennitölu höfum við ekki aðgang að lánshæfismati Creditinfo.\n\n'
    + 'Til að geta fullunnið umsóknina þarft þú að fara inn á https://www.creditinfo.is og sækja lánshæfismat þitt og senda á bokhald@storkaup.is. Í framhaldinu er hægt að ljúka við skráninguna.\n\n'
    + 'Mikilvægt: nafn umsækjanda þarf að koma fram á lánshæfismatinu — skjáskot af skori nægir ekki ef nafnið er ekki sýnilegt.\n\n'
    + 'Bestu kveðjur,\nStórkaup ehf.';
}

// Template 3 — Lánshæfismat uppfyllir ekki skilyrði (staðgreiðsla)
function buildUmsokn_CashOnlyHtml_(recipientName) {
  var greeting = emailEsc_(recipientName || '') ? 'Kæri/Kæra ' + emailEsc_(recipientName) : 'Kæri móttakandi';
  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + greeting + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">Við þökkum fyrir umsókn um viðskipti hjá Stórkaup. Við höfum sótt lánshæfismat frá Creditinfo og í ljósi niðurstöðu þess getum við því miður ekki opnað á reikningsviðskipti eins og óskað var eftir.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Hægt er að notast við staðgreiðsluferli í gegnum vefverslunina þar sem hægt er að greiða með korti þegar gengið er frá kaupum.</p>'
    + '<p style="margin:0 0 16px;line-height:1.6;">Aðgangur þinn er virkur og getur þú skráð þig inn á vef Stórkaups með rafrænni auðkenningu.</p>'
    + '<a class="sk-btn" href="https://storkaup.is" style="display:inline-block;margin-top:10px;">Fara í vefverslun</a>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0 0 12px;color:#666;font-size:13px;line-height:1.6;">Ekki hika við að vera í sambandi við Sölu- og þjónustuver Stórkaups í síma <strong>515-1500</strong> eða með því að senda póst á <a href="mailto:sala@storkaup.is" style="color:#10069f;">sala@storkaup.is</a></p>'
    + '<p style="margin:0;color:#666;font-size:13px;">Bestu kveðjur,<br>Stórkaup ehf.</p>'
  );
}
function buildUmsokn_CashOnlyPlain_(recipientName) {
  var greeting = recipientName ? 'Kæri/Kæra ' + recipientName : 'Kæri móttakandi';
  return greeting + '\n\n'
    + 'Við þökkum fyrir umsókn um viðskipti hjá Stórkaup. Við höfum sótt lánshæfismat frá Creditinfo og í ljósi niðurstöðu þess getum við því miður ekki opnað á reikningsviðskipti eins og óskað var eftir.\n\n'
    + 'Hægt er að notast við staðgreiðsluferli í gegnum vefverslunina þar sem hægt er að greiða með korti þegar gengið er frá kaupum.\n\n'
    + 'Aðgangur þinn er virkur og getur þú skráð þig inn á vef Stórkaups með rafrænni auðkenningu.\n\nhttps://storkaup.is\n\n'
    + 'Ekki hika við að vera í sambandi við Sölu- og þjónustuver Stórkaups í síma 515-1500 eða með því að senda póst á sala@storkaup.is\n\n'
    + 'Bestu kveðjur,\nStórkaup ehf.';
}

function emailParseArr_(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) { return []; }
  }
  return [];
}

// ── Cache-clearing troubleshooting email (support tool) ───────────────────────
// After a storkaup.is update some customers get a stale browser/edge cache and
// hit login or product-browsing issues. This generates a pre-written, two-language
// troubleshooting email so the support team can answer those quickly instead of
// handling each one ad hoc. Internal tooling — not a customer-facing dashboard.

// Single content model → both plain text and HTML are derived from this, so the
// two renderings can never drift apart.
function cacheEmailContent_(lang) {
  var l = (String(lang || 'is').toLowerCase() === 'en') ? 'en' : 'is';
  if (l === 'en') {
    return {
      lang: 'en',
      subject: 'Having trouble logging in to Storkaup.is? Try this first',
      greeting: function (name) { return 'Hi ' + (name || 'there') + ','; },
      intro: 'Thank you for reaching out. After a recent update to our website, your browser may be holding on to an older version of the site — this can sometimes cause issues with login or browsing products.',
      stepsLead: 'This is usually fixed in a few simple steps:',
      steps: [
        'Close your browser completely (not just the tab)',
        'Reopen your browser',
        'Go to www.storkaup.is and try again'
      ],
      clearLead: "If that doesn't work, clear your browser cache:",
      clearItems: [
        'Chrome / Edge: Ctrl + Shift + Delete → check "Cached images" and "Cookies" → Clear data',
        'Firefox: Ctrl + Shift + Delete → check "Cache" → Clear',
        'Mac (all browsers): ⌘ + Shift + Delete'
      ],
      afterClear: 'After clearing: close the browser, reopen it, and try logging in again.',
      persists: "If the issue persists after these steps, please don't hesitate to reach out and we'll take a closer look.",
      signoff: 'Best regards,',
      senderFallback: '[Your name]',
      company: 'Stórkaup'
    };
  }
  return {
    lang: 'is',
    subject: 'Vandræði með innskráningu á Stórkaup.is? Prófaðu þetta',
    greeting: function (name) { return name ? 'Halló ' + name + ',' : 'Halló,'; },
    intro: 'Takk fyrir að hafa samband. Þegar við uppfærum vefinn getur vafrinn þinn stundum haldið í gamlar upplýsingar sem geta valdið vandræðum við innskráningu eða vöruskoðun.',
    stepsLead: 'Þetta er yfirleitt auðveldlega lagað með þessum skrefum:',
    steps: [
      'Lokaðu vafranum alveg (ekki bara flipann)',
      'Opnaðu vafrann aftur',
      'Farðu á www.storkaup.is og reyndu aftur'
    ],
    clearLead: 'Ef það hjálpar ekki:',
    clearItems: [
      'Chrome / Edge: Ctrl + Shift + Delete → hakaðu við "Skyndiminni" og "Vafrakökur" → Hreinsa',
      'Firefox: Ctrl + Shift + Delete → hakaðu við "Skyndiminni" → Hreinsa',
      'Mac (allir vafrar): ⌘ + Shift + Delete'
    ],
    afterClear: 'Eftir hreinsun: lokaðu vafranum, opnaðu aftur og reyndu innskráningu.',
    persists: 'Ef vandinn er enn til staðar eftir þetta, vinsamlegast hafðu samband og við förum yfir málið með þér.',
    signoff: 'Kveðja,',
    senderFallback: '[Nafn þitt]',
    company: 'Stórkaup'
  };
}

// Pure generator: returns { subject, body } as plain text.
//   lang         'is' | 'en'  (anything other than 'en' is treated as Icelandic)
//   customerName recipient first name (optional — greeting degrades gracefully)
//   senderName   support agent name for the sign-off (optional — placeholder kept)
function generateCacheEmail_(lang, customerName, senderName) {
  var c = cacheEmailContent_(lang);
  var name = String(customerName || '').trim();
  var sender = String(senderName || '').trim() || c.senderFallback;

  var steps = c.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
  var clearItems = c.clearItems.map(function (s) { return '• ' + s; }).join('\n');

  var body = c.greeting(name) + '\n\n'
    + c.intro + '\n\n'
    + c.stepsLead + '\n\n'
    + steps + '\n\n'
    + c.clearLead + '\n'
    + clearItems + '\n\n'
    + c.afterClear + '\n\n'
    + c.persists + '\n\n'
    + c.signoff + '\n'
    + sender + '\n'
    + c.company;

  return { subject: c.subject, body: body };
}

// On-brand HTML version (same wrapper as the Umsókn emails) for actually sending.
function buildCacheEmailHtml_(lang, customerName, senderName) {
  var c = cacheEmailContent_(lang);
  var name = String(customerName || '').trim();
  var sender = String(senderName || '').trim() || c.senderFallback;

  var steps = c.steps.map(function (s) {
    return '<li style="margin:0 0 6px;line-height:1.6;">' + emailEsc_(s) + '</li>';
  }).join('');
  var clearItems = c.clearItems.map(function (s) {
    return '<li style="margin:0 0 6px;line-height:1.6;">' + emailEsc_(s) + '</li>';
  }).join('');

  return umsokn_wrap_(
    '<p style="margin:0 0 12px;font-size:15px;font-weight:600;">' + emailEsc_(c.greeting(name)) + '</p>'
    + '<p style="margin:0 0 12px;line-height:1.6;">' + emailEsc_(c.intro) + '</p>'
    + '<p style="margin:0 0 8px;line-height:1.6;">' + emailEsc_(c.stepsLead) + '</p>'
    + '<ol style="margin:0 0 16px;padding-left:20px;">' + steps + '</ol>'
    + '<p style="margin:0 0 8px;line-height:1.6;">' + emailEsc_(c.clearLead) + '</p>'
    + '<ul style="margin:0 0 16px;padding-left:20px;">' + clearItems + '</ul>'
    + '<p style="margin:0 0 12px;line-height:1.6;">' + emailEsc_(c.afterClear) + '</p>'
    + '<p style="margin:0 0 0;line-height:1.6;">' + emailEsc_(c.persists) + '</p>'
    + '<hr class="sk-divider">'
    + '<p style="margin:0;color:#666;font-size:13px;line-height:1.6;">' + emailEsc_(c.signoff)
    + '<br>' + emailEsc_(sender) + '<br>' + emailEsc_(c.company) + '</p>'
  );
}

// ── Menu: send cache-help email to a customer ─────────────────────────────────
function menu_sendCacheHelpEmail() {
  var ui = SpreadsheetApp.getUi();

  var langResp = ui.prompt(
    'Cache-hjálp tölvupóstur',
    'Tungumál? Sláðu inn "is" (íslenska) eða "en" (enska):',
    ui.ButtonSet.OK_CANCEL
  );
  if (langResp.getSelectedButton() !== ui.Button.OK) return;
  var lang = (String(langResp.getResponseText() || 'is').trim().toLowerCase() === 'en') ? 'en' : 'is';

  var toResp = ui.prompt('Cache-hjálp tölvupóstur', 'Netfang viðtakanda:', ui.ButtonSet.OK_CANCEL);
  if (toResp.getSelectedButton() !== ui.Button.OK) return;
  var to = String(toResp.getResponseText() || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { ui.alert('Ógilt netfang.'); return; }

  var nameResp = ui.prompt('Cache-hjálp tölvupóstur', 'Nafn viðtakanda (má sleppa):', ui.ButtonSet.OK_CANCEL);
  if (nameResp.getSelectedButton() !== ui.Button.OK) return;
  var customerName = String(nameResp.getResponseText() || '').trim();

  var senderResp = ui.prompt('Cache-hjálp tölvupóstur', 'Nafn þitt (undirskrift):', ui.ButtonSet.OK_CANCEL);
  if (senderResp.getSelectedButton() !== ui.Button.OK) return;
  var senderName = String(senderResp.getResponseText() || '').trim();

  var email = generateCacheEmail_(lang, customerName, senderName);
  var confirm = ui.alert(
    'Senda á ' + to + '?',
    'Efni: ' + email.subject + '\n\n' + email.body,
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  GmailApp.sendEmail(to, email.subject, email.body, {
    htmlBody: buildCacheEmailHtml_(lang, customerName, senderName),
    from: 'vefur@storkaup.is',
    name: 'Stórkaup ehf'
  });
  toast_('Cache-hjálp póstur sendur til ' + to, 'Email');
}

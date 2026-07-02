'use strict';

/************************************************************
 * auth.js — aðgangsstýring admin-appanna
 *
 * Web-appið er deployað `executeAs: USER_DEPLOYING` + `access: DOMAIN`:
 * Google sér um innskráninguna (aðeins @storkaup.is aðgangar komast að),
 * en þessi vörður þrengir svo aðganginn að tilteknum notendum.
 *
 * Allowlist: STORKAUP_CONFIG → SETTINGS → ADMIN_APP_EMAILS
 * (kommu-aðskilin netföng). Eigandinn (deployerinn) hefur alltaf aðgang
 * þó stillingin vanti — ver gegn því að læsa sig úti með config-gati.
 ************************************************************/

function adminGuard_() {
  var user  = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  var owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();

  if (!user) {
    throw new Error('Auðkenning fannst ekki — opnaðu appið innskráð(ur) með @storkaup.is aðgangi.');
  }
  if (user === owner) return user;

  var cfg = loadConfig_();
  var raw = String((cfg.SETTINGS || {}).ADMIN_APP_EMAILS || '');
  var allow = raw.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);

  if (allow.indexOf(user) !== -1) return user;

  console.warn('[ADMIN][AUDIT] access DENIED for ' + user);
  throw new Error('Aðgangur ekki heimilaður fyrir ' + user + '. Hafðu samband við ' + owner + '.');
}

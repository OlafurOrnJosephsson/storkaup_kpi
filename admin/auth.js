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

/**
 * adminGuard_(appKey) — vörður fyrir hvert google.script.run inngangsfall.
 *
 * HVERS VEGNA appKey ER TIL:
 *   Vörðurinn var allt-eða-ekkert. Eitt nafn í ADMIN_APP_EMAILS gaf aðgang að
 *   ÖLLUM öppunum, líka umsóknaappinu með kennitölum og lánshæfismati. Um leið
 *   og einhver bætir textahöfundum við til að þeir komist í eitt app fá þeir
 *   PII-ið með. CLAUDE.md réttlætir klofninginn í tvö GAS-project með því að
 *   PII sitji ekki bak við slóðarleynd; allt-eða-ekkert allowlisti opnaði hann
 *   innan frá.
 *
 * VIDBAETANDI, ENGINN MISSIR AÐGANG:
 *   ADMIN_APP_EMAILS  → öll öpp, eins og áður.
 *   <APP>_APP_EMAILS  → aðeins það app.
 *   Eigandinn (deployerinn) sleppur alltaf, líka ef config vantar.
 *
 * Núverandi appKey: 'umsokn' (webapp.js), 'listaverd' (delegate.js).
 * Nýtt app fær sína röð í STORKAUP_CONFIG → SETTINGS, t.d.
 * VORUINNIHALD_APP_EMAILS, og engin kóðabreyting þarf hér.
 *
 * appKey er valkvætt. Kall án hans hegðar sér nákvæmlega eins og áður, svo
 * kallstaður sem er óvart óflokkaður verður ekki opinn — hann verður eins
 * strangur og hann var.
 */
function adminGuard_(appKey) {
  var user  = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  var owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  var app   = String(appKey || '').trim().toLowerCase();

  if (!user) {
    throw new Error('Auðkenning fannst ekki — opnaðu appið innskráð(ur) með @storkaup.is aðgangi.');
  }
  if (user === owner) return user;

  var cfg  = loadConfig_();
  var sets = cfg.SETTINGS || {};
  var rows = ['ADMIN_APP_EMAILS'];
  if (app) rows.push(app.toUpperCase().replace(/[^A-Z0-9]/g, '') + '_APP_EMAILS');

  for (var r = 0; r < rows.length; r++) {
    var raw = String(sets[rows[r]] || '');
    var allow = raw.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    if (allow.indexOf(user) !== -1) return user;
  }

  console.warn('[ADMIN][AUDIT] access DENIED for ' + user + ' (app=' + (app || 'ótilgreint') +
               ', leitað í ' + rows.join(' + ') + ')');
  throw new Error('Aðgangur ekki heimilaður fyrir ' + user +
                  (app ? ' að ' + app : '') + '. Hafðu samband við ' + owner + '.');
}

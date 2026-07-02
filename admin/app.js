'use strict';

/************************************************************
 * app.js — doGet router admin-appanna
 *
 *   .../exec               → umsóknar-appið (default)
 *   .../exec?app=umsokn    → umsóknar-appið
 *   .../exec?app=listaverd → listaverðs-/vörueftirlitsappið
 *
 * Engin nafnlaus aðgangur: manifest er access=DOMAIN og adminGuard_
 * þrengir að allowlist. Ekkert doPost — webhookar búa áfram í
 * aðal-projectinu.
 ************************************************************/

function doGet(e) {
  var user;
  try {
    user = adminGuard_();
  } catch (err) {
    return accessDeniedPage_(err.message);
  }

  var app  = String((e && e.parameter && e.parameter.app) || 'umsokn');
  var file = app === 'listaverd' ? 'listaverd_konnun' : 'umsokn_app';
  var title = app === 'listaverd' ? 'Stórkaup — Listaverð könnun' : 'Stórkaup — Umsóknir';

  console.log('[ADMIN][AUDIT] ' + user + ' opened ' + file);
  // Enginn setXFrameOptionsMode(ALLOWALL) — appið er opnað beint (nýr flipi),
  // ekki embeddað, svo default clickjacking-vörnin fær að halda sér.
  return HtmlService.createHtmlOutputFromFile(file).setTitle(title);
}

function accessDeniedPage_(message) {
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aðgangur</title></head>'
    + '<body style="font-family:Arial,sans-serif;max-width:480px;margin:80px auto;color:#282828;">'
    + '<h2 style="margin:0 0 12px;">Aðgangur ekki heimilaður</h2>'
    + '<p style="line-height:1.6;color:#555;">' + message.replace(/</g, '&lt;') + '</p>'
    + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Stórkaup — Aðgangur');
}

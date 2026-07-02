'use strict';

/************************************************************
 * delegate.js — aðgerðir sem keyra áfram í aðal-projectinu
 *
 * Þungu vélarnar (Magento-sync, umsókna-pruning) og zero-price
 * niðurstaðan (býr í Script Properties aðal-projectsins, skrifuð af
 * daglegum trigger) eru EKKI afritaðar hingað — í staðinn kallar
 * admin-appið á key-varðar API-actions í doPost aðal-projectsins.
 *
 * Config (STORKAUP_CONFIG → API tab):
 *   Dashboard | KEY      — sami lykill og Webflow notar
 *   Dashboard | EXEC_URL — /exec slóð aðal-projectsins
 *
 * Fallanöfnin hér verða að halda sér — HTML-öppin kalla þau með
 * google.script.run undir sömu nöfnum og í aðal-projectinu.
 ************************************************************/

function callCoreApi_(action, extra) {
  var cfg = loadConfig_();
  var url = cfg.API && cfg.API.Dashboard && cfg.API.Dashboard.EXEC_URL;
  var key = cfg.API && cfg.API.Dashboard && cfg.API.Dashboard.KEY;
  if (!url || !key) {
    throw new Error('Vantar API → Dashboard | EXEC_URL og/eða KEY í STORKAUP_CONFIG');
  }

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(Object.assign({ action: action, key: key }, extra || {})),
    muteHttpExceptions: true,
    followRedirects: true
  });

  var out = safeJsonParse_(res.getContentText());
  if (!out) throw new Error('Óskiljanlegt svar frá aðal-projecti (HTTP ' + res.getResponseCode() + ')');
  if (out.error) throw new Error('Aðal-project: ' + out.error);
  return out;
}

function syncMagentoCustomers() {
  adminGuard_();
  return callCoreApi_('sync_magento_customers');
}

function getZeroPriceResultForUi() {
  adminGuard_();
  return callCoreApi_('zero_price_result');
}

function getPendingOrdersForUi() {
  adminGuard_();
  try {
    return callCoreApi_('pending_orders');
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// Skönnunin tekur ~1 mín — lengur en UrlFetch leyfir. Ef beina kallið dettur
// á tíma heldur skönnunin samt áfram í aðal-projectinu, svo hér er pollað
// eftir ferskri niðurstöðu (lastRun breytist) í allt að 2 mínútur til viðbótar.
function runZeroPriceScanForUi() {
  adminGuard_();

  var beforeRun = null;
  try {
    var before = callCoreApi_('zero_price_result');
    beforeRun = before && before.lastRun;
  } catch (e) { /* engin fyrri niðurstaða — pollum bara á lastRun */ }

  try {
    var out = callCoreApi_('run_zero_price_scan');
    if (out && out.status === 'ok') return out;
  } catch (e) { /* líklega timeout — skönnunin keyrir áfram hinum megin */ }

  for (var i = 0; i < 12; i++) {
    Utilities.sleep(10000);
    try {
      var cur = callCoreApi_('zero_price_result');
      if (cur && cur.lastRun && cur.lastRun !== beforeRun) return cur;
    } catch (e2) { /* reynum næstu umferð */ }
  }
  return { status: 'error', message: 'Skönnun kláraði ekki í tæka tíð — opnaðu síðuna aftur eftir smá stund.' };
}

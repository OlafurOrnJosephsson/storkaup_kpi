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
  adminGuard_('listaverd');
  return callCoreApi_('sync_magento_customers');
}

function getZeroPriceResultForUi() {
  adminGuard_('listaverd');
  return callCoreApi_('zero_price_result');
}

function getComingSoonListForUi() {
  adminGuard_('listaverd');
  return callCoreApi_('coming_soon_list');
}

function getPendingOrdersForUi() {
  adminGuard_('listaverd');
  try {
    return callCoreApi_('pending_orders');
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// Skönnunin keyrir í BAKGRUNNI í aðal-projectinu (einskiptis-trigger).
// start skilar strax; appið spyr um stöðu á meðan. Sjá
// startZeroPriceScanForUi í core/storkaup_pricing.js.
function startZeroPriceScanForUi() {
  adminGuard_('listaverd');
  return callCoreApi_('start_zero_price_scan');
}

function getZeroPriceScanStatusForUi() {
  adminGuard_('listaverd');
  return callCoreApi_('zero_price_scan_status');
}

// Eldri samstillta leiðin — appið notar hana ekki lengur. Haldið svo gömul
// opin vafraflipi brotni ekki fyrr en þau eru endurhlaðin.
function runZeroPriceScanForUi() {
  adminGuard_('listaverd');

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

/**
 * AI-drog ad vorulysingu. Sendir SAMHENGID sem starfsmadurinn hefur gefid
 * afram i adal-projectid, sem a lykilinn.
 *
 * Adgangsvardan er `voruinnihald` — ekki `listaverd` eins og hin follin her.
 * Sa sem ma skoda verdvoktun a ekkert erindi i ad eyda tokenum a skrifum.
 */
function voruinnihald_draft(ctx) {
  adminGuard_('voruinnihald');
  if (!ctx || typeof ctx !== 'object') throw new Error('Ekkert samhengi sent.');

  // GAGNABLADID ER SOTT UR VINNUSHEETINU, ALDREI UR VAFRANUM (2026-10-02).
  // Slodin sem adal-projectid saekir verdur ad koma hedan, ur sheetinu eftir
  // SKU: annars gaeti hvada vafri sem er latid thjoninn saekja hvada slod sem
  // er. Skrain i Plytix gengur fyrir hlekk sem starfsmadur fann hja birgja.
  delete ctx.docUrl;
  delete ctx.labels;
  try {
    var o = vi_open_(), idx = o.idx, vals = o.vals;
    var sku = String(ctx.sku || '').trim();
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][idx.sku] || '').trim() !== sku) continue;
      var file = idx.dsFile === undefined ? '' : String(vals[r][idx.dsFile] || '').trim();
      var link = idx.dsUrl === undefined ? '' : String(vals[r][idx.dsUrl] || '').trim();
      // Plytix getur geymt fleiri en eina skra, kommu-adskildar. Su fyrsta.
      ctx.docUrl = (file.split(/,(?=\s*https?:)/)[0] || link || '').trim();
      // Vottanir ur Plytix: STADFESTAR, svo likanid ma nefna thaer.
      ctx.labels = idx.labels === undefined ? '' : String(vals[r][idx.labels] || '').trim();
      break;
    }
  } catch (e) {
    console.warn('[VORUINNIHALD][AI] fann ekki gagnablad: ' + e.message);
  }
  return callCoreApi_('pim_draft', { ctx: ctx });
}

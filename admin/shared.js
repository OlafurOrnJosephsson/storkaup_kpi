'use strict';

/************************************************************
 * shared.js — afrit af hjálpum úr aðal-projectinu
 * Uppruni: APP_SOURCES úr core/applications.js, safeJsonParse_ og
 * getSupabaseRestConfig_ úr core/utils.js. Ef þessu er breytt þar
 * þarf að spegla breytinguna hér (og öfugt).
 ************************************************************/

const APP_SOURCES = [
  {
    key             : 'RAFRAEN_INNSKRANING',
    label           : 'RAFRÆN INNSKRÁNING',
    formId          : 'QUu0PkqX',
    notifyEmailSetting: 'APPLICATION_NOTIFY_EMAIL_RAFRAEN',
    mainTab         : 'Kennitölu skráning',
    nameHeader      : 'Fullt nafn umsækjanda',
    emailHeader     : 'Netfangið þitt',
    companyHeader   : 'Nafn fyrirtækis / Nafn á deild',
    ktHeader        : 'Kennitalan þín',
    companyKtHeader : 'Kennitala fyrirtækis',
    phoneHeader     : 'Símanúmerið þitt sem tengist rafrænni innskráningu'
  },
  {
    key             : 'UMSOKN_VIDSKIPTI',
    label           : 'UMSÓKN VIÐSKIPTI',
    formId          : 'G2ZPwISA',
    notifyEmailSetting: 'APPLICATION_NOTIFY_EMAIL_UMSOKN',
    mainTab         : 'Umsókn um viðskipti',
    nameHeader      : 'Fullt nafn tengiliðar (prókúruhafa)',
    emailHeader     : 'Netfang tengiliðar',
    companyHeader      : 'Heiti fyrirtækis',
    companyEmailHeader : 'Netfang fyrirtækis',
    addressHeader      : 'Heimilisfang fyrirtækis',
    cityHeader         : 'Staður fyrirtækis',
    postalHeader       : 'Póstnúmer fyrirtækis',
    ktHeader           : 'Kennitala tengiliðar (umsækjandi)',
    companyKtHeader    : 'Kennitala fyrirtækis',
    phoneHeader        : 'Símanúmer tengiliðar',
    creditScoreHeader  : 'Lánshæfismat',
    paymentHeader      : 'Greiðslufyrirkomulag',
    billingInfoHeader  : 'Upplýsingar vegna reikninga'
  }
];

function safeJsonParse_(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function getSupabaseRestConfig_() {
  const cfg = loadConfig_();
  const baseUrlRaw = cfg.ENDPOINTS && cfg.ENDPOINTS.SUPABASE && cfg.ENDPOINTS.SUPABASE.REST_URL;
  const serviceRole = cfg.API && cfg.API.SUPABASE && cfg.API.SUPABASE.SERVICE_ROLE_KEY;
  const baseUrl = String(baseUrlRaw || '').replace(/\/$/, '');

  if (!baseUrl) {
    throw new Error('Supabase config missing ENDPOINTS.SUPABASE.REST_URL');
  }
  if (!serviceRole) {
    throw new Error('Supabase config missing API.SUPABASE.SERVICE_ROLE_KEY');
  }

  return { baseUrl: baseUrl, serviceRole: serviceRole };
}

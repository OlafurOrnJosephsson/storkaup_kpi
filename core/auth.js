/************************************************************
 * MAGENTO ADMIN AUTH — cached token
 * - Caches admin token in Script Properties with a conservative TTL
 * - Supports forced refresh after 401/403
 ************************************************************/

function clearMagentoAdminTokenCache_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('MAGENTO_ADMIN_TOKEN_CACHE');
  props.deleteProperty('MAGENTO_ADMIN_TOKEN_TS');
}

function normalizeMagentoBaseUrl_(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function getMagentoApiBaseUrl_() {
  const CONFIG = loadConfig_();
  return normalizeMagentoBaseUrl_(CONFIG.ENDPOINTS.Magento.BASE_URL);
}

function parseMagentoTokenResponse_(res) {
  const body = res.getContentText();
  if (!body) {
    throw new Error('Magento token fetch returned an empty response body.');
  }

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'string' && parsed) return parsed;
    if (parsed && typeof parsed.token === 'string' && parsed.token) return parsed.token;
  } catch (e) {
    // Fall through to raw body parsing.
  }

  return body.replace(/"/g, '').trim();
}

function decodeBase32ToBytes_(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!clean) return [];

  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean.charAt(i));
    if (idx === -1) {
      throw new Error('Invalid base32 character in MAGENTO_ADMIN_TOTP_SECRET.');
    }
    bits += ('00000' + idx.toString(2)).slice(-5);
  }

  const bytes = [];
  for (let j = 0; j + 8 <= bits.length; j += 8) {
    bytes.push(parseInt(bits.slice(j, j + 8), 2));
  }
  return bytes;
}

function leftPadHex_(value, width) {
  let out = String(value);
  while (out.length < width) out = '0' + out;
  return out;
}

function generateTotpCode_(secret, timestampMs) {
  const counter = Math.floor((timestampMs || Date.now()) / 30000);
  const counterBytes = [];
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const keyBytes = decodeBase32ToBytes_(secret);
  if (!keyBytes.length) {
    throw new Error('MAGENTO_ADMIN_TOTP_SECRET is empty or invalid.');
  }

  const digest = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_1,
    counterBytes,
    keyBytes
  );

  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return leftPadHex_(String(binary % 1000000), 6).slice(-6);
}

function fetchMagentoAdminTokenWithCredentials_(url, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    return { ok: false, response: res };
  }

  return { ok: true, token: parseMagentoTokenResponse_(res) };
}

function getMagento2faProviderToken_(baseUrl, username, password, provider, props) {
  const providerName = String(provider || '').trim().toLowerCase();
  if (providerName !== 'google') {
    throw new Error(
      'Magento 2FA provider "' + provider + '" is not supported by this script yet. ' +
      'Supported provider: google.'
    );
  }

  const secret =
    props.getProperty('MAGENTO_ADMIN_TOTP_SECRET') ||
    props.getProperty('MAGENTO_ADMIN_GOOGLE_2FA_SECRET');
  if (!secret) {
    throw new Error(
      'Magento requires Google 2FA. Add Script Property MAGENTO_ADMIN_TOTP_SECRET ' +
      '(base32 shared secret from the authenticator setup) for the sync user.'
    );
  }

  const otp = generateTotpCode_(secret);
  const url = baseUrl + '/tfa/provider/' + encodeURIComponent(providerName) + '/authenticate';
  const auth = fetchMagentoAdminTokenWithCredentials_(url, {
    username: username,
    password: password,
    otp: otp
  });

  if (!auth.ok) {
    throw new Error('Magento 2FA token fetch failed: ' + auth.response.getContentText());
  }

  return auth.token;
}

function getMagentoAdminToken_(opts) {
  opts = opts || {};
  const forceRefresh = !!opts.forceRefresh;

  const props  = PropertiesService.getScriptProperties();
  const cacheKey   = 'MAGENTO_ADMIN_TOKEN_CACHE';
  const cacheTsKey = 'MAGENTO_ADMIN_TOKEN_TS';
  const ttlMs = 3.5 * 60 * 60 * 1000; // 3h 30m (Magento tokens often expire ~4h)

  if (!forceRefresh) {
    const cached = props.getProperty(cacheKey);
    const cachedTs = Number(props.getProperty(cacheTsKey) || 0);
    if (cached && cachedTs && (Date.now() - cachedTs) < ttlMs) {
      return cached;
    }
  } else {
    clearMagentoAdminTokenCache_();
  }

  const username = props.getProperty('MAGENTO_ADMIN_USERNAME');
  const password = props.getProperty('MAGENTO_ADMIN_PASSWORD');

  if (!username || !password) {
    throw new Error("Missing Magento admin credentials in Script Properties");
  }

  const baseUrl = getMagentoApiBaseUrl_();
  const url = baseUrl + "/integration/admin/token";
  const auth = fetchMagentoAdminTokenWithCredentials_(url, {
    username: username,
    password: password
  });

  let token;
  if (auth.ok) {
    token = auth.token;
  } else {
    let errorBody = auth.response.getContentText();
    let parsedError = null;
    try {
      parsedError = JSON.parse(errorBody);
    } catch (e) {
      parsedError = null;
    }

    const providers =
      parsedError &&
      parsedError.parameters &&
      Array.isArray(parsedError.parameters.active_providers)
        ? parsedError.parameters.active_providers
        : [];

    if (providers.length) {
      token = getMagento2faProviderToken_(baseUrl, username, password, providers[0], props);
    } else {
      throw new Error("Magento token fetch failed: " + errorBody);
    }
  }

  props.setProperty(cacheKey, token);
  props.setProperty(cacheTsKey, Date.now().toString());
  return token;
}

function magentoHeaders_(opts) {
  return {
    "Authorization": "Bearer " + getMagentoAdminToken_(opts),
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
}

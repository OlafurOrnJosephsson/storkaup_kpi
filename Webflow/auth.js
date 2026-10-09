/**
 * Webflow/auth.js — innskráning á KPI-síðurnar (áfangi 1, 2026-10-09).
 *
 * HVAÐ ÞETTA GERIR
 *   1. Starfsmaður skráir sig inn með Google (@storkaup.is) í gegnum Supabase
 *      Auth. Engin utanaðkomandi söfn — PKCE-flæðið er ~40 línur hér að neðan,
 *      svo ekkert óframseljanlegt kemur af CDN.
 *   2. Allar fetch-beiðnir til Supabase sem bera anon-lykilinn sem Bearer fá
 *      token notandans í staðinn. ENGIN ÖNNUR SKRÁ BREYTIST: dashboard.js,
 *      forgangslisti.js o.fl. senda áfram `Authorization: Bearer <publishableKey>`
 *      og þessi skrá skiptir því út á leiðinni. 30 kallstaðir í 10 skrám, ein
 *      breyting.
 *   3. Án innskráningar hylur skjár síðuna og Supabase-köll hafna strax.
 *
 * HLEÐSLA: í Webflow SITE-WIDE head, SAMSTILLT (ekki defer/async), svo
 * fetch-umbúðirnar séu komnar á undan öllum öðrum skriftum. Skráin ber engin
 * leyndarmál — site-wide er í lagi þótt það birtist á lykilorðaskjánum.
 * STORKAUP_CONFIG er page-scoped og kemur SÍÐAR í head, svo hún er lesin
 * þegar á þarf að halda, aldrei við hleðslu.
 *
 * NEYÐARROFI: `STORKAUP_CONFIG.authDisabled = true` í page-kóða slekkur á
 * öllu hér á þeirri síðu (anon-lykillinn fer þá óbreyttur, eins og áður) —
 * virkar aðeins á meðan anon hefur enn heimildir (fyrir
 * kpi_auth_revoke_anon.sql).
 *
 * AÐGANGUR: aðeins netföng í raw.kpi_staff_access geta stofnað aðgang
 * (trigger á auth.users, core/sql/kpi_auth_phase1.sql).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.STORKAUP_AUTH) return;

  var STORE_KEY = 'storkaup_kpi_session_v1';
  var VERIFIER_KEY = 'storkaup_kpi_pkce_v1';
  var REFRESH_MARGIN_S = 60;
  var origFetch = window.fetch.bind(window);

  function cfg() { return window.STORKAUP_CONFIG || {}; }
  function base() { return String(cfg().supabaseUrl || '').replace(/\/+$/, ''); }
  function anonKey() { return String(cfg().publishableKey || ''); }
  function provider() { return String(cfg().authProvider || 'google'); }
  function disabled() { return cfg().authDisabled === true; }

  // ── geymsla (localStorage getur kastað í einkaham) ──────────────────────
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function nowS() { return Math.floor(Date.now() / 1000); }

  function toSession(t) {
    if (!t || !t.access_token) return null;
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at || (nowS() + Number(t.expires_in || 3600)),
      email: (t.user && t.user.email) || ''
    };
  }

  // ── PKCE ────────────────────────────────────────────────────────────────
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function startLogin() {
    var rnd = new Uint8Array(48);
    crypto.getRandomValues(rnd);
    var verifier = b64url(rnd);
    save(VERIFIER_KEY, verifier);
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (h) {
      var back = location.origin + location.pathname + location.search.replace(/[?&](code|error|error_description)=[^&]*/g, '');
      location.assign(base() + '/auth/v1/authorize'
        + '?provider=' + encodeURIComponent(provider())
        + '&redirect_to=' + encodeURIComponent(back)
        + '&code_challenge=' + b64url(new Uint8Array(h))
        + '&code_challenge_method=s256');
    });
  }

  function tokenRequest(grant, body) {
    return origFetch(base() + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && (j.error_description || j.msg || j.error)) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  // ── lota ────────────────────────────────────────────────────────────────
  var refreshing = null;

  function exchangeCodeIfPresent() {
    var params = new URLSearchParams(location.search);
    var code = params.get('code');
    if (!code) return Promise.resolve(null);
    var verifier = load(VERIFIER_KEY);
    drop(VERIFIER_KEY);
    params.delete('code');
    var clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    history.replaceState(null, '', clean);
    if (!verifier) return Promise.resolve(null);
    return tokenRequest('pkce', { auth_code: code, code_verifier: verifier }).then(function (t) {
      var s = toSession(t);
      if (s) save(STORE_KEY, s);
      return s;
    });
  }

  // Kóðaskiptin (eftir heimkomu frá Google) keyra EINU SINNI og allt bíður
  // eftir þeim. Annars kalla síðuskrárnar á Supabase áður en ?code= er orðið
  // að tokeni, fá „ekki innskráð(ur)" og innskráningarskjárinn birtist þótt
  // innskráningin hafi tekist.
  var readyPromise = null;
  var exchangeError = '';
  function ready() {
    if (!readyPromise) {
      readyPromise = exchangeCodeIfPresent().catch(function (e) {
        exchangeError = e && e.message || String(e);
        return null;
      });
    }
    return readyPromise;
  }

  function getToken() {
    return ready().then(currentToken);
  }

  function currentToken() {
    var s = load(STORE_KEY);
    if (!s) return Promise.resolve(null);
    if (s.expires_at - nowS() > REFRESH_MARGIN_S) return Promise.resolve(s.access_token);
    if (!s.refresh_token) { drop(STORE_KEY); return Promise.resolve(null); }
    if (!refreshing) {
      refreshing = tokenRequest('refresh_token', { refresh_token: s.refresh_token })
        .then(function (t) {
          var ns = toSession(t);
          if (ns) { if (!ns.email) ns.email = s.email; save(STORE_KEY, ns); }
          return ns ? ns.access_token : null;
        })
        .catch(function () { drop(STORE_KEY); return null; })
        .then(function (tok) { refreshing = null; return tok; });
    }
    return refreshing;
  }

  function signOut() {
    var s = load(STORE_KEY);
    drop(STORE_KEY);
    var done = function () { location.reload(); };
    if (!s) return done();
    origFetch(base() + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: anonKey(), Authorization: 'Bearer ' + s.access_token }
    }).then(done, done);
  }

  // ── fetch-umbúðir ──────────────────────────────────────────────────────
  // Snerta AÐEINS beiðnir á Supabase-slóðina sem bera anon-lykilinn sem
  // Bearer. GAS-köll (gasWebAppUrl) og allt annað fer óbreytt.
  // GAS-köll (2026-10-09): `authToken` bætt í JSON-body POST-beiðna á
  // gasWebAppUrl. Main-verkefnið (webflowCaller_ í webapp.js) staðfestir hann
  // hjá Supabase og ber netfangið við sama aðgangslista — svo gasKey má hverfa
  // úr page-kóða án þess að nokkur önnur Webflow-skrá breytist.
  function gasUrl() { return String(cfg().gasWebAppUrl || ''); }
  function withGasToken(input, init) {
    var body;
    try { body = JSON.parse(init.body); } catch (e) { return origFetch(input, init); }
    if (!body || typeof body !== 'object') return origFetch(input, init);
    return getToken().then(function (tok) {
      if (tok) body.authToken = tok;
      return origFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
    });
  }

  window.fetch = function (input, init) {
    if (!disabled() && typeof input === 'string' && gasUrl() && input.indexOf(gasUrl()) === 0
        && init && typeof init.body === 'string') {
      return withGasToken(input, init);
    }
    if (disabled() || typeof input !== 'string' || !base() || input.indexOf(base()) !== 0
        || input.indexOf('/auth/v1/') !== -1) {
      return origFetch(input, init);
    }
    var headers = new Headers((init && init.headers) || {});
    if (headers.get('Authorization') !== 'Bearer ' + anonKey()) return origFetch(input, init);
    return getToken().then(function (tok) {
      if (!tok) {
        showGate();
        return Promise.reject(new Error('Ekki innskráð(ur)'));
      }
      headers.set('Authorization', 'Bearer ' + tok);
      return origFetch(input, Object.assign({}, init, { headers: headers }));
    });
  };

  // ── viðmót ─────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function friendlyError(raw) {
    if (!raw) return '';
    if (/aðgangslista|database error saving new user/i.test(raw)) {
      return 'Netfangið þitt er ekki á aðgangslista KPI-síðnanna. Hafðu samband við Ólaf.';
    }
    return 'Innskráning tókst ekki: ' + raw;
  }

  function showGate(errText) {
    if (document.getElementById('sk-auth-gate')) return;
    var mount = function () {
      var el = document.createElement('div');
      el.id = 'sk-auth-gate';
      el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;background:#f7f7f8;'
        + 'display:flex;align-items:center;justify-content:center;font:15px/1.5 Arial,sans-serif');
      el.innerHTML = '<div style="background:#fff;border:1px solid #e3e3e8;border-radius:10px;padding:32px 36px;'
        + 'max-width:380px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)">'
        + '<div style="font-weight:700;font-size:20px;color:#15069e;margin-bottom:6px">Stórkaup KPI</div>'
        + '<div style="color:#555;margin-bottom:22px">Skráðu þig inn með vinnunetfanginu þínu.</div>'
        + '<button id="sk-auth-login" style="background:#15069e;color:#fff;border:0;border-radius:6px;'
        + 'padding:11px 22px;font-size:15px;cursor:pointer">Skrá inn með Google</button>'
        + (errText ? '<div style="color:#b42318;margin-top:18px;font-size:13px">' + esc(errText) + '</div>' : '')
        + '</div>';
      document.body.appendChild(el);
      document.getElementById('sk-auth-login').onclick = startLogin;
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  }

  function showBadge(email) {
    var mount = function () {
      if (document.getElementById('sk-auth-badge')) return;
      var el = document.createElement('div');
      el.id = 'sk-auth-badge';
      el.setAttribute('style', 'position:fixed;right:12px;bottom:12px;z-index:2147482000;background:#fff;'
        + 'border:1px solid #e3e3e8;border-radius:16px;padding:4px 10px;font:12px Arial,sans-serif;color:#444');
      el.innerHTML = esc(email || 'Innskráð(ur)') + ' · <a href="#" id="sk-auth-out" style="color:#15069e">Skrá út</a>';
      document.body.appendChild(el);
      document.getElementById('sk-auth-out').onclick = function (e) { e.preventDefault(); signOut(); };
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  }

  // ── ræsing ─────────────────────────────────────────────────────────────
  // Bíður eftir DOMContentLoaded svo page-scoped STORKAUP_CONFIG sé komið.
  function boot() {
    if (disabled() || !base()) return;
    var qs = new URLSearchParams(location.search);
    var err = qs.get('error_description') || qs.get('error');
    getToken().then(function (tok) {
      if (tok) showBadge((load(STORE_KEY) || {}).email);
      else showGate(friendlyError(err || exchangeError));
    });
  }

  window.STORKAUP_AUTH = { getToken: getToken, signOut: signOut, signIn: startLogin };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

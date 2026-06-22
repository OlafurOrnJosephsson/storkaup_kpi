(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // ── Pending-applications nav badge ────────────────────────────────────────
  // Runs on EVERY page (before the website early-return below) so the count
  // shows site-wide. Populates [data-storkaup-pending] from the GAS web app;
  // hidden when zero. Degrades silently if gasWebAppUrl is unset or the call fails.
  (function () {
    function paint(n) {
      var els = document.querySelectorAll("[data-storkaup-pending]");
      for (var i = 0; i < els.length; i += 1) {
        els[i].textContent = n > 0 ? String(n) : "";
        els[i].style.display = n > 0 ? "" : "none";
      }
    }
    function refresh() {
      var cfg = window.STORKAUP_CONFIG || {};
      if (!cfg.gasWebAppUrl) return;
      fetch(cfg.gasWebAppUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        redirect: "follow",
        body: JSON.stringify({ action: "application_counts", key: cfg.gasKey || "" })
      })
        .then(function (r) { return r.json(); })
        .then(function (out) { if (out && out.ok) paint(Number(out.total || 0)); })
        .catch(function () {});
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", refresh);
    } else {
      refresh();
    }
    setInterval(function () { if (!document.hidden) refresh(); }, 300000); // 5 mín
  })();

  if (document.body && String(document.body.getAttribute("data-dashboard-type") || "").trim().toLowerCase() === "website") return;

  function ensureGlobalLoader() {
    var existing = document.getElementById("storkaup-global-loader");
    if (existing) return existing;

    var host = document.createElement("div");
    host.id = "storkaup-global-loader";
    host.className = "storkaup-global-loader";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-busy", "true");
    host.innerHTML = ''
      + '<div class="storkaup-global-loader__card">'
      +   '<div class="storkaup-global-loader__spinner"></div>'
      +   '<div class="storkaup-global-loader__text">Augnablik! <br>Hleð gögnum...</div>'
      + '</div>';

    document.body.appendChild(host);
    return host;
  }

  function showGlobalLoader() {
    var el = ensureGlobalLoader();
    if (!el) return;
    el.classList.add("is-visible");
    document.documentElement.classList.add("storkaup-loading");
  }

  function hideGlobalLoader() {
    var el = ensureGlobalLoader();
    if (!el) return;
    el.classList.remove("is-visible");
    document.documentElement.classList.remove("storkaup-loading");
    setTimeout(function () {
      el.style.display = "none";
    }, 220);
  }

  showGlobalLoader();

  window.STORKAUP_CONFIG = Object.assign({
    supabaseUrl: "https://kwpsqpvbhvoyrrffmbcx.supabase.co",
    publishableKey: "sb_publishable_QaZnXk5bDOpJcxg6_k0z9w_30WacMEv"
  }, window.STORKAUP_CONFIG || {});

  function getBootstrapScript() {
    var scripts = document.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i += 1) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("dashboard-bootstrap.js") !== -1) return scripts[i];
    }
    return null;
  }

  function getRevision() {
    var fromWindow = (window.STORKAUP_REV || "").toString().trim();
    if (fromWindow) return fromWindow;

    var tag = getBootstrapScript();
    var fromTag = tag ? (tag.getAttribute("data-storkaup-rev") || "").trim() : "";
    if (fromTag) return fromTag;

    return "main";
  }

  var rev = getRevision();
  var base = "https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@" + rev + "/Webflow/";

  function ensureCss(href, key) {
    if (document.querySelector('link[' + key + '="1"]') || document.querySelector('link[href="' + href + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(key, "1");
    document.head.appendChild(link);
  }

  function ensureScript(src, key, done) {
    var existing = document.querySelector('script[' + key + '="1"]') || document.querySelector('script[src="' + src + '"]');
    if (existing) {
      if (done) done();
      return;
    }
    var script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.setAttribute(key, "1");
    script.onload = function () { if (done) done(); };
    script.onerror = function () {
      console.error("Failed to load script:", src);
      if (done) done();
    };
    document.head.appendChild(script);
  }

  if (document.querySelector('script[data-storkaup-dashboard="1"]')) {
    hideGlobalLoader();
    return;
  }

  ensureCss("https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css", "data-flatpickr-css");
  ensureCss(base + "dashboard-theme.css", "data-storkaup-theme-css");

  var readyFired = false;
  function onPageReady() {
    if (readyFired) return;
    readyFired = true;
    hideGlobalLoader();
  }
  document.addEventListener("storkaup:page-ready", onPageReady);
  window.addEventListener("load", function () {
    setTimeout(onPageReady, 2500);
  });
  setTimeout(onPageReady, 12000);

  ensureScript("https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js", "data-flatpickr-js", function () {
    ensureScript("https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/is.js", "data-flatpickr-is-l10n", function () {
      ensureScript(base + "customer-profiles.js", "data-storkaup-customer-profiles", function () {
        ensureScript(base + "top-products.js", "data-storkaup-top-products", function () {
          ensureScript(base + "order-search.js", "data-storkaup-order-search", function () {
            ensureScript(base + "dashboard.js", "data-storkaup-dashboard");
          });
        });
      });
    });
  });
})();

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Keep any values provided by page-level custom code and use defaults only if missing.
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

  // If dashboard is already present, skip full bootstrapping.
  if (document.querySelector('script[data-storkaup-dashboard="1"]')) return;

  ensureCss("https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css", "data-flatpickr-css");
  ensureCss(base + "dashboard-theme.css", "data-storkaup-theme-css");
  ensureScript("https://cdn.jsdelivr.net/npm/flatpickr", "data-flatpickr-js", function () {
    ensureScript(base + "customer-profiles.js", "data-storkaup-customer-profiles", function () {
      ensureScript(base + "top-products.js", "data-storkaup-top-products", function () {
        ensureScript(base + "dashboard.js", "data-storkaup-dashboard");
      });
    });
  });
})();

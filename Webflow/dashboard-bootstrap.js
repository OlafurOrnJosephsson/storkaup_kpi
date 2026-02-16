(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.STORKAUP_CONFIG = Object.assign({}, window.STORKAUP_CONFIG || {}, {
    supabaseUrl: "https://kwpsqpvbhvoyrrffmbcx.supabase.co",
    publishableKey: "sb_publishable_QaZnXk5bDOpJcxg6_k0z9w_30WacMEv"
  });

  function ensureCss(href, key) {
    if (document.querySelector('link[' + key + '="1"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(key, "1");
    document.head.appendChild(link);
  }

  function ensureScript(src, key, done) {
    var existing = document.querySelector('script[' + key + '="1"]');
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

  if (document.querySelector('script[data-storkaup-dashboard="1"]')) return;

  ensureCss("https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css", "data-flatpickr-css");
  ensureScript("https://cdn.jsdelivr.net/npm/flatpickr", "data-flatpickr-js", function () {
    ensureScript(
      "https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@main/Webflow/dashboard.js",
      "data-storkaup-dashboard"
    );
  });
})();

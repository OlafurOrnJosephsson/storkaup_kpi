(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.STORKAUP_CONFIG = Object.assign({}, window.STORKAUP_CONFIG || {}, {
    supabaseUrl: "https://kwpsqpvbhvoyrrffmbcx.supabase.co",
    publishableKey: "sb_publishable_QaZnXk5bDOpJcxg6_k0z9w_30WacMEv"
  });

  if (document.querySelector('script[data-storkaup-dashboard="1"]')) return;

  var script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@main/Webflow/dashboard.js";
  script.defer = true;
  script.setAttribute("data-storkaup-dashboard", "1");
  document.head.appendChild(script);
})();

---
paths:
  - "Webflow/**"
  - "tools/check-webflow-pins.js"
---

# Working on Webflow files

- `Webflow/*` is **not** pushed by clasp (`.claspignore`). It ships through GitHub → jsDelivr at a pinned commit, plus Webflow custom code.
- Run `node --check Webflow/<file>.js` before touching Webflow custom code.
- A change takes **two commits**, in this order: commit and push the source (its SHA becomes the pin) → the user updates and publishes the governing pin in Webflow → update the table in `CLAUDE.md` → *Current production pins* (and the `*-embed.html` mirror for an independent pin) → `node tools/check-webflow-pins.js` → commit and push that documentation. The check at the end of `gas_deploy.ps1` runs before the live pin moves, so never take the new value from it. Full steps and which pin governs which file: `RUNBOOK.md` → *Webflow deploy and production pins*.
- When the table and the live site disagree, find out which is right before changing either — a stale table once rolled production back.
- No secret on any Webflow page, site-wide or page-level: not `gasKey`, `EXEC_URL` or BC figures. Page code is publicly readable since the Webflow password went (2026-10-09). Data is *meant* to be protected by sign-in (`auth.js`); that enforcement is not verified live, and the pin checker's string scan does not test it.
- Dashboards must degrade gracefully: if a secondary RPC fails, the primary dashboard must still render.
- `vorur.js` and `vidskiptavinir.js` build their own markup and CSS; their Webflow Embed is a mount `<div>` only, and the `<script>` tag sits in page head code once.
- An RPC whose return type changed needs `notify pgrst, 'reload schema';` in Supabase, or the browser gets 500 while the SQL editor works.

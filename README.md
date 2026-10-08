# storkaup_kpi

GAS + Supabase SQL + Webflow source repo for Storkaup KPI.

**This repo is public** (jsDelivr serves `Webflow/` from it). Never commit secrets, API keys, deployment IDs, sheet IDs or passwords. Runtime config lives in the `STORKAUP_CONFIG` Google Sheet (API / SETTINGS tabs), read by `loadConfig_()` in `core/config.js` — not in the repo.

## Where to start

| Doc | Covers |
|---|---|
| `CLAUDE.md` | Deploy workflow, **production pins (single source of truth)**, file map, triggers, non-negotiables |
| `ARCHITECTURE.md` | Data flow and the two web-app projects |
| `RUNBOOK.md` | Operations and recovery |
| `NEXT_TASKS.md` · `GOALS.md` | Open work and goals |
| `pim/README.md` · `pim/VORUINNIHALD.md` | PIM tools; vöruinnihald handover |

Security detail is kept in the security review, outside git.

## Structure

Two separate Apps Script projects live in this repo:

- **Main project** (root) — `core/`, `pim/*.js`, `webapp.js`, `appsscript.json`: ingest triggers, Supabase sync, and the anonymous web app (Typeform webhook + key-protected dashboard/badge/cache-help/delegation actions).
- **Admin-apps project** — `admin/` (own `admin/.clasp.json`): the internal umsókn (applications), vöruvöktun/listaverð and vöruinnihald HTML apps. umsókn handles applicant PII and credit scores. Behind Google login (`access: DOMAIN`) plus allowlists: `ADMIN_APP_EMAILS` (all apps) or `<APP>_APP_EMAILS` (one app) — see `admin/auth.js`.
- `Webflow/`: browser-only frontend scripts (deployed to Webflow, **not** pushed to GAS). Mostly read-only dashboards, but the forgangslisti, customer-profiles and activation pages also write priority flags / rep assignments through RPCs; every update/delete is kept in `raw.customer_priority_flags_history`.
- `core/sql/`: Supabase SQL, applied by hand in the Supabase SQL editor.
- `pim/`: PIM / vöruinnihald — `.js` (Plytix export, worksheet, AI copy, related products) is pushed with the main project; `.py` are local tools. `pim_sync.ps1` uploads Plytix CSVs from `pim_drop/` to Drive. `core/web_catalog.js` keeps the published catalog in `raw.web_catalog`.
- `bc_sync.ps1`: uploads BC XLSX from `bc_drop/` to Drive. **BC has no trigger** — the data loads only when someone runs the BC Sync menu (`processBcDrop_v1`). Export a rolling ~3-month window (see `CLAUDE.md`).
- `tools/check-webflow-pins.js`: compares live Webflow pins against `CLAUDE.md`; runs at the end of `gas_deploy.ps1`.
- `gtm/`: GTM export. `email-preview/`: browser mockups of the emails.
- `.claspignore`: excludes `Webflow/`, `admin/`, `email-preview/`, `docs/` and `tools/` from the main push. **Any `.js` in a non-ignored directory is pushed as Apps Script** — a top-level `require()` throws on load and kills every trigger.

See `ARCHITECTURE.md` → *Web-app projects* for why the split exists (PII must sit behind real login, not URL secrecy / a shared Webflow password).

Scheduled jobs: `auditTriggers_v1()` is the source of truth (it shares `requiredTimeTriggers_()` with `resetRecommendedTimeTriggers_v1`). `safePoll_v2` is the core Magento ingest and has a watchdog. See `CLAUDE.md` → *Key scheduled triggers* and `RUNBOOK.md`.

## Daily Workflow

1. Pull latest:
   - `git pull`
2. Make code changes.
3. Deploy Apps Script changes — check `git status` first (a push uploads every uncommitted change), then:
   - `.\gas_deploy.ps1 "short description"` — pushes **and** creates a new version on the existing deployments of **both** projects (`-Only Main` / `-Only Admin` for one). A bare `clasp push` only updates `@HEAD`; the live `/exec` runs the pinned version.
   - Never create a new deployment — it changes the `/exec` URL. See `CLAUDE.md` → *Deploy workflow*.
4. Deploy Webflow script changes:
   - copy/paste from `Webflow/*.js` into Webflow custom code (or your Webflow pipeline)
5. Commit and backup:
   - `git add .`
   - `git commit -m "your message"`
   - `git push`

## Production Pins (Webflow/jsDelivr)

Use commit-pinned jsDelivr URLs in Webflow custom code:
- `https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@<commit>/Webflow/<file>.js`

Current pin values live in a single source of truth: **`CLAUDE.md` → Current production pins**.

When updating Webflow scripts:
1. Commit and push to `main`
2. Move only the pin that governs the changed file, and only when its content changed: one `data-storkaup-rev` in site-wide code covers all bootstrap child files; a few files are pinned independently in page Embeds / page code. Which is which: `CLAUDE.md` → *Current production pins*.
3. Update the pins section in `CLAUDE.md`
4. Run `node tools/check-webflow-pins.js` to compare the live site against the table, then hard refresh and smoke-test the affected pages

## Quick Safety Checks

- GAS syntax/runtime:
  - run from Apps Script editor (manual function run + Executions log)
- Frontend syntax:
  - `node --check Webflow/<changed file>.js` before touching Webflow custom code

## Klaviyo v1 Notes

- Config key location: `STORKAUP_CONFIG` -> `API` tab
  - `Service=Klaviyo`, `Key=PRIVATE_API_KEY`, `Value=<private key>`
  - Optional: `Service=Klaviyo`, `Key=TIMEZONE`, `Value=UTC`
- GAS function: `scheduledKlaviyoSync_v1`
- SQL setup file: `core/sql/klaviyo_v1.sql`

## First-Time Setup (already done here)

- Git remote: `origin` -> `https://github.com/OlafurOrnJosephsson/storkaup_kpi.git`
- Main branch: `main`

## Recommended Repo Settings (GitHub UI)

- Protect `main` branch (at least require PR for larger changes).
- Enable 2FA on account.
- Add one backup admin/collaborator.

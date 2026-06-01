# storkaup_kpi

GAS + Webflow source repo for Storkaup KPI.

## Structure

- `core/`, `webapp.js`, `publicAPI.js`, `appsscript.json`: Google Apps Script code (deployed with `clasp`)
- `Webflow/`: browser-only frontend scripts (deployed to Webflow, **not** pushed to GAS)
- `.claspignore`: excludes `Webflow/` from `clasp push`

## Daily Workflow

1. Pull latest:
   - `git pull`
2. Make code changes.
3. Deploy Apps Script changes:
   - `clasp push`
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
2. Update pinned commit IDs in Webflow custom code
3. Update the pins section in `CLAUDE.md`
4. Hard refresh and smoke-test dashboard + customer profiles

## Quick Safety Checks

- GAS syntax/runtime:
  - run from Apps Script editor (manual function run + Executions log)
- Frontend syntax:
  - `node --check Webflow/dashboard.js`
  - `node --check Webflow/customer-profiles.js`
  - `node --check Webflow/top-products.js`

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

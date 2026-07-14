# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy workflow

```bash
clasp push          # push MAIN project GAS code to Apps Script
git add .
git commit -m "..."
git push
```

Two Apps Script projects live in this repo (see [Web-app projects](#web-app-projects)):
- **Main** (repo root) — ingest + anonymous web app. `clasp push` from root.
- **Admin-apps** (`admin/`) — internal PII apps behind Google login. `cd admin && clasp push`, then `clasp deploy -i <deploymentId>` to cut a new version. `admin/**` is excluded from the main push via `.claspignore`.

Web app changes only go live when a **new version is deployed** (`clasp deploy -i <deploymentId>`), not on `clasp push` alone — `push` updates `@HEAD`, but `/exec` runs the pinned version.

Webflow JS files (`Webflow/*.js`) are **not** pushed via clasp — deploy by copy/paste into Webflow custom code and updating jsDelivr commit pins in `README.md` and `NEXT_TASKS.md`.

**Secrets never live in Webflow site-wide custom code** — Webflow serves site-wide `<head>` code on the unauthenticated password-gate page too. Page-scoped custom code (`STORKAUP_CONFIG` with `gasKey`, `STORKAUP_BC_MANUAL`) stays per-page on the KPI pages. Monthly BC figures go into page-level head code on `/kpi/dashboard` + `/kpi/solutolur`.

After any Webflow deploy: run `node --check Webflow/<file>.js` before touching Webflow custom code.

## Architecture

```
Magento / BC / Klaviyo / GA4 / Cludo
        ↓
Google Apps Script (core/*.js)     ← scheduled triggers, ingest
        ↓
Supabase raw.*                     ← append-only source tables
        ↓
Supabase mart.*                    ← materialized views / aggregations
        ↓
Supabase api.* / public.*          ← RPC functions
        ↓
Webflow (Webflow/*.js)             ← read-only dashboards
```

No backend server. All ingest runs in Apps Script via time-based triggers managed by `resetRecommendedTimeTriggers_v1()`.

## Web-app projects

Access to internal data is split across two GAS deployments so PII never sits behind mere URL-secrecy:

| Project | Location | Web app access | Serves |
|---|---|---|---|
| Main | repo root | `ANYONE_ANONYMOUS` | Typeform webhook (`doPost`, token-checked); key-protected dashboard JSON, badge count, cache-help send; delegation actions for the admin project |
| Admin-apps | `admin/` | `DOMAIN` (@storkaup.is) + `ADMIN_APP_EMAILS` allowlist | umsókn (applications, kennitölur, credit scores) + vöruvöktun/listaverð HTML apps |

- The anonymous main deployment serves **no HTML app and no applicant PII** — `?app=umsokn`/`?app=listaverd` were removed. Do **not** re-add them.
- Admin apps guard every `google.script.run` entry point with `adminGuard_()` ([admin/auth.js](admin/auth.js)); the deployer is always allowed, others must be in `SETTINGS.ADMIN_APP_EMAILS`. Access attempts are audit-logged per user.
- Heavy/stateful ops (Magento sync, application pruning, zero-price scan state) stay in the main project; the admin project calls them via key-protected `doPost` actions ([admin/delegate.js](admin/delegate.js)) using `API.Dashboard.KEY` + `API.Dashboard.EXEC_URL`.
- Keep `access: DOMAIN` on the admin project — it ties auth to the company Workspace (offboarding + MFA governed), matching the security assessment. `ANYONE` (personal Google/Gmail) would reintroduce ungoverned access; route external users through IT as Workspace guests instead.
- Webflow nav links to the umsókn/vöruvöktun apps point directly at the admin `/exec` URL and open in a **new tab** (logged-in GAS apps break inside an iframe).

## Config system

All runtime config lives in a separate Google Sheet (`STORKAUP_CONFIG`, ID hardcoded in `core/config.js`). `loadConfig_()` reads and caches it for 5 min via Script Properties. Structure:

- `cfg.API.<Service>.<KEY>` — API keys and tokens
- `cfg.SETTINGS.<KEY>` — feature flags and model settings
- `cfg.SHEETS.<Service>.ID` — spreadsheet IDs
- `cfg.ENDPOINTS.<Service>.<KEY>` — resolved URL templates

To add a new API key: add a row in STORKAUP_CONFIG → API tab (`Service | Key | Value`). Reference via `cfg.API.ServiceName.KEY_NAME`.

Security-relevant config rows:
- `API.Typeform.WEBHOOK_TOKEN` — shared secret in the Typeform webhook URL (`?token=…`); enforced when `SETTINGS.TYPEFORM_TOKEN_ENFORCE=true`.
- `API.Dashboard.KEY` — validates dashboard/badge/cache-help/delegation `doPost` actions (`isApiKeyValid_`, **fail-closed** — missing key rejects all actions). Webflow sends it as `STORKAUP_CONFIG.gasKey`.
- `API.Dashboard.EXEC_URL` — main-project `/exec` URL the admin project delegates to.
- `SETTINGS.ADMIN_APP_EMAILS` — comma-separated allowlist for the admin apps.

SEO-specific settings in SETTINGS tab: `SEO_PROVIDER` (`gemini`/`claude`/`openai`), `SEO_GEMINI_MODEL`, `SEO_GEMINI_FALLBACK_MODELS`, `SEO_CLAUDE_MODEL`.

## GAS code conventions

- Functions ending in `_` are private (hidden from Apps Script run menu).
- Public menu entry points are in `core/menu.js` as `menu_*` functions.
- Sheet reads use `loadTableBySchema_('SCHEMA_NAME')` which resolves through `STORKAUP_SCHEMA` in `core/schema.js`.
- `safeJsonParse_`, `truncateForLog_`, `toast_` are shared utilities in `core/utils.js`.
- `applySheetStyling_()` is slow on large sheets — only call it during one-time setup/seed operations, never in per-row or batch loops.

## Non-negotiables

- **`safePoll_v2` 5-minute cadence must not be broken.** This is the primary Magento order ingest.
- **BC web share logic must not change casually.** Monthly cards use net BC; daily cards use `day_kpi_pack`; canonical tag is `salesperson_code = 'VEFUR'`.
- **Webflow dashboards must degrade gracefully** if a secondary RPC fails — the primary dashboard must still render.
- Never call `applySheetStyling_()` inside generate/revise/batch loops — it causes 100+ second execution times on large sheets.

## SEO Manager (`core/seo_manager.js`)

Queue-driven Icelandic B2B SEO copy generation. Flow:

1. Categories seed into `SEO_QUEUE` sheet via `buildSeoQueueFromCludo_v1()` or `mergeSeoFromSheet_v1()`
2. AI generates/revises via `runSeoAutomationBatch_v1()` or `runSeoForSelectedRow_v1()` / `runReviseSeoForSelectedRows_v1()`
3. Human reviews in sheet, marks `Approved = true`, pastes into Prismic

Provider chain: `SEO_PROVIDER=gemini` → tries model chain (`gemini-2.0-flash` preferred, `gemini-2.0-flash-lite` returns 404 on this API key); `SEO_PROVIDER=claude` → Anthropic API (`API.Anthropic.API_KEY` required).

Prompt versions: `buildSeoPromptV2_` (default), `buildSeoPromptV3_` (level-aware, brand/attribute detection, varied title endings) — pass `opts.useV3=true, opts.level=1|2|3` to `generateSEOTitles()`. Revise flow uses `temperature: 0.5`; generate uses `0.3`.

Title rules (V3, from SEO review Apr 2025):
- LVL1: `X í heildsölu | Stórkaup`
- LVL2: `Flokkur | Undirflokkur | Stórkaup`
- LVL3: `Vara | Hook (magn/tegund/notkunarsvið) | Stórkaup`
- No adjectives. No "í heildsölu" on LVL2/3. No "pantaðu í dag" / "skjót afhending" CTA.

## Key scheduled triggers

| Function | Cadence | Source |
|---|---|---|
| `safePoll_v2` | Every 5 min | Magento new orders |
| `scheduledMagentoSync_v1` | Hourly | Magento full incremental |
| `scheduledBcSync_v1` | Twice daily | Business Central |
| `scheduledKlaviyoSync_v1` | Every 15 min | Klaviyo events |
| `scheduledReferenceSync_v1` | Daily | Products, customers, Cludo |
| `runDailySanityChecks_v1` | Daily morning | Cross-source validation |

## Current production pins

**This section is the single source of truth for production pins.** `NEXT_TASKS.md` and `README.md` point here — do not duplicate pin values elsewhere. Update these whenever Webflow custom code changes.

- Webflow deploy rev (`data-storkaup-rev`): `aff3278`
- `Webflow/dashboard-bootstrap.js` (script-tag src pin): `df2956f`
- `Webflow/website-dashboard-bootstrap.js` (script-tag src pin): `b55e8c4`
- `Webflow/dashboard.js`: `aff3278`
- `Webflow/website-dashboard.js`: `53b118c`
- `Webflow/dashboard-theme.css`: `53b118c`
- `Webflow/customer-profiles.js`: `53b118c`
- Trigger schedule baseline: `ab2931a`
- Parent/child profile aggregation baseline: `ab0aafd`
- Parent/child last-orders merge: `ca32334`

jsDelivr URL pattern: `https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@<commit>/Webflow/<file>.js`

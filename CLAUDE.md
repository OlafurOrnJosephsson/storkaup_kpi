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

**`auditTriggers_v1()` is the source of truth, not this table.** It reads the
installed triggers and compares them against the `EXPECTED` map in
[core/utils.js](core/utils.js); that map's cadences come from the `install*`
functions. Run it before trusting any list of what is scheduled.

| Function | Cadence | Source |
|---|---|---|
| `safePoll_v2` | Every 5 min | Magento new orders |
| `scheduledKlaviyoSync_v1` | Every 15 min | Klaviyo events |
| `scheduledMagentoSync_v1` | Hourly ~:20 | Magento full incremental |
| `scheduledReferenceSync_v1` | Every 6h ~:50 | Products, customers, Cludo, marts |
| `scheduledCludoSync_v1` | Every 12h ~:55 | Cludo product coverage |
| `scheduledCustomerAnalysisSync_v1` | Daily ~05:25 | Customer profiles + profiles MV |
| `scheduledSearchConsoleSync_v1` | Daily ~05:30 | Search Console |
| `scheduledGa4Sync_v1` | Daily ~06:30 | GA4 |
| `scheduledZeroPriceScan_v1` | Daily ~06:50 | Zero list-price scan |
| `runDailySanityChecks_v1` | Daily ~07:40 | Cross-source validation |
| `scheduledNewwebStatusSync_v2` | Daily ~11:30 & ~17:30 | Magento order status |
| `scheduledWeeklyDigest` | Mondays ~08:00 | Weekly email |

**BC has no trigger.** `scheduledBcSync_v1` was deleted 2026-04-30 (`d83c7c5`);
this table listed it as "twice daily" for three months after it stopped existing.
BC now loads only from the **BC Sync menu** (`processBcDrop_v1`), reading XLSX
dropped in Drive. Files uploaded by `bc_sync.ps1` sit unread until someone clicks
it. Never run `processBcDropForce_v1` on the invoice file — it nulls `order_no`
and `email` across all history (see `core/sql/generate_shopping_list_v2.sql`).

Four triggers were found **uninstalled** on 2026-08-06, lost around 2026-05-07..11:
Klaviyo, Customer Analysis, Cludo, Search Console. Nobody noticed for three
months because `auditTriggers_v1`'s map was wrong in five places and missing five
handlers, so its real warnings were buried in false ones. A job whose sub-step
fails now records `partial`, not `success`, and sends an ops alert.

## Current production pins

**This section is the single source of truth for production pins.** `NEXT_TASKS.md` and `README.md` point here — do not duplicate pin values elsewhere. Update these whenever Webflow custom code changes.

**There is ONE pin, not one per file.** The bootstrap scripts read
`data-storkaup-rev` off their own `<script>` tag and load every child file from
that revision (`getRevision()` in both bootstraps). Changing it moves
`dashboard.js`, `customer-profiles.js`, `order-search.js`, `top-products.js`,
`website-dashboard.js` and `dashboard-theme.css` together. This list used to
give a separate commit per file, which implied a control that does not exist.

**Live (verified against Webflow custom code 2026-08-06):**

| What | Value |
|---|---|
| `data-storkaup-rev` — governs all child files | `6c992c5` |
| `dashboard-bootstrap.js` script-tag src | `6c992c5` |
| `website-dashboard-bootstrap.js` script-tag src | `6c992c5` |

Both bootstrap files at `6c992c5` are byte-identical to HEAD, so the live pages
are current. The values recorded here before (`aff3278`, `df2956f`, `b55e8c4`)
were stale — the deploy had moved to `6c992c5` on 2026-07-14 and nobody updated
this table.

**Hardcoded fallbacks** — used only if `data-storkaup-rev` is missing from the
tag. Both bootstraps carry a comment saying "Keep in sync with CLAUDE.md pins";
neither value was ever recorded here. They are immutable commits by design (never
`@main`: a mutable branch would let a compromised repo inject straight into the
KPI pages).

| File | Fallback | Date |
|---|---|---|
| `dashboard-bootstrap.js` | `2458fc5` | 2026-06-30 |
| `website-dashboard-bootstrap.js` | `53b118c` | 2026-06-29 |

⚠️ The two fallbacks differ from each other and both lag the live rev. If the
attribute is ever dropped, `/kpi/dashboard` and `/kpi/vefmaelabord` would silently
load different vintages. Bump them when you bump the live rev, or accept that
they are a last-resort floor rather than a mirror.

**When to change a pin:** only when a file under `Webflow/` actually changes.
The pin freezes content; it does not track HEAD. Re-pinning to a newer commit
that contains identical bytes only busts caches and makes this table misreport
when the frontend last changed.

**Reference baselines** (not deploy pins — historical anchors for comparison):

- Trigger schedule baseline: `ab2931a`
- Parent/child profile aggregation baseline: `ab0aafd`
- Parent/child last-orders merge: `ca32334`

jsDelivr URL pattern: `https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@<commit>/Webflow/<file>.js`

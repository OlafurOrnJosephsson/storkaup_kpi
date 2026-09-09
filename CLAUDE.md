# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy workflow

```bash
.\gas_deploy.ps1 "short description"   # push + new version, BOTH projects
git add .
git commit -m "..."
git push
```

Two Apps Script projects live in this repo (see [Web-app projects](#web-app-projects)):
- **Main** (repo root) — ingest + anonymous web app.
- **Admin-apps** (`admin/`) — internal PII apps behind Google login. `admin/**` is excluded from the main push via `.claspignore`.

`clasp` only ever works on one project at a time — it reads `.clasp.json` from
the current directory. **A bare `clasp push` from the root therefore covers only
half the code.** [gas_deploy.ps1](gas_deploy.ps1) wraps both projects and is the
single source of truth for the two deployment IDs; it refuses to target either
`@HEAD` deployment. Never create a *new* deployment — that changes the `/exec`
URL and breaks the Webflow iframe plus the nav links to the admin apps.

Web app changes only go live when a **new version is deployed**, not on
`clasp push` alone — `push` updates `@HEAD`, but `/exec` runs the pinned
version. **This applies to the main project too, for a non-obvious reason:** the
admin app's "Keyra aftur" button calls `doPost` on the *main* project's `/exec`,
which is also pinned. Push the main project without deploying it and that button
runs the old code, overwriting fresh scan results with stale ones.

A root `clasp push` also uploads **every** uncommitted change under `core/`, and
any `.js` in a non-ignored subdirectory (`pim/` included). Check `git status`
first, and make sure a new `.js` is real Apps Script — a top-level `require()`
throws on load and kills every trigger in the project (see the `email-preview/**`
note in `.claspignore`).

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

## Where things live

**In Apps Script the file does not matter for running a function.** Every
function is global across the project, so the editor's function picker lists
them all regardless of which file they sit in. The file only matters when you
are reading or editing. `clasp` flattens `core/x.js` to `core/x` in the project.

| File | Holds |
|---|---|
| [core/utils.js](core/utils.js) | The grab-bag, and the biggest file (4.7k lines, 123 fns). **Trigger management** — `auditTriggers_v1`, `resetRecommendedTimeTriggers_v1`, ten `install*Trigger*`. Also `loadTableBySchema_`, `applySheetStyling_`, Supabase upserts, backfills, and the date/string/number/fuzzy helpers. |
| [core/menu.js](core/menu.js) | `onOpen` and every `menu_*` entry point. Start here to find what a menu item actually calls. |
| [core/config.js](core/config.js) | `loadConfig_()` and the STORKAUP_CONFIG reader. |
| [core/schema.js](core/schema.js) | `STORKAUP_SCHEMA` header maps. Data only, no functions. |
| [core/newsales_v2.js](core/newsales_v2.js) | Magento NEWWEB ingest, `safePoll_v2` and its run-window gate. |
| [core/salessummaries.js](core/salessummaries.js) | Sales summary sheets and marts. |
| [core/customers.js](core/customers.js) · [core/customer_analysis.js](core/customer_analysis.js) | Magento customers; customer profiles and scoring. |
| [core/cludo.js](core/cludo.js) | Cludo search API and the PRODUCTS master catalog (breadcrumb crawl). |
| [core/storkaup_pricing.js](core/storkaup_pricing.js) | storkaup.is GraphQL. Price health **and** product health (out of stock, negative stock, uncategorised) — feeds the vöruvöktun app. |
| [core/email.js](core/email.js) | Weekly/monthly digests, `installMonthlyDigestTrigger_v1`, cache-help templates. |
| [core/seo_manager.js](core/seo_manager.js) | SEO copy generation queue. |
| [core/search_console.js](core/search_console.js) · [core/ga4.js](core/ga4.js) | Search Console and GA4 ingest. |
| [core/solution_pages.js](core/solution_pages.js) | Cross-category solution pages. |
| [core/applications.js](core/applications.js) | Typeform applications (kennitölur, credit scores). |
| [core/invoices.js](core/invoices.js) | Gmail → Drive invoice collector. |
| [core/order_monitor.js](core/order_monitor.js) | Magento pending-order monitor. |
| [core/auth.js](core/auth.js) | Magento admin token cache. |
| [webapp.js](webapp.js) | `doPost`/`doGet` for the anonymous deployment — key-guarded actions only. |
| [pim/buildPimWorksheet.js](pim/buildPimWorksheet.js) | PIM work sheet from the Plytix export. **Pushed with the main project** (`pim/` is not in `.claspignore`). |
| [admin/](admin/) | The second GAS project. `app.js` routes, `auth.js` guards, `delegate.js` calls the main project, plus the two HTML apps. |

Two things that trip people up. `core/utils.js` section headers are
double-encoded UTF-8 (`ðŸ§©` where an emoji belongs) — cosmetic, comments only.
And a `_` suffix means private: those functions do **not** appear in the Apps
Script function picker, so anything you need to run by hand ends in `_v1` or
has no suffix.

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
| `scheduledMonthlyDigest` | Monthly, 1st ~08:00 | Monthly email + records |

**`safePoll_v2`'s 5-minute trigger is not a 5-minute cadence.**
`getNewwebRunWindowDecision_v2_()` gates it: off 00:00-06:59, every run
07:00-21:59, quarter-hours only 22:00-23:59. Runs outside the window log
`Skipping run by schedule window` and do nothing. For a manual run use
`safePollNow_v2()` or the NEWWEB menu item — they pass `force: true` and ignore
the window; bare `safePoll_v2()` obeys it and will silently no-op at 03:00.

**The monthly digest was dead code until 2026-09-01.** `scheduledMonthlyDigest`
([core/email.js](core/email.js)) and its installer both existed, but nothing
called `installMonthlyDigestTrigger_v1()` and `auditTriggers_v1` listed the
handler under `OPTIONAL` ("install on demand"), so an absent trigger was never
warned about — the same silence that hid four uninstalled triggers for three
months. It is now in `EXPECTED` and in `resetRecommendedTimeTriggers_v1`.

**The trigger is installed and verified** — `auditTriggers_v1` on 2026-09-09
returned `[AUDIT][OK] All 13 required triggers are installed`, 16 triggers
total (14 required instances plus `onOpen` and `pruneCompletedApplications`),
no warnings. Nothing left to run here.

**Do not reach for `resetRecommendedTimeTriggers_v1()` to install one trigger.**
It calls `removeTriggersByHandler_v1` on all thirteen handlers *first* and then
reinstalls them, `safePoll_v2` included. Stop it between the delete and the
install — execution limit, quota, a closed tab — and they stay deleted. That is
the exact failure this section is about. The individual `install*Trigger*`
functions are idempotent: each checks for an existing trigger and returns
`{created:false}` instead of adding a second one.

**Two OPTIONAL jobs have no trigger, and the audit will never tell you.**
By design — `OPTIONAL` handlers are recognised so they do not log as unknown,
but their absence is never warned about. As of 2026-09-09 neither
`collectInvoicesToDrive_v1` (the Gmail → Drive invoice collector, mapped as
"daily ~07:10") nor `runScheduledSeoAutomation_v1` ("every 30 min, install on
demand") is installed. Both therefore run only when someone clicks. If the
invoice collector is meant to be daily, run
`installInvoiceCollectorTrigger_v1` ([core/invoices.js](core/invoices.js)) once
— it is idempotent and returns `{created:false}` if a trigger already exists.
`runScheduledSeoAutomation_v1` is deliberately hand-run: SEO batches are
reviewed in the sheet before anything ships, so a schedule would not help.

The digest's "Met og áfangar" block comes from a **second** RPC,
`public.web_records_v1` ([core/sql/web_records_v1.sql](core/sql/web_records_v1.sql)),
which must be applied in the Supabase SQL editor. It is deliberately separate
from `monthly_digest_stats`: that function already exceeds the 8s anon
statement_timeout, and `fetchWebRecords_` swallows any failure so a broken
records query costs one section, not the whole email. Records rank **NEWWEB +
OLDWEB** unioned, and revenue records are **m/VSK** — OLDWEB has no usable excl
figure (see RUNBOOK.md).

**BC has no trigger.** `scheduledBcSync_v1` was deleted 2026-04-30 (`d83c7c5`);
this table listed it as "twice daily" for three months after it stopped existing.
BC now loads only from the **BC Sync menu** (`processBcDrop_v1`), reading XLSX
dropped in Drive. Files uploaded by `bc_sync.ps1` sit unread until someone clicks
it. Never run `processBcDropForce_v1` on the invoice file — it nulls `order_no`
and `email` across all history (see `core/sql/generate_shopping_list_v2.sql`).

**Export a rolling ~3-month window from BC, not the full history.** Decided
2026-08-31. Lines are deduped against a 2-year-windowed *invoice* key set
([core/utils.js](core/utils.js), `cutoff` in `processBcDrop_v1`), so every line
whose invoice predates that window counts as new on every run. With a
full-history export that was 217,790 of 484,768 rows re-sent per import —
harmless (`resolution=ignore-duplicates` drops them server-side) but 4m14s of a
6-minute execution budget, growing ~6%/month.

Two consequences of the narrow window:
- Because nothing triggers this, **a skipped month is a real gap** in
  `bc_lines_raw`. Three months of overlap is the margin; don't cut it to one.
- `processBcDropForce_v1` is no longer a full rebuild — it force-upserts only
  what the file contains. A genuine rebuild needs a deliberate full-history
  export for that one run.

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

**Live (2026-08-11, per the deployer — attribute bumped on all seven KPI pages):**

| What | Value |
|---|---|
| `data-storkaup-rev` — governs all child files | `4131408` |
| `dashboard-bootstrap.js` script-tag src | `6c992c5` |
| `website-dashboard-bootstrap.js` script-tag src | `6c992c5` |

Only `data-storkaup-rev` was moved to `4131408`; the two script-tag `src`
values were deliberately left at `6c992c5`, because **both bootstrap files are
byte-identical between the two revisions** — the `4131408` deploy touched only
`dashboard.js` and `dashboard-theme.css`. Re-pinning the tags would have busted
their cache for no content change. Verify with:

```bash
git diff --stat 6c992c5 4131408 -- Webflow/dashboard-bootstrap.js Webflow/website-dashboard-bootstrap.js
```

`4131408` shipped the Klaviyo insights block on `/kpi/klaviyo` (monthly
timeline with un-measured months drawn as voids, traceability split, campaign
table) and fixed two things worth knowing about:

- `klaviyo-last-sync-date` printed *today's date* unconditionally, so the page
  always claimed to be current. It now reports `max(order_date)`.
- `init()` bailed unless it found `.dashboard-date-item[data-month]`, any
  `[data-metric]`, or a day picker. A `/kpi/klaviyo` stripped down to just
  `[data-klaviyo-campaign-cards]` matched none of them and came up blank. The
  guard now also accepts `hasKlaviyoMetricTargets()`.

⚠️ The **hardcoded fallbacks below are now two revisions stale** and were not
bumped with this deploy. Bumping them is circular — the fallback lives *inside*
the bootstrap, so changing it changes that file's bytes, which means the
script-tag `src` pins would then have to move too. Left deliberately; see the
warning under the fallback table.

Historical note: the values recorded here before `6c992c5` (`aff3278`,
`df2956f`, `b55e8c4`) were stale — the deploy had moved to `6c992c5` on
2026-07-14 and nobody updated this table.

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

# Architecture

## Overview

```
External sources
  (Magento / Klaviyo / GA4 / Search Console / Cludo /
   storkaup.is GraphQL / Typeform; BC via manual XLSX drop)
        │
        ▼
Google Apps Script (GAS)          ← scheduled triggers, incremental ingest
        │
        ▼
Supabase raw schema                ← append-only source tables
        │
        ▼
Supabase mart schema               ← materialized views, aggregations
        │
        ▼
Supabase api / public RPCs         ← typed query functions
        │
        ▼
Webflow (JavaScript)               ← dashboards (read) + customer pages (write priority flags via RPC)
```

---

## Web-app projects

Two separate Apps Script projects live in this repo. The split keeps applicant PII behind real authentication instead of URL-secrecy / the shared Webflow password.

| Project | Location | Web-app access | Serves |
|---|---|---|---|
| **Main** | repo root | `ANYONE_ANONYMOUS` | Typeform webhook (`doPost`, `?token=` checked); key-protected dashboard JSON, pending-applications badge, cache-help email; delegation actions for the admin project |
| **Admin-apps** | `admin/` | `DOMAIN` (@storkaup.is) + `ADMIN_APP_EMAILS` allowlist | Three HTML apps, routed by `?app=` in `admin/app.js`: umsókn (applications — names, kennitölur, credit scores), vöruvöktun/listaverð, and vöruinnihald (`admin/voruinnihald.js`) |

- Anonymous main deployment serves **no HTML app and no PII** — the old `?app=umsokn`/`?app=listaverd` routes and `core/webapp.js` were removed. Applicant data can only be reached through the admin project after Google login.
- Admin apps guard every `google.script.run` entry with `adminGuard_()` (`admin/auth.js`), with an app key (`adminGuard_(app)`); deployer always allowed, others must be in `SETTINGS.ADMIN_APP_EMAILS` (all apps) or the app's own `SETTINGS.<APP>_APP_EMAILS` row (that app only); access is audit-logged per user.
- Heavy/stateful ops (Magento customer sync, application pruning, zero-price scan) stay in the main project; the admin project reaches them via key-protected `doPost` actions (`admin/delegate.js`, using `API.Dashboard.KEY` + `API.Dashboard.EXEC_URL`).
- `access: DOMAIN` is deliberate — auth is tied to the company Workspace (governed offboarding + MFA). Do not switch to `ANYONE`; route external users through IT as Workspace guests.
- Webflow nav links open the admin `/exec` URL in a **new tab** (logged-in GAS apps break inside an iframe).
- Because the admin project calls the main project's pinned `/exec` (e.g. the "Keyra aftur" button), **both** projects must be deployed as a new version, not just pushed. `gas_deploy.ps1` does both; never create a new deployment. See `CLAUDE.md` → *Deploy workflow*.

---

## 1. Google Apps Script — Ingest layer

All ingest runs in the **main** Apps Script project. No backend server. (Triggers are independent of web-app deployment settings — the anonymous web-app access does not affect them.)

The required trigger set is defined once, in `requiredTimeTriggers_()` (`core/utils.js`). `auditTriggers_v1()` checks the installed triggers against it, and `resetRecommendedTimeTriggers_v1()` reinstalls from it. **`auditTriggers_v1()` is the source of truth for what is actually installed** — not this table.

### Scheduled triggers (13 required handlers)

| Function | Cadence | Source | File |
|---|---|---|---|
| `safePoll_v2` | Every 5 min, gated (see below) | Magento (new orders only) | `core/newsales_v2.js` |
| `scheduledMagentoSync_v1` | Hourly ~:20 | Magento (incremental full sync) + safePoll watchdog | `core/utils.js` |
| `scheduledKlaviyoSync_v1` | Every 15 min | Klaviyo events | `core/utils.js` |
| `scheduledReferenceSync_v1` | Every 6h ~:50 | Reference tables (products, customers, Cludo, marts) | `core/utils.js` |
| `scheduledCludoSync_v1` | Every 12h ~:55 | Cludo product coverage; also syncs `raw.web_catalog` and product relations | `core/utils.js` |
| `scheduledCustomerAnalysisSync_v1` | Daily ~05:25 | Customer profiles + profiles MV | `core/utils.js` |
| `scheduledSearchConsoleSync_v1` | Daily ~05:30 | Search Console | `core/search_console.js` |
| `scheduledGa4Sync_v1` | Daily ~06:30 | GA4 | `core/ga4.js` |
| `scheduledZeroPriceScan_v1` | Daily ~06:50 | storkaup.is zero list-price scan | `core/storkaup_pricing.js` |
| `runDailySanityChecks_v1` | Daily ~07:40 | Cross-source validation | `core/utils.js` |
| `scheduledNewwebStatusSync_v2` | Daily ~11:30 & ~17:30 (2 triggers) | Magento order status | `core/newsales_v2.js` |
| `scheduledWeeklyDigest` | Mondays ~08:00 | Weekly email | `core/email.js` |
| `scheduledMonthlyDigest` | Monthly, 1st ~08:00 | Monthly email + records (`web_records_v1`) | `core/email.js` |

`safePoll_v2`'s 5-minute trigger is gated by `getNewwebRunWindowDecision_v2_()`: off 00:00–06:59, every run 07:00–21:59, quarter-hours only 22:00–23:59. `safePollNow_v2()` (or the NEWWEB menu item) forces a run.

`auditTriggers_v1` also knows a set of **OPTIONAL** handlers — `onOpen`, `pruneCompletedApplications`, `runScheduledSeoAutomation_v1`, `collectInvoicesToDrive_v1`, `zeroPriceScanFromTrigger_v1` — which it recognises but **never warns about when absent**.

### Business Central — manual drop, no trigger

BC has no trigger (`scheduledBcSync_v1` was deleted 2026-04-30). `bc_sync.ps1` / `bc_sync.bat` upload XLSX exports to a Drive drop folder, and the **BC Sync** menu runs `processBcDrop_v1`, which writes `raw.bc_invoices_raw`, `raw.bc_lines_raw`, `raw.bc_credit_invoices_raw` and `raw.bc_customers_raw`. Exports cover a rolling ~3-month window, so a skipped month is a real gap. Never run `processBcDropForce_v1` on the invoice file. Details in `CLAUDE.md` → *Key scheduled triggers*.

### Key ingest files

`CLAUDE.md` → *Where things live* has the full file table. The ones most often needed here:

| File | Purpose |
|---|---|
| `core/newsales_v2.js` | Magento order polling (`safePoll_v2`), run-window gate, order status sync |
| `core/utils.js` | Most other sync functions, trigger management, BC drop, Supabase client, sanity checks |
| `core/salessummaries.js` | SALES_SUMMARIES sheets and marts across sources |
| `core/customers.js` | Magento customers, resolution and profile logic |
| `core/customer_analysis.js` | Customer profiles and scoring |
| `core/ga4.js` · `core/search_console.js` | GA4 and Search Console ingest |
| `core/cludo.js` | Cludo search API (product coverage) and the PRODUCTS master catalog |
| `core/web_catalog.js` | Published product list → `raw.web_catalog` |
| `core/storkaup_pricing.js` | storkaup.is GraphQL: price and product health, zero-price scan |
| `core/auth.js` | Magento admin token cache |
| `core/config.js` | `loadConfig_()` reads the STORKAUP_CONFIG sheet; cached 5 min in Script Properties |
| `core/schema.js` | Sheet schema definitions |
| `core/menu.js` | Apps Script UI menu |
| `core/seo_manager.js` | Queue-driven SEO copy; text provider from `SETTINGS.SEO_PROVIDER` (gemini default; claude or openai also accepted), OG images via OpenAI; run by hand |

### Monitoring

- **Run log:** scheduled jobs write start/finish rows to `ingestion_runs` (`startIngestionRun_` / `finishIngestionRun_`, `core/utils.js`). A job whose sub-step fails records `partial`, not `success`.
- **Sanity checks:** `runDailySanityChecks_v1` cross-checks sources, including recent `ingestion_runs` and the BC cross-check.
- **safePoll watchdog:** `safePoll_v2` deliberately does not log to `ingestion_runs`; it sets the Script Property `SAFEPOLL_LAST_OK_MS` instead. `checkSafePollWatchdog_()` runs at the top of the hourly `scheduledMagentoSync_v1` and alerts if that value is stale; the daily sanity check reports it too.
- **Alerts:** `notifyTriggerFailure_()` / `sendOpsAlert_()` (deduplicated and throttled) are wired into most scheduled jobs; `scheduledGa4Sync_v1` and `scheduledSearchConsoleSync_v1` do not call `notifyTriggerFailure_`. Recipients come from `SETTINGS.ALERT_EMAILS` in STORKAUP_CONFIG, then `API.ALERTS.EMAILS`, then Script Property `ALERT_EMAILS`.

### When trigger state is unknown

1. Run `auditTriggers_v1()`.
2. Install a missing handler with its own `install*Trigger*` function — they are idempotent and return `{created:false}` if one already exists.
3. Use `resetRecommendedTimeTriggers_v1()` only to rebuild the full set. It removes and reinstalls one handler at a time and audits at the end. A deploy does not change triggers.

### PIM / vöruinnihald

A third area alongside ingest and dashboards: product names and descriptions worked up in a sheet and imported into Plytix.

- `pim/*.js` is **pushed with the main project** (`pim/` is not in `.claspignore`): `buildPimWorksheet.js`, `plytix_export.js`, `voruinnihald_ai.js`, `related_products.js`, `sync_relations.js`, `lookup_sku.js`, `pakkning_i_heiti.js`. Driven by the **Vöruinnihald** menu in `core/menu.js` — build the work sheet from the Plytix export, export to Plytix, mark the last export as imported.
- `pim_sync.ps1` / `pim_sync.bat` upload Plytix CSV exports from `pim_drop/` to a Drive drop folder (same pattern as BC).
- The Python tools in `pim/` (`heitalinter.py`, `vorumynd.py`) run locally and are never pushed. See `pim/README.md` and `pim/VORUINNIHALD.md`.
- The admin project's vöruinnihald app (`admin/voruinnihald.js`) reads and writes the same work sheet behind Google login.
- `raw.web_catalog` (below) is the published side of the same product data.

---

## 2. Supabase — Data layer

### Schema layout

```
raw.*       — append-only ingest tables, written by GAS
mart.*      — materialized views, refreshed by GAS or scheduled SQL
api.*       — RPC functions called by Webflow
public.*    — additional RPC functions and views
```

### Key raw tables

| Table | Source | Written by |
|---|---|---|
| `raw.newweb_orders_raw` | Magento | `safePoll_v2`, `scheduledMagentoSync_v1` |
| `raw.bc_invoices_raw`, `raw.bc_lines_raw`, `raw.bc_credit_invoices_raw`, `raw.bc_customers_raw` | Business Central (manual XLSX drop) | `processBcDrop_v1` (BC Sync menu) |
| `raw.raw_klaviyo_events` | Klaviyo | `scheduledKlaviyoSync_v1` |
| `raw.dim_klaviyo_campaigns` | Klaviyo | `scheduledKlaviyoSync_v1` |
| `raw.customer_priority_flags_raw` | Webflow customer pages | priority-flag RPCs (see *Webflow* below) |
| `raw.customer_priority_flags_history` | trigger on the flags table | every update/delete of a flag row (`core/sql/customer_priority_flags_history.sql`) |
| `ingestion_runs` | GAS job log | `startIngestionRun_` / `finishIngestionRun_` |

Not exhaustive: Search Console, GA4, OLDWEB orders (`oldweb_orders_raw`), Magento customers (`magento_customers_raw`), Typeform applications and storkaup.is price/product health also land in `raw.*` — see the writing files in `core/`.

### Key mart views

| View | Purpose |
|---|---|
| `mart.mv_klaviyo_attribution_daily` | Last-click Klaviyo attribution, 30-day window |
| `mart.mv_klaviyo_attribution_daily_nobot` | Same, bot clicks excluded |
| `mart.top_products_all` | Top products aggregation (heavy — runs off-peak) |

`raw.web_catalog` sits alongside these: the published storkaup.is product list (sku, supplier `brand_sku`, name, brand, slug), written by `syncWebCatalogToSupabase_v1` inside `scheduledCludoSync_v1` every 12h. It is the only place the supplier part number exists, and it is deliberately separate from `products_raw`, which is derived from sales records and therefore cannot answer "is this on the web".

### Key RPCs (called by Webflow)

| RPC | Page |
|---|---|
| `day_kpi_pack` | Mælaborð — daily KPI cards |
| `website_kpi_pack` | Vefmælaborð — GA4 website metrics |
| `api.get_customer_profile_family_summary` | Innkaupalistar / Sölutölur |
| `api.get_customer_last_orders` | Customer last order history |
| `mart.v_klaviyo_campaign_cards_30d_nobot` | Herferðir — Klaviyo campaign cards |

`api.resolve_customer_family_ids` is an internal helper used by other `api` functions (e.g. `get_customer_last_orders`); Webflow does not call it directly.

The digest RPCs `weekly_digest_stats` and `monthly_digest_stats` are callable by `service_role` only — i.e. from GAS, not Webflow. `public.web_records_v1` feeds the monthly digest's records section.

### SQL migrations

All schema changes are in `core/sql/`. Apply manually in Supabase SQL editor — there is no migration runner.

---

## 3. Webflow — Frontend layer

Dashboards are read-only; all data comes from Supabase RPCs via `fetch`. **The customer pages write.** `forgangslisti.js`, `customer-profiles.js` and `activation.js` call priority-flag RPCs — `set_customer_priority_flag`, `bulk_set_customer_priority_flags`, `assign_customer_priority_rep`, `bulk_assign_customer_priority_rep`, `log_customer_priority_touch` — and `customer-profiles.js` also calls `create_sales_task` / `complete_sales_task`. Every update or delete of a flag row is copied to `raw.customer_priority_flags_history` by a trigger. For the security posture of these writes, see the security review (kept outside git).

Webflow site-wide custom code is also served on the unauthenticated password-gate page, so secrets stay in page-scoped code only. `tools/check-webflow-pins.js` (run at the end of `gas_deploy.ps1`) checks this.

The internal umsókn/vöruvöktun/vöruinnihald apps are **not** Webflow pages — the nav links open the admin-apps GAS project in a new tab (see *Web-app projects* above).

### Pages and JS files

| URL | JS file(s) | Purpose |
|---|---|---|
| `/kpi/dashboard` | `dashboard.js` + `dashboard-bootstrap.js` | Main sales KPIs, BC web share |
| `/kpi/solutolur` | `dashboard.js` | Sales figures |
| `/kpi/vidskiptavinur` | `customer-profiles.js` | Customer profiles, family totals |
| `/kpi/forgangslisti` | `forgangslisti.js` (via `forgangslisti-embed.html` Embed — **not** a bootstrap child; own pin) | Priority list; writes flags, reps, touches |
| `/kpi/activation` | `activation.js` (page custom code — own pin) | Web-activation segments; writes flags and reps. Working but unfinished and not linked in the nav (NEXT_TASKS P11-8) |
| `/kpi/klaviyo` | `dashboard.js` | Klaviyo attribution KPIs |
| `/kpi/top-products` | `top-products.js` | Top products and categories |
| `/kpi/vefur-kpi` | `website-dashboard.js` + `website-dashboard-bootstrap.js` | GA4 website metrics |
| `/kpi/voruuppfletting` | `lookup.js` (via `lookup-embed.html` Embed — **not** a bootstrap child; own pin) | Look up a list of supplier part numbers or Stórkaup SKUs |
| `/kpi/voruportal` | `portal.js` (via `portal-embed.html` Embed — own pin) | Product portal |

`order-search.js` is also a bootstrap child, loaded by `dashboard-bootstrap.js`.

### Non-negotiables

- BC web share logic must not change casually: monthly cards use net BC, daily cards use `day_kpi_pack`, canonical tag is `salesperson_code = 'VEFUR'`.
- If a secondary RPC fails, the primary dashboard must still render.
- `safePoll_v2` 5-minute cadence must not be broken.

### Production pins (jsDelivr / Webflow custom code)

See `CLAUDE.md` → *Current production pins*. That section is the single source of
truth; update it whenever a Webflow file changes. (This used to point at
`NEXT_TASKS.md`, which now only forwards here — one hop too many.)

Note that `data-storkaup-rev` governs the bootstrap's child files only.
Four files (`lookup.js`, `activation.js`, `forgangslisti.js`, `portal.js`) are
pinned independently in page-level code — `CLAUDE.md` lists where each pin lives.

---

## 4. Daily operations

See `RUNBOOK.md` for the failure playbook.

```
Something looks wrong?
1. Check Apps Script Executions for errors in the last 24h.
2. Run auditTriggers_v1() to confirm the installed triggers.
3. Verify Supabase directly before blaming Webflow.
4. Compare raw vs net numbers before assuming dashboard math is broken.
```

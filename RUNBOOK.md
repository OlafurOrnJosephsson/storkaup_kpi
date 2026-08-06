# KPI Operations Runbook

## Scope

This runbook covers daily operations for:
- NEWWEB ingestion (Magento orders -> GAS sheet -> Supabase)
- Magento customer sync
- BC sync to Supabase (for web vs BC % and related metrics)

## Apps Script projects

- **Main project** (repo root) — all ingest triggers + the anonymous web app (Typeform webhook, key-protected dashboard/badge/cache-help + delegation). Live `/exec` runs a pinned version; `clasp push` updates `@HEAD` only, so cut a new version with `clasp deploy -i <deploymentId>` to activate web-app changes.
- **Admin-apps project** (`admin/`) — umsókn + vöruvöktun/listaverð HTML apps behind Google login (`access: DOMAIN`) + `SETTINGS.ADMIN_APP_EMAILS` allowlist. `cd admin && clasp push`, then `clasp deploy` for a new version. Access attempts log `[ADMIN][AUDIT] …` in that project's Executions.

If someone reports "You need access" / a blank umsókn or vöruvöktun screen: they are almost certainly on an account not in `ADMIN_APP_EMAILS` (or not a @storkaup.is account), OR the link is being opened in an iframe instead of a new tab. Check the admin project's Executions for the `access DENIED for <email>` line.

## Typeform webhook

Both Typeform forms POST to the main project's `doPost` at `…/exec?token=<API.Typeform.WEBHOOK_TOKEN>`. The token is enforced when `SETTINGS.TYPEFORM_TOKEN_ENFORCE=true` — a request with a wrong/absent token is rejected. If applications stop landing in the sheets after a Typeform-side URL edit, confirm the `?token=` is still present and matches the config row; a mismatch logs `[SECURITY] doPost: Typeform token …` in Executions. To disable enforcement in an emergency, set `TYPEFORM_TOKEN_ENFORCE=false` (no deploy needed — takes effect within the 5-min config cache).

## Alert Setup (P1-3)

Failure alerts for key triggers are enabled in code.

1. Open Apps Script -> `Project Settings` -> `Script properties`
2. Add property:
   - Key: `ALERT_EMAILS`
   - Value: comma-separated recipients (example: `ops@storkaup.is,olafur@storkaup.is`)
3. Save, then run one trigger manually to confirm normal execution.

Notes:
- Alerts are throttled per job (15-minute dedupe window).
- If `ALERT_EMAILS` is missing, logs will show `[ALERT][WARN] No ALERT_EMAILS configured`.
- Optional: tune alert throttle in Script Properties:
  - `ALERT_MIN_INTERVAL_MINUTES` (global default for all jobs)
  - `ALERT_MIN_INTERVAL_MINUTES__scheduledMagentoSync_v1` (per-job override)
  - Same per-job key pattern works for other jobs, e.g. `__scheduledCludoSync_v1`
  - Example: set Magento to `180` to avoid hourly alert spam during prolonged incidents.

## Primary Functions (Apps Script)

### 1) NEWWEB ingestion
- Function: `safePoll_v2`
- Purpose: Pull new web orders from Magento, write to `NEWWEB`, upsert to Supabase.
- Expected logs:
  - `[NEWWEB][INFO] NEWWEB v2 start ...`
  - `[NEWWEB][INFO] NEWWEB v2 page fetched ...`
  - Either:
    - `[NEWWEB][INFO] NEWWEB v2 import completed {"inserted":N,...}`
    - or `[NEWWEB][INFO] Engar nýjar pantanir frá Magento (v2)`

### 2) Magento customers
- Function: `scheduledMagentoSync_v1`
- Purpose: Sync Magento customers into sheet + Supabase incremental backfill.
- Expected logs:
  - `[MAGSYNC][INFO] Started scheduledMagentoSync_v1 ...`
  - `Fetch Magento Customers — incremental`
  - completion with `magentoSync":"ok"`

### 3) BC sync (important for web vs BC share)
- Function: `scheduledBcSync_v1`
- Purpose: Incremental BC invoices + credit invoices + lines + BC customers upsert to Supabase.
- Expected logs:
  - `[BCSYNC][INFO] Completed scheduledBcSync_v1 ...`
  - result includes uploaded counters for invoices/creditInvoices/lines/customers.

### 4) Klaviyo campaign events (v1)
- Function: `scheduledKlaviyoSync_v1`
- Purpose: Incrementally ingest Klaviyo events into Supabase `raw_klaviyo_events`.
- Expected logs:
  - `[KLAVIYO][INFO] Started scheduledKlaviyoSync_v1 ...`
  - `[KLAVIYO][INFO] Completed scheduledKlaviyoSync_v1: {"fetched":...,"uploaded":...}`

### 5) Daily sanity checks
- Function: `runDailySanityChecks_v1`
- Purpose: Validate KPI trust with alert-on-fail checks.
- Current checks:
  - Dashboard share metrics are within valid bounds
  - Key ingestion jobs have no recent errors and are not stale
  - `klaviyo_attributed_orders_30d <= web_orders_30d`
  - Warning if last BC sync processed zero rows
- Expected logs:
  - `[SANITY][INFO] runDailySanityChecks_v1 result: ...`
  - Alert only if one or more `FAIL` checks occur

## Manual Recovery / Backfill

Use only when incremental sync is clearly behind or data was re-exported.

- Full invoices backfill: `runBcInvoicesFullBackfill_v1`
- Full lines backfill (chunked safer): `runBcLinesFullBackfillChunk_v1`
- Incremental BC wrapper: `runBcIncrementalSync_v1`
- Sales reps reference sync: `syncSalesRepsRefToSupabase_v1`
- Optional marts refresh: `refreshSupabaseMarts_v1`
- NEWWEB missing-field repair (recent rows): `reconcileNewwebMissingData_v2`

Note: `refresh_mv_top_products_all` may timeout (statement timeout) during busy hours. Run heavy refresh off-peak.

## Daily Check (quick)

1. Apps Script `Executions` last 24h:
   - `safePoll_v2` mostly completed
   - no recurring failures
2. `scheduledMagentoSync_v1` recent run has `magentoSync":"ok"`
3. `scheduledBcSync_v1` recent run completed
4. Confirm `[SALES_REPS_REF][INFO] Sync completed. Uploaded: N` in Magento/ref sync logs
5. Spot-check one fresh order in `NEWWEB` sheet + frontend

## Metric Contract

Monthly sheet (`Sales - Monthly`) has two web-share metric families:

- `Web Orders % of BC` and `Web % of BC`:
  - Canonical BC-booked web share (Power BI parity)
  - Numerator: BC docs tagged as web (`VEFUR`, and historical `CO22-%` only before `2025-08-18`)
  - Denominator: net BC (`BC_INVOICES - BC_CREDIT_INVOICES`)

- `All Web Orders % of BC` and `All Web % of BC`:
  - Operational comparison (`OLDWEB + NEWWEB`) versus the same net BC denominator
  - Expected to differ from canonical BC-booked share

Dashboard cards should use canonical values (`Web Orders % of BC`, `Web % of BC` logic).

## SQL Verification (Supabase)

Use when dashboard and sheet differ.

1. Dashboard month values:
```sql
select
  api.dashboard_compat('2026-02')->'month'->>'webOrdersPct' as web_orders_pct,
  api.dashboard_compat('2026-02')->'month'->>'webRevenuePct' as web_revenue_pct,
  api.dashboard_compat('2026-02')->'month'->>'salesRepPct' as sales_rep_pct,
  api.dashboard_compat('2026-02')->'month'->>'selfServePct' as self_serve_pct;
```

2. Sales reps reference exists:
```sql
select count(*) from raw.sales_reps_ref where active = true;
```

3. Function overload check:
```sql
select n.nspname as schema, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'dashboard_compat'
order by 1,3;
```

## Common Issues

### Issue: `Permission denied while enabling APIs: <api> for GCP project 159224455440`
- Symptom: any Google service call fails with this, e.g.
  `[BC_DROP] Cannot open drop folder: Permission denied while enabling APIs: drive`
- Cause: the main Apps Script project is attached to a **Standard** GCP project
  (`storkaup-kpi-core`, number `159224455440`), not a default one. Apps Script
  auto-enables APIs only in *default* projects. In a Standard project every
  Google API must be enabled manually in Cloud Console before first use —
  Apps Script's auto-enable attempt is denied, and the call fails at runtime.
- Action:
  1. Open `https://console.cloud.google.com/apis/library/<api>.googleapis.com?project=159224455440`
     (e.g. `drive.googleapis.com`) and click **Enable**.
  2. Wait a few seconds for propagation, then re-run.
  3. If the console shows "you don't have permission", it is an IAM/org-policy
     issue — request `serviceusage.services.enable` on that project from IT.
- ⚠️ This is not BC-specific. It hits every DriveApp user in the project:
  `core/utils.js` (BC drop), `core/invoices.js` (invoice collector),
  `core/seo_manager.js` (SEO folders). When it happens, check
  **Apps Script → Executions → Failed** to see how long it has been broken and
  what else stopped silently.
- ⚠️ Applies to any NEW Google API this project starts using. Adding an advanced
  service or a new scope is not enough on a Standard GCP project — enable the
  API in Cloud Console too, or it will fail only at runtime, in production.
- Occurred 2026-08-05 (Drive API), blocking the first BC drop import after the
  ingest freeze. Enabling Drive API in the console resolved it.

### Not an issue: BC columns are 0 in SALES_SUMMARIES from 2026-05 onward
- Symptom: `BC Revenue Incl/Excl`, `BC Orders` are 0 for recent months; `Build All`
  does not fix it. Also `Web Orders % of BC` / `Web % of BC` are 0.0% from 2025-09.
- Cause: **known and accepted (2026-08-05), do not chase.** SALES_SUMMARIES reads
  the **BC_INVOICES Google Sheet**, and nothing writes to that sheet any more —
  `processBcDrop_v1` loads BC into **Supabase only** (`core/utils.js:1501`).
  Every code reference to `BC_INVOICES` is a read. The sheet has been frozen
  since it was last pasted into manually (~2026-04), so `Build All` just re-reads
  stale data. Separately, the 0.0% web-share columns broke in 2025-09 because
  `SALESPERSON_CODE` stopped mapping when BC moved to SaaS and renamed the header
  (`core/schema.js:100`) — so even pasting fresh data would leave those at 0.
- Why it is safe to leave: the only consumer of these columns is
  `getLiveBcWebShare_` in `webapp.js:240`, serving `?action=dashboard`, which no
  Webflow page calls. Nothing user-facing depends on them.
- The real BC numbers live in Supabase and are correct: `public.day_kpi_pack`
  (BC fields deliberately nulled for anon), `mart.v_bc_monthly_net_v1`,
  `raw.bc_invoices_raw`. Dashboard BC ratios come from
  `window.STORKAUP_BC_MANUAL`, entered by hand.
- If these columns ever need to be real: repoint the `loadBCMonthly*` family in
  `core/salessummaries.js` at `raw.bc_invoices_raw` via service_role. Do NOT
  reinstate the manual paste — that is assessment item 10 (brittle manual step).

### Issue: Magento auth 401 in customer sync
- Symptom: `Magento auth failed (401)` in `scheduledMagentoSync_v1`
- Action:
  1. Run `menu_clearMagentoTokenCache` or `clearMagentoAdminTokenCache_`
  2. Re-run `scheduledMagentoSync_v1`
  3. If still failing, verify Magento API user role/permissions

### Issue: `safePoll_v2` overlaps
- Symptom: `[NEWWEB][WARN] Another v2 run in progress`
- Action:
  - Usually safe (lock protection works)
  - If excessive, lower trigger frequency or optimize heavy operations

### Issue: repeated sync failure alerts during transient API outages
- Behavior:
  - Scheduled sync jobs now retry transient failures once before marking the run failed.
  - Transient patterns include common `429/5xx/timeout` errors.
- Action:
  1. Keep alert throttles at sane values (example: 60-180 minutes for high-frequency jobs).
  2. Use Apps Script Executions to confirm retries recover before failure.

### Issue: no new rows in `NEWWEB`
- Confirm checkpoint in log.
- If Magento has no newer orders than checkpoint, this is expected.
- Verify latest Magento order timestamp is newer than checkpoint.

## Trigger Baseline

Expected active trigger functions:
- `safePoll_v2`
- `scheduledMagentoSync_v1`
- `scheduledBcSync_v1`
- `scheduledCludoSync_v1`
- `scheduledCustomerAnalysisSync_v1`
- `scheduledKlaviyoSync_v1`
- `runDailySanityChecks_v1`
- `onOpen`

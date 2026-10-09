# KPI Operations Runbook

## Scope

This runbook covers daily operations for:
- NEWWEB ingestion (Magento orders -> GAS sheet -> Supabase)
- Magento customer sync
- BC import (**manual**: BC Sync menu -> `processBcDrop_v1`, XLSX dropped in Drive by `bc_sync.ps1`). Dashboard monthly BC ratios are entered by hand per month (`window.STORKAUP_BC_MANUAL`), not read from Supabase.

## Apps Script projects

- **Main project** (repo root) — all ingest triggers + the anonymous web app (Typeform webhook, key-protected dashboard/badge/cache-help + delegation).
- **Admin-apps project** (`admin/`) — umsókn, vöruvöktun/listaverð and vöruinnihald HTML apps behind Google login (`access: DOMAIN`) + `SETTINGS.ADMIN_APP_EMAILS` allowlist. Access attempts log `[ADMIN][AUDIT] …` in that project's Executions.

### Deploying (`gas_deploy.ps1`)

Live `/exec` runs a pinned version; `clasp push` updates `@HEAD` only. Always deploy through the script, which holds both deployment IDs and refuses `@HEAD`:

- `.\gas_deploy.ps1 "desc"` — push + new version, both projects.
- `.\gas_deploy.ps1 "desc" -Only Main` / `-Only Admin` — one project.
- `.\gas_deploy.ps1 "desc" -PushOnly` — push without a new version (`/exec` keeps running the old code).

It runs `clasp push --force` then `clasp deploy -i <pinned id>` per project, and ends with a non-blocking `node tools/check-webflow-pins.js`.

- **Never run `clasp deploy` without `-i`** — that creates a NEW deployment, changes the `/exec` URL and breaks the Webflow iframe and the admin nav links.
- **The main project must get a new version too, not just a push.** Admin actions (the vöruvöktun "Keyra aftur" zero-price scan, Magento customer sync, PIM drafts, …) call the main project's `doPost` via `admin/delegate.js`; that `/exec` is pinned, so a push alone leaves the button running stale code.
- A root push uploads **every** uncommitted change under `core/` and any `.js` in a non-ignored subdirectory (`pim/` included). Check `git status` first.
- **200-version limit.** Each non-`-PushOnly` run creates a version. When a project hits the Apps Script cap, `clasp deploy` fails and the script prints that the push succeeded but no version was set — `/exec` still runs the old code. Delete old versions in the Apps Script editor (Project history), then re-run.

If someone reports "You need access" / a blank umsókn or vöruvöktun screen: they are almost certainly on an account not in `ADMIN_APP_EMAILS` (or not a @storkaup.is account), OR the link is being opened in an iframe instead of a new tab. Check the admin project's Executions for the `access DENIED for <email>` line.

## KPI page sign-in (since 2026-10-09)

KPI pages require a personal Google sign-in on top of the Webflow folder password. `Webflow/auth.js` (site-wide head, pinned) runs the Supabase Auth flow and swaps the anon key for the user's token on every Supabase call; it does nothing on pages without `STORKAUP_CONFIG`. Two gates, both needed:

1. **Google Admin** — the person has a @storkaup.is Google account in the `KPI-notendur` org unit. Staff without Gmail get a **Cloud Identity Free** licence (no cost, 50 seats), never Business Standard (automatic licensing is OFF for that unit). 2-Step Verification is enforced there. Mail for @storkaup.is is in Outlook, so these accounts carry no mailbox.
2. **Supabase allowlist** — `raw.kpi_staff_access`. A trigger on `auth.users` rejects any account not on it, whatever the sign-in route.

**Onboarding:** add the user in Google Admin (`KPI-notendur`, Cloud Identity Free), then
`insert into raw.kpi_staff_access (email, note) values ('nafn@storkaup.is', 'hlutverk');`

**Offboarding — all three, or access survives:** suspend/delete in Google Admin; `delete from raw.kpi_staff_access where email = '…';`; delete the user in Supabase → Authentication → Users (an existing session otherwise keeps refreshing).

Shared mailboxes (`vefur@`, `umsokn@`) are never on the allowlist.

**"Netfangið þitt er ekki á aðgangslista"** on the sign-in screen = the Google account chosen is not on the list — often the browser picked a shared account; "Use another account". Supabase → Logs → Auth shows the rejected address.

**Emergency off-switch for one page:** `authDisabled: true` in that page's `STORKAUP_CONFIG`. Works only while anon still has grants (before `kpi_auth_revoke_anon.sql`).

**Google OAuth client** lives in GCP project `storkaup-kpi-auth` (Internal audience), separate from the Apps Script project on purpose. Authorized origin + Supabase redirect URLs must list every domain the KPI pages are served from.

## Typeform webhook

Both Typeform forms POST to the main project's `doPost` at `…/exec?token=<API.Typeform.WEBHOOK_TOKEN>`. The token is enforced when `SETTINGS.TYPEFORM_TOKEN_ENFORCE=true` — a request with a wrong/absent token is rejected. If applications stop landing in the sheets after a Typeform-side URL edit, confirm the `?token=` is still present and matches the config row; a mismatch logs `[SECURITY] doPost: Typeform token …` in Executions. To disable enforcement in an emergency, set `TYPEFORM_TOKEN_ENFORCE=false` (no deploy needed — takes effect within the 5-min config cache).

## Alert Setup (P1-3)

Failure alerts for key triggers are enabled in code.

Recipients (comma- or semicolon-separated) are read from the first of these that is set (`getAlertRecipients_`):
1. STORKAUP_CONFIG `SETTINGS.ALERT_EMAILS` (preferred)
2. STORKAUP_CONFIG `API.ALERTS.EMAILS`
3. Script Property `ALERT_EMAILS` (Apps Script -> `Project Settings` -> `Script properties`)

A value in the config sheet overrides the Script Property.

Notes:
- Alerts are throttled per job. Default dedupe window is 15 min; the safePoll watchdog uses 180, daily sanity checks and stuck pending orders use 720.
- If `ALERT_EMAILS` is missing, logs will show `[ALERT][WARN] No ALERT_EMAILS configured`.
- Optional: tune alert throttle in Script Properties:
  - `ALERT_MIN_INTERVAL_MINUTES` (global default for all jobs — if set, it also replaces the 180/720 job defaults above)
  - `ALERT_MIN_INTERVAL_MINUTES__scheduledMagentoSync_v1` (per-job override)
  - Same per-job key pattern works for other jobs, e.g. `__scheduledCludoSync_v1`, `__safepoll_watchdog`, `__runDailySanityChecks_v1`
  - Example: set Magento to `180` to avoid hourly alert spam during prolonged incidents.

## Primary Functions (Apps Script)

### 1) NEWWEB ingestion
- Function: `safePoll_v2`
- Purpose: Pull new web orders from Magento, write to `NEWWEB`, upsert to Supabase.
- Run window (`getNewwebRunWindowDecision_v2_`): off 00:00-06:59, every trigger
  run 07:00-21:59, quarter-hours only 22:00-23:59. The trigger fires every 5 min
  regardless; runs outside the window log `Skipping run by schedule window` and
  exit. So a 5-minute trigger does not mean a 5-minute cadence.
- Manual run: `safePollNow_v2` (Run menu) or the NEWWEB menu item. Both pass
  `force: true` and ignore the window. Plain `safePoll_v2()` does not.
- Expected logs:
  - `[NEWWEB][INFO] NEWWEB v2 start ...`
  - `[NEWWEB][INFO] NEWWEB v2 page fetched ...`
  - Either:
    - `[NEWWEB][INFO] NEWWEB v2 import completed {"inserted":N,...}`
    - or `[NEWWEB][INFO] Engar nýjar pantanir frá Magento (v2)`
- Watchdog: `safePoll_v2` writes Script Property `SAFEPOLL_LAST_OK_MS` after each
  completed run (it writes no `ingestion_runs` row). `checkSafePollWatchdog_()`
  runs at the top of the hourly `scheduledMagentoSync_v1`, before it takes the
  lock. If the heartbeat is older than 90 min (widened by the night gap just
  after 07:00; no requirement 00:00-06:59) it emails
  `[KPI ALERT] safePoll_v2 er stopp — Magento-pantanir berast ekki inn`
  (throttled to 180 min). The daily sanity check reports the same heartbeat as
  an error (`safepoll_heartbeat`). Response:
  1. Run `auditTriggers_v1()`. If `safePoll_v2` is missing, run
     `installSafePollTrigger_v2()` — not the reset (see Trigger Baseline).
  2. Check Executions for failing `safePoll_v2` runs or lock contention.
  3. Run `safePollNow_v2()` by hand to catch up.

### 2) Magento customers
- Function: `scheduledMagentoSync_v1`
- Purpose: Sync Magento customers into sheet + Supabase incremental backfill.
- Expected logs:
  - `[MAGSYNC][INFO] Started scheduledMagentoSync_v1 ...`
  - `Fetch Magento Customers — incremental`
  - completion with `magentoSync":"ok"`

### 3) BC import (manual — no trigger)
- `scheduledBcSync_v1` was deleted 2026-04-30. BC loads only by hand.
- Procedure: `bc_sync.ps1` uploads the BC XLSX exports to the Drive drop folder
  (`SETTINGS.BC_DROP_FOLDER_ID`). They sit unread until someone clicks
  **BC Sync -> Importa BC skrár úr Drive Drop** (`processBcDrop_v1`). Processed
  files move to the `archive/` subfolder.
- Export a rolling ~3-month window from BC, not full history. Nothing schedules
  this, so **a skipped month is a real gap** in `bc_lines_raw`.
- New export format? Run `diagnoseBcDropHeaders_v1` first (reports unknown/missing
  columns, touches no files).
- **Never run `processBcDropForce_v1` on the invoice file** — it nulls `order_no`
  and `email` across history. It force-upserts only what the file contains; it
  is not a full rebuild (that needs a deliberate full-history export).
- Expected log: `[BC_DROP] Done. Processed: N, Errors: M`; returns
  `{ok, processed, errors}`.
- The `ingestion_runs` row is still written under job_name `scheduledBcSync_v1`
  (trigger_type `drive_drop`), so freshness queries keep that name.

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
  - `dashboard_share_bounds` — dashboard share metrics within valid bounds
  - `ingestion_errors_24h`, `ingestion_partial_24h`
  - `ingestion_freshness` — recent success for Magento (6h), Cludo (24h),
    CustomerAnalysis (36h), Klaviyo (4h)
  - `safepoll_heartbeat` — **error** severity, so it emails
  - `klaviyo_orders_le_web_orders_30d`
  - `ga4_purchase_ratio_7d` (warning)
  - `stuck_pending_orders` (warning; cross-checks `raw.bc_invoices_raw`, sends
    its own alert)
- Expected logs:
  - `[SANITY][INFO] runDailySanityChecks_v1 result: ...`
  - The summary email goes only if one or more error-severity checks `FAIL`;
    warnings alone do not send it.

## Manual Recovery / Backfill

Use only when incremental sync is clearly behind or data was re-exported.

- BC: only `processBcDrop_v1` / `processBcDropForce_v1` (see section 3 above)
- Sales reps reference sync: `syncSalesRepsRefToSupabase_v1`
- Optional marts refresh: `refreshSupabaseMarts_v1`
- NEWWEB missing-field repair (recent rows): `reconcileNewwebMissingData_v2`

Note: `refresh_mv_top_products_all` may timeout (statement timeout) during busy hours. Run heavy refresh off-peak.

## Daily Check (quick)

1. Apps Script `Executions` last 24h:
   - `safePoll_v2` mostly completed
   - no recurring failures
2. `scheduledMagentoSync_v1` recent run has `magentoSync":"ok"`
3. `auditTriggers_v1()` logs `[AUDIT][OK] All 13 required triggers are installed`
4. Confirm `[SALES_REPS_REF][INFO] Sync completed. Uploaded: N` in Magento/ref sync logs
5. Spot-check one fresh order in `NEWWEB` sheet + frontend

Monthly: someone has run BC Sync -> Importa BC skrár this month (`ingestion_runs`
row with job_name `scheduledBcSync_v1`, trigger_type `drive_drop`), and the BC
drop folder holds no unprocessed XLSX.

## Metric Contract

Dashboard BC cards: monthly cards use net BC figures entered by hand in
`window.STORKAUP_BC_MANUAL`; daily cards use `day_kpi_pack`; the canonical web
tag is `salesperson_code = 'VEFUR'`.

The sheet metric families below are **legacy and frozen** (the BC_INVOICES sheet
is no longer written — see "Not an issue: BC columns are 0" below). Kept for
reference. Monthly sheet (`Sales - Monthly`) has two web-share metric families:

- `Web Orders % of BC` and `Web % of BC`:
  - Canonical BC-booked web share (Power BI parity)
  - Numerator: BC docs tagged as web (`VEFUR`, and historical `CO22-%` only before `2025-08-18`)
  - Denominator: net BC (`BC_INVOICES - BC_CREDIT_INVOICES`)

- `All Web Orders % of BC` and `All Web % of BC`:
  - Operational comparison (`OLDWEB + NEWWEB`) versus the same net BC denominator
  - Expected to differ from canonical BC-booked share


## SQL Verification (Supabase)

Use when dashboard and sheet differ.

1. Dashboard month values. `webOrdersPct` / `webRevenuePct` are **null by design**
   (BC stripped from the anon RPC); only `salesRepPct` and `selfServePct` are
   meaningful. For BC figures compare against `STORKAUP_BC_MANUAL` or
   `mart.v_bc_monthly_net_v1` (service_role / authenticated; not anon).
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

### Issue: `Permission denied while enabling APIs: <api> for GCP project <number>`
- Symptom: any Google service call fails with this, e.g.
  `[BC_DROP] Cannot open drop folder: Permission denied while enabling APIs: drive`
- Cause: the main Apps Script project is attached to a **Standard** GCP project
  (see Apps Script -> Project Settings for its number), not a default one. Apps Script
  auto-enables APIs only in *default* projects. In a Standard project every
  Google API must be enabled manually in Cloud Console before first use —
  Apps Script's auto-enable attempt is denied, and the call fails at runtime.
- Action:
  1. Open `https://console.cloud.google.com/apis/library/<api>.googleapis.com?project=<project number>`
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
  `processBcDrop_v1` loads BC into **Supabase only** (`core/utils.js`).
  Every code reference to `BC_INVOICES` is a read. The sheet has been frozen
  since it was last pasted into manually (~2026-04), so `Build All` just re-reads
  stale data. Separately, the 0.0% web-share columns broke in 2025-09 because
  `SALESPERSON_CODE` stopped mapping when BC moved to SaaS and renamed the header
  (`SALESPERSON_CODE` in `core/schema.js`) — so even pasting fresh data would leave those at 0.
- Why it is safe to leave: the only consumer of these columns is
  `getLiveBcWebShare_` in `webapp.js`, serving `?action=dashboard`, which no
  Webflow page calls. Nothing user-facing depends on them.
- The real BC numbers live in Supabase and are correct: `public.day_kpi_pack`
  (BC fields deliberately nulled for anon), `mart.v_bc_monthly_net_v1`,
  `raw.bc_invoices_raw`. Dashboard BC ratios come from
  `window.STORKAUP_BC_MANUAL`, entered by hand.
- If these columns ever need to be real: repoint the `loadBCMonthly*` family in
  `core/salessummaries.js` at `raw.bc_invoices_raw` via service_role. Do NOT
  reinstate the manual paste — that is assessment item 10 (brittle manual step).

### Issue: OLDWEB `revenue_excl` is not VAT-exclusive revenue — never use it
- Symptom: any web trend spanning the July 2025 headless cutover shows a ~30%
  collapse in revenue and AOV in Sept 2025 that never happened. On
  `revenue_excl`, AOV goes 112k (Jul 2025) → 78k (Sep 2025); on `revenue_incl`
  the same series is flat/rising (101k → 94k → 98k Jul 2026).
- Cause: [core/schema.js](core/schema.js) maps `OLDWEB.SUBTOTAL_EXCL` to the
  Magento 1 grid column **`Subtotal`**, which is *not* the tax-exclusive
  subtotal. It is a gross, pre-adjustment goods figure. `SUBTOTAL_INCL` maps to
  **`Grand Total (Purchased)`**, which *is* the real charged amount.
  NEWWEB is unaffected — it reads an explicitly named
  `Subtotal (Excl Tax)` column ([core/newsales_v2.js:134](core/newsales_v2.js#L134)).
- Proof (measured 2026-08-10 over all 20,980 OLDWEB orders, 2022-04→2025-08):
  - `revenue_excl > revenue_incl` on **65% of OLDWEB orders** — arithmetically
    impossible for a genuine excl/incl pair, since
    `grand_total_incl >= taxable_base * 1.11` always holds.
  - The violation rate is a flat 62–79% in **every one of the 40 months** — it is
    not one bad export batch.
  - Per-order `excl/incl` ranges **0.55–1.85**, so no single correction factor
    fixes it. Clean spikes sit at exactly `1/1.11` (0.901) and `1/1.24` (0.806) —
    those are the zero-adjustment orders where the pair happens to be correct.
  - Decisive test — both systems ran in parallel 2025-07-18 → 2025-08-18, same
    customers, same products, same weeks:

    | Source | orders | excl/incl | rows with excl>incl | AOV incl | AOV excl |
    |---|---|---|---|---|---|
    | OLDWEB | 678 | 1.136 | 66% | 103,121 | 117,130 |
    | NEWWEB | 77 | 0.836 | 0% | 111,059 | 92,841 |

    `AOV incl` is continuous across the cutover (103k vs 111k); `AOV excl` is not
    (117k vs 93k). `revenue_incl` is the comparable series.
- Action:
  1. For any web trend crossing July 2025, use **`revenue_incl`**.
  2. If an excl figure is needed for OLDWEB, derive it: `revenue_incl / 1.196`
     (0.836 is the NEWWEB-measured blended VAT factor). Do not pass the stored
     column through.
  3. `mart.v_web_daily_unified` / `v_web_monthly_unified` / `v_web_orders_unified`
     currently pass the bad column through unchanged.
- ⚠️ `day_kpi_pack` reads `revenue_excl` for its d1/d7 comparisons
  ([core/sql/day_kpi_pack.sql:61](core/sql/day_kpi_pack.sql#L61)). Those windows
  are entirely inside the NEWWEB era, so **live daily cards are correct** — but
  any backfilled daily comparison reaching before 2025-08 is not.
- This is a **different bug** from the BC `amount_excl` zeroing (P9-1, fixed
  2026-05-13). That one was `raw.bc_invoices_raw`; this one is the OLDWEB
  web-order source and is still present.
- Worth adding to `runDailySanityChecks_v1`: assert `revenue_excl <= revenue_incl`
  on any unified web view. Nothing currently catches this class of error.

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
  - If excessive, do **not** change the 5-minute trigger (non-negotiable). Look
    for long-running runs or lock contention instead — `scheduledMagentoSync_v1`
    and other jobs share the script lock.

### Issue: repeated sync failure alerts during transient API outages
- Behavior:
  - `scheduledReferenceSync_v1` and `scheduledCustomerAnalysisSync_v1` wrap their steps in `runWithRetries_` (one retry) before marking the run failed. Other jobs (`scheduledMagentoSync_v1`, Klaviyo, Cludo, …) do not retry.
  - Transient patterns include common `429/5xx/timeout` errors.
- Action:
  1. Keep alert throttles at sane values (example: 60-180 minutes for high-frequency jobs).
  2. Use Apps Script Executions to confirm retries recover before failure.

### Issue: no new rows in `NEWWEB`
- Confirm checkpoint in log.
- If Magento has no newer orders than checkpoint, this is expected.
- Verify latest Magento order timestamp is newer than checkpoint.

### Restoring a priority flag
- `raw.customer_priority_flags_history` (AFTER UPDATE OR DELETE trigger) keeps
  the old row of every update and delete on `raw.customer_priority_flags_raw`:
  `op`, `via_role` (`anon` = a Webflow page, `service_role` = GAS), `old_row` /
  `new_row` jsonb.
- Writers: Webflow `forgangslisti.js`, `customer-profiles.js`, `activation.js`
  via anon RPCs, and `importPriorityFlagsFromSheet_v1` (default `replaceAll`
  deletes all rows first).
- Restore: use the snippet under "ENDURHEIMT" in
  [core/sql/customer_priority_flags_history.sql](core/sql/customer_priority_flags_history.sql)
  (latest `DELETE` row for the customer, `jsonb_populate_record` on `old_row`,
  `on conflict do nothing`). Run it in the Supabase SQL editor — the history
  table is service_role only.
- TRUNCATE is not captured.

## Trigger Baseline

Do not keep a hand list here. `requiredTimeTriggers_()` in
[core/utils.js](core/utils.js) is the source of truth (13 required handlers),
shared by `auditTriggers_v1()` and `resetRecommendedTimeTriggers_v1()`.

Recovering a lost trigger:
1. Run `auditTriggers_v1()`. It logs `[AUDIT][WARN] Missing trigger for: X` per
   missing handler, or `[AUDIT][OK] All 13 required triggers are installed`.
2. Run that handler's own `install*Trigger*` function (listed in
   `requiredTimeTriggers_()`). They are idempotent — `{created:false}` if one
   already exists.
3. `resetRecommendedTimeTriggers_v1()` now removes and reinstalls one handler at
   a time and ends with an audit, so an interruption loses at most one handler.
   It still deletes and recreates `safePoll_v2`, so it is not the first tool to
   reach for.

OPTIONAL handlers are recognised but **never warned about when absent**:
`onOpen`, `pruneCompletedApplications`, `collectInvoicesToDrive_v1`,
`runScheduledSeoAutomation_v1`, `zeroPriceScanFromTrigger_v1`. As of
2026-09-09 neither `collectInvoicesToDrive_v1` nor
`runScheduledSeoAutomation_v1` is installed (see CLAUDE.md).

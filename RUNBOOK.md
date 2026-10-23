# KPI Operations Runbook

## Scope

This runbook covers daily operations for:
- NEWWEB ingestion (Magento orders -> GAS sheet -> Supabase)
- Magento customer sync
- BC import (**manual**: BC Sync menu -> `processBcDrop_v1`, XLSX dropped in Drive by `bc_sync.ps1`). Dashboard monthly BC ratios are entered by hand per month into `raw.bc_manual_monthly` in the Supabase SQL editor (since 2026-10-09, [core/sql/bc_manual_monthly.sql](core/sql/bc_manual_monthly.sql)), read by `public.get_bc_manual_monthly()` for signed-in users only. `window.STORKAUP_BC_MANUAL` in page code is a legacy fallback in `dashboard.js` and must not be on any page.
- Webflow deploy and production pins (see the section of that name below).

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

> **Status: intended design, not verified live.** On 2026-10-20 the 8 pages the
> pin checker scans answered HTTP 200 without credentials and all carried
> `auth.js`, so page code is public. Nobody has yet confirmed against production
> that an unauthenticated or non-allowlisted caller is actually refused by
> Supabase (`kpi_auth_revoke_anon.sql`, the `auth.users` trigger) or by GAS
> (`webflowCaller_`). Treat everything below as how it is meant to work until
> that test is done.

The Webflow folder password was removed 2026-10-09; data access is meant to require a personal Google sign-in instead. `Webflow/auth.js` (site-wide head, pinned) runs the Supabase Auth flow and swaps the anon key for the user's token on every Supabase call; it does nothing on pages without `STORKAUP_CONFIG`. Two gates, both needed:

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
- History: before 2026-10-08 the daily sanity check was the only reader of the
  heartbeat, ran once a day and logged as `warning` (which never emails), so a
  dead order pipeline sent nothing at all.

### 1b) Magento API off switch (since 2026-10-19)
- Hagar are closing the Magento API to allowlisted IPs only (BlockStrap,
  CVE-2026-103849). GAS calls from Google's shifting IPs, so it can never be
  allowlisted directly. The fix under discussion is a proxy with a static IP in
  Hagar's Azure; until then, web orders stop at the cut-off.
- Switch: `SETTINGS.MAGENTO_API_ENABLED = false` in STORKAUP_CONFIG. Every
  Magento entry point then skips quietly (`isMagentoApiEnabled_()` in
  [core/auth.js](core/auth.js)): `safePoll_v2`, the status sync, both customer
  syncs, the live key lookup in application pruning, and pending orders in the
  admin app. The safePoll watchdog stays silent, and the daily check logs a
  `warning` instead of an `error`. **A missing row means on.**
- The switch also pauses `scheduledKlaviyoProfileSync_v1` (since 2026-10-21).
  Once web orders stop, the BC side cannot fill in, because it excludes
  `VEFUR` on purpose. Web customers' last order then freezes, they drift to
  `lapsing`/`lapsed`, and win-back (which reads `stk_customer_state`) would
  email people who are still ordering. Klaviyo keeps the values it had at the
  cut-off.
- **Turning Magento back on?** Run `select mart.refresh_web_bridge_frozen_v1();`
  in Supabase once safePoll has caught up. Since 2026-10-23 the daily web
  totals and first-purchase days read frozen snapshots of the Magento data
  (`core/sql/web_bridge_perf_v1.sql`), because recomputing them on every call
  timed out `day_kpi_pack`. The GA4 bridge skips any order that exists in
  `raw.newweb_orders_raw`, so new Magento orders are missing from the
  dashboard until the snapshot is refreshed.
- Reports that freeze at the cut-off: every SQL reading
  `raw.newweb_orders_raw` (daily dashboard, weekly and monthly digests, web
  records, customer page, graduation, web activation). Only BC-only figures
  keep moving.
- Nothing writes to Magento — only `GET /orders` and `GET /customers/search`,
  plus the admin-token login in `core/auth.js`.

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
- Export a rolling ~3-month window from BC, not full history (decided
  2026-08-31). Nothing schedules this, so **a skipped month is a real gap** in
  `bc_lines_raw`. Three months of overlap is the margin; don't cut it to one.
  - Why not full history: lines are deduped against a 2-year-windowed
    *invoice* key set (`cutoff` in `processBcDrop_v1`, [core/utils.js](core/utils.js)),
    so every line whose invoice predates that window counts as new on every
    run. A full-history export re-sent 217,790 of 484,768 rows per import —
    harmless (`resolution=ignore-duplicates` drops them server-side) but 4m14s
    of the 6-minute execution budget, growing ~6%/month.
- **An interrupted import no longer loses lines (2026-10-09).** Lines are
  filtered on the invoice key set, so a run that uploaded invoices and died
  before finishing the lines file used to drop those invoices' lines for good.
  Script Property `BC_DROP_LINES_OWED` is set before invoices upload and
  cleared when a lines file completes; while set, lines go up unfiltered (safe —
  `ignore-duplicates`). `markBcLinesOwed_v1()` sets it by hand. The daily sanity
  check fails on `bc_freshness` (no successful import in 35 days) and on
  `bc_lines_owed`.
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
3. `auditTriggers_v1()` logs `[AUDIT][OK] All N required triggers are installed` (N = handlers in `requiredTimeTriggers_()`, 16 as of 2026-10-20)
4. Confirm `[SALES_REPS_REF][INFO] Sync completed. Uploaded: N` in Magento/ref sync logs
5. Spot-check one fresh order in `NEWWEB` sheet + frontend

Monthly: someone has run BC Sync -> Importa BC skrár this month (`ingestion_runs`
row with job_name `scheduledBcSync_v1`, trigger_type `drive_drop`), and the BC
drop folder holds no unprocessed XLSX.

## Metric Contract

Dashboard BC cards: monthly cards use net BC figures entered by hand in
`raw.bc_manual_monthly` (formerly `window.STORKAUP_BC_MANUAL`); daily cards use `day_kpi_pack`; the canonical web
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
   meaningful. For BC figures compare against `raw.bc_manual_monthly` or
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
  `raw.bc_manual_monthly`, entered by hand.
- If these columns ever need to be real: repoint the `loadBCMonthly*` family in
  `core/salessummaries.js` at `raw.bc_invoices_raw` via service_role. Do NOT
  reinstate the manual paste — that is assessment item 10 (brittle manual step).

### Not an issue: GA4 `purchases` and `begin_checkout` drop from 2026-10-01
- `scheduledGa4Sync_v1` reads event counts only for `add_to_cart`,
  `begin_checkout` and `purchase` (plus sessions/users/pageviews/eventCount and
  channel). Other GTM changes do not affect the KPIs.
- **GTM v96 (2026-10-01):** `purchase` stopped firing when old orders are
  viewed under Mínar síður. It now fires only after `/afgreida`, once per order
  (localStorage). `purchases` and `ga4_purchase_ratio_7d` drop from that day.
- **GTM v97 (same day):** `begin_checkout` is sent once per visit to
  `/afgreida` (10 min) and drops too.
- Both are corrections, not a collapse. See P8-5–P8-7 in `NEXT_TASKS.md`; GTM
  export in `gtm/`.

### Fixed 2026-10-14: customer-profile BC fields were empty — now computed live
- Symptom (before): on `/kpi/vidskiptavinur` every customer was LHFS `Very High`,
  primary category `Rekstrarvörur`, BC order count 0. Measured: 0 of 6,387 rows
  had LHFS > 0 or `total_bc_orders` > 0.
- Cause: the BC part of `raw.customer_analysis_raw` never loaded. The GAS build
  (`core/customer_analysis.js`) reads BC from Google Sheets via
  `loadSheetObjects_`, which does not normalize headers. `core/schema.js` has
  used ASCII header names since 2026-02-26, and the sheets carry Icelandic ones,
  so every lookup missed. The sheets also froze on 2026-05-25. With every score
  at 0, `cume_dist` ranked them all at 1.0, which is the "Very High" band.
- Fix: [core/sql/customer_profiles_live_bc_v1.sql](core/sql/customer_profiles_live_bc_v1.sql).
  `mart.v_customer_profile_enriched` now computes the BC fields, LHFS,
  recommended action, potential score and primary category from `raw.bc_*_raw`.
  Columns are unchanged, so the views above it and Webflow need no change.
  - LHFS is BC sales **outside the web** over the last 365 d, in m.kr. incl.
    VAT, ×1.5 if the customer has never ordered on the web.
  - `api.v_customer_profiles_labeled` ranks LHFS among positive scores only.
  - Internal accounts are excluded (`internal_accounts` CTE).
  - After the fix: 6,666 rows, 2,097 with LHFS > 0, 210 `Very High`.
- **Freshness follows the BC import** (`processBcDrop_v1`, manual). A skipped
  month shows up as falling scores, not as an error.
- `api.v_customer_segments` (solution pages) reads the same live view, done the
  same day ([core/sql/customer_segmentation.sql](core/sql/customer_segmentation.sql)).
  Category segments split for the first time: office 538, hygiene 438,
  coffee room 286. Before, everything that reached the category rules was
  `office_core_buyers`. `at_risk_declining` takes 4,773 of 6,662 rows because
  it is any customer with no BC invoice in 120 d, long-dormant accounts
  included. That rule did not change, but it is wide.
- The view definitions above `enriched` were not in the repo before this. See
  [core/sql/customer_profiles_views_live.sql](core/sql/customer_profiles_views_live.sql).

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
- Writers: Webflow `vidskiptavinir.js` via RPCs (signed-in user; since
  2026-10-15 `actor_email`/`actor_name` record who), and `importPriorityFlagsFromSheet_v1` (default `replaceAll`
  deletes all rows first).
- Restore: use the snippet under "ENDURHEIMT" in
  [core/sql/customer_priority_flags_history.sql](core/sql/customer_priority_flags_history.sql)
  (latest `DELETE` row for the customer, `jsonb_populate_record` on `old_row`,
  `on conflict do nothing`). Run it in the Supabase SQL editor — the history
  table is service_role only.
- TRUNCATE is not captured.

## Trigger Baseline

Do not keep a hand list here. `requiredTimeTriggers_()` in
[core/utils.js](core/utils.js) is the source of truth (16 required handlers as
of 2026-10-20), shared by `auditTriggers_v1()` and
`resetRecommendedTimeTriggers_v1()`. `ARCHITECTURE.md` → *Scheduled triggers*
has a readable copy; when the two disagree, the code wins.

Recovering a lost trigger:
1. Run `auditTriggers_v1()`. It logs `[AUDIT][WARN] Missing trigger for: X` per
   missing handler, or `[AUDIT][OK] All N required triggers are installed`.
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
2026-09-09 neither `collectInvoicesToDrive_v1` (the Gmail → Drive invoice
collector, mapped as "daily ~07:10") nor `runScheduledSeoAutomation_v1`
("every 30 min, install on demand") is installed, so both run only when
someone clicks.
- If the invoice collector is meant to be daily, run
  `installInvoiceCollectorTrigger_v1` ([core/invoices.js](core/invoices.js))
  once — it is idempotent.
- `runScheduledSeoAutomation_v1` is deliberately hand-run: SEO batches are
  reviewed in the sheet before anything ships, so a schedule would not help.

### Trigger history (why the rules above exist)
- **Four triggers lost ~2026-05-07..11, found 2026-08-06:** Klaviyo, Customer
  Analysis, Cludo, Search Console. Nobody noticed for three months because
  `auditTriggers_v1`'s map was wrong in five places and missing five handlers,
  so its real warnings were buried in false ones. A job whose sub-step fails
  now records `partial`, not `success`, and sends an ops alert.
- **The reset deleted three triggers for good** until 2026-10-08:
  `resetRecommendedTimeTriggers_v1()` removed thirteen handlers and reinstalled
  ten — Cludo, CustomerAnalysis and Klaviyo were never put back. The bug came
  in with `542ab7d` (2026-05-11), the same window in which exactly those went
  missing. Audit and reset now share `requiredTimeTriggers_()`.
- **The monthly digest was dead code until 2026-09-01.** `scheduledMonthlyDigest`
  ([core/email.js](core/email.js)) and its installer existed, but nothing called
  `installMonthlyDigestTrigger_v1()` and the audit listed the handler as
  OPTIONAL, so its absence was never warned about. It is now required.
- **BC has no trigger.** `scheduledBcSync_v1` was deleted 2026-04-30
  (`d83c7c5`); docs listed it as "twice daily" for three months afterwards.
- Last full verification on record: `auditTriggers_v1` on 2026-09-09 returned
  `[AUDIT][OK] All 13 required triggers are installed` (16 triggers total).
  Three required handlers have been added since (Klaviyo profile sync, Cludo
  cleanup, lagersala) — re-run the audit rather than trust that result.

## Webflow deploy and production pins

**The pin values themselves live in `CLAUDE.md` → *Current production pins*,
and only there** — `tools/check-webflow-pins.js` parses that section, so it
cannot move. This section explains how the pins work and why.

### Deploy steps
A Webflow change takes **two commits**. A pin can only point at a commit that
already exists on GitHub, so the source goes first and the pin table follows
once the new pin is live.

1. `node --check Webflow/<file>.js`.
2. **If GAS code changed too, run `.\gas_deploy.ps1 "desc"` first**, before
   the first commit — same order as the normal deploy (`/deploy`). Its pin check
   at the end runs before the commit and before anything in Webflow changes, so
   it can only show the old live pin, and its freshness test (`git log`) cannot
   see the uncommitted change. Do not take the new value from it.
3. **First commit: stage the changed files by name, commit, push.** Note the
   SHA — it is the new pin, since jsDelivr serves `@<sha>` from GitHub.
4. **Update and publish the Webflow pin.** Move only the pin that governs the
   changed file (see *Which pin governs what* below): site-wide custom code for
   `data-storkaup-rev`, the bootstrap `src` tags and `auth.js`; page head code
   for an independently pinned page file. Publish the site.
5. **Update the table in `CLAUDE.md`** → *Current production pins* to the SHA
   from step 3. For an independently pinned file, also update its mirror in
   `Webflow/<page>-embed.html`. The check compares that file against the table.
6. **Run `node tools/check-webflow-pins.js`**, now that both the live site and
   the table carry the new pin. Expect `í lagi` on every row, the freshness
   check passing, and no `?`/`FANNST EKKI`/`ÓATHUGAÐUR` lines you cannot
   explain. If the table and site disagree, find out which is right before
   changing either.
7. Hard-refresh and smoke-test the affected pages.
8. **Commit and push the documentation update** (`CLAUDE.md`, plus the
   `*-embed.html` mirror). Do not put any `Webflow/*.js` change in this
   commit. If you do, the pin from step 3 no longer contains the newest change
   to that file, and the freshness check fails.

URL pattern: `https://cdn.jsdelivr.net/gh/OlafurOrnJosephsson/storkaup_kpi@<commit>/Webflow/<file>.js`.
Always an immutable commit, never `@main`: a mutable branch would let a
compromised repo inject straight into the KPI pages.

### Which pin governs what
- **`data-storkaup-rev`** governs the bootstrap's child files. The bootstrap
  scripts read it off their own `<script>` tag and load every child from that
  revision (`getRevision()` in both bootstraps). Changing it moves
  `dashboard.js`, `order-search.js`, `website-dashboard.js` and
  `dashboard-theme.css` together. There is no per-file control for those.
- All three bootstrap pins live in **one place** — Webflow *site-wide* custom
  code, two `<script>` tags that carry both the `@commit` in `src` and the
  `data-storkaup-rev` attribute. (Older docs said the attribute was bumped on
  every KPI page; that was never how it worked.)
- **Independent pins** — bumping `data-storkaup-rev` does nothing to these, and
  bumping them does nothing to the dashboards:

  | File | Where its pin lives | Page |
  |---|---|---|
  | `Webflow/auth.js` | **site-wide head**, synchronous (no `defer`) — must run before every other script so its fetch wrapper is in place | all KPI pages; inert where `STORKAUP_CONFIG` is absent |
  | `Webflow/vidskiptavinir.js` | page head code — mirrored in `vidskiptavinir-embed.html`, whose Embed part is the mount `<div>` only | `/kpi/vidskiptavinur` (since 2026-10-15; `-nyr` 301s there) |
  | `Webflow/vorur.js` | page head code — mirrored in `vorur-embed.html`, whose Embed part is the mount `<div>` only | `/kpi/vorur` (since 2026-10-16) |

  A new independently pinned file must be registered in **both** `EMBED_PINNED`
  in the tool and the table in `CLAUDE.md`; the tool complains when it is in
  neither.
- **When to change a pin:** only when a file under `Webflow/` actually changes.
  The pin freezes content; it does not track HEAD. Re-pinning to a newer commit
  with identical bytes only busts caches and makes the table misreport when the
  frontend last changed. When the bootstrap files themselves did not change,
  record a `src` move as "pin only" (check with
  `git diff --stat <old> <new> -- Webflow/*-bootstrap.js`).

### What the check tool does
`node tools/check-webflow-pins.js` reads the live pins off the site and does two
separate things: compares live against the `CLAUDE.md` table, **and**
independently checks that the live rev contains the newest commit touching the
files the bootstrap loads. The second test is the one that matters — the table
and the site can agree and both be wrong. It also fails if `gasKey`,
`STORKAUP_BC_MANUAL` or `EXEC_URL` appear on a scanned page (`NEVER_PUBLIC`).
Scanned pages are `/`, `/kpi/umsoknir` and every `/kpi/` link in the home-page
nav. That was 8 pages on 2026-10-20, all HTTP 200 without credentials. The scan
is a string match: it does not test that sign-in actually blocks data access,
and it skips pages that are not linked from the nav.
Independent pins are read off those same pages; a page
missing from the nav prints `ÓATHUGAÐUR`. Locally it checks that each
`*-embed.html` and the table agree, and that the pin contains the newest commit
touching the file — the realistic mistake (change the file, forget the pin).

### Hardcoded fallbacks
Used only if `data-storkaup-rev` is missing from the tag. Both bootstraps carry
a "Keep in sync with CLAUDE.md pins" comment.

| File | Fallback | Date |
|---|---|---|
| `dashboard-bootstrap.js` | `2458fc5` | 2026-06-30 |
| `website-dashboard-bootstrap.js` | `53b118c` | 2026-06-29 |

The two differ from each other and both lag the live rev, so if the attribute
were dropped, `/kpi/dashboard` and the website dashboard would load different
vintages. Bumping them is circular — the fallback lives *inside* the bootstrap,
so changing it changes that file's bytes and forces the `src` pins to move too.
Left deliberately as a last-resort floor, not a mirror.

### Page consolidation (2026-10-15/16)
- **One customer page:** `vidskiptavinir.js` on `/kpi/vidskiptavinur` replaced
  `customer-profiles.js` (a bootstrap child that loaded on *every* KPI page,
  117 KB), `forgangslisti.js` and `activation.js`. `/kpi/forgangslisti`,
  `/kpi/activation` and `/kpi/emails` were deleted 2026-10-15. Tabs:
  `?tab=vinnulisti`, `?tab=taekifaeri`. Data layer:
  `core/sql/vidskiptavinir_v1.sql`, `customer_not_web_v1.sql`,
  `kpi_staff_rep_v1.sql`. Its `<script src>` sits in page head code only; it
  guards against double boot (`data-booted`), but one tag is still the rule.
- **One product page:** `vorur.js` on `/kpi/vorur` replaced `/kpi/top-products`
  (`top-products.js`, a bootstrap child), `/kpi/voruuppfletting` (`lookup.js`)
  and `/kpi/voruportal` (`portal.js`); pages and files removed the same day.
  `?tab=listi` is the list lookup, `?sku=` the product card. Before
  `top-products.js` came out of `dashboard-bootstrap.js`, every nav page was
  checked live for `[data-module="top-products"]`; the site-wide tags moved to
  `1b08cff` the same day.

### Pin incidents (why the rules above exist)
- **2026-09-21 — a stale table rolled production back.** The table read
  `4131408` while the site served `5368032`. A warning written *from the table*
  concluded the site was behind, so the live pin was rolled back to `4131408`
  and the `/kpi/top-products` drawer fix (`2d50477`) dropped out of production.
  Restored the same day. Lesson: a stale table reads exactly like a current
  one, so when table and site disagree, find out which is right before changing
  either.
- **Unregistered embed pins.** Until 2026-09-21 the docs said `lookup.js` was
  the only independent pin; `activation.js` had been pinned in page code since
  2026-06-15, and `portal.js` in `portal-embed.html`, neither recorded. The tool
  hard-coded the same assumption, which is why `EMBED_PINNED` now exists.
- **Stale values before `6c992c5`** (`aff3278`, `df2956f`, `b55e8c4`): the deploy
  had moved to `6c992c5` on 2026-07-14 and the table was not updated.
- `4131408` (Klaviyo insights block) fixed `klaviyo-last-sync-date` printing
  today's date unconditionally (now `max(order_date)`), and an `init()` guard
  that left a stripped-down `/kpi/klaviyo` blank (now also accepts
  `hasKlaviyoMetricTargets()`).

### Reference baselines
Not deploy pins — historical anchors for comparison: trigger schedule
`ab2931a`; parent/child profile aggregation `ab0aafd`; parent/child last-orders
merge `ca32334`.

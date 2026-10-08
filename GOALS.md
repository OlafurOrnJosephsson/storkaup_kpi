# KPI Goals

Updated: 2026-10-08

## Staða 2026-10-08

Goals below are unchanged; this note records what the repo actually covers now and which open items touch them.

- **Scope is wider than BI.** Three parts:
  1. BI dashboards (Webflow `/kpi/*` reading Supabase).
  2. A sales worklist: the new `forgangslisti.js` runs on `/kpi/forgangslisti` (swap done 2026-10-08, P11-7), with `customer-profiles.js` `?customer=` deep links. This is the North Star line about Forgangslisti and Customer Profiles.
  3. PIM / vöruinnihald: `pim/*.js` (pushed with the main project), the admin vöruinnihald app, Plytix export/import, and `raw.web_catalog` (synced every 12h).
- **The frontend writes data.** `forgangslisti.js`, `customer-profiles.js` and `activation.js` call the priority-flag RPCs (set flag, assign rep, log touch, bulk ops). Since 2026-10-08 every update/delete of a flag row is kept in `raw.customer_priority_flags_history` (P11-4). Access posture: see the security review (kept outside git).
- **`/kpi/activation`** works since 2026-10-08 but is unfinished and unlinked (P11-8): June-era nav, not in the sidebar, and it writes priority flags without a touch log; direction (targeting view vs. fold into the forgangslisti) is open. Relates to the self-service goal — 714 customers with web access have never ordered.
- **Security item #9 (anon read RPCs):** digest RPCs `weekly/monthly_digest_stats` are service_role only (P11-5). Three other anon-readable RPCs stay blocked on the auth migration (P11-6).
- **BC freshness:** BC has no trigger; it loads only when someone runs the BC Sync menu, from a rolling ~3-month export. A skipped month is a real gap in `bc_lines_raw`, which affects the BC web-share goal.
- **Triggers:** 13 required handlers, defined once in `requiredTimeTriggers_()` (`core/utils.js`) and shared by `auditTriggers_v1` and the reset. Optional and not installed: `collectInvoicesToDrive_v1`, `runScheduledSeoAutomation_v1`.

## North Star

- Increase total sales, with a clear bias toward growing web-driven revenue.
- Raise web share of BC sales over time:
  - more orders placed through the web
  - more revenue flowing through the web
- Move as many customers as possible into self-service where it makes commercial sense.
- Reduce avoidable manual order handling so sales reps spend more time on selling, onboarding, and account growth.
- Use Forgangslisti and Customer Profiles to identify the best customers to migrate from manual ordering to repeat web ordering.

## Stable Now

- Webflow dashboards load and read current Supabase RPC/view data.
- Daily dashboard live mode uses Reykjavik day calculation instead of raw UTC rollover.
- Dashboard month dropdown is automated and always defaults to current month.
- BC monthly web-share cards match Supabase net BC math:
  - `Vefpantanir % af heildarsolu`
  - `Vefsala % af heildarsolu`
- Customer Profiles / Forgangslisti is materially more usable:
  - faster initial render
  - global loader in place
  - freshness message routed into `.alertbanner`
  - priority CTA states are dynamic
  - sales rep CTA states are dynamic
  - sales rep assignment auto-creates missing priority rows
- Trigger schedule is now codified in Apps Script instead of being implicit UI state.
- Magento 2FA handled in `scheduledMagentoSync_v1`.
- BC `booking_date` synced by `processBcDrop_v1` (BC Sync menu) from XLSX dropped in Drive by `bc_sync.ps1`; rolling ~3-month export. `scheduledBcSync_v1` was deleted 2026-04-30 — BC has no trigger.
- `safePoll_v2` and staggered trigger schedule validated over 6+ weeks. Since 2026-10-08 `safePoll_v2` has a heartbeat watchdog: `checkSafePollWatchdog_()` runs hourly inside `scheduledMagentoSync_v1` and emails if stale.
- Daily sanity checks (`runDailySanityChecks_v1`) running without false positive noise; a stale `safePoll_v2` heartbeat is reported as an error.
- Caveat: four triggers (Klaviyo, Customer Analysis, Cludo, Search Console) sat uninstalled from around 2026-05-07..11 to 2026-08-06 unnoticed. `auditTriggers_v1` confirmed all 13 required triggers on 2026-09-09.
- Klaviyo attribution live: sync running, attribution mart in Supabase, KPI widgets at `/kpi/klaviyo`.
- Website dashboard (GA4) phase 1 live in Webflow.
- SEO manager phase 1 live: queue-driven Icelandic copy generation via `SETTINGS.SEO_PROVIDER` (Gemini by default; Claude or OpenAI selectable); images use OpenAI.
- Unified order search live: SR/SK/WEB orders searchable by company name, kennitala, order ID, SP-nr; results rendered as `data-*` attributes for Webflow design control.
- BC upsert no longer overwrites `amount_excl` with 0; `order_no` (SP-nr) now synced per invoice.
- `processBcDrop_v1` writes the BC ingestion_run (name kept as `scheduledBcSync_v1`, trigger_type `drive_drop`), so "Uppfært" moves only when someone runs the BC Sync menu.
- Web-app surface hardened + split (2026-07-02): applicant PII apps (umsókn, vöruvöktun/listaverð; vöruinnihald added later) moved to a separate `admin/` GAS project behind @storkaup.is login + allowlist; anonymous deployment no longer serves any HTML app or PII. Typeform webhook token-checked; dashboard/badge/cache-help API key fail-closed + rate-limited; Webflow secrets moved off the site-wide (gate-visible) custom code onto page-scoped code.

## Non-Negotiables

- Do not break `safePoll_v2` 5-minute cadence.
- Keep applicant PII behind login: the anonymous main web app must **not** serve HTML apps or PII (no `?app=` HTML routes). The umsókn/vöruvöktun/vöruinnihald apps stay in the `admin/` project with `access: DOMAIN` + `ADMIN_APP_EMAILS` — do not switch to `ANYONE` (ties auth to the governed company Workspace; matches the security assessment).
- Do not put secrets (`gasKey`, BC manual figures) in Webflow **site-wide** custom code — it renders on the unauthenticated password-gate page. Keep them page-scoped on the KPI pages.
- Do not change BC share logic casually:
  - monthly cards use net BC
  - daily cards use `day_kpi_pack`
  - canonical BC web tagging remains `salesperson_code = 'VEFUR'` with historical `CO22-*` fallback only where already defined
- Do not reintroduce runtime-heavy BC date parsing in `day_kpi_pack`.
- Keep Webflow pages resilient if a secondary RPC fails; primary dashboard should still render.
- Never include `amount_excl` in BC invoice/credit invoice upsert payloads — the BC sheets do not have that column and it will overwrite with 0.

## Watch Items

- ~~`scheduledCustomerAnalysisSync_v1` has historically high error rate; consider disabling if low-value.~~ Decided (P10-2): kept — 0% error rate, feeds `mv_customer_profiles_labeled_trends`; now a required trigger.
- Klaviyo sync (`scheduledKlaviyoSync_v1`) checkpoint stability — watch for drift or missed events. Note: the trigger sat uninstalled from around 2026-05-07..11 to 2026-08-06; the sync resumes from its checkpoint, so whether that period was fully back-filled is unverified. It is now in the required trigger audit.
- ~~`webRevenuePct` currently broken (amount_excl zeroed by backfill on 2026-05-01) — pending P9-1 SQL restoration.~~ Done 2026-05-13 (P9-1, P9-2).
- ~~`Sala frá Klaviyo með vsk` shows `–` on `/kpi/klaviyo` — likely null `revenue_incl` in `newweb_orders_raw`; pending P5-6.~~ Done (P5-6).
- ~~GA4 purchase ratio (`ga4_purchase_ratio_7d`) not yet validated post-GTM fix — blocks funnel metrics (P8-2, P8-3).~~ P8-2 done; P8-3 dropped. From 2026-10-01 (GTM v96/v97) `purchase` and `begin_checkout` count lower — a correction, not a collapse.
- Datepicker styling is heavily overridden; if Webflow global input styles change, re-check focus/active states.

## Next Practical Improvements

In rough priority order:

1. ~~**Restore `amount_excl` in Supabase** (P9-1)~~ — Done 2026-05-13.
2. ~~**Validate GA4 purchase ratio** (P8-2)~~ — Done. Website dashboard phase 2 scope is still open as P6-4.
3. ~~**Fix Klaviyo revenue display** (P5-6)~~ — Done.
4. **Decide SEO phase 2** (P7-2) — Prismic API integration vs. keep manual copy/paste; scoping decision only. Still open.
5. ~~**Confirm ALERT_EMAILS is configured** (P10-1)~~ — Done 2026-05-13.
6. ~~**Disable or fix `scheduledCustomerAnalysisSync_v1`** (P10-2)~~ — Decided: kept.
7. ~~**Add trigger audit function** (P10-3)~~ — Done: `auditTriggers_v1()`.
8. ~~**Turn off DEBUG flags** (P10-4)~~ — Done: `DEBUG = false` in both files.
9. **Lock down anon read RPCs with PII** (security) — `search_orders`, `get_customer_last_orders`, `get_customer_profile_family_summary` etc. are still executable by `anon`. Needs the auth migration / DataBricks-sourced rebuild before they can be closed without breaking dashboards. Progress 2026-10-08: digest RPCs closed (P11-5); others blocked on the auth migration (P11-6).
10. **Pin `oauthScopes`** (security, low priority / careful) — Partly done: the main `appsscript.json` declares explicit scopes since 2026-07-13, but they are the previously auto-detected set, not least privilege. Narrowing is still open; re-authorize and watch Executions immediately — a missing scope can break triggers incl. `safePoll_v2`.
11. **Move Webflow site to a company-owned workspace** (governance, key-person risk — assessment items 6/7) — the Stórkaup site lives in a personal "Olafur's Workspace" (Freelancer plan) alongside a personal site; billing email is `vefur@storkaup.is` (fine) but the workspace ownership is personal. Transfer the site into a company Webflow workspace with a second admin + company payment method. Bigger op (site transfer + re-auth of custom-code deploys); IT/decision item, not urgent.

## Trigger Intent

- `safePoll_v2`: every 5 minutes
- BC: no trigger — manual via BC Sync menu (`processBcDrop_v1`)
- `scheduledMagentoSync_v1`: hourly
- `scheduledKlaviyoSync_v1`: every 15 minutes
- `runDailySanityChecks_v1`: morning, after early ingest jobs

Full list (13 required handlers): `requiredTimeTriggers_()` in `core/utils.js`.

Recommended entrypoints:

- `auditTriggers_v1()` first — it checks installed triggers against that list.
- Missing one: run its idempotent `install*Trigger*` function.
- `resetRecommendedTimeTriggers_v1()` only for a full rebuild.

## If Something Looks Wrong

1. Check Apps Script `Executions`.
2. Check trigger list still matches intended cadence.
3. Verify Supabase directly before blaming Webflow.
4. Compare raw / net numbers before assuming dashboard math is broken.

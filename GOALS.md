# KPI Goals

Updated: 2026-05-02

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
- BC `booking_date` synced through `scheduledBcSync_v1`.
- `safePoll_v2` and staggered trigger schedule validated over 6+ weeks.
- Daily sanity checks (`runDailySanityChecks_v1`) running without false positive noise.
- Klaviyo attribution live: sync running, attribution mart in Supabase, KPI widgets at `/kpi/klaviyo`.
- Website dashboard (GA4) phase 1 live in Webflow.
- SEO manager phase 1 live: queue-driven Icelandic copy generation via OpenAI.
- Unified order search live: SR/SK/WEB orders searchable by company name, kennitala, order ID, SP-nr; results rendered as `data-*` attributes for Webflow design control.
- BC upsert no longer overwrites `amount_excl` with 0; `order_no` (SP-nr) now synced per invoice.
- `runPostBcImportSync_v1` restores `scheduledBcSync_v1` ingestion_run → "Uppfært" timestamp stays current.
- Web-app surface hardened + split (2026-07-02): applicant PII apps (umsókn, vöruvöktun) moved to a separate `admin/` GAS project behind @storkaup.is login + allowlist; anonymous deployment no longer serves any HTML app or PII. Typeform webhook token-checked; dashboard/badge/cache-help API key fail-closed + rate-limited; Webflow secrets moved off the site-wide (gate-visible) custom code onto page-scoped code.

## Non-Negotiables

- Do not break `safePoll_v2` 5-minute cadence.
- Keep applicant PII behind login: the anonymous main web app must **not** serve HTML apps or PII (no `?app=` HTML routes). The umsókn/vöruvöktun apps stay in the `admin/` project with `access: DOMAIN` + `ADMIN_APP_EMAILS` — do not switch to `ANYONE` (ties auth to the governed company Workspace; matches the security assessment).
- Do not put secrets (`gasKey`, BC manual figures) in Webflow **site-wide** custom code — it renders on the unauthenticated password-gate page. Keep them page-scoped on the KPI pages.
- Do not change BC share logic casually:
  - monthly cards use net BC
  - daily cards use `day_kpi_pack`
  - canonical BC web tagging remains `salesperson_code = 'VEFUR'` with historical `CO22-*` fallback only where already defined
- Do not reintroduce runtime-heavy BC date parsing in `day_kpi_pack`.
- Keep Webflow pages resilient if a secondary RPC fails; primary dashboard should still render.
- Never include `amount_excl` in BC invoice/credit invoice upsert payloads — the BC sheets do not have that column and it will overwrite with 0.

## Watch Items

- `scheduledCustomerAnalysisSync_v1` has historically high error rate; consider disabling if low-value.
- Klaviyo sync (`scheduledKlaviyoSync_v1`) checkpoint stability — watch for drift or missed events as it ages past 6 weeks.
- `webRevenuePct` currently broken (amount_excl zeroed by backfill on 2026-05-01) — pending P9-1 SQL restoration.
- `Sala frá Klaviyo með vsk` shows `–` on `/kpi/klaviyo` — likely null `revenue_incl` in `newweb_orders_raw`; pending P5-6.
- GA4 purchase ratio (`ga4_purchase_ratio_7d`) not yet validated post-GTM fix — blocks funnel metrics (P8-2, P8-3).
- Datepicker styling is heavily overridden; if Webflow global input styles change, re-check focus/active states.

## Next Practical Improvements

In rough priority order:

1. **Restore `amount_excl` in Supabase** (P9-1) — run the two-step SQL (bc_lines_raw sum, fallback amount_incl/1.24); `webRevenuePct` is broken until this is done.
2. **Validate GA4 purchase ratio** (P8-2) — check `ga4_purchase_ratio_7d` sanity result; unblocks funnel metrics and website dashboard phase 2.
3. **Fix Klaviyo revenue display** (P5-6) — trace null `revenue_incl` in `newweb_orders_raw`; probably missing field in Magento sync mapping.
4. **Decide SEO phase 2** (P7-2) — Prismic API integration vs. keep manual copy/paste; scoping decision only.
5. **Confirm ALERT_EMAILS is configured** (P10-1) — verify failure alerts actually deliver.
6. **Disable or fix `scheduledCustomerAnalysisSync_v1`** (P10-2) — reduce noisy failures if truly low-value.
7. **Add trigger audit function** (P10-3) — one-shot menu item to print active trigger schedule.
8. **Turn off DEBUG flags** (P10-4) — `Webflow/dashboard.js` and `Webflow/website-dashboard.js` have `DEBUG = true`.
9. **Lock down anon read RPCs with PII** (security) — `search_orders`, `get_customer_last_orders`, `get_customer_profile_family_summary` etc. are still executable by `anon`. Needs the auth migration / DataBricks-sourced rebuild before they can be closed without breaking dashboards.
10. **Pin `oauthScopes`** (security, low priority / careful) — main `appsscript.json` relies on auto-scopes. Pin an explicit least-privilege list, but re-authorize and watch Executions immediately — a missing scope can break triggers incl. `safePoll_v2`. Deferred until everything else is stable.
11. **Move Webflow site to a company-owned workspace** (governance, key-person risk — assessment items 6/7) — the Stórkaup site lives in a personal "Olafur's Workspace" (Freelancer plan) alongside a personal site; billing email is `vefur@storkaup.is` (fine) but the workspace ownership is personal. Transfer the site into a company Webflow workspace with a second admin + company payment method. Bigger op (site transfer + re-auth of custom-code deploys); IT/decision item, not urgent.

## Trigger Intent

- `safePoll_v2`: every 5 minutes
- `scheduledBcSync_v1` / `runPostBcImportSync_v1`: twice daily, morning and early afternoon
- `scheduledMagentoSync_v1`: hourly
- `scheduledKlaviyoSync_v1`: every 15 minutes
- `runDailySanityChecks_v1`: morning, after early ingest jobs

Recommended reset entrypoint:

- `resetRecommendedTimeTriggers_v1()`

## If Something Looks Wrong

1. Check Apps Script `Executions`.
2. Check trigger list still matches intended cadence.
3. Verify Supabase directly before blaming Webflow.
4. Compare raw / net numbers before assuming dashboard math is broken.

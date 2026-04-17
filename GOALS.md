# KPI Goals

Updated: 2026-04-17

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
- Dashboard month dropdown is automated (no manual selection needed).
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

## Non-Negotiables

- Do not break `safePoll_v2` 5-minute cadence.
- Do not change BC share logic casually:
  - monthly cards use net BC
  - daily cards use `day_kpi_pack`
  - canonical BC web tagging remains `salesperson_code = 'VEFUR'` with historical `CO22-*` fallback only where already defined
- Do not reintroduce runtime-heavy BC date parsing in `day_kpi_pack`.
- Keep Webflow pages resilient if a secondary RPC fails; primary dashboard should still render.

## Watch Items

- `scheduledCustomerAnalysisSync_v1` has historically high error rate; consider disabling if low-value.
- Klaviyo sync (`scheduledKlaviyoSync_v1`) is new — watch first weeks for checkpoint drift or API rate errors.
- Website dashboard (`website_kpi_pack` RPC) is new — watch for cold-start latency on first load.
- Datepicker styling is heavily overridden; if Webflow global input styles change, re-check focus/active states.

## Next Practical Improvements

- Investigate `Sala frá Klaviyo með vsk` showing `–` on `/kpi/klaviyo` (likely null `revenue_incl` in `newweb_orders_raw`).
- Validate website dashboard in production; define phase 2 scope.
- Decide SEO manager phase 2: Prismic API write vs manual copy/paste workflow.
- Decide whether `scheduledCustomerAnalysisSync_v1` is truly needed daily; disable if low-value and noisy.
- Add a tiny trigger audit function that logs current trigger schedules in one place.
- Clean remaining mojibake / encoding leftovers in older GAS docs and utility logs.

## Trigger Intent

- `safePoll_v2`: every 5 minutes
- `scheduledBcSync_v1`: twice daily, morning and early afternoon
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

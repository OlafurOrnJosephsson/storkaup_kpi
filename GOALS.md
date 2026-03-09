# KPI Goals

Updated: 2026-03-09

## Stable Now

- Webflow dashboards load and read current Supabase RPC/view data.
- Daily dashboard live mode uses Reykjavik day calculation instead of raw UTC rollover.
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

## Non-Negotiables

- Do not break `safePoll_v2` 5-minute cadence.
- Do not change BC share logic casually:
  - monthly cards use net BC
  - daily cards use `day_kpi_pack`
  - canonical BC web tagging remains `salesperson_code = 'VEFUR'` with historical `CO22-*` fallback only where already defined
- Do not reintroduce runtime-heavy BC date parsing in `day_kpi_pack`.
- Keep Webflow pages resilient if a secondary RPC fails; primary dashboard should still render.

## Watch Items

- `scheduledCustomerAnalysisSync_v1` should be watched after trigger reset because it previously showed a high error rate.
- `scheduledMagentoSync_v1` had historical failures; check after one business day that the new schedule is calm.
- Samsung / native TV browser should be observed one morning to confirm live day rollover is now correct.
- Datepicker styling is now heavily overridden; if Webflow global input styles change, re-check focus/active states.

## Next Practical Improvements

- Add one lightweight operational status view:
  - last successful run per critical trigger
  - rows processed
  - stale warning if BC / Magento / safePoll fall behind
- Clean remaining mojibake / encoding leftovers in older GAS docs and utility logs.
- Decide whether `scheduledCustomerAnalysisSync_v1` is truly needed daily; disable if low-value and noisy.
- Add a tiny trigger audit function that logs current trigger schedules in one place.

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

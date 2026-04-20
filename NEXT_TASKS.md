# KPI Project Next Tasks

## Recent Release Notes

- Top products page fixed:
  - `api.v_top_products_master` og `api.v_category_master` voru að timeouta (57014) við REST API köll
  - Búið til `mart.mv_top_products_master` og `mart.mv_category_master` (pre-computed)
  - api views beinast nú að MVum; refresh keyrður off-peak í `refreshSupabaseMarts_v1`

- Website dashboard (GA4) added:
  - `Webflow/website-dashboard.js` + `website-dashboard-bootstrap.js` live
  - date picker and month dropdown automated
  - calls `website_kpi_pack` RPC
- SEO manager phase 1 shipped:
  - reads SEO queue from Google Sheets, generates Icelandic copy via OpenAI
  - writes suggestions back to sheet for manual review before Prismic paste
  - dead code trimmed, sheet write performance fixed
- Magento 2FA added to `scheduledMagentoSync_v1`
- BC `booking_date` field now synced via `scheduledBcSync_v1`
- Klaviyo sync GAS side complete:
  - `scheduledKlaviyoSync_v1` implemented with incremental checkpoint
  - attribution mart SQL written (`mv_klaviyo_attribution_daily`, `mv_klaviyo_attribution_daily_nobot`, last-click 30-day window)
  - Klaviyo sanity check (`klaviyo_orders_le_web_orders_30d`) wired into `runDailySanityChecks_v1`
- Priority list frontend stabilized:
  - fixed initial load mapping so `Forgangslisti` + `Onboarding status` render immediately
  - added chip alias normalization (`data-chip`) for Icelandic/canonical values
  - reduced flagged bootstrap chunk size to prevent intermittent initial `500` timeouts
- Dashboard hardening:
  - live daily dashboard now uses Reykjavik date instead of raw UTC rollover
  - datepicker and text-input states moved under shared CSS control
- Trigger schedule codified in Apps Script:
  - `safePoll_v2` installer added (every 5 minutes)
  - `scheduledBcSync_v1` staggered to twice daily
  - reset helper added for recommended trigger schedule
- BC ratio alignment (commit `6617e82`):
  - `dashboard_compat` notar nú fyrri lokaðan mánuð fyrir `webOrdersPct` / `webRevenuePct` (bc_ratio_ctx CTE)
  - Mars 2026: webRevenuePct 36.4% ≈ Power BI 36.5% ✓
  - `bcRatioMonth` bætt í JSON; dashboard sýnir "mars 2026" label
  - BC sync anchor (`ingestion_runs`) heldur áfram að geyma `bcAsOf`
  - Þekkt takmörkun: BC invoicing lag gerir live mid-month % ógerlegt; Power BI er primary source fyrir mánaðarlegar KPI tölur; DataBricks/BC cloud lausn í horisonti
  - `BC_CREDIT_INVOICES` schema fær `ORDER_DATE`; credit invoice mapping leiðrétt í `upsertBcCreditInvoicesToSupabase_`

## Priority 1 - Stabilize Operations

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P1-1 | Freeze current prod script pins (Webflow/jsDelivr commit IDs) and document them | Olafur | Done | Production pin section added to `README.md`; pins tracked in docs and Webflow custom code |
| P1-2 | Add quick runbook for daily operations (`safePoll_v2`, `scheduledMagentoSync_v1`, `scheduledBcSync_v1`) | Olafur | Done | `RUNBOOK.md` added; core function guidance and failure playbook documented |
| P1-3 | Add Apps Script failure alerting for key triggers | Olafur | Done | `notifyTriggerFailure_` wired for key scheduled triggers + `safePoll_v2`; configure `ALERT_EMAILS` in Script Properties |
| P1-4 | Keep `safePoll_v2` + new staggered trigger schedule validated for 7 days | Olafur | Done | `safePoll_v2` continues at 5-minute cadence; BC / Magento / sanity jobs run in intended windows without repeated overlap failures |

## Priority 2 - Data Quality and Consistency

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P2-1 | Move parent/child customer ID logic into Supabase SQL layer (not just frontend) | Olafur | Done | Family logic moved to SQL via `api.resolve_customer_family_ids` and `api.get_customer_profile_family_summary`; selected profile totals now come from RPC instead of frontend-only aggregation |
| P2-2 | Update `api.get_customer_last_orders` to support family IDs directly | Olafur | Done | `api.get_customer_last_orders` now resolves family IDs in SQL; child/parent parity verified in Supabase and Webflow |
| P2-3 | Add daily data sanity check query (BC vs web share, ingestion row counts) | Olafur | Done | `runDailySanityChecks_v1` implemented and scheduled; observation window elapsed with no false positive alerts |

## Priority 3 - Performance

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P3-1 | Dashboard: reduce redundant RPC calls and keep cache hit ratio high | Olafur | Done | 10-min client cache added for `fetchBcSyncStatus`, `fetchWebBookingReconciliationSummary`, `fetchKlaviyoAttributionSummary` — reduces repeated calls on 2-min setInterval |
| P3-2 | Run heavy mart refresh (`top_products_all`) only off-peak | Olafur | Done | `refreshSupabaseMarts_v1` now skips `top_products_all` during peak hours (07:00–18:59 UTC); logs `skipped_peak_hours` |
| P3-3 | Add lightweight loading states to customer profiles list and detail panel | Olafur | Done | Global loader, customer profile loader, and freshness/alert messaging now keep the UI deterministic during load |
| P3-4 | Create lighter initial data source for Forgangslisti if Supabase view remains slow | Olafur | Done | `api.mv_customer_profiles_labeled_trends` live in Supabase (6287 rows); JS reads MV; GAS refreshes after each `scheduledCustomerAnalysisSync_v1` run |

## Priority 4 - Controlled Cleanup

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P4-1 | Remove `publicAPI.js` if no operational dependency remains | Olafur | Done | No references found; file deleted |
| P4-2 | Remove `core/newsales_legacy_shims.js` after observation window | Olafur | Done | No trigger or manual references found; file deleted |
| P4-3 | Add `ARCHITECTURE.md` (GAS ingest -> Supabase raw -> marts -> Webflow) | Olafur | Done | `ARCHITECTURE.md` added; covers all layers, trigger schedule, RPCs, Webflow pages, and non-negotiables |

## Priority 5 - Klaviyo Attribution

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P5-1 | Create Klaviyo raw schema in Supabase (`raw_klaviyo_events`, `dim_klaviyo_campaigns`) | Olafur | Done | Tables live in Supabase; sync running and data confirmed |
| P5-2 | Add GAS incremental sync (`scheduledKlaviyoSync_v1`) for campaign + event ingest | Olafur | Done | Sync running; last sync 2026-04-17; checkpoint-based incremental ingest confirmed |
| P5-3 | Implement v1 attribution mart (`last_click`, 30-day window) | Olafur | Done | `mv_klaviyo_attribution_daily_nobot` live; returning 326 total attributed orders |
| P5-4 | Add KPI widgets (campaign revenue, conversions, conv %) to Webflow dashboard | Olafur | Done | `/kpi/klaviyo` page live with all KPI cards; `Sala með vsk` shows `–` (likely null `revenue_incl` in source — watch) |
| P5-5 | Add validation check (Klaviyo-attributed orders <= total web orders) | Olafur | Done | `klaviyo_orders_le_web_orders_30d` check implemented in `runDailySanityChecks_v1`; runs daily |

## Priority 6 - Website Dashboard & GA4

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P6-1 | Validate `website_kpi_pack` RPC in Supabase and confirm all dashboard cards render | Olafur | Done | All KPI cards confirmed live in production (2026-04-17) |
| P6-2 | Fix `Dagsetning:` date label on `/kpi/vefur-kpi` showing American format (04/16/2026) | Olafur | Done | `formatDayLabel` rewritten to manual `dd.mm.yyyy` — no Intl locale dependency; deploy to Webflow and update pin |
| P6-3 | Pin `website-dashboard.js` + `website-dashboard-bootstrap.js` in Webflow and update pins below | Olafur | Done | Webflow deploy rev updated to `cb56c43`; all pages confirmed loading |
| P6-4 | Define phase 2 scope for website dashboard (segments, funnels, or trend lines) | Olafur | Blocked | Waiting for GA4 purchase tracking fix to stabilise (GTM fix applied 2026-04-17 — validate ratio next day before adding funnel metrics) |

## Priority 7 - SEO Manager

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P7-1 | Run SEO manager on full category queue and review output quality | Olafur | In progress | Generated copy reviewed; false positives / poor suggestions caught and corrected |
| P7-2 | Decide phase 2 scope: Prismic API write vs manual copy/paste workflow remains | Olafur | Todo | Decision made; either Prismic API integration scoped or workflow documented |

## Priority 8 - GTM / GA4 Tracking Quality

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P8-1 | Fix GA4 purchase over-counting (GTM EV trigger dedup broken) | Olafur | Done | `CJS – Seen Txn` moved to condition on `EV – order success total visible`; `EX – purchase duplicate` removed from tag exceptions; sanity check `ga4_purchase_ratio_7d` wired into `runDailySanityChecks_v1` (threshold 2.5x) |
| P8-2 | Validate GA4 purchase ratio after fix | Olafur | Todo | `ga4_purchase_ratio_7d` passes (ratio < 2.5) on next daily sanity run; compare query confirms ga4_purchases ≈ actual_orders |
| P8-3 | Add funnel conversion rates to website dashboard once P8-2 passes | Olafur | Todo | `add_to_cart→checkout %` and `checkout→purchase %` visible on `/kpi/vefur-kpi`; numbers make business sense |

## Current Production Pins

Update these whenever Webflow custom code is changed.

- Webflow deploy rev (both bootstrap `data-storkaup-rev`): `6617e82`
- `Webflow/dashboard-theme.css`: `2b272cd`
- Trigger schedule baseline: `ab2931a`

## Weekly Review Checklist

1. Check Apps Script executions for failures in the last 24h.
2. Confirm new NEWWEB rows continue landing during business hours.
3. Confirm BC sync ran in both intended daily windows and dashboard BC share still matches Supabase.
4. Confirm Magento incremental sync has no recurring 401 or timeout errors.
5. Spot-check one parent/child customer case for profile correctness.
6. Move completed tasks to `Done` and add next concrete action.

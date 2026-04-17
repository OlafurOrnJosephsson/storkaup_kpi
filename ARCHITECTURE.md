# Architecture

## Overview

```
External sources
  (Magento / BC / Klaviyo / GA4 / Cludo)
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
Webflow (JavaScript)               ← read-only dashboard frontend
```

---

## 1. Google Apps Script — Ingest layer

All ingest runs in Apps Script. No backend server. Triggers are time-based and managed via `resetRecommendedTimeTriggers_v1()`.

### Scheduled triggers

| Function | Cadence | Source | File |
|---|---|---|---|
| `safePoll_v2` | Every 5 min | Magento (new orders only) | `core/newsales_v2.js` |
| `scheduledMagentoSync_v1` | Hourly | Magento (incremental full sync) | `core/utils.js` |
| `scheduledBcSync_v1` | Twice daily | Business Central | `core/utils.js` |
| `scheduledKlaviyoSync_v1` | Every 15 min | Klaviyo events | `core/utils.js` |
| `scheduledReferenceSync_v1` | Daily | Reference tables (products, customers) | `core/utils.js` |
| `scheduledCludoSync_v1` | Daily | Cludo search analytics | `core/utils.js` |
| `scheduledCustomerAnalysisSync_v1` | Daily | Customer segmentation | `core/utils.js` |
| `runDailySanityChecks_v1` | Daily (morning) | Cross-source validation | `core/utils.js` |

### Key ingest files

| File | Purpose |
|---|---|
| `core/newsales_v2.js` | Magento order polling, checkpoint-based incremental |
| `core/utils.js` | All other sync functions, trigger management, Supabase client |
| `core/salessummaries.js` | BC sales summary aggregation |
| `core/customers.js` | Customer resolution and profile logic |
| `core/customer_analysis.js` | Customer segmentation scoring |
| `core/ga4.js` | GA4 data pull via Reporting API |
| `core/cludo.js` | Cludo search event ingest |
| `core/auth.js` | OAuth helpers (Magento 2FA, BC) |
| `core/config.js` | Script Properties config loader |
| `core/schema.js` | Sheet schema definitions |
| `core/menu.js` | Apps Script UI menu |
| `core/seo_manager.js` | SEO copy generation via OpenAI (manual trigger) |

### Failure alerting

`notifyTriggerFailure_()` is wired into all scheduled functions. Configure recipient list via `ALERT_EMAILS` in Script Properties.

### Resetting triggers

```
resetRecommendedTimeTriggers_v1()
```

Run this from Apps Script editor after a new deploy or if trigger state is unknown.

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
| `raw.bc_sales_raw` | Business Central | `scheduledBcSync_v1` |
| `raw.raw_klaviyo_events` | Klaviyo | `scheduledKlaviyoSync_v1` |
| `raw.dim_klaviyo_campaigns` | Klaviyo | `scheduledKlaviyoSync_v1` |

### Key mart views

| View | Purpose |
|---|---|
| `mart.mv_klaviyo_attribution_daily` | Last-click Klaviyo attribution, 30-day window |
| `mart.mv_klaviyo_attribution_daily_nobot` | Same, bot clicks excluded |
| `mart.top_products_all` | Top products aggregation (heavy — runs off-peak) |

### Key RPCs (called by Webflow)

| RPC | Page |
|---|---|
| `day_kpi_pack` | Mælaborð — daily KPI cards |
| `website_kpi_pack` | Vefmælaborð — GA4 website metrics |
| `api.get_customer_profile_family_summary` | Innkaupalistar / Sölutölur |
| `api.resolve_customer_family_ids` | Customer profile family aggregation |
| `api.get_customer_last_orders` | Customer last order history |
| `mart.v_klaviyo_campaign_cards_30d_nobot` | Herferðir — Klaviyo campaign cards |

### SQL migrations

All schema changes are in `core/sql/`. Apply manually in Supabase SQL editor — there is no migration runner.

---

## 3. Webflow — Frontend layer

Read-only dashboards. All data comes from Supabase RPCs via `fetch`. No writes from the frontend.

### Pages and JS files

| URL | JS file(s) | Purpose |
|---|---|---|
| `/kpi/dashboard` | `dashboard.js` + `dashboard-bootstrap.js` | Main sales KPIs, BC web share |
| `/kpi/solutolur` | `dashboard.js` | Sales figures |
| `/kpi/vidskiptavinur` | `customer-profiles.js` | Customer profiles, family totals |
| `/kpi/forgangslisti` | `customer-profiles.js` | Priority list, onboarding status |
| `/kpi/klaviyo` | `dashboard.js` | Klaviyo attribution KPIs |
| `/kpi/top-products` | `top-products.js` | Top products and categories |
| `/kpi/vefur-kpi` | `website-dashboard.js` + `website-dashboard-bootstrap.js` | GA4 website metrics |

### Non-negotiables

- BC web share logic must not change casually: monthly cards use net BC, daily cards use `day_kpi_pack`, canonical tag is `salesperson_code = 'VEFUR'`.
- If a secondary RPC fails, the primary dashboard must still render.
- `safePoll_v2` 5-minute cadence must not be broken.

### Production pins (jsDelivr / Webflow custom code)

See `NEXT_TASKS.md` → Current Production Pins section. Update pins whenever a Webflow JS file is changed.

---

## 4. Daily operations

See `RUNBOOK.md` for the failure playbook.

```
Something looks wrong?
1. Check Apps Script Executions for errors in the last 24h.
2. Confirm trigger list matches intended cadence.
3. Verify Supabase directly before blaming Webflow.
4. Compare raw vs net numbers before assuming dashboard math is broken.
```

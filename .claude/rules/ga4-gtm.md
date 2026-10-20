---
paths:
  - "core/ga4.js"
  - "gtm/**"
  - "Webflow/website-dashboard.js"
---

# GA4 / GTM

- `scheduledGa4Sync_v1` reads event counts only for `add_to_cart`, `begin_checkout` and `purchase` (plus sessions/users/pageviews/eventCount and channel). Other GTM changes do not affect the KPIs.
- **Data break on 2026-10-01 (GTM v96/v97):** `purchases`, `ga4_purchase_ratio_7d` and `begin_checkout` drop from that day. It is a correction, not a collapse. Details: `RUNBOOK.md` → *Not an issue: GA4 `purchases` and `begin_checkout` drop*.
- The ratio check is `checkGa4PurchaseRatio_` inside `runDailySanityChecks_v1` (`core/utils.js`); tightening it is P8-7 in `NEXT_TASKS.md`.
- GTM export: `gtm/`.

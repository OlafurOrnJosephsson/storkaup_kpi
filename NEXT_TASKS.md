# KPI Project Next Tasks

## Priority 1 - Stabilize Operations

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P1-1 | Freeze current prod script pins (Webflow/jsDelivr commit IDs) and document them | Olafur | Done | Production pin section added to `README.md`; pins tracked in docs and Webflow custom code |
| P1-2 | Add quick runbook for daily operations (`safePoll_v2`, `scheduledMagentoSync_v1`, `scheduledBcSync_v1`) | Olafur | Done | `RUNBOOK.md` added; core function guidance and failure playbook documented |
| P1-3 | Add Apps Script failure alerting for key triggers | Olafur | Done | `notifyTriggerFailure_` wired for key scheduled triggers + `safePoll_v2`; configure `ALERT_EMAILS` in Script Properties |
| P1-4 | Keep `safePoll_v2` schedule windows validated for 7 days | Olafur | In progress | No night runs, expected daytime/evening cadence in Executions |

## Priority 2 - Data Quality and Consistency

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P2-1 | Move parent/child customer ID logic into Supabase SQL layer (not just frontend) | Olafur | Todo | Same customer totals regardless of child vs parent ID lookup |
| P2-2 | Update `api.get_customer_last_orders` to support family IDs directly | Olafur | Todo | "Last web orders" and "Last BC orders" populate correctly for child IDs |
| P2-3 | Add daily data sanity check query (BC vs web share, ingestion row counts) | Olafur | Todo | Daily check result stored/logged with pass/fail |

## Priority 3 - Performance

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P3-1 | Dashboard: reduce redundant RPC calls and keep cache hit ratio high | Olafur | Todo | Lower median page load and fewer RPC calls per session |
| P3-2 | Run heavy mart refresh (`top_products_all`) only off-peak | Olafur | Todo | No daytime statement-timeout noise from heavy refresh |
| P3-3 | Add lightweight loading states to customer profiles list and detail panel | Olafur | Todo | Users see deterministic loading state instead of blank areas |

## Priority 4 - Controlled Cleanup

| ID | Task | Owner | Status | Acceptance Check |
|---|---|---|---|---|
| P4-1 | Remove `publicAPI.js` if no operational dependency remains | Olafur | Todo | GAS deploy/tests unaffected after removal |
| P4-2 | Remove `core/newsales_legacy_shims.js` after observation window | Olafur | Todo | No manual runs or trigger references to legacy names |
| P4-3 | Add `ARCHITECTURE.md` (GAS ingest -> Supabase raw -> marts -> Webflow) | Olafur | Todo | New contributors can understand flow in under 10 min |

## Current Production Pins

Update these whenever Webflow custom code is changed.

- `Webflow/customer-profiles.js`: `59f0cda`
- Parent-child profile aggregation baseline: `ab0aafd`
- Parent-child last-orders merge: `ca32334`

## Weekly Review Checklist

1. Check Apps Script executions for failures in the last 24h.
2. Confirm new NEWWEB rows continue landing during business hours.
3. Confirm Magento incremental sync has no recurring 401 errors.
4. Spot-check one parent/child customer case for profile correctness.
5. Move completed tasks to `Done` and add next concrete action.

# Release Notes - 2026-02-27

## Scope

Storkaup KPI alignment across GAS, Supabase, and Webflow dashboard:
- BC net logic parity (`invoices - credit invoices`)
- Monthly web-share stability
- Historical coverage (OLDWEB + NEWWEB)
- Sales rep and self-serve automation

## Delivered

1. BC schema and sheet binding updates
- BC datasets now use `CONFIG/SHEET_IDS` bindings:
  - `BC_CUSTOMERS`
  - `BC_INVOICES`
  - `BC_LINES`
- Added dedicated binding:
  - `BC_CREDIT_INVOICES -> Bokadir solukreditreikningar`

2. Header normalization fixes
- Icelandic header normalization fixed to avoid missing-column false negatives.
- Resolved prior `iExcl=-1` failures in monthly builders.

3. Monthly KPI logic improvements
- Net BC logic implemented in monthly metrics:
  - revenue incl/excl net
  - order count net
  - BC web numerator net
- Added explicit diagnostics:
  - `[BCMT]`, `[BCMT-CR]`, `[BCMT-EXCL]`, `[BCMT-EXCL-CR]`
  - `[BC-ORDERS]`, `[BC-ORDERS-CR]`
  - `[BC-WEB]`, `[BC-WEB-CR]`
  - `[BC-NET-CHECK]`
- Added two operational columns to monthly:
  - `All Web Orders % of BC`
  - `All Web % of BC`

4. Supabase BC sync coverage
- `scheduledBcSync_v1` now includes credit invoices end-to-end.
- `raw.bc_credit_invoices_raw` ingestion/backfill is active.

5. Dashboard RPC (`api.dashboard_compat`) updates
- Uses net BC denominator/numerator (invoices minus credits).
- Uses unified web orders (`raw.newweb_orders_raw + raw.oldweb_orders_raw`).
- Uses historical BC web fallback rule:
  - `CO22-%` only before `2025-08-18`.
- Overload-safe API path standardized on `api.dashboard_compat`.

6. Sales rep automation
- Added automatic sync from Sheets to `raw.sales_reps_ref`:
  - new GAS function: `syncSalesRepsRefToSupabase_v1()`
  - called by `scheduledMagentoSync_v1`
  - called by `scheduledReferenceSync_v1`
- Dedupe/merge logic added to prevent unique-index collisions.

## Operational Notes

- Canonical dashboard web share:
  - `webOrdersPct` / `webRevenuePct` from BC-booked web docs (Power BI parity)
- Operational comparison:
  - `All Web %` columns include OLDWEB + NEWWEB and are expected to differ.

## Validation Checklist

1. GAS
- `buildAll_v6` completes without missing-column errors.
- Monthly tab includes canonical and all-web columns.

2. Supabase
- `select count(*) from raw.sales_reps_ref where active = true;`
- `select api.dashboard_compat('2026-02')->'month';`

3. Webflow
- Hard refresh and verify cards:
  - web orders %
  - web revenue %
  - sales rep %
  - self-serve %

## Rollback

If needed:
- Revert `core/salessummaries.js`, `core/utils.js`, and `core/sql/dashboard_compat.sql` to previous commit state.
- Re-run previous SQL function definition for `api.dashboard_compat`.

# KPI Operations Runbook

## Scope

This runbook covers daily operations for:
- NEWWEB ingestion (Magento orders -> GAS sheet -> Supabase)
- Magento customer sync
- BC sync to Supabase (for web vs BC % and related metrics)

## Primary Functions (Apps Script)

### 1) NEWWEB ingestion
- Function: `safePoll_v2`
- Purpose: Pull new web orders from Magento, write to `NEWWEB`, upsert to Supabase.
- Expected logs:
  - `[NEWWEB][INFO] NEWWEB v2 start ...`
  - `[NEWWEB][INFO] NEWWEB v2 page fetched ...`
  - Either:
    - `[NEWWEB][INFO] NEWWEB v2 import completed {"inserted":N,...}`
    - or `[NEWWEB][INFO] Engar nýjar pantanir frá Magento (v2)`

### 2) Magento customers
- Function: `scheduledMagentoSync_v1`
- Purpose: Sync Magento customers into sheet + Supabase incremental backfill.
- Expected logs:
  - `[MAGSYNC][INFO] Started scheduledMagentoSync_v1 ...`
  - `Fetch Magento Customers — incremental`
  - completion with `magentoSync":"ok"`

### 3) BC sync (important for web vs BC share)
- Function: `scheduledBcSync_v1`
- Purpose: Incremental BC invoices + lines + BC customers upsert to Supabase.
- Expected logs:
  - `[BCSYNC][INFO] Completed scheduledBcSync_v1 ...`
  - result includes uploaded counters for invoices/lines/customers.

## Manual Recovery / Backfill

Use only when incremental sync is clearly behind or data was re-exported.

- Full invoices backfill: `runBcInvoicesFullBackfill_v1`
- Full lines backfill (chunked safer): `runBcLinesFullBackfillChunk_v1`
- Incremental BC wrapper: `runBcIncrementalSync_v1`
- Optional marts refresh: `refreshSupabaseMarts_v1`

Note: `refresh_mv_top_products_all` may timeout (statement timeout) during busy hours. Run heavy refresh off-peak.

## Daily Check (quick)

1. Apps Script `Executions` last 24h:
   - `safePoll_v2` mostly completed
   - no recurring failures
2. `scheduledMagentoSync_v1` recent run has `magentoSync":"ok"`
3. `scheduledBcSync_v1` recent run completed
4. Spot-check one fresh order in `NEWWEB` sheet + frontend

## Common Issues

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
  - If excessive, lower trigger frequency or optimize heavy operations

### Issue: no new rows in `NEWWEB`
- Confirm checkpoint in log.
- If Magento has no newer orders than checkpoint, this is expected.
- Verify latest Magento order timestamp is newer than checkpoint.

## Trigger Baseline

Expected active trigger functions:
- `safePoll_v2`
- `scheduledMagentoSync_v1`
- `scheduledBcSync_v1`
- `scheduledCludoSync_v1`
- `scheduledCustomerAnalysisSync_v1`
- `onOpen`


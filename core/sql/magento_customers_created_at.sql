-- Add account-creation date to raw.magento_customers_raw so the
-- "Nýskráðir í dag" cards (day_kpi_pack.registrations_*) actually work.
--
-- The Magento "Created At" is present in the CUSTOMERS sheet but was never
-- pushed to Supabase — upsertMagentoCustomersToSupabase_ only sent
-- updated_at_source. schema.js now maps CREATED and the upsert sends
-- created_at_source; day_kpi_pack already reads that key as a fallback, so no
-- change to day_kpi_pack.sql is needed.
--
-- RUN ORDER: run this, then clasp push the GAS change, then run one full
-- backfill (backfillMagentoCustomersToSupabase_v1) to populate history —
-- otherwise only customers touched by the next incremental sync get a date.

alter table raw.magento_customers_raw
  add column if not exists created_at_source timestamptz;

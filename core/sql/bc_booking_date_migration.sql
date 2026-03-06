-- Add booking_date to BC raw invoice tables and backfill existing rows.
-- Run once in Supabase SQL editor before deploying day_kpi_pack booking-date switch.

alter table if exists raw.bc_invoices_raw
  add column if not exists booking_date timestamptz null;

alter table if exists raw.bc_credit_invoices_raw
  add column if not exists booking_date timestamptz null;

update raw.bc_invoices_raw
set booking_date = order_date
where booking_date is null
  and order_date is not null;

update raw.bc_credit_invoices_raw
set booking_date = order_date
where booking_date is null
  and order_date is not null;

create index if not exists idx_bc_invoices_raw_booking_date
  on raw.bc_invoices_raw (booking_date);

create index if not exists idx_bc_credit_invoices_raw_booking_date
  on raw.bc_credit_invoices_raw (booking_date);

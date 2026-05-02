-- Restore bc_invoices_raw.amount_excl and bc_credit_invoices_raw.amount_excl
-- after backfill zeroed them (2026-05-01 incident).
--
-- The BC Sheets export has no "Upphaed" (excl VAT) column, only "Upphaed med VSK".
-- GAS upsert was sending amount_excl = 0 for every row. Fixed going forward;
-- this script restores historical values.
--
-- Run in Supabase SQL editor in order: Step 1, then Step 2, then Step 3.
-- Check verification query after each step.

-- ─── STEP 1 ────────────────────────────────────────────────────────────────
-- Restore bc_invoices_raw.amount_excl from bc_lines_raw line sums.
-- This is the most accurate source — actual line totals excl. VAT.

update raw.bc_invoices_raw i
set amount_excl = t.total_excl
from (
  select
    document_no::text                           as document_no,
    sum(coalesce(amount_excl, 0))::numeric      as total_excl
  from raw.bc_lines_raw
  group by document_no
) t
where i.document_no::text = t.document_no::text
  and t.total_excl > 0;

-- ─── STEP 2 ────────────────────────────────────────────────────────────────
-- Fallback for invoices that have no lines in bc_lines_raw (or lines summed to 0).
-- Use amount_incl / 1.24 (Icelandic standard VAT 24%).

update raw.bc_invoices_raw
set amount_excl = round(amount_incl::numeric / 1.24, 0)
where (amount_excl is null or amount_excl = 0)
  and amount_incl > 0;

-- ─── STEP 3 ────────────────────────────────────────────────────────────────
-- Restore bc_credit_invoices_raw.amount_excl (no separate lines table for SK).
-- Fallback only: amount_incl / 1.24.

update raw.bc_credit_invoices_raw
set amount_excl = round(amount_incl::numeric / 1.24, 0)
where (amount_excl is null or amount_excl = 0)
  and amount_incl > 0;

-- ─── VERIFICATION ──────────────────────────────────────────────────────────
-- Run after all steps. excl_pct should be ~80.6% (= 100/1.24) for standard VAT rows.
-- If a month looks wrong, cross-check with Power BI.

select
  date_trunc('month', coalesce(booking_date, order_date))::date as month,
  count(*)                                                        as invoices,
  sum(amount_excl)::bigint                                        as total_excl,
  sum(amount_incl)::bigint                                        as total_incl,
  round(sum(amount_excl) / nullif(sum(amount_incl), 0) * 100, 1) as excl_pct_of_incl,
  sum(amount_excl) filter (
    where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
  )::bigint                                                       as vefur_excl
from raw.bc_invoices_raw
where coalesce(booking_date, order_date) >= '2025-01-01'
group by 1
order by 1 desc;

-- ============================================================================
-- BC FRESHNESS CHECK — read-only. Run after every processBcDrop_v1 import.
--
-- BC ingest is menu-driven only (no trigger since 2026-04-30), so staleness is
-- silent: nothing alerts, and the dashboard BC cards are deliberately nulled so
-- they cannot reveal it either. This is the check that closes that gap.
--
-- Reference point: SALES_SUMMARIES (the Google Sheet, a dead source — see
-- RUNBOOK.md) had BC data through 2026-04. Supabase should be well past that.
-- ============================================================================


-- ── C1. Monthly BC revenue + VEFUR tagging (the main one) ───────────────────
-- Answers both "is it up to date" and "is the web-share tag intact" at once.
-- vefur_reikningar must be > 0 for months after the 2025-08-18 cutover —
-- salesperson_code = 'VEFUR' is the canonical web tag (CLAUDE.md non-negotiable).
-- The sheet-based path lost this tag in 2025-09 when BC renamed the header; this
-- query proves whether the Supabase path still has it.

select
  to_char(booking_date, 'YYYY-MM')                              as manudur,
  count(*)                                                      as reikningar,
  round(sum(amount_excl))                                       as velta_excl,
  count(*) filter (
    where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
  )                                                             as vefur_reikningar,
  round(sum(amount_excl) filter (
    where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
  ))                                                            as vefur_velta_excl
from raw.bc_invoices_raw
where booking_date >= date_trunc('month', current_date) - interval '7 months'
group by 1
order by 1 desc;


-- ── C2. Freshness + span of both dated BC tables ────────────────────────────
-- `sidasta` is the number that matters: how current the load is.
-- Note credit invoices were EMPTY before 2026-08-05, so a short span there is
-- expected on the first check after that date.

select
  'bc_invoices_raw'                                  as tafla,
  count(*)                                           as radir,
  min(booking_date)::date                            as fyrsta,
  max(booking_date)::date                            as sidasta,
  (current_date - max(booking_date)::date)           as dagar_gamalt
from raw.bc_invoices_raw
union all
select
  'bc_credit_invoices_raw',
  count(*),
  min(booking_date)::date,
  max(booking_date)::date,
  (current_date - max(booking_date)::date)
from raw.bc_credit_invoices_raw;


-- ── C3. Line coverage — did BC_LINES keep up with BC_INVOICES? ──────────────
-- `reikningar_an_lina` should be small. A large number means the lines file was
-- older than the invoices file in the drop folder, or lines were lost to the
-- on_conflict=document_no,sku,product_name,qty,amount_excl dedupe (~2% expected,
-- see core/sql/generate_shopping_list_v2.sql).

select
  (select count(*) from raw.bc_lines_raw)                          as linur,
  (select count(distinct document_no) from raw.bc_lines_raw)       as reikningar_med_linur,
  (select count(*) from raw.bc_invoices_raw)                       as reikningar_alls,
  (select count(*) from raw.bc_invoices_raw i
    where not exists (
      select 1 from raw.bc_lines_raw l where l.document_no = i.document_no
    ))                                                             as reikningar_an_lina;


-- ── C4. Customers + when the last import ran ───────────────────────────────
-- processBcDrop_v1 logs its run under job_name 'scheduledBcSync_v1' (the name
-- survives from the deleted scheduled function). This is the same row that feeds
-- api.bc_sync_status and the dashboard's "BC last sync" label.

select
  (select count(*) from raw.bc_customers_raw)                     as vidskiptamenn,
  (select max(started_at) from raw.ingestion_runs
    where job_name = 'scheduledBcSync_v1' and status in ('success', 'partial'))
                                                                  as sidasta_innhledsla;

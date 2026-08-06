-- ============================================================================
-- Raise statement_timeout for service_role (GAS → PostgREST).
--
-- Applied 2026-08-06. This is a ROLE-level database setting; it exists nowhere
-- else in the repo, so this file is the only record of it. If the project is
-- ever restored from a schema dump, run this too — a dump does not carry it.
--
-- WHY: Supabase defaults every PostgREST role to statement_timeout = 8s. GAS
-- calls the mart refresh functions over PostgREST as service_role, so as soon as
-- a materialized view took longer than 8 seconds to rebuild, the refresh started
-- failing with Postgres 57014 (canceling statement due to statement timeout).
--
-- What that actually cost, before it was found:
--   * refresh_mv_top_products_all / _master failed on EVERY off-peak run
--     (00:43 and 06:43; the 12:43 and 18:43 runs skip them as peak hours), so
--     mart.mv_top_products_master — behind the Vinsælar vörur page and the BC
--     product columns — had not rebuilt successfully in months.
--   * refresh_mv_customer_profiles_labeled_trends failed the same way once the
--     MV grew, leaving /kpi/vidskiptavinur showing a stale customer list.
-- Every one of those runs was written to raw.ingestion_runs as 'success',
-- because only the sub-step failed. The failure was in `details` the whole time.
-- See the 'partial' status handling now in scheduledReferenceSync_v1 and
-- scheduledCustomerAnalysisSync_v1 (core/utils.js).
--
-- SCOPE: service_role only. anon and authenticated keep the 8s default, so a
-- browser holding the publishable key still cannot tie up a connection for two
-- minutes. Do not widen this to those roles.
--
-- The NOTIFY is required — without it PostgREST keeps using the old setting
-- until it happens to restart.
-- ============================================================================

alter role service_role set statement_timeout = '120s';

notify pgrst, 'reload config';


-- ── VERIFY ─────────────────────────────────────────────────────────────────
-- Expect service_role = 120s and the others unchanged.

select rolname,
       (select option_value
          from pg_options_to_table(r.rolconfig)
         where option_name = 'statement_timeout') as statement_timeout
from pg_roles r
where rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
order by rolname;

-- End-to-end check (the only one that really counts — the SQL editor runs as
-- postgres with no timeout, so testing there proves nothing about service_role):
-- run scheduledReferenceSync_v1 outside 07:00–19:00 UTC and confirm
-- details->'martRefresh' comes back all "ok" rather than 57014.


-- ── IF 120s IS EVER NOT ENOUGH ─────────────────────────────────────────────
-- Do not keep raising this. The right fix at that point is to stop refreshing
-- materialized views over HTTP at all and schedule them inside the database with
-- pg_cron, which has no request timeout. Mart maintenance has no business going
-- through PostgREST; it only does so here because GAS is the scheduler.

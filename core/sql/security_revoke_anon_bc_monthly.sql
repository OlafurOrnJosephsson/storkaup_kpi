-- ============================================================================
-- Close anon SELECT on mart.v_bc_monthly_net_v1.
--
-- WHY: it exposes Business Central monthly net revenue + the web-share ratios
-- to anyone holding the publishable key. Listed as MIÐLUNGS exposure in
-- SECURITY_REVIEW.md section 4 since 2026-06-01 and never closed.
--
-- SAFE: nothing reads it. Repo-wide grep for v_bc_monthly_net / monthly_net
-- returns only its own definition (core/sql/bc_monthly_net_v1.sql:6), its grant
-- (line 79) and the SECURITY_REVIEW mention. Its own header says the purpose is
-- "Monthly BC net metrics for Power BI / QA" — i.e. governed/manual use, which
-- goes through service_role or an authenticated session, not anon.
-- The dashboard's web-share cards are fed by window.STORKAUP_BC_MANUAL
-- (Webflow/dashboard.js:351), not by this view.
--
-- NOTE: bc_monthly_net_v1.sql line 79 re-grants anon on re-apply. Patch that
-- line at the same time or this revoke will silently undo itself the next time
-- the view is redeployed — that pattern is how the June write-lockdown came
-- undone. Keep the grant in the same file as the object.
--
-- ROLLBACK: grant select on mart.v_bc_monthly_net_v1 to anon;
-- Idempotent — safe to re-run.
-- ============================================================================

revoke select on mart.v_bc_monthly_net_v1 from anon;


-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect one row, anon_select = false.
select
  'mart.v_bc_monthly_net_v1' as object,
  has_table_privilege('anon', 'mart.v_bc_monthly_net_v1', 'select')          as anon_select,
  has_table_privilege('authenticated', 'mart.v_bc_monthly_net_v1', 'select') as authed_select,
  has_table_privilege('service_role', 'mart.v_bc_monthly_net_v1', 'select')  as service_select;


-- ── DONE (2026-08-06) — the follow-up this file used to point at ────────────
-- public.day_kpi_pack also read the BC tables directly and is granted to anon.
-- It could not simply be revoked: it feeds every daily card on the dashboard,
-- not just the BC ones. It has since been rewritten from the live definition
-- with all six BC fields returning null and both BC CTEs removed —
-- see core/sql/day_kpi_pack.sql. Verified with
--   select pg_get_functiondef('public.day_kpi_pack(date)'::regprocedure)
--          ~* 'from\s+raw\.bc_' as still_reads_bc;   -- false
--
-- Note for anyone repeating that exercise: the repo copy of day_kpi_pack.sql was
-- BEHIND the live body at the time (20802 chars against 21045, despite carrying
-- a comment header the body does not have). Always pull the live definition with
-- pg_get_functiondef before patching a function in this project.
--
-- Remaining BC exposure is per-customer rather than aggregate, and is recorded
-- in SECURITY_REVIEW.md §4 rather than here — this repository is public, and an
-- inventory of what is still reachable without authentication is a roadmap.

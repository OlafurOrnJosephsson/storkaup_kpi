-- ============================================================================
-- Close anon EXECUTE on the two digest RPCs.
--
-- WHY: public.weekly_digest_stats and public.monthly_digest_stats aggregate
-- BC revenue, top customers and rep figures. Both were granted to anon in their
-- own files (weekly_digest.sql:184, monthly_digest.sql:280), so anyone holding
-- the publishable key could pull them. Flagged in the repo review 2026-10-08.
--
-- SAFE: the only caller is GAS — core/email.js:156 and :499 via
-- callSupabaseRpc_ (core/utils.js), which sends the service_role key. No
-- Webflow file references either function.
--
-- NOT IN THIS FILE, deliberately: get_product_buyers and
-- get_product_transactions (customer name + BC amounts per SKU) and
-- api.web_booking_reconciliation_30d. Webflow calls all three with the anon
-- key — top-products.js:402/410, portal.js:409/411, dashboard.js:2135 — so a
-- revoke would break /kpi/top-products, /kpi/voruportal and the dashboard.
-- They close only when those pages read behind a login (SECURITY_REVIEW 5B).
--
-- REVOKE FROM PUBLIC matters: Postgres grants EXECUTE on new functions to
-- PUBLIC by default, and anon inherits it. Revoking from anon alone leaves the
-- door open. Same pattern as web_records_v1.sql:230-232.
--
-- weekly_digest.sql and monthly_digest.sql are patched in the same commit so a
-- re-apply does not silently re-grant anon — the way the June lockdown came
-- undone.
--
-- ROLLBACK: grant execute on function public.weekly_digest_stats(date)  to anon, authenticated;
--           grant execute on function public.monthly_digest_stats(date) to anon, authenticated;
-- Idempotent — safe to re-run.
-- ============================================================================


-- ── 1. BEFORE: what is open right now (run first, keep the output) ──────────
select p.oid::regprocedure as fn,
       has_function_privilege('anon',          p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role',  p.oid, 'execute') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('public', 'weekly_digest_stats'),
  ('public', 'monthly_digest_stats'),
  ('public', 'get_product_buyers'),
  ('public', 'get_product_transactions'),
  ('api',    'web_booking_reconciliation_30d')
)
order by 1;


-- ── 2. REVOKE ───────────────────────────────────────────────────────────────
revoke all on function public.weekly_digest_stats(date)  from public, anon, authenticated;
revoke all on function public.monthly_digest_stats(date) from public, anon, authenticated;
grant execute on function public.weekly_digest_stats(date)  to service_role;
grant execute on function public.monthly_digest_stats(date) to service_role;


-- ── 3. AFTER: the two digests show anon = false, authenticated = false,
--      service_role = true. The other three stay open (see header). ─────────
select p.oid::regprocedure as fn,
       has_function_privilege('anon',          p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role',  p.oid, 'execute') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('public', 'weekly_digest_stats'),
  ('public', 'monthly_digest_stats'),
  ('public', 'get_product_buyers'),
  ('public', 'get_product_transactions'),
  ('api',    'web_booking_reconciliation_30d')
)
order by 1;

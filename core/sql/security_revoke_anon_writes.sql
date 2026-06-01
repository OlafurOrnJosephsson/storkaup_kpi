-- SECURITY (2026-06-01): revoke anon/PUBLIC execute on customer-priority WRITE RPCs.
--
-- Context: security review flagged that the public `sb_publishable_...` key
-- (shipped in dashboard-bootstrap.js, also in a public GitHub repo + jsDelivr)
-- grants the `anon` role execute on data-MUTATING functions. This removes the
-- worst exposure — arbitrary writes by anyone with the key — as an interim
-- measure ahead of a full Supabase Auth + RLS migration. Read endpoints remain
-- open for now (separate, lower-severity finding).
--
-- NOTE: Postgres grants EXECUTE to PUBLIC by default and `anon` inherits it, so
-- revoking from `anon` alone is NOT enough — we must also revoke from PUBLIC and
-- then re-grant explicitly to `authenticated` + `service_role`.
--
-- Impact: Forgangslisti write actions from the browser (set flag, assign rep,
-- bulk set) stop working until authenticated access exists. Priority-list READS
-- are unaffected.
--
-- Reversible: `grant execute on function <fn> to anon;` restores prior behaviour.
-- Apply in Supabase SQL editor.

revoke execute on function api.set_customer_priority_flag(text, text, text, text)   from public, anon;
grant  execute on function api.set_customer_priority_flag(text, text, text, text)   to authenticated, service_role;

revoke execute on function api.assign_customer_priority_rep(text, text)             from public, anon;
grant  execute on function api.assign_customer_priority_rep(text, text)             to authenticated, service_role;

revoke execute on function api.bulk_set_customer_priority_flags(text[], text, text) from public, anon;
grant  execute on function api.bulk_set_customer_priority_flags(text[], text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verify afterwards (should list authenticated + service_role, NOT anon/PUBLIC):
--   select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'execute') as can_exec
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
--   where n.nspname = 'api'
--     and p.proname in ('set_customer_priority_flag','assign_customer_priority_rep','bulk_set_customer_priority_flags')
--   order by p.proname, r.rolname;

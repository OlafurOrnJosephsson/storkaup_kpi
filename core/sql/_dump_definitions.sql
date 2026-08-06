-- ============================================================================
-- DEFINITION DUMP — read-only. Pulls the live CREATE statements out of the
-- database so they can be committed to core/sql/.
--
-- WHY: core/sql/ is not the source of truth today. generate_shopping_list_v2
-- (the Innkaupalisti generator) exists only in the database — if the project
-- were lost, that feature is unreproducible. Same risk for anything else that
-- was created straight in the SQL editor. This is assessment item 7
-- (lykilmannaáhætta) in concrete form.
--
-- PREFERRED ALTERNATIVE: the Supabase CLI does this properly in one command.
-- Run from the repo root. No install needed — npx fetches it on first use.
-- (`npm i -g supabase` does NOT work: Supabase does not support global npm
-- installs of the CLI. On Windows the alternatives are npx or Scoop.)
--
--   npx supabase login
--   npx supabase link --project-ref kwpsqpvbhvoyrrffmbcx
--   npx supabase db dump --schema api,public,mart,raw -f core/sql/_schema_snapshot.sql
--
-- `link` asks for the DATABASE password (Project Settings → Database), not an
-- API key. Resetting that password does not affect the anon/service_role keys,
-- so GAS ingest is unaffected either way. Docker is not required for `db dump`
-- or `link` — only for `supabase start` (local dev).
--
-- That gives a complete, ordered, restorable snapshot (schema only, no data).
-- Use the queries below only if the CLI route stalls.
--
-- ⚠️ BEFORE COMMITTING: the repo is PUBLIC (jsDelivr serves Webflow/*.js from
-- it). A schema snapshot publishes table + function structure. No data and no
-- keys, and grants/RLS are the real control -- but decide it deliberately.
-- If in doubt, add _schema_snapshot.sql to .gitignore for now and let's talk.
-- ============================================================================


-- ── D1. One specific function (start here) ──────────────────────────────────
-- Copy the `def` cell out of the result and save it as
-- core/sql/generate_shopping_list_v2.sql

select pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'generate_shopping_list_v2'
  and n.nspname in ('api', 'public', 'mart');


-- ── D2. Its grants (must travel with the definition) ────────────────────────
-- Grants are the security-relevant half and are currently scattered across
-- ad-hoc files. Going forward: keep the grant in the SAME file as the object.

select
  'grant execute on function ' || n.nspname || '.' || p.proname
    || '(' || pg_get_function_identity_arguments(p.oid) || ') to '
    || string_agg(a.rolname, ', ' order by a.rolname) || ';' as grant_stmt
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join pg_roles a
where p.proname = 'generate_shopping_list_v2'
  and a.rolname in ('anon', 'authenticated', 'service_role')
  and has_function_privilege(a.rolname, p.oid, 'execute')
group by n.nspname, p.proname, p.oid;


-- ── D3. All functions, one row each (bulk export) ───────────────────────────
-- Run this, then "Download CSV" in the SQL editor. Each row is a complete
-- CREATE OR REPLACE statement. Hand the CSV over and I will split it into
-- per-object files under core/sql/ and reconcile against what is already there.

select
  n.nspname || '.' || p.proname   as qualified_name,
  pg_get_functiondef(p.oid)       as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('api', 'public', 'mart')
  and p.prokind = 'f'
order by 1;


-- ── D4. All views + matviews ────────────────────────────────────────────────
-- pg_get_viewdef returns only the SELECT body, so the CREATE prefix is
-- reassembled here. Matviews come back as CREATE MATERIALIZED VIEW.

select
  n.nspname || '.' || c.relname as qualified_name,
  'create or replace view ' || n.nspname || '.' || c.relname || ' as' || E'\n'
    || pg_get_viewdef(c.oid, true) as def
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v'
  and n.nspname in ('api', 'public', 'mart')
union all
select
  n.nspname || '.' || c.relname,
  'create materialized view ' || n.nspname || '.' || c.relname || ' as' || E'\n'
    || pg_get_viewdef(c.oid, true)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'm'
  and n.nspname in ('api', 'public', 'mart')
order by 1;

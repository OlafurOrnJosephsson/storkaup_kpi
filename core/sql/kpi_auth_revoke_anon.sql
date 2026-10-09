-- ============================================================================
-- KPI-innskráning, áfangi 1, LOKASKREF — anon missir allan aðgang.
--
-- KEYRIÐ AÐEINS ÞEGAR:
--   - Webflow/auth.js er site-wide á öllum KPI-síðum (staðfest 2026-10-09);
--   - hver KPI-síða hefur verið opnuð innskráð og hlaðist eðlilega;
--   - kpi_auth_phase1.sql hefur keyrt (authenticated hefur allt sem anon hafði).
--
-- EFTIR ÞETTA: publishable-lykillinn í síðukóðanum opnar ekkert lengur. Gögnin
-- fást aðeins með innskráningu. Þetta lokar P11-6 og öllu anon-yfirborðinu úr
-- mælingunni 2026-10-08. Neyðarrofinn `authDisabled` í auth.js hættir þá að
-- virka (síður án innskráningar fá ekkert) — það er tilgangurinn.
--
-- PUBLIC: Postgres gefur PUBLIC execute á ný föll sjálfgefið, og anon erfir það.
-- Því er authenticated fyrst gefið EXPLICIT (annars gæti það misst heimild sem
-- það hafði aðeins í gegnum PUBLIC), og síðan tekið af public + anon.
--
-- ROLLBACK: keyrið kpi_auth_phase1.sql-mynstrið öfugt — grant ... to anon á
-- sömu hluti. Vistið niðurstöðu Q1/Q2 úr _audit_anon_exposure.sql FYRIR keyrslu.
-- Endurkeyranleg.
-- ============================================================================

-- ── 1. Föll ─────────────────────────────────────────────────────────────────
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api', 'public', 'mart')
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
    raise notice 'anon lokað: %', f.sig;
  end loop;
end $$;

-- ── 2. Töflur / view / matview ──────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm')
      and n.nspname in ('api', 'public', 'mart')
      and has_table_privilege('anon', c.oid, 'select')
  loop
    execute format('grant select on %I.%I to authenticated', r.nspname, r.relname);
    execute format('revoke all on %I.%I from public, anon', r.nspname, r.relname);
    raise notice 'anon lokað: %.%', r.nspname, r.relname;
  end loop;
end $$;

-- ── 3. Ný föll og töflur fái EKKI anon sjálfgefið ──────────────────────────
-- Supabase stillir default privileges svo allt nýtt sé anon-opið. Án þessa
-- opnaðist næsta nýja RPC aftur fyrir publishable-lyklinum — sama mynstur
-- og opnaði lockdown-skrárnar aftur í júní.
alter default privileges for role postgres in schema api, public, mart
  revoke execute on functions from public, anon;
alter default privileges for role postgres in schema api, public, mart
  revoke all on tables from anon;

notify pgrst, 'reload schema';


-- ── STAÐFESTING ─────────────────────────────────────────────────────────────
-- Allt 0. Keyrið síðan Q1 + Q2 úr _audit_anon_exposure.sql og vistið
-- dagsett í core/sql/_audit_output/ (eftir-mæling).
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('api','public','mart') and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')) as anon_functions,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p','v','m') and n.nspname in ('api','public','mart')
      and has_table_privilege('anon', c.oid, 'select')) as anon_relations;

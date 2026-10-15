-- ============================================================================
-- retire_old_customer_rpcs_v1 — föll og töflur gömlu viðskiptavinasíðnanna
-- 2026-10-15
--
-- /kpi/vidskiptavinur (customer-profiles.js), /kpi/forgangslisti og
-- /kpi/activation voru lagðar niður 2026-10-15; vidskiptavinir.js tók við.
-- Þessir hlutir eru eftir í gagnagrunninum og ekkert kallar á þá lengur
-- (leitað í Webflow/, core/, admin/, pim/ og webapp.js sama dag):
--
--   api.generate_shopping_list_v1/v2/v3,   innkaupalistinn; v2 hunsaði
--   public.generate_shopping_list_v1       dagabilið. Í stað: get_customer_products_v1
--   api.get_customer_profile_family_summary  í stað: get_customer_card_v1
--   api.create_sales_task, complete_sales_task, get_open_tasks
--                                          sölu-verkefni; snertiskráin kom í staðinn
--   api.web_activation_kpis, web_activation_state_counts, web_activation_by_rep
--                                          activation-síðan; get_web_activation HELST
--   api.v_sku_category                     flokkar í gamla innkaupalistanum
--   api.sales_tasks (tafla)                verkefnin sjálf — GÖGNIN HALDAST
--
-- HALDAST (nýja síðan notar): get_customer_last_orders, get_web_activation,
-- resolve_customer_family_ids, get_customer_priority_flags og skriffölin.
--
-- TVÖ SKREF, viljandi:
--   1. AFTURKALLA (hér, keyra núna). Vafrinn nær ekki lengur í neitt af þessu.
--      Ef eitthvað sem leitin missti af notar fall kemur „permission denied“
--      strax — og skref „Afturkalla afturköllun“ neðst skilar því á sekúndu.
--   2. EYÐA (neðst, útkommentað) eftir ~2 vikur án kvartana.
-- service_role heldur réttindum í skrefi 1, svo GAS og SQL-ritillinn sjá allt.
-- ============================================================================


-- ── 0. Yfirlit fyrir (les aðeins) ───────────────────────────────────
select n.nspname || '.' || p.proname                      as fall,
       pg_get_function_identity_arguments(p.oid)          as rok,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as innskradir
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (
  ('api', 'generate_shopping_list_v1'), ('api', 'generate_shopping_list_v2'),
  ('api', 'generate_shopping_list_v3'), ('public', 'generate_shopping_list_v1'),
  ('api', 'get_customer_profile_family_summary'),
  ('api', 'create_sales_task'), ('api', 'complete_sales_task'), ('api', 'get_open_tasks'),
  ('api', 'web_activation_kpis'), ('api', 'web_activation_state_counts'), ('api', 'web_activation_by_rep'))
order by 1, 2;


-- ── 1. Afturkalla ───────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('api', 'generate_shopping_list_v1'), ('api', 'generate_shopping_list_v2'),
      ('api', 'generate_shopping_list_v3'), ('public', 'generate_shopping_list_v1'),
      ('api', 'get_customer_profile_family_summary'),
      ('api', 'create_sales_task'), ('api', 'complete_sales_task'), ('api', 'get_open_tasks'),
      ('api', 'web_activation_kpis'), ('api', 'web_activation_state_counts'), ('api', 'web_activation_by_rep'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    raise notice 'afturkallað: %', r.sig;
  end loop;

  -- Sýn og tafla: aðeins ef þær eru til (sumar urðu til beint í ritlinum).
  if to_regclass('api.v_sku_category') is not null then
    execute 'revoke all on api.v_sku_category from anon, authenticated';
    raise notice 'afturkallað: api.v_sku_category';
  end if;
  if to_regclass('api.sales_tasks') is not null then
    execute 'revoke all on api.sales_tasks from anon, authenticated';
    raise notice 'afturkallað: api.sales_tasks (gögnin haldast)';
  end if;
  if to_regclass('public.sales_tasks') is not null then
    execute 'revoke all on public.sales_tasks from anon, authenticated';
    raise notice 'afturkallað: public.sales_tasks (gögnin haldast)';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Staðfesting: keyrðu skref 0 aftur — anon og innskradir eiga að vera false
-- í öllum línum.


-- ── Afturkalla afturköllun (ef eitthvað brotnar) ────────────────────
-- grant execute on function api.<fall>(<rök úr skrefi 0>) to authenticated;
-- notify pgrst, 'reload schema';


-- ── 2. Eyða — EFTIR ~2 vikur án kvartana (útkommentað) ─────────────
-- Fyrst gögnin úr verkefnunum, ef einhver vill þau:
--   select * from api.sales_tasks order by created_at desc;
--
-- do $$
-- declare r record;
-- begin
--   for r in
--     select p.oid::regprocedure as sig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where (n.nspname, p.proname) in (
--       ('api', 'generate_shopping_list_v1'), ('api', 'generate_shopping_list_v2'),
--       ('api', 'generate_shopping_list_v3'), ('public', 'generate_shopping_list_v1'),
--       ('api', 'get_customer_profile_family_summary'),
--       ('api', 'create_sales_task'), ('api', 'complete_sales_task'), ('api', 'get_open_tasks'),
--       ('api', 'web_activation_kpis'), ('api', 'web_activation_state_counts'), ('api', 'web_activation_by_rep'))
--   loop
--     execute format('drop function %s', r.sig);   -- ekki cascade: stöðvast ef eitthvað byggir á því
--   end loop;
-- end $$;
-- drop view if exists api.v_sku_category;           -- ekki cascade
-- -- api.sales_tasks / public.sales_tasks: eyða aðeins ef enginn vill gögnin.

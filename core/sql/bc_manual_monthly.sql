-- ============================================================================
-- Handvirkar BC-mánaðartölur í gagnagrunni (2026-10-09).
--
-- ÁÐUR: window.STORKAUP_BC_MANUAL í page head code á /kpi/dashboard og
-- /kpi/solutolur. Það stendur í vegi fyrir því að Webflow-lykilorðið megi
-- fara: án þess væru tölurnar í síðukóða sem hver sem er les.
-- NÚ: raw.bc_manual_monthly, lesið með public.get_bc_manual_monthly() —
-- aðeins `authenticated` (innskráðir starfsmenn). dashboard.js les hér fyrst
-- og notar síðukóðann aðeins til vara á meðan hann er enn til staðar.
--
-- TÖLURNAR ERU EKKI Í ÞESSARI SKRÁ — repo-ið er opinbert. Settar inn í
-- SQL-ritlinum:
--   insert into raw.bc_manual_monthly (month, web_orders_pct, web_revenue_pct, web_aov, bc_aov)
--   values ('2026-11', 0.44, 0.45, 75000, 72000)
--   on conflict (month) do update set
--     web_orders_pct = excluded.web_orders_pct, web_revenue_pct = excluded.web_revenue_pct,
--     web_aov = excluded.web_aov, bc_aov = excluded.bc_aov, updated_at = now();
--
-- Þegar Databricks tekur við reiknast þetta sjálfkrafa og taflan fyllist
-- af tímastýringu í stað handar.
-- ============================================================================

create table if not exists raw.bc_manual_monthly (
  month            text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  web_orders_pct   numeric null,
  web_revenue_pct  numeric null,
  web_aov          numeric null,
  bc_aov           numeric null,
  updated_at       timestamptz not null default now()
);
alter table raw.bc_manual_monthly enable row level security;
revoke all on table raw.bc_manual_monthly from public, anon, authenticated;
grant all privileges on table raw.bc_manual_monthly to service_role;

-- Sama lögun og window.STORKAUP_BC_MANUAL, svo dashboard.js breytist lítið:
--   { "2026-06": { "webOrdersPct": 0.385, "webRevenuePct": 0.419, "webAov": 80396, "bcAov": 69742 }, ... }
create or replace function public.get_bc_manual_monthly()
returns jsonb
language sql
stable
security definer
set search_path to 'raw', 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_object_agg(m.month, jsonb_build_object(
           'webOrdersPct',  m.web_orders_pct,
           'webRevenuePct', m.web_revenue_pct,
           'webAov',        m.web_aov,
           'bcAov',         m.bc_aov)), '{}'::jsonb)
  from raw.bc_manual_monthly m;
$function$;

revoke all on function public.get_bc_manual_monthly() from public, anon;
grant execute on function public.get_bc_manual_monthly() to authenticated, service_role;

notify pgrst, 'reload schema';

-- STAÐFESTING: anon = false, authenticated = true.
select has_function_privilege('anon', 'public.get_bc_manual_monthly()', 'execute') as anon,
       has_function_privilege('authenticated', 'public.get_bc_manual_monthly()', 'execute') as authenticated;

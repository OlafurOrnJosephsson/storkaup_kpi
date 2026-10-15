-- ============================================================================
-- priority_graduation_v1 — útskrift af forgangslistanum (2026-10-15)
--
-- Forgangslistinn er onboarding-listi: markmiðið er að viðskiptavinurinn
-- panti SJÁLFUR á vefnum. Þegar það hefur gerst nógu oft er verkinu lokið og
-- hann á ekki lengur að taka pláss á vinnulista sölumannsins.
--
-- ÚTSKRIFT, EKKI EYÐING: flaggið helst (status 'priority'), en fær
-- graduated_at + graduated_self_orders. Vinnulistinn felur útskrifaða og
-- sýnir þá í sér síu („Komnir á vef“), svo árangurinn sést og telst.
--
-- REGLAN: p_min_self_orders (sjálfgefið 1) vefpantanir sem viðskiptavinurinn
-- lagði SJÁLFUR inn eftir að hann var settur í forgang (created_at). Fyrsta
-- keyrsla 2026-10-15 notaði 2 (28 útskrifaðir); mörkin lækkuð í 1 sama dag,
-- í samræmi við stöðuna „Pantar sjálf/ur“ (onboarded_selfserve).
-- Sölumannspantanir á vef teljast ekki: nafn EÐA netfang pöntunar =
-- sölumannsreikningur (sama regla og is_rep_order / get_customer_reps_v1).
--
-- Keyrt daglega úr scheduledCustomerAnalysisSync_v1 (core/utils.js) með
-- service_role. Þess vegna í public-skemanu: callSupabaseRpc_ sendir engan
-- Content-Profile haus.
--
-- Keyra í Supabase SQL-ritlinum, Á EFTIR customer_priority_flags_history.sql.
-- Prófun með þurrkeyrslu neðst.
-- ============================================================================


-- ── 1. Dálkar ───────────────────────────────────────────────────────
alter table raw.customer_priority_flags_raw
  add column if not exists graduated_at          timestamptz null,
  add column if not exists graduated_self_orders integer null,
  -- Talning sjálfspantana byrjar hér ef sett (eftir „Aftur á vinnulista“),
  -- annars við created_at. created_at sjálfu er aldrei breytt.
  add column if not exists onboard_from          timestamptz null;


-- ── 2. Útskrift (service_role, daglega) ─────────────────────────────
create or replace function public.graduate_priority_customers_v1(
  p_min_self_orders integer default 1,
  p_dry_run         boolean default true
)
returns table (
  out_family_id     text,
  out_customer_name text,
  out_self_orders   bigint,
  out_flagged_at    timestamptz,
  out_graduated     boolean
)
language plpgsql
security definer
set search_path to 'raw', 'public', 'pg_temp'
as $function$
declare
  v_min integer := greatest(coalesce(p_min_self_orders, 1), 1);
begin
  create temp table if not exists _grad_cand (
    family_id text, customer_name text, self_orders bigint, flagged_at timestamptz
  ) on commit drop;
  truncate _grad_cand;

  insert into _grad_cand
  with reps as (
    select r.name_norm, lower(btrim(coalesce(r.email_norm, ''))) as email_norm
    from raw.sales_reps_ref r
    where coalesce(r.active, true) and btrim(coalesce(r.name_norm, '')) <> ''
      and regexp_replace(regexp_replace(lower(r.name_norm), 'solumadur|storkaup', '', 'g'), '[^a-z0-9]', '', 'g')
          not in ('', 'vefur')
  )
  select f.customer_family_id, f.customer_name,
         (select count(distinct o.order_id)
          from raw.newweb_orders_raw o
          where regexp_replace(coalesce(o.company_id, ''), '\D', '', 'g') = f.customer_family_id
            and o.purchase_date >= coalesce(f.onboard_from, f.created_at)
            and not exists (
              select 1 from reps r
              where r.name_norm = regexp_replace(lower(translate(coalesce(o.customer_name, ''),
                                    'áðþæöéíóúýÁÐÞÆÖÉÍÓÚÝ', 'adthaeoeiouyadthaeoeiouy')), '[^a-z0-9]+', '', 'g')
                 or (r.email_norm <> ''
                     and r.email_norm = lower(btrim(coalesce(to_jsonb(o) ->> 'real_email', '')))))),
         coalesce(f.onboard_from, f.created_at)
  from raw.customer_priority_flags_raw f
  where f.status = 'priority' and f.graduated_at is null;

  delete from _grad_cand where self_orders < v_min;

  if not coalesce(p_dry_run, true) then
    update raw.customer_priority_flags_raw f
    set graduated_at = now(), graduated_self_orders = c.self_orders, updated_at = now()
    from _grad_cand c
    where f.customer_family_id = c.family_id and f.graduated_at is null;
  end if;

  return query
  select c.family_id, c.customer_name, c.self_orders, c.flagged_at, not coalesce(p_dry_run, true)
  from _grad_cand c
  order by c.self_orders desc, c.family_id;
end;
$function$;

revoke all on function public.graduate_priority_customers_v1(integer, boolean) from public, anon, authenticated;
grant execute on function public.graduate_priority_customers_v1(integer, boolean) to service_role;


-- ── 3. Lesa + afturkalla (viðmótið) ─────────────────────────────────
create or replace function api.get_graduated_customers_v1()
returns table (
  customer_family_id    text,
  customer_id           text,
  graduated_at          timestamptz,
  graduated_self_orders integer
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  select f.customer_family_id, f.customer_id, f.graduated_at, f.graduated_self_orders
  from raw.customer_priority_flags_raw f
  where f.graduated_at is not null and f.status = 'priority';
$function$;

-- „Aftur á vinnulista“: viðskiptavinurinn er útskrifaður en sölumaður vill
-- halda áfram (t.d. pantaði tvisvar og hætti). Talningin byrjar upp á nýtt
-- frá deginum í dag (onboard_from), svo hann útskrifast ekki strax aftur á
-- gömlu pöntununum.
create or replace function api.ungraduate_customer_v1(p_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'api', 'raw', 'public'
as $function$
declare
  v_raw  text := trim(coalesce(p_customer_id, ''));
  v_norm text := regexp_replace(v_raw, '\D', '', 'g');
  v_key  text := case when v_norm <> '' then v_norm else lower(v_raw) end;
begin
  update raw.customer_priority_flags_raw f
  set graduated_at = null, graduated_self_orders = null,
      onboard_from = now(),
      updated_at = now()
  where f.customer_family_id = v_key and f.graduated_at is not null;
  return jsonb_build_object('ok', true, 'customer_family_id', v_key);
end;
$function$;

revoke all on function api.get_graduated_customers_v1()   from public, anon;
revoke all on function api.ungraduate_customer_v1(text)    from public, anon;
grant execute on function api.get_graduated_customers_v1() to authenticated, service_role;
grant execute on function api.ungraduate_customer_v1(text)  to authenticated, service_role;

notify pgrst, 'reload schema';


-- ── PRÓFUN ──────────────────────────────────────────────────────────
-- Þurrkeyrsla — hverjir myndu útskrifast (breytir engu):
--   select * from public.graduate_priority_customers_v1(1, true);
-- Raunkeyrsla (GAS gerir þetta daglega; óþarfi að keyra hér nema til að byrja):
--   select * from public.graduate_priority_customers_v1(1, false);

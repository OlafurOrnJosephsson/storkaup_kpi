-- Weekly digest stats — called by scheduledWeeklyDigest in core/email.js
-- Returns one JSONB object with all KPIs for the 7-day window [p_week_start, p_week_start+7).
-- Apply in Supabase SQL editor.
--
-- VEFSALA ÚR BC (2026-10-23). Magento API lokaðist 2026-10-21 og
-- raw.newweb_orders_raw hætti að fyllast, svo vefhlutinn sýndi hrun. Vefsala er
-- nú bókaðir reikningar með salesperson_code = 'VEFUR' — sama regla og
-- vefhlutfallið (mart.v_bc_monthly_net_v1). Vikan miðast við BÓKUNARDAG
-- reiknings, báðar vikur, svo samanburðurinn er sambærilegur; 90% vefpantana
-- eru bókaðar innan dags (mælt 2026-10-21).
--   web_orders        = fjöldi VEFUR-reikninga (kreditreikningar eru skil, ekki
--                       neikvæðar pantanir)
--   web_revenue_excl  = VEFUR-reikningar − VEFUR-kreditreikningar, án VSK
--   nýir viðskiptavinir: fyrsta vefkaup fyrirtækis (kennitala) úr Magento-sögu
--                       OG VEFUR-reikningum, svo eldri vefkúnnar teljist ekki nýir
--   bc_as_of          = síðasti bókunardagur í BC-gögnunum. Pósturinn varar við
--                       ef hann nær ekki út vikuna (BC-útflutningur gleymdist).
-- Lyklarnir sem core/email.js les eru óbreyttir.

create or replace function public.weekly_digest_stats(
  p_week_start date default (current_date - 7)
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'mart', 'raw'
as $function$
with
params as (
  select
    p_week_start::date       as week_start,
    (p_week_start + 7)::date as week_end
),
-- Previous week window (for % vs síðasta vika comparisons)
prev_params as (
  select
    (p_week_start - 7)::date as week_start,
    p_week_start::date       as week_end
),

-- ── Web = bókaðir VEFUR-reikningar í BC ──────────────────────────────────────
vefur_inv as (
  select
    i.document_no,
    i.booking_date::date as day,
    regexp_replace(coalesce(i.company_id, ''), '\D', '', 'g') as buyer_key,
    nullif(trim(i.company_name), '') as name,
    coalesce(i.amount_excl, 0) as amount_excl
  from raw.bc_invoices_raw i
  where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
    and i.booking_date is not null
),
vefur_cr as (
  select c.booking_date::date as day, coalesce(c.amount_excl, 0) as amount_excl
  from raw.bc_credit_invoices_raw c
  where upper(trim(coalesce(c.salesperson_code, ''))) = 'VEFUR'
    and c.booking_date is not null
),
web_agg as (
  select
    (select count(distinct v.document_no) from vefur_inv v
      where v.day >= p.week_start and v.day < p.week_end)::int as orders,
    (select coalesce(sum(v.amount_excl), 0) from vefur_inv v
      where v.day >= p.week_start and v.day < p.week_end)
    - (select coalesce(sum(c.amount_excl), 0) from vefur_cr c
      where c.day >= p.week_start and c.day < p.week_end) as revenue_excl
  from params p
),
prev_web as (
  select
    (select count(distinct v.document_no) from vefur_inv v
      where v.day >= p.week_start and v.day < p.week_end)::int as orders,
    (select coalesce(sum(v.amount_excl), 0) from vefur_inv v
      where v.day >= p.week_start and v.day < p.week_end)
    - (select coalesce(sum(c.amount_excl), 0) from vefur_cr c
      where c.day >= p.week_start and c.day < p.week_end) as revenue_excl
  from prev_params p
),

-- ── BC invoices ───────────────────────────────────────────────────────────────
bc_inv as (
  select count(*)::int as orders, coalesce(sum(amount_excl), 0) as revenue_excl
  from raw.bc_invoices_raw, params
  where booking_date >= week_start::timestamp and booking_date < week_end::timestamp
),
bc_cr as (
  select count(*)::int as orders, coalesce(sum(amount_excl), 0) as revenue_excl
  from raw.bc_credit_invoices_raw, params
  where booking_date >= week_start::timestamp and booking_date < week_end::timestamp
),
prev_bc_inv as (
  select count(*)::int as orders, coalesce(sum(amount_excl), 0) as revenue_excl
  from raw.bc_invoices_raw, prev_params
  where booking_date >= week_start::timestamp and booking_date < week_end::timestamp
),
prev_bc_cr as (
  select count(*)::int as orders, coalesce(sum(amount_excl), 0) as revenue_excl
  from raw.bc_credit_invoices_raw, prev_params
  where booking_date >= week_start::timestamp and booking_date < week_end::timestamp
),

-- ── Buyer identity (used for new-customer detection) ─────────────────────────
-- Fyrsta vefkaup = það fyrra af Magento-sögunni (til 2026-10-21) og
-- VEFUR-reikningum. Lykill = kennitala, aðeins tölustafir, báðum megin.
first_seen as (
  select buyer_key, min(first_day) as first_day
  from (
    select regexp_replace(coalesce(n.company_id, ''), '\D', '', 'g') as buyer_key,
           min(n.purchase_date::date) as first_day
    from raw.newweb_orders_raw n
    where n.purchase_date is not null
    group by 1
    union all
    select v.buyer_key, min(v.day)
    from vefur_inv v
    group by 1
  ) u
  where buyer_key <> ''
  group by 1
),

-- Aggregate current-week orders by buyer (used for top buyers + new customer list)
weekly_buyer_agg as (
  select
    nullif(v.buyer_key, '')                          as buyer_key,
    max(coalesce(v.name, 'Óþekktur'))                as name,
    count(distinct v.document_no)::int               as orders,
    coalesce(sum(v.amount_excl), 0)::numeric         as revenue
  from vefur_inv v, params
  where v.day >= params.week_start
    and v.day <  params.week_end
  group by 1
),

-- ── Top 3 buyers this week ────────────────────────────────────────────────────
top_buyers as (
  select name, orders, revenue as revenue_excl
  from weekly_buyer_agg
  where buyer_key is not null
  order by revenue desc
  limit 3
),

-- ── New customers this week (first purchase in window) ────────────────────────
new_cust_list as (
  select wo.name, wo.revenue
  from weekly_buyer_agg wo
  join first_seen fs on fs.buyer_key = wo.buyer_key
  cross join params
  where wo.buyer_key is not null
    and fs.first_day >= params.week_start
    and fs.first_day <  params.week_end
  order by wo.revenue desc
  limit 10
),
new_cust_count as (
  select count(*)::int as cnt
  from weekly_buyer_agg wo
  join first_seen fs on fs.buyer_key = wo.buyer_key
  cross join params
  where wo.buyer_key is not null
    and fs.first_day >= params.week_start
    and fs.first_day <  params.week_end
),
-- 30-day new customer count (trailing 30 days ending at week_end)
new_cust_30d as (
  select count(*)::int as cnt
  from first_seen fs, params
  where fs.buyer_key is not null
    and fs.first_day >= (params.week_end - 30)
    and fs.first_day <  params.week_end
),

-- ── Klaviyo 30-day nobot attribution ─────────────────────────────────────────
kl as (
  select
    coalesce(sum(attributed_orders), 0)::int  as orders,
    coalesce(sum(attributed_revenue_excl), 0) as revenue_excl,
    coalesce(sum(attributed_revenue_incl), 0) as revenue_incl
  from mart.mv_klaviyo_attribution_daily_nobot, params
  where order_date >= (params.week_end - 30)
    and order_date <   params.week_end
)

select jsonb_build_object(
  -- Window labels
  'week_start',               (select week_start from params),
  'week_end',                 (select week_end   from params),

  -- Hvaðan vefsalan kemur og hversu ferskt BC er
  'web_source',               'bc_vefur',
  'bc_as_of',                 (select max(booking_date)::date from raw.bc_invoices_raw),

  -- Current week web
  'web_orders',               (select orders       from web_agg),
  'web_revenue_excl',         (select revenue_excl from web_agg),
  -- Previous week web
  'prev_web_orders',          (select orders       from prev_web),
  'prev_web_revenue_excl',    (select revenue_excl from prev_web),

  -- Current week BC net (invoices − credits)
  'bc_net_orders',            (select inv.orders       - cr.orders       from bc_inv inv cross join bc_cr cr),
  'bc_net_revenue_excl',      (select inv.revenue_excl - cr.revenue_excl from bc_inv inv cross join bc_cr cr),
  -- Previous week BC net
  'prev_bc_net_orders',       (select inv.orders       - cr.orders       from prev_bc_inv inv cross join prev_bc_cr cr),
  'prev_bc_net_revenue_excl', (select inv.revenue_excl - cr.revenue_excl from prev_bc_inv inv cross join prev_bc_cr cr),

  -- New customers
  'new_customers',            (select cnt from new_cust_count),
  'new_customers_30d',        (select cnt from new_cust_30d),
  'new_customers_list',       (
    select jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue))
    from new_cust_list
  ),

  -- Top 3 buyers by web revenue this week
  'top_customers',            (
    select jsonb_agg(jsonb_build_object('name', name, 'orders', orders, 'revenue_excl', revenue_excl))
    from top_buyers
  ),

  -- Klaviyo 30-day nobot
  'klaviyo_orders',           (select orders       from kl),
  'klaviyo_revenue_excl',     (select revenue_excl from kl),
  'klaviyo_revenue_incl',     (select revenue_incl from kl)
);
$function$;

-- service_role only (2026-10-08, security_revoke_anon_digests.sql). The only
-- caller is core/email.js via callSupabaseRpc_ with the service_role key.
-- Do not re-grant anon: this returns BC revenue and top customers.
revoke all on function public.weekly_digest_stats(date) from public, anon, authenticated;
grant execute on function public.weekly_digest_stats(date) to service_role;

-- GA4/BC-brúin: hraði (2026-10-23)
--
-- VANDINN: eftir GA4-brúna (ga4_realtime_v1.sql, get_day_orders.sql) skiluðu
-- day_kpi_pack og get_day_orders 500 í vafranum (tímamörk innskráðra ~8 s).
-- get_day_orders tók 4,0 s í SQL-ritlinum. Föllin reiknuðu Magento-hlutann
-- upp á nýtt í hverju kalli yfir alla söguna — dagsummur, fyrsta kaupdag hvers
-- kaupanda, kvörðunartölur — þó að Magento-gögnin séu FROSIN síðan API-ið
-- lokaðist 2026-10-21. day_kpi_pack les view-ið þrisvar (dagur, í gær, viku fyrr).
--
-- LAUSNIN: það sem breytist ekki er reiknað EINU SINNI og geymt:
--   mart.web_daily_mag_frozen      dagsummur úr mart.v_web_orders_unified
--   mart.web_first_seen_frozen     fyrsti vefkaupdagur á buyer_key (eins og áður)
--   mart.web_first_seen_kt_frozen  fyrsti vefkaupdagur á kennitölu (Magento)
--   mart.ga4_bridge_calibration    kvörðun úr skörun 1.–20. okt + lokunartími
-- mart.refresh_web_bridge_frozen_v1() fyllir þær. Keyrt neðst í þessari skrá.
--
-- ⚠ EF MAGENTO KEMST AFTUR Í GANG (SETTINGS.MAGENTO_API_ENABLED aftur true):
-- keyrið  select mart.refresh_web_bridge_frozen_v1();  eftir að safePoll hefur
-- náð upp. Annars vantar nýju Magento-pantanirnar í mælaborðið: view-ið les
-- frosnu summurnar, og GA4-hlutinn sleppir pöntunum sem eru í Magento-töflunni.
--
-- Skiptir út view-hlutanum í core/sql/ga4_realtime_v1.sql (sömu 11 dálkar, sama
-- röð og tegund). get_day_orders er í core/sql/get_day_orders.sql — keyrið þá
-- skrá Á EFTIR þessari.

-- ── Töflur ──────────────────────────────────────────────────────────────────
create table if not exists mart.web_daily_mag_frozen (
  day                  date primary key,
  orders               bigint  not null,
  revenue_incl         numeric not null,
  revenue_excl         numeric not null,
  newweb_revenue_incl  numeric not null,
  oldweb_revenue_incl  numeric not null
);

create table if not exists mart.web_first_seen_frozen (
  buyer_key  text primary key,
  first_day  date not null
);

create table if not exists mart.web_first_seen_kt_frozen (
  k          text primary key,
  first_day  date not null
);

create table if not exists mart.ga4_bridge_calibration (
  id                int primary key default 1 check (id = 1),
  order_capture     numeric,      -- GA4-pantanir / Magento-pantanir, 1.–20. okt
  revenue_capture   numeric,      -- GA4-velta / revenue_incl view-sins
  excl_ratio        numeric,      -- revenue_excl / revenue_incl view-sins
  grand_excl_ratio  numeric,      -- subtotal_excl / grand_total (Magento) — fyrir get_day_orders
  min_order_id      bigint,       -- lægsta Magento-pöntunarnr. frá 1. okt (síar gömul númer)
  cutover_ts        timestamptz,  -- síðasta Magento-pöntun
  computed_at       timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['web_daily_mag_frozen','web_first_seen_frozen','web_first_seen_kt_frozen','ga4_bridge_calibration']
  loop
    execute format('alter table mart.%I enable row level security', t);
    execute format('revoke all on mart.%I from public, anon, authenticated', t);
    execute format('grant select on mart.%I to service_role', t);
  end loop;
end $$;

-- ── Endurreikningur ─────────────────────────────────────────────────────────
create or replace function mart.refresh_web_bridge_frozen_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'mart', 'raw', 'public'
as $$
declare
  d0 constant date := date '2026-10-01';
  d1 constant date := date '2026-10-20';
  v_min_id bigint;
  out jsonb;
begin
  truncate mart.web_daily_mag_frozen;
  insert into mart.web_daily_mag_frozen (day, orders, revenue_incl, revenue_excl, newweb_revenue_incl, oldweb_revenue_incl)
  select
    date_trunc('day', purchase_date)::date,
    count(distinct order_id),
    sum(coalesce(revenue_incl, 0::numeric)),
    sum(coalesce(revenue_excl, 0::numeric)),
    sum(case when source = 'NEWWEB' then coalesce(revenue_incl, 0::numeric) else 0::numeric end),
    sum(case when source = 'OLDWEB' then coalesce(revenue_incl, 0::numeric) else 0::numeric end)
  from mart.v_web_orders_unified
  where purchase_date is not null
  group by 1;

  truncate mart.web_first_seen_frozen;
  insert into mart.web_first_seen_frozen (buyer_key, first_day)
  select buyer_key, min(purchase_date)::date
  from (
    select
      case
        when nullif(trim(company_id), '') is not null then 'cid:' || trim(company_id)
        when nullif(trim(real_email), '') is not null then 'email:' || lower(trim(real_email))
        when nullif(trim(company_name), '') is not null then 'cname:' || lower(trim(company_name))
        when nullif(trim(customer_name), '') is not null then 'cust:' || lower(trim(customer_name))
        else null
      end as buyer_key,
      purchase_date
    from raw.newweb_orders_raw
    where purchase_date is not null
  ) s
  where buyer_key is not null
  group by 1;

  truncate mart.web_first_seen_kt_frozen;
  insert into mart.web_first_seen_kt_frozen (k, first_day)
  select k, min(d)
  from (
    select regexp_replace(coalesce(company_id, ''), '\D', '', 'g') as k, purchase_date::date as d
    from raw.newweb_orders_raw
    where purchase_date is not null
  ) s
  where k <> ''
  group by 1;

  select min(order_id::bigint) into v_min_id
  from raw.newweb_orders_raw
  where purchase_date >= d0 and order_id ~ '^\d+$';

  insert into mart.ga4_bridge_calibration
    (id, order_capture, revenue_capture, excl_ratio, grand_excl_ratio, min_order_id, cutover_ts, computed_at)
  select
    1,
    (select count(*) from raw.ga4_purchases_raw g
      where g.purchase_day between d0 and d1
        and g.transaction_id ~ '^\d+$' and g.transaction_id::bigint >= v_min_id)::numeric
      / nullif((select sum(f.orders) from mart.web_daily_mag_frozen f where f.day between d0 and d1), 0),
    (select sum(g.revenue_incl) from raw.ga4_purchases_raw g
      where g.purchase_day between d0 and d1
        and g.transaction_id ~ '^\d+$' and g.transaction_id::bigint >= v_min_id)
      / nullif((select sum(f.revenue_incl) from mart.web_daily_mag_frozen f where f.day between d0 and d1), 0),
    (select sum(f.revenue_excl) / nullif(sum(f.revenue_incl), 0)
      from mart.web_daily_mag_frozen f where f.day between d0 and d1),
    (select sum(n.subtotal_excl) / nullif(sum(n.grand_total), 0)
      from raw.newweb_orders_raw n where n.purchase_date >= d0 and n.purchase_date < d1 + 1),
    v_min_id,
    (select max(purchase_date) from raw.newweb_orders_raw),
    now()
  on conflict (id) do update set
    order_capture    = excluded.order_capture,
    revenue_capture  = excluded.revenue_capture,
    excl_ratio       = excluded.excl_ratio,
    grand_excl_ratio = excluded.grand_excl_ratio,
    min_order_id     = excluded.min_order_id,
    cutover_ts       = excluded.cutover_ts,
    computed_at      = excluded.computed_at;

  select jsonb_build_object(
    'days',          (select count(*) from mart.web_daily_mag_frozen),
    'buyers',        (select count(*) from mart.web_first_seen_frozen),
    'buyers_kt',     (select count(*) from mart.web_first_seen_kt_frozen),
    'calibration',   (select to_jsonb(c) from mart.ga4_bridge_calibration c where c.id = 1)
  ) into out;
  return out;
end;
$$;

revoke all on function mart.refresh_web_bridge_frozen_v1() from public, anon, authenticated;
grant execute on function mart.refresh_web_bridge_frozen_v1() to service_role;

select mart.refresh_web_bridge_frozen_v1();

-- ── View: frosnar Magento-summur + GA4 ──────────────────────────────────────
create or replace view mart.v_web_daily_unified as
with c as (
  select * from mart.ga4_bridge_calibration where id = 1
),
ga4_valid as (
  select g.transaction_id, g.purchase_day, g.purchase_hour, g.revenue_incl
  from raw.ga4_purchases_raw g, c
  where g.transaction_id ~ '^\d+$'
    and g.transaction_id::bigint >= c.min_order_id
),
aov as (
  select sum(revenue_incl) / nullif(count(*), 0) as aov_incl
  from ga4_valid
  where purchase_day >= current_date - 14
),
-- Fyrsta klukkustund sem venjulega GA4-API-ið hefur EKKI skilað.
std_edge as (
  select coalesce(
    max((g.purchase_day + make_interval(hours => coalesce(g.purchase_hour, 0)::int)) at time zone 'UTC') + interval '1 hour',
    '-infinity'::timestamptz
  ) as ts
  from ga4_valid g
),
ga4_std as (
  select g.purchase_day as day, count(*)::numeric as orders_raw, sum(g.revenue_incl) as revenue_incl_raw, 0::numeric as rt_orders_raw
  from ga4_valid g, c
  where g.purchase_day >= c.cutover_ts::date
    and not exists (select 1 from raw.newweb_orders_raw n where n.order_id = g.transaction_id)
  group by 1
),
ga4_rt as (
  select
    (r.minute_ts at time zone 'UTC')::date as day,
    sum(r.purchases)::numeric as orders_raw,
    sum(r.purchases) * max(a.aov_incl) as revenue_incl_raw,
    sum(r.purchases)::numeric as rt_orders_raw
  from raw.ga4_realtime_purchases_raw r, std_edge s, c, aov a
  where r.minute_ts >= s.ts
    and r.minute_ts > c.cutover_ts
  group by 1
),
ga4_est as (
  select day, sum(orders_raw) as orders_raw, sum(revenue_incl_raw) as revenue_incl_raw, sum(rt_orders_raw) as rt_orders_raw
  from (select * from ga4_std union all select * from ga4_rt) e
  group by day
)
select
  u.day,
  sum(u.orders)::bigint               as orders,
  sum(u.revenue_incl)                 as revenue_incl,
  sum(u.revenue_excl)                 as revenue_excl,
  sum(u.newweb_revenue_incl)          as newweb_revenue_incl,
  sum(u.oldweb_revenue_incl)          as oldweb_revenue_incl,
  sum(u.ga4_orders_raw)::bigint       as ga4_orders_raw,
  sum(u.ga4_revenue_incl_raw)         as ga4_revenue_incl_raw,
  sum(u.ga4_orders_est)::bigint       as ga4_orders_est,
  sum(u.ga4_revenue_incl_est)         as ga4_revenue_incl_est,
  sum(u.ga4_rt_orders_raw)::bigint    as ga4_rt_orders_raw
from (
  select f.day, f.orders::numeric, f.revenue_incl, f.revenue_excl, f.newweb_revenue_incl, f.oldweb_revenue_incl,
         0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric
  from mart.web_daily_mag_frozen f
  union all
  select
    e.day,
    round(e.orders_raw / nullif(c.order_capture, 0)),
    e.revenue_incl_raw / nullif(c.revenue_capture, 0),
    e.revenue_incl_raw / nullif(c.revenue_capture, 0) * c.excl_ratio,
    e.revenue_incl_raw / nullif(c.revenue_capture, 0),
    0::numeric,
    e.orders_raw,
    e.revenue_incl_raw,
    round(e.orders_raw / nullif(c.order_capture, 0)),
    e.revenue_incl_raw / nullif(c.revenue_capture, 0),
    e.rt_orders_raw
  from ga4_est e, c
) u (day, orders, revenue_incl, revenue_excl, newweb_revenue_incl, oldweb_revenue_incl,
     ga4_orders_raw, ga4_revenue_incl_raw, ga4_orders_est, ga4_revenue_incl_est, ga4_rt_orders_raw)
group by u.day
order by 1 desc;

-- Staðfesting (les eingöngu) — sömu tölur og fyrir breytinguna, mun hraðar:
--   explain analyze select * from public.day_kpi_pack(date '2026-10-21');
--   select day, orders, round(revenue_excl) as revenue_excl, ga4_orders_raw, ga4_orders_est
--   from mart.v_web_daily_unified where day >= '2026-10-19' order by day;

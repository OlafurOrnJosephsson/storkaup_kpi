-- GA4 Realtime-lag ofan á GA4-brúna (2026-10-21, tilraun)
--
-- Venjulega GA4 Data API-ið skilar deginum í dag nokkrum klukkutímum of seint
-- (21. okt: pantanir frá 08:54 ekki komnar kl. 10:36). Realtime API sér
-- síðustu 30 mín innan 1–2 mín, en aðeins FJÖLDA purchase-atburða á mínútu:
-- engin upphæð, ekkert transactionId (engin síun á tvítalningu eða gömlum
-- pöntunarnúmerum). Þetta er því grófasta lagið:
--
--   Magento (til lokunar) → GA4 venjulegt (pantanir, raunupphæð) → GA4 realtime
--   (fjöldi, áætluð upphæð = fjöldi × meðalpöntun GA4 síðustu 14 daga)
--
-- Realtime-mínúta telst aðeins ef hún er EFTIR síðustu klukkustund sem
-- venjulega API-ið hefur skilað, og eftir síðustu Magento-pöntun. Þegar
-- venjulega API-ið nær klukkustundinni dettur realtime-talan út og raunin
-- kemur í staðinn — talan á mælaborðinu getur því hnikast til.
--
-- GA4-eignin er í Atlantic/Reykjavik = UTC; date/hour úr GA4 eru túlkuð sem UTC.
--
-- Skiptir út core/sql/web_daily_unified_ga4_v1.sql (sama view, sama
-- dálkaröð; ga4_rt_orders_raw bætt aftast).
--
-- Röð: keyra þessa skrá → installGa4RealtimeSyncTrigger_v1() í Apps Script.

create table if not exists raw.ga4_realtime_purchases_raw (
  minute_ts  timestamptz primary key,
  purchases  integer     not null default 0,
  synced_at  timestamptz not null default now()
);

alter table raw.ga4_realtime_purchases_raw enable row level security;
revoke all on raw.ga4_realtime_purchases_raw from public, anon, authenticated;
grant select, insert, update on raw.ga4_realtime_purchases_raw to service_role;

create or replace view mart.v_web_daily_unified as
with mag as (
  select
    date_trunc('day', purchase_date)::date as day,
    count(distinct order_id) as orders,
    sum(coalesce(revenue_incl, 0::numeric)) as revenue_incl,
    sum(coalesce(revenue_excl, 0::numeric)) as revenue_excl,
    sum(case when source = 'NEWWEB' then coalesce(revenue_incl, 0::numeric) else 0::numeric end) as newweb_revenue_incl,
    sum(case when source = 'OLDWEB' then coalesce(revenue_incl, 0::numeric) else 0::numeric end) as oldweb_revenue_incl
  from mart.v_web_orders_unified
  where purchase_date is not null
  group by 1
),
win as (
  select date '2026-10-01' as d0, date '2026-10-20' as d1
),
mag_last as (
  select max(purchase_date) as ts from raw.newweb_orders_raw
),
cutover as (
  select ts::date as day from mag_last
),
id_floor as (
  select min(n.order_id::bigint) as min_id
  from raw.newweb_orders_raw n, win
  where n.purchase_date >= win.d0
    and n.order_id ~ '^\d+$'
),
ga4_valid as (
  select g.transaction_id, g.purchase_day, g.purchase_hour, g.revenue_incl
  from raw.ga4_purchases_raw g, id_floor f
  where g.transaction_id ~ '^\d+$'
    and g.transaction_id::bigint >= f.min_id
),
calib as (
  select
    (select count(*) from ga4_valid g, win where g.purchase_day between win.d0 and win.d1)::numeric
      / nullif((select sum(m.orders) from mag m, win where m.day between win.d0 and win.d1), 0) as order_capture,
    (select sum(g.revenue_incl) from ga4_valid g, win where g.purchase_day between win.d0 and win.d1)
      / nullif((select sum(m.revenue_incl) from mag m, win where m.day between win.d0 and win.d1), 0) as revenue_capture,
    (select sum(m.revenue_excl) / nullif(sum(m.revenue_incl), 0) from mag m, win where m.day between win.d0 and win.d1) as excl_ratio,
    (select sum(g.revenue_incl) / nullif(count(*), 0) from ga4_valid g
      where g.purchase_day >= current_date - 14) as aov_incl
),
-- Fyrsta klukkustund sem venjulega API-ið hefur EKKI skilað. Les ga4_valid,
-- ekki hráu töfluna: skoðun á gamalli pöntun í dag má ekki færa brúnina.
-- Klukkustund sem venjulega API-ið hefur skilað AÐ HLUTA færir brúnina samt,
-- svo realtime fyrir hana dettur út of snemma — tímabundin vanmæling, ekki
-- tvítalning.
std_edge as (
  select coalesce(
    max((g.purchase_day + make_interval(hours => coalesce(g.purchase_hour, 0)::int)) at time zone 'UTC') + interval '1 hour',
    '-infinity'::timestamptz
  ) as ts
  from ga4_valid g
),
ga4_std as (
  select g.purchase_day as day, count(*) as orders_raw, sum(g.revenue_incl) as revenue_incl_raw, 0::bigint as rt_orders_raw
  from ga4_valid g, cutover c
  where g.purchase_day >= c.day
    and not exists (select 1 from raw.newweb_orders_raw n where n.order_id = g.transaction_id)
  group by 1
),
ga4_rt as (
  select
    (r.minute_ts at time zone 'UTC')::date as day,
    sum(r.purchases)::bigint as orders_raw,
    sum(r.purchases) * max(c.aov_incl) as revenue_incl_raw,
    sum(r.purchases)::bigint as rt_orders_raw
  from raw.ga4_realtime_purchases_raw r, std_edge s, mag_last ml, calib c
  where r.minute_ts >= s.ts
    and r.minute_ts > coalesce(ml.ts, '-infinity'::timestamptz)
  group by 1
),
ga4_extra as (
  select day, sum(orders_raw) as orders_raw, sum(revenue_incl_raw) as revenue_incl_raw, sum(rt_orders_raw) as rt_orders_raw
  from (select * from ga4_std union all select * from ga4_rt) u
  group by day
),
ga4_est as (
  select
    e.day,
    e.orders_raw,
    e.revenue_incl_raw,
    e.rt_orders_raw,
    round(e.orders_raw / nullif(c.order_capture, 0))::bigint                as orders_est,
    e.revenue_incl_raw / nullif(c.revenue_capture, 0)                       as revenue_incl_est,
    e.revenue_incl_raw / nullif(c.revenue_capture, 0) * c.excl_ratio        as revenue_excl_est
  from ga4_extra e, calib c
)
select
  coalesce(m.day, e.day)                                                     as day,
  (coalesce(m.orders, 0) + coalesce(e.orders_est, 0))::bigint                as orders,
  coalesce(m.revenue_incl, 0::numeric) + coalesce(e.revenue_incl_est, 0::numeric) as revenue_incl,
  coalesce(m.revenue_excl, 0::numeric) + coalesce(e.revenue_excl_est, 0::numeric) as revenue_excl,
  coalesce(m.newweb_revenue_incl, 0::numeric) + coalesce(e.revenue_incl_est, 0::numeric) as newweb_revenue_incl,
  coalesce(m.oldweb_revenue_incl, 0::numeric)                                as oldweb_revenue_incl,
  coalesce(e.orders_raw, 0)::bigint                                          as ga4_orders_raw,
  coalesce(e.revenue_incl_raw, 0::numeric)                                   as ga4_revenue_incl_raw,
  coalesce(e.orders_est, 0)::bigint                                          as ga4_orders_est,
  coalesce(e.revenue_incl_est, 0::numeric)                                   as ga4_revenue_incl_est,
  coalesce(e.rt_orders_raw, 0)::bigint                                       as ga4_rt_orders_raw
from mag m
full outer join ga4_est e on e.day = m.day
order by 1 desc;

-- Staðfesting (les eingöngu):
--   select day, orders, round(revenue_excl) as revenue_excl,
--          ga4_orders_raw, ga4_rt_orders_raw, ga4_orders_est
--   from mart.v_web_daily_unified where day >= '2026-10-19' order by day;
--   select * from raw.ga4_realtime_purchases_raw order by minute_ts desc limit 20;

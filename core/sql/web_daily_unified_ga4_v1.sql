-- mart.v_web_daily_unified + GA4-brú (2026-10-21)
--
-- Magento API lokaðist 2026-10-21 og raw.newweb_orders_raw hætti að fyllast.
-- Þetta view er aðaluppspretta day_kpi_pack (pantanir, velta, samanburður við
-- gær/síðustu viku); auk þess les public.v_web_daily_unified það. Skilgreiningin
-- var EKKI í repoinu — sótt lifandi 2026-10-21 með pg_get_viewdef. Fyrstu sex
-- dálkarnir eru nákvæmlega þeir sömu (nafn, röð, tegund) svo create or replace
-- gangi og ekkert sem les view-ið breytist; GA4-dálkar eru aftast.
--
-- Reglur:
--   * Dagar FYRIR lokunardag eru óbreyttir — GA4 bætist aðeins við frá og með
--     degi síðustu Magento-pöntunar (cutover). Sagan hreyfist ekki.
--   * Engin tvítalning: GA4-pöntun sem er til í raw.newweb_orders_raw telst
--     ekki aftur. Gömul pöntunarnúmer (skoðun á eldri pöntun, ~2% í kvörðun)
--     síast út með gólfi = lægsta Magento-númer frá 1. okt.
--   * GA4 nær ~89% pantana. Uppreikningur er reiknaður HÉR úr skörun 1.–20. okt
--     (báðar uppsprettur virkar, eftir GTM v96/v97), ekki harðkóðaður:
--       order_capture   = GA4-pantanir / Magento-pantanir
--       revenue_capture = GA4-velta / revenue_incl view-sins
--       excl_ratio      = revenue_excl / revenue_incl view-sins
--   * ga4_*_raw = það sem GA4 sá; ga4_*_est = uppreiknað. Tölurnar í
--     orders / revenue_* eru Magento + ga4_est, og eru ÁÆTLUN á GA4-dögum.
--
-- Þegar BC VEFUR kemur úr Databricks kemur reikningsfærð vefsala í stað GA4
-- fyrir liðna daga; þá er þetta view endurskoðað.
--
-- FYRST: keyra core/sql/ga4_purchases_v1.sql og backfillGa4Purchases_v1().
-- Sé raw.ga4_purchases_raw tóm verður kvörðunin null og GA4-hlutinn 0 —
-- view-ið skilar þá nákvæmlega því sama og áður.

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
cutover as (
  select max(purchase_date)::date as day from raw.newweb_orders_raw
),
id_floor as (
  select min(n.order_id::bigint) as min_id
  from raw.newweb_orders_raw n, win
  where n.purchase_date >= win.d0
    and n.order_id ~ '^\d+$'
),
ga4_valid as (
  select g.transaction_id, g.purchase_day, g.revenue_incl
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
    (select sum(m.revenue_excl) / nullif(sum(m.revenue_incl), 0) from mag m, win where m.day between win.d0 and win.d1) as excl_ratio
),
ga4_extra as (
  select g.purchase_day as day, count(*) as orders_raw, sum(g.revenue_incl) as revenue_incl_raw
  from ga4_valid g, cutover c
  where g.purchase_day >= c.day
    and not exists (select 1 from raw.newweb_orders_raw n where n.order_id = g.transaction_id)
  group by 1
),
ga4_est as (
  select
    e.day,
    e.orders_raw,
    e.revenue_incl_raw,
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
  coalesce(e.revenue_incl_est, 0::numeric)                                   as ga4_revenue_incl_est
from mag m
full outer join ga4_est e on e.day = m.day
order by 1 desc;

-- Staðfesting eftir keyrslu (les eingöngu):
--   1) Dagar fyrir 21. okt eiga að vera óbreyttir og ga4-dálkarnir 0:
--      select day, orders, round(revenue_excl) as revenue_excl,
--             ga4_orders_raw, ga4_orders_est, round(ga4_revenue_incl_est) as ga4_rev_est
--      from mart.v_web_daily_unified where day >= '2026-10-15' order by day;
--   2) day_kpi_pack fyrir daginn í dag skilar pöntunum > 0:
--      select day, orders, revenue_excl from public.day_kpi_pack(current_date);

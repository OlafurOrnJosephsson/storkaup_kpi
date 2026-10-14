-- ============================================================================
-- api.v_customer_profiles + api.v_customer_profiles_labeled — LIFANDI
-- skilgreiningar, lesnar úr gagnagrunninum 2026-10-14 (pg_get_viewdef).
-- Voru hvergi í repoinu fyrr. Þetta er SKJÖLUN á því sem er í gangi, ekki
-- breyting — keyrðu ekki nema þú ætlir að endurskapa þau.
--
-- Keðjan:
--   mart.v_customer_profile_enriched   (ekki enn í repo)
--     -> api.v_customer_profiles        (+ web_365, web_avg úr newweb_orders_raw)
--     -> api.v_customer_profiles_labeled (+ lhfs_pct/percentile/label, cume_dist)
--     -> api.v_customer_profiles_labeled_trends (fix_orders_bc_365d.sql)
--     -> api.mv_customer_profiles_labeled_trends (customer_profiles_mv_v1.sql)
--
-- lhfs_label er hlutfallsröð (cume_dist) á low_hanging_fruit_score, ekki
-- föst mörk: „Very High" = efstu 10% hvað sem skorið sjálft er.
-- ============================================================================

create or replace view api.v_customer_profiles as
with web_orders as (
  select distinct trim(both from newweb_orders_raw.company_id) as customer_id,
         newweb_orders_raw.order_id,
         (newweb_orders_raw.purchase_date at time zone 'UTC')::date as order_date
  from raw.newweb_orders_raw
  where newweb_orders_raw.company_id is not null
    and trim(both from newweb_orders_raw.company_id) <> ''
    and newweb_orders_raw.order_id is not null
), web_365 as (
  select web_orders.customer_id,
         count(distinct web_orders.order_id) as orders_web_365d
  from web_orders
  where web_orders.order_date >= (current_date - '365 days'::interval)
  group by web_orders.customer_id
), web_gaps as (
  select d.customer_id,
         d.order_date,
         lag(d.order_date) over (partition by d.customer_id order by d.order_date) as prev_order_date
  from (select distinct web_orders.customer_id, web_orders.order_date from web_orders) d
), web_avg as (
  select web_gaps.customer_id,
         round(avg(web_gaps.order_date - web_gaps.prev_order_date), 1) as avg_days_between_web_orders
  from web_gaps
  where web_gaps.prev_order_date is not null
  group by web_gaps.customer_id
)
select p.customer_id,
       p.customer_name,
       p.webshop_active,
       p.primary_email,
       p.phone,
       p.recommended_action,
       p.potential_score,
       p.low_hanging_fruit_score,
       p.total_bc_orders,
       p.orders_bc_90d,
       p.orders_bc_365d,
       p.webshop_orders,
       p.webshop_sales,
       p.avg_days_between_bc_orders,
       p.estimated_order_interval_365d,
       p.primary_category,
       coalesce(w365.orders_web_365d, 0::bigint) as orders_web_365d,
       wavg.avg_days_between_web_orders
from mart.v_customer_profile_enriched p
left join web_365 w365 on w365.customer_id = p.customer_id
left join web_avg wavg on wavg.customer_id = p.customer_id
order by p.low_hanging_fruit_score desc, p.potential_score desc;


create or replace view api.v_customer_profiles_labeled as
with scored as (
  select p.customer_id,
         p.customer_name,
         p.webshop_active,
         p.primary_email,
         p.phone,
         p.recommended_action,
         p.potential_score,
         p.low_hanging_fruit_score,
         p.total_bc_orders,
         p.orders_bc_90d,
         p.orders_bc_365d,
         p.webshop_orders,
         p.webshop_sales,
         p.avg_days_between_bc_orders,
         p.estimated_order_interval_365d,
         p.primary_category,
         p.orders_web_365d,
         p.avg_days_between_web_orders,
         cume_dist() over (order by coalesce(p.low_hanging_fruit_score, 0::numeric)) as lhfs_pct
  from api.v_customer_profiles p
)
select customer_id,
       customer_name,
       webshop_active,
       primary_email,
       phone,
       recommended_action,
       potential_score,
       low_hanging_fruit_score,
       total_bc_orders,
       orders_bc_90d,
       orders_bc_365d,
       webshop_orders,
       webshop_sales,
       avg_days_between_bc_orders,
       estimated_order_interval_365d,
       primary_category,
       orders_web_365d,
       avg_days_between_web_orders,
       lhfs_pct,
       round((lhfs_pct * 100.0::double precision)::numeric, 1) as lhfs_percentile,
       case
         when lhfs_pct >= 0.90::double precision then 'Very High'
         when lhfs_pct >= 0.70::double precision then 'High'
         when lhfs_pct >= 0.40::double precision then 'Medium'
         else 'Low'
       end as lhfs_label
from scored;

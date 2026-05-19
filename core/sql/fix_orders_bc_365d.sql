-- Fix orders_bc_365d in api.v_customer_profiles_labeled_trends.
--
-- Root cause: p.orders_bc_365d comes from api.v_customer_profiles_labeled
-- (backed by raw.customer_analysis_raw) which has 0 for all rows.
-- avg_days_between_bc_orders works because it is also sourced from there
-- but was populated; orders_bc_365d was not.
--
-- Fix: add bc_orders_365d_rollup CTE computed live from bc_invoices_raw
-- (the bc_orders CTE is already in the view) and override p.orders_bc_365d.
--
-- Apply: run in Supabase SQL editor, then:
--   select public.refresh_mv_customer_profiles_labeled_trends();

create or replace view api.v_customer_profiles_labeled_trends as
with bc_orders as (
  select
    trim(both from i.company_id) as customer_id,
    i.document_no,
    i.order_date::date as order_date
  from raw.bc_invoices_raw i
  where i.company_id is not null
    and trim(both from i.company_id) <> ''
    and i.document_no is not null
    and i.order_date is not null
),
bc_orders_rollup as (
  select
    customer_id,
    count(distinct document_no) filter (
      where order_date >= current_date - interval '30 days'
        and order_date <  current_date + interval '1 day'
    ) as bc_orders_30d,
    count(distinct document_no) filter (
      where order_date >= current_date - interval '60 days'
        and order_date <  current_date - interval '30 days'
    ) as bc_orders_prev_30d
  from bc_orders
  group by customer_id
),
bc_orders_365d_rollup as (
  select
    customer_id,
    count(distinct document_no) filter (
      where order_date >= current_date - interval '365 days'
        and order_date <  current_date + interval '1 day'
    ) as orders_bc_365d
  from bc_orders
  group by customer_id
),
bc_revenue_rollup as (
  select
    trim(both from l.company_id) as customer_id,
    coalesce(sum(l.amount_excl) filter (
      where i.order_date::date >= current_date - interval '30 days'
        and i.order_date::date <  current_date + interval '1 day'
    ), 0) as bc_revenue_30d,
    coalesce(sum(l.amount_excl) filter (
      where i.order_date::date >= current_date - interval '60 days'
        and i.order_date::date <  current_date - interval '30 days'
    ), 0) as bc_revenue_prev_30d
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i
    on i.document_no = l.document_no
   and trim(both from i.company_id) = trim(both from l.company_id)
  where l.company_id is not null
    and trim(both from l.company_id) <> ''
  group by trim(both from l.company_id)
),
web_order_level as (
  select
    trim(both from n.company_id) as customer_id,
    n.order_id,
    min(n.purchase_date)::date as order_date,
    max(coalesce(n.subtotal_excl, 0)) as order_subtotal_excl
  from raw.newweb_orders_raw n
  where n.company_id is not null
    and trim(both from n.company_id) <> ''
    and n.order_id is not null
    and n.purchase_date is not null
  group by trim(both from n.company_id), n.order_id
),
web_rollup as (
  select
    customer_id,
    count(distinct order_id) filter (
      where order_date >= current_date - interval '30 days'
        and order_date <  current_date + interval '1 day'
    ) as web_orders_30d,
    count(distinct order_id) filter (
      where order_date >= current_date - interval '60 days'
        and order_date <  current_date - interval '30 days'
    ) as web_orders_prev_30d,
    coalesce(sum(order_subtotal_excl) filter (
      where order_date >= current_date - interval '30 days'
        and order_date <  current_date + interval '1 day'
    ), 0) as web_revenue_30d,
    coalesce(sum(order_subtotal_excl) filter (
      where order_date >= current_date - interval '60 days'
        and order_date <  current_date - interval '30 days'
    ), 0) as web_revenue_prev_30d
  from web_order_level
  group by customer_id
)
select
  p.customer_id,
  p.customer_name,
  p.webshop_active,
  p.primary_email,
  p.phone,
  p.recommended_action,
  p.potential_score,
  p.low_hanging_fruit_score,
  p.total_bc_orders,
  p.orders_bc_90d,
  coalesce(b365.orders_bc_365d, 0)        as orders_bc_365d,
  p.webshop_orders,
  p.webshop_sales,
  p.avg_days_between_bc_orders,
  p.estimated_order_interval_365d,
  p.primary_category,
  p.orders_web_365d,
  p.avg_days_between_web_orders,
  p.lhfs_pct,
  p.lhfs_percentile,
  p.lhfs_label,
  coalesce(bo.bc_orders_30d,      0)      as bc_orders_30d,
  coalesce(bo.bc_orders_prev_30d, 0)      as bc_orders_prev_30d,
  coalesce(bo.bc_orders_30d,      0)
    - coalesce(bo.bc_orders_prev_30d, 0)  as bc_orders_delta_30d,
  coalesce(br.bc_revenue_30d,     0)      as bc_revenue_30d,
  coalesce(br.bc_revenue_prev_30d,0)      as bc_revenue_prev_30d,
  coalesce(br.bc_revenue_30d,     0)
    - coalesce(br.bc_revenue_prev_30d, 0) as bc_revenue_delta_30d,
  coalesce(wr.web_orders_30d,     0)      as web_orders_30d,
  coalesce(wr.web_orders_prev_30d,0)      as web_orders_prev_30d,
  coalesce(wr.web_orders_30d,     0)
    - coalesce(wr.web_orders_prev_30d, 0) as web_orders_delta_30d,
  coalesce(wr.web_revenue_30d,    0)      as web_revenue_30d,
  coalesce(wr.web_revenue_prev_30d, 0)    as web_revenue_prev_30d,
  coalesce(wr.web_revenue_30d,    0)
    - coalesce(wr.web_revenue_prev_30d, 0) as web_revenue_delta_30d
from api.v_customer_profiles_labeled p
left join bc_orders_365d_rollup b365 on b365.customer_id = p.customer_id
left join bc_orders_rollup      bo   on bo.customer_id   = p.customer_id
left join bc_revenue_rollup     br   on br.customer_id   = p.customer_id
left join web_rollup            wr   on wr.customer_id   = p.customer_id;

-- Refresh MV after applying view change:
select public.refresh_mv_customer_profiles_labeled_trends();

-- Customer Segmentation + Solution Opportunity Model for Storkaup
-- Run in Supabase SQL editor.
-- Assumes raw tables already exist from your GAS backfills.
--
-- If a previous generation of these views is live with a different column
-- set, `create or replace view` fails (42P16: cannot change view columns).
-- Drop-first preamble (cascade also drops the solution_page_themes views —
-- re-apply solution_page_themes.sql right after this file):
--
--   drop view if exists api.v_solution_page_themes_v1 cascade;
--   drop view if exists api.v_category_pair_affinity_v1 cascade;
--   drop view if exists api.v_category_solution_fit_v1 cascade;
--   drop view if exists api.v_solution_hub_opportunity cascade;
--   drop view if exists api.v_customer_segments cascade;

create schema if not exists api;

-- 1) Behavior-first customer segments (no ISAT dependency)
-- Recency + BC order counts are computed live from raw.bc_invoices_raw:
-- the rollup columns in raw.customer_analysis_raw are unreliable
-- (last_bc_order_date null and orders_bc_365d zero for all rows — same
-- root cause fix_orders_bc_365d.sql already worked around for the trends MV).
create or replace view api.v_customer_segments as
with bc_rollup as (
  select
    trim(both from i.company_id) as customer_id,
    max(i.order_date::date) as last_bc_order_date,
    count(distinct i.document_no) filter (
      where i.order_date::date >= current_date - 90
    )::numeric as orders_bc_90d,
    count(distinct i.document_no) filter (
      where i.order_date::date >= current_date - 365
    )::numeric as orders_bc_365d
  from raw.bc_invoices_raw i
  where i.company_id is not null
    and trim(both from i.company_id) <> ''
    and i.order_date is not null
  group by 1
),
base as (
  select
    ca.customer_id,
    ca.customer_name,
    coalesce(ca.webshop_active, false) as webshop_active,
    coalesce(ca.total_value, 0) as total_value,
    coalesce(ca.total_orders, 0) as total_orders,
    coalesce(ca.webshop_orders, 0) as webshop_orders,
    coalesce(bc.orders_bc_90d, 0) as orders_bc_90d,
    coalesce(bc.orders_bc_365d, 0) as orders_bc_365d,
    bc.last_bc_order_date,
    coalesce(ca.primary_category, 'Unknown') as primary_category,
    coalesce(ca.low_hanging_fruit_score, 0) as low_hanging_fruit_score,
    coalesce(ca.potential_score, 0) as potential_score,
    case
      when coalesce(ca.total_orders, 0) > 0 then coalesce(ca.webshop_orders, 0)::numeric / nullif(ca.total_orders, 0)
      else 0
    end as web_share,
    case
      when bc.last_bc_order_date is null then 999
      else greatest(0, (current_date - bc.last_bc_order_date))
    end as recency_days
  from raw.customer_analysis_raw ca
  left join bc_rollup bc on bc.customer_id = trim(both from ca.customer_id)
),
seg as (
  select
    b.*,
    case
      when b.total_value >= 3000000 then 'high'
      when b.total_value >= 800000 then 'mid'
      else 'low'
    end as value_tier,
    case
      when b.orders_bc_90d >= 12 then 'high'
      when b.orders_bc_90d >= 4 then 'mid'
      else 'low'
    end as freq_tier
  from base b
)
select
  customer_id,
  customer_name,
  primary_category,
  webshop_active,
  total_value,
  total_orders,
  webshop_orders,
  web_share,
  orders_bc_90d,
  orders_bc_365d,
  recency_days,
  low_hanging_fruit_score,
  potential_score,
  value_tier,
  freq_tier,
  (recency_days >= 120) as is_at_risk,
  case
    when recency_days >= 120 then 'at_risk_declining'
    when webshop_active and web_share >= 0.55 and value_tier in ('mid','high') then 'web_first_power_buyers'
    when web_share <= 0.15 and value_tier in ('mid','high') and freq_tier in ('mid','high') then 'bc_heavy_loyal_low_web'
    when value_tier = 'high' and freq_tier = 'low' then 'high_value_low_frequency'
    when freq_tier = 'high' and value_tier = 'low' then 'frequent_small_baskets'
    when primary_category ilike '%hreinl%' or primary_category ilike '%heilbrig%' then 'hygiene_driven_buyers'
    when primary_category ilike '%matv%' or primary_category ilike '%kaffi%' then 'coffee_room_heavy_buyers'
    when primary_category ilike '%rekstrar%' or primary_category ilike '%skrifstof%' then 'office_core_buyers'
    else 'general_mixed'
  end as segment_id
from seg;

comment on view api.v_customer_segments is 'Behavior-first B2B customer segments for targeting solution landing pages.';

-- 2) Opportunity scoreboard: which segment+category should become next solution hub pages
create or replace view api.v_solution_hub_opportunity as
with lines as (
  select
    i.company_id::text as customer_id,
    l.document_no,
    coalesce(i.order_date::date, current_date) as order_date,
    coalesce(l.amount_excl, 0)::numeric as amount_excl,
    coalesce(p.level1, p.category_path, 'Unknown') as category_l1
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  left join raw.products_raw p on p.sku = l.sku
),
joined as (
  select
    s.segment_id,
    l.category_l1,
    l.customer_id,
    l.document_no,
    l.order_date,
    l.amount_excl,
    s.potential_score,
    s.low_hanging_fruit_score
  from lines l
  join api.v_customer_segments s on s.customer_id::text = l.customer_id::text
),
agg as (
  select
    segment_id,
    category_l1,
    count(distinct case when order_date >= current_date - 90 then customer_id end) as customers_90d,
    count(distinct case when order_date >= current_date - 90 then document_no end) as orders_90d,
    sum(case when order_date >= current_date - 90 then amount_excl else 0 end) as revenue_90d,
    sum(case when order_date < current_date - 90 and order_date >= current_date - 180 then amount_excl else 0 end) as revenue_prev_90d,
    avg(case when order_date >= current_date - 90 then potential_score end) as avg_potential_score,
    avg(case when order_date >= current_date - 90 then low_hanging_fruit_score end) as avg_lhfs
  from joined
  group by segment_id, category_l1
)
select
  segment_id,
  category_l1,
  customers_90d,
  orders_90d,
  revenue_90d,
  revenue_prev_90d,
  case
    when coalesce(revenue_prev_90d, 0) = 0 then null
    else round(((revenue_90d - revenue_prev_90d) / nullif(revenue_prev_90d, 0))::numeric, 4)
  end as momentum_pct,
  round((
    ln(1 + coalesce(revenue_90d, 0)) * 0.40 +
    ln(1 + coalesce(orders_90d, 0)) * 0.20 +
    ln(1 + coalesce(customers_90d, 0)) * 0.20 +
    greatest(0, coalesce((revenue_90d - revenue_prev_90d) / nullif(revenue_prev_90d, 0), 0)) * 0.10 +
    coalesce(avg_potential_score, 0) * 0.06 +
    coalesce(avg_lhfs, 0) * 0.04
  )::numeric, 4) as opportunity_score,
  case
    when category_l1 ilike '%skrifstof%' then 'office_supply_solution_page'
    when category_l1 ilike '%matv%' or category_l1 ilike '%kaffi%' then 'coffee_room_solution_page'
    when category_l1 ilike '%hreinl%' then 'hygiene_solution_page'
    else 'cross_category_solution_page'
  end as suggested_page_type
from agg;

comment on view api.v_solution_hub_opportunity is 'Ranks next solution hubs by demand, momentum, and customer opportunity signals.';

-- 3) Helper RPC: fetch featured products for a given segment
create or replace function api.get_featured_products_for_segment(
  p_segment_id text,
  p_days_back int default 30,
  p_row_limit int default 20
)
returns table (
  sku text,
  product_name text,
  category_l1 text,
  orders bigint,
  revenue_excl numeric
)
language sql
stable
as $$
  with eligible_customers as (
    select customer_id
    from api.v_customer_segments
    where segment_id = p_segment_id
  )
  select
    l.sku,
    coalesce(max(l.product_name), max(p.product_name), l.sku) as product_name,
    coalesce(max(p.level1), max(p.category_path), 'Unknown') as category_l1,
    count(distinct l.document_no)::bigint as orders,
    sum(coalesce(l.amount_excl, 0))::numeric as revenue_excl
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  join eligible_customers c on c.customer_id::text = i.company_id::text
  left join raw.products_raw p on p.sku = l.sku
  where coalesce(i.order_date::date, current_date) >= current_date - greatest(p_days_back, 1)
    and l.sku is not null
  group by l.sku
  order by revenue_excl desc, orders desc
  limit greatest(p_row_limit, 1);
$$;

comment on function api.get_featured_products_for_segment(text, int, int)
is 'Returns top products for a segment, for use in solution page modules.';

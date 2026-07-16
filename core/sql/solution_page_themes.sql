-- Category-to-Solution Modeling (Cludo-backed taxonomy)
-- Run in Supabase SQL editor after customer segmentation views exist.

create schema if not exists api;

-- 1) Category performance and solution-fit by segment
create or replace view api.v_category_solution_fit_v1 as
with lines as (
  select
    i.company_id::text as customer_id,
    l.document_no,
    coalesce(i.order_date::date, current_date) as order_date,
    coalesce(l.amount_excl, 0)::numeric as amount_excl,
    l.sku,
    coalesce(
      nullif(p.level1, ''),
      nullif(split_part(coalesce(p.category_path, ''), ' / ', 1), ''),
      'Unknown'
    ) as category_l1,
    coalesce(
      nullif(p.level2, ''),
      nullif(split_part(coalesce(p.category_path, ''), ' / ', 2), ''),
      'Unknown'
    ) as category_l2
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  left join raw.products_raw p on p.sku = l.sku
),
joined as (
  select
    s.segment_id,
    s.is_at_risk,
    l.category_l1,
    l.category_l2,
    l.customer_id,
    l.document_no,
    l.order_date,
    l.amount_excl
  from lines l
  join api.v_customer_segments s on s.customer_id::text = l.customer_id::text
),
agg as (
  select
    segment_id,
    category_l1,
    category_l2,
    count(distinct case when order_date >= current_date - 365 then customer_id end) as customers_365d,
    count(distinct case when order_date >= current_date - 365 then document_no end) as orders_365d,
    sum(case when order_date >= current_date - 365 then amount_excl else 0 end) as revenue_365d,
    -- Momentum windows end 30 days back: BC invoicing lag makes the most
    -- recent weeks incomplete and was skewing momentum uniformly negative.
    sum(case when order_date >= current_date - 120 and order_date < current_date - 30 then amount_excl else 0 end) as revenue_90d,
    sum(case when order_date >= current_date - 210 and order_date < current_date - 120 then amount_excl else 0 end) as revenue_prev_90d,
    count(distinct case when order_date >= current_date - 365 and is_at_risk then customer_id end) as at_risk_customers_365d
  from joined
  group by segment_id, category_l1, category_l2
)
select
  segment_id,
  category_l1,
  category_l2,
  customers_365d,
  orders_365d,
  revenue_365d,
  revenue_90d,
  revenue_prev_90d,
  at_risk_customers_365d,
  case
    when coalesce(revenue_prev_90d, 0) = 0 then null
    else round(((revenue_90d - revenue_prev_90d) / nullif(revenue_prev_90d, 0))::numeric, 4)
  end as momentum_90d_pct,
  round((
    ln(1 + coalesce(revenue_365d, 0)) * 0.38 +
    ln(1 + coalesce(orders_365d, 0)) * 0.22 +
    ln(1 + coalesce(customers_365d, 0)) * 0.20 +
    greatest(0, coalesce((revenue_90d - revenue_prev_90d) / nullif(revenue_prev_90d, 0), 0)) * 0.10 +
    (coalesce(at_risk_customers_365d, 0)::numeric / nullif(customers_365d, 0)) * 0.10
  )::numeric, 4) as solution_fit_score
from agg;

comment on view api.v_category_solution_fit_v1 is
'Ranks segment-category opportunities using Cludo taxonomy + demand + momentum + risk concentration.';

-- 2) Cross-category affinity (which categories are bought together)
create or replace view api.v_category_pair_affinity_v1 as
with base as (
  select distinct
    i.document_no,
    coalesce(
      nullif(p.level1, ''),
      nullif(split_part(coalesce(p.category_path, ''), ' / ', 1), ''),
      'Unknown'
    ) as category_l1
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  left join raw.products_raw p on p.sku = l.sku
  where coalesce(i.order_date::date, current_date) >= current_date - 365
),
pairs as (
  select
    a.category_l1 as category_a,
    b.category_l1 as category_b,
    count(*)::numeric as co_order_count
  from base a
  join base b
    on a.document_no = b.document_no
   and a.category_l1 < b.category_l1
  group by a.category_l1, b.category_l1
),
cat_orders as (
  select
    category_l1,
    count(distinct document_no)::numeric as orders_with_category
  from base
  group by category_l1
),
tot as (
  select count(distinct document_no)::numeric as total_orders
  from base
)
select
  p.category_a,
  p.category_b,
  p.co_order_count,
  round(p.co_order_count / nullif(ca.orders_with_category, 0), 4) as confidence_a_to_b,
  round(p.co_order_count / nullif(cb.orders_with_category, 0), 4) as confidence_b_to_a,
  round(
    (p.co_order_count / nullif(t.total_orders, 0)) /
    nullif((ca.orders_with_category / nullif(t.total_orders,0)) * (cb.orders_with_category / nullif(t.total_orders,0)), 0)
  , 4) as lift
from pairs p
join cat_orders ca on ca.category_l1 = p.category_a
join cat_orders cb on cb.category_l1 = p.category_b
cross join tot t;

comment on view api.v_category_pair_affinity_v1 is
'Category pair affinity for cross-category solution page bundling (confidence + lift).';

-- 3) Final page theme candidates from segment+category and category-pair signals
create or replace view api.v_solution_page_themes_v1 as
with top_fit as (
  select
    f.segment_id,
    f.category_l1,
    f.category_l2,
    f.customers_365d,
    f.orders_365d,
    f.revenue_365d,
    f.momentum_90d_pct,
    f.solution_fit_score,
    row_number() over (
      partition by f.segment_id
      order by f.solution_fit_score desc, f.revenue_365d desc
    ) as rk
  from api.v_category_solution_fit_v1 f
  where f.customers_365d >= 25
    and f.category_l1 not in ('Unknown', 'Vörur')
    and f.category_l2 <> 'Unknown'
),
-- Pairs are stored once with category_a < category_b (alphabetical), so the
-- join below must see both directions or it silently drops half the pairs
-- (e.g. Matvörur–Rekstrarvörur was invisible from Rekstrarvörur's side).
aff as (
  select
    category_a,
    category_b,
    co_order_count,
    lift,
    row_number() over (
      partition by category_a
      order by lift desc, co_order_count desc
    ) as rk
  from (
    select category_a, category_b, co_order_count, lift
    from api.v_category_pair_affinity_v1
    union all
    select category_b as category_a, category_a as category_b, co_order_count, lift
    from api.v_category_pair_affinity_v1
  ) both_directions
  where co_order_count >= 25
    and category_b not in ('Unknown', 'Vörur')
)
select
  t.segment_id,
  t.category_l1 as primary_category,
  t.category_l2 as primary_subcategory,
  a.category_b as suggested_cross_category,
  t.customers_365d,
  t.orders_365d,
  t.revenue_365d,
  t.momentum_90d_pct,
  t.solution_fit_score,
  a.lift as cross_sell_lift,
  case
    when t.segment_id = 'bc_heavy_loyal_low_web' then 'HowTo + FAQPage'
    else 'CollectionPage + ItemList + FAQPage'
  end as jsonld_recommendation,
  case
    when t.category_l1 ilike '%skrifstof%' or t.category_l1 ilike '%rekstrar%' then 'Skrifstofurekstur án innkaupastreitu'
    when t.category_l1 ilike '%matv%' or t.category_l1 ilike '%kaffi%' then 'Heildarlausn fyrir kaffistofu og starfsmannaaðstöðu'
    when t.category_l1 ilike '%heilbrig%' or t.category_l1 ilike '%hreinl%' then 'Hreinlætis- og öryggislausn fyrir fagrekstur'
    else 'Heildarlausn fyrir dagleg innkaup þvert á vöruflokka'
  end as suggested_h1
from top_fit t
left join aff a on a.category_a = t.category_l1 and a.rk = 1
where t.rk <= 3
order by t.solution_fit_score desc, t.revenue_365d desc;

comment on view api.v_solution_page_themes_v1 is
'Prioritized solution page themes per segment, including cross-category suggestion and schema hint.';

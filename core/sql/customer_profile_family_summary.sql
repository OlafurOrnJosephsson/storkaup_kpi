-- Family-aggregated customer profile summary for customer-profiles panel.
-- Uses existing api.v_customer_profiles_labeled_trends as source of truth.

create schema if not exists api;

create or replace function api.get_customer_profile_family_summary(
  p_customer_id text
)
returns table (
  customer_id text,
  customer_name text,
  webshop_active boolean,
  recommended_action text,
  low_hanging_fruit_score numeric,
  lhfs_percentile numeric,
  lhfs_label text,
  orders_bc_365d numeric,
  orders_web_365d numeric,
  avg_days_between_bc_orders numeric,
  avg_days_between_web_orders numeric,
  bc_orders_30d numeric,
  bc_orders_prev_30d numeric,
  web_orders_30d numeric,
  web_orders_prev_30d numeric,
  bc_revenue_30d numeric,
  bc_revenue_prev_30d numeric,
  web_revenue_30d numeric,
  web_revenue_prev_30d numeric
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
with input_customer as (
  select
    trim(coalesce(p_customer_id, '')) as raw_id,
    regexp_replace(trim(coalesce(p_customer_id, '')), '\D', '', 'g') as norm_id
),
family_key as (
  select
    raw_id,
    norm_id,
    case
      when length(norm_id) >= 10 then left(norm_id, 10)
      else norm_id
    end as family_norm
  from input_customer
),
family_rows as (
  select
    p.*,
    regexp_replace(coalesce(p.customer_id::text, ''), '\D', '', 'g') as cid_norm
  from api.v_customer_profiles_labeled_trends p
  cross join family_key fk
  where coalesce(p.customer_id::text, '') <> ''
    and (
      (fk.family_norm <> '' and left(regexp_replace(coalesce(p.customer_id::text, ''), '\D', '', 'g'), 10) = fk.family_norm)
      or (fk.family_norm = '' and p.customer_id::text = fk.raw_id)
    )
),
rep as (
  select *
  from family_rows
  order by
    case when cid_norm = (select family_norm from family_key) then 0 else 1 end,
    coalesce(low_hanging_fruit_score, 0) desc,
    coalesce(customer_id::text, '') asc
  limit 1
),
agg as (
  select
    coalesce(sum(coalesce(orders_bc_365d, 0)), 0)::numeric as orders_bc_365d,
    coalesce(sum(coalesce(orders_web_365d, 0)), 0)::numeric as orders_web_365d,
    coalesce(avg(nullif(least(greatest(coalesce(avg_days_between_bc_orders, 0), 0), 999999), 0)) filter (where coalesce(avg_days_between_bc_orders, 0) > 0), 0)::numeric as avg_days_between_bc_orders,
    coalesce(avg(nullif(least(greatest(coalesce(avg_days_between_web_orders, 0), 0), 999999), 0)) filter (where coalesce(avg_days_between_web_orders, 0) > 0), 0)::numeric as avg_days_between_web_orders,
    coalesce(sum(coalesce(bc_orders_30d, 0)), 0)::numeric as bc_orders_30d,
    coalesce(sum(coalesce(bc_orders_prev_30d, 0)), 0)::numeric as bc_orders_prev_30d,
    coalesce(sum(coalesce(web_orders_30d, 0)), 0)::numeric as web_orders_30d,
    coalesce(sum(coalesce(web_orders_prev_30d, 0)), 0)::numeric as web_orders_prev_30d,
    coalesce(sum(coalesce(bc_revenue_30d, 0)), 0)::numeric as bc_revenue_30d,
    coalesce(sum(coalesce(bc_revenue_prev_30d, 0)), 0)::numeric as bc_revenue_prev_30d,
    coalesce(sum(coalesce(web_revenue_30d, 0)), 0)::numeric as web_revenue_30d,
    coalesce(sum(coalesce(web_revenue_prev_30d, 0)), 0)::numeric as web_revenue_prev_30d,
    bool_or(coalesce(webshop_active, false)) as webshop_active,
    coalesce(max(coalesce(low_hanging_fruit_score, 0)), 0)::numeric as low_hanging_fruit_score,
    coalesce(max(coalesce(lhfs_percentile, 0)), 0)::numeric as lhfs_percentile
  from family_rows
)
select
  coalesce((select customer_id::text from rep), (select raw_id from family_key)) as customer_id,
  coalesce((select customer_name::text from rep), (select raw_id from family_key)) as customer_name,
  coalesce((select webshop_active from agg), false) as webshop_active,
  coalesce((select recommended_action::text from rep), '') as recommended_action,
  coalesce((select low_hanging_fruit_score from agg), 0) as low_hanging_fruit_score,
  coalesce((select lhfs_percentile from agg), 0) as lhfs_percentile,
  coalesce((select lhfs_label::text from rep), '') as lhfs_label,
  coalesce((select orders_bc_365d from agg), 0) as orders_bc_365d,
  coalesce((select orders_web_365d from agg), 0) as orders_web_365d,
  coalesce((select avg_days_between_bc_orders from agg), 0) as avg_days_between_bc_orders,
  coalesce((select avg_days_between_web_orders from agg), 0) as avg_days_between_web_orders,
  coalesce((select bc_orders_30d from agg), 0) as bc_orders_30d,
  coalesce((select bc_orders_prev_30d from agg), 0) as bc_orders_prev_30d,
  coalesce((select web_orders_30d from agg), 0) as web_orders_30d,
  coalesce((select web_orders_prev_30d from agg), 0) as web_orders_prev_30d,
  coalesce((select bc_revenue_30d from agg), 0) as bc_revenue_30d,
  coalesce((select bc_revenue_prev_30d from agg), 0) as bc_revenue_prev_30d,
  coalesce((select web_revenue_30d from agg), 0) as web_revenue_30d,
  coalesce((select web_revenue_prev_30d from agg), 0) as web_revenue_prev_30d
where exists (select 1 from family_rows);
$function$;

grant execute on function api.get_customer_profile_family_summary(text) to anon, authenticated;

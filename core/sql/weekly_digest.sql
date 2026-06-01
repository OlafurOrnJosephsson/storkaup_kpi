-- Weekly digest stats — called by scheduledWeeklyDigest in core/email.js
-- Returns one JSONB object with all KPIs for the 7-day window [p_week_start, p_week_start+7).
-- Apply in Supabase SQL editor.

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

-- ── Web orders ────────────────────────────────────────────────────────────────
web_agg as (
  select
    count(distinct order_id)::int     as orders,
    coalesce(sum(subtotal_excl), 0)   as revenue_excl
  from raw.newweb_orders_raw, params
  where purchase_date >= week_start::timestamp
    and purchase_date <  week_end::timestamp
),
prev_web as (
  select
    count(distinct order_id)::int     as orders,
    coalesce(sum(subtotal_excl), 0)   as revenue_excl
  from raw.newweb_orders_raw, prev_params
  where purchase_date >= week_start::timestamp
    and purchase_date <  week_end::timestamp
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
first_seen as (
  select
    coalesce(
      nullif(trim(company_id),   ''),
      nullif(trim(real_email),   ''),
      nullif(trim(company_name), '')
    ) as buyer_key,
    min(purchase_date::date) as first_day
  from raw.newweb_orders_raw
  where purchase_date is not null
  group by 1
),

-- Aggregate current-week orders by buyer (used for top buyers + new customer list)
weekly_buyer_agg as (
  select
    coalesce(nullif(trim(company_id),''), nullif(trim(real_email),''), nullif(trim(company_name),'')) as buyer_key,
    max(coalesce(nullif(trim(company_name),''), nullif(trim(customer_name),''), 'Óþekktur'))          as name,
    count(distinct order_id)::int            as orders,
    coalesce(sum(subtotal_excl), 0)::numeric as revenue
  from raw.newweb_orders_raw, params
  where purchase_date >= week_start::timestamp
    and purchase_date <  week_end::timestamp
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

grant execute on function public.weekly_digest_stats(date) to anon, authenticated;

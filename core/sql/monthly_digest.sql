-- Monthly digest stats — called by scheduledMonthlyDigest in core/email.js
-- Returns one JSONB object with all KPIs for the calendar month [p_month_start, p_month_start + 1 month).
-- Default p_month_start = first day of the previous full calendar month relative to today.
--
-- Web-share % reuses the EXACT net-BC + VEFUR/CO22-fallback logic from api.dashboard_compat
-- (non-negotiable: BC web share logic must not change casually). The reported month is the
-- last closed month, so the share window is the month itself; bc_as_of surfaces the last BC
-- sync date so the email can caveat that BC invoicing lags and Power BI is the canonical
-- monthly source.
--
-- Apply in Supabase SQL editor.
--
-- NOTE: single (date) overload only. A second (text) overload caused PostgREST
-- error PGRST203 (ambiguous candidate) because GAS sends the param as a JSON
-- string and both date/text matched. The date overload casts the ISO string fine,
-- exactly like weekly_digest_stats(date). The DROP below removes any stale text
-- overload from an earlier apply so this file stays idempotent.

drop function if exists public.monthly_digest_stats(text);

create or replace function public.monthly_digest_stats(
  p_month_start date default (date_trunc('month', current_date) - interval '1 month')::date
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
    p_month_start::date                                       as month_start,
    (p_month_start + interval '1 month')::date                as month_end,
    (p_month_start - interval '1 month')::date                as prev_start,
    p_month_start::date                                       as prev_end,
    date_trunc('month', current_date)::date                   as cur_start,
    current_date                                              as today,
    extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day'))::int as cur_days_in_month
),

-- cap label only: last successful BC sync (BC invoices lag; surfaced as caveat in email)
bc_sync_anchor as (
  select max(started_at)::date as last_sync_date
  from raw.ingestion_runs
  where job_name = 'scheduledBcSync_v1'
    and status = 'success'
),

-- ── Web orders: reported month + previous month ──────────────────────────────
web_month as (
  select
    count(distinct order_id)::int   as orders,
    coalesce(sum(subtotal_excl), 0) as revenue_excl
  from raw.newweb_orders_raw, params
  where purchase_date >= month_start::timestamp
    and purchase_date <  month_end::timestamp
),
web_prev as (
  select
    count(distinct order_id)::int   as orders,
    coalesce(sum(subtotal_excl), 0) as revenue_excl
  from raw.newweb_orders_raw, params
  where purchase_date >= prev_start::timestamp
    and purchase_date <  prev_end::timestamp
),

-- ── BC net (invoices − credits) + web share, reported month ──────────────────
-- Window uses coalesce(order_date, booking_date) to match api.dashboard_compat ratio window.
bc_inv as (
  select
    count(*)::numeric                       as orders,
    coalesce(sum(amount_excl), 0)::numeric  as revenue_excl,
    count(*) filter (
      where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
         or (coalesce(booking_date, order_date) < timestamp '2025-08-18'
             and upper(trim(coalesce(external_doc_no, ''))) like 'CO22-%')
    )::numeric                              as web_orders,
    coalesce(sum(amount_excl) filter (
      where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
         or (coalesce(booking_date, order_date) < timestamp '2025-08-18'
             and upper(trim(coalesce(external_doc_no, ''))) like 'CO22-%')
    ), 0)::numeric                          as web_revenue_excl
  from raw.bc_invoices_raw i, params
  where coalesce(i.order_date, i.booking_date) >= month_start::timestamp
    and coalesce(i.order_date, i.booking_date) <  month_end::timestamp
),
bc_cr as (
  select
    count(*)::numeric                       as orders,
    coalesce(sum(amount_excl), 0)::numeric  as revenue_excl,
    count(*) filter (
      where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
         or (coalesce(booking_date, order_date) < timestamp '2025-08-18'
             and upper(trim(coalesce(external_doc_no, ''))) like 'CO22-%')
    )::numeric                              as web_orders,
    coalesce(sum(amount_excl) filter (
      where upper(trim(coalesce(salesperson_code, ''))) = 'VEFUR'
         or (coalesce(booking_date, order_date) < timestamp '2025-08-18'
             and upper(trim(coalesce(external_doc_no, ''))) like 'CO22-%')
    ), 0)::numeric                          as web_revenue_excl
  from raw.bc_credit_invoices_raw i, params
  where coalesce(i.order_date, i.booking_date) >= month_start::timestamp
    and coalesce(i.order_date, i.booking_date) <  month_end::timestamp
),
bc_net as (
  select
    (inv.orders       - cr.orders)::numeric       as orders,
    (inv.revenue_excl - cr.revenue_excl)::numeric as revenue_excl,
    (inv.web_orders   - cr.web_orders)::numeric   as web_orders,
    (inv.web_revenue_excl - cr.web_revenue_excl)::numeric as web_revenue_excl
  from bc_inv inv cross join bc_cr cr
),
-- BC net previous month (for delta on BC totals only)
bc_inv_prev as (
  select count(*)::numeric as orders, coalesce(sum(amount_excl), 0)::numeric as revenue_excl
  from raw.bc_invoices_raw i, params
  where coalesce(i.order_date, i.booking_date) >= prev_start::timestamp
    and coalesce(i.order_date, i.booking_date) <  prev_end::timestamp
),
bc_cr_prev as (
  select count(*)::numeric as orders, coalesce(sum(amount_excl), 0)::numeric as revenue_excl
  from raw.bc_credit_invoices_raw i, params
  where coalesce(i.order_date, i.booking_date) >= prev_start::timestamp
    and coalesce(i.order_date, i.booking_date) <  prev_end::timestamp
),
bc_net_prev as (
  select
    (inv.orders - cr.orders)::numeric             as orders,
    (inv.revenue_excl - cr.revenue_excl)::numeric as revenue_excl
  from bc_inv_prev inv cross join bc_cr_prev cr
),

-- ── Buyer identity (new-customer detection), matches weekly_digest_stats ──────
first_seen as (
  select
    coalesce(nullif(trim(company_id), ''), nullif(trim(real_email), ''), nullif(trim(company_name), '')) as buyer_key,
    min(purchase_date::date) as first_day
  from raw.newweb_orders_raw
  where purchase_date is not null
  group by 1
),
month_buyer_agg as (
  select
    coalesce(nullif(trim(company_id),''), nullif(trim(real_email),''), nullif(trim(company_name),'')) as buyer_key,
    max(coalesce(nullif(trim(company_name),''), nullif(trim(customer_name),''), 'Óþekktur'))          as name,
    count(distinct order_id)::int            as orders,
    coalesce(sum(subtotal_excl), 0)::numeric as revenue
  from raw.newweb_orders_raw, params
  where purchase_date >= month_start::timestamp
    and purchase_date <  month_end::timestamp
  group by 1
),
top_buyers as (
  select name, orders, revenue as revenue_excl
  from month_buyer_agg
  where buyer_key is not null
  order by revenue desc
  limit 5
),
new_cust_list as (
  select mba.name, mba.revenue
  from month_buyer_agg mba
  join first_seen fs on fs.buyer_key = mba.buyer_key
  cross join params p
  where mba.buyer_key is not null
    and fs.first_day >= p.month_start
    and fs.first_day <  p.month_end
  order by mba.revenue desc
  limit 10
),
new_cust_count as (
  select count(*)::int as cnt
  from month_buyer_agg mba
  join first_seen fs on fs.buyer_key = mba.buyer_key
  cross join params p
  where mba.buyer_key is not null
    and fs.first_day >= p.month_start
    and fs.first_day <  p.month_end
),
new_cust_count_prev as (
  select count(*)::int as cnt
  from first_seen fs, params p
  where fs.buyer_key is not null
    and fs.first_day >= p.prev_start
    and fs.first_day <  p.prev_end
),

-- ── Top products (rolling 30d from materialized view; labelled as such) ───────
top_products as (
  select product_name, sku, total_orders, total_revenue_excl
  from mart.mv_top_products_master
  where period = '30d'
  order by total_revenue_excl desc nulls last
  limit 5
),

-- ── Current month run-rate (MTD + naive projection) ──────────────────────────
mtd_web as (
  select
    count(distinct order_id)::int   as orders,
    coalesce(sum(subtotal_excl), 0) as revenue_excl
  from raw.newweb_orders_raw, params
  where purchase_date >= cur_start::timestamp
    and purchase_date <  today::timestamp
),
runrate as (
  select
    (p.today - p.cur_start)::int as days_elapsed,
    p.cur_days_in_month          as days_in_month,
    m.orders                     as mtd_orders,
    m.revenue_excl               as mtd_revenue_excl,
    case when (p.today - p.cur_start)::int > 0
      then round(m.orders::numeric / (p.today - p.cur_start)::int * p.cur_days_in_month)
      else null end              as projected_orders,
    case when (p.today - p.cur_start)::int > 0
      then round(m.revenue_excl  / (p.today - p.cur_start)::int * p.cur_days_in_month)
      else null end              as projected_revenue_excl
  from params p cross join mtd_web m
)

select jsonb_build_object(
  -- Window labels
  'month_start',              (select to_char(month_start, 'YYYY-MM-DD') from params),
  'month',                    (select to_char(month_start, 'YYYY-MM') from params),
  'prev_month',               (select to_char(prev_start, 'YYYY-MM') from params),

  -- Reported month web
  'web_orders',               (select orders       from web_month),
  'web_revenue_excl',         (select revenue_excl from web_month),
  'prev_web_orders',          (select orders       from web_prev),
  'prev_web_revenue_excl',    (select revenue_excl from web_prev),

  -- Reported month BC net
  'bc_net_orders',            (select orders       from bc_net),
  'bc_net_revenue_excl',      (select revenue_excl from bc_net),
  'prev_bc_net_orders',       (select orders       from bc_net_prev),
  'prev_bc_net_revenue_excl', (select revenue_excl from bc_net_prev),

  -- Web share of net BC (North Star) — same logic as api.dashboard_compat
  'web_orders_pct',  case when (select orders from bc_net) > 0
    then (select web_orders   from bc_net) / nullif((select orders from bc_net), 0) else null end,
  'web_revenue_pct', case when (select revenue_excl from bc_net) > 0
    then (select web_revenue_excl from bc_net) / nullif((select revenue_excl from bc_net), 0) else null end,
  'bc_as_of',                 to_char((select last_sync_date from bc_sync_anchor), 'YYYY-MM-DD'),

  -- New customers
  'new_customers',            (select cnt from new_cust_count),
  'prev_new_customers',       (select cnt from new_cust_count_prev),
  'new_customers_list',       (
    select jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue))
    from new_cust_list
  ),

  -- Top customers (by web revenue, reported month)
  'top_customers',            (
    select jsonb_agg(jsonb_build_object('name', name, 'orders', orders, 'revenue_excl', revenue_excl))
    from top_buyers
  ),

  -- Top products (rolling 30d)
  'top_products',             (
    select jsonb_agg(jsonb_build_object(
      'name', product_name, 'sku', sku, 'orders', total_orders, 'revenue_excl', total_revenue_excl))
    from top_products
  ),

  -- Current-month run-rate
  'runrate', jsonb_build_object(
    'days_elapsed',           (select days_elapsed           from runrate),
    'days_in_month',          (select days_in_month          from runrate),
    'mtd_orders',             (select mtd_orders             from runrate),
    'mtd_revenue_excl',       (select mtd_revenue_excl       from runrate),
    'projected_orders',       (select projected_orders       from runrate),
    'projected_revenue_excl', (select projected_revenue_excl from runrate)
  )
);
$function$;

grant execute on function public.monthly_digest_stats(date) to anon, authenticated;

notify pgrst, 'reload schema';

-- Day KPI pack for daily dashboard cards.
-- Run in Supabase SQL editor.

create or replace function public.day_kpi_pack(p_day date default current_date)
returns table (
  day date,
  orders bigint,
  revenue_incl numeric,
  revenue_excl numeric,
  aov_excl numeric,
  vs_yesterday_orders_pct numeric,
  vs_yesterday_revenue_excl_pct numeric,
  vs_yesterday_aov_excl_pct numeric,
  vs_lastweek_orders_pct numeric,
  vs_lastweek_revenue_excl_pct numeric,
  vs_lastweek_aov_excl_pct numeric,
  unique_buyers bigint,
  repeat_buyer_pct numeric,
  first_time_buyers bigint,
  current_hour_orders bigint,
  current_hour_revenue_excl numeric,
  eod_orders_forecast numeric,
  eod_revenue_excl_forecast numeric,
  eod_orders_vs_lastweek_pct numeric,
  eod_revenue_excl_vs_lastweek_pct numeric,
  top_customer_1 text,
  top_customer_2 text,
  top_customer_3 text,
  hourly_series jsonb
)
language sql
stable
security definer
set search_path to 'public', 'mart', 'raw'
as $function$
with params as (
  select
    p_day::date as day,
    (now() at time zone 'UTC')::date as today_utc,
    extract(hour from (now() at time zone 'UTC'))::int as hour_utc
),
d0 as (
  select
    p.day as day,
    coalesce(v.orders, 0)::bigint as orders,
    coalesce(v.revenue_incl, 0)::numeric as revenue_incl,
    coalesce(v.revenue_excl, 0)::numeric as revenue_excl
  from params p
  left join mart.v_web_daily_unified v on v.day = p.day
),
d1 as (
  select
    coalesce(v.orders, 0)::bigint as orders,
    coalesce(v.revenue_excl, 0)::numeric as revenue_excl
  from params p
  left join mart.v_web_daily_unified v on v.day = (p.day - interval '1 day')::date
),
d7 as (
  select
    coalesce(v.orders, 0)::bigint as orders,
    coalesce(v.revenue_excl, 0)::numeric as revenue_excl
  from params p
  left join mart.v_web_daily_unified v on v.day = (p.day - interval '7 day')::date
),
buyers_today as (
  select distinct
    case
      when nullif(trim(company_id), '') is not null then 'cid:' || trim(company_id)
      when nullif(trim(real_email), '') is not null then 'email:' || lower(trim(real_email))
      when nullif(trim(company_name), '') is not null then 'cname:' || lower(trim(company_name))
      when nullif(trim(customer_name), '') is not null then 'cust:' || lower(trim(customer_name))
      else null
    end as buyer_key
  from raw.newweb_orders_raw
  where purchase_date >= (select day::timestamp from params)
    and purchase_date < ((select day::timestamp from params) + interval '1 day')
),
first_seen as (
  select
    buyer_key,
    min(purchase_date::date) as first_day
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
  group by buyer_key
),
buyer_stats as (
  select
    count(*)::bigint as unique_buyers,
    count(*) filter (where fs.first_day = (select day from params))::bigint as first_time_buyers,
    count(*) filter (where fs.first_day < (select day from params))::bigint as repeat_buyers
  from buyers_today bt
  left join first_seen fs on fs.buyer_key = bt.buyer_key
  where bt.buyer_key is not null
),
hourly_raw as (
  select
    extract(hour from purchase_date)::int as hour_of_day,
    count(distinct order_id)::bigint as orders,
    coalesce(sum(subtotal_excl), 0)::numeric as revenue_excl
  from raw.newweb_orders_raw
  where purchase_date >= (select day::timestamp from params)
    and purchase_date < ((select day::timestamp from params) + interval '1 day')
  group by 1
),
hourly_full as (
  select
    g.hour_of_day,
    coalesce(h.orders, 0)::bigint as orders,
    coalesce(h.revenue_excl, 0)::numeric as revenue_excl
  from generate_series(0, 23) as g(hour_of_day)
  left join hourly_raw h on h.hour_of_day = g.hour_of_day
),
hourly_pick as (
  select
    hf.orders as current_hour_orders,
    hf.revenue_excl as current_hour_revenue_excl
  from hourly_full hf
  where hf.hour_of_day = (
    select case
      when p.day = p.today_utc then p.hour_utc
      else coalesce((select max(hour_of_day) from hourly_raw), 23)
    end
    from params p
  )
  limit 1
),
elapsed as (
  select
    case
      when p.day = p.today_utc then greatest(p.hour_utc + 1, 1)
      else 24
    end::numeric as elapsed_hours
  from params p
),
forecast as (
  select
    case when e.elapsed_hours > 0 then d0.orders::numeric * 24 / e.elapsed_hours else d0.orders::numeric end as eod_orders_forecast,
    case when e.elapsed_hours > 0 then d0.revenue_excl * 24 / e.elapsed_hours else d0.revenue_excl end as eod_revenue_excl_forecast
  from d0
  cross join elapsed e
),
top_customers as (
  select
    coalesce(nullif(trim(company_name), ''), nullif(trim(customer_name), ''), 'Óþekktur viðskiptavinur') as buyer_name,
    coalesce(sum(subtotal_excl), 0)::numeric as revenue_excl
  from raw.newweb_orders_raw
  where purchase_date >= (select day::timestamp from params)
    and purchase_date < ((select day::timestamp from params) + interval '1 day')
  group by 1
),
top_ranked as (
  select
    row_number() over (order by t.revenue_excl desc, t.buyer_name asc) as rn,
    t.buyer_name || ' - ' || to_char(round(t.revenue_excl), 'FM999G999G999G990') || ' kr' as label
  from top_customers t
),
hourly_json as (
  select jsonb_agg(
    jsonb_build_object(
      'hour', hf.hour_of_day,
      'orders', hf.orders,
      'revenueExcl', hf.revenue_excl
    )
    order by hf.hour_of_day
  ) as series
  from hourly_full hf
)
select
  d0.day,
  d0.orders,
  d0.revenue_incl,
  d0.revenue_excl,
  case when d0.orders > 0 then d0.revenue_excl / d0.orders else 0 end as aov_excl,
  case when d1.orders > 0 then (d0.orders::numeric - d1.orders::numeric) / d1.orders::numeric else 0 end as vs_yesterday_orders_pct,
  case when d1.revenue_excl > 0 then (d0.revenue_excl - d1.revenue_excl) / d1.revenue_excl else 0 end as vs_yesterday_revenue_excl_pct,
  case
    when d1.orders > 0 and d1.revenue_excl > 0
      then ((case when d0.orders > 0 then d0.revenue_excl / d0.orders else 0 end) - (d1.revenue_excl / d1.orders::numeric)) / (d1.revenue_excl / d1.orders::numeric)
    else 0
  end as vs_yesterday_aov_excl_pct,
  case when d7.orders > 0 then (d0.orders::numeric - d7.orders::numeric) / d7.orders::numeric else 0 end as vs_lastweek_orders_pct,
  case when d7.revenue_excl > 0 then (d0.revenue_excl - d7.revenue_excl) / d7.revenue_excl else 0 end as vs_lastweek_revenue_excl_pct,
  case
    when d7.orders > 0 and d7.revenue_excl > 0
      then ((case when d0.orders > 0 then d0.revenue_excl / d0.orders else 0 end) - (d7.revenue_excl / d7.orders::numeric)) / (d7.revenue_excl / d7.orders::numeric)
    else 0
  end as vs_lastweek_aov_excl_pct,
  coalesce(bs.unique_buyers, 0) as unique_buyers,
  case when coalesce(bs.unique_buyers, 0) > 0 then coalesce(bs.repeat_buyers, 0)::numeric / bs.unique_buyers::numeric else 0 end as repeat_buyer_pct,
  coalesce(bs.first_time_buyers, 0) as first_time_buyers,
  coalesce(hp.current_hour_orders, 0) as current_hour_orders,
  coalesce(hp.current_hour_revenue_excl, 0) as current_hour_revenue_excl,
  coalesce(fc.eod_orders_forecast, 0) as eod_orders_forecast,
  coalesce(fc.eod_revenue_excl_forecast, 0) as eod_revenue_excl_forecast,
  case when d7.orders > 0 then (coalesce(fc.eod_orders_forecast, 0) - d7.orders::numeric) / d7.orders::numeric else 0 end as eod_orders_vs_lastweek_pct,
  case when d7.revenue_excl > 0 then (coalesce(fc.eod_revenue_excl_forecast, 0) - d7.revenue_excl) / d7.revenue_excl else 0 end as eod_revenue_excl_vs_lastweek_pct,
  (select tr.label from top_ranked tr where tr.rn = 1) as top_customer_1,
  (select tr.label from top_ranked tr where tr.rn = 2) as top_customer_2,
  (select tr.label from top_ranked tr where tr.rn = 3) as top_customer_3,
  coalesce((select hj.series from hourly_json hj), '[]'::jsonb) as hourly_series
from d0
cross join d1
cross join d7
left join buyer_stats bs on true
left join hourly_pick hp on true
left join forecast fc on true;
$function$;

grant execute on function public.day_kpi_pack(date) to anon, authenticated;

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
  first_time_buyers bigint
)
language sql
stable
security definer
set search_path to 'public', 'mart', 'raw'
as $function$
with d0 as (
  select
    p_day::date as day,
    coalesce(v.orders, 0)::bigint as orders,
    coalesce(v.revenue_incl, 0)::numeric as revenue_incl,
    coalesce(v.revenue_excl, 0)::numeric as revenue_excl
  from (select 1) x
  left join mart.v_web_daily_unified v on v.day = p_day
),
d1 as (
  select
    coalesce(v.orders, 0)::bigint as orders,
    coalesce(v.revenue_excl, 0)::numeric as revenue_excl
  from (select 1) x
  left join mart.v_web_daily_unified v on v.day = (p_day - interval '1 day')::date
),
d7 as (
  select
    coalesce(v.orders, 0)::bigint as orders,
    coalesce(v.revenue_excl, 0)::numeric as revenue_excl
  from (select 1) x
  left join mart.v_web_daily_unified v on v.day = (p_day - interval '7 day')::date
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
  where purchase_date >= p_day::timestamp
    and purchase_date < (p_day::timestamp + interval '1 day')
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
    count(*) filter (where fs.first_day = p_day)::bigint as first_time_buyers,
    count(*) filter (where fs.first_day < p_day)::bigint as repeat_buyers
  from buyers_today bt
  left join first_seen fs on fs.buyer_key = bt.buyer_key
  where bt.buyer_key is not null
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
  coalesce(bs.first_time_buyers, 0) as first_time_buyers
from d0
cross join d1
cross join d7
left join buyer_stats bs on true;
$function$;

grant execute on function public.day_kpi_pack(date) to anon, authenticated;

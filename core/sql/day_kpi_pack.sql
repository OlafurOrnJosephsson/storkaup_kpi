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
  registrations_today bigint,
  registrations_bought_today bigint,
  registrations_conversion_pct numeric,
  current_hour_orders bigint,
  current_hour_revenue_excl numeric,
  eod_orders_forecast numeric,
  eod_revenue_excl_forecast numeric,
  eod_orders_vs_lastweek_pct numeric,
  eod_revenue_excl_vs_lastweek_pct numeric,
  noon_hour int,
  noon_sales_vs_lastweek_pct numeric,
  noon_orders_vs_lastweek_pct numeric,
  alert_noon_sales_drop boolean,
  alert_noon_orders_drop boolean,
  top_customer_1 text,
  top_customer_2 text,
  top_customer_3 text,
  top_sku_1 text,
  top_sku_2 text,
  top_sku_3 text,
  top_sku_4 text,
  top_sku_5 text,
  top_cat_1 text,
  top_cat_2 text,
  top_cat_3 text,
  hourly_series jsonb,
  weekday_hourly_avg_series jsonb,
  weekday_hourly_avg_days int,
  weekday_avg_orders_per_day numeric,
  weekday_avg_revenue_excl_per_day numeric
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
buyers_today_email as (
  select distinct lower(trim(real_email)) as email
  from raw.newweb_orders_raw
  where purchase_date >= (select day::timestamp from params)
    and purchase_date < ((select day::timestamp from params) + interval '1 day')
    and nullif(trim(real_email), '') is not null
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
registrations_base as (
  select
    lower(trim(
      coalesce(
        nullif(to_jsonb(mc)->>'real_email', ''),
        nullif(to_jsonb(mc)->>'email', '')
      )
    )) as email,
    coalesce(
      nullif(to_jsonb(mc)->>'created_at', ''),
      nullif(to_jsonb(mc)->>'created_at_source', ''),
      nullif(to_jsonb(mc)->>'customer_created_at', ''),
      nullif(to_jsonb(mc)->>'created', '')
    ) as created_text
  from raw.magento_customers_raw mc
),
registrations_parsed as (
  select
    rb.email,
    case
      when rb.created_text ~ '^\d{4}-\d{2}-\d{2}' then rb.created_text::timestamptz
      else null
    end as created_ts
  from registrations_base rb
  where rb.email is not null and rb.email <> ''
),
registrations_today as (
  select distinct rp.email
  from registrations_parsed rp
  where rp.created_ts is not null
    and rp.created_ts::date = (select day from params)
),
registration_stats as (
  select
    count(*)::bigint as registrations_today,
    count(*) filter (where bte.email is not null)::bigint as registrations_bought_today
  from registrations_today rt
  left join buyers_today_email bte on bte.email = rt.email
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
hourly_lastweek_raw as (
  select
    extract(hour from purchase_date)::int as hour_of_day,
    count(distinct order_id)::bigint as orders,
    coalesce(sum(subtotal_excl), 0)::numeric as revenue_excl
  from raw.newweb_orders_raw
  where purchase_date >= ((select day::timestamp from params) - interval '7 day')
    and purchase_date < (((select day::timestamp from params) - interval '7 day') + interval '1 day')
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
hourly_lastweek_full as (
  select
    g.hour_of_day,
    coalesce(h.orders, 0)::bigint as orders,
    coalesce(h.revenue_excl, 0)::numeric as revenue_excl
  from generate_series(0, 23) as g(hour_of_day)
  left join hourly_lastweek_raw h on h.hour_of_day = g.hour_of_day
),
hour_cutoff as (
  select
    case
      when p.day = p.today_utc then p.hour_utc
      else 23
    end::int as hour_cutoff
  from params p
),
hourly_pick as (
  select
    hf.orders as current_hour_orders,
    hf.revenue_excl as current_hour_revenue_excl
  from hourly_full hf
  where hf.hour_of_day = (select hour_cutoff from hour_cutoff)
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
noon_compare as (
  select
    hc.hour_cutoff,
    coalesce(sum(hf.orders), 0)::numeric as cur_orders_to_cutoff,
    coalesce(sum(hf.revenue_excl), 0)::numeric as cur_rev_to_cutoff,
    coalesce(sum(hlf.orders), 0)::numeric as lw_orders_to_cutoff,
    coalesce(sum(hlf.revenue_excl), 0)::numeric as lw_rev_to_cutoff
  from hour_cutoff hc
  left join hourly_full hf on hf.hour_of_day <= hc.hour_cutoff
  left join hourly_lastweek_full hlf on hlf.hour_of_day <= hc.hour_cutoff
  group by hc.hour_cutoff
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
sku_lines as (
  select
    nullif(regexp_replace(trim(x.sku_token), '[^0-9]', '', 'g'), '') as sku_norm,
    coalesce(n.subtotal_excl, 0)::numeric as order_revenue_excl
  from raw.newweb_orders_raw n
  cross join lateral unnest(
    string_to_array(
      case
        when nullif(trim(coalesce(n.sku_normalized, '')), '') is not null then n.sku_normalized
        else coalesce(n.sku, '')
      end,
      ','
    )
  ) as x(sku_token)
  where n.purchase_date >= (select day::timestamp from params)
    and n.purchase_date < ((select day::timestamp from params) + interval '1 day')
),
sku_agg as (
  select
    sl.sku_norm,
    count(*)::bigint as hits,
    coalesce(sum(sl.order_revenue_excl), 0)::numeric as revenue_excl
  from sku_lines sl
  where sl.sku_norm is not null
  group by sl.sku_norm
),
sku_ranked as (
  select
    row_number() over (order by s.hits desc, s.revenue_excl desc, s.sku_norm asc) as rn,
    s.sku_norm || ' | ' || coalesce(nullif(trim(p.product_name), ''), 'Óþekkt vara') || ' (' || s.hits || ')' as label
  from sku_agg s
  left join raw.products_raw p
    on regexp_replace(coalesce(p.sku, ''), '[^0-9]', '', 'g') = s.sku_norm
),
cat_lookup as (
  select
    sa.sku_norm,
    sa.hits,
    sa.revenue_excl,
    coalesce(
      nullif(trim(p.level1), ''),
      nullif(trim(p.level2), ''),
      nullif(trim(p.level3), ''),
      'Óflokkað'
    ) as cat_l1
  from sku_agg sa
  left join raw.products_raw p
    on regexp_replace(coalesce(p.sku, ''), '[^0-9]', '', 'g') = sa.sku_norm
),
cat_agg as (
  select
    cl.cat_l1,
    coalesce(sum(cl.hits), 0)::bigint as hits,
    coalesce(sum(cl.revenue_excl), 0)::numeric as revenue_excl
  from cat_lookup cl
  group by cl.cat_l1
),
cat_ranked as (
  select
    row_number() over (order by c.hits desc, c.revenue_excl desc, c.cat_l1 asc) as rn,
    c.cat_l1 || ' (' || c.hits || ')' as label
  from cat_agg c
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
),
  weekday_days as (
  select gs.day::date as day
  from params p
    cross join lateral generate_series(
    (p.day - interval '365 day')::date,
    (p.day - interval '1 day')::date,
    interval '1 day'
  ) as gs(day)
  where extract(isodow from gs.day) = extract(isodow from p.day)
),
weekday_hour_orders as (
  select
    n.purchase_date::date as day,
    extract(hour from n.purchase_date)::int as hour_of_day,
    count(distinct n.order_id)::numeric as orders
  from raw.newweb_orders_raw n
  join params p on true
  where n.purchase_date >= (p.day - interval '365 day')::timestamp
    and n.purchase_date < p.day::timestamp
    and extract(isodow from n.purchase_date) = extract(isodow from p.day)
  group by 1, 2
),
weekday_day_totals as (
  select
    n.purchase_date::date as day,
    count(distinct n.order_id)::numeric as orders,
    coalesce(sum(n.subtotal_excl), 0)::numeric as revenue_excl
  from raw.newweb_orders_raw n
  join params p on true
  where n.purchase_date >= (p.day - interval '365 day')::timestamp
    and n.purchase_date < p.day::timestamp
    and extract(isodow from n.purchase_date) = extract(isodow from p.day)
  group by 1
),
weekday_avg_totals as (
  select
    avg(coalesce(wdt.orders, 0))::numeric as avg_orders_per_day,
    avg(coalesce(wdt.revenue_excl, 0))::numeric as avg_revenue_excl_per_day
  from weekday_days wd
  left join weekday_day_totals wdt on wdt.day = wd.day
),
weekday_hourly_avg as (
  select
    h.hour_of_day,
    avg(coalesce(who.orders, 0))::numeric as avg_orders
  from weekday_days wd
  cross join generate_series(0, 23) as h(hour_of_day)
  left join weekday_hour_orders who
    on who.day = wd.day
   and who.hour_of_day = h.hour_of_day
  group by h.hour_of_day
),
weekday_hourly_json as (
  select jsonb_agg(
    jsonb_build_object(
      'hour', wha.hour_of_day,
      'orders', round(wha.avg_orders, 2)
    )
    order by wha.hour_of_day
  ) as series
  from weekday_hourly_avg wha
),
weekday_days_count as (
  select count(*)::int as n
  from weekday_days
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
  coalesce(rs.registrations_today, 0) as registrations_today,
  coalesce(rs.registrations_bought_today, 0) as registrations_bought_today,
  case
    when coalesce(rs.registrations_today, 0) > 0
      then coalesce(rs.registrations_bought_today, 0)::numeric / rs.registrations_today::numeric
    else 0
  end as registrations_conversion_pct,
  coalesce(hp.current_hour_orders, 0) as current_hour_orders,
  coalesce(hp.current_hour_revenue_excl, 0) as current_hour_revenue_excl,
  coalesce(fc.eod_orders_forecast, 0) as eod_orders_forecast,
  coalesce(fc.eod_revenue_excl_forecast, 0) as eod_revenue_excl_forecast,
  case when d7.orders > 0 then (coalesce(fc.eod_orders_forecast, 0) - d7.orders::numeric) / d7.orders::numeric else 0 end as eod_orders_vs_lastweek_pct,
  case when d7.revenue_excl > 0 then (coalesce(fc.eod_revenue_excl_forecast, 0) - d7.revenue_excl) / d7.revenue_excl else 0 end as eod_revenue_excl_vs_lastweek_pct,
  coalesce(nc.hour_cutoff, 0) as noon_hour,
  case when nc.lw_rev_to_cutoff > 0 then (nc.cur_rev_to_cutoff - nc.lw_rev_to_cutoff) / nc.lw_rev_to_cutoff else 0 end as noon_sales_vs_lastweek_pct,
  case when nc.lw_orders_to_cutoff > 0 then (nc.cur_orders_to_cutoff - nc.lw_orders_to_cutoff) / nc.lw_orders_to_cutoff else 0 end as noon_orders_vs_lastweek_pct,
  case
    when nc.hour_cutoff >= 12 and nc.lw_rev_to_cutoff > 0
      then ((nc.cur_rev_to_cutoff - nc.lw_rev_to_cutoff) / nc.lw_rev_to_cutoff) <= -0.30
    else false
  end as alert_noon_sales_drop,
  case
    when nc.hour_cutoff >= 12 and nc.lw_orders_to_cutoff > 0
      then ((nc.cur_orders_to_cutoff - nc.lw_orders_to_cutoff) / nc.lw_orders_to_cutoff) <= -0.30
    else false
  end as alert_noon_orders_drop,
  (select tr.label from top_ranked tr where tr.rn = 1) as top_customer_1,
  (select tr.label from top_ranked tr where tr.rn = 2) as top_customer_2,
  (select tr.label from top_ranked tr where tr.rn = 3) as top_customer_3,
  (select sr.label from sku_ranked sr where sr.rn = 1) as top_sku_1,
  (select sr.label from sku_ranked sr where sr.rn = 2) as top_sku_2,
  (select sr.label from sku_ranked sr where sr.rn = 3) as top_sku_3,
  (select sr.label from sku_ranked sr where sr.rn = 4) as top_sku_4,
  (select sr.label from sku_ranked sr where sr.rn = 5) as top_sku_5,
  (select cr.label from cat_ranked cr where cr.rn = 1) as top_cat_1,
  (select cr.label from cat_ranked cr where cr.rn = 2) as top_cat_2,
  (select cr.label from cat_ranked cr where cr.rn = 3) as top_cat_3,
  coalesce((select hj.series from hourly_json hj), '[]'::jsonb) as hourly_series,
  coalesce((select whj.series from weekday_hourly_json whj), '[]'::jsonb) as weekday_hourly_avg_series,
  coalesce((select wdc.n from weekday_days_count wdc), 0) as weekday_hourly_avg_days,
  coalesce((select wat.avg_orders_per_day from weekday_avg_totals wat), 0) as weekday_avg_orders_per_day,
  coalesce((select wat.avg_revenue_excl_per_day from weekday_avg_totals wat), 0) as weekday_avg_revenue_excl_per_day
from d0
cross join d1
cross join d7
left join buyer_stats bs on true
left join registration_stats rs on true
left join hourly_pick hp on true
left join forecast fc on true
left join noon_compare nc on true;
$function$;

grant execute on function public.day_kpi_pack(date) to anon, authenticated;

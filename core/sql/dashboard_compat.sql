-- Dashboard RPC used by Webflow dashboard.js
-- Net BC logic: invoices minus credit invoices (both totals and web share numerators/denominators).

create schema if not exists api;

create or replace function api.dashboard_compat(p_month date default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'api', 'mart', 'raw'
as $function$
with month_ctx as (
  select
    date_trunc('month', coalesce(p_month, current_date)::timestamp)::date as month_start,
    (date_trunc('month', coalesce(p_month, current_date)::timestamp) + interval '1 month')::date as month_end,
    date_trunc('month', current_date::timestamp)::date as current_month_start
),
month_key as (
  select to_char(month_start, 'YYYY-MM') as ym from month_ctx
),
unified_web_orders as (
  select
    n.order_id::text as order_id,
    n.purchase_date as purchase_date,
    coalesce(n.subtotal_incl, 0)::numeric as subtotal_incl,
    coalesce(n.subtotal_excl, 0)::numeric as subtotal_excl,
    n.customer_name::text as customer_name,
    n.company_id::text as company_id,
    n.company_name::text as company_name,
    n.real_email::text as real_email
  from raw.newweb_orders_raw n
  where n.order_id is not null

  union all

  select
    o.order_id::text as order_id,
    o.purchase_date as purchase_date,
    coalesce(o.subtotal_incl, 0)::numeric as subtotal_incl,
    coalesce(o.subtotal_excl, 0)::numeric as subtotal_excl,
    o.customer_name::text as customer_name,
    o.company_id::text as company_id,
    o.company_name::text as company_name,
    lower(nullif(trim(o.customer_email), ''))::text as real_email
  from raw.oldweb_orders_raw o
  where o.order_id is not null
),
web_month as (
  select
    count(distinct o.order_id)::numeric as orders,
    coalesce(sum(o.subtotal_incl), 0)::numeric as revenue_incl,
    coalesce(sum(o.subtotal_excl), 0)::numeric as revenue_excl
  from unified_web_orders o
  cross join month_ctx m
  where o.purchase_date >= m.month_start::timestamp
    and o.purchase_date < m.month_end::timestamp
),
web_prev_year as (
  select
    count(distinct o.order_id)::numeric as orders,
    coalesce(sum(o.subtotal_incl), 0)::numeric as revenue_incl
  from unified_web_orders o
  cross join month_ctx m
  where o.purchase_date >= (m.month_start::timestamp - interval '1 year')
    and o.purchase_date < (m.month_end::timestamp - interval '1 year')
),
bc_invoices_month as (
  select
    count(*)::numeric as orders,
    coalesce(sum(i.amount_incl), 0)::numeric as revenue_incl,
    coalesce(sum(i.amount_excl), 0)::numeric as revenue_excl,
    count(*) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           coalesce(i.booking_date, i.order_date) < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    )::numeric as web_orders,
    coalesce(sum(i.amount_excl) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           coalesce(i.booking_date, i.order_date) < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    ), 0)::numeric as web_revenue_excl
  from raw.bc_invoices_raw i
  cross join month_ctx m
  where coalesce(i.order_date, i.booking_date) >= m.month_start::timestamp
    and coalesce(i.order_date, i.booking_date) < m.month_end::timestamp
),
bc_credits_month as (
  select
    count(*)::numeric as orders,
    coalesce(sum(i.amount_incl), 0)::numeric as revenue_incl,
    coalesce(sum(i.amount_excl), 0)::numeric as revenue_excl,
    count(*) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           coalesce(i.booking_date, i.order_date) < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    )::numeric as web_orders,
    coalesce(sum(i.amount_excl) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           coalesce(i.booking_date, i.order_date) < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    ), 0)::numeric as web_revenue_excl
  from raw.bc_credit_invoices_raw i
  cross join month_ctx m
  where coalesce(i.order_date, i.booking_date) >= m.month_start::timestamp
    and coalesce(i.order_date, i.booking_date) < m.month_end::timestamp
),
bc_net as (
  select
    (inv.revenue_incl - cr.revenue_incl)::numeric as revenue_incl,
    (inv.revenue_excl - cr.revenue_excl)::numeric as revenue_excl,
    (inv.orders - cr.orders)::numeric as orders,
    (inv.web_orders - cr.web_orders)::numeric as web_orders,
    (inv.web_revenue_excl - cr.web_revenue_excl)::numeric as web_revenue_excl
  from bc_invoices_month inv
  cross join bc_credits_month cr
),
reps as (
  select distinct
    coalesce(nullif(trim(r.name_norm), ''), '') as rep_name_norm,
    lower(coalesce(nullif(trim(r.email_norm), ''), '')) as rep_email_norm
  from raw.sales_reps_ref r
  where coalesce(r.active, true) = true
),
web_orders_unique as (
  select
    o.order_id,
    min(o.purchase_date) as purchase_date,
    max(o.subtotal_incl)::numeric as subtotal_incl,
    max(o.subtotal_excl)::numeric as subtotal_excl,
    max(o.customer_name) as customer_name,
    max(o.company_id) as company_id,
    max(o.company_name) as company_name,
    lower(trim(coalesce(max(o.real_email), ''))) as customer_email_norm,
    regexp_replace(
      lower(
        translate(
          coalesce(max(o.customer_name), ''),
          'Ã¡Ã°Ã¾Ã¦Ã¶Ã©Ã­Ã³ÃºÃ½ÃÃÃžÃ†Ã–Ã‰ÃÃ“ÃšÃ',
          'adthaeoeiouyadthaeoeiouy'
        )
      ),
      '[^a-z0-9]+',
      '',
      'g'
    ) as customer_norm,
    coalesce(
      nullif(trim(max(o.company_id)), ''),
      nullif(
        regexp_replace(
          lower(
            translate(
              coalesce(max(o.company_name), ''),
              'Ã¡Ã°Ã¾Ã¦Ã¶Ã©Ã­Ã³ÃºÃ½ÃÃÃžÃ†Ã–Ã‰ÃÃ“ÃšÃ',
              'adthaeoeiouyadthaeoeiouy'
            )
          ),
          '[^a-z0-9]+',
          '',
          'g'
        ),
        ''
      ),
      nullif(
        regexp_replace(
          lower(
            translate(
              coalesce(max(o.customer_name), ''),
              'Ã¡Ã°Ã¾Ã¦Ã¶Ã©Ã­Ã³ÃºÃ½ÃÃÃžÃ†Ã–Ã‰ÃÃ“ÃšÃ',
              'adthaeoeiouyadthaeoeiouy'
            )
          ),
          '[^a-z0-9]+',
          '',
          'g'
        ),
        ''
      )
    ) as company_key
  from unified_web_orders o
  cross join month_ctx m
  where o.purchase_date >= m.month_start::timestamp
    and o.purchase_date < m.month_end::timestamp
  group by o.order_id
),
rep_month as (
  select
    coalesce(sum(w.subtotal_incl), 0)::numeric as rep_revenue_incl
  from web_orders_unique w
  join reps r on (
    (r.rep_name_norm <> '' and r.rep_name_norm = w.customer_norm)
    or (r.rep_email_norm <> '' and r.rep_email_norm = w.customer_email_norm)
  )
),
self_serve_month as (
  with companies as (
    select
      w.company_key,
      bool_or(r.rep_name_norm is not null or r.rep_email_norm is not null) as has_rep,
      bool_or(r.rep_name_norm is null and r.rep_email_norm is null) as has_non_rep
    from web_orders_unique w
    left join reps r on (
      (r.rep_name_norm <> '' and r.rep_name_norm = w.customer_norm)
      or (r.rep_email_norm <> '' and r.rep_email_norm = w.customer_email_norm)
    )
    where w.company_key is not null
    group by w.company_key
  )
  select
    count(*) filter (where has_rep)::numeric as rep_companies,
    count(*) filter (where has_rep and has_non_rep)::numeric as self_serve_companies
  from companies
),
buyer_first_seen as (
  select
    case
      when nullif(trim(o.company_id), '') is not null then 'cid:' || trim(o.company_id)
      when nullif(trim(o.real_email), '') is not null then 'email:' || lower(trim(o.real_email))
      when nullif(trim(o.company_name), '') is not null then 'cname:' || lower(trim(o.company_name))
      when nullif(trim(o.customer_name), '') is not null then 'cust:' || lower(trim(o.customer_name))
      else null
    end as buyer_key,
    min(o.purchase_date)::date as first_date
  from raw.newweb_orders_raw o
  where o.purchase_date is not null
  group by 1
),
new_web_customers_month as (
  select count(*)::numeric as new_customers
  from buyer_first_seen b
  cross join month_ctx m
  where b.buyer_key is not null
    and b.first_date >= m.month_start
    and b.first_date < m.month_end
),
selected_day as (
  select
    case
      when m.month_start = m.current_month_start then current_date
      else coalesce(
        (select max(date(o.purchase_date)) from unified_web_orders o
         where o.purchase_date >= m.month_start::timestamp
           and o.purchase_date < m.month_end::timestamp),
        m.month_start
      )
    end as day
  from month_ctx m
),
day_web as (
  select
    coalesce(count(distinct o.order_id), 0)::numeric as orders,
    coalesce(sum(o.subtotal_excl), 0)::numeric as revenue_excl,
    coalesce(sum(o.subtotal_incl), 0)::numeric as revenue_incl
  from unified_web_orders o
  cross join selected_day d
  where date(o.purchase_date) = d.day
),
day_avg_365 as (
  with daily as (
    select
      date(o.purchase_date) as day,
      count(distinct o.order_id)::numeric as orders,
      coalesce(sum(o.subtotal_excl), 0)::numeric as revenue_excl,
      coalesce(sum(o.subtotal_incl), 0)::numeric as revenue_incl
    from unified_web_orders o
    cross join selected_day d
    where o.purchase_date >= (d.day::timestamp - interval '365 day')
      and o.purchase_date < d.day::timestamp
    group by 1
  )
  select
    coalesce(avg(daily.orders), 0)::numeric as avg_orders,
    coalesce(avg(daily.revenue_excl), 0)::numeric as avg_revenue_excl,
    coalesce(avg(daily.revenue_incl), 0)::numeric as avg_revenue_incl
  from daily
),
day_avg_weekday_12w as (
  with day_ref as (
    select d.day as day, extract(isodow from d.day)::int as iso_dow
    from selected_day d
  ),
  daily as (
    select
      date(o.purchase_date) as day,
      count(distinct o.order_id)::numeric as orders,
      coalesce(sum(o.subtotal_excl), 0)::numeric as revenue_excl,
      coalesce(sum(o.subtotal_incl), 0)::numeric as revenue_incl
    from unified_web_orders o
    cross join day_ref r
    where o.purchase_date >= (r.day::timestamp - interval '84 day')
      and o.purchase_date < r.day::timestamp
      and extract(isodow from o.purchase_date) = r.iso_dow
    group by 1
  )
  select
    coalesce(avg(daily.orders), 0)::numeric as avg_orders,
    coalesce(avg(daily.revenue_excl), 0)::numeric as avg_revenue_excl,
    coalesce(avg(daily.revenue_incl), 0)::numeric as avg_revenue_incl,
    coalesce(count(*), 0)::int as sample_days
  from daily
)
select jsonb_build_object(
  'month',
  jsonb_build_object(
    'month', (select ym from month_key),
    'revenueIncl', coalesce((select revenue_incl from web_month), 0),
    'revenueExcl', coalesce((select revenue_excl from web_month), 0),
    'orders', coalesce((select orders from web_month), 0),
    'webOrdersPct', case when coalesce((select orders from bc_net), 0) > 0
      then coalesce((select web_orders from bc_net), 0) / nullif((select orders from bc_net), 0)
      else 0 end,
    'webRevenuePct', case when coalesce((select revenue_excl from bc_net), 0) > 0
      then coalesce((select web_revenue_excl from bc_net), 0) / nullif((select revenue_excl from bc_net), 0)
      else 0 end,
    'salesRepPct', case when coalesce((select revenue_incl from web_month), 0) > 0
      then coalesce((select rep_revenue_incl from rep_month), 0) / nullif((select revenue_incl from web_month), 0)
      else 0 end,
    'selfServePct', case when coalesce((select rep_companies from self_serve_month), 0) > 0
      then coalesce((select self_serve_companies from self_serve_month), 0) / nullif((select rep_companies from self_serve_month), 0)
      else 0 end,
    'aovExcl', case when coalesce((select orders from web_month), 0) > 0
      then coalesce((select revenue_excl from web_month), 0) / nullif((select orders from web_month), 0)
      else 0 end,
    'bcAovExcl', case when coalesce((select orders from bc_net), 0) > 0
      then coalesce((select revenue_excl from bc_net), 0) / nullif((select orders from bc_net), 0)
      else 0 end,
    'aovWebPct',
      case
        when (
          coalesce(
            case when coalesce((select orders from web_month), 0) > 0
              then coalesce((select revenue_excl from web_month), 0) / nullif((select orders from web_month), 0)
              else 0 end, 0
          ) +
          coalesce(
            case when coalesce((select orders from bc_net), 0) > 0
              then coalesce((select revenue_excl from bc_net), 0) / nullif((select orders from bc_net), 0)
              else 0 end, 0
          )
        ) > 0
        then
          coalesce(
            case when coalesce((select orders from web_month), 0) > 0
              then coalesce((select revenue_excl from web_month), 0) / nullif((select orders from web_month), 0)
              else 0 end, 0
          ) /
          (
            coalesce(
              case when coalesce((select orders from web_month), 0) > 0
                then coalesce((select revenue_excl from web_month), 0) / nullif((select orders from web_month), 0)
                else 0 end, 0
            ) +
            coalesce(
              case when coalesce((select orders from bc_net), 0) > 0
                then coalesce((select revenue_excl from bc_net), 0) / nullif((select orders from bc_net), 0)
                else 0 end, 0
            )
          )
        else 0
      end,
    'aovBcPct',
      case
        when (
          coalesce(
            case when coalesce((select orders from web_month), 0) > 0
              then coalesce((select revenue_excl from web_month), 0) / nullif((select orders from web_month), 0)
              else 0 end, 0
          ) +
          coalesce(
            case when coalesce((select orders from bc_net), 0) > 0
              then coalesce((select revenue_excl from bc_net), 0) / nullif((select orders from bc_net), 0)
              else 0 end, 0
          )
        ) > 0
        then
          coalesce(
            case when coalesce((select orders from bc_net), 0) > 0
              then coalesce((select revenue_excl from bc_net), 0) / nullif((select orders from bc_net), 0)
              else 0 end, 0
          ) /
          (
            coalesce(
              case when coalesce((select orders from web_month), 0) > 0
                then coalesce((select revenue_excl from web_month), 0) / nullif((select orders from web_month), 0)
                else 0 end, 0
            ) +
            coalesce(
              case when coalesce((select orders from bc_net), 0) > 0
                then coalesce((select revenue_excl from bc_net), 0) / nullif((select orders from bc_net), 0)
                else 0 end, 0
            )
          )
        else 0
      end,
    'newWebCustomers', coalesce((select new_customers from new_web_customers_month), 0),
    'newWebCustomersPct', case when coalesce((select orders from web_month), 0) > 0
      then coalesce((select new_customers from new_web_customers_month), 0) / nullif((select orders from web_month), 0)
      else 0 end,
    'firstTimeWebBuyers', coalesce((select new_customers from new_web_customers_month), 0),
    'firstTimeWebBuyersPct', case when coalesce((select orders from web_month), 0) > 0
      then coalesce((select new_customers from new_web_customers_month), 0) / nullif((select orders from web_month), 0)
      else 0 end,
    'yoyPct', case when coalesce((select revenue_incl from web_prev_year), 0) > 0
      then coalesce((select revenue_incl from web_month), 0) / nullif((select revenue_incl from web_prev_year), 0)
      else 0 end,
    'yoyOrdersPct', case when coalesce((select orders from web_prev_year), 0) > 0
      then coalesce((select orders from web_month), 0) / nullif((select orders from web_prev_year), 0)
      else 0 end
  ),
  'day',
  jsonb_build_object(
    'date', to_char((select day from selected_day), 'YYYY-MM-DD'),
    'orders', coalesce((select orders from day_web), 0),
    'revenueExcl', coalesce((select revenue_excl from day_web), 0),
    'revenueIncl', coalesce((select revenue_incl from day_web), 0)
  ),
  'dayBenchmark',
  jsonb_build_object(
    'avgOrders365', coalesce((select avg_orders from day_avg_365), 0),
    'avgRevenueExcl365', coalesce((select avg_revenue_excl from day_avg_365), 0),
    'avgRevenueIncl365', coalesce((select avg_revenue_incl from day_avg_365), 0),
    'paceOrdersPct365',
      case when coalesce((select avg_orders from day_avg_365), 0) > 0
        then coalesce((select orders from day_web), 0) / nullif((select avg_orders from day_avg_365), 0)
        else 0 end,
    'paceRevenueExclPct365',
      case when coalesce((select avg_revenue_excl from day_avg_365), 0) > 0
        then coalesce((select revenue_excl from day_web), 0) / nullif((select avg_revenue_excl from day_avg_365), 0)
        else 0 end,
    'avgOrdersWeekday12w', coalesce((select avg_orders from day_avg_weekday_12w), 0),
    'avgRevenueExclWeekday12w', coalesce((select avg_revenue_excl from day_avg_weekday_12w), 0),
    'avgRevenueInclWeekday12w', coalesce((select avg_revenue_incl from day_avg_weekday_12w), 0),
    'sampleDaysWeekday12w', coalesce((select sample_days from day_avg_weekday_12w), 0),
    'paceOrdersPctWeekday12w',
      case when coalesce((select avg_orders from day_avg_weekday_12w), 0) > 0
        then coalesce((select orders from day_web), 0) / nullif((select avg_orders from day_avg_weekday_12w), 0)
        else 0 end,
    'paceRevenueExclPctWeekday12w',
      case when coalesce((select avg_revenue_excl from day_avg_weekday_12w), 0) > 0
        then coalesce((select revenue_excl from day_web), 0) / nullif((select avg_revenue_excl from day_avg_weekday_12w), 0)
        else 0 end
  ),
  'dayOrders', coalesce((select orders from day_web), 0),
  'dayRevenueExcl', coalesce((select revenue_excl from day_web), 0)
);
$function$;

grant execute on function api.dashboard_compat(date) to anon, authenticated, service_role;

create or replace function api.dashboard_compat(p_month text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'api', 'mart', 'raw'
as $function$
select api.dashboard_compat(
  case
    when p_month is null or btrim(p_month) = '' then null::date
    when p_month ~ '^\d{4}-\d{2}$' then to_date(p_month || '-01', 'YYYY-MM-DD')
    else p_month::date
  end
);
$function$;

grant execute on function api.dashboard_compat(text) to anon, authenticated, service_role;


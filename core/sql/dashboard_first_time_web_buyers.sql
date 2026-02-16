-- Monthly first-time unique web buyers from NEWWEB orders.
-- Run in Supabase SQL editor.
--
-- Identity priority:
-- 1) company_id
-- 2) real_email
-- 3) company_name
-- 4) customer_name

create or replace function api.monthly_first_time_web_buyers(p_month date default current_date)
returns table (
  month_key text,
  first_time_web_buyers bigint
)
language sql
stable
as $$
with normalized as (
  select
    date_trunc('month', purchase_date)::date as month_start,
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
),
first_seen as (
  select
    buyer_key,
    min(purchase_date) as first_purchase_at
  from normalized
  where buyer_key is not null
  group by buyer_key
),
monthly as (
  select
    date_trunc('month', first_purchase_at)::date as month_start,
    count(*)::bigint as first_time_web_buyers
  from first_seen
  group by 1
)
select
  to_char(m.month_start, 'YYYY-MM') as month_key,
  m.first_time_web_buyers
from monthly m
where m.month_start = date_trunc('month', p_month)::date;
$$;

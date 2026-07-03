-- Day orders list for the "Vefpantanir í dag" widget (Sölutölur / Mælaborð).
-- is_first_time flags orders whose buyer is making their first-ever web purchase
-- on p_day. Identity priority matches dashboard_first_time_web_buyers / day_kpi_pack:
--   company_id → real_email → company_name → customer_name.

-- Return type changed (added is_first_time) — drop the old signature first.
drop function if exists public.get_day_orders(date, int);

create or replace function public.get_day_orders(
  p_day   date default current_date,
  p_limit int  default 10
) returns table (
  purchase_date  timestamptz,
  customer_name  text,
  customer_id    text,
  subtotal_excl  numeric,
  is_first_time  boolean
)
language sql stable
as $$
  with buyer_keyed as (
    select
      purchase_date,
      company_name,
      customer_name,
      company_id,
      subtotal_excl,
      case
        when nullif(trim(company_id), '') is not null then 'cid:' || trim(company_id)
        when nullif(trim(real_email), '') is not null then 'email:' || lower(trim(real_email))
        when nullif(trim(company_name), '') is not null then 'cname:' || lower(trim(company_name))
        when nullif(trim(customer_name), '') is not null then 'cust:' || lower(trim(customer_name))
        else null
      end as buyer_key
    from raw.newweb_orders_raw
    where purchase_date is not null
  ),
  first_seen as (
    select buyer_key, min(purchase_date)::date as first_day
    from buyer_keyed
    where buyer_key is not null
    group by buyer_key
  )
  select
    b.purchase_date::timestamptz,
    coalesce(nullif(trim(b.company_name), ''), nullif(trim(b.customer_name), ''), 'Óþekktur') as customer_name,
    b.company_id::text,
    b.subtotal_excl::numeric,
    (fs.first_day >= p_day) as is_first_time
  from buyer_keyed b
  left join first_seen fs on fs.buyer_key = b.buyer_key
  where b.purchase_date >= p_day::timestamp
    and b.purchase_date < (p_day::timestamp + interval '1 day')
  order by b.purchase_date desc
  limit case when p_limit = 0 then null else p_limit end;
$$;

grant execute on function public.get_day_orders(date, int) to anon, authenticated, service_role;

create or replace function public.get_day_orders(
  p_day   date default current_date,
  p_limit int  default 10
) returns table (
  purchase_date  timestamptz,
  customer_name  text,
  customer_id    text,
  subtotal_excl  numeric
)
language sql stable
as $$
  select
    purchase_date::timestamptz,
    coalesce(nullif(trim(company_name), ''), nullif(trim(customer_name), ''), 'Óþekktur') as customer_name,
    company_id::text,
    subtotal_excl::numeric
  from raw.newweb_orders_raw
  where purchase_date >= p_day::timestamp
    and purchase_date < (p_day::timestamp + interval '1 day')
  order by purchase_date desc
  limit case when p_limit = 0 then null else p_limit end;
$$;

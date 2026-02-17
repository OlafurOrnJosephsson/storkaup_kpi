-- Last orders for a selected customer profile (company ID / KT).
-- Run in Supabase SQL editor.

create schema if not exists api;

create or replace function api.get_customer_last_orders(
  p_customer_id text,
  p_limit int default 5
)
returns table (
  order_id text,
  total numeric,
  order_user text,
  purchase_date timestamptz
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  select
    coalesce(n.order_id, '')::text as order_id,
    coalesce(n.grand_total, n.subtotal_excl, 0)::numeric as total,
    coalesce(
      nullif(trim(n.customer_name), ''),
      nullif(trim(n.real_email), ''),
      'Óþekktur'
    )::text as order_user,
    n.purchase_date::timestamptz as purchase_date
  from raw.newweb_orders_raw n
  where nullif(trim(coalesce(p_customer_id, '')), '') is not null
    and (
      trim(coalesce(n.company_id, '')) = trim(p_customer_id)
      or trim(coalesce(n.national_id, '')) = trim(p_customer_id)
    )
  order by n.purchase_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 5), 25));
$function$;

grant execute on function api.get_customer_last_orders(text, int) to anon, authenticated;

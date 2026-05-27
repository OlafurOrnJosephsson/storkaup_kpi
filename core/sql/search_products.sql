create or replace function public.search_products(
  p_query     text,
  p_days_back int default 365,
  p_limit     int default 50
) returns table (
  sku          text,
  product_name text,
  orders       bigint,
  revenue_excl numeric
)
language sql stable security definer as $$
  select
    regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') as sku,
    max(l.product_name)                          as product_name,
    count(distinct l.document_no)::bigint        as orders,
    sum(l.amount_excl)::numeric                  as revenue_excl
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  where (
    l.sku          ilike '%' || p_query || '%' or
    l.product_name ilike '%' || p_query || '%'
  )
  and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  group by regexp_replace(l.sku, '_[A-Za-z0-9]+$', '')
  order by revenue_excl desc nulls last
  limit p_limit;
$$;

grant execute on function public.search_products(text, int, int) to anon, authenticated;

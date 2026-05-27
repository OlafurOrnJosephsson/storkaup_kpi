create or replace function public.get_product_buyers(
  p_sku       text,
  p_days_back int default 365
) returns table (
  customer_no   text,
  customer_name text,
  orders        bigint,
  qty_total     numeric,
  revenue_excl  numeric
)
language sql stable security definer as $$
  select
    i.company_id::text                                                        as customer_no,
    max(coalesce(nullif(trim(i.company_name), ''), i.company_id))::text       as customer_name,
    count(distinct l.document_no)::bigint                                     as orders,
    sum(l.qty)::numeric                                                        as qty_total,
    sum(l.amount_excl)::numeric                                                as revenue_excl
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  where regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') = p_sku
    and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  group by i.company_id
  order by revenue_excl desc nulls last
  limit 100;
$$;

grant execute on function public.get_product_buyers(text, int) to anon, authenticated;

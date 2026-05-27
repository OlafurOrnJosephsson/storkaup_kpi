create or replace function public.get_product_transactions(
  p_sku       text,
  p_days_back int default 90,
  p_limit     int default 100
) returns table (
  booking_date  date,
  document_no   text,
  customer_name text,
  qty           numeric,
  amount_excl   numeric
)
language sql stable security definer as $$
  select
    coalesce(i.booking_date, i.order_date)                                    as booking_date,
    l.document_no::text,
    coalesce(nullif(trim(i.company_name), ''), i.company_id)::text            as customer_name,
    l.qty::numeric,
    l.amount_excl::numeric
  from raw.bc_lines_raw l
  join raw.bc_invoices_raw i on i.document_no = l.document_no
  where regexp_replace(l.sku, '_[A-Za-z0-9]+$', '') = p_sku
    and coalesce(i.booking_date, i.order_date) >= current_date - p_days_back
  order by coalesce(i.booking_date, i.order_date) desc nulls last
  limit case when p_limit = 0 then null else p_limit end;
$$;

grant execute on function public.get_product_transactions(text, int, int) to anon, authenticated;

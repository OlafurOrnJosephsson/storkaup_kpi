-- Unified order search across BC invoices and Magento web orders.
-- Run in Supabase SQL editor.

create schema if not exists api;

create or replace function api.search_orders(
  p_query text,
  p_limit int default 25
)
returns table (
  source           text,
  order_id         text,   -- BC: document_no (SR-nr)  | Web: Magento order_id
  ext_id           text,   -- BC: external_doc_no (SP) | Web: ""
  company_name     text,
  company_id       text,   -- kennitala / customer ID
  total            numeric,
  order_date       timestamptz,
  status           text,
  salesperson_code text,
  items            text
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  with q as (
    select '%' || lower(trim(coalesce(p_query, ''))) || '%' as pat
    where length(trim(coalesce(p_query, ''))) >= 2
  ),
  bc as (
    select
      'bc'::text                                                           as source,
      coalesce(i.document_no::text, '')                                   as order_id,
      coalesce(i.external_doc_no, '')::text                               as ext_id,
      coalesce(i.company_name, '')::text                                  as company_name,
      coalesce(i.company_id::text, '')                                    as company_id,
      coalesce(i.amount_excl, 0)::numeric                                 as total,
      coalesce(i.booking_date, i.order_date)::timestamptz                 as order_date,
      case
        when lower(coalesce(i.canceled, '')) not in ('', 'no', 'false', '0', 'nei') then 'canceled'
        when lower(coalesce(i.closed,   '')) not in ('', 'no', 'false', '0', 'nei') then 'closed'
        else 'open'
      end::text                                                           as status,
      coalesce(i.salesperson_code, '')::text                              as salesperson_code,
      null::text                                                          as items
    from raw.bc_invoices_raw i
    cross join q
    where
      lower(coalesce(i.document_no::text,   '')) like q.pat
      or lower(coalesce(i.company_name,     '')) like q.pat
      or lower(coalesce(i.company_id::text, '')) like q.pat
      or lower(coalesce(i.external_doc_no,  '')) like q.pat
  ),
  web as (
    select
      'web'::text                                                         as source,
      coalesce(n.order_id, '')::text                                      as order_id,
      ''::text                                                            as ext_id,
      coalesce(nullif(trim(n.company_name), ''), n.customer_name, '')     as company_name,
      coalesce(nullif(trim(n.company_id), ''), n.national_id, '')         as company_id,
      coalesce(n.grand_total, n.subtotal_excl, 0)::numeric               as total,
      n.purchase_date::timestamptz                                        as order_date,
      coalesce(n.status, '')::text                                        as status,
      ''::text                                                            as salesperson_code,
      coalesce(n.items, '')::text                                         as items
    from raw.newweb_orders_raw n
    cross join q
    where
      lower(coalesce(n.order_id,       '')) like q.pat
      or lower(coalesce(n.company_name,'')) like q.pat
      or lower(coalesce(n.customer_name,'')) like q.pat
      or lower(coalesce(n.company_id,  '')) like q.pat
      or lower(coalesce(n.national_id, '')) like q.pat
  ),
  combined as (
    select * from bc
    union all
    select * from web
  )
  select
    source, order_id, ext_id, company_name, company_id,
    total, order_date, status, salesperson_code, items
  from combined
  order by order_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$function$;

grant execute on function api.search_orders(text, int) to anon, authenticated;

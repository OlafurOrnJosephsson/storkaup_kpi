-- Unified order search: BC invoices (SR), BC credits (SK), web orders (WEB).
-- Run in Supabase SQL editor.

-- Add order_no column if not already present
alter table raw.bc_invoices_raw
  add column if not exists order_no text;

drop function if exists api.search_orders(text, integer);

create schema if not exists api;

create or replace function api.search_orders(
  p_query text,
  p_limit int default 25
)
returns table (
  source           text,    -- "bc" | "web"
  doc_type         text,    -- "SR" | "SK" | "WEB"
  order_id         text,    -- SR-nr / SK-nr / Magento order ID
  sp_no            text,    -- SP-nr (sölupöntun, BC only)
  web_order_id     text,    -- Magento order ID (SR: external_doc_no | WEB: order_id)
  company_name     text,
  company_id       text,    -- kennitala
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
  sr as (
    -- Sölureikningar (BC invoices)
    select
      'bc'::text                                                           as source,
      'SR'::text                                                           as doc_type,
      coalesce(i.document_no::text, '')                                   as order_id,
      coalesce(i.order_no, '')::text                                      as sp_no,
      coalesce(i.external_doc_no, '')::text                               as web_order_id,
      coalesce(i.company_name, '')::text                                  as company_name,
      coalesce(i.company_id::text, '')                                    as company_id,
      coalesce(i.amount_incl, 0)::numeric                                 as total,
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
      or lower(coalesce(i.order_no,         '')) like q.pat
      or lower(coalesce(i.external_doc_no,  '')) like q.pat
      or lower(coalesce(i.company_name,     '')) like q.pat
      or lower(coalesce(i.company_id::text, '')) like q.pat
  ),
  sk as (
    -- Sölukreditreikningar (BC credit invoices)
    select
      'bc'::text                                                           as source,
      'SK'::text                                                           as doc_type,
      coalesce(c.document_no::text, '')                                   as order_id,
      ''::text                                                            as sp_no,
      ''::text                                                            as web_order_id,
      coalesce(c.company_name, '')::text                                  as company_name,
      coalesce(c.company_id::text, '')                                    as company_id,
      coalesce(c.amount_incl, 0)::numeric                                 as total,
      coalesce(c.booking_date, c.order_date)::timestamptz                 as order_date,
      case
        when lower(coalesce(c.canceled, '')) not in ('', 'no', 'false', '0', 'nei') then 'canceled'
        when lower(coalesce(c.closed,   '')) not in ('', 'no', 'false', '0', 'nei') then 'closed'
        else 'open'
      end::text                                                           as status,
      coalesce(c.salesperson_code, '')::text                              as salesperson_code,
      null::text                                                          as items
    from raw.bc_credit_invoices_raw c
    cross join q
    where
      lower(coalesce(c.document_no::text,   '')) like q.pat
      or lower(coalesce(c.company_name,     '')) like q.pat
      or lower(coalesce(c.company_id::text, '')) like q.pat
  ),
  web as (
    -- Vefpantanir (Magento)
    select
      'web'::text                                                         as source,
      'WEB'::text                                                         as doc_type,
      coalesce(n.order_id, '')::text                                      as order_id,
      ''::text                                                            as sp_no,
      coalesce(n.order_id, '')::text                                      as web_order_id,
      coalesce(nullif(trim(n.company_name), ''), n.customer_name, '')     as company_name,
      coalesce(nullif(trim(n.company_id), ''), n.national_id, '')         as company_id,
      coalesce(n.grand_total, n.subtotal_excl, 0)::numeric               as total,
      n.purchase_date::timestamptz                                        as order_date,
      coalesce(n.status, '')::text                                        as status,
      ''::text                                                            as salesperson_code,
      coalesce(n.items, '')::text                                         as items
    from raw.newweb_orders_raw n
    cross join q
    where (
      lower(coalesce(n.order_id,        '')) like q.pat
      or lower(coalesce(n.company_name, '')) like q.pat
      or lower(coalesce(n.customer_name,'')) like q.pat
      or lower(coalesce(n.company_id,   '')) like q.pat
      or lower(coalesce(n.national_id,  '')) like q.pat
    )
    and not exists (
      select 1 from raw.bc_invoices_raw i
      where i.external_doc_no = n.order_id
    )
  ),
  combined as (
    select * from sr
    union all
    select * from sk
    union all
    select * from web
  )
  select
    source, doc_type, order_id, sp_no, web_order_id,
    company_name, company_id,
    total, order_date, status, salesperson_code, items
  from combined
  order by order_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$function$;

grant execute on function api.search_orders(text, int) to anon, authenticated;

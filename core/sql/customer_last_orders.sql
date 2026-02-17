-- Last orders for a selected customer profile (company ID / KT).
-- Run in Supabase SQL editor.

create schema if not exists api;

create or replace function api.get_customer_last_orders(
  p_customer_id text,
  p_limit int default 5
)
returns table (
  source text,
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
  with in_customer as (
    select trim(coalesce(p_customer_id, '')) as customer_id
  ),
  web_orders as (
    select
      'web'::text as source,
      coalesce(n.order_id, '')::text as order_id,
      coalesce(n.grand_total, n.subtotal_excl, 0)::numeric as total,
      coalesce(
        nullif(trim(n.customer_name), ''),
        nullif(trim(n.real_email), ''),
        'Unknown'
      )::text as order_user,
      n.purchase_date::timestamptz as purchase_date
    from raw.newweb_orders_raw n
    join in_customer c on c.customer_id <> ''
    where trim(coalesce(n.company_id, '')) = c.customer_id
       or trim(coalesce(n.national_id, '')) = c.customer_id
  ),
  bc_totals as (
    select
      l.document_no::text as document_no,
      sum(coalesce(l.amount_excl, 0))::numeric as total_excl
    from raw.bc_lines_raw l
    group by l.document_no
  ),
  bc_orders as (
    select
      'bc'::text as source,
      coalesce(i.document_no::text, '') as order_id,
      coalesce(t.total_excl, 0)::numeric as total,
      coalesce(
        nullif(trim(to_jsonb(i)->>'salesperson_name'), ''),
        nullif(trim(to_jsonb(i)->>'salesperson_code'), ''),
        nullif(trim(to_jsonb(i)->>'salesperson'), ''),
        'BC'
      )::text as order_user,
      coalesce(
        i.order_date::timestamptz,
        (to_jsonb(i)->>'posting_date')::timestamptz,
        (to_jsonb(i)->>'document_date')::timestamptz
      ) as purchase_date
    from raw.bc_invoices_raw i
    left join bc_totals t on t.document_no = i.document_no::text
    join in_customer c on c.customer_id <> ''
    where trim(coalesce(i.company_id::text, '')) = c.customer_id
       or trim(coalesce(to_jsonb(i)->>'national_id', '')) = c.customer_id
       or trim(coalesce(to_jsonb(i)->>'customer_no', '')) = c.customer_id
       or trim(coalesce(to_jsonb(i)->>'sell_to_customer_no', '')) = c.customer_id
  ),
  combined as (
    select * from web_orders
    union all
    select * from bc_orders
  )
  select
    source,
    order_id,
    total,
    order_user,
    purchase_date
  from combined
  order by purchase_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 5), 25));
$function$;

grant execute on function api.get_customer_last_orders(text, int) to anon, authenticated;

-- Last orders for a selected customer profile (company ID / KT).
-- Run in Supabase SQL editor.

create schema if not exists api;

create or replace function api.resolve_customer_family_ids(
  p_customer_id text
)
returns table (
  customer_id text
)
language sql
stable
security definer
set search_path to 'api', 'raw', 'public'
as $function$
  with input_customer as (
    select
      trim(coalesce(p_customer_id, '')) as raw_id,
      regexp_replace(trim(coalesce(p_customer_id, '')), '\D', '', 'g') as norm_id
  ),
  family_key as (
    select
      raw_id,
      norm_id,
      case
        when length(norm_id) >= 10 then left(norm_id, 10)
        else norm_id
      end as family_norm
    from input_customer
  ),
  all_candidates as (
    select trim(customer_id::text) as customer_id
    from raw.customer_analysis_raw
    where customer_id is not null
    union
    select trim(company_id::text) as customer_id
    from raw.bc_customers_raw
    where company_id is not null
    union
    select trim((p_customer_id)::text) as customer_id
  ),
  matched as (
    select distinct c.customer_id
    from all_candidates c
    cross join family_key fk
    where c.customer_id <> ''
      and (
        (fk.norm_id <> '' and (
          regexp_replace(c.customer_id, '\D', '', 'g') = fk.norm_id
          or (
            length(fk.family_norm) = 10
            and left(regexp_replace(c.customer_id, '\D', '', 'g'), 10) = fk.family_norm
          )
        ))
        or (fk.norm_id = '' and c.customer_id = fk.raw_id)
      )
  )
  select customer_id
  from matched
  order by customer_id;
$function$;

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
  with family_ids as (
    select
      trim(f.customer_id) as customer_id_raw,
      regexp_replace(trim(f.customer_id), '\D', '', 'g') as customer_id_norm
    from api.resolve_customer_family_ids(p_customer_id) f
    where trim(coalesce(f.customer_id, '')) <> ''
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
    where exists (
      select 1
      from family_ids f
      where
        (
          f.customer_id_norm <> ''
          and (
            regexp_replace(coalesce(n.company_id, ''), '\D', '', 'g') = f.customer_id_norm
            or regexp_replace(coalesce(n.national_id, ''), '\D', '', 'g') = f.customer_id_norm
          )
        )
        or (
          f.customer_id_norm = ''
          and (
            trim(coalesce(n.company_id, '')) = f.customer_id_raw
            or trim(coalesce(n.national_id, '')) = f.customer_id_raw
          )
        )
    )
  ),
  bc_docs_raw as (
    select
      'bc'::text as source,
      coalesce(i.document_no::text, '') as order_id,
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
    where exists (
      select 1
      from family_ids f
      where
        (
          f.customer_id_norm <> ''
          and regexp_replace(coalesce(i.company_id::text, ''), '\D', '', 'g') = f.customer_id_norm
        )
        or (
          f.customer_id_norm = ''
          and trim(coalesce(i.company_id::text, '')) = f.customer_id_raw
        )
    )
      and upper(
        coalesce(
          nullif(trim(to_jsonb(i)->>'salesperson_name'), ''),
          nullif(trim(to_jsonb(i)->>'salesperson_code'), ''),
          nullif(trim(to_jsonb(i)->>'salesperson'), ''),
          ''
        )
      ) <> 'VEFUR'
  ),
  bc_docs as (
    select *
    from bc_docs_raw
    order by purchase_date desc nulls last
    limit greatest(10, least(coalesce(p_limit, 5) * 8, 200))
  ),
  bc_totals as (
    select
      l.document_no::text as order_id,
      sum(coalesce(l.amount_excl, 0))::numeric as total_excl
    from raw.bc_lines_raw l
    join bc_docs d on d.order_id = l.document_no::text
    group by l.document_no
  ),
  bc_orders as (
    select
      d.source,
      d.order_id,
      coalesce(t.total_excl, 0)::numeric as total,
      d.order_user,
      d.purchase_date
    from bc_docs d
    left join bc_totals t on t.order_id = d.order_id
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
grant execute on function api.resolve_customer_family_ids(text) to anon, authenticated;

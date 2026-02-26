-- Web booking reconciliation (fast v1)
--
-- Scope:
-- - NEWWEB is considered reliable from 2025-08-18 onward.
-- - Uses exact external_doc_no -> order_id mapping (deterministic, fast).
-- - Adds a lightweight diagnostics view for unmatched orders.

create schema if not exists mart;

create or replace view mart.v_web_booking_reconciliation_orders as
with newweb as (
  select
    n.order_id::text as order_id,
    min(n.purchase_date) as purchase_ts,
    sum(coalesce(n.subtotal_excl, 0)) as web_revenue_excl,
    sum(coalesce(n.subtotal_incl, 0)) as web_revenue_incl
  from raw.newweb_orders_raw n
  where n.order_id is not null
    and n.purchase_date is not null
    and n.purchase_date >= timestamptz '2025-08-18 00:00:00+00'
  group by n.order_id
),
bc_web as (
  select
    i.document_no::text as document_no,
    nullif(trim(i.external_doc_no), '') as external_doc_no,
    i.order_date as order_ts,
    coalesce(i.amount_excl, 0) as amount_excl,
    coalesce(i.amount_incl, 0) as amount_incl
  from raw.bc_invoices_raw i
  where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
    and i.order_date is not null
    and i.order_date >= timestamptz '2025-08-18 00:00:00+00'
    and not (
      lower(trim(coalesce(i.canceled::text, ''))) in ('1','true','t','yes','y','ja','já')
      or lower(trim(coalesce(i.corrective::text, ''))) in ('1','true','t','yes','y','ja','já')
    )
)
select
  n.order_id,
  n.purchase_ts,
  n.web_revenue_excl,
  n.web_revenue_incl,
  b.document_no as bc_document_no,
  b.external_doc_no as bc_external_doc_no,
  b.order_ts as bc_order_ts,
  b.amount_excl as booked_revenue_excl,
  b.amount_incl as booked_revenue_incl,
  case when b.document_no is not null then 'external_doc_exact' else 'unmatched' end as match_rule,
  case when b.document_no is not null then 100 else 0 end as match_score,
  (b.document_no is not null) as is_booked_match,
  case
    when b.document_no is null then null
    else greatest(0, round(extract(epoch from (coalesce(b.order_ts, n.purchase_ts) - n.purchase_ts)) / 86400.0, 2))
  end as booking_lag_days
from newweb n
left join bc_web b
  on b.external_doc_no = n.order_id;

create or replace view mart.v_web_booking_reconciliation_daily as
select
  date_trunc('day', purchase_ts)::date as day,
  count(*)::bigint as web_orders_magento,
  sum(web_revenue_excl) as web_revenue_excl_magento,
  sum(web_revenue_incl) as web_revenue_incl_magento,
  count(*) filter (where is_booked_match)::bigint as web_orders_booked_bc,
  sum(case when is_booked_match then booked_revenue_excl else 0 end) as web_revenue_excl_booked_bc,
  sum(case when is_booked_match then booked_revenue_incl else 0 end) as web_revenue_incl_booked_bc,
  (count(*) - count(*) filter (where is_booked_match))::bigint as web_orders_unbooked_gap,
  case
    when count(*) = 0 then 0
    else round((count(*) filter (where is_booked_match))::numeric / count(*)::numeric, 4)
  end as booking_rate,
  round(avg(booking_lag_days) filter (where is_booked_match), 2) as avg_booking_lag_days
from mart.v_web_booking_reconciliation_orders
group by 1;

create or replace view mart.v_web_booking_reconciliation_daily_exact as
select *
from mart.v_web_booking_reconciliation_daily;

create or replace view mart.v_web_booking_unmatched_diagnostics_60d as
with unmatched as (
  select
    o.order_id,
    o.purchase_ts,
    o.web_revenue_incl
  from mart.v_web_booking_reconciliation_orders o
  where not o.is_booked_match
    and o.purchase_ts >= (now() - interval '60 days')
),
bc_web as (
  select
    i.document_no::text as document_no,
    nullif(trim(i.external_doc_no), '') as external_doc_no,
    i.order_date as order_ts,
    coalesce(i.amount_incl, 0) as amount_incl
  from raw.bc_invoices_raw i
  where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
    and i.order_date >= (now() - interval '60 days')
    and not (
      lower(trim(coalesce(i.canceled::text, ''))) in ('1','true','t','yes','y','ja','já')
      or lower(trim(coalesce(i.corrective::text, ''))) in ('1','true','t','yes','y','ja','já')
    )
),
candidates as (
  select
    u.order_id,
    u.purchase_ts,
    u.web_revenue_incl,
    b.document_no as candidate_document_no,
    b.external_doc_no as candidate_external_doc_no,
    b.order_ts as candidate_order_ts,
    b.amount_incl as candidate_amount_incl,
    abs((b.order_ts::date - u.purchase_ts::date)::numeric) as day_distance,
    abs(coalesce(b.amount_incl, 0) - coalesce(u.web_revenue_incl, 0)) as amount_distance,
    row_number() over (
      partition by u.order_id
      order by
        abs((b.order_ts::date - u.purchase_ts::date)::numeric) asc,
        abs(coalesce(b.amount_incl, 0) - coalesce(u.web_revenue_incl, 0)) asc,
        b.document_no asc
    ) as rn
  from unmatched u
  join bc_web b
    on b.order_ts::date between (u.purchase_ts::date - 3) and (u.purchase_ts::date + 3)
)
select
  u.order_id,
  u.purchase_ts,
  u.web_revenue_incl,
  c.candidate_document_no,
  c.candidate_external_doc_no,
  c.candidate_order_ts,
  c.candidate_amount_incl,
  c.day_distance,
  c.amount_distance
from unmatched u
left join candidates c
  on c.order_id = u.order_id
 and c.rn = 1;

-- v2 summary:
-- - exact match: external_doc_no = order_id
-- - probable match: unmatched exact orders matched by tight day+amount tolerance
--   * day distance <= 1 day
--   * amount distance <= 2 ISK OR <= 0.5%
create or replace view mart.v_web_booking_reconciliation_daily_v2 as
with base as (
  select
    o.order_id,
    o.purchase_ts,
    o.web_revenue_excl,
    o.web_revenue_incl,
    o.is_booked_match as is_exact_match
  from mart.v_web_booking_reconciliation_orders o
  where o.purchase_ts >= (current_date - interval '45 days')
),
bc_web as (
  select
    i.document_no::text as document_no,
    i.order_date as order_ts,
    coalesce(i.amount_excl, 0) as amount_excl,
    coalesce(i.amount_incl, 0) as amount_incl
  from raw.bc_invoices_raw i
  where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
    and i.order_date is not null
    and i.order_date >= (current_date - interval '45 days')
    and not (
      lower(trim(coalesce(i.canceled::text, ''))) in ('1','true','t','yes','y','ja','já')
      or lower(trim(coalesce(i.corrective::text, ''))) in ('1','true','t','yes','y','ja','já')
    )
),
probable as (
  select
    b.order_id,
    c.document_no as probable_document_no,
    c.order_ts as probable_order_ts,
    c.amount_incl as probable_amount_incl,
    c.day_distance,
    c.amount_distance
  from base b
  join lateral (
    select
      x.document_no,
      x.order_ts,
      x.amount_incl,
      abs((x.order_ts::date - b.purchase_ts::date)::numeric) as day_distance,
      abs(coalesce(x.amount_incl, 0) - coalesce(b.web_revenue_incl, 0)) as amount_distance
    from bc_web x
    where x.order_ts::date between (b.purchase_ts::date - 1) and (b.purchase_ts::date + 1)
      and (
        abs(coalesce(x.amount_incl, 0) - coalesce(b.web_revenue_incl, 0)) <= 2
        or (
          abs(coalesce(x.amount_incl, 0) - coalesce(b.web_revenue_incl, 0))
          / greatest(abs(coalesce(b.web_revenue_incl, 0)), 1)
        ) <= 0.005
      )
    order by
      abs((x.order_ts::date - b.purchase_ts::date)::numeric) asc,
      abs(coalesce(x.amount_incl, 0) - coalesce(b.web_revenue_incl, 0)) asc,
      x.document_no asc
    limit 1
  ) c on true
  where not b.is_exact_match
),
final as (
  select
    b.order_id,
    b.purchase_ts,
    b.web_revenue_excl,
    b.web_revenue_incl,
    b.is_exact_match,
    (p.order_id is not null) as is_probable_match
  from base b
  left join probable p
    on p.order_id = b.order_id
)
select
  date_trunc('day', f.purchase_ts)::date as day,
  count(*)::bigint as web_orders_magento,
  count(*) filter (where f.is_exact_match)::bigint as web_orders_booked_exact,
  count(*) filter (where f.is_probable_match)::bigint as web_orders_booked_probable,
  count(*) filter (where f.is_exact_match or f.is_probable_match)::bigint as web_orders_booked_total_est,
  (count(*) - count(*) filter (where f.is_exact_match))::bigint as web_orders_unbooked_gap_exact,
  (count(*) - count(*) filter (where f.is_exact_match or f.is_probable_match))::bigint as web_orders_unbooked_gap_est,
  case
    when count(*) = 0 then 0
    else round((count(*) filter (where f.is_exact_match))::numeric / count(*)::numeric, 4)
  end as booking_rate_exact,
  case
    when count(*) = 0 then 0
    else round((count(*) filter (where f.is_exact_match or f.is_probable_match))::numeric / count(*)::numeric, 4)
  end as booking_rate_est
from final f
group by 1;

-- Web booking reconciliation (Magento NEWWEB vs BC booked "VEFUR")
--
-- Goal:
-- 1) Track how many Magento web orders are actually booked in BC.
-- 2) Show booking lag and gap (not yet booked / canceled / unmatched).
-- 3) Provide row-level diagnostics to tune matching rules over time.

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
  group by n.order_id
),
bc_web as (
  select
    i.document_no::text as document_no,
    nullif(trim(i.external_doc_no), '') as external_doc_no,
    i.order_date as order_ts,
    coalesce(i.amount_excl, 0) as amount_excl,
    coalesce(i.amount_incl, 0) as amount_incl,
    upper(trim(coalesce(i.salesperson_code, ''))) as salesperson_code,
    coalesce(i.canceled::text, '') as canceled_raw,
    coalesce(i.corrective::text, '') as corrective_raw
  from raw.bc_invoices_raw i
  where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
    and not (
      lower(trim(coalesce(i.canceled::text, ''))) in ('1','true','t','yes','y','ja','já')
      or lower(trim(coalesce(i.corrective::text, ''))) in ('1','true','t','yes','y','ja','já')
    )
),
candidate_matches as (
  select
    n.order_id,
    n.purchase_ts,
    n.web_revenue_excl,
    n.web_revenue_incl,
    b.document_no,
    b.external_doc_no,
    b.order_ts,
    b.amount_excl as booked_revenue_excl,
    b.amount_incl as booked_revenue_incl,
    case
      when b.external_doc_no = n.order_id then 'external_doc_exact'
      when lower(regexp_replace(coalesce(b.external_doc_no, ''), '[^a-zA-Z0-9]', '', 'g'))
         = lower(regexp_replace(n.order_id, '[^a-zA-Z0-9]', '', 'g'))
        then 'external_doc_normalized'
      when regexp_replace(coalesce(b.external_doc_no, ''), '\D', '', 'g')
         = regexp_replace(n.order_id, '\D', '', 'g')
       and length(regexp_replace(n.order_id, '\D', '', 'g')) >= 6
        then 'external_doc_digits'
      else 'no_match'
    end as match_rule,
    case
      when b.external_doc_no = n.order_id then 100
      when lower(regexp_replace(coalesce(b.external_doc_no, ''), '[^a-zA-Z0-9]', '', 'g'))
         = lower(regexp_replace(n.order_id, '[^a-zA-Z0-9]', '', 'g'))
        then 80
      when regexp_replace(coalesce(b.external_doc_no, ''), '\D', '', 'g')
         = regexp_replace(n.order_id, '\D', '', 'g')
       and length(regexp_replace(n.order_id, '\D', '', 'g')) >= 6
        then 60
      else 0
    end as match_score
  from newweb n
  left join bc_web b
    on (
      b.external_doc_no = n.order_id
      or lower(regexp_replace(coalesce(b.external_doc_no, ''), '[^a-zA-Z0-9]', '', 'g'))
         = lower(regexp_replace(n.order_id, '[^a-zA-Z0-9]', '', 'g'))
      or (
        regexp_replace(coalesce(b.external_doc_no, ''), '\D', '', 'g')
        = regexp_replace(n.order_id, '\D', '', 'g')
        and length(regexp_replace(n.order_id, '\D', '', 'g')) >= 6
      )
    )
),
ranked as (
  select
    c.*,
    row_number() over (
      partition by c.order_id
      order by
        c.match_score desc,
        abs(extract(epoch from (coalesce(c.order_ts, c.purchase_ts) - c.purchase_ts))) asc,
        c.document_no asc
    ) as rn
  from candidate_matches c
)
select
  r.order_id,
  r.purchase_ts,
  r.web_revenue_excl,
  r.web_revenue_incl,
  r.document_no as bc_document_no,
  r.external_doc_no as bc_external_doc_no,
  r.order_ts as bc_order_ts,
  r.booked_revenue_excl,
  r.booked_revenue_incl,
  coalesce(r.match_rule, 'unmatched') as match_rule,
  coalesce(r.match_score, 0) as match_score,
  (r.document_no is not null and coalesce(r.match_score, 0) > 0) as is_booked_match,
  case
    when r.document_no is null then null
    else greatest(
      0,
      round(extract(epoch from ((coalesce(r.order_ts, r.purchase_ts)) - r.purchase_ts)) / 86400.0, 2)
    )
  end as booking_lag_days
from ranked r
where r.rn = 1;

create or replace view mart.v_web_booking_reconciliation_daily as
select
  date_trunc('day', o.purchase_ts)::date as day,
  count(*)::bigint as web_orders_magento,
  sum(o.web_revenue_excl) as web_revenue_excl_magento,
  sum(o.web_revenue_incl) as web_revenue_incl_magento,
  count(*) filter (where o.is_booked_match)::bigint as web_orders_booked_bc,
  sum(case when o.is_booked_match then o.booked_revenue_excl else 0 end) as web_revenue_excl_booked_bc,
  sum(case when o.is_booked_match then o.booked_revenue_incl else 0 end) as web_revenue_incl_booked_bc,
  (count(*) - count(*) filter (where o.is_booked_match))::bigint as web_orders_unbooked_gap,
  case
    when count(*) = 0 then 0
    else round((count(*) filter (where o.is_booked_match))::numeric / count(*)::numeric, 4)
  end as booking_rate,
  round(avg(o.booking_lag_days) filter (where o.is_booked_match), 2) as avg_booking_lag_days
from mart.v_web_booking_reconciliation_orders o
group by 1;

create index if not exists idx_v_web_booking_reconciliation_daily_day
  on mart.v_web_booking_reconciliation_daily (day desc);

-- Monthly BC net metrics for Power BI / QA
-- Net = invoices - credit invoices (by booking/order date month).

create schema if not exists mart;

create or replace view mart.v_bc_monthly_net_v1 as
with inv as (
  select
    date_trunc('month', i.order_date)::date as month_start,
    count(*)::numeric as orders,
    coalesce(sum(i.amount_incl), 0)::numeric as revenue_incl,
    coalesce(sum(i.amount_excl), 0)::numeric as revenue_excl,
    count(*) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           i.order_date < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    )::numeric as web_orders,
    coalesce(sum(i.amount_excl) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           i.order_date < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    ), 0)::numeric as web_revenue_excl
  from raw.bc_invoices_raw i
  where i.order_date is not null
  group by 1
),
cr as (
  select
    date_trunc('month', i.order_date)::date as month_start,
    count(*)::numeric as orders,
    coalesce(sum(i.amount_incl), 0)::numeric as revenue_incl,
    coalesce(sum(i.amount_excl), 0)::numeric as revenue_excl,
    count(*) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           i.order_date < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    )::numeric as web_orders,
    coalesce(sum(i.amount_excl) filter (
      where upper(trim(coalesce(i.salesperson_code, ''))) = 'VEFUR'
         or (
           i.order_date < timestamp '2025-08-18'
           and upper(trim(coalesce(i.external_doc_no, ''))) like 'CO22-%'
         )
    ), 0)::numeric as web_revenue_excl
  from raw.bc_credit_invoices_raw i
  where i.order_date is not null
  group by 1
)
select
  to_char(coalesce(inv.month_start, cr.month_start), 'YYYY-MM') as month,
  coalesce(inv.month_start, cr.month_start) as month_start,
  (coalesce(inv.orders, 0) - coalesce(cr.orders, 0))::numeric as bc_orders_net,
  (coalesce(inv.revenue_incl, 0) - coalesce(cr.revenue_incl, 0))::numeric as bc_revenue_incl_net,
  (coalesce(inv.revenue_excl, 0) - coalesce(cr.revenue_excl, 0))::numeric as bc_revenue_excl_net,
  (coalesce(inv.web_orders, 0) - coalesce(cr.web_orders, 0))::numeric as bc_web_orders_net,
  (coalesce(inv.web_revenue_excl, 0) - coalesce(cr.web_revenue_excl, 0))::numeric as bc_web_revenue_excl_net,
  case
    when (coalesce(inv.orders, 0) - coalesce(cr.orders, 0)) > 0
      then (coalesce(inv.web_orders, 0) - coalesce(cr.web_orders, 0))
           / nullif((coalesce(inv.orders, 0) - coalesce(cr.orders, 0)), 0)
    else 0
  end::numeric as web_orders_pct_of_bc,
  case
    when (coalesce(inv.revenue_excl, 0) - coalesce(cr.revenue_excl, 0)) > 0
      then (coalesce(inv.web_revenue_excl, 0) - coalesce(cr.web_revenue_excl, 0))
           / nullif((coalesce(inv.revenue_excl, 0) - coalesce(cr.revenue_excl, 0)), 0)
    else 0
  end::numeric as web_revenue_pct_of_bc
from inv
full outer join cr on cr.month_start = inv.month_start
order by month_start desc;

grant select on mart.v_bc_monthly_net_v1 to anon, authenticated, service_role;

-- 30-day web booking reconciliation summary for dashboard

create schema if not exists api;

create or replace function api.web_booking_reconciliation_30d()
returns table (
  web_orders_30d bigint,
  web_orders_booked_exact_30d bigint,
  web_orders_booked_est_30d bigint,
  web_orders_unbooked_gap_exact_30d bigint,
  web_orders_unbooked_gap_est_30d bigint,
  booking_rate_exact_30d numeric,
  booking_rate_est_30d numeric
)
language sql
stable
security definer
set search_path = mart, public
as $$
  select
    coalesce(sum(web_orders_magento), 0)::bigint as web_orders_30d,
    coalesce(sum(web_orders_booked_exact), 0)::bigint as web_orders_booked_exact_30d,
    coalesce(sum(web_orders_booked_total_est), 0)::bigint as web_orders_booked_est_30d,
    coalesce(sum(web_orders_unbooked_gap_exact), 0)::bigint as web_orders_unbooked_gap_exact_30d,
    coalesce(sum(web_orders_unbooked_gap_est), 0)::bigint as web_orders_unbooked_gap_est_30d,
    case
      when coalesce(sum(web_orders_magento), 0) = 0 then 0
      else round(
        coalesce(sum(web_orders_booked_exact), 0)::numeric
        / nullif(coalesce(sum(web_orders_magento), 0), 0)::numeric,
        4
      )
    end as booking_rate_exact_30d,
    case
      when coalesce(sum(web_orders_magento), 0) = 0 then 0
      else round(
        coalesce(sum(web_orders_booked_total_est), 0)::numeric
        / nullif(coalesce(sum(web_orders_magento), 0), 0)::numeric,
        4
      )
    end as booking_rate_est_30d
  from mart.v_web_booking_reconciliation_daily_v2
  where day >= (current_date - interval '30 days')
    and day <= current_date;
$$;

grant usage on schema api to anon, authenticated, service_role;
grant execute on function api.web_booking_reconciliation_30d() to anon, authenticated, service_role;
